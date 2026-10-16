'use strict';

const { screenshotInPage, HIGHLIGHT_SPACE } = require('./screenshotsInPage');

// See surea11y's docs/OUTPUT_SCHEMA.md: the outcomes a checksResults entry
// can carry. Kept here as well as in A11yCoreBuilderBase.js, which requires
// this file.
const OUTCOMES = ['pass', 'fail', 'cantTell', 'notApplicable'];

const SCREENSHOT_DEFAULTS = Object.freeze({ dir: null, outcomes: Object.freeze(['fail']), padding: 0, highlight: true, max: 50 });

// Why an occurrence has no picture.
const SCREENSHOT_SKIPS = ['no-element', 'page-level', 'not-rendered', 'zero-size', 'off-screen', 'max-reached', 'capture-failed'];

// Node's fs and path, loaded through Node's own require with the id in a
// variable, which a bundler doesn't follow (as @surea11y/core/pack is in
// A11yCoreBuilderBase.js): a Cypress spec bundles this package for the
// browser, where its own builder takes the pictures.
const FS = 'fs';
const PATH = 'path';
function loadNode(id) {
  if (typeof module !== 'object' || !module || typeof module.require !== 'function') {
    throw new Error('screenshot files are written in Node');
  }
  return module.require(id);
}

function optionError(message) {
  const err = new TypeError(`A11yCoreBuilder.screenshots(): ${message}`);
  err.code = 'INVALID_ENGINE_OPTIONS';
  return err;
}

function describe(value) {
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
  return JSON.stringify(value) || String(value);
}

/**
 * The options of `.screenshots()`, checked and with the defaults filled in;
 * null for `false`. Throws a TypeError with `code: 'INVALID_ENGINE_OPTIONS'`
 * for anything it can't use, so a typo is found at the call rather than
 * after a scan that took no pictures.
 */
function normalizeScreenshotOptions(options) {
  if (options === false) return null;
  if (options === undefined || options === true) return SCREENSHOT_DEFAULTS;
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw optionError(`expected an options object, true or false, not ${describe(options)}.`);
  }
  for (const key of Object.keys(options)) {
    if (!Object.prototype.hasOwnProperty.call(SCREENSHOT_DEFAULTS, key)) {
      throw optionError(`unknown option ${JSON.stringify(key)}; the options are ${Object.keys(SCREENSHOT_DEFAULTS).join(', ')}.`);
    }
  }
  const out = { ...SCREENSHOT_DEFAULTS };
  if (options.dir !== undefined && options.dir !== null) {
    if (typeof options.dir !== 'string' || !options.dir.trim()) throw optionError(`dir must be a non-empty string, not ${describe(options.dir)}.`);
    out.dir = options.dir;
  }
  if (options.outcomes !== undefined) {
    const list = Array.isArray(options.outcomes) ? options.outcomes : [options.outcomes];
    if (!list.length) throw optionError('outcomes must name at least one outcome.');
    for (const outcome of list) {
      if (!OUTCOMES.includes(outcome)) throw optionError(`invalid outcome ${describe(outcome)} -- must be one of ${OUTCOMES.join(', ')}.`);
    }
    out.outcomes = Object.freeze(Array.from(new Set(list)));
  }
  if (options.padding !== undefined) {
    if (typeof options.padding !== 'number' || !Number.isFinite(options.padding) || options.padding < 0) {
      throw optionError(`padding must be a finite number of 0 or more, not ${describe(options.padding)}.`);
    }
    out.padding = options.padding;
  }
  if (options.highlight !== undefined) {
    if (typeof options.highlight !== 'boolean') throw optionError(`highlight must be true or false, not ${describe(options.highlight)}.`);
    out.highlight = options.highlight;
  }
  if (options.max !== undefined) {
    if (!Number.isInteger(options.max) || options.max < 1) throw optionError(`max must be a whole number of 1 or more, not ${describe(options.max)}.`);
    out.max = options.max;
  }
  return Object.freeze(out);
}

