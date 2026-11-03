'use strict';

// The reason @surea11y/core gives a custom rule the selection's excludes
// left out. 1.12.0 also marks such an entry `excluded: true`; a core between
// the two gave the reason alone.
const EXCLUDED_REASON = 'excluded by the selection.';

function isExcluded(rule) {
  return !!rule && (rule.excluded === true || rule.reason === EXCLUDED_REASON);
}

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
 *   one gap per rule, with the engine's reason. A rule the caller excluded
 *   (disableRules(), disableTags()), which core lists with `excluded: true`,
 *   is left out: nothing the caller asked for was skipped.
 * - `pack-skipped`: a pack (withPacks(), @surea11y/core 1.11 and later) did
 *   not run, one gap per pack, with the engine's reason.
 * - `profile-not-run`: a scan of several profiles (options({ profile: [...] }),
 *   @surea11y/core 1.15 and later) did not judge the page by one of them,
 *   one gap per profile, with the engine's reason (`unknown-profile`,
 *   `pack-skipped`, `overridden-by-selection`): it counted less than it was
 *   asked to.
 *
 * @param {object} result one scan result (for a frames(true) scan, call it
 *   on `topFrame` and on each entry of `frames` that has `checksResults`)
 * @returns {Array<{ kind: string, message: string, selectors?: string[], rule?: { id: (string|null), reason: string }, pack?: { name: (string|null), reason: string }, profile?: { name: string, reason: string } }>}
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
    if (isExcluded(rule)) continue;
    const id = rule && typeof rule.id === 'string' && rule.id ? rule.id : null;
    const reason = rule && rule.reason ? String(rule.reason) : 'no reason given';
    gaps.push({
      kind: 'custom-rule-skipped',
      rule: { id, reason },
      message: `Custom rule ${id ? JSON.stringify(id) : 'without an id'} did not run: ${reason}.`
    });
  }

  const skippedPacks = Array.isArray(result.skippedPacks) ? result.skippedPacks : [];
  for (const pack of skippedPacks) {
    const name = pack && typeof pack.name === 'string' && pack.name ? pack.name : null;
    const reason = pack && pack.reason ? String(pack.reason) : 'no reason given';
    gaps.push({
      kind: 'pack-skipped',
      pack: { name, reason },
      message: `Pack ${name ? JSON.stringify(name) : 'without a name'} did not run: ${reason}.`
    });
  }

  const notRun =
    result.engine && Array.isArray(result.engine.profilesNotRun) ? result.engine.profilesNotRun : [];
  // Whether the scan was given packs: those that ran, or were skipped.
  const hadPacks =
    (result.engine && Array.isArray(result.engine.packs) && result.engine.packs.length > 0) ||
    skippedPacks.length > 0;
  const REASONS = {
    'unknown-profile': hadPacks
      ? 'no such profile in core or the packs given'
      : "no such profile in core (a pack's profile needs its pack)",
    'pack-skipped': 'its pack did not run',
    'overridden-by-selection': 'the rules chosen in runOnly, or by rules, tags or tests in the engine options, select the rules instead'
  };
  for (const p of notRun) {
    const profile = p && typeof p.profile === 'string' && p.profile.trim() ? p.profile.trim() : null;
    // An entry naming no profile says nothing a person could act on: core
    // never writes one, so it is left out rather than reported as a gap.
    if (!profile) continue;
    const reason = p && p.reason ? String(p.reason) : 'no reason given';
    gaps.push({
      kind: 'profile-not-run',
      profile: { name: profile, reason },
      message: `Profile ${JSON.stringify(profile)} was asked for and did not run: ${REASONS[reason] || reason}.`
    });
  }

  return gaps;
}

module.exports = { getScanGaps };
