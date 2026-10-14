'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { A11yCoreBuilderBase } = require('../src/index.js');

test('A11yCoreBuilderBase: constructor initializes empty/default state', () => {
  const b = new A11yCoreBuilderBase();
  assert.strictEqual(b._url, null);
  assert.strictEqual(b._scanFrames, false);
  assert.deepStrictEqual(b._includeSelectors, []);
  assert.deepStrictEqual(b._excludeSelectors, []);
  assert.deepStrictEqual(b._ruleScopedExcludeSelectors, {});
  assert.deepStrictEqual(b._includeRuleIds, []);
  assert.deepStrictEqual(b._excludeRuleIds, []);
  assert.deepStrictEqual(b._tags, []);
  assert.deepStrictEqual(b._excludeTags, []);
  assert.deepStrictEqual(b._engineOptions, {});
  assert.strictEqual(b._reportOutcomes, null);
  assert.strictEqual(b._elementRef, false);
  assert.deepStrictEqual(b._customRules, []);
});

test('A11yCoreBuilderBase: constructor accepts a url override', () => {
  const b = new A11yCoreBuilderBase({ url: 'https://example.com/' });
  assert.strictEqual(b._url, 'https://example.com/');
});

test('A11yCoreBuilderBase: include()/exclude() accumulate and are chainable', () => {
  const b = new A11yCoreBuilderBase();
  assert.strictEqual(b.include('#a'), b);
  b.include('#b');
  b.exclude('.x');
  assert.deepStrictEqual(b._includeSelectors, ['#a', '#b']);
  assert.deepStrictEqual(b._excludeSelectors, ['.x']);
  // Falsy selector is a no-op, not pushed.
  b.include('');
  assert.deepStrictEqual(b._includeSelectors, ['#a', '#b']);
});

test('A11yCoreBuilderBase: exclude(selector, { rules }) scopes the selector to just the named rule ID(s), leaving the global list untouched', () => {
  const b = new A11yCoreBuilderBase();
  b.exclude('.mat-select', { rules: ['aria-required-children'] });
  assert.deepStrictEqual(b._excludeSelectors, []);
  assert.deepStrictEqual(b._ruleScopedExcludeSelectors, { 'aria-required-children': ['.mat-select'] });
});

test('A11yCoreBuilderBase: exclude() with no opts still pushes to the global list unchanged (backward compatible)', () => {
  const b = new A11yCoreBuilderBase();
  b.exclude('#cookie-banner');
  assert.deepStrictEqual(b._excludeSelectors, ['#cookie-banner']);
  assert.deepStrictEqual(b._ruleScopedExcludeSelectors, {});
});

test('A11yCoreBuilderBase: exclude() global and rule-scoped calls combine without interfering', () => {
  const b = new A11yCoreBuilderBase();
  b.exclude('#cookie-banner');
  b.exclude('.mat-select', { rules: ['aria-required-children'] });
  assert.deepStrictEqual(b._excludeSelectors, ['#cookie-banner']);
  assert.deepStrictEqual(b._ruleScopedExcludeSelectors, { 'aria-required-children': ['.mat-select'] });
});

test('A11yCoreBuilderBase: exclude(selector, { rules }) accepts multiple rule IDs in one call', () => {
  const b = new A11yCoreBuilderBase();
  b.exclude('.mat-select', { rules: ['aria-required-children', 'color-contrast'] });
  assert.deepStrictEqual(b._ruleScopedExcludeSelectors, {
    'aria-required-children': ['.mat-select'],
    'color-contrast': ['.mat-select']
  });
});

test('A11yCoreBuilderBase: exclude(selector, { rules }) accumulates across multiple calls, including repeats for the same rule ID', () => {
  const b = new A11yCoreBuilderBase();
  b.exclude('.mat-select', { rules: ['aria-required-children'] });
  b.exclude('.mat-option', { rules: ['aria-required-children'] });
  b.exclude('#modal', { rules: 'color-contrast' });
  assert.deepStrictEqual(b._ruleScopedExcludeSelectors, {
    'aria-required-children': ['.mat-select', '.mat-option'],
    'color-contrast': ['#modal']
  });
});

