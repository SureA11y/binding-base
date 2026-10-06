'use strict';

function quoteList(values) {
  return values.map((v) => JSON.stringify(String(v))).join(', ');
}

/**
 * What a scan result says it left out, which its checksResults alone would
 * pass over as clean. Reads fields @surea11y/core added in 1.10.0; a result
 * from an earlier release has none of them and gives [].
 *
 * - `context-not-found`: the contextSelector (include()) matched no element,
 *   so nothing was scanned and every rule reports notApplicable.
 * - `context-partly-not-found`: some of several include() selectors matched
 *   nothing; the others were scanned.
 * - `custom-rule-skipped`: a custom rule (withCustomRules()) did not run,
 *   one gap per rule, with the engine's reason.
 *
 * @param {object} result one scan result (for a frames(true) scan, call it
 *   on `topFrame` and on each entry of `frames` that has `checksResults`)
 * @returns {Array<{ kind: string, message: string, selectors?: string[], rule?: { id: (string|null), reason: string } }>}
 */
function getScanGaps(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.checksResults)) {
    throw new TypeError(
      'getScanGaps(): expected one scan result (an object with a checksResults array); ' +
      'for a frames(true) scan, pass topFrame and each scanned frame on its own.'
    );
  }
  const gaps = [];

  const match = result.contextMatch;
  if (match && typeof match === 'object') {
    const unmatched = Array.isArray(match.unmatchedSelectors) ? match.unmatchedSelectors : [];
    if (match.elementCount === 0) {
      gaps.push({
        kind: 'context-not-found',
        selectors: unmatched,
        message: 'Nothing was scanned: the scan scope matched no element' + (unmatched.length ? ` (${quoteList(unmatched)})` : '') + '.'
      });
    } else if (unmatched.length) {
      gaps.push({
        kind: 'context-partly-not-found',
        selectors: unmatched,
        message: `Part of the scan scope was not scanned: no element matched ${quoteList(unmatched)}.`
      });
    }
  }

  const skipped = Array.isArray(result.skippedCustomRules) ? result.skippedCustomRules : [];
  for (const rule of skipped) {
    const id = rule && typeof rule.id === 'string' && rule.id ? rule.id : null;
    const reason = rule && rule.reason ? String(rule.reason) : 'no reason given';
    gaps.push({
      kind: 'custom-rule-skipped',
      rule: { id, reason },
      message: `Custom rule ${id ? JSON.stringify(id) : 'without an id'} did not run: ${reason}.`
    });
  }

  return gaps;
}

module.exports = { getScanGaps };
