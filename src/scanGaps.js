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

// At most this many rule ids or style sheets are named in a message; the
// gap's own lists hold every one.
const NAMED_IN_MESSAGE = 5;

function namedList(values) {
  const named = quoteList(values.slice(0, NAMED_IN_MESSAGE));
  const more = values.length - NAMED_IN_MESSAGE;
  return more > 0 ? `${named} and ${more} more` : named;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// The gap of a scan its time budget (engineOptions.timeBudgetMs, core 1.18.0
// and later) cut short: the rules it did not start (`notRun`, each id once,
// though a scan of several profiles lists one per profile) and the style
// sheets the browser bundle had not read (`engine.incomplete.styleSheetsNotRead`).
// Profiles left unstarted are profile-not-run gaps of their own.
function scanIncomplete(result) {
  const incomplete =
    result.engine && result.engine.incomplete && typeof result.engine.incomplete === 'object'
      ? result.engine.incomplete
      : null;
  const notRun = Array.isArray(result.notRun) ? result.notRun : [];
  if (!incomplete && !notRun.length) return null;
  const rules = [];
  for (const entry of notRun) {
    const id = entry && typeof entry.ruleId === 'string' && entry.ruleId ? entry.ruleId : null;
    if (id && !rules.includes(id)) rules.push(id);
  }
  const styleSheets =
    incomplete && Array.isArray(incomplete.styleSheetsNotRead)
      ? incomplete.styleSheetsNotRead.filter((href) => typeof href === 'string' && href)
      : [];
  const reason =
    (incomplete && typeof incomplete.reason === 'string' && incomplete.reason) ||
    (notRun.find((e) => e && typeof e.reason === 'string' && e.reason) || {}).reason ||
    'timeBudget';
  const budget = incomplete && typeof incomplete.timeBudgetMs === 'number' ? incomplete.timeBudgetMs : null;

  const missed = [];
  if (rules.length) missed.push(`${plural(rules.length, 'rule', 'rules')} (${namedList(rules)}) did not run`);
  if (styleSheets.length) {
    missed.push(
      `${plural(styleSheets.length, 'style sheet', 'style sheets')} (${namedList(styleSheets)}) ${styleSheets.length === 1 ? 'was' : 'were'} not read`
    );
  }
  const why =
    reason === 'timeBudget'
      ? `its time budget${budget !== null ? ` of ${budget} ms` : ''} ran out`
      : `it stopped early (${reason})`;
  return {
    kind: 'scan-incomplete',
    incomplete: {
      reason,
      timeBudgetMs: budget,
      rules,
      ...(styleSheets.length ? { styleSheetsNotRead: styleSheets } : {})
    },
    message:
      `The scan was cut short: ${why}` +
      (missed.length ? `, and ${missed.join('; ')}` : '') +
      '.' +
      (rules.length ? ` ${rules.length === 1 ? 'That rule' : 'Those rules'} checked nothing.` : '')
  };
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
 *   `pack-skipped`, `overridden-by-selection`, and since 1.18.0 `timeBudget`):
 *   it counted less than it was asked to.
 * - `scan-incomplete`: the scan's time budget (options({ timeBudgetMs }),
 *   @surea11y/core 1.18.0 and later) ran out before every rule had started,
 *   one gap for the scan, listing each rule that did not run (`notRun`, by
 *   id) and, from the browser bundle, the style sheets not read. Such a
 *   result is never a clean one.
 *
 * @param {object} result one scan result (for a frames(true) scan, call it
 *   on `topFrame` and on each entry of `frames` that has `checksResults`)
 * @returns {Array<{ kind: string, message: string, selectors?: string[], rule?: { id: (string|null), reason: string }, pack?: { name: (string|null), reason: string }, profile?: { name: string, reason: string }, incomplete?: { reason: string, timeBudgetMs: (number|null), rules: string[], styleSheetsNotRead?: string[] } }>}
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
    timeBudget: "the scan's time budget ran out before it started",
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

  const incomplete = scanIncomplete(result);
  if (incomplete) gaps.push(incomplete);

  return gaps;
}

module.exports = { getScanGaps };