test('A11yCoreBuilderBase: withTags()/disableTags() accept a string or array and accumulate', () => {
  const b = new A11yCoreBuilderBase();
  b.withTags('wcag2a').withTags(['wcag2aa', 'wcag412']);
  assert.deepStrictEqual(b._tags, ['wcag2a', 'wcag2aa', 'wcag412']);
  b.disableTags('best-practice');
  assert.deepStrictEqual(b._excludeTags, ['best-practice']);
});

test('A11yCoreBuilderBase: withRules()/disableRules() accept a string or array and accumulate', () => {
  const b = new A11yCoreBuilderBase();
  b.withRules('img-alt-present').withRules(['button-name-present']);
  assert.deepStrictEqual(b._includeRuleIds, ['img-alt-present', 'button-name-present']);
  b.disableRules(['meta-refresh-no-exceptions']);
  assert.deepStrictEqual(b._excludeRuleIds, ['meta-refresh-no-exceptions']);
});

test('A11yCoreBuilderBase: options() merges into engineOptions, does not replace wholesale', () => {
  const b = new A11yCoreBuilderBase();
  b.options({ locale: 'fr' });
  b.options({ contrast: { mode: 'auditorAssist' } });
  assert.deepStrictEqual(b._engineOptions, { locale: 'fr', contrast: { mode: 'auditorAssist' } });
});

test('A11yCoreBuilderBase: reportOnly() validates outcomes and REPLACES (not accumulates) on repeated calls', () => {
  const b = new A11yCoreBuilderBase();
  b.reportOnly(['fail']);
  assert.deepStrictEqual(b._reportOutcomes, ['fail']);
  b.reportOnly(['pass']);
  assert.deepStrictEqual(b._reportOutcomes, ['pass']); // replaced, not ['fail', 'pass']

  assert.throws(() => b.reportOnly(['nope']), /invalid outcome "nope"/);
  assert.throws(() => new A11yCoreBuilderBase().reportOnly('bogus'), /invalid outcome "bogus"/);
});

test('A11yCoreBuilderBase: elementRef()/frames() toggle and replace, default to true when called with no argument', () => {
  const b = new A11yCoreBuilderBase();
  assert.strictEqual(b._elementRef, false);
  b.elementRef();
  assert.strictEqual(b._elementRef, true);
  b.elementRef(false);
  assert.strictEqual(b._elementRef, false);

  assert.strictEqual(b._scanFrames, false);
  b.frames();
  assert.strictEqual(b._scanFrames, true);
});

test('A11yCoreBuilderBase: withCustomRules() throws synchronously on a missing/empty id', () => {
  const b = new A11yCoreBuilderBase();
  assert.throws(() => b.withCustomRules({ runInPage: () => ({}) }), /requires a non-empty string `id`/);
  assert.throws(() => b.withCustomRules({ id: '', runInPage: () => ({}) }), /requires a non-empty string `id`/);
});

test('A11yCoreBuilderBase: withCustomRules() throws synchronously when runInPage is missing or not a function/string', () => {
  const b = new A11yCoreBuilderBase();
  assert.throws(() => b.withCustomRules({ id: 'no-run-fn' }), /requires a `runInPage` function or function-source string/);
  assert.throws(() => b.withCustomRules({ id: 'bad-run-fn', runInPage: 123 }), /requires a `runInPage` function or function-source string/);
  assert.throws(() => b.withCustomRules({ id: 'empty-run-fn', runInPage: '' }), /requires a `runInPage` function or function-source string/);
});

test('A11yCoreBuilderBase: withCustomRules() throws synchronously when applicability is provided but not a function/string', () => {
  const b = new A11yCoreBuilderBase();
  assert.throws(
    () => b.withCustomRules({ id: 'bad-applicability', runInPage: () => ({}), applicability: 123 }),
    /`applicability` must be a function or function-source string/
  );
});

test('A11yCoreBuilderBase: withCustomRules() rejects the whole call (no partial registration) when one descriptor in an array is invalid', () => {
  const b = new A11yCoreBuilderBase();
  const valid = { id: 'ok-rule', runInPage: () => ({}) };
  assert.throws(
    () => b.withCustomRules([valid, { id: '', runInPage: () => ({}) }]),
    /requires a non-empty string `id`/
  );
  assert.strictEqual(b._customRules.length, 0);
});

