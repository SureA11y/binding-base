'use strict';

const { formatOccurrenceLocation } = require('./shadowDom');
const { getScanGaps } = require('./scanGaps');
const { getScanNotes } = require('./scanNotes');
const { readFailOnSeverity, countsForGate } = require('./severityGate');
const { VALID_OUTCOMES, occurrenceOutcome, reviewGroupOf, REVIEW_ORDER } = require('./review');

const NO_FINDINGS = 'No accessibility violations found.';
const NO_FINDINGS_IN_SCANNED = 'No accessibility violations found in what was scanned.';

/**
 * Turns surea11y's results into a short, human-readable block -- one entry
 * per occurrence, not per rule, since a single rule can flag several
 * elements. Meant to be handed to an assertion library's own
 * failure-message parameter, e.g. (shape varies slightly per binding, see
 * that binding's own README):
 *
 *   const results = await new A11yCoreBuilder({ page }).reportOnly(['fail']).analyze();
 *   assert.strictEqual(results.checksResults.length, 0, formatFailures(results));
 *
 * Deliberately a plain function, not a custom `expect` matcher -- it has no
 * dependency on any particular assertion library (node:assert, Jest, Vitest,
 * Chai, or a hand-rolled `if`/`throw` all work the same way). Identical
 * across every surea11y binding (Playwright/Puppeteer/Selenium/WebdriverIO/
 * Cypress) -- this is exactly the kind of framework-agnostic duplication
 * @surea11y/binding-base exists to hold in one place. See this package's
 * README.md.
 *
 * Each occurrence is read by its own outcome (`occurrenceOutcome` where the
 * rule gives one), since a rule's findings can sit in different tiers: a
 * failing rule's questions are questions. They come in the order a review
 * takes, as core's HTML report groups them: failures, then the questions
 * that lean fail, those that lean pass, and those only a person can answer
 * (a lean, @surea11y/core 1.14.0 and later). A question says which way it
 * leans and why, what could make that wrong, and what would settle it; with
 * `howToCheck: true`, also the steps that answer it.
 *
 * An occurrence inside a shadow tree is located through its shadow hosts,
 * as `my-app >>> my-card >>> img` (see formatOccurrenceLocation()). One
 * pictured by `.screenshots({ dir })` names its file below that.
 *
 * Given a whole scan result rather than its checksResults, it also says
 * what the scan left out (getScanGaps(): a scope that matched nothing,
 * custom rules that did not run), so such a scan does not read as clean,
 * then its notes (getScanNotes(): forced colors, the hooks that would have
 * let the engine read more), and ends with the @surea11y/core release that
 * produced the result (`engine.version`, 1.10.0 and later) for a bug report
 * to quote.
 *
 * @param {object|Array<object>} input one scan result, or its checksResults
 *   array (or any subset of it, e.g. already passed through .reportOnly())
 *   -- see surea11y's docs/OUTPUT_SCHEMA.md for the shape. For a
 *   frames(true) scan, format `topFrame` and each frame on its own.
 * @param {{ outcomes?: string[], howToCheck?: boolean, failOnSeverity?: string, hookReasonCodes?: object }} [opts]
 *   `outcomes`: which occurrences to include, by their own outcome
 *   (`'fail'`, `'cantTell'`, or `'pass'`/`'notApplicable'` for the rare
 *   occurrence such a rule carries) or by their review group among the
 *   questions (`'leanFail'`, `'leanPass'`, `'open'`; `'cantTell'` is all
 *   three). Defaults to ['fail', 'cantTell'] -- the outcomes that report
 *   something found. A `notApplicable` rule may still carry one occurrence
 *   saying why it had nothing to judge, which is not a finding and stays out
 *   by default; see OUTPUT_SCHEMA.md's note on occurrences. Anything else
 *   throws a TypeError. `howToCheck`: list each question's steps
 *   (`howToCheck`, which analyze() adds with core 1.14.0 and later).
 *   `failOnSeverity` (as getGatingFailures() takes it): a failure below
 *   that level is still listed, marked as one that doesn't fail the test.
 *   `hookReasonCodes`: core's HOOK_REASON_CODES, for the hook notes where
 *   this package can't load core (a browser bundle), as getScanNotes() takes
 *   them.
 * @returns {string}
 */
