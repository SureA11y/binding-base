'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { getScanGaps, formatFailures } = require('../src/index.js');

const finding = {
  ruleId: 'img-alt-present',
  outcome: 'fail',
  severity: 'serious',
  occurrences: [{ selector: 'img', summary: 'Missing alt.', hint: 'Add one.' }]
};

function result(fields = {}) {
  return {
    engine: { version: '1.10.0' },
    contextMatch: null,
    skippedCustomRules: [],
    checksResults: [],
    ...fields
  };
}

test('getScanGaps(): a clean full-page result, and one from before core 1.10.0, have none', () => {
  assert.deepStrictEqual(getScanGaps(result()), []);
  assert.deepStrictEqual(getScanGaps({ checksResults: [] }), []);
  assert.deepStrictEqual(getScanGaps(result({ contextMatch: { elementCount: 2, unmatchedSelectors: [] } })), []);
});

test('getScanGaps(): a scope that matched nothing', () => {
  assert.deepStrictEqual(getScanGaps(result({ contextMatch: { elementCount: 0, unmatchedSelectors: ['#app'] } })), [
    { kind: 'context-not-found', selectors: ['#app'], message: 'Nothing was scanned: the scan scope matched no element ("#app").' }
  ]);
});

test('getScanGaps(): part of a scope that matched nothing', () => {
  assert.deepStrictEqual(getScanGaps(result({ contextMatch: { elementCount: 1, unmatchedSelectors: ['#nav', '#aside'] } })), [
    {
      kind: 'context-partly-not-found',
      selectors: ['#nav', '#aside'],
      message: 'Part of the scan scope was not scanned: no element matched "#nav", "#aside".'
    }
  ]);
});

test('getScanGaps(): one gap per skipped custom rule, with or without an id', () => {
  const gaps = getScanGaps(result({
    skippedCustomRules: [
      { id: 'my-rule', reason: 'runInPage source could not be turned back into a function' },
      { id: null, reason: 'no id' }
    ]
  }));
  assert.deepStrictEqual(gaps, [
    {
      kind: 'custom-rule-skipped',
      rule: { id: 'my-rule', reason: 'runInPage source could not be turned back into a function' },
      message: 'Custom rule "my-rule" did not run: runInPage source could not be turned back into a function.'
    },
    { kind: 'custom-rule-skipped', rule: { id: null, reason: 'no id' }, message: 'Custom rule without an id did not run: no id.' }
  ]);
});

test('getScanGaps(): a custom rule the caller excluded is not a gap', () => {
  const gaps = getScanGaps(result({
    skippedCustomRules: [
      { id: 'excluded-rule', reason: 'excluded by the selection.', excluded: true },
      { id: 'older-core', reason: 'excluded by the selection.' },
      { id: 'not-selected', reason: 'not selected under profile "wcag22-aa": give it the tags of the criteria it checks.' }
    ]
  }));
  assert.deepStrictEqual(gaps.map((g) => g.rule.id), ['not-selected'], 'a rule the selection left out on its own is still a gap');
});

test('getScanGaps(): throws a TypeError for anything but one scan result', () => {
  for (const bad of [undefined, null, [], {}, { topFrame: result(), frames: [] }]) {
    assert.throws(() => getScanGaps(bad), TypeError);
  }
});

test('formatFailures(result): findings, then gaps, then the engine version', () => {
  const text = formatFailures(result({
    checksResults: [finding],
    contextMatch: { elementCount: 1, unmatchedSelectors: ['#nav'] },
    skippedCustomRules: [{ id: 'x', reason: 'no runInPage function' }]
  }));
  assert.strictEqual(
    text,
    '1) img-alt-present (serious): Missing alt.\n' +
    '   at img\n' +
    '   Add one.\n' +
    '\n' +
    'Part of the scan scope was not scanned: no element matched "#nav".\n' +
    'Custom rule "x" did not run: no runInPage function.\n' +
    '\n' +
    'Scanned with @surea11y/core 1.10.0.'
  );
});

test('formatFailures(result): a scope that matched nothing does not read as a clean scan', () => {
  assert.strictEqual(
    formatFailures(result({ contextMatch: { elementCount: 0, unmatchedSelectors: ['#app'] } })),
    'Nothing was scanned: the scan scope matched no element ("#app").\n\nScanned with @surea11y/core 1.10.0.'
  );
});

