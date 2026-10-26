'use strict';

const { occurrenceOutcome, reasonCodeOf } = require('./review');

// The reason codes @surea11y/core gives a question about a custom element
// whose name or states it could not read from its ElementInternals.
const INTERNALS_REASON_CODES = ['name_internals', 'state_internals'];


const FORCED_COLORS_MESSAGE =
  'The page was shown in forced colors (high contrast); contrast findings may differ with forced colors off.';
const FORCED_COLORS_CSS_MESSAGE =
  'The page was shown in forced colors (high contrast), and its own CSS reacts to them (a forced-colors media query, or a system color such as GrayText), ' +
  'so contrast was measured in colors the page has only under forced colors; contrast findings may differ with forced colors off.';

// The opt-in hooks whose record changes what a scan decides, besides the
// internals hook: the listener hook (listenerHookScript(), core 1.14.0 and
// later), which lets the keyboard rules see the listeners a page adds from
// script, and the live-region hook (liveRegionHookScript()), which records
// what live regions are given. `codes` is the key in core's
// HOOK_REASON_CODES, `environment` the one in engine.environment.
const HOOKS = [
  {
    kind: 'listener-hook',
    name: 'listener hook',
    codes: 'listener',
    environment: 'listenerHook',
    script: 'listenerHookScript()',
    without: 'without seeing the listeners the page adds from script'
  },
  {
    kind: 'live-region-hook',
    name: 'live-region hook',
    codes: 'liveRegion',
    environment: 'liveRegionHook',
    script: 'liveRegionHookScript()',
    without: 'without a record of what the page\'s live regions were given'
  }
];

