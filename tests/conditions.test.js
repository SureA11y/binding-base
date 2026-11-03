'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  A11yCoreBuilderBase,
  readConditions,
  conditionLabel,
  mergeConditionResults,
  formatFailures,
  getScanGaps
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
      save: async () => {
        calls.push('save');
        return 'saved';
      },
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
    'save',
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

test('builder: a condition the driver refuses in save() stops before any scan', async () => {
  const builder = new StubBuilder().conditions([{ colorScheme: 'dark' }]);
  let scans = 0;
  let restored = false;
  await assert.rejects(
    builder._scanUnderConditions(
      async () => {
        scans += 1;
        return { checksResults: [] };
      },
      {
        save: async () => {
          throw new Error('no color scheme here');
        },
        apply: async () => {},
        restore: async () => {
          restored = true;
        }
      }
    ),
    /no color scheme here/
  );
  assert.strictEqual(scans, 0);
  assert.strictEqual(restored, false);
});

test("mergeConditionResults(): a scan of several profiles keeps each profile's worst verdict", () => {
  const scan = (outcome) => ({
    checksResults: [
      {
        ruleId: 'contrast-minimum',
        outcome,
        outcomeNormalized: outcome,
        checkOutcome: outcome,
        verdicts: { 'wcag22-aa': outcome, section508: outcome },
        occurrences: []
      }
    ],
    profiles: {
      'wcag22-aa': { wcagVersion: '2.2', rulesResults: { 'wcag-1.4.3-contrast-minimum': outcome } },
      section508: { wcagVersion: '2.0', rulesResults: { 'wcag-1.4.3-contrast-minimum': outcome } }
    },
    engine: {}
  });
  const merged = mergeConditionResults([
    { condition: 'default', result: scan('pass') },
    { condition: 'dark', result: scan('fail') }
  ]);
  const check = merged.checksResults[0];
  assert.equal(check.outcome, 'fail');
  assert.equal(check.outcomeNormalized, 'fail');
  assert.equal(check.checkOutcome, 'fail');
  assert.deepEqual(check.verdicts, { 'wcag22-aa': 'fail', section508: 'fail' });
  assert.equal(merged.profiles.section508.rulesResults['wcag-1.4.3-contrast-minimum'], 'fail');
  assert.equal(merged.profiles.section508.wcagVersion, '2.0');
});

test('mergeConditionResults(): a question stays a question when another scan fails its rule', () => {
  const question = { selector: 'p:nth-of-type(1)' };
  const merged = mergeConditionResults([
    {
      condition: 'light',
      result: { checksResults: [{ ruleId: 'brand-color', outcome: 'cantTell', occurrences: [question] }] }
    },
    {
      condition: 'dark',
      result: {
        checksResults: [
          {
            ruleId: 'brand-color',
            outcome: 'fail',
            occurrences: [
              { ...question, occurrenceOutcome: 'cantTell' },
              { selector: 'p:nth-of-type(2)' }
            ]
          }
        ]
      }
    }
  ]);
  const check = merged.checksResults[0];
  assert.equal(check.outcome, 'fail');
  assert.deepEqual(
    check.occurrences.map((o) => [o.selector, o.occurrenceOutcome]),
    [
      ['p:nth-of-type(1)', 'cantTell'],
      ['p:nth-of-type(2)', undefined]
    ]
  );
  assert.match(formatFailures(merged), /needs review\).*\n   at p:nth-of-type\(1\)/);
});

test('mergeConditionResults(): what any scan left out is a gap of the merged result', () => {
  const scan = (extra) => ({ checksResults: [], engine: { name: 'surea11y' }, ...extra });
  const merged = mergeConditionResults([
    {
      condition: 'default',
      result: scan({
        contextMatch: { elementCount: 1, unmatchedSelectors: [] },
        skippedCustomRules: [{ id: 'a', reason: 'x' }],
        skippedPacks: []
      })
    },
    {
      condition: { width: 320 },
      result: scan({
        contextMatch: { elementCount: 0, unmatchedSelectors: ['#desk'] },
        skippedCustomRules: [{ id: 'a', reason: 'x' }, { id: 'b', reason: 'y' }],
        skippedPacks: [{ name: 'p', reason: 'z' }],
        engine: { name: 'surea11y', profilesNotRun: [{ profile: 'nope', reason: 'unknown-profile' }] }
      })
    }
  ]);
  assert.deepEqual(merged.contextMatch, { elementCount: 0, unmatchedSelectors: ['#desk'] });
  assert.deepEqual(merged.skippedCustomRules.map((r) => r.id), ['a', 'b']);
  assert.deepEqual(merged.skippedPacks, [{ name: 'p', reason: 'z' }]);
  assert.deepEqual(merged.engine, {
    name: 'surea11y',
    profilesNotRun: [{ profile: 'nope', reason: 'unknown-profile' }]
  });
  assert.deepEqual(
    getScanGaps(merged).map((g) => g.kind),
    ['context-not-found', 'custom-rule-skipped', 'custom-rule-skipped', 'pack-skipped', 'profile-not-run']
  );
});

test('mergeConditionResults(): several findings of one rule on one element for one reason stay apart', () => {
  const finding = (attr) => ({
    selector: 'main > button',
    summary: `${attr} is not a valid value`,
    data: { details: { reasonCode: 'ARIA_VALUE_INVALID', attribute: attr } }
  });
  const scan = () => ({
    checksResults: [
      {
        ruleId: 'aria-valid-attr-value',
        outcome: 'fail',
        occurrences: [finding('aria-pressed'), finding('aria-expanded'), finding('aria-checked')]
      }
    ],
    engine: {}
  });
  const merged = mergeConditionResults([
    { condition: 'default', result: scan() },
    { condition: 'dark', result: scan() }
  ]);
  const occurrences = merged.checksResults[0].occurrences;
  assert.deepEqual(
    occurrences.map((o) => o.data.details.attribute),
    ['aria-pressed', 'aria-expanded', 'aria-checked']
  );
  assert.deepEqual(occurrences.map((o) => o.conditions), [
    ['default', 'dark'],
    ['default', 'dark'],
    ['default', 'dark']
  ]);
});

test("mergeConditionResults(): an element's verdicts are each profile's worst, and its conditions are told apart", () => {
  const scan = (verdict) => ({
    checksResults: [
      {
        ruleId: 'contrast',
        outcome: 'fail',
        verdicts: { a: verdict, b: 'pass' },
        occurrences: [{ selector: 'p', verdicts: { a: verdict, b: 'pass' } }]
      }
    ]
  });
  const merged = mergeConditionResults([
    { condition: { colorScheme: 'light' }, result: scan('pass') },
    { condition: { colorScheme: 'dark', width: 320 }, result: scan('fail') }
  ]);
  assert.deepEqual(merged.checksResults[0].occurrences[0].verdicts, { a: 'fail', b: 'pass' });
  merged.checksResults[0].occurrences[0].conditions = ['light', 'dark, width 320'];
  assert.match(formatFailures(merged), /seen in: light; dark, width 320/);
});
