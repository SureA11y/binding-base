'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { getGatingFailures, formatFailures, SEVERITIES } = require('../src/index.js');

const result = {
  checksResults: [
    { ruleId: 'img-alt-present', title: 'Images', outcome: 'fail', severity: 'critical', occurrences: [{ selector: 'img', summary: 'No alt.' }] },
    { ruleId: 'color-contrast', title: 'Contrast', outcome: 'fail', severity: 'serious', occurrences: [{ selector: 'p', summary: 'Low contrast.' }] },
    { ruleId: 'aria-allowed-attr', title: 'ARIA', outcome: 'fail', severity: 'moderate', occurrences: [{ selector: 'div', summary: 'Not allowed.' }] },
    { ruleId: 'empty-heading', title: 'Headings', outcome: 'fail', severity: 'minor', occurrences: [{ selector: 'h2', summary: 'Empty.' }] },
    { ruleId: 'region', title: 'Region', outcome: 'cantTell', severity: 'critical', occurrences: [{ selector: 'span', summary: 'Outside.' }] },
    { ruleId: 'page-title-present', title: 'Title', outcome: 'pass', severity: 'serious', occurrences: [] }
  ]
};

const ids = (checks) => checks.map((c) => c.ruleId);

test('SEVERITIES: least to most severe', () => {
  assert.deepStrictEqual(SEVERITIES, ['minor', 'moderate', 'serious', 'critical']);
});

test('getGatingFailures(): every fail without a level, those at or above it with one, never a cantTell', () => {
  assert.deepStrictEqual(ids(getGatingFailures(result)), ['img-alt-present', 'color-contrast', 'aria-allowed-attr', 'empty-heading']);
  assert.deepStrictEqual(ids(getGatingFailures(result, { failOnSeverity: 'serious' })), ['img-alt-present', 'color-contrast']);
  assert.deepStrictEqual(ids(getGatingFailures(result, { failOnSeverity: 'critical' })), ['img-alt-present']);
  assert.deepStrictEqual(ids(getGatingFailures(result, { failOnSeverity: 'minor' })), ids(getGatingFailures(result)));
  assert.deepStrictEqual(ids(getGatingFailures(result.checksResults, { failOnSeverity: 'SERIOUS' })), ['img-alt-present', 'color-contrast']);
});

test('getGatingFailures(): a level that is not a severity, and input that is not a result, throw', () => {
  assert.throws(() => getGatingFailures(result, { failOnSeverity: 'high' }), /failOnSeverity must be "critical", "serious", "moderate" or "minor", not "high"/);
  assert.throws(() => getGatingFailures({ topFrame: result, frames: [] }), TypeError);
  assert.deepStrictEqual(getGatingFailures(result, { failOnSeverity: null }).length, 4);
});

test('formatFailures(): with failOnSeverity, a failure below the level is listed and marked', () => {
  const text = formatFailures(result, { failOnSeverity: 'serious' });
  assert.match(text, /1\) img-alt-present \(critical\): No alt\./);
  assert.match(text, /2\) color-contrast \(serious\): Low contrast\./);
  assert.match(text, /3\) aria-allowed-attr \(moderate, below failOnSeverity serious, does not fail the test\): Not allowed\./);
  assert.match(text, /4\) empty-heading \(minor, below failOnSeverity serious, does not fail the test\): Empty\./);
  // A question is never a failure, so never marked.
  assert.match(text, /5\) region \(critical, needs review\): Outside\./);
  assert.doesNotMatch(formatFailures(result), /below failOnSeverity/);
  assert.throws(() => formatFailures(result, { failOnSeverity: 'blocker' }), TypeError);
});
