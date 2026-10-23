'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const core = require('@surea11y/core');
const { createInPageAnnouncements } = require('../src/index.js');

// getAnnouncements and the live-region hook arrive with @surea11y/core
// 1.14.0; with an older core these are skipped.
const HAS_HOOK = typeof core.liveRegionHookScript === 'function';

test('createInPageAnnouncements(): asks for core\'s getAnnouncements', () => {
  assert.throws(() => createInPageAnnouncements(undefined), /getAnnouncements function \(core 1\.14\.0 and later\)/);
});

test(
  'createInPageAnnouncements(): returns what live regions were given, as plain data, once serialized into a page',
  { skip: !HAS_HOOK && 'needs @surea11y/core 1.14.0' },
  async () => {
    const dom = new JSDOM('<!doctype html><html lang="en"><body><main><div id="s" role="status"></div></main></body></html>', {
      runScripts: 'outside-only'
    });
    try {
      // Sent by its source alone, as a driver sends it.
      const read = dom.window.eval('(' + createInPageAnnouncements(core.getAnnouncements).toString() + ')');
      assert.strictEqual(read(), null, 'no hook yet');

      dom.window.eval(core.liveRegionHookScript({ early: true }));
      if (dom.window.document.readyState !== 'complete') {
        await new Promise((resolve) => dom.window.addEventListener('load', resolve));
      }
      dom.window.document.getElementById('s').textContent = 'Saved';
      const said = JSON.parse(JSON.stringify(read()));
      assert.deepStrictEqual(said.map((a) => [a.text, a.politeness]), [['Saved', 'polite']]);
      assert.strictEqual(typeof said[0].time, 'number');
      assert.deepStrictEqual(Object.keys(said[0]).sort(), ['politeness', 'text', 'time']);
    } finally {
      dom.window.close();
    }
  }
);