test('formatFailures(result): a clean result, with and without engine.version', () => {
  assert.strictEqual(formatFailures(result()), 'No accessibility violations found.\n\nScanned with @surea11y/core 1.10.0.');
  assert.strictEqual(formatFailures({ checksResults: [finding] }, { outcomes: ['cantTell'] }), 'No accessibility violations found.');
});

test('formatFailures(): an array still formats exactly as before, with no gaps or version', () => {
  assert.strictEqual(formatFailures([finding]), '1) img-alt-present (serious): Missing alt.\n   at img\n   Add one.');
  assert.strictEqual(formatFailures([]), 'No accessibility violations found.');
});

test('formatFailures(): throws a TypeError for a frames(true) tree or anything else that is not a result', () => {
  for (const bad of [undefined, null, {}, { topFrame: result(), frames: [] }]) {
    assert.throws(() => formatFailures(bad), TypeError);
  }
});

test('getScanGaps(): one gap per skipped pack, with the engine\'s reason', () => {
  assert.deepStrictEqual(getScanGaps(result({ skippedPacks: [{ name: '@acme/a11y-rules', reason: 'it supports core ^2.0.0, and this is core 1.11.1' }, { reason: '' }] })), [
    {
      kind: 'pack-skipped',
      pack: { name: '@acme/a11y-rules', reason: 'it supports core ^2.0.0, and this is core 1.11.1' },
      message: 'Pack "@acme/a11y-rules" did not run: it supports core ^2.0.0, and this is core 1.11.1.'
    },
    { kind: 'pack-skipped', pack: { name: null, reason: 'no reason given' }, message: 'Pack without a name did not run: no reason given.' }
  ]);
});

test('formatFailures(result): no findings beside a skipped pack or custom rule says so of what was scanned', () => {
  const skipped = { skippedPacks: [{ name: '@acme/a11y-rules', reason: 'it supports core ^2.0.0, and this is core 1.11.1' }] };
  assert.strictEqual(
    formatFailures(result(skipped)),
    'No accessibility violations found in what was scanned.\n\n' +
      'Pack "@acme/a11y-rules" did not run: it supports core ^2.0.0, and this is core 1.11.1.\n\n' +
      'Scanned with @surea11y/core 1.10.0.'
  );
  assert.match(formatFailures(result({ contextMatch: { elementCount: 1, unmatchedSelectors: ['#nav'] } })), /^No accessibility violations found in what was scanned\.\n\n/);
});

test('getScanGaps(): one gap per profile a scan of several did not run, with why', () => {
  const engine = {
    version: '1.15.0',
    profiles: ['wcag22-aa'],
    packs: ['@acme/pack@1.0.0'],
    profilesNotRun: [
      { profile: 'wai-aria-1.2', reason: 'pack-skipped' },
      { profile: 'nowhere-1.0', reason: 'unknown-profile' },
      { profile: 'acme-policy', reason: 'overridden-by-selection' },
      { profile: 'other-1.0', reason: 'something-new' }
    ]
  };
  assert.deepStrictEqual(getScanGaps(result({ engine })), [
    {
      kind: 'profile-not-run',
      profile: { name: 'wai-aria-1.2', reason: 'pack-skipped' },
      message: 'Profile "wai-aria-1.2" was asked for and did not run: its pack did not run.'
    },
    {
      kind: 'profile-not-run',
      profile: { name: 'nowhere-1.0', reason: 'unknown-profile' },
      message: 'Profile "nowhere-1.0" was asked for and did not run: no such profile in core or the packs given.'
    },
    {
      kind: 'profile-not-run',
      profile: { name: 'acme-policy', reason: 'overridden-by-selection' },
      message:
        'Profile "acme-policy" was asked for and did not run: the rules chosen in runOnly, or by rules, tags or tests in the engine options, select the rules instead.'
    },
    {
      kind: 'profile-not-run',
      profile: { name: 'other-1.0', reason: 'something-new' },
      message: 'Profile "other-1.0" was asked for and did not run: something-new.'
    }
  ]);
  // With no pack given, a profile no one has is said to be core's to have.
  const noPacks = { version: '1.15.0', profiles: ['wcag22-aa'], profilesNotRun: [{ profile: 'nowhere-1.0', reason: 'unknown-profile' }] };
  assert.strictEqual(
    getScanGaps(result({ engine: noPacks }))[0].message,
    'Profile "nowhere-1.0" was asked for and did not run: no such profile in core (a pack\'s profile needs its pack).'
  );
  // A scan of one profile, or of several that all ran, has none.
  assert.deepStrictEqual(getScanGaps(result({ engine: { profiles: ['wcag22-aa', 'wai-aria-1.2'] } })), []);
  // An entry naming no profile, which core never writes, is no gap.
  assert.deepStrictEqual(getScanGaps(result({ engine: { profilesNotRun: [null, { profile: '' }, { profile: '  ' }, 7] } })), []);
});

