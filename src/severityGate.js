'use strict';

// Severities from least to most severe. A gate at one level counts failing
// rules of that level and above, as the CLI's --fail-on-severity does.
const SEVERITIES = ['minor', 'moderate', 'serious', 'critical'];

function severityRank(severity) {
  return SEVERITIES.indexOf(String(severity || '').toLowerCase());
}

/**
 * The level a `failOnSeverity` option names, lower-cased, or null for no
 * gate (undefined or null). Throws a TypeError for anything else, naming the
 * four severities. `where` names the caller in the message.
 */
function readFailOnSeverity(value, where = 'failOnSeverity') {
  if (value === undefined || value === null) return null;
  const level = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SEVERITIES.includes(level)) {
    throw new TypeError(
      `${where} must be "critical", "serious", "moderate" or "minor", not ${JSON.stringify(value)}.`
    );
  }
  return level;
}

/** Whether a failing rule of `severity` counts for a gate at `level` (null: every one does). */
function countsForGate(severity, level) {
  if (!level) return true;
  return severityRank(severity) >= severityRank(level);
}

/**
 * The failing rules that fail a test: every rule result with outcome `fail`,
 * or, with `failOnSeverity`, only those whose severity is that level or
 * above (critical > serious > moderate > minor). The severity is the rule
 * result's own, which a profile can set; the same failures
 * `surea11y scan --fail-on-severity` counts for the same page. `fail` keeps
 * its meaning: the option only picks which failures stop the test, and
 * every failure is still in the result.
 *
 * @param {object|Array<object>} input one scan result, or its checksResults
 * @param {{ failOnSeverity?: 'critical'|'serious'|'moderate'|'minor' }} [opts]
 * @returns {Array<object>} the gating rule results, in the result's order
 */
function getGatingFailures(input, { failOnSeverity } = {}) {
  const checks = Array.isArray(input) ? input : input && input.checksResults;
  if (!Array.isArray(checks)) {
    throw new TypeError(
      'getGatingFailures(): expected a scan result or its checksResults array; ' +
      'for a frames(true) scan, pass topFrame and each scanned frame on its own.'
    );
  }
  const level = readFailOnSeverity(failOnSeverity, 'getGatingFailures(): failOnSeverity');
  return checks.filter((c) => c && c.outcome === 'fail' && countsForGate(c.severity, level));
}

module.exports = { SEVERITIES, readFailOnSeverity, countsForGate, getGatingFailures };
