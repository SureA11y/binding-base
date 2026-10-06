'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const core = require('@surea11y/core');
const { queryOccurrenceElement, formatOccurrenceLocation, formatFailures } = require('../src/index.js');

// A light-DOM <img> and one inside a shadow tree two hosts deep, both
// matching the bare selector "img" inside their own tree.
function page() {
  const dom = new JSDOM('<!doctype html><html lang="en"><body><main><img id="light" src="l.png"><x-outer id="outer"></x-outer></main></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
    runScripts: 'outside-only'
  });
  const doc = dom.window.document;
  const outer = doc.getElementById('outer').attachShadow({ mode: 'open' });
  outer.innerHTML = '<x-inner id="inner"></x-inner>';
  const inner = outer.getElementById('inner').attachShadow({ mode: 'open' });
  inner.innerHTML = '<img id="deep" src="d.png">';
  return dom;
}

test('queryOccurrenceElement(): finds a real shadow-DOM occurrence through its hosts, run in the page from its source', () => {
  const dom = page();
  try {
    const run = dom.window.eval('(' + core.runa11yCoreInPage.toString() + ')');
    const result = run('https://example.com/', null, {}, { includeRuleIds: ['img-alt-present'] });
    const occurrences = result.checksResults[0].occurrences;
    const shadowed = occurrences.find((o) => o.shadowHostSelectors);
    assert.ok(shadowed, 'core 1.10.0 reports shadowHostSelectors');

    const find = dom.window.eval('(' + queryOccurrenceElement.toString() + ')');
    for (const o of occurrences) {
      const el = find(o.selector, o.shadowHostSelectors);
      assert.ok(el, o.selector);
      assert.strictEqual(el.id, o.shadowHostSelectors ? 'deep' : 'light');
    }
    // Without the hosts, the shadowed occurrence's selector does not find it.
    const bare = find(shadowed.selector);
    assert.ok(!bare || bare.id !== 'deep');
  } finally {
    dom.window.close();
  }
});

test('queryOccurrenceElement(): takes a root, and returns null for anything it cannot follow', () => {
  const dom = page();
  try {
    const doc = dom.window.document;
    assert.strictEqual(queryOccurrenceElement('img', ['#outer', '#inner'], doc).id, 'deep');
    assert.strictEqual(queryOccurrenceElement('img', [], doc).id, 'light');
    assert.strictEqual(queryOccurrenceElement('img', ['#missing'], doc), null);
    assert.strictEqual(queryOccurrenceElement('img', ['main'], doc), null, 'a host without a shadow root');
    assert.strictEqual(queryOccurrenceElement('img[', [], doc), null, 'a selector that does not parse');
    assert.strictEqual(queryOccurrenceElement('', [], doc), null);
  } finally {
    dom.window.close();
  }
});

test('formatOccurrenceLocation(): joins shadow hosts and selector with >>>', () => {
  assert.strictEqual(formatOccurrenceLocation({ selector: 'img' }), 'img');
  assert.strictEqual(formatOccurrenceLocation({ selector: 'img', shadowHostSelectors: ['#outer', '#inner'] }), '#outer >>> #inner >>> img');
  assert.strictEqual(formatOccurrenceLocation({ selector: '' }), '');
  assert.strictEqual(formatOccurrenceLocation(null), '');
});

test('formatFailures(): locates a shadow-DOM occurrence through its hosts', () => {
  const text = formatFailures([
    {
      ruleId: 'img-alt-present',
      outcome: 'fail',
      severity: 'serious',
      occurrences: [{ selector: 'img', shadowHostSelectors: ['#outer'], summary: 'Missing alt.', hint: '' }]
    }
  ]);
  assert.strictEqual(text, '1) img-alt-present (serious): Missing alt.\n   at #outer >>> img');
});
