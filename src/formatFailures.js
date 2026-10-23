'use strict';

const { formatOccurrenceLocation } = require('./shadowDom');
const { getScanGaps } = require('./scanGaps');
const { getScanNotes } = require('./scanNotes');
const { readFailOnSeverity, countsForGate } = require('./severityGate');

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
 * An occurrence inside a shadow tree is located through its shadow hosts,
 * as `my-app >>> my-card >>> img` (see formatOccurrenceLocation()). One
 * pictured by `.screenshots({ dir })` names its file below that.
 *
 * Given a whole scan result rather than its checksResults, it also says
 * what the scan left out (getScanGaps(): a scope that matched nothing,
 * custom rules that did not run), so such a scan does not read as clean,
 * then its notes (getScanNotes(): forced colors, custom elements the
 * internals hook would have let the engine read), and ends with the
 * @surea11y/core release that produced the result (`engine.version`,
 * 1.10.0 and later) for a bug report to quote.
 *
 * @param {object|Array<object>} input one scan result, or its checksResults
 *   array (or any subset of it, e.g. already passed through .reportOnly())
 *   -- see surea11y's docs/OUTPUT_SCHEMA.md for the shape. For a
 *   frames(true) scan, format `topFrame` and each frame on its own.
 * @param {{ outcomes?: string[], failOnSeverity?: string }} [opts] Which
 *   outcomes to include. Defaults to ['fail', 'cantTell'] -- the outcomes
 *   that report something found. A `notApplicable` rule may still carry one
 *   occurrence saying why it had nothing to judge, which is not a finding
 *   and stays out by default; see OUTPUT_SCHEMA.md's note on occurrences.
 *   With `failOnSeverity` (as getGatingFailures() takes it), a failure below
 *   that level is still listed, marked as one that doesn't fail the test.
 * @returns {string}
 */
function formatFailures(input, { outcomes = ['fail', 'cantTell'], failOnSeverity } = {}) {
  const level = readFailOnSeverity(failOnSeverity, 'formatFailures(): failOnSeverity');
  if (Array.isArray(input)) return formatChecks(input, outcomes, level) || NO_FINDINGS;
  if (!input || typeof input !== 'object' || !Array.isArray(input.checksResults)) {
    throw new TypeError(
      'formatFailures(): expected a scan result or its checksResults array; ' +
      'for a frames(true) scan, pass topFrame and each scanned frame on its own.'
    );
  }

  const findings = formatChecks(input.checksResults, outcomes, level);
  const gaps = getScanGaps(input);
  const blocks = [];
  if (findings) blocks.push(findings);
  else if (!gaps.length) blocks.push(NO_FINDINGS);
  else if (!gaps.some((g) => g.kind === 'context-not-found')) blocks.push(NO_FINDINGS_IN_SCANNED);
  if (gaps.length) blocks.push(gaps.map((g) => g.message).join('\n'));
  const notes = getScanNotes(input);
  if (notes.length) blocks.push(notes.map((n) => n.message).join('\n'));
  const version = input.engine && typeof input.engine.version === 'string' ? input.engine.version : null;
  if (version) blocks.push(`Scanned with @surea11y/core ${version}.`);
  return blocks.join('\n\n');
}

function formatChecks(checksResults, outcomes, level) {
  const relevant = checksResults.filter((r) => outcomes.includes(r.outcome));
  // A failing rule below the gate's level: listed, and marked.
  const label = (check) =>
    check.outcome === 'fail' && !countsForGate(check.severity, level)
      ? `${check.severity}, below failOnSeverity ${level}, does not fail the test`
      : check.severity;

  const lines = [];
  let n = 0;
  for (const check of relevant) {
    if (!check.occurrences.length) {
      // A thrown rule surfaces as outcome: "cantTell" with occurrences: []
      // and error set to the exception message (see OUTPUT_SCHEMA.md) --
      // still worth surfacing rather than silently dropping.
      n += 1;
      lines.push(`${n}) ${check.ruleId} (${label(check)}): ${check.error || check.title}`);
      continue;
    }
    for (const occurrence of check.occurrences) {
      n += 1;
      lines.push(`${n}) ${check.ruleId} (${label(check)}): ${occurrence.summary}`);
      const location = formatOccurrenceLocation(occurrence);
      if (location) lines.push(`   at ${location}`);
      if (occurrence.hint) lines.push(`   ${occurrence.hint}`);
      // A picture written to a file by .screenshots({ dir }); one held as a
      // buffer, or skipped, has nothing to point to.
      const shot = occurrence.screenshot;
      if (shot && typeof shot.path === 'string' && shot.path) lines.push(`   screenshot: ${shot.path}`);
    }
  }
  return lines.join('\n');
}

module.exports = { formatFailures };
