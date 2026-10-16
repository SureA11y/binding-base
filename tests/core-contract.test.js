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
const { A11yCoreBuilderBase, formatFailures, getScanGaps, getScanNotes } = require('../src/index.js');

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

test('core contract: a custom rule disableRules() leaves out is listed as excluded, and is no scan gap', () => {
  const page = pageScan();
  try {
    const rule = { id: 'org-rule', runInPage: () => ({ outcome: 'pass', occurrences: [] }) };
    const result = page.scan(new A11yCoreBuilderBase().withCustomRules(rule).disableRules('org-rule'));
    assert.deepStrictEqual(result.skippedCustomRules, [{ id: 'org-rule', reason: 'excluded by the selection.', excluded: true }]);
    assert.deepStrictEqual(getScanGaps(result), []);
    assert.doesNotMatch(formatFailures(result), /did not run|in what was scanned/);
  } finally {
    page.close();
  }
});

test('core contract: getScanNotes() advises the internals hook where a real scan asked about private internals, and not once it ran', () => {
  const html = '<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>Hi</h1><x-check role="checkbox"></x-check></main></body></html>';
  const component = "customElements.define('x-check', class extends HTMLElement { #i; constructor() { super(); this.#i = this.attachInternals(); this.#i.ariaLabel = 'Subscribe'; this.#i.ariaChecked = 'false'; } });";
  for (const hook of [false, true]) {
    const page = pageScan(html);
    try {
      if (hook) page.window.eval(core.internalsHookScript());
      page.window.eval(component);
      const result = page.scan(new A11yCoreBuilderBase());
      const notes = getScanNotes(result);
      if (hook) {
        assert.strictEqual(result.engine.environment.internalsHook, 'early');
        assert.deepStrictEqual(notes, []);
      } else {
        assert.deepStrictEqual(notes.map((n) => [n.kind, n.hook, n.elementCount]), [['internals-hook', 'none', 1]]);
      }
    } finally {
      page.close();
    }
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

test('core contract: formatFailures() and getScanGaps() read a real scoped result with a skipped custom rule', () => {
  const page = pageScan();
  try {
    const result = quietly(() => page.scan(
      new A11yCoreBuilderBase()
        .include('main')
        .include('#missing')
        .withRules('img-alt-present')
        .withCustomRules({ id: 'broken', runInPage: 'not a function (' })
    ));
    const text = formatFailures(result);
    assert.match(text, /^1\) img-alt-present /);
    assert.match(text, /\nPart of the scan scope was not scanned: no element matched "#missing"\.\n/);
    assert.match(text, /\nCustom rule "broken" did not run: /);
    assert.match(text, /\n\nScanned with @surea11y\/core \d+\.\d+\.\d+/);
  } finally {
    page.close();
  }
});

// --- 1.11: packs, WCAG targets, best practices, strict options --------------------

const { definePack, wcagTags } = require('@surea11y/core/pack');

const MARQUEE_PAGE = '<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>Hi</h1><img src="a.png"><marquee>News</marquee></main></body></html>';

const acme = definePack({
  name: '@acme/a11y-rules',
  version: '1.0.0',
  namespace: 'acme',
  core: '^1.11.1',
  rules: [
    {
      id: 'acme-no-marquee',
      meta: { title: 'No marquee', tags: ['acme'] },
      runInPage: (ctx) => {
        const m = ctx.document.querySelector('marquee');
        return m
          ? { outcome: 'fail', occurrences: [ctx.helpers.reportOccurrence(m, { summary: 'A marquee moves on its own.' })] }
          : { outcome: 'pass', occurrences: [] };
      }
    }
  ]
});

const city = definePack({
  name: '@city/web-policy',
  title: 'City web policy',
  version: '2026.1.0',
  namespace: 'city',
  core: '^1.11.1',
  profiles: { 'city-2026': { tags: wcagTags('2.2'), exclude: { rules: ['target-size-minimum'] } } },
  rollups: [{ id: 'city-images', title: 'Images', checksIds: ['img-alt-present'] }]
});

function packPage(builder, html = MARQUEE_PAGE) {
  const page = pageScan(html);
  page.window.eval(builder._packScript());
  return page;
}

test('core contract: a pack registered by _packScript() runs, and the result names it', () => {
  const builder = new A11yCoreBuilderBase().withPacks(acme).withRules('acme-no-marquee');
  const page = packPage(builder);
  try {
    const result = page.scan(builder);
    assert.deepStrictEqual(result.engine.packs, ['@acme/a11y-rules@1.0.0']);
    assert.deepStrictEqual(result.checksResults.map((r) => [r.ruleId, r.outcome]), [['acme-no-marquee', 'fail']]);
    assert.deepStrictEqual(getScanGaps(result), []);
  } finally {
    page.close();
  }
});

test("core contract: a pack's checklist profile runs through options({ profile })", () => {
  const builder = new A11yCoreBuilderBase().withPacks(city).options({ profile: 'city-2026' });
  const page = packPage(builder);
  try {
    const result = page.scan(builder);
    assert.strictEqual(result.engine.profile, 'city-2026');
    assert.ok(!result.checksResults.some((r) => r.ruleId === 'target-size-minimum'));
    const items = result.rulesResults.filter((r) => r.meta && r.meta.standard === 'City web policy');
    assert.deepStrictEqual(items.map((r) => [r.ruleId, r.outcome]), [['city-images', 'fail']]);
  } finally {
    page.close();
  }
});

test('core contract: a pack the page does not run is a pack-skipped gap, not a clean scan', () => {
  const registered = new A11yCoreBuilderBase().withPacks(acme);
  const page = packPage(registered);
  try {
    const result = quietly(() => page.scan(new A11yCoreBuilderBase().withPacks(city).withRules('img-alt-present')));
    const gaps = getScanGaps(result);
    assert.deepStrictEqual(gaps.map((g) => [g.kind, g.pack.name]), [['pack-skipped', '@city/web-policy@2026.1.0']]);
    assert.match(formatFailures(result), /\nPack "@city\/web-policy@2026\.1\.0" did not run: /);
  } finally {
    page.close();
  }
});

test('core contract: withWcag() and withBestPractices() select what the engine runs', () => {
  const page = pageScan();
  try {
    const target = page.scan(new A11yCoreBuilderBase().withWcag('2.2', 'aa'));
    assert.strictEqual(target.engine.wcagLevel, 'AA', 'the level withWcag() gives is recorded');
    assert.strictEqual(target.engine.wcagVersion, '2.2');
    const ids = target.checksResults.map((r) => r.ruleId);
    assert.ok(ids.includes('img-alt-present'));
    assert.ok(!ids.includes('duplicate-id'), '4.1.1 is no part of a WCAG 2.2 target');
    assert.ok(!ids.includes('region'), 'a best practice is no part of a WCAG target');

    const withBest = page.scan(new A11yCoreBuilderBase().withWcag('2.2', 'AA').withBestPractices());
    assert.ok(withBest.checksResults.some((r) => r.ruleId === 'region'));
  } finally {
    page.close();
  }
});

test('core contract: includeMode() decides whether withTags() and withRules() intersect or add up', () => {
  const page = pageScan();
  try {
    const both = () => new A11yCoreBuilderBase().withTags('wcag2a').withRules('region');
    // region is a best practice with no wcag2a tag: under 'and' nothing matches both.
    const and = quietly(() => page.scan(both()));
    assert.strictEqual(and.checksResults.length, 0);

    const or = page.scan(both().includeMode('or'));
    const ids = or.checksResults.map((r) => r.ruleId);
    assert.ok(ids.includes('region'));
    assert.ok(ids.includes('img-alt-present'));
    const tagged = page.scan(new A11yCoreBuilderBase().withTags('wcag2a'));
    assert.strictEqual(ids.length, tagged.checksResults.length + 1, 'the wcag2a rules, plus region');
  } finally {
    page.close();
  }
});

test('core contract: wcagLevel() gives the level of the criteria a scan that names checks reports', () => {
  const page = pageScan();
  try {
    // contrast-computable checks 1.4.3 (AA) and 1.4.6 (AAA). Named alone, the
    // scan reports both; at AA, 1.4.3 alone, and the check still runs.
    const rollups = (result) => result.rulesResults.map((r) => r.ruleId);
    const every = page.scan(new A11yCoreBuilderBase().withRules('contrast-computable'));
    assert.deepStrictEqual(rollups(every), ['wcag-1.4.3-contrast-minimum', 'wcag-1.4.6-contrast-enhanced']);

    const aa = page.scan(new A11yCoreBuilderBase().withRules('contrast-computable').wcagLevel('aa'));
    assert.strictEqual(aa.engine.wcagLevel, 'AA');
    assert.deepStrictEqual(rollups(aa), ['wcag-1.4.3-contrast-minimum']);
    assert.deepStrictEqual(aa.checksResults.map((r) => r.ruleId), ['contrast-computable']);
  } finally {
    page.close();
  }
});

test('core contract: strictOptions rejects a misspelt option with INVALID_ENGINE_OPTIONS', () => {
  const page = pageScan();
  try {
    assert.throws(
      () => page.scan(new A11yCoreBuilderBase().options({ strictOptions: true, lcoale: 'fr' })),
      (err) => err.code === 'INVALID_ENGINE_OPTIONS' && /lcoale/.test(err.message)
    );
  } finally {
    page.close();
  }
});

// --- 1.12: what a scan will check, before it runs -----------------------------------

test('core contract: plannedChecks() and plannedCriteria() list what a real scan with the same builder reports', () => {
  const ids = (list, key) => list.map((e) => e[key]).sort();
  const cases = [
    ['a WCAG target', () => new A11yCoreBuilderBase().withWcag('2.2', 'AA')],
    ['rule ids at a level', () => new A11yCoreBuilderBase().withRules(['contrast-computable', 'img-alt-present']).wcagLevel('AA')],
    ['a custom rule', () => new A11yCoreBuilderBase().withWcag('2.1', 'A').includeMode('or').withRules('org-h1').withCustomRules({
      id: 'org-h1',
      meta: { title: 'One h1', tags: ['wcag2a', 'wcag131'] },
      runInPage: (ctx) => ({ outcome: ctx.document.querySelectorAll('h1').length === 1 ? 'pass' : 'fail', occurrences: [] })
    })],
    ['a pack', () => new A11yCoreBuilderBase().withPacks(city).options({ profile: 'city-2026' })]
  ];
  for (const [name, make] of cases) {
    const builder = make();
    const page = builder._packs.length ? packPage(builder) : pageScan();
    try {
      const result = quietly(() => page.scan(builder));
      assert.ok(result.checksResults.length, `${name}: the scan ran rules`);
      if (name === 'a custom rule') assert.ok(builder.plannedChecks().some((c) => c.ruleId === 'org-h1'), 'the custom rule is planned');
      if (name === 'a pack') assert.ok(builder.plannedCriteria().some((r) => r.id === 'city-images'), "the pack's rollup is planned");
      assert.deepStrictEqual(ids(builder.plannedChecks(), 'ruleId'), ids(result.checksResults, 'ruleId'), `${name}: checks`);
      assert.deepStrictEqual(ids(builder.plannedCriteria(), 'id'), ids(result.rulesResults, 'ruleId'), `${name}: criteria`);
    } finally {
      page.close();
    }
  }
});

test('core contract: plannedCriteria() follows wcagLevel(): no AAA criterion for a contrast check at AA', () => {
  const builder = new A11yCoreBuilderBase().withRules('contrast-computable');
  assert.deepStrictEqual(builder.plannedCriteria().map((r) => r.id), ['wcag-1.4.3-contrast-minimum', 'wcag-1.4.6-contrast-enhanced']);
  assert.deepStrictEqual(builder.wcagLevel('AA').plannedCriteria().map((r) => r.id), ['wcag-1.4.3-contrast-minimum']);
});
