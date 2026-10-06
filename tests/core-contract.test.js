'use strict';

// The builder's arguments and formatFailures() checked against the real
// engine, not hand-written stand-ins. @surea11y/core is only a dev
// dependency here: each binding brings its own copy, so these tests are what
// says this package still fits the engine release they test against.
//
// The scan runs through the in-page entry (runa11yCoreInPage) rebuilt from
// its source inside a jsdom window, as a browser binding sends it into a
// page, so errors come from another realm, as they do there. Results are
// copied out through JSON, as a driver's serialization boundary does.

const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const core = require('@surea11y/core');
const { A11yCoreBuilderBase, formatFailures } = require('../src/index.js');

const PAGE = '<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>Hi</h1><img src="a.png"></main></body></html>';

function pageScan(html = PAGE) {
  const dom = new JSDOM(html, { url: 'https://example.com/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const run = dom.window.eval('(' + core.runa11yCoreInPage.toString() + ')');
  return {
    window: dom.window,
    scan(builder) {
      const { contextSelector, engineOptions, runOnly } = builder._buildEngineArgs();
      return JSON.parse(JSON.stringify(run('https://example.com/', contextSelector, engineOptions, runOnly)));
    },
    close() { dom.window.close(); }
  };
}

// The engine warns on the console for a scope that matched nothing or a
// skipped custom rule; keep test output readable.
function quietly(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = warn; }
}

test('core contract: every runOnly shape the builder produces is accepted by the engine', () => {
  const page = pageScan();
  try {
    const shapes = [
      new A11yCoreBuilderBase().withRules('img-alt-present'),
      new A11yCoreBuilderBase().withRules('a11ycore-img-alt-present'),
      new A11yCoreBuilderBase().withTags(['wcag2a', 'wcag2aa']),
      new A11yCoreBuilderBase().disableRules('img-alt-present'),
      new A11yCoreBuilderBase().disableTags('best-practice'),
      new A11yCoreBuilderBase().withTags('wcag2a').disableRules('img-alt-present')
    ];
    for (const builder of shapes) {
      const result = page.scan(builder);
      assert.ok(Array.isArray(result.checksResults), JSON.stringify(builder._buildEngineArgs().runOnly));
    }

    const only = page.scan(new A11yCoreBuilderBase().withRules('img-alt-present'));
    assert.deepStrictEqual(only.checksResults.map((r) => r.ruleId), ['img-alt-present']);
    assert.strictEqual(only.checksResults[0].outcome, 'fail');
  } finally {
    page.close();
  }
});

test('core contract: a rule list that names nothing throws INVALID_RUN_ONLY from the engine', () => {
  const page = pageScan();
  try {
    assert.throws(
      () => page.scan(new A11yCoreBuilderBase().withRules('img-alt-presnet')),
      (err) => err.code === 'INVALID_RUN_ONLY' && /img-alt-presnet/.test(err.message)
    );
    assert.throws(
      () => page.scan(new A11yCoreBuilderBase().withTags('wcag2.2aa')),
      (err) => err.code === 'INVALID_RUN_ONLY'
    );
  } finally {
    page.close();
  }
});

test('core contract: an unparseable include() selector throws INVALID_CONTEXT_SELECTOR with the selector', () => {
  const page = pageScan();
  try {
    assert.throws(
      () => page.scan(new A11yCoreBuilderBase().include('main[')),
      (err) => err.code === 'INVALID_CONTEXT_SELECTOR' && err.selector === 'main['
    );
  } finally {
    page.close();
  }
});

test('core contract: results carry engine.version, contextMatch and skippedCustomRules', () => {
  const page = pageScan();
  try {
    const result = quietly(() => page.scan(
      new A11yCoreBuilderBase()
        .include('#missing')
        .withCustomRules({ id: 'broken', runInPage: 'not a function (' })
    ));
    assert.match(result.engine.version, /^\d+\.\d+\.\d+/);
    assert.deepStrictEqual(result.contextMatch, { elementCount: 0, unmatchedSelectors: ['#missing'] });
    assert.deepStrictEqual(result.skippedCustomRules.map((r) => r.id), ['broken']);
  } finally {
    page.close();
  }
});

test('core contract: withCustomRules() method shorthand runs in the engine', () => {
  const page = pageScan();
  try {
    const result = page.scan(new A11yCoreBuilderBase().withRules('my-rule').withCustomRules({
      id: 'my-rule',
      meta: { title: 'My rule' },
      runInPage(ctx) {
        return ctx.document.querySelector('h1') ? { outcome: 'pass', occurrences: [] } : { outcome: 'fail', occurrences: [] };
      }
    }));
    assert.deepStrictEqual(result.skippedCustomRules, []);
    assert.deepStrictEqual(result.checksResults.map((r) => [r.ruleId, r.outcome]), [['my-rule', 'pass']]);
  } finally {
    page.close();
  }
});

test('core contract: formatFailures() reads a real result', () => {
  const page = pageScan();
  try {
    const result = page.scan(new A11yCoreBuilderBase().withRules('img-alt-present'));
    const text = formatFailures(result.checksResults);
    assert.match(text, /^1\) img-alt-present \(\w+\): /);
    assert.match(text, /\n {3}at html > body > main > img/);
  } finally {
    page.close();
  }
});