test('A11yCoreBuilderBase: withCustomRules() accumulates across calls and accepts an array in one call', () => {
  const b = new A11yCoreBuilderBase();
  b.withCustomRules({ id: 'rule-a', runInPage: () => ({}) });
  b.withCustomRules([{ id: 'rule-b', runInPage: () => ({}) }, { id: 'rule-c', runInPage: () => ({}) }]);
  assert.deepStrictEqual(b._customRules.map((r) => r.id), ['rule-a', 'rule-b', 'rule-c']);
});

test('A11yCoreBuilderBase: default _normalizeCustomRule() stringifies a live runInPage/applicability function', () => {
  const b = new A11yCoreBuilderBase();
  function runInPage(ctx) { return ctx.document ? { outcome: 'pass' } : { outcome: 'fail' }; }
  function applicability(ctx) { return !!ctx.document; }
  b.withCustomRules({ id: 'stringified-rule', runInPage, applicability });

  const [normalized] = b._customRules;
  assert.strictEqual(typeof normalized.runInPage, 'string');
  assert.strictEqual(typeof normalized.applicability, 'string');
  assert.ok(normalized.runInPage.includes('function'));
  // eslint-disable-next-line no-new-func
  assert.strictEqual(typeof new Function('return (' + normalized.runInPage + ')')(), 'function');
});

test('A11yCoreBuilderBase: default _normalizeCustomRule() passes an already-stringified runInPage through unchanged', () => {
  const b = new A11yCoreBuilderBase();
  const src = (function (ctx) { return { outcome: 'pass' }; }).toString();
  b.withCustomRules({ id: 'already-string', runInPage: src });
  assert.strictEqual(b._customRules[0].runInPage, src);
});

test('A11yCoreBuilderBase: _normalizeCustomRule() is a template-method hook a subclass can override (e.g. Cypress skips stringification)', () => {
  class NoStringifySubclass extends A11yCoreBuilderBase {
    _normalizeCustomRule(rule) {
      return { ...rule };
    }
  }
  const b = new NoStringifySubclass();
  const liveFn = (ctx) => ({ outcome: 'pass' });
  b.withCustomRules({ id: 'live-rule', runInPage: liveFn });
  assert.strictEqual(b._customRules[0].runInPage, liveFn); // untouched, still a live function reference
});

test('A11yCoreBuilderBase: _buildEngineArgs() derives contextSelector/engineOptions/runOnly from accumulated state', () => {
  const b = new A11yCoreBuilderBase();
  assert.deepStrictEqual(b._buildEngineArgs(), { contextSelector: null, engineOptions: {}, runOnly: null });

  b.include('#main');
  assert.strictEqual(b._buildEngineArgs().contextSelector, '#main');
  b.include('#secondary');
  assert.deepStrictEqual(b._buildEngineArgs().contextSelector, ['#main', '#secondary']);

  const b2 = new A11yCoreBuilderBase();
  b2.exclude('.cookie-banner');
  assert.deepStrictEqual(b2._buildEngineArgs().engineOptions, { excludeSelectors: ['.cookie-banner'] });

  const b3 = new A11yCoreBuilderBase();
  b3.withRules('img-alt-present').disableTags('best-practice');
  assert.deepStrictEqual(b3._buildEngineArgs().runOnly, {
    includeRuleIds: ['img-alt-present'],
    excludeRuleIds: undefined,
    tags: undefined,
    excludeTags: ['best-practice']
  });
});

test('A11yCoreBuilderBase: _buildEngineArgs() produces engineOptions.rules[ruleId].excludeSelectors from rule-scoped exclude() calls', () => {
  const b = new A11yCoreBuilderBase();
  b.exclude('.mat-select', { rules: ['aria-required-children'] });
  b.exclude('.mat-option', { rules: ['aria-required-children', 'color-contrast'] });
  assert.deepStrictEqual(b._buildEngineArgs().engineOptions.rules, {
    'aria-required-children': { excludeSelectors: ['.mat-select', '.mat-option'] },
    'color-contrast': { excludeSelectors: ['.mat-option'] }
  });
});