test('getScanGaps(): a scan its time budget cut short is one scan-incomplete gap, each rule named once', () => {
  const gaps = getScanGaps(result({
    engine: { version: '1.18.0', incomplete: { reason: 'timeBudget', timeBudgetMs: 2000, rulesNotRun: 3, profilesNotRun: 1 },
      profilesNotRun: [{ profile: 'wai-aria-1.2', reason: 'timeBudget' }] },
    notRun: [
      { ruleId: 'image-alt', reason: 'timeBudget' },
      { ruleId: 'aria-valid', reason: 'timeBudget', profile: 'wai-aria-1.2' },
      { ruleId: 'image-alt', reason: 'timeBudget', profile: 'wai-aria-1.2' }
    ]
  }));
  assert.deepStrictEqual(gaps, [
    {
      kind: 'profile-not-run',
      profile: { name: 'wai-aria-1.2', reason: 'timeBudget' },
      message: 'Profile "wai-aria-1.2" was asked for and did not run: the scan\'s time budget ran out before it started.'
    },
    {
      kind: 'scan-incomplete',
      incomplete: { reason: 'timeBudget', timeBudgetMs: 2000, rules: ['image-alt', 'aria-valid'] },
      message:
        'The scan was cut short: its time budget of 2000 ms ran out, and 2 rules ("image-alt", "aria-valid") did not run. Those rules checked nothing.'
    }
  ]);
});

test('getScanGaps(): a long list of rules not run is named in part, and style sheets not read are listed', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const [gap] = getScanGaps(result({
    engine: { incomplete: { reason: 'timeBudget', timeBudgetMs: 500, rulesNotRun: 7, styleSheetsNotRead: ['https://cdn.example/a.css'] } },
    notRun: ids.map((ruleId) => ({ ruleId, reason: 'timeBudget' }))
  }));
  assert.deepStrictEqual(gap.incomplete.rules, ids);
  assert.deepStrictEqual(gap.incomplete.styleSheetsNotRead, ['https://cdn.example/a.css']);
  assert.strictEqual(
    gap.message,
    'The scan was cut short: its time budget of 500 ms ran out, and 7 rules ("a", "b", "c", "d", "e" and 2 more) did not run; ' +
      '1 style sheet ("https://cdn.example/a.css") was not read. Those rules checked nothing.'
  );
});

test('getScanGaps(): style sheets alone not read, and notRun without engine.incomplete, are gaps too', () => {
  const [sheets] = getScanGaps(result({
    engine: { incomplete: { reason: 'timeBudget', timeBudgetMs: 100, rulesNotRun: 0, styleSheetsNotRead: ['https://x/a.css', 'https://x/b.css'] } }
  }));
  assert.strictEqual(
    sheets.message,
    'The scan was cut short: its time budget of 100 ms ran out, and 2 style sheets ("https://x/a.css", "https://x/b.css") were not read.'
  );
  const [bare] = getScanGaps(result({ notRun: [{ ruleId: 'image-alt', reason: 'timeBudget' }] }));
  assert.deepStrictEqual(bare.incomplete, { reason: 'timeBudget', timeBudgetMs: null, rules: ['image-alt'] });
  assert.strictEqual(bare.message, 'The scan was cut short: its time budget ran out, and 1 rule ("image-alt") did not run. That rule checked nothing.');
});

test('formatFailures(result): no findings in a scan cut short says so of what was scanned', () => {
  assert.match(
    formatFailures(result({
      engine: { version: '1.18.0', incomplete: { reason: 'timeBudget', timeBudgetMs: 1, rulesNotRun: 1 } },
      notRun: [{ ruleId: 'image-alt', reason: 'timeBudget' }]
    })),
    /^No accessibility violations found in what was scanned\.\n\nThe scan was cut short: /
  );
});
