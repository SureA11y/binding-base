'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const {
  findFrameElements,
  readFrameElement,
  isFrameDocumentEmpty,
  frameReadingOptions,
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
