'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { getScanNotes, formatFailures, A11yCoreBuilderBase } = require('../src/index.js');

function question(ruleId, reasonCode, selector, extra = {}) {
  return {
    ruleId,
    outcome: 'cantTell',
    severity: 'serious',
    occurrences: [{ selector, summary: `${ruleId} asks.`, data: { details: { reasonCode } }, ...extra }]
  };
}

// One element asked about twice (name and state), and one in a shadow tree.
const ASKED = [
  question('binary-control-name-present', 'name_internals', 'x-check'),
  question('aria-required-attr', 'state_internals', 'x-check'),
  question('button-name-present', 'name_internals', 'x-button', { shadowHostSelectors: ['my-app'] })
];

function result(environment, checksResults = []) {
  return { url: 'https://example.com/', engine: { version: '1.12.0', environment }, checksResults };
}

test('getScanNotes(): none for a plain result, or one from before core 1.12.0', () => {
  assert.deepStrictEqual(getScanNotes(result({ layout: true, forcedColors: 'none' })), []);
  assert.deepStrictEqual(getScanNotes({ checksResults: [] }), []);
});

test('getScanNotes(): forced colors only when they were active', () => {
  assert.deepStrictEqual(getScanNotes(result({ layout: true, forcedColors: 'active' })), [{
    kind: 'forced-colors',
    message: 'The page was shown in forced colors (high contrast); contrast findings may differ with forced colors off.'
  }]);
  assert.deepStrictEqual(getScanNotes(result({ layout: false })), []);
});

test('getScanNotes(): internals questions without the hook, counted by element', () => {
  const [note] = getScanNotes(result({ layout: false }, ASKED));
  assert.strictEqual(note.kind, 'internals-hook');
  assert.strictEqual(note.hook, 'none');
  assert.strictEqual(note.elementCount, 2);
  assert.match(note.message, /^2 custom elements were asked about because the scan could not read the name or states they set through ElementInternals\. Install the internals hook before the page loads/);
});

test('getScanNotes(): internals questions with a late hook say so; with an early one there is no note', () => {
  const [late] = getScanNotes(result({ layout: false, internalsHook: 'late' }, [ASKED[0]]));
  assert.strictEqual(late.hook, 'late');
  assert.match(late.message, /^1 custom element was asked about .*installed after the page's scripts ran\./);
  assert.deepStrictEqual(getScanNotes(result({ layout: false, internalsHook: 'early' }, ASKED)), []);
});

test('getScanNotes(): other questions, and a passed or failed rule, are no internals note', () => {
  const other = question('image-alt-quality', 'alt_suspicious', 'img');
  const decided = { ...question('button-name-present', 'name_internals', 'x-b'), outcome: 'fail' };
  assert.deepStrictEqual(getScanNotes(result({ layout: false }, [other, decided])), []);
});

test('getScanNotes(): throws a TypeError for anything but one scan result', () => {
  for (const bad of [undefined, null, [], {}, { topFrame: result({}), frames: [] }]) {
    assert.throws(() => getScanNotes(bad), TypeError);
  }
});

test('formatFailures(result): notes come after the gaps, before the engine version', () => {
  const text = formatFailures(result({ layout: true, forcedColors: 'active' }, [ASKED[0]]), { outcomes: ['fail'] });
  const blocks = text.split('\n\n');
  assert.strictEqual(blocks[0], 'No accessibility violations found.');
  assert.match(blocks[1], /^The page was shown in forced colors .*\n1 custom element was asked about/);
  assert.strictEqual(blocks[2], 'Scanned with @surea11y/core 1.12.0.');
  assert.doesNotMatch(formatFailures(result({ layout: true, forcedColors: 'none' })), /forced colors/);
  assert.doesNotMatch(formatFailures(ASKED), /internals hook/, 'a checksResults array carries no environment');
});

function capturingWarn(fn) {
  const warn = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(' '));
  try { fn(); } finally { console.warn = warn; }
  return lines;
}

test('_warnScanGaps(): the internals note once per builder, whichever frame asks; forced colors is left to formatFailures()', () => {
  const b = new A11yCoreBuilderBase();
  const frame = { ...result({ layout: true, forcedColors: 'active' }, ASKED), url: 'https://example.com/frame' };
  const lines = capturingWarn(() => {
    b._warnScanGaps(result({ layout: true, forcedColors: 'active' }, ASKED), '@surea11y/puppeteer');
    b._warnScanGaps(frame, '@surea11y/puppeteer');
  });
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /^@surea11y\/puppeteer \(https:\/\/example\.com\/\): 2 custom elements were asked about/);
});

test('_warnScanGaps(): a logger() receives the internals note, told apart by kind', () => {
  const seen = [];
  const b = new A11yCoreBuilderBase().logger((entry) => seen.push(entry.kind));
  capturingWarn(() => b._warnScanGaps({ ...result({ layout: false }, ASKED), contextMatch: { elementCount: 1, unmatchedSelectors: ['#aside'] } }, 'x'));
  assert.deepStrictEqual(seen, ['context-partly-not-found', 'internals-hook']);
});

// Questions the listener hook (core 1.14.0) would let core settle.
const LISTENED = [
  question('click-handler-keyboard-operable', 'CLICK_HANDLER_NO_KEY_HANDLER', '#save'),
  question('mouse-only-event-handlers', 'MOUSE_ONLY_HANDLER_NO_KEYBOARD_EQUIVALENT', '#tip')
];

test('getScanNotes(): click and pointer questions without the listener hook, counted by element', () => {
  const notes = getScanNotes(result({ layout: true }, LISTENED));
  assert.deepStrictEqual(notes.map((n) => [n.kind, n.hook, n.elementCount]), [['listener-hook', 'none', 2]]);
  assert.match(notes[0].message, /^2 elements were asked about because the scan could not see the key or focus listeners a page adds from script\. Install the listener hook before the page loads \(installListenerHook\(\) in your binding\)/);
});

test('getScanNotes(): a late listener hook says so; an early one leaves no note', () => {
  const [late] = getScanNotes(result({ layout: true, listenerHook: 'late' }, [LISTENED[0]]));
  assert.strictEqual(late.hook, 'late');
  assert.match(late.message, /^1 element was asked about .*installed after the page's scripts ran\./);
  assert.deepStrictEqual(getScanNotes(result({ layout: true, listenerHook: 'early' }, LISTENED)), []);
});

test('getScanNotes(): other click-handler questions are no listener note', () => {
  const other = question('click-handler-keyboard-operable', 'CLICK_HANDLER_NOT_IN_TAB_ORDER', '#a');
  assert.deepStrictEqual(getScanNotes(result({ layout: true }, [other])), []);
});

test('_warnScanGaps(): the internals and listener notes, each once per builder', () => {
  const b = new A11yCoreBuilderBase();
  const page = result({ layout: true }, ASKED.concat(LISTENED));
  const lines = capturingWarn(() => {
    b._warnScanGaps(page, '@surea11y/puppeteer');
    b._warnScanGaps({ ...page, url: 'https://example.com/frame' }, '@surea11y/puppeteer');
  });
  assert.strictEqual(lines.length, 2);
  assert.match(lines[0], /custom elements were asked about/);
  assert.match(lines[1], /2 elements were asked about because the scan could not see/);
});
