'use strict';

// Style sheets a page can't read: another origin's, whose rules a page's
// script may not read (CSSOM). @surea11y/core reads their text from
// engineOptions.styleSheetTexts (core 1.14.0 and later) in their place, so
// css-orientation-lock can tell whether a CDN's CSS locks the orientation
// instead of asking. Core's preloadStyleSheets() fetches, in the page, those
// a server shares (CORS); a binding drives the browser from Node, where no
// CORS applies, so it fetches the rest: the page says which sheets it can't
// read, and Node fetches them.

// In the page: the URLs of the style sheets it can't read, linked or
// brought in by an @import, in document order. Self-contained: a driver
// sends it into the page by its source.
function findUnreadableStyleSheets() {
  const hrefs = [];
  function visit(sheet, depth) {
    if (!sheet || depth > 10) return;
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      rules = null;
    }
    if (!rules) {
      if (sheet.href && hrefs.indexOf(sheet.href) === -1) hrefs.push(sheet.href);
      return;
    }
    for (const rule of Array.from(rules)) if (rule && rule.type === 3) visit(rule.styleSheet, depth + 1);
  }
  // Document's own getter: an element named "styleSheets" shadows
  // document.styleSheets.
  const getter = Object.getOwnPropertyDescriptor(Document.prototype, 'styleSheets');
  const list = getter && getter.get ? getter.get.call(document) : [];
  for (const sheet of Array.from(list || [])) visit(sheet, 0);
  return hrefs;
}

// In Node: the text of each sheet, [{ href, text }] for those that answered
// in time with a 2xx. Never rejects. `fetch` is the global one unless given
// (a binding may pass its driver's, which carries the page's cookies);
// each request is given up after `timeoutMs`. With a `deadline` (a time in
// ms, as Date.now() gives it), no request waits past it, and the array's
// `notRead` lists the sheets given up on for it, as core's
// preloadStyleSheets() does: a scan's time budget (timeBudgetMs) gives the
// fetching half of it.
async function fetchStyleSheetTexts(hrefs, { fetch: fetchFn = globalThis.fetch, timeoutMs = 5000, deadline } = {}) {
  const notRead = [];
  // Not enumerable: the array still reads, and compares, as [{ href, text }].
  const done = (list) => Object.defineProperty(list, 'notRead', { value: notRead });
  if (typeof fetchFn !== 'function' || !Array.isArray(hrefs) || !hrefs.length) return done([]);
  const hasDeadline = typeof deadline === 'number' && Number.isFinite(deadline);
  const one = async (href) => {
    if (!/^https?:\/\//i.test(String(href))) return null;
    const left = hasDeadline ? deadline - Date.now() : Infinity;
    if (left <= 0) {
      notRead.push(href);
      return null;
    }
    const wait = Math.min(timeoutMs, left);
    const byDeadline = wait < timeoutMs;
    let timedOut = false;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => {
      timedOut = true;
      if (controller) controller.abort();
    }, wait);
    try {
      const res = await fetchFn(href, controller ? { signal: controller.signal } : undefined);
      if (!res || !res.ok) return null;
      const text = await res.text();
      return typeof text === 'string' ? { href, text } : null;
    } catch {
      if (timedOut && byDeadline) notRead.push(href);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  const got = await Promise.all(hrefs.map(one));
  // In the order the page gave them.
  notRead.sort((a, b) => hrefs.indexOf(a) - hrefs.indexOf(b));
  return done(got.filter(Boolean));
}

module.exports = {
  findUnreadableStyleSheets,
  fetchStyleSheetTexts
};