test('A11yCoreBuilderBase: _buildEngineArgs() merges rule-scoped exclude() into a raw options({ rules }) call, without clobbering either', () => {
  const b = new A11yCoreBuilderBase();
  b.options({ rules: { 'aria-required-children': { enabled: false }, 'other-rule': { severity: 'minor' } } });
  b.exclude('.mat-select', { rules: ['aria-required-children'] });

  const { engineOptions } = b._buildEngineArgs();
  assert.deepStrictEqual(engineOptions.rules, {
    'aria-required-children': { enabled: false, excludeSelectors: ['.mat-select'] },
    'other-rule': { severity: 'minor' }
  });
});

test('A11yCoreBuilderBase: _buildEngineArgs() combines global excludeSelectors and rule-scoped rules independently', () => {
  const b = new A11yCoreBuilderBase();
  b.exclude('#cookie-banner');
  b.exclude('.mat-select', { rules: ['aria-required-children'] });

  const { engineOptions } = b._buildEngineArgs();
  assert.deepStrictEqual(engineOptions.excludeSelectors, ['#cookie-banner']);
  assert.deepStrictEqual(engineOptions.rules, { 'aria-required-children': { excludeSelectors: ['.mat-select'] } });
});

test('A11yCoreBuilderBase: _buildEngineArgs() concatenates withCustomRules() registrations with a raw options({ customRules }) call, not clobbering either', () => {
  const b = new A11yCoreBuilderBase();
  const fromOptions = { id: 'from-options', runInPage: () => ({}) };
  const fromMethod = { id: 'from-method', runInPage: () => ({}) };
  b.options({ customRules: [fromOptions] });
  b.withCustomRules(fromMethod);

  const { engineOptions } = b._buildEngineArgs();
  assert.deepStrictEqual(engineOptions.customRules.map((r) => r.id), ['from-options', 'from-method']);
});

test('A11yCoreBuilderBase: _applyReportOnly() filters checksResults by outcome, and is a no-op when reportOnly() was never called', () => {
  const b = new A11yCoreBuilderBase();
  const result = {
    checksResults: [
      { ruleId: 'a', outcome: 'fail' },
      { ruleId: 'b', outcome: 'pass' }
    ]
  };
  assert.deepStrictEqual(b._applyReportOnly(result), result); // no-op, reportOnly() unset

  b.reportOnly(['fail']);
  assert.deepStrictEqual(b._applyReportOnly(result).checksResults, [{ ruleId: 'a', outcome: 'fail' }]);
});

test('A11yCoreBuilderBase: _applyReportOnly() tolerates a falsy/malformed result instead of throwing', () => {
  const b = new A11yCoreBuilderBase().reportOnly(['fail']);
  assert.strictEqual(b._applyReportOnly(null), null);
  assert.strictEqual(b._applyReportOnly(undefined), undefined);
  const noChecksResults = { url: null, error: 'frame detached' };
  assert.strictEqual(b._applyReportOnly(noChecksResults), noChecksResults);
});

test('A11yCoreBuilderBase: analyze() throws by default -- every subclass must implement it', () => {
  assert.throws(() => new A11yCoreBuilderBase().analyze(), /must be implemented by a subclass/);
});

test('A11yCoreBuilderBase: withTags()/disableTags()/withRules()/disableRules() reject a value that is not a non-empty string, with INVALID_RUN_ONLY', () => {
  for (const method of ['withTags', 'disableTags', 'withRules', 'disableRules']) {
    for (const bad of [undefined, null, 42, '', '  ', ['wcag2a', undefined]]) {
      const builder = new A11yCoreBuilderBase();
      assert.throws(
        () => builder[method](bad),
        (err) => err instanceof TypeError && err.code === 'INVALID_RUN_ONLY' && err.message.startsWith(`A11yCoreBuilder.${method}(): `),
        `${method}(${JSON.stringify(bad)})`
      );
      assert.strictEqual(builder._buildEngineArgs().runOnly, null, 'nothing recorded from a rejected call');
    }
  }
});

// --- scan-gap warnings ---------------------------------------------------------------

const GAPPY = {
  url: 'https://example.com/',
  contextMatch: { elementCount: 0, unmatchedSelectors: ['#missing'] },
  skippedCustomRules: [{ id: 'my-rule', reason: 'runInPage threw' }],
  checksResults: []
};

