'use strict';

// Which of a page's frames a .frames(true) scan reads, and how, as
// @surea11y/core's own scan across frames reads them (core's
// src/core/frame-scan.js and docs/ENGINE_OPTIONS.md, embeddedAriaHidden):
//
// - a frame the page does not show (checkVisibility) or that an open modal
//   dialog covers, unless includeHiddenElements, one in excluded content,
//   one in a shadow root when the scan leaves shadow roots out
//   (includeShadowDom: false), and one of the top page outside include()'s
//   roots are left out, with their whole content;
// - a frame that shows nothing (an empty about:blank) is left out too: a
//   document with no content has nothing to check;
// - a frame under aria-hidden="true" is scanned with
//   engineOptions.embeddedAriaHidden, so what is seen counts and names and
//   roles don't; one under [inert] with engineOptions.embeddedInert, so only
//   how it looks counts. A frame inside one inherits it (inheritFrameReading).
//
// The elements around a frame are read in the flat tree, as the
// accessibility tree reads them: through the slot an element is assigned
// to, and out of a shadow root to its host.
//
// The in-page functions are self-contained, for a binding to run in the page
// with its driver (page.evaluate, executeScript, browser.execute) or, in
// Cypress, on the window directly.

/**
 * In the page: the <iframe> and <frame> elements of a document, in document
 * order, through open shadow roots, not inside other frames.
 * @param {Document|ShadowRoot} [root]
 * @returns {Element[]}
 */
function findFrameElements(root) {
  const out = [];
  const visit = (node) => {
    const all = node.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      const tag = String(el.localName || '').toLowerCase();
      if (tag === 'iframe' || tag === 'frame') out.push(el);
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(root || document);
  return out;
}

/**
 * In the page, on a frame's element in its parent document: how the frame is
 * read. `{ skipped: 'hidden' | 'excluded' | 'outside-scope' }`, or what it is
 * under: `{ ariaHidden: true }`, `{ inert: true }`, both, or `{}`.
 * @param {Element} el
 * @param {{ excludeSelectors?: string[], includeHidden?: boolean, includeShadowDom?: boolean, scope?: string[]|null }} [options]
 *   `scope`: include()'s selectors, for a frame of the top page only.
 */
function readFrameElement(el, options) {
  const opts = options || {};
  // The element and those around it in the flat tree, nearest first.
  const chain = [];
  for (let n = el; n; ) {
    if (n.nodeType === 1) chain.push(n);
    let next = (n.nodeType === 1 && n.assignedSlot) || n.parentNode;
    if (next && next.nodeType === 11) next = next.host || null;
    n = next;
  }
  const matches = (selector) => chain.some((n) => n.matches && n.matches(selector));
  // The document's own elements around it, through the shadow hosts it is
  // in: include()'s roots are the document's elements its selectors match,
  // as core's querySelectorAll finds them, and their shadow roots' frames
  // are theirs.
  const doc = el.ownerDocument;
  const docAncestors = [];
  for (let n = el; n; ) {
    if (n.nodeType === 1 && n.getRootNode && n.getRootNode() === doc) docAncestors.push(n);
    let next = n.parentNode;
    if (next && next.nodeType === 11) next = next.host || null;
    n = next;
  }
  // A frame in a shadow root is its own tree's, whatever slot it may be
  // assigned to: a light-DOM frame slotted into a component is not.
  const own = el.getRootNode && el.getRootNode();
  const inShadowRoot = !!(own && own.nodeType === 11 && own.host);
  if (opts.includeShadowDom === false && inShadowRoot) return { skipped: 'excluded' };
  if (!opts.includeHidden) {
    try {
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true })) {
        return { skipped: 'hidden' };
      }
    } catch (e) {
      // read as shown
    }
    // An open modal dialog makes everything else inert: a scan taken while
    // one is open judges the dialog, not what it covers.
    const modals = [];
    const visit = (root) => {
      const dialogs = root.querySelectorAll('dialog');
      for (let i = 0; i < dialogs.length; i++) {
        try {
          if (dialogs[i].matches(':modal')) modals.push(dialogs[i]);
        } catch (e) {
          // a browser without :modal
        }
      }
      const all = root.querySelectorAll('*');
      for (let i = 0; i < all.length; i++) if (all[i].shadowRoot) visit(all[i].shadowRoot);
    };
    try {
      visit(el.ownerDocument);
    } catch (e) {
      // read as not covered
    }
    // With several open, only the topmost is reachable: the others are
    // inert under it. The browser hit-tests none of an inert dialog, so the
    // topmost is the one a point at its centre lands in. When that tells
    // none apart (no layout), every open one counts.
    const top = modals.filter((d) => {
      try {
        const r = d.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        const view = doc.defaultView;
        const x = Math.min(Math.max(r.left + r.width / 2, 0), (view.innerWidth || 1) - 1);
        const y = Math.min(Math.max(r.top + r.height / 2, 0), (view.innerHeight || 1) - 1);
        const hit = doc.elementFromPoint(x, y);
        return !!hit && (hit === d || d.contains(hit) || (!!hit.shadowRoot && hit.shadowRoot.contains(d)));
      } catch (e) {
        return false;
      }
    });
    const reachable = top.length ? top : modals;
    if (modals.length && !reachable.some((d) => chain.indexOf(d) !== -1)) return { skipped: 'hidden' };
  }
  const excludes = Array.isArray(opts.excludeSelectors) ? opts.excludeSelectors : [];
  for (let i = 0; i < excludes.length; i++) {
    try {
      if (matches(excludes[i])) return { skipped: 'excluded' };
    } catch (e) {
      // a selector the page can't parse excludes nothing; the scan says so
    }
  }
  const scope = Array.isArray(opts.scope) ? opts.scope : null;
  if (scope && scope.length) {
    let inside = false;
    for (let i = 0; i < scope.length && !inside; i++) {
      try {
        inside = docAncestors.some((n) => n.matches(scope[i]));
      } catch (e) {
        // the scan says so of its own scope
      }
    }
    if (!inside) return { skipped: 'outside-scope' };
  }
  const out = {};
  for (let i = 0; i < chain.length; i++) {
    const v = chain[i].getAttribute('aria-hidden');
    if (v != null && String(v).trim().toLowerCase() === 'true') out.ariaHidden = true;
    if (chain[i].hasAttribute('inert')) out.inert = true;
  }
  return out;
}

