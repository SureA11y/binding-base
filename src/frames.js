'use strict';

// Which of a page's frames a .frames(true) scan reads, and how, as
// @surea11y/core's own scan across frames reads them (core's
// src/core/frame-scan.js and docs/ENGINE_OPTIONS.md, embeddedAriaHidden):
//
// - a frame the page does not show (checkVisibility, unless
//   includeHiddenElements), one in excluded content, and one of the top page
//   outside include()'s roots are left out, with their whole content;
// - a frame that shows nothing (an empty about:blank) is left out too: a
//   document with no content has nothing to check;
// - a frame under aria-hidden="true" is scanned with
//   engineOptions.embeddedAriaHidden, so what is seen counts and names and
//   roles don't. A frame inside one inherits it.
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
 * read. `{ skipped: 'hidden' | 'excluded' | 'outside-scope' }`, `{ ariaHidden:
 * true }`, or `{}`.
 * @param {Element} el
 * @param {{ excludeSelectors?: string[], includeHidden?: boolean, scope?: string[]|null }} [options]
 *   `scope`: include()'s selectors, for a frame of the top page only.
 */
function readFrameElement(el, options) {
  const opts = options || {};
  // Element.closest through the shadow roots it is in, up to the document.
  const closest = (node, selector) => {
    for (let n = node; n; ) {
      if (n.closest && n.closest(selector)) return true;
      const root = n.getRootNode && n.getRootNode();
      n = root && root.host ? root.host : null;
    }
    return false;
  };
  try {
    if (!opts.includeHidden && typeof el.checkVisibility === 'function'
      && !el.checkVisibility({ visibilityProperty: true })) {
      return { skipped: 'hidden' };
    }
  } catch (e) {
    // read as shown
  }
  const excludes = Array.isArray(opts.excludeSelectors) ? opts.excludeSelectors : [];
  for (let i = 0; i < excludes.length; i++) {
    try {
      if (closest(el, excludes[i])) return { skipped: 'excluded' };
    } catch (e) {
      // a selector the page can't parse excludes nothing; the scan says so
    }
  }
  const scope = Array.isArray(opts.scope) ? opts.scope : null;
  if (scope && scope.length) {
    let inside = false;
    for (let i = 0; i < scope.length && !inside; i++) {
      try {
        inside = closest(el, scope[i]);
      } catch (e) {
        // the scan says so of its own scope
      }
    }
    if (!inside) return { skipped: 'outside-scope' };
  }
  for (let n = el; n; ) {
    if (n.nodeType === 1) {
      const v = n.getAttribute('aria-hidden');
      if (v != null && String(v).trim().toLowerCase() === 'true') return { ariaHidden: true };
    }
    n = n.parentNode && n.parentNode.nodeType === 11 ? n.parentNode.host : n.parentNode;
  }
  return {};
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
 * `engineOptions.excludeSelectors` and `includeHiddenElements`, and, for a
 * frame of the top page, include()'s selectors (`contextSelector`).
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
    scope: scope.length ? scope : null
  };
}

/**
 * The engine options a frame is scanned with: the scan's, with
 * embeddedAriaHidden for a frame under aria-hidden="true".
 */
function frameEngineOptions(engineOptions, reading) {
  return reading && reading.ariaHidden ? { ...engineOptions, embeddedAriaHidden: true } : engineOptions;
}

module.exports = {
  findFrameElements,
  readFrameElement,
  isFrameDocumentEmpty,
  frameReadingOptions,
  frameEngineOptions
};
