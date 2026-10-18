'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { A11yCoreBuilderBase, fetchStyleSheetTexts, findUnreadableStyleSheets } = require('../src');

const CSS = '@media (orientation: portrait) { body { transform: rotate(90deg) } }';
const fakeFetch = (bodies) => async (href) =>
  href in bodies ? { ok: true, text: async () => bodies[href] } : { ok: false, text: async () => '' };

test('fetchStyleSheetTexts returns the sheets that answered, and never rejects', async () => {
  const got = await fetchStyleSheetTexts(
    ['https://cdn.test/a.css', 'https://cdn.test/missing.css', 'data:text/css,x'],
    { fetch: fakeFetch({ 'https://cdn.test/a.css': CSS }) }
  );
  assert.deepEqual(got, [{ href: 'https://cdn.test/a.css', text: CSS }]);
  const failing = await fetchStyleSheetTexts(['https://cdn.test/a.css'], {
    fetch: async () => {
      throw new Error('offline');
    }
  });
  assert.deepEqual(failing, []);
});

test('fetchStyleSheetTexts gives up on a sheet that takes too long', async () => {
  const slow = (href, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  const got = await fetchStyleSheetTexts(['https://cdn.test/slow.css'], { fetch: slow, timeoutMs: 20 });
  assert.deepEqual(got, []);
});

// A binding that evaluates in a fake page whose one sheet can't be read.
class FakeBinding extends A11yCoreBuilderBase {
  _coreReadsStyleSheetTexts() {
    return true;
  }
  async _evaluateInFrame(frame, fn) {
    assert.equal(fn, findUnreadableStyleSheets);
    return frame.unreadable;
  }
}

test('the shared step adds the fetched sheets to styleSheetTexts', async () => {
  const b = new FakeBinding({});
  b._styleSheetFetch = fakeFetch({ 'https://cdn.test/a.css': CSS });
  const frame = { unreadable: ['https://cdn.test/a.css'] };
  const options = await b._styleSheetEngineOptions(frame, { locale: 'en' });
  assert.deepEqual(options, { locale: 'en', styleSheetTexts: [{ href: 'https://cdn.test/a.css', text: CSS }] });
  // One the caller already gave is not fetched again.
  const given = { styleSheetTexts: [{ href: 'https://cdn.test/a.css', text: 'x' }] };
  assert.equal(await b._styleSheetEngineOptions(frame, given), given);
  // Off: nothing is fetched.
  b._styleSheetFetch = () => assert.fail('fetched');
  assert.deepEqual(await b.fetchStyleSheets(false)._styleSheetEngineOptions(frame, {}), {});
});

test('fetchStyleSheets() takes only true or false', () => {
  assert.throws(() => new FakeBinding({}).fetchStyleSheets('yes'), { code: 'INVALID_ENGINE_OPTIONS' });
});

test('without _evaluateInFrame the step returns the options as given', async () => {
  class Bare extends A11yCoreBuilderBase {}
  const options = { a: 1 };
  assert.equal(await new Bare({})._styleSheetEngineOptions({}, options), options);
});

test('with a core older than 1.14.0 the step sends nothing new', async () => {
  class Old extends FakeBinding {
    _coreReadsStyleSheetTexts() {
      return false;
    }
  }
  const b = new Old({});
  b._styleSheetFetch = () => assert.fail('fetched');
  const options = {};
  assert.equal(await b._styleSheetEngineOptions({ unreadable: ['https://cdn.test/a.css'] }, options), options);
});
