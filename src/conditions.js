'use strict';

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
 * listing the `conditions` it appeared under, in run order. A rule a scan
 * left out (reportOnly()) is taken from the scans that have it. Composite
 * results take the worst one's. `conditionRuns` lists each scan's condition
 * and `engine.environment`.
 */
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
      } else if (rank(check.outcome) > rank(current.outcome)) {
        current.outcome = check.outcome;
        if (check.error) current.error = check.error;
      }
      const byKey = occurrencesByRule.get(check.ruleId);
      for (const occurrence of check.occurrences || []) {
        if (!occurrence || typeof occurrence !== 'object') continue;
        const key = occurrenceKey(check.ruleId, occurrence);
        const seen = byKey.get(key);
        if (seen) {
          if (!seen.conditions.includes(condition)) seen.conditions.push(condition);
        } else {
          byKey.set(key, { ...occurrence, conditions: [condition] });
        }
      }
    }
  }
  const checksResults = [...checks.values()].map((check) => ({
    ...check,
    occurrences: [...occurrencesByRule.get(check.ruleId).values()]
  }));

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

  return {
    ...base,
    checksResults,
    ...(rulesResults !== undefined ? { rulesResults } : {}),
    conditionRuns: runs.map(({ condition, result }) => ({
      condition,
      environment: (result && result.engine && result.engine.environment) || null
    }))
  };
}

module.exports = { COLOR_SCHEMES, readConditions, conditionLabel, mergeConditionResults };
