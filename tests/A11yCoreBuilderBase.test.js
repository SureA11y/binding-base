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
