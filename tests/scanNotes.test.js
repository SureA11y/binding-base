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

test('getScanNotes(): forced colors the page\'s own CSS reacts to say so', () => {
  const [note] = getScanNotes(result({ layout: true, forcedColors: 'active', forcedColorsCss: true }));
  assert.strictEqual(note.kind, 'forced-colors');
  assert.strictEqual(note.pageCss, true);
  assert.match(note.message, /its own CSS reacts to them/);
});

// core's HOOK_REASON_CODES, in part, as a caller in a browser bundle passes them.
const HOOK_CODES = {
  internals: [],
  listener: [
    { ruleId: 'click-handler-keyboard-operable', reasonCode: 'CLICK_HANDLER_NO_KEY_LISTENER', effect: 'reports' },
    { ruleId: 'click-handler-keyboard-operable', reasonCode: 'CLICK_HANDLER_NO_KEY_HANDLER', effect: 'leans' },
    { ruleId: 'click-handler-keyboard-operable', reasonCode: 'CLICK_HANDLER_CONTROL_NOT_FOCUSABLE', effect: 'decides' }
  ],
  liveRegion: [{ ruleId: 'live-region-announcements', reasonCode: 'LIVE_REGION_HIDDEN', effect: 'leans' }]
};
const KEYBOARD = [
  question('click-handler-keyboard-operable', 'CLICK_HANDLER_NO_KEY_HANDLER', '#save'),
  { ...question('click-handler-keyboard-operable', 'CLICK_HANDLER_CONTROL_NOT_FOCUSABLE', '#open'), outcome: 'fail' },
  question('live-region-announcements', 'LIVE_REGION_HIDDEN', '#status')
];

test('getScanNotes(): findings a hook decides or leans, judged without it', () => {
  const notes = getScanNotes(result({ layout: true }, KEYBOARD), { hookReasonCodes: HOOK_CODES });
  assert.deepStrictEqual(notes.map((n) => [n.kind, n.hook, n.findingCount, n.rules]), [
    ['listener-hook', 'none', 2, ['click-handler-keyboard-operable']],
    ['live-region-hook', 'none', 1, ['live-region-announcements']]
  ]);
  assert.match(notes[0].message, /^2 findings \(click-handler-keyboard-operable\) were judged without seeing the listeners the page adds from script\. Install the listener hook before the page loads \(installListenerHook\(\) in your binding\)/);
  assert.match(notes[1].message, /^1 finding \(live-region-announcements\) was judged without a record/);
});

test('getScanNotes(): a late hook says so, an early one leaves no note, and a code it only reports counts for nothing', () => {
  const late = getScanNotes(result({ layout: true, listenerHook: 'late', liveRegionHook: 'early' }, KEYBOARD), { hookReasonCodes: HOOK_CODES });
  assert.deepStrictEqual(late.map((n) => [n.kind, n.hook]), [['listener-hook', 'late']]);
  assert.match(late[0].message, /, since the listener hook was installed after the page's scripts ran\./);
  const reported = [question('click-handler-keyboard-operable', 'CLICK_HANDLER_NO_KEY_LISTENER', '#a')];
  assert.deepStrictEqual(getScanNotes(result({ layout: true }, reported), { hookReasonCodes: HOOK_CODES }), []);
  // A passing rule's occurrence is no finding.
  const passed = [{ ...KEYBOARD[0], outcome: 'pass' }];
  assert.deepStrictEqual(getScanNotes(result({ layout: true }, passed), { hookReasonCodes: HOOK_CODES }), []);
});

test('_warnScanGaps(): each hook note once per builder', () => {
  const b = new A11yCoreBuilderBase();
  const lines = capturingWarn(() => {
    for (let i = 0; i < 2; i++) b._warnScanGaps(result({ layout: false }, ASKED.concat(KEYBOARD)), 'x');
  });
  const core = require('@surea11y/core');
  // The hook notes come from the core installed beside this package.
  const expected = core.HOOK_REASON_CODES ? 3 : 1;
  assert.strictEqual(lines.length, expected, lines.join('\n'));
});

test('_warnScanGaps(): a binding that can\'t load core gives the hook codes itself', () => {
  class InBrowser extends A11yCoreBuilderBase {
    _hookReasonCodes() {
      return HOOK_CODES;
    }
  }
  const seen = [];
  new InBrowser().logger((entry) => seen.push(entry.kind))._warnScanGaps(result({ layout: true }, KEYBOARD), 'x');
  assert.deepStrictEqual(seen, ['listener-hook', 'live-region-hook']);
});
