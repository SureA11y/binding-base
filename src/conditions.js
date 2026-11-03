'use strict';

const { occurrenceOutcome } = require('./review');

// Scanning a page under conditions: a color scheme and a viewport width, as
// .conditions() takes them, and the merge of the scans into one result.

const COLOR_SCHEMES = ['light', 'dark'];

/**
 * The conditions .conditions() was given, checked: each an object with
 * `colorScheme` ('light' or 'dark'), `width` (a whole number of CSS pixels
 * above 0), or both. Throws a TypeError naming what's wrong. An empty list
 * or null gives null (no conditions).
 */
function readConditions(list, where = 'conditions()') {
  if (list === null || list === undefined) return null;
  if (!Array.isArray(list)) {
    throw new TypeError(`${where}: expected an array of conditions, such as [{ colorScheme: 'dark' }, { width: 320 }].`);
  }
  if (!list.length) return null;
  return list.map((c, i) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      throw new TypeError(`${where}: condition ${i + 1} must be an object, such as { colorScheme: 'dark' } or { width: 320 }.`);
    }
    const unknown = Object.keys(c).filter((k) => k !== 'colorScheme' && k !== 'width');
    if (unknown.length) {
      throw new TypeError(`${where}: condition ${i + 1} has ${unknown.map((k) => `"${k}"`).join(', ')}; a condition takes colorScheme and width.`);
    }
    const out = {};
    if (c.colorScheme !== undefined) {
      const scheme = typeof c.colorScheme === 'string' ? c.colorScheme.trim().toLowerCase() : '';
      if (!COLOR_SCHEMES.includes(scheme)) {
        throw new TypeError(`${where}: colorScheme must be "light" or "dark", not ${JSON.stringify(c.colorScheme)}.`);
      }
      out.colorScheme = scheme;
    }
    if (c.width !== undefined) {
      if (!Number.isInteger(c.width) || c.width <= 0) {
        throw new TypeError(`${where}: width must be a whole number of CSS pixels above 0, not ${JSON.stringify(c.width)}.`);
      }
      out.width = c.width;
    }
    if (!('colorScheme' in out) && !('width' in out)) {
      throw new TypeError(`${where}: condition ${i + 1} is empty; give it colorScheme, width or both.`);
    }
    return out;
  });
}

/** A condition's name, as findings list it: 'dark', 'width 320', 'dark, width 320'. */
function conditionLabel(condition) {
  if (!condition) return 'default';
  return [condition.colorScheme, condition.width !== undefined ? `width ${condition.width}` : null]
    .filter(Boolean)
    .join(', ');
}

// Outcomes from least to most to report: a rule's merged outcome is its worst.
const OUTCOME_RANK = { notApplicable: 0, pass: 1, cantTell: 2, fail: 3 };
function rank(outcome) {
  return Object.prototype.hasOwnProperty.call(OUTCOME_RANK, outcome) ? OUTCOME_RANK[outcome] : OUTCOME_RANK.cantTell;
}

function occurrenceKey(ruleId, occurrence) {
  const hosts = Array.isArray(occurrence.shadowHostSelectors) ? occurrence.shadowHostSelectors : [];
  const details = occurrence.data && occurrence.data.details;
  const reasonCode = details && typeof details.reasonCode === 'string' ? details.reasonCode : '';
  return JSON.stringify([ruleId, hosts, occurrence.selector || '', reasonCode]);
}

/**
 * One result from the scans of one page under several conditions:
 * `runs` is [{ condition, result }], the first being the scan of the page as
 * it was ('default'). The default scan's result is the base. Each rule's
 * outcome is its worst across the scans (fail, cantTell, pass,
 * notApplicable), so a rule failing only in dark mode fails; its
 * occurrences are merged, one per element, rule and reason code, each
 * listing the `conditions` it appeared under, in run order. A rule that
 * failed or asked keeps only the occurrences of the scans where it did. A rule a scan
 * left out (reportOnly()) is taken from the scans that have it. Composite
 * results take the worst one's. An occurrence keeps its own tier
 * (`occurrenceOutcome`), the worst it had in a scan, so a question isn't
 * counted as a failure once another scan fails its rule. What a scan left
 * out is kept from every scan: `skippedCustomRules`, `skippedPacks` and
 * `engine.profilesNotRun` list each entry once, and `contextMatch` is the
 * narrowest scope any scan had (its least `elementCount`, every unmatched
 * selector). `conditionRuns` lists each scan's condition and
 * `engine.environment`.
 */
// What core writes as outcomeNormalized: notApplicable reads inapplicable.
function normalized(outcome) {
  return outcome === 'notApplicable' ? 'inapplicable' : outcome;
}

// Two maps of outcomes by key, each key's worst.
function worstOf(a, b) {
  const out = { ...(a || {}) };
  for (const [key, outcome] of Object.entries(b || {})) {
    if (!(key in out) || rank(outcome) > rank(out[key])) out[key] = outcome;
  }
  return out;
}

