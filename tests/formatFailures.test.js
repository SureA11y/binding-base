'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { formatFailures } = require('../src/index.js');

test('formatFailures(): returns a fixed message when there are no violations', () => {
  assert.strictEqual(formatFailures([]), 'No accessibility violations found.');
  assert.strictEqual(
    formatFailures([{ ruleId: 'img-alt-present', outcome: 'pass', occurrences: [] }]),
    'No accessibility violations found.'
  );
});

test('formatFailures(): formats one line block per occurrence, numbered, with rule/severity/selector/hint', () => {
  const checksResults = [
    {
      ruleId: 'img-alt-present',
      outcome: 'fail',
      severity: 'serious',
      occurrences: [
        { selector: 'html > body > img', summary: 'Missing alt attribute on <img>.', hint: 'Add an alt attribute.' }
      ]
    }
  ];

  assert.strictEqual(
    formatFailures(checksResults),
    '1) img-alt-present (serious): Missing alt attribute on <img>.\n' +
    '   at html > body > img\n' +
    '   Add an alt attribute.'
  );
});

test('formatFailures(): numbers occurrences across multiple rules and multiple occurrences of the same rule', () => {
  const checksResults = [
    {
      ruleId: 'img-alt-present',
      outcome: 'fail',
      severity: 'serious',
      occurrences: [
        { selector: '#a img', summary: 'Missing alt.', hint: 'Add alt.' },
        { selector: '#b img', summary: 'Missing alt.', hint: 'Add alt.' }
      ]
    },
    {
      ruleId: 'button-name-present',
      outcome: 'fail',
      severity: 'serious',
      occurrences: [{ selector: 'html > body > button', summary: 'No accessible name.', hint: 'Add a label.' }]
    }
  ];

  const output = formatFailures(checksResults);
  assert.ok(output.startsWith('1) img-alt-present'));
  assert.ok(output.includes('2) img-alt-present'));
  assert.ok(output.includes('3) button-name-present'));
});

test('formatFailures(): ignores pass/notApplicable entries and respects a custom outcomes filter', () => {
  const checksResults = [
    { ruleId: 'a', outcome: 'pass', occurrences: [] },
    { ruleId: 'b', outcome: 'notApplicable', occurrences: [] },
    {
      ruleId: 'c',
      outcome: 'cantTell',
      severity: 'moderate',
      occurrences: [{ selector: 'html > body', summary: 'Needs human review.', hint: 'Check manually.' }]
    }
  ];

  // Default outcomes (['fail', 'cantTell']) picks up the cantTell entry.
  assert.ok(formatFailures(checksResults).includes('c'));

  // Narrowing to just 'fail' drops it, since there's no fail entry here.
  assert.strictEqual(formatFailures(checksResults, { outcomes: ['fail'] }), 'No accessibility violations found.');
});

test('formatFailures(): surfaces a thrown rule (occurrences: [], error set) instead of silently dropping it', () => {
  const checksResults = [
    {
      ruleId: 'broken-rule',
      outcome: 'cantTell',
      severity: 'serious',
      title: 'A rule that threw',
      occurrences: [],
      error: 'TypeError: something exploded'
    }
  ];

  const output = formatFailures(checksResults);
  assert.strictEqual(output, '1) broken-rule (serious): TypeError: something exploded');
});

// A rule's findings can sit in different tiers (occurrenceOutcome), and a
// question can lean (lean.toward, @surea11y/core 1.14.0 and later).
const LEAN_FAIL = { toward: 'fail', why: 'The heading skips a level.', caution: 'A level can be skipped in a widget.' };
const MIXED = [
  {
    ruleId: 'open-rule',
    outcome: 'cantTell',
    severity: 'minor',
    occurrences: [{ selector: 'a', summary: 'Is the link name clear?', uncertainty: { code: 'judgement-required', needed: 'Whether the name says where it goes.' } }]
  },
  {
    ruleId: 'tiered-rule',
    outcome: 'fail',
    severity: 'serious',
    occurrences: [
      { selector: '#q', summary: 'Asked.', occurrenceOutcome: 'cantTell', lean: { toward: 'pass', why: 'Browsers ignore it.' } },
      { selector: '#f', summary: 'Failed.', occurrenceOutcome: 'fail' }
    ]
  },
  {
    ruleId: 'heading-order',
    outcome: 'cantTell',
    severity: 'moderate',
    occurrences: [
      {
        selector: 'h3',
        summary: 'The heading skips a level.',
        lean: LEAN_FAIL,
        howToCheck: { steps: ['Find the heading.', 'Compare its level.'], passWhen: 'It follows on.', failWhen: 'It skips a level.' }
      }
    ]
  }
];

test('formatFailures(): reads each occurrence by its own tier, in the order a review takes', () => {
  assert.strictEqual(
    formatFailures(MIXED),
    '1) tiered-rule (serious): Failed.\n' +
    '   at #f\n' +
    '2) heading-order (moderate, likely fails): The heading skips a level.\n' +
    '   at h3\n' +
    '   Why it likely fails: The heading skips a level.\n' +
    '   Caution: A level can be skipped in a widget.\n' +
    '3) tiered-rule (serious, likely passes): Asked.\n' +
    '   at #q\n' +
    '   Why it likely passes: Browsers ignore it.\n' +
    '4) open-rule (minor, needs review): Is the link name clear?\n' +
    '   at a\n' +
    '   To settle it: Whether the name says where it goes.'
  );
  // A failing rule's question is not a failure.
  assert.strictEqual(formatFailures(MIXED, { outcomes: ['fail'] }), '1) tiered-rule (serious): Failed.\n   at #f');
});

test('formatFailures(): outcomes can name a review group, and howToCheck lists the steps', () => {
  assert.strictEqual(
    formatFailures(MIXED, { outcomes: ['fail', 'leanFail'], howToCheck: true }),
    '1) tiered-rule (serious): Failed.\n' +
    '   at #f\n' +
    '2) heading-order (moderate, likely fails): The heading skips a level.\n' +
    '   at h3\n' +
    '   Why it likely fails: The heading skips a level.\n' +
    '   Caution: A level can be skipped in a widget.\n' +
    '   How to check:\n' +
    '     1. Find the heading.\n' +
    '     2. Compare its level.\n' +
    '   Passes when: It follows on.\n' +
    '   Fails when: It skips a level.'
  );
  assert.match(formatFailures(MIXED, { outcomes: ['leanPass'] }), /^1\) tiered-rule \(serious, likely passes\): Asked\./);
  assert.match(formatFailures(MIXED, { outcomes: ['open'] }), /^1\) open-rule/);
  assert.strictEqual(formatFailures(MIXED, { outcomes: ['cantTell'] }).match(/^\d\)/gm).length, 3);
  // A thrown rule is an open question.
  const thrown = [{ ruleId: 'broken', outcome: 'cantTell', severity: 'minor', occurrences: [], error: 'boom' }];
  assert.strictEqual(formatFailures(thrown, { outcomes: ['open'] }), '1) broken (minor): boom');
  assert.strictEqual(formatFailures(thrown, { outcomes: ['leanFail'] }), 'No accessibility violations found.');
});

test('formatFailures(): an outcome it does not know throws, rather than quietly listing nothing', () => {
  assert.throws(() => formatFailures(MIXED, { outcomes: ['failed'] }), (e) => e instanceof TypeError && /"failed"/.test(e.message));
  assert.throws(() => formatFailures(MIXED, { outcomes: 'likelyFail' }), TypeError);
});