function capturingWarn(fn) {
  const warn = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(' '));
  try { fn(); } finally { console.warn = warn; }
  return lines;
}

test('A11yCoreBuilderBase: _warnScanGaps() prints each gap with console.warn, named by the source and the frame URL, by default', () => {
  const lines = capturingWarn(() => new A11yCoreBuilderBase()._warnScanGaps(GAPPY, '@surea11y/puppeteer'));
  assert.deepStrictEqual(lines, [
    '@surea11y/puppeteer (https://example.com/): Nothing was scanned: the scan scope matched no element ("#missing").',
    '@surea11y/puppeteer (https://example.com/): Custom rule "my-rule" did not run: runInPage threw.'
  ]);
  const noUrl = capturingWarn(() => new A11yCoreBuilderBase()._warnScanGaps({ ...GAPPY, url: null, skippedCustomRules: [] }, '@surea11y/selenium'));
  assert.deepStrictEqual(noUrl, ['@surea11y/selenium: Nothing was scanned: the scan scope matched no element ("#missing").']);
});

test('A11yCoreBuilderBase: _warnScanGaps() says nothing for a clean result or for what is not a scan result', () => {
  const b = new A11yCoreBuilderBase();
  const lines = capturingWarn(() => {
    b._warnScanGaps({ url: 'https://example.com/', checksResults: [] }, 'x');
    b._warnScanGaps(null, 'x');
    b._warnScanGaps({ url: 'https://example.com/', error: 'frame detached' }, 'x');
  });
  assert.deepStrictEqual(lines, []);
});

test('A11yCoreBuilderBase: logger() receives each gap and its frame\'s result instead of console.warn', () => {
  const seen = [];
  const b = new A11yCoreBuilderBase().logger((gap, result) => seen.push([gap.kind, result]));
  const lines = capturingWarn(() => b._warnScanGaps(GAPPY, '@surea11y/puppeteer'));
  assert.deepStrictEqual(lines, []);
  assert.deepStrictEqual(seen, [['context-not-found', GAPPY], ['custom-rule-skipped', GAPPY]]);
});

test('A11yCoreBuilderBase: logger(() => {}) silences the warnings, a later call replaces the logger, and logger(null) brings console.warn back', () => {
  const b = new A11yCoreBuilderBase().logger(() => { throw new Error('replaced'); }).logger(() => {});
  assert.deepStrictEqual(capturingWarn(() => b._warnScanGaps(GAPPY, 'x')), []);
  b.logger(null);
  assert.strictEqual(capturingWarn(() => b._warnScanGaps(GAPPY, 'x')).length, 2);
});

test('A11yCoreBuilderBase: logger() throws a TypeError for anything but a function or null', () => {
  for (const bad of [undefined, 'console', 42, {}, true]) {
    const b = new A11yCoreBuilderBase();
    assert.throws(() => b.logger(bad), (err) => err instanceof TypeError && err.message.startsWith('A11yCoreBuilder.logger(): '), `logger(${String(bad)})`);
    assert.strictEqual(b._logger, null, 'nothing recorded from a rejected call');
  }
});

// --- packs ---------------------------------------------------------------------------

const PACK = {
  name: '@acme/a11y-rules',
  version: '1.0.0',
  namespace: 'acme',
  core: '*',
  rules: [{ id: 'acme-always', meta: { title: 'Always passes', tags: ['acme'] }, runInPage: () => ({ outcome: 'pass' }) }]
};

test('A11yCoreBuilderBase: withPacks() names the packs in engineOptions.packs, after any already given', () => {
  const b = new A11yCoreBuilderBase().options({ packs: ['@other/pack@2.0.0'] }).withPacks(PACK);
  assert.deepStrictEqual(b._buildEngineArgs().engineOptions.packs, ['@other/pack@2.0.0', '@acme/a11y-rules@1.0.0']);
  assert.strictEqual(new A11yCoreBuilderBase()._buildEngineArgs().engineOptions.packs, undefined);
});

