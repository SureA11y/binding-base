'use strict';

// How @surea11y/core's reporters read an occurrence, here for formatFailures()
// and the scan notes. Core exports the same two functions
// (occurrenceOutcome and reviewGroupOf, 1.14.0 and later, also from its
// browser-safe @surea11y/core/how-to-check), but this package can't require
// core where a bundler would follow it, so they are restated here and
// checked against core's in tests/core-contract.test.js.

// See surea11y's docs/OUTPUT_SCHEMA.md -- the only valid `outcome` values a
// checksResults entry can carry.
const VALID_OUTCOMES = ['pass', 'fail', 'cantTell', 'notApplicable'];

// An occurrence's own tier (occurrenceOutcome, or the outcome an older
// label-in-name wrote) when it is fail or cantTell, or else its check's
// outcome when that is; null otherwise. A rule's findings can sit in
// different tiers, so a check's outcome alone puts its questions with its
// failures.
function occurrenceOutcome(check, occurrence) {
  if (occurrence && typeof occurrence === 'object') {
    for (const tier of [occurrence.occurrenceOutcome, occurrence.outcome]) {
      if (tier === 'fail' || tier === 'cantTell') return tier;
    }
  }
  return check && (check.outcome === 'fail' || check.outcome === 'cantTell') ? check.outcome : null;
}

// Where an occurrence goes in a review, as core's HTML report groups it:
// 'fail'; for a question, 'leanFail' or 'leanPass' where its lean points
// that way (@surea11y/core 1.14.0 and later), else 'open'; null for neither.
function reviewGroupOf(check, occurrence) {
  const outcome = occurrenceOutcome(check, occurrence);
  if (outcome !== 'cantTell') return outcome;
  const toward = occurrence && occurrence.lean && occurrence.lean.toward;
  if (toward === 'fail') return 'leanFail';
  if (toward === 'pass') return 'leanPass';
  return 'open';
}

// The order a review takes: failures, then likely failures, likely passes,
// and the questions only a person can answer.
const REVIEW_ORDER = ['fail', 'leanFail', 'leanPass', 'open'];

// An occurrence's reason code, in data.details, or in details on a result
// read back from an older shape; null without one.
function reasonCodeOf(occurrence) {
  const data = occurrence && occurrence.data;
  const details = (data && data.details) || (occurrence && occurrence.details);
  return details && typeof details.reasonCode === 'string' ? details.reasonCode : null;
}

module.exports = { VALID_OUTCOMES, occurrenceOutcome, reviewGroupOf, REVIEW_ORDER, reasonCodeOf };
