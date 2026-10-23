'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  A11yCoreBuilderBase,
  readConditions,
  conditionLabel,
  mergeConditionResults,
  formatFailures
} = require('../src/index.js');

test('readConditions(): checks each condition, and reads null or [] as none', () => {
  assert.deepStrictEqual(readConditions([{ colorScheme: 'DARK' }, { width: 320 }, { colorScheme: 'light', width: 1024 }]), [
    { colorScheme: 'dark' },
    { width: 320 },
    { colorScheme: 'light', width: 1024 }
  ]);
  assert.strictEqual(readConditions(null), null);
  assert.strictEqual(readConditions([]), null);
  for (const [bad, message] of [
    [{ colorScheme: 'dark' }, /expected an array/],
    [[{ colorScheme: 'sepia' }], /colorScheme must be "light" or "dark", not "sepia"/],
    [[{ width: 0 }], /width must be a whole number of CSS pixels above 0, not 0/],
    [[{ width: '320' }], /width must be a whole number/],
    [[{ height: 600 }], /has "height"; a condition takes colorScheme and width/],
    [[{}], /condition 1 is empty/],
    [['dark'], /condition 1 must be an object/]
  ]) {
    assert.throws(() => readConditions(bad), message);
  }
});

test('conditionLabel(): names a condition as findings list it', () => {
  assert.strictEqual(conditionLabel(null), 'default');
  assert.strictEqual(conditionLabel({ colorScheme: 'dark' }), 'dark');
  assert.strictEqual(conditionLabel({ width: 320 }), 'width 320');
  assert.strictEqual(conditionLabel({ colorScheme: 'dark', width: 320 }), 'dark, width 320');
});

const occ = (selector, reasonCode, extra = {}) => ({ selector, summary: `${selector} ${reasonCode}`, data: { details: { reasonCode } }, ...extra });
const run = (condition, checks, environment) => ({
  condition,
  result: { url: 'https://example.com/', engine: { version: '1.14.0', environment }, checksResults: checks, rulesResults: [] }
});

test('mergeConditionResults(): worst outcome per rule, one occurrence per element and reason, with the conditions it appeared under', () => {
  const merged = mergeConditionResults([
    run('default', [
      { ruleId: 'contrast-minimum', outcome: 'pass', severity: 'serious', occurrences: [] },
      { ruleId: 'img-alt-present', outcome: 'fail', severity: 'critical', occurrences: [occ('img', 'NO_ALT')] },
      { ruleId: 'target-size-minimum', outcome: 'notApplicable', severity: 'serious', occurrences: [] }
    ], { layout: true, viewport: { width: 1280, height: 720 }, colorScheme: 'light' }),
    run('dark', [
      { ruleId: 'contrast-minimum', outcome: 'fail', severity: 'serious', occurrences: [occ('p', 'BELOW')] },
      { ruleId: 'img-alt-present', outcome: 'fail', severity: 'critical', occurrences: [occ('img', 'NO_ALT')] },
      { ruleId: 'target-size-minimum', outcome: 'notApplicable', severity: 'serious', occurrences: [] }
    ], { layout: true, viewport: { width: 1280, height: 720 }, colorScheme: 'dark' }),
    run('width 320', [
      { ruleId: 'contrast-minimum', outcome: 'pass', severity: 'serious', occurrences: [] },
      { ruleId: 'img-alt-present', outcome: 'fail', severity: 'critical', occurrences: [occ('img', 'NO_ALT')] },
      { ruleId: 'target-size-minimum', outcome: 'cantTell', severity: 'serious', occurrences: [occ('a', 'CLOSE')] }
    ], { layout: true, viewport: { width: 320, height: 720 }, colorScheme: 'light' })
  ]);
  const byId = Object.fromEntries(merged.checksResults.map((c) => [c.ruleId, c]));
  assert.strictEqual(byId['contrast-minimum'].outcome, 'fail');
  assert.deepStrictEqual(byId['contrast-minimum'].occurrences.map((o) => [o.selector, o.conditions]), [['p', ['dark']]]);
  assert.deepStrictEqual(byId['img-alt-present'].occurrences.map((o) => o.conditions), [['default', 'dark', 'width 320']]);
  assert.strictEqual(byId['target-size-minimum'].outcome, 'cantTell');
  assert.deepStrictEqual(merged.checksResults.map((c) => c.ruleId), ['contrast-minimum', 'img-alt-present', 'target-size-minimum']);
  assert.deepStrictEqual(merged.conditionRuns.map((r) => [r.condition, r.environment.viewport.width, r.environment.colorScheme]), [
    ['default', 1280, 'light'],
    ['dark', 1280, 'dark'],
    ['width 320', 320, 'light']
  ]);
  assert.strictEqual(merged.url, 'https://example.com/');
  assert.match(formatFailures(merged), /p BELOW\n {3}at p\n {3}seen in: dark/);
});

