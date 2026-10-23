'use strict';

const { toReconstructableSource } = require('./customRuleReconstruction');

/**
 * Wraps @surea11y/core's getAnnouncements (core 1.14.0 and later) in a
 * function to run in a page, which returns what the page's live regions
 * were given as the live-region hook recorded it, as plain data a driver can
 * carry back: [{ text, politeness, time }], or null when the page has no
 * hook. The element each entry names stays in the page. The returned
 * function is self-contained, as createInPageScan()'s is.
 */
function createInPageAnnouncements(getAnnouncements) {
  if (typeof getAnnouncements !== 'function') {
    throw new TypeError(
      'createInPageAnnouncements(): pass @surea11y/core\'s getAnnouncements function (core 1.14.0 and later).'
    );
  }
  const src =
    'function surea11yAnnouncements() {\n' +
    '  const read = (' + toReconstructableSource(getAnnouncements) + ');\n' +
    "  const list = read(typeof window !== 'undefined' ? window : undefined);\n" +
    '  if (!list) return null;\n' +
    '  return list.map((a) => ({ text: a.text, politeness: a.politeness, time: a.time }));\n' +
    '}';
  // eslint-disable-next-line no-new-func
  return new Function('return (' + src + ')')();
}

module.exports = { createInPageAnnouncements };