/**
 * In the frame's document: whether it shows nothing (no element, text,
 * shadow root or generated content in its body).
 * @param {Document} [doc]
 * @returns {boolean}
 */
function isFrameDocumentEmpty(doc) {
  const d = doc || document;
  const body = d.body;
  if (!body || String(body.localName).toLowerCase() !== 'body') return false;
  if (body.children.length || String(body.textContent || '').trim() || body.shadowRoot) return false;
  try {
    const view = d.defaultView;
    for (const pseudo of ['::before', '::after']) {
      const content = view.getComputedStyle(body, pseudo).content;
      if (content && content !== 'none' && content !== 'normal') return false;
    }
  } catch (e) {
    return false;
  }
  return true;
}

/**
 * The options readFrameElement takes for a frame, from the scan's own:
 * `engineOptions.excludeSelectors`, `includeHiddenElements` and
 * `includeShadowDom`, and, for a frame of the top page, include()'s
 * selectors (`contextSelector`).
 * @param {object} engineOptions
 * @param {string|string[]|null} contextSelector
 * @param {boolean} topLevel whether the frame is the top page's own
 */
function frameReadingOptions(engineOptions, contextSelector, topLevel) {
  const eo = engineOptions && typeof engineOptions === 'object' ? engineOptions : {};
  const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])
    .map(String).map((s) => s.trim()).filter(Boolean);
  const scope = topLevel ? list(contextSelector) : [];
  return {
    excludeSelectors: list(eo.excludeSelectors),
    includeHidden: eo.includeHiddenElements === true,
    includeShadowDom: eo.includeShadowDom !== false,
    scope: scope.length ? scope : null
  };
}

/**
 * What a frame is under, with what the frames around it are under: a frame
 * inside an aria-hidden or inert one is read so too. `{ ariaHidden, inert }`.
 * @param {{ ariaHidden?: boolean, inert?: boolean }|null} above the frame it is in, as this gives it
 * @param {{ ariaHidden?: boolean, inert?: boolean }|null} reading readFrameElement's, for this frame
 */
function inheritFrameReading(above, reading) {
  return {
    ariaHidden: !!((above && above.ariaHidden) || (reading && reading.ariaHidden)),
    inert: !!((above && above.inert) || (reading && reading.inert))
  };
}

/**
 * The engine options a frame is scanned with: the scan's, with
 * embeddedAriaHidden for a frame under aria-hidden="true" and embeddedInert
 * for one under [inert] (core 1.15 and later; an older core ignores it).
 * A frame is no page of its own, whatever the scan said of its own
 * document (topLevelDocument).
 */
function frameEngineOptions(engineOptions, reading) {
  const eo = engineOptions && typeof engineOptions === 'object' ? engineOptions : {};
  const ariaHidden = !!(reading && reading.ariaHidden);
  const inert = !!(reading && reading.inert);
  if (!ariaHidden && !inert && !('topLevelDocument' in eo)) return engineOptions;
  const out = { ...eo };
  delete out.topLevelDocument;
  if (ariaHidden) out.embeddedAriaHidden = true;
  if (inert) out.embeddedInert = true;
  return out;
}

module.exports = {
  findFrameElements,
  readFrameElement,
  isFrameDocumentEmpty,
  frameReadingOptions,
  inheritFrameReading,
  frameEngineOptions
};