test('mergeConditionResults(): a failing rule drops the summary occurrence of the scans where it passed', () => {
  const merged = mergeConditionResults([
    run('default', [{ ruleId: 'contrast-minimum', outcome: 'pass', occurrences: [occ('', 'ALL_ABOVE_THRESHOLD')] }]),
    run('dark', [{ ruleId: 'contrast-minimum', outcome: 'fail', occurrences: [occ('p', 'BELOW')] }])
  ]);
  assert.deepStrictEqual(merged.checksResults[0].occurrences.map((o) => o.data.details.reasonCode), ['BELOW']);
  const passing = mergeConditionResults([
    run('default', [{ ruleId: 'contrast-minimum', outcome: 'pass', occurrences: [occ('', 'ALL_ABOVE_THRESHOLD')] }]),
    run('dark', [{ ruleId: 'contrast-minimum', outcome: 'pass', occurrences: [occ('', 'ALL_ABOVE_THRESHOLD')] }])
  ]);
  assert.deepStrictEqual(passing.checksResults[0].occurrences.map((o) => o.conditions), [['default', 'dark']]);
});

test('mergeConditionResults(): a rule only some scans kept (reportOnly) is taken from those, and composites take the worst', () => {
  const merged = mergeConditionResults([
    { condition: 'default', result: { checksResults: [], rulesResults: [{ ruleId: 'wcag-1.4.3', outcome: 'pass' }] } },
    {
      condition: 'dark',
      result: {
        checksResults: [{ ruleId: 'contrast-minimum', outcome: 'fail', occurrences: [occ('p', 'BELOW')] }],
        rulesResults: [{ ruleId: 'wcag-1.4.3', outcome: 'fail' }]
      }
    }
  ]);
  assert.deepStrictEqual(merged.checksResults.map((c) => [c.ruleId, c.outcome]), [['contrast-minimum', 'fail']]);
  assert.deepStrictEqual(merged.rulesResults.map((c) => [c.ruleId, c.outcome]), [['wcag-1.4.3', 'fail']]);
  assert.throws(() => mergeConditionResults([]), TypeError);
});

class StubBuilder extends A11yCoreBuilderBase {}

test('builder: .conditions() checks its list, and _scanUnderConditions() scans, applies, restores and merges', async () => {
  const builder = new StubBuilder();
  assert.throws(() => builder.conditions([{ colorScheme: 'blue' }]), /A11yCoreBuilder\.conditions\(\): colorScheme must be/);
  builder.conditions([{ colorScheme: 'dark' }, { width: 320 }]);
  const calls = [];
  let current = 'default';
  const merged = await builder._scanUnderConditions(
    async () => {
      calls.push(`scan ${current} (pictures: ${builder._screenshotCondition || 'default'})`);
      return { checksResults: [{ ruleId: 'r', outcome: current === 'dark' ? 'fail' : 'pass', occurrences: current === 'dark' ? [occ('p', 'X')] : [] }] };
    },
    {
      save: async () => 'saved',
      apply: async (c) => {
        current = conditionLabel(c);
        calls.push(`apply ${current}`);
      },
      restore: async (state) => {
        current = 'default';
        calls.push(`restore ${state}`);
      }
    }
  );
  assert.deepStrictEqual(calls, [
    'scan default (pictures: default)',
    'apply dark',
    'scan dark (pictures: dark)',
    'apply width 320',
    'scan width 320 (pictures: width 320)',
    'restore saved'
  ]);
  assert.strictEqual(merged.checksResults[0].outcome, 'fail');
  assert.strictEqual(builder._screenshotCondition, null);
});

test('builder: restore runs when a scan throws, and .frames(true) with .conditions() is refused', async () => {
  const builder = new StubBuilder().conditions([{ width: 320 }]);
  let restored = false;
  let scans = 0;
  await assert.rejects(
    builder._scanUnderConditions(
      async () => {
        scans += 1;
        if (scans === 2) throw new Error('boom');
        return { checksResults: [] };
      },
      { save: async () => null, apply: async () => {}, restore: async () => { restored = true; } }
    ),
    /boom/
  );
  assert.strictEqual(restored, true);
  const both = new StubBuilder().conditions([{ width: 320 }]).frames(true);
  await assert.rejects(
    both._scanUnderConditions(async () => ({ checksResults: [] }), { save: async () => null, apply: async () => {}, restore: async () => {} }),
    /\.conditions\(\) and \.frames\(true\) can't be combined yet/
  );
  assert.strictEqual(new StubBuilder().conditions(null)._conditions, null);
});
