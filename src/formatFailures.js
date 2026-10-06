'use strict';

const { formatOccurrenceLocation } = require('./shadowDom');

/**
 * Turns surea11y's checksResults array into a short, human-readable block
 * -- one entry per occurrence, not per rule, since a single rule can flag
 * several elements. Meant to be handed to an assertion library's own
 * failure-message parameter, e.g. (shape varies slightly per binding, see
 * that binding's own README):
 *
 *   const results = await new A11yCoreBuilder({ page }).reportOnly(['fail']).analyze();
 *   assert.strictEqual(results.checksResults.length, 0, formatFailures(results.checksResults));
 *
 * Deliberately a plain function, not a custom `expect` matcher -- it has no
 * dependency on any particular assertion library (node:assert, Jest, Vitest,
 * Chai, or a hand-rolled `if`/`throw` all work the same way).
 *
 * An occurrence inside a shadow tree is located through its shadow hosts,
 * as `my-app >>> my-card >>> img` (see formatOccurrenceLocation()). Identical
 * across every surea11y binding (Playwright/Puppeteer/Selenium/WebdriverIO/
 * Cypress) -- this is exactly the kind of framework-agnostic duplication
 * @surea11y/binding-base exists to hold in one place. See this package's
 * README.md.
 *
 * @param {Array<object>} checksResults surea11y's checksResults array (or
 *   any subset of it, e.g. already passed through .reportOnly()) -- see
 *   surea11y's docs/OUTPUT_SCHEMA.md for the shape.
 * @param {{ outcomes?: string[] }} [opts] Which outcomes to include.
 *   Defaults to ['fail', 'cantTell'] -- the outcomes that report something
 *   found. A `notApplicable` rule may still carry one occurrence saying why
 *   it had nothing to judge, which is not a finding and stays out by
 *   default; see OUTPUT_SCHEMA.md's note on occurrences.
 * @returns {string}
 */
function formatFailures(checksResults, { outcomes = ['fail', 'cantTell'] } = {}) {
  const relevant = checksResults.filter((r) => outcomes.includes(r.outcome));

  const lines = [];
  let n = 0;
  for (const check of relevant) {
    if (!check.occurrences.length) {
      // A thrown rule surfaces as outcome: "cantTell" with occurrences: []
      // and error set to the exception message (see OUTPUT_SCHEMA.md) --
      // still worth surfacing rather than silently dropping.
      n += 1;
      lines.push(`${n}) ${check.ruleId} (${check.severity}): ${check.error || check.title}`);
      continue;
    }
    for (const occurrence of check.occurrences) {
      n += 1;
      lines.push(`${n}) ${check.ruleId} (${check.severity}): ${occurrence.summary}`);
      const location = formatOccurrenceLocation(occurrence);
      if (location) lines.push(`   at ${location}`);
      if (occurrence.hint) lines.push(`   ${occurrence.hint}`);
    }
  }

  return lines.length ? lines.join('\n') : 'No accessibility violations found.';
}

module.exports = { formatFailures };
