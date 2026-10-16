'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const {
  A11yCoreBuilderBase,
  SCREENSHOT_DEFAULTS,
  SCREENSHOT_SKIPS,
  planScreenshots,
  screenshotFileName,
  screenshotInPage,
  formatFailures
} = require('../src/index.js');
const { fnv1a } = require('../src/screenshots.js');
const { decodePng, encodePng } = require('../src/png.js');

// --- A page with a layout -------------------------------------------------
//
// jsdom lays nothing out, so each window here gets one: every element with
// a `data-box="x y width height"` (document coordinates) is drawn there,
// the window scrolls, and scrollIntoView() centers an element as a browser
// does. Enough to drive the in-page step as a real page would.

function layoutWindow(html, { width = 800, height = 600 } = {}) {
  const dom = new JSDOM(html, { url: 'https://example.com/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  let scrollX = 0;
  let scrollY = 0;
  Object.defineProperty(win, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: height, configurable: true });
  Object.defineProperty(win, 'scrollX', { get: () => scrollX, configurable: true });
  Object.defineProperty(win, 'scrollY', { get: () => scrollY, configurable: true });
  Object.defineProperty(win, 'devicePixelRatio', { value: 1, configurable: true });
  win.scrollTo = (a, b) => {
    const to = typeof a === 'object' ? a : { left: a, top: b };
    scrollX = Math.max(0, to.left);
    scrollY = Math.max(0, to.top);
  };
  const boxOf = (el) => {
    const box = el.getAttribute && el.getAttribute('data-box');
    return box ? box.split(' ').map(Number) : null;
  };
  win.Element.prototype.getBoundingClientRect = function () {
    const box = boxOf(this);
    const style = this.style;
    // The overlay is placed with `position: fixed`, in viewport coordinates.
    if (!box && style && style.getPropertyValue('position') === 'fixed') {
      const n = (p) => parseFloat(style.getPropertyValue(p)) || 0;
      return new win.DOMRect(n('left'), n('top'), n('width'), n('height'));
    }
    if (!box) return new win.DOMRect(0, 0, 0, 0);
    return new win.DOMRect(box[0] - scrollX, box[1] - scrollY, box[2], box[3]);
  };
  win.Element.prototype.getClientRects = function () {
    const box = boxOf(this);
    return box ? [this.getBoundingClientRect()] : [];
  };
  win.Element.prototype.scrollIntoView = function (opts = {}) {
    const box = boxOf(this);
    if (!box) return;
    const [x, y, w, h] = box;
    scrollY = Math.max(0, opts.block === 'center' ? y + h / 2 - height / 2 : y);
    scrollX = Math.max(0, opts.inline === 'center' ? x + w / 2 - width / 2 : x);
  };
  return win;
}

const PAGE = `<!doctype html><html lang="en"><head><title>t</title></head><body>
  <img id="near" data-box="10 20 100 50" src="a.png">
  <img id="far" data-box="10 2000 80 40" src="b.png">
  <img id="flat" data-box="10 100 100 0" src="c.png">
  <img id="unlaid" src="d.png">
  <a id="away" data-box="-9999 0 1 1" href="/x"></a>
  <div id="tall" data-box="0 300 800 5000"></div>
  <iframe id="frame" data-box="100 50 400 300" src="about:blank"></iframe>
</body></html>`;

// A tiny PNG for _captureBox() to return.
const PNG = encodePng({ width: 1, height: 1, bitDepth: 8, colorType: 6, bpp: 4 }, Buffer.from([1, 2, 3, 255]));

// A binding whose "driver" is a jsdom window per frame: _evaluateInFrame()
// sends the step from its source and its arguments as JSON, as a driver
// does, except an element handle, which stays an element of that window.
class FakeBuilder extends A11yCoreBuilderBase {
  constructor({ capture } = {}) {
    super();
    this.calls = [];
    this.captures = [];
    this.capture = capture || (() => PNG);
  }

  async _evaluateInFrame(win, fn, args) {
    this.calls.push(args[0].op);
    const step = win.eval('(' + fn.toString() + ')');
    const json = JSON.parse(JSON.stringify(args[0]));
    // A driver waits for a Promise the page returns, and sends back JSON.
    return Promise.resolve(step(json, args[1])).then((value) => (value === undefined ? null : JSON.parse(JSON.stringify(value))));
  }

  async _captureBox(box, view) {
    this.captures.push({ box, view, overlays: this.overlays ? this.overlays() : null });
    return this.capture(box, view);
  }
}

function occurrence(selector, extra = {}) {
  return { selector, summary: `about ${selector}`, ...extra };
}

function resultWith(checks) {
  return { checksResults: checks.map(([ruleId, outcome, occurrences]) => ({ ruleId, outcome, severity: 'serious', title: ruleId, occurrences })) };
}

// --- Options ---------------------------------------------------------------

test('screenshots(): off by default; on with the defaults, then replaced by each call', () => {
  const b = new FakeBuilder();
  assert.strictEqual(b._screenshots, null);
  assert.strictEqual(b.screenshots(), b);
  assert.deepStrictEqual({ ...b._screenshots }, { dir: null, outcomes: ['fail'], padding: 0, highlight: true, max: 50 });
  assert.strictEqual(b.screenshots(true)._screenshots, SCREENSHOT_DEFAULTS);
  b.screenshots({ padding: 8, outcomes: ['fail', 'cantTell', 'fail'] });
  assert.deepStrictEqual([...b._screenshots.outcomes], ['fail', 'cantTell']);
  assert.strictEqual(b._screenshots.padding, 8);
  b.screenshots({ max: 3 });
  assert.strictEqual(b._screenshots.padding, 0, 'a call replaces the options, it does not merge');
  assert.strictEqual(b.screenshots(false)._screenshots, null);
});

test('screenshots(): rejects an option it cannot use with a TypeError and INVALID_ENGINE_OPTIONS, at the call', () => {
  const bad = [
    [{ padd: 4 }, /unknown option "padd"/],
    [{ outcomes: ['failed'] }, /invalid outcome "failed"/],
    [{ outcomes: [] }, /at least one outcome/],
    [{ padding: -1 }, /padding must be a finite number/],
    [{ padding: Infinity }, /padding must be a finite number/],
    [{ padding: '4' }, /padding must be a finite number/],
    [{ max: 0 }, /max must be a whole number of 1 or more/],
    [{ max: 2.5 }, /max must be a whole number/],
    [{ dir: '' }, /dir must be a non-empty string/],
    [{ dir: 7 }, /dir must be a non-empty string/],
    [{ highlight: 'yes' }, /highlight must be true or false/],
    ['a11y-shots', /expected an options object/],
    [[], /expected an options object/],
    [null, /expected an options object/]
  ];
  for (const [options, message] of bad) {
    const b = new FakeBuilder();
    assert.throws(() => b.screenshots(options), (err) => err instanceof TypeError && err.code === 'INVALID_ENGINE_OPTIONS' && message.test(err.message), JSON.stringify(options));
    assert.strictEqual(b._screenshots, null, 'a rejected call changes nothing');
  }
});

test('screenshots(): a binding that does not take screenshots says so, naming what it needs', () => {
  class NoScreenshots extends A11yCoreBuilderBase {}
  assert.throws(() => new NoScreenshots().screenshots(), /does not take screenshots yet.*_evaluateInFrame\(\) and _captureBox\(\)/);
  assert.strictEqual(new NoScreenshots().screenshots(false)._screenshots, null);
  // One that replaces the step itself (Cypress) needs neither method.
  class OwnStep extends A11yCoreBuilderBase {
    _captureScreenshots(result) { return result; }
  }
  assert.ok(new OwnStep().screenshots()._screenshots);
});

test('_buildEngineArgs(): screenshots with selectors turned off throw before the scan runs', () => {
  for (const off of [false, 'false', 0, '0']) {
    const b = new FakeBuilder().options({ output: { includeSelector: off } }).screenshots();
    assert.throws(() => b._buildEngineArgs(), (err) => err instanceof TypeError && err.code === 'INVALID_ENGINE_OPTIONS' && /includeSelector/.test(err.message), String(off));
  }
  assert.doesNotThrow(() => new FakeBuilder().options({ output: { includeSelector: false } })._buildEngineArgs());
  assert.doesNotThrow(() => new FakeBuilder().options({ output: { includeSelector: true } }).screenshots()._buildEngineArgs());
});

// --- Planning --------------------------------------------------------------

test('fnv1a(): the reference values, over UTF-8', () => {
  assert.strictEqual(fnv1a(''), '811c9dc5');
  assert.strictEqual(fnv1a('a'), 'e40c292c');
  assert.strictEqual(fnv1a('foobar'), 'bf9cf968');
  assert.strictEqual(fnv1a('é'), fnv1a('é'));
});

test('screenshotFileName(): the same for the same element, different for each part of where it is', () => {
  const name = screenshotFileName([], null, 'img');
  assert.match(name, /^element-[0-9a-f]{8}\.png$/);
  assert.strictEqual(screenshotFileName([], [], 'img'), name);
  const others = [
    screenshotFileName([], ['x-card'], 'img'),
    screenshotFileName(['#frame'], null, 'img'),
    screenshotFileName([], null, 'img:nth-of-type(2)')
  ];
  assert.strictEqual(new Set([name, ...others]).size, 4);
});

test('planScreenshots(): one entry per element, by each occurrence\'s own outcome, in result order', () => {
  const a = occurrence('#a');
  const aAgain = occurrence('#a');
  const shadowA = occurrence('#a', { shadowHostSelectors: ['x-card'] });
  const review = occurrence('#b', { occurrenceOutcome: 'cantTell' });
  const page = occurrence('');
  const passed = occurrence('#c');
  const result = resultWith([
    ['rule-1', 'fail', [a, review, page]],
    ['rule-2', 'fail', [aAgain, shadowA]],
    ['rule-3', 'pass', [passed]]
  ]);
  const plan = planScreenshots(result);
  assert.deepStrictEqual(plan.elements.map((e) => [e.selector, e.shadowHostSelectors, e.occurrences.length]), [['#a', null, 2], ['#a', ['x-card'], 1]]);
  assert.deepStrictEqual(plan.unlocated, [page]);
  assert.notStrictEqual(plan.elements[0].name, plan.elements[1].name);

  const withReview = planScreenshots(result, { outcomes: ['cantTell'] });
  assert.deepStrictEqual(withReview.elements.map((e) => e.selector), ['#b']);
  assert.deepStrictEqual(planScreenshots(null), { elements: [], unlocated: [] });
});

test('the in-page step is self-contained: it runs from its source alone', () => {
  const win = layoutWindow(PAGE);
  const inPage = win.eval('(' + screenshotInPage.toString() + ')');
  // Read back as a driver would: as JSON, out of the page's realm.
  const step = (request) => JSON.parse(JSON.stringify(inPage(request)));
  assert.deepStrictEqual(step({ op: 'target', token: 't', selector: '#missing' }), { skipped: 'no-element' });
  assert.deepStrictEqual(step({ op: 'target', token: 't', selector: '#unlaid' }), { skipped: 'not-rendered' });
  assert.strictEqual(step({ op: 'release', token: 'unknown' }), true);
  assert.throws(() => inPage({ op: 'nope' }), /unknown screenshot step/);
});

// --- Taking the pictures ---------------------------------------------------

test('_captureScreenshots(): does nothing until screenshots() is called', async () => {
  const b = new FakeBuilder();
  const result = resultWith([['img-alt-present', 'fail', [occurrence('#near')]]]);
  assert.strictEqual(await b._captureScreenshots(result, layoutWindow(PAGE)), result);
  assert.deepStrictEqual(b.calls, []);
  assert.ok(!('screenshot' in result.checksResults[0].occurrences[0]));
});

test('_captureScreenshots(): pictures each element once, and says why for each one it cannot', async () => {
  const win = layoutWindow(PAGE);
  const b = new FakeBuilder().screenshots({ outcomes: ['fail', 'cantTell'] });
  const near = occurrence('#near');
  const nearAgain = occurrence('#near');
  const result = resultWith([
    ['img-alt-present', 'fail', [near, occurrence('#missing'), occurrence('#flat'), occurrence('#away'), occurrence('head > title')]],
    ['link-name-present', 'cantTell', [nearAgain, occurrence(''), occurrence('body'), occurrence('#hidden-by-none')]],
    ['region', 'pass', [occurrence('#far')]]
  ]);
  win.document.body.insertAdjacentHTML('beforeend', '<span id="hidden-by-none"></span>');
  assert.strictEqual(await b._captureScreenshots(result, win), result);

  const shots = result.checksResults.map((c) => c.occurrences.map((o) => o.screenshot));
  assert.ok(Buffer.isBuffer(near.screenshot.buffer));
  assert.ok(near.screenshot.buffer.equals(PNG));
  assert.strictEqual(nearAgain.screenshot, near.screenshot, 'one picture per element, shared by its findings');
  assert.deepStrictEqual(shots[0].slice(1), [{ skipped: 'no-element' }, { skipped: 'zero-size' }, { skipped: 'off-screen' }, { skipped: 'not-rendered' }]);
  assert.deepStrictEqual(shots[1].slice(1), [{ skipped: 'no-element' }, { skipped: 'page-level' }, { skipped: 'not-rendered' }]);
  assert.deepStrictEqual(shots[2], [undefined], 'outcomes not asked for get no field');
  assert.strictEqual(b.captures.length, 1);
  for (const s of shots.flat().filter(Boolean)) if (s.skipped) assert.ok(SCREENSHOT_SKIPS.includes(s.skipped));
});

test('_captureScreenshots(): the box is the element, in the picture; the picture holds the highlight around it', async () => {
  const win = layoutWindow(PAGE);
  const b = new FakeBuilder().screenshots();
  b.overlays = () => win.document.querySelectorAll('surea11y-highlight').length;
  const o = occurrence('#near');
  await b._captureScreenshots(resultWith([['img-alt-present', 'fail', [o]]]), win);
  // #near (10, 20, 100x50) shows without scrolling; the highlight takes 4px around it.
  assert.deepStrictEqual(b.captures[0].box, { x: 6, y: 16, width: 108, height: 58 });
  assert.deepStrictEqual(b.captures[0].view, { devicePixelRatio: 1, viewport: { width: 800, height: 600 }, scroll: { x: 0, y: 0 } });
  assert.strictEqual(b.captures[0].overlays, 1, 'the highlight is drawn while the picture is taken');
  assert.deepStrictEqual(o.screenshot.box, { x: 4, y: 4, width: 100, height: 50 });
  assert.strictEqual(o.screenshot.cropped, undefined);
  assert.strictEqual(win.document.querySelectorAll('surea11y-highlight').length, 0, 'and removed after');
});

test('_captureScreenshots(): padding adds context, and without the highlight nothing is drawn', async () => {
  const win = layoutWindow(PAGE);
  const b = new FakeBuilder().screenshots({ padding: 12, highlight: false });
  b.overlays = () => win.document.querySelectorAll('surea11y-highlight').length;
  const o = occurrence('#near');
  await b._captureScreenshots(resultWith([['img-alt-present', 'fail', [o]]]), win);
  // 12px around (10, 20, 100x50), cut at the viewport's left edge.
  assert.deepStrictEqual(b.captures[0].box, { x: 0, y: 8, width: 122, height: 74 });
  assert.strictEqual(b.captures[0].overlays, 0);
  assert.deepStrictEqual(o.screenshot.box, { x: 10, y: 12, width: 100, height: 50 });
});

test('_captureScreenshots(): scrolls an element into view for its picture, and the page back afterwards', async () => {
  const win = layoutWindow(PAGE);
  win.scrollTo(0, 37);
  const b = new FakeBuilder().screenshots({ highlight: false });
  const far = occurrence('#far');
  const tall = occurrence('#tall');
  await b._captureScreenshots(resultWith([['img-alt-present', 'fail', [far, tall]]]), win);
  // #far (10, 2000, 80x40) centered: scrolled to 2000 + 20 - 300.
  assert.deepStrictEqual(b.captures[0].view.scroll, { x: 0, y: 1720 });
  assert.deepStrictEqual(b.captures[0].box, { x: 10, y: 280, width: 80, height: 40 });
  // #tall, taller than the viewport, from its top: the visible part, cropped.
  assert.deepStrictEqual(b.captures[1].box, { x: 0, y: 0, width: 800, height: 600 });
  assert.deepStrictEqual(tall.screenshot.box, { x: 0, y: 0, width: 800, height: 600 });
  assert.strictEqual(tall.screenshot.cropped, true);
  assert.deepStrictEqual([win.scrollX, win.scrollY], [0, 37]);
});

test('_captureScreenshots(): max counts the pictures a scan takes, frames included; the top-level page starts a scan', async () => {
  const top = layoutWindow(PAGE);
  const child = layoutWindow(PAGE);
  const b = new FakeBuilder().screenshots({ max: 2 });
  const first = resultWith([['img-alt-present', 'fail', [occurrence('#near'), occurrence('#unlaid')]]]);
  const second = resultWith([['img-alt-present', 'fail', [occurrence('#near'), occurrence('#far')]]]);
  await b._captureScreenshots(first, top);
  await b._captureScreenshots(second, child, [{ frame: top, iframe: '#frame' }]);
  assert.ok(first.checksResults[0].occurrences[0].screenshot.buffer);
  assert.deepStrictEqual(first.checksResults[0].occurrences[1].screenshot, { skipped: 'not-rendered' }, 'a skipped element takes no picture');
  assert.ok(second.checksResults[0].occurrences[0].screenshot.buffer);
  assert.deepStrictEqual(second.checksResults[0].occurrences[1].screenshot, { skipped: 'max-reached' });

  const next = resultWith([['img-alt-present', 'fail', [occurrence('#near')]]]);
  await b._captureScreenshots(next, top);
  assert.ok(next.checksResults[0].occurrences[0].screenshot.buffer, 'the next scan counts again');
});

test('_captureScreenshots(): an element in a frame is placed on the top-level page, however the binding names the <iframe>', async () => {
  const names = new Set();
  for (const iframe of ['#frame', { index: 0 }, { selector: 'iframe', index: 0 }, 'handle']) {
    const top = layoutWindow(PAGE);
    const child = layoutWindow(PAGE, { width: 400, height: 300 });
    const b = new FakeBuilder().screenshots({ highlight: false });
    const o = occurrence('#near');
    const step = { frame: top, iframe: iframe === 'handle' ? top.document.getElementById('frame') : iframe };
    await b._captureScreenshots(resultWith([['img-alt-present', 'fail', [o]]]), child, [step]);
    // #near is at (10, 20) in the frame, whose viewport starts at (100, 50).
    assert.deepStrictEqual(b.captures[0].box, { x: 110, y: 70, width: 100, height: 50 }, JSON.stringify(iframe));
    assert.deepStrictEqual(b.calls, ['frame-key', 'hold', 'target', 'reveal', 'release', 'release']);
    names.add(screenshotFileName(['#frame'], null, '#near'));
    assert.ok(o.screenshot.buffer);
  }
  assert.strictEqual(names.size, 1);
});

test('_captureScreenshots(): what shows of a frame is what its <iframe> shows', async () => {
  const top = layoutWindow(PAGE);
  const child = layoutWindow(PAGE, { width: 400, height: 300 });
  const b = new FakeBuilder().screenshots({ highlight: false, padding: 30 });
  const o = occurrence('#near');
  await b._captureScreenshots(resultWith([['img-alt-present', 'fail', [o]]]), child, [{ frame: top, iframe: '#frame' }]);
  // The padding would reach to (80, 40) on the page; the frame starts at (100, 50).
  assert.deepStrictEqual(b.captures[0].box, { x: 100, y: 50, width: 140, height: 100 });
  assert.deepStrictEqual(o.screenshot.box, { x: 10, y: 20, width: 100, height: 50 });
});

test('_captureScreenshots(): a capture that fails is reported on its occurrences, and the page is still put back', async () => {
  const win = layoutWindow(PAGE);
  win.scrollTo(0, 37);
  const b = new FakeBuilder({ capture: () => { throw new Error('Target closed'); } }).screenshots();
  const o = occurrence('#far');
  const result = resultWith([['img-alt-present', 'fail', [o]]]);
  assert.strictEqual(await b._captureScreenshots(result, win), result);
  assert.deepStrictEqual(o.screenshot, { skipped: 'capture-failed', error: 'Target closed' });
  assert.strictEqual(win.document.querySelectorAll('surea11y-highlight').length, 0);
  assert.strictEqual(win.scrollY, 37);
  assert.ok(!Object.getOwnPropertySymbols(win).includes(Symbol.for('surea11y.screenshots')), 'no state is left on the window');

  const notPng = new FakeBuilder({ capture: () => 'aGVsbG8=' }).screenshots();
  const p = occurrence('#near');
  await notPng._captureScreenshots(resultWith([['img-alt-present', 'fail', [p]]]), win);
  assert.deepStrictEqual(p.screenshot, { skipped: 'capture-failed', error: '_captureBox() returned something that is not a PNG image' });
});

test('_captureScreenshots(): an <iframe> that is gone fails the frame\'s pictures, not the scan', async () => {
  const top = layoutWindow(PAGE);
  const child = layoutWindow(PAGE);
  const b = new FakeBuilder().screenshots();
  const o = occurrence('#near');
  await b._captureScreenshots(resultWith([['img-alt-present', 'fail', [o]]]), child, [{ frame: top, iframe: '#nope' }]);
  assert.strictEqual(o.screenshot.skipped, 'capture-failed');
  assert.match(o.screenshot.error, /the <iframe> leading to the frame is not in its parent document/);
});

test('_captureScreenshots(): takes a base64 string, and leaves a result that is not a scan result as it is', async () => {
  const win = layoutWindow(PAGE);
  const b = new FakeBuilder({ capture: () => PNG.toString('base64') }).screenshots();
  const o = occurrence('#near');
  await b._captureScreenshots(resultWith([['img-alt-present', 'fail', [o]]]), win);
  assert.ok(o.screenshot.buffer.equals(PNG));
  const failed = { url: 'https://example.com/', error: 'frame detached' };
  assert.strictEqual(await b._captureScreenshots(failed, win), failed);
  assert.deepStrictEqual(failed, { url: 'https://example.com/', error: 'frame detached' });
});

test('_captureScreenshots(): a binding passing a malformed framePath is told so', async () => {
  const b = new FakeBuilder().screenshots();
  const result = resultWith([['img-alt-present', 'fail', [occurrence('#near')]]]);
  await assert.rejects(b._captureScreenshots(result, null, '#frame'), /framePath must be an array/);
  await assert.rejects(b._captureScreenshots(result, null, [{ frame: null }]), /each step of framePath must be \{ frame, iframe \}/);
});

test('_captureScreenshots(): with dir, writes one file per element, named after it, which formatFailures() points to', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surea11y-shots-'));
  try {
    const win = layoutWindow(PAGE);
    const shots = path.join(dir, 'a11y-shots');
    const b = new FakeBuilder().screenshots({ dir: shots });
    const o = occurrence('#near');
    const again = occurrence('#near');
    const result = resultWith([['img-alt-present', 'fail', [o]], ['region', 'fail', [again, occurrence('#missing')]]]);
    await b._captureScreenshots(result, win);
    const file = path.join(shots, screenshotFileName([], null, '#near'));
    assert.deepStrictEqual(o.screenshot, { path: file, box: { x: 4, y: 4, width: 100, height: 50 } });
    assert.strictEqual(again.screenshot, o.screenshot);
    assert.deepStrictEqual(fs.readdirSync(shots), [path.basename(file)]);
    assert.ok(decodePng(fs.readFileSync(file)));

    const message = formatFailures(result);
    assert.strictEqual(message.split(`   screenshot: ${file}`).length - 1, 2);
    assert.ok(!/screenshot:/.test(message.split('#missing')[1]), 'a skipped capture adds no line');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('_captureScreenshots(): a file it cannot write is a failed capture', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surea11y-shots-'));
  try {
    const blocker = path.join(dir, 'file');
    fs.writeFileSync(blocker, '');
    const b = new FakeBuilder().screenshots({ dir: path.join(blocker, 'sub') });
    const o = occurrence('#near');
    await b._captureScreenshots(resultWith([['img-alt-present', 'fail', [o]]]), layoutWindow(PAGE));
    assert.strictEqual(o.screenshot.skipped, 'capture-failed');
    assert.match(o.screenshot.error, /ENOTDIR|EEXIST/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