// core's HOOK_REASON_CODES: for each hook, the rules and reason codes its
// record decides, reports or leans. Loaded as A11yCoreBuilderBase loads
// core, through Node's own require with the id in a variable, which a
// bundler doesn't follow; null with a core older than 1.14.0 or none that
// can be loaded (a browser bundle).
const CORE = '@surea11y/core';
function loadHookReasonCodes() {
  try {
    if (typeof module !== 'object' || !module || typeof module.require !== 'function') return null;
    const codes = module.require(CORE).HOOK_REASON_CODES;
    return codes && typeof codes === 'object' ? codes : null;
  } catch {
    return null;
  }
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// Where an occurrence is, through the shadow hosts that lead to it: one
// element counted once however many rules ask about it.
function elementKey(occurrence) {
  const hosts = Array.isArray(occurrence.shadowHostSelectors) ? occurrence.shadowHostSelectors : [];
  return hosts.concat(occurrence.selector || '').join(' >>> ');
}

// The findings a hook's record would have decided or weighed: a failure or
// a question of a rule and reason code core lists for the hook as
// 'decides' or 'leans'. A code it lists as 'reports' is given only where
// the hook ran, so a scan without it has none to count.
function hookFindings(result, entries) {
  const changes = new Set(
    (Array.isArray(entries) ? entries : [])
      .filter((e) => e && (e.effect === 'decides' || e.effect === 'leans'))
      .map((e) => `${e.ruleId}\u0000${e.reasonCode}`)
  );
  const rules = [];
  let count = 0;
  for (const check of result.checksResults) {
    if (!check || !Array.isArray(check.occurrences)) continue;
    for (const occurrence of check.occurrences) {
      if (!occurrenceOutcome(check, occurrence)) continue;
      if (!changes.has(`${check.ruleId}\u0000${reasonCodeOf(occurrence)}`)) continue;
      count += 1;
      if (!rules.includes(check.ruleId)) rules.push(check.ruleId);
    }
  }
  return { count, rules };
}

/**
 * What a reader of a scan result should know about how the page was
 * scanned. Unlike getScanGaps(), a note is no sign that something was left
 * out: the scan checked what it was asked to, under these conditions.
 *
 * - `forced-colors`: the page was shown in forced colors (high contrast),
 *   `engine.environment.forcedColors: 'active'` (@surea11y/core 1.12.0 and
 *   later), so contrast findings may differ with forced colors off. With
 *   `pageCss: true` (`engine.environment.forcedColorsCss`, core 1.14.0 and
 *   later), the page's own CSS reacted to them as well.
 * - `internals-hook`: the scan asked about custom elements whose name or
 *   states it could not read from their ElementInternals (`name_internals`,
 *   `state_internals`), and the internals hook was not installed, or was
 *   installed late (`hook: 'none' | 'late'`). Installing it before the page
 *   loads lets the engine read them, and read roles set the same way, which
 *   without it are not checked and not asked about. `elementCount` is the
 *   number of elements asked about.
 * - `listener-hook` / `live-region-hook` (core 1.14.0 and later): findings
 *   the listener hook or the live-region hook would have decided, or given
 *   a lean, were judged without it (`hook: 'none' | 'late'`). `findingCount`
 *   counts them and `rules` names their rules. Which findings these are is
 *   core's HOOK_REASON_CODES, read from the core installed beside the
 *   binding, or from `options.hookReasonCodes` where it can't be (a browser
 *   bundle): without either, there is no such note.
 *
 * @param {object} result one scan result (for a frames(true) scan, call it
 *   on `topFrame` and on each entry of `frames` that has `checksResults`)
 * @param {{ hookReasonCodes?: object }} [options]
 * @returns {Array<{ kind: string, message: string, hook?: ('none'|'late'), elementCount?: number, findingCount?: number, rules?: string[], pageCss?: true }>}
 */
function getScanNotes(result, options) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.checksResults)) {
    throw new TypeError(
      'getScanNotes(): expected one scan result (an object with a checksResults array); ' +
      'for a frames(true) scan, pass topFrame and each scanned frame on its own.'
    );
  }
  const notes = [];
  const environment = (result.engine && result.engine.environment) || {};

  if (environment.forcedColors === 'active') {
    notes.push(
      environment.forcedColorsCss === true
        ? { kind: 'forced-colors', pageCss: true, message: FORCED_COLORS_CSS_MESSAGE }
        : { kind: 'forced-colors', message: FORCED_COLORS_MESSAGE }
    );
  }

  if (environment.internalsHook !== 'early') {
    const elements = new Set();
    for (const check of result.checksResults) {
      if (!check || check.outcome !== 'cantTell' || !Array.isArray(check.occurrences)) continue;
      for (const occurrence of check.occurrences) {
        if (!INTERNALS_REASON_CODES.includes(reasonCodeOf(occurrence))) continue;
        elements.add(elementKey(occurrence));
      }
    }
    if (elements.size) {
      const late = environment.internalsHook === 'late';
      const asked = plural(elements.size, 'custom element was', 'custom elements were');
      notes.push({
        kind: 'internals-hook',
        hook: late ? 'late' : 'none',
        elementCount: elements.size,
        message:
          `${asked} asked about because the scan could not read the name or states they set through ElementInternals` +
          (late ? ', since the internals hook was installed after the page\'s scripts ran. ' : '. ') +
          'Install the internals hook before the page loads (installInternalsHook() in your binding) to have them checked, and roles set the same way.'
      });
    }
  }

  const given = options && typeof options === 'object' ? options.hookReasonCodes : null;
  const hookReasonCodes = given && typeof given === 'object' ? given : loadHookReasonCodes();
  for (const hook of HOOKS) {
    if (!hookReasonCodes || environment[hook.environment] === 'early') continue;
    const { count, rules } = hookFindings(result, hookReasonCodes[hook.codes]);
    if (!count) continue;
    const late = environment[hook.environment] === 'late';
    notes.push({
      kind: hook.kind,
      hook: late ? 'late' : 'none',
      findingCount: count,
      rules,
      message:
        `${plural(count, 'finding', 'findings')} (${rules.join(', ')}) ${count === 1 ? 'was' : 'were'} judged ${hook.without}` +
        (late ? `, since the ${hook.name} was installed after the page's scripts ran. ` : '. ') +
        `Install the ${hook.name} before the page loads (${hook.script} from @surea11y/core) to have ${count === 1 ? 'it' : 'them'} judged by what the page does.`
    });
  }

  return notes;
}

module.exports = { getScanNotes };