function formatFailures(input, opts = {}) {
  const { outcomes = ['fail', 'cantTell'], howToCheck = false, failOnSeverity, hookReasonCodes = null } = opts || {};
  const wanted = validOutcomes(outcomes);
  const level = readFailOnSeverity(failOnSeverity, 'formatFailures(): failOnSeverity');
  if (Array.isArray(input)) return formatChecks(input, wanted, howToCheck, level) || NO_FINDINGS;
  if (!input || typeof input !== 'object' || !Array.isArray(input.checksResults)) {
    throw new TypeError(
      'formatFailures(): expected a scan result or its checksResults array; ' +
      'for a frames(true) scan, pass topFrame and each scanned frame on its own.'
    );
  }

  const findings = formatChecks(input.checksResults, wanted, howToCheck, level);
  const gaps = getScanGaps(input);
  const blocks = [];
  if (findings) blocks.push(findings);
  else if (!gaps.length) blocks.push(NO_FINDINGS);
  else if (!gaps.some((g) => g.kind === 'context-not-found')) blocks.push(NO_FINDINGS_IN_SCANNED);
  if (gaps.length) blocks.push(gaps.map((g) => g.message).join('\n'));
  const notes = getScanNotes(input, { hookReasonCodes });
  if (notes.length) blocks.push(notes.map((n) => n.message).join('\n'));
  const version = input.engine && typeof input.engine.version === 'string' ? input.engine.version : null;
  if (version) blocks.push(`Scanned with @surea11y/core ${version}.`);
  return blocks.join('\n\n');
}

// What `outcomes` may name: an outcome, or a review group among the questions.
const OUTCOME_NAMES = VALID_OUTCOMES.concat(['leanFail', 'leanPass', 'open']);

function validOutcomes(outcomes) {
  const list = Array.isArray(outcomes) ? outcomes : [outcomes];
  for (const name of list) {
    if (!OUTCOME_NAMES.includes(name)) {
      throw new TypeError(`formatFailures(): outcomes may be ${OUTCOME_NAMES.map((o) => `'${o}'`).join(', ')}, not ${JSON.stringify(name)}.`);
    }
  }
  return list;
}

// Whether an occurrence (or a rule with none, `occurrence` null) is one the
// caller asked for: by its own tier and review group, or, for a rule that
// neither fails nor asks, by the rule's outcome.
function isWanted(check, occurrence, wanted) {
  const group = reviewGroupOf(check, occurrence);
  if (!group) return wanted.includes(check.outcome);
  return wanted.includes(group) || wanted.includes(occurrenceOutcome(check, occurrence));
}

// The rank of an entry in a review: failures, likely failures, likely
// passes, open questions, then a pass or notApplicable rule's occurrences.
function rankOf(check, occurrence) {
  const i = REVIEW_ORDER.indexOf(reviewGroupOf(check, occurrence));
  return i === -1 ? REVIEW_ORDER.length : i;
}

const GROUP_LABELS = { leanFail: 'likely fails', leanPass: 'likely passes', open: 'needs review' };

// The severity, and for a failure below the gate's level, that it doesn't
// fail the test; it is still listed.
function severityLabel(check, level) {
  return check.outcome === 'fail' && !countsForGate(check.severity, level)
    ? `${check.severity}, below failOnSeverity ${level}, does not fail the test`
    : check.severity;
}

function headLine(n, check, occurrence, text, level) {
  const label = GROUP_LABELS[reviewGroupOf(check, occurrence)];
  const tag = label ? `${check.severity}, ${label}` : severityLabel(check, level);
  return `${n}) ${check.ruleId} (${tag}): ${text}`;
}

