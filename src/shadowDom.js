'use strict';

/**
 * Finds the element an occurrence (or a margin) points at, in shadow DOM
 * too. Since @surea11y/core 1.10.0 an element inside a shadow tree carries
 * `shadowHostSelectors`, the selectors of the shadow hosts leading to it,
 * outermost first, each resolved in the tree that holds it; its `selector`
 * then holds only inside the last host's shadow root. Looking that selector
 * up in the document finds another element, or nothing.
 *
 * Runs in the page and uses nothing from outside its own body, so a driver
 * can send it as it sends core's scan (page.evaluateHandle(),
 * executeScript(), browser.execute()). Returns null when a host or the
 * element is missing, a host has no open shadow root, or a selector does
 * not parse.
 *
 * @param {string} selector the occurrence's `selector`
 * @param {string[]} [shadowHostSelectors] the occurrence's `shadowHostSelectors`
 * @param {Document|DocumentFragment|Element} [root] where to start; the
 *   page's `document` by default (pass a frame's or window's own document
 *   when the caller runs in another realm, as Cypress does)
 * @returns {Element|null}
 */
function queryOccurrenceElement(selector, shadowHostSelectors, root) {
  if (typeof selector !== 'string' || !selector) return null;
  let scope = root || document;
  try {
    const hosts = Array.isArray(shadowHostSelectors) ? shadowHostSelectors : [];
    for (const hostSelector of hosts) {
      const host = scope.querySelector(hostSelector);
      if (!host || !host.shadowRoot) return null;
      scope = host.shadowRoot;
    }
    return scope.querySelector(selector);
  } catch (e) {
    return null;
  }
}

/**
 * The occurrence's location as one line for a person to read: its
 * `selector`, preceded by each shadow host, joined with ` >>> `, the
 * notation for crossing into a shadow root that Puppeteer and others
 * accept. Not a selector document.querySelector() can take.
 * @returns {string} empty when the occurrence has no selector
 */
function formatOccurrenceLocation(occurrence) {
  if (!occurrence || typeof occurrence.selector !== 'string' || !occurrence.selector) return '';
  const hosts = Array.isArray(occurrence.shadowHostSelectors) ? occurrence.shadowHostSelectors : [];
  return hosts.concat(occurrence.selector).join(' >>> ');
}

module.exports = { queryOccurrenceElement, formatOccurrenceLocation };