// FNV-1a, 32 bits, over the UTF-8 bytes: the same on every platform, and
// nothing Node-only.
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * The file name of an element's picture: `element-` and a hash of where it
 * is (the frame, its shadow hosts and its selector), so the same element
 * gets the same name on every run, and every finding about it the same file.
 * @param {string[]} frameKey the <iframe>s leading to the frame, outermost first; [] for the page
 * @param {string[]|null|undefined} shadowHostSelectors
 * @param {string} selector
 */
function screenshotFileName(frameKey, shadowHostSelectors, selector) {
  return `element-${fnv1a(JSON.stringify([frameKey || [], shadowHostSelectors || [], selector]))}.png`;
}

// An occurrence's own outcome: its tier where its rule graded them, else
// its rule's (see OUTPUT_SCHEMA.md, occurrenceOutcome).
function outcomeOf(check, occurrence) {
  return typeof occurrence.occurrenceOutcome === 'string' ? occurrence.occurrenceOutcome : check.outcome;
}

/**
 * Which elements of one frame's result to picture: the occurrences whose
 * own outcome is in `outcomes`, grouped by element (frame, shadow hosts and
 * selector), in the order the result first names them. Occurrences with no
 * selector, page-level findings, are listed apart, as nothing to picture.
 * Reads the result and changes nothing.
 * @param {object} result one frame's scan result
 * @param {{ outcomes?: string[], frameKey?: string[] }} [opts]
 * @returns {{ elements: Array<{ key: string, name: string, selector: string, shadowHostSelectors: string[]|null, occurrences: object[] }>, unlocated: object[] }}
 */
function planScreenshots(result, { outcomes = SCREENSHOT_DEFAULTS.outcomes, frameKey = [] } = {}) {
  const elements = [];
  const unlocated = [];
  const byKey = new Map();
  const checks = result && Array.isArray(result.checksResults) ? result.checksResults : [];
  for (const check of checks) {
    if (!check || !Array.isArray(check.occurrences)) continue;
    for (const occurrence of check.occurrences) {
      if (!occurrence || typeof occurrence !== 'object' || !outcomes.includes(outcomeOf(check, occurrence))) continue;
      if (typeof occurrence.selector !== 'string' || !occurrence.selector) {
        unlocated.push(occurrence);
        continue;
      }
      const hosts = Array.isArray(occurrence.shadowHostSelectors) && occurrence.shadowHostSelectors.length ? occurrence.shadowHostSelectors : null;
      const key = JSON.stringify([frameKey, hosts || [], occurrence.selector]);
      let element = byKey.get(key);
      if (!element) {
        element = { key, name: screenshotFileName(frameKey, hosts, occurrence.selector), selector: occurrence.selector, shadowHostSelectors: hosts, occurrences: [] };
        byKey.set(key, element);
        elements.push(element);
      }
      element.occurrences.push(occurrence);
    }
  }
  return { elements, unlocated };
}

// --- Geometry, in CSS pixels ---------------------------------------------

function expand(r, by) {
  return { x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by };
}