// How often a lean of its kind was right where core counted it against
// cases with known answers (lean.measured, @surea11y/core 1.14.0 and later).
function measuredText(m) {
  if (!m || !Number.isInteger(m.agreed) || !Number.isInteger(m.cases) || m.cases < 1) return '';
  return ` (right in ${m.agreed} of ${m.cases} ${m.cases === 1 ? 'known case' : 'known cases'})`;
}

// What a question says beyond its summary: which way it leans and why, what
// could make that wrong, what would settle it, and, when asked, the steps.
function questionLines(check, occurrence, howToCheck) {
  const lines = [];
  const group = reviewGroupOf(check, occurrence);
  if (group !== 'leanFail' && group !== 'leanPass' && group !== 'open') return lines;
  const lean = occurrence.lean || {};
  if (group !== 'open' && typeof lean.why === 'string' && lean.why) {
    lines.push(`   ${group === 'leanFail' ? 'Why it likely fails' : 'Why it likely passes'}: ${lean.why}${measuredText(lean.measured)}`);
  }
  if (group !== 'open' && typeof lean.caution === 'string' && lean.caution) lines.push(`   Caution: ${lean.caution}`);
  const needed = occurrence.uncertainty && occurrence.uncertainty.needed;
  if (typeof needed === 'string' && needed) lines.push(`   To settle it: ${needed}`);
  const how = howToCheck ? occurrence.howToCheck : null;
  if (how && Array.isArray(how.steps) && how.steps.length) {
    lines.push('   How to check:');
    how.steps.forEach((step, i) => lines.push(`     ${i + 1}. ${step}`));
    if (typeof how.passWhen === 'string' && how.passWhen) lines.push(`   Passes when: ${how.passWhen}`);
    if (typeof how.failWhen === 'string' && how.failWhen) lines.push(`   Fails when: ${how.failWhen}`);
  }
  return lines;
}

function formatChecks(checksResults, wanted, howToCheck, level) {
  const entries = [];
  for (const check of checksResults) {
    if (!check || typeof check !== 'object') continue;
    const occurrences = Array.isArray(check.occurrences) ? check.occurrences : [];
    if (!occurrences.length) {
      // A thrown rule surfaces as outcome: "cantTell" with occurrences: []
      // and error set to the exception message (see OUTPUT_SCHEMA.md) --
      // still worth surfacing rather than silently dropping.
      if (wanted.includes(check.outcome) || (check.outcome === 'cantTell' && wanted.includes('open'))) {
        entries.push({ check, occurrence: null, rank: rankOf(check, null) });
      }
      continue;
    }
    for (const occurrence of occurrences) {
      if (occurrence && isWanted(check, occurrence, wanted)) {
        entries.push({ check, occurrence, rank: rankOf(check, occurrence) });
      }
    }
  }
  // Array.prototype.sort is stable: within a group, the scan's own order.
  entries.sort((a, b) => a.rank - b.rank);

  const lines = [];
  entries.forEach(({ check, occurrence }, i) => {
    const n = i + 1;
    if (!occurrence) {
      lines.push(`${n}) ${check.ruleId} (${severityLabel(check, level)}): ${check.error || check.title}`);
      return;
    }
    lines.push(headLine(n, check, occurrence, occurrence.summary, level));
    const location = formatOccurrenceLocation(occurrence);
    if (location) lines.push(`   at ${location}`);
    // Scanned under conditions (.conditions()): where it was found.
    if (Array.isArray(occurrence.conditions) && occurrence.conditions.length) {
      lines.push(`   seen in: ${occurrence.conditions.join(', ')}`);
    }
    if (occurrence.hint) lines.push(`   ${occurrence.hint}`);
    lines.push(...questionLines(check, occurrence, howToCheck));
    // A picture written to a file by .screenshots({ dir }); one held as a
    // buffer, or skipped, has nothing to point to.
    const shot = occurrence.screenshot;
    if (shot && typeof shot.path === 'string' && shot.path) lines.push(`   screenshot: ${shot.path}`);
  });
  return lines.join('\n');
}

module.exports = { formatFailures };
