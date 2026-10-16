'use strict';

// The reason codes @surea11y/core gives a question about a custom element
// whose name or states it could not read from its ElementInternals.
const INTERNALS_REASON_CODES = ['name_internals', 'state_internals'];

const FORCED_COLORS_MESSAGE =
  'The page was shown in forced colors (high contrast); contrast findings may differ with forced colors off.';

function reasonCode(occurrence) {
  const data = occurrence && occurrence.data;
  const details = (data && data.details) || (occurrence && occurrence.details);
  return details && typeof details.reasonCode === 'string' ? details.reasonCode : null;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What a reader of a scan result should know about how the page was
 * scanned. Unlike getScanGaps(), a note is no sign that something was left
 * out: the scan checked what it was asked to, under these conditions.
 *
 * - `forced-colors`: the page was shown in forced colors (high contrast),
 *   `engine.environment.forcedColors: 'active'` (@surea11y/core 1.12.0 and
 *   later), so contrast findings may differ with forced colors off.
 * - `internals-hook`: the scan asked about custom elements whose name or
 *   states it could not read from their ElementInternals (`name_internals`,
 *   `state_internals`), and the internals hook was not installed, or was
 *   installed late (`hook: 'none' | 'late'`). Installing it before the page
 *   loads lets the engine read them, and read roles set the same way, which
 *   without it are not checked and not asked about. `elementCount` is the
 *   number of elements asked about.
 *
 * @param {object} result one scan result (for a frames(true) scan, call it
 *   on `topFrame` and on each entry of `frames` that has `checksResults`)
 * @returns {Array<{ kind: string, message: string, hook?: ('none'|'late'), elementCount?: number }>}
 */
function getScanNotes(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.checksResults)) {
    throw new TypeError(
      'getScanNotes(): expected one scan result (an object with a checksResults array); ' +
      'for a frames(true) scan, pass topFrame and each scanned frame on its own.'
    );
  }
  const notes = [];
  const environment = (result.engine && result.engine.environment) || {};

  if (environment.forcedColors === 'active') {
    notes.push({ kind: 'forced-colors', message: FORCED_COLORS_MESSAGE });
  }

  if (environment.internalsHook !== 'early') {
    const elements = new Set();
    for (const check of result.checksResults) {
      if (!check || check.outcome !== 'cantTell' || !Array.isArray(check.occurrences)) continue;
      for (const occurrence of check.occurrences) {
        if (!INTERNALS_REASON_CODES.includes(reasonCode(occurrence))) continue;
        const hosts = Array.isArray(occurrence.shadowHostSelectors) ? occurrence.shadowHostSelectors : [];
        elements.add(hosts.concat(occurrence.selector || '').join(' >>> '));
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

  return notes;
}

module.exports = { getScanNotes };