function intersect(a, b) {
  if (!a || !b) return null;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

// A box in an <iframe>'s viewport, placed in its parent's.
function place(r, at) {
  if (!r) return null;
  return {
    x: at.origin.x + r.x * at.scale.x,
    y: at.origin.y + r.y * at.scale.y,
    width: r.width * at.scale.x,
    height: r.height * at.scale.y
  };
}

// Out to whole CSS pixels, so the picture holds every partial one.
function wholePixels(r) {
  const EPS = 1e-6;
  const x = Math.floor(r.x + EPS);
  const y = Math.floor(r.y + EPS);
  return { x, y, width: Math.ceil(r.x + r.width - EPS) - x, height: Math.ceil(r.y + r.height - EPS) - y };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// --- Taking the pictures --------------------------------------------------

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

// What a binding's _captureBox() gave, as a Buffer of a PNG.
function toPng(image) {
  let buf;
  if (typeof image === 'string') buf = Buffer.from(image.replace(/^data:image\/png;base64,/, ''), 'base64');
  else if (Buffer.isBuffer(image)) buf = image;
  else if (image instanceof Uint8Array) buf = Buffer.from(image.buffer, image.byteOffset, image.byteLength);
  else throw new Error(`_captureBox() returned ${image === null ? 'null' : typeof image}, not a PNG as a Buffer or a base64 string`);
  if (buf.length < 8 || PNG_SIGNATURE.some((byte, i) => buf[i] !== byte)) throw new Error('_captureBox() returned something that is not a PNG image');
  return buf;
}

function errorMessage(e) {
  return (e && e.message) || String(e);
}

// The <iframe> of one step of a frame path, as the in-page step takes it:
// a selector or an index travels in the request, a driver's element handle
// as its own argument.
function iframeArgs(step) {
  const at = step.iframe;
  if (typeof at === 'string') return { iframe: at, element: undefined };
  if (at && typeof at === 'object' && Object.getPrototypeOf(at) === Object.prototype && Number.isInteger(at.index)) {
    return { iframe: { index: at.index, selector: typeof at.selector === 'string' ? at.selector : 'iframe, frame' }, element: undefined };
  }
  return { iframe: null, element: at };
}

function checkFramePath(framePath) {
  if (!Array.isArray(framePath)) throw new TypeError('_captureScreenshots(): framePath must be an array ([] for the top-level page).');
  for (const step of framePath) {
    if (!step || typeof step !== 'object' || !('frame' in step) || step.iframe === undefined || step.iframe === null) {
      throw new TypeError('_captureScreenshots(): each step of framePath must be { frame, iframe }: a parent frame, and the <iframe> in it as a selector, { selector, index } or an element handle.');
    }
  }
}

let tokens = 0;

/**
 * The shared step a binding's analyze() calls once per scanned frame, after
 * the scan and before reportOnly(): pictures the elements the result
 * flags and puts `screenshot` on each occurrence considered. See
 * A11yCoreBuilderBase#_captureScreenshots().
 */
async function captureScreenshots(builder, result, frame, framePath) {
  const options = builder._screenshots;
  if (!options || !result || typeof result !== 'object' || !Array.isArray(result.checksResults)) return result;
  checkFramePath(framePath);

  // A scan starts at its top-level page, which every binding scans first:
  // `max` and the file names count from there.
  if (!framePath.length || !builder._screenshotScan) builder._screenshotScan = { taken: 0, names: new Map(), dirReady: null };
  const scan = builder._screenshotScan;

  const evaluate = async (where, request, element) => {
    const args = element === undefined ? [request] : [request, element];
    const value = await builder._evaluateInFrame(where, screenshotInPage, args);
    if (value === null || value === undefined || typeof value !== 'object') {
      if (request.op === 'release') return value;
      throw new Error(`the page returned ${describe(value)} for the screenshot step "${request.op}"`);
    }
    return value;
  };

  let frameKey = [];
  let frameError = null;
  try {
    for (const step of framePath) {
      const { iframe, element } = iframeArgs(step);
      frameKey.push((await evaluate(step.frame, { op: 'frame-key', iframe }, element)).key);
    }
  } catch (e) {
    frameError = errorMessage(e);
    frameKey = framePath.map((_, i) => `frame-${i}`);
  }

  const { elements, unlocated } = planScreenshots(result, { outcomes: options.outcomes, frameKey });
  for (const occurrence of unlocated) occurrence.screenshot = { skipped: 'no-element' };

  const margin = Math.max(options.padding, options.highlight ? HIGHLIGHT_SPACE : 0);
  for (const element of elements) {
    let screenshot;
    if (frameError) {
      screenshot = { skipped: 'capture-failed', error: frameError };
    } else if (scan.taken >= options.max) {
      screenshot = { skipped: 'max-reached' };
    } else {
      screenshot = await captureElement(element);
    }
    for (const occurrence of element.occurrences) occurrence.screenshot = screenshot;
  }
  return result;

  async function captureElement(element) {
    const token = `surea11y-${Date.now().toString(36)}-${(tokens += 1)}`;
    const held = [];
    let targeted = false;
    let shot;
    try {
      // Each <iframe> on the way into view, outermost first.
      for (const step of framePath) {
        const { iframe, element: handle } = iframeArgs(step);
        held.push(step);
        await evaluate(step.frame, { op: 'hold', token, iframe }, handle);
      }

      targeted = true;
      const target = await evaluate(frame, {
        op: 'target',
        token,
        selector: element.selector,
        shadowHostSelectors: element.shadowHostSelectors,
        highlight: options.highlight,
        margin
      });
      if (target.skipped) return { skipped: SCREENSHOT_SKIPS.includes(target.skipped) ? target.skipped : 'capture-failed' };

      // Out to the top-level page, innermost frame first. What shows is
      // what is inside every viewport on the way.
      let rect = target.rect;
      let shownRect = intersect(rect, target.viewport);
      let shownPadded = intersect(expand(rect, margin), target.viewport);
      let view = target;
      for (let i = framePath.length - 1; i >= 0; i--) {
        const { iframe, element: handle } = iframeArgs(framePath[i]);
        const at = await evaluate(framePath[i].frame, { op: 'reveal', token, iframe, rect, margin }, handle);
        rect = place(rect, at);
        shownRect = intersect(place(shownRect, at), at.viewport);
        shownPadded = intersect(place(shownPadded, at), at.viewport);
        view = at;
      }
      if (!shownRect) return { skipped: 'off-screen' };

      const clip = intersect(wholePixels(shownPadded), view.viewport);
      const image = toPng(await builder._captureBox(clip, {
        devicePixelRatio: view.devicePixelRatio,
        viewport: { ...view.window },
        scroll: { ...view.scroll }
      }));

      const inImage = intersect(shownRect, clip) || shownRect;
      const box = {
        x: round2(inImage.x - clip.x),
        y: round2(inImage.y - clip.y),
        width: round2(inImage.width),
        height: round2(inImage.height)
      };
      shot = { image, box, cropped: shownRect.width * shownRect.height < rect.width * rect.height - 0.01 };
    } catch (e) {
      return { skipped: 'capture-failed', error: errorMessage(e) };
    } finally {
      // The page as it was, also when a step failed: the scanned frame
      // first, then each <iframe>'s parent, innermost first.
      if (targeted) await evaluate(frame, { op: 'release', token }).catch(() => {});
      for (let i = held.length - 1; i >= 0; i--) await evaluate(held[i].frame, { op: 'release', token }).catch(() => {});
    }

    let out;
    try {
      out = options.dir ? { path: await writeImage(element, shot.image) } : { buffer: shot.image };
    } catch (e) {
      return { skipped: 'capture-failed', error: errorMessage(e) };
    }
    scan.taken += 1;
    out.box = shot.box;
    if (shot.cropped) out.cropped = true;
    return out;
  }

  async function writeImage(element, image) {
    const fs = loadNode(FS);
    const path = loadNode(PATH);
    if (!scan.dirReady) scan.dirReady = fs.promises.mkdir(options.dir, { recursive: true });
    await scan.dirReady;
    // Two elements whose hashes collide get their own files: the second
    // name gets a number.
    let name = element.name;
    for (let n = 2; scan.names.has(name) && scan.names.get(name) !== element.key; n++) {
      name = element.name.replace(/\.png$/, `-${n}.png`);
    }
    scan.names.set(name, element.key);
    const file = path.join(options.dir, name);
    await fs.promises.writeFile(file, image);
    return file;
  }
}

module.exports = {
  SCREENSHOT_DEFAULTS,
  SCREENSHOT_SKIPS,
  normalizeScreenshotOptions,
  planScreenshots,
  screenshotFileName,
  captureScreenshots,
  fnv1a
};