function mergeConditionResults(runs) {
  if (!Array.isArray(runs) || !runs.length || !runs[0] || !runs[0].result) {
    throw new TypeError('mergeConditionResults(): expected [{ condition, result }], the default scan first.');
  }
  const base = runs[0].result;
  const checks = new Map();
  const occurrencesByRule = new Map();
  for (const { condition, result } of runs) {
    for (const check of (result && result.checksResults) || []) {
      if (!check || typeof check.ruleId !== 'string') continue;
      const current = checks.get(check.ruleId);
      if (!current) {
        checks.set(check.ruleId, { ...check });
        occurrencesByRule.set(check.ruleId, new Map());
      } else {
        if (rank(check.outcome) > rank(current.outcome)) {
          current.outcome = check.outcome;
          if ('outcomeNormalized' in current) current.outcomeNormalized = normalized(check.outcome);
          if (check.error) current.error = check.error;
        }
        if (check.checkOutcome && rank(check.checkOutcome) > rank(current.checkOutcome)) {
          current.checkOutcome = check.checkOutcome;
        }
        // A scan of several profiles: each profile's verdict is its worst.
        if (check.verdicts && typeof check.verdicts === 'object') {
          current.verdicts = worstOf(current.verdicts, check.verdicts);
        }
      }
      const byKey = occurrencesByRule.get(check.ruleId);
      for (const occurrence of check.occurrences || []) {
        if (!occurrence || typeof occurrence !== 'object') continue;
        const key = occurrenceKey(check.ruleId, occurrence);
        const tier = occurrenceOutcome(check, occurrence);
        const seen = byKey.get(key);
        if (seen) {
          if (!seen.occurrence.conditions.includes(condition)) seen.occurrence.conditions.push(condition);
          seen.rank = Math.max(seen.rank, rank(check.outcome));
          if (tier && (!seen.tier || rank(tier) > rank(seen.tier))) seen.tier = tier;
        } else {
          byKey.set(key, { occurrence: { ...occurrence, conditions: [condition] }, rank: rank(check.outcome), tier });
        }
      }
    }
  }
  // A rule that failed or asked somewhere keeps only the occurrences of the
  // scans where it did: a passing scan's summary occurrence ("All text meets
  // the minimum contrast") isn't one of its findings.
  const checksResults = [...checks.values()].map((check) => {
    const merged = rank(check.outcome);
    const kept = [...occurrencesByRule.get(check.ruleId).values()].filter(
      (entry) => merged < OUTCOME_RANK.cantTell || entry.rank >= OUTCOME_RANK.cantTell
    );
    // Each occurrence's own tier, where it differs from the merged rule's:
    // a question stays a question when another scan fails the rule.
    const occurrences = kept.map((entry) => {
      const { occurrence, tier } = entry;
      if (tier && (occurrence.occurrenceOutcome || tier !== check.outcome)) {
        return { ...occurrence, occurrenceOutcome: tier };
      }
      return occurrence;
    });
    return { ...check, occurrences };
  });

  let rulesResults = base.rulesResults;
  if (Array.isArray(base.rulesResults)) {
    const composites = new Map();
    for (const { result } of runs) {
      for (const composite of (result && result.rulesResults) || []) {
        if (!composite) continue;
        const id = composite.id || composite.ruleId;
        const current = composites.get(id);
        if (!current || rank(composite.outcome) > rank(current.outcome)) composites.set(id, composite);
      }
    }
    rulesResults = [...composites.values()];
  }

  // Each profile's rule results, the worst of every scan's.
  let profiles = base.profiles;
  if (profiles && typeof profiles === 'object') {
    profiles = {};
    for (const { result } of runs) {
      for (const [name, entry] of Object.entries((result && result.profiles) || {})) {
        if (!entry || typeof entry !== 'object') continue;
        const current = profiles[name];
        profiles[name] = current
          ? { ...current, rulesResults: worstOf(current.rulesResults, entry.rulesResults) }
          : { ...entry, rulesResults: { ...(entry.rulesResults || {}) } };
      }
    }
  }

  // What any scan left out, each entry once: a gap under one condition is a
  // gap of the merged result.
  const results = runs.map((run) => run && run.result).filter(Boolean);
  const gapFields = {};
  const unionOf = (lists, keyOf) => {
    const out = new Map();
    for (const list of lists) {
      for (const entry of list) {
        const key = keyOf(entry);
        if (!out.has(key)) out.set(key, entry);
      }
    }
    return [...out.values()];
  };
  for (const field of ['skippedCustomRules', 'skippedPacks']) {
    const lists = results.map((r) => r[field]).filter(Array.isArray);
    if (lists.length) {
      gapFields[field] = unionOf(lists, (e) => JSON.stringify(e && (e.id !== undefined ? e.id : e.name)));
    }
  }
  const notRunLists = results.map((r) => r.engine && r.engine.profilesNotRun).filter(Array.isArray);
  const engine =
    notRunLists.length && base.engine && typeof base.engine === 'object'
      ? {
          ...base.engine,
          profilesNotRun: unionOf(notRunLists, (e) =>
            String(e && e.profile).trim().toLowerCase()
          )
        }
      : base.engine;
  const matches = results.map((r) => r.contextMatch).filter((m) => m && typeof m === 'object');
  if (matches.length) {
    const counts = matches.map((m) => m.elementCount).filter((n) => typeof n === 'number');
    gapFields.contextMatch = {
      ...base.contextMatch,
      ...(counts.length ? { elementCount: Math.min(...counts) } : {}),
      unmatchedSelectors: unionOf(
        matches.map((m) => (Array.isArray(m.unmatchedSelectors) ? m.unmatchedSelectors : [])),
        (selector) => selector
      )
    };
  }

  return {
    ...base,
    ...gapFields,
    ...(engine !== undefined ? { engine } : {}),
    checksResults,
    ...(profiles !== undefined ? { profiles } : {}),
    ...(rulesResults !== undefined ? { rulesResults } : {}),
    conditionRuns: runs.map(({ condition, result }) => ({
      condition,
      environment: (result && result.engine && result.engine.environment) || null
    }))
  };
}

module.exports = { COLOR_SCHEMES, readConditions, conditionLabel, mergeConditionResults };
