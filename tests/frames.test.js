'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const {
  findFrameElements,
  readFrameElement,
  isFrameDocumentEmpty,
  frameReadingOptions,
  inheritFrameReading,
  frameEngineOptions
} = require('../src/index.js');

const doc = (html) => new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;

test('findFrameElements(): iframes and frames in order, through open shadow roots', () => {
  const d = doc('<iframe id="a"></iframe><x-a></x-a><div><iframe id="c"></iframe></div>');
  d.querySelector('x-a').attachShadow({ mode: 'open' }).innerHTML = '<iframe id="b"></iframe>';
  assert.deepStrictEqual(findFrameElements(d).map((el) => el.id), ['a', 'b', 'c']);
});

test('readFrameElement(): excluded, outside the scope, aria-hidden, or read as it is', () => {
  const d = doc(
    '<main><iframe id="in"></iframe><div class="ad"><iframe id="ad"></iframe></div>' +
      '<div aria-hidden=" TRUE "><iframe id="ah"></iframe></div></main><footer><iframe id="out"></iframe></footer>'
  );
  const opts = frameReadingOptions({ excludeSelectors: ['.ad'] }, ['main'], true);
  const read = (id) => readFrameElement(d.getElementById(id), opts);
  assert.deepStrictEqual(read('in'), {});
  assert.deepStrictEqual(read('ad'), { skipped: 'excluded' });
  assert.deepStrictEqual(read('out'), { skipped: 'outside-scope' });
  assert.deepStrictEqual(read('ah'), { ariaHidden: true });
  // A frame's own frames are not scoped by the top page's include().
  assert.strictEqual(frameReadingOptions({}, ['main'], false).scope, null);
  // The page's hidden frame, by checkVisibility where the browser has it.
  const el = d.getElementById('in');
  el.checkVisibility = () => false;
  assert.deepStrictEqual(readFrameElement(el, opts), { skipped: 'hidden' });
  assert.deepStrictEqual(readFrameElement(el, frameReadingOptions({ includeHiddenElements: true }, null, true)), {});
});

test('isFrameDocumentEmpty(): only a body with nothing to show', () => {
  assert.strictEqual(isFrameDocumentEmpty(doc('')), true);
  assert.strictEqual(isFrameDocumentEmpty(doc('<img src="a.png">')), false);
  assert.strictEqual(isFrameDocumentEmpty(doc('text')), false);
  const shadowed = doc('');
  shadowed.body.attachShadow({ mode: 'open' }).innerHTML = '<p>x</p>';
  assert.strictEqual(isFrameDocumentEmpty(shadowed), false);
});

test('frameEngineOptions(): embeddedAriaHidden for an aria-hidden frame', () => {
  const eo = { locale: 'en' };
  assert.strictEqual(frameEngineOptions(eo, {}), eo);
  assert.deepStrictEqual(frameEngineOptions(eo, { ariaHidden: true }), { locale: 'en', embeddedAriaHidden: true });
});

test('readFrameElement(): inert, behind an open modal dialog, through a slot, and in a shadow root the scan leaves out', () => {
  const d = doc(
    '<div inert><iframe id="inert"></iframe></div>' +
      '<x-wrap><iframe id="slotted"></iframe></x-wrap>' +
      '<x-host></x-host>' +
      '<iframe id="covered"></iframe><dialog id="d"><iframe id="in-dialog"></iframe></dialog>'
  );
  d.querySelector('x-wrap').attachShadow({ mode: 'open' }).innerHTML = '<div aria-hidden="true" inert><slot></slot></div>';
  d.querySelector('x-host').attachShadow({ mode: 'open' }).innerHTML = '<iframe id="shadowed"></iframe>';
  const shadowed = d.querySelector('x-host').shadowRoot.getElementById('shadowed');
  const opts = frameReadingOptions({}, null, true);
  const read = (el, o = opts) => readFrameElement(el, o);
  assert.deepStrictEqual(read(d.getElementById('inert')), { inert: true });
  assert.deepStrictEqual(read(d.getElementById('slotted')), { ariaHidden: true, inert: true });
  assert.deepStrictEqual(read(shadowed), {});
  assert.deepStrictEqual(read(shadowed, frameReadingOptions({ includeShadowDom: false }, null, true)), { skipped: 'excluded' });
  // jsdom opens no modal: the dialog says it is one.
  const dialog = d.getElementById('d');
  const matches = dialog.matches.bind(dialog);
  dialog.matches = (selector) => selector === ':modal' || matches(selector);
  assert.deepStrictEqual(read(d.getElementById('covered')), { skipped: 'hidden' });
  assert.deepStrictEqual(read(d.getElementById('in-dialog')), {});
  assert.deepStrictEqual(read(d.getElementById('covered'), frameReadingOptions({ includeHiddenElements: true }, null, true)), {});
});

