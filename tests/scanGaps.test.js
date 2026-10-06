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