test('A11yCoreBuilderBase: _packScript() is built once per set of packs, and is null without packs', () => {
  const b = new A11yCoreBuilderBase().withPacks([PACK]);
  const script = b._packScript();
  assert.strictEqual(typeof script, 'string');
  assert.strictEqual(b._packScript(), script);
  b.withPacks({ ...PACK, name: '@acme/more-rules', namespace: 'more', rules: [] });
  assert.notStrictEqual(b._packScript(), script);
  assert.strictEqual(new A11yCoreBuilderBase()._packScript(), null);
});

// --- WCAG targets and best practices -------------------------------------------------

test('A11yCoreBuilderBase: withWcag() sets runOnly.wcag, replaced by a later call, beside tags and rules', () => {
  const b = new A11yCoreBuilderBase().withWcag('2.1', 'A').withWcag('2.2', 'AA').withRules('region');
  assert.deepStrictEqual(b._buildEngineArgs().runOnly, {
    includeRuleIds: ['region'],
    excludeRuleIds: undefined,
    tags: undefined,
    excludeTags: undefined,
    wcag: { version: '2.2', level: 'AA' }
  });
  assert.deepStrictEqual(new A11yCoreBuilderBase().withWcag(2.2)._buildEngineArgs().runOnly.wcag, { version: '2.2', level: 'AA' });
});

test('A11yCoreBuilderBase: withWcag() throws INVALID_RUN_ONLY for a version or level the engine has not', () => {
  for (const [version, level] of [['3.0', 'AA'], ['2.2', 'AAAA'], [undefined, 'AA'], ['2.2', 'aa']]) {
    assert.throws(
      () => new A11yCoreBuilderBase().withWcag(version, level),
      (err) => err instanceof TypeError && err.code === 'INVALID_RUN_ONLY' && /withWcag\(\)/.test(err.message),
      `withWcag(${JSON.stringify(version)}, ${JSON.stringify(level)})`
    );
  }
});

test('A11yCoreBuilderBase: withBestPractices() sets runOnly.bestPractices, and withBestPractices(false) clears it', () => {
  assert.strictEqual(new A11yCoreBuilderBase().withBestPractices()._buildEngineArgs().runOnly.bestPractices, true);
  assert.strictEqual(new A11yCoreBuilderBase().withBestPractices().withBestPractices(false)._buildEngineArgs().runOnly, null);
});

test('A11yCoreBuilderBase: includeMode() sets runOnly.includeMode beside tags and rules, replaced by a later call', () => {
  const b = new A11yCoreBuilderBase().withTags('wcag2a').withRules('region').includeMode('and').includeMode('or');
  assert.deepStrictEqual(b._buildEngineArgs().runOnly, {
    includeRuleIds: ['region'],
    excludeRuleIds: undefined,
    tags: ['wcag2a'],
    excludeTags: undefined,
    includeMode: 'or'
  });
  assert.ok(!('includeMode' in new A11yCoreBuilderBase().withTags('wcag2a')._buildEngineArgs().runOnly), 'absent unless set');
});

test('A11yCoreBuilderBase: includeMode() on its own selects nothing, so there is no runOnly', () => {
  assert.strictEqual(new A11yCoreBuilderBase().includeMode('or')._buildEngineArgs().runOnly, null);
});

test('A11yCoreBuilderBase: includeMode() throws INVALID_RUN_ONLY for anything but \'and\' or \'or\'', () => {
  for (const bad of ['xor', 'OR', '', undefined, null, true]) {
    const builder = new A11yCoreBuilderBase().withTags('wcag2a');
    assert.throws(
      () => builder.includeMode(bad),
      (err) => err instanceof TypeError && err.code === 'INVALID_RUN_ONLY' && err.message.startsWith('A11yCoreBuilder.includeMode(): '),
      `includeMode(${JSON.stringify(bad)})`
    );
    assert.ok(!('includeMode' in builder._buildEngineArgs().runOnly), 'nothing recorded from a rejected call');
  }
});

test('A11yCoreBuilderBase: withPacks() refuses what is not a pack, and _packScript() a pack surea11y cannot run', () => {
  assert.throws(() => new A11yCoreBuilderBase().withPacks('@acme/a11y-rules'), /each pack must be a pack object/);
  const old = new A11yCoreBuilderBase().withPacks({ ...PACK, core: '^99.0.0' });
  assert.throws(() => old._packScript(), /supports core/);
});