test('inheritFrameReading() and frameEngineOptions(): a frame inside an aria-hidden or inert one is read so too, and is no page of its own', () => {
  assert.deepStrictEqual(inheritFrameReading({ ariaHidden: true, inert: false }, {}), { ariaHidden: true, inert: false });
  assert.deepStrictEqual(inheritFrameReading(null, { inert: true }), { ariaHidden: false, inert: true });
  const eo = { excludeSelectors: ['.ad'] };
  assert.strictEqual(frameEngineOptions(eo, { ariaHidden: false, inert: false }), eo);
  assert.deepStrictEqual(frameEngineOptions(eo, { inert: true }), { excludeSelectors: ['.ad'], embeddedInert: true });
  assert.deepStrictEqual(frameEngineOptions({ topLevelDocument: true }, {}), {});
});

test('readFrameElement(): a light-DOM frame slotted into a component is no shadow-root content with includeShadowDom: false', () => {
  const d = doc('<x-wrap><iframe id="slotted"></iframe></x-wrap>');
  d.querySelector('x-wrap').attachShadow({ mode: 'open' }).innerHTML = '<div><slot></slot></div>';
  assert.deepStrictEqual(readFrameElement(d.getElementById('slotted'), frameReadingOptions({ includeShadowDom: false }, null, true)), {});
});

test("readFrameElement(): include() scopes by the document's elements, as core's querySelectorAll does, not by an element of a shadow root", () => {
  const d = doc('<x-panel></x-panel><main><x-card></x-card></main>');
  d.querySelector('x-panel').attachShadow({ mode: 'open' }).innerHTML = '<div class="panel"><iframe id="f"></iframe></div>';
  d.querySelector('x-card').attachShadow({ mode: 'open' }).innerHTML = '<iframe id="g"></iframe>';
  const inPanel = d.querySelector('x-panel').shadowRoot.getElementById('f');
  const inCard = d.querySelector('x-card').shadowRoot.getElementById('g');
  assert.deepStrictEqual(readFrameElement(inPanel, frameReadingOptions({}, ['.panel'], true)), { skipped: 'outside-scope' });
  // A shadow root's frames are its host's, in a scope that holds the host.
  assert.deepStrictEqual(readFrameElement(inCard, frameReadingOptions({}, ['main'], true)), {});
});

test('readFrameElement(): with two modal dialogs open, only the topmost one\'s frames are reachable', () => {
  const d = doc('<dialog id="lower"><iframe id="a"></iframe></dialog><dialog id="upper"><iframe id="b"></iframe></dialog>');
  const lower = d.getElementById('lower');
  const upper = d.getElementById('upper');
  // jsdom opens no modal and lays nothing out: each says it is one, with a
  // box, and a point lands in the upper one, as the browser hit-tests.
  for (const dialog of [lower, upper]) {
    const matches = dialog.matches.bind(dialog);
    dialog.matches = (selector) => selector === ':modal' || matches(selector);
    dialog.getBoundingClientRect = () => ({ left: 10, top: 10, width: 100, height: 100 });
  }
  d.elementFromPoint = () => upper;
  const opts = frameReadingOptions({}, null, true);
  assert.deepStrictEqual(readFrameElement(d.getElementById('a'), opts), { skipped: 'hidden' });
  assert.deepStrictEqual(readFrameElement(d.getElementById('b'), opts), {});
});
