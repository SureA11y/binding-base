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

// A fetch that answers `fast` at once and leaves the rest waiting until
// aborted.
const slowExcept = (fast) => (href, init) =>
  href in fast
    ? Promise.resolve({ ok: true, text: async () => fast[href] })
    : new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });

test('fetchStyleSheetTexts stops waiting at a deadline, and lists the sheets it gave up on for it', async () => {
  const hrefs = ['https://cdn.test/slow1.css', 'https://cdn.test/a.css', 'https://cdn.test/slow2.css'];
  const got = await fetchStyleSheetTexts(hrefs, {
    fetch: slowExcept({ 'https://cdn.test/a.css': CSS }),
    deadline: Date.now() + 30
  });
  assert.deepEqual(got, [{ href: 'https://cdn.test/a.css', text: CSS }]);
  assert.deepEqual(got.notRead, ['https://cdn.test/slow1.css', 'https://cdn.test/slow2.css']);
  // A deadline already past starts nothing.
  const late = await fetchStyleSheetTexts(['https://cdn.test/a.css'], {
    fetch: () => assert.fail('fetched'),
    deadline: Date.now() - 1
  });
  assert.deepEqual(late.notRead, ['https://cdn.test/a.css']);
  // Its own timeout, or a sheet that isn't there, is no deadline's doing.
  const own = await fetchStyleSheetTexts(['https://cdn.test/slow.css', 'https://cdn.test/missing.css'], {
    fetch: slowExcept({}),
    timeoutMs: 10,
    deadline: Date.now() + 60000
  });
  assert.deepEqual(own.notRead, []);
});

test('with a time budget, fetching takes half of it at most, the scan is given what is left, and the sheets not read are reported', async () => {
  const b = new FakeBinding({});
  b._styleSheetFetch = slowExcept({ 'https://cdn.test/a.css': CSS });
  const frame = { unreadable: ['https://cdn.test/a.css', 'https://cdn.test/slow.css'] };
  const t0 = Date.now();
  const options = await b._styleSheetEngineOptions(frame, { timeBudgetMs: 80 });
  const took = Date.now() - t0;
  assert.ok(took < 80, `fetching took ${took} ms of a budget of 80`);
  assert.deepEqual(options.styleSheetTexts, [{ href: 'https://cdn.test/a.css', text: CSS }]);
  assert.ok(options.timeBudgetMs > 0 && options.timeBudgetMs <= 80 - 40 + 5, `left ${options.timeBudgetMs}`);

  // Every rule ran: the sheet not read alone makes the result incomplete.
  const result = { url: 'https://p.test/', checksResults: [], engine: { version: '1.18.1' } };
  const lines = [];
  b.logger((gap) => lines.push(gap));
  b._warnScanGaps(result, '@surea11y/test');
  assert.deepEqual(result.engine.incomplete, {
    reason: 'timeBudget',
    rulesNotRun: 0,
    timeBudgetMs: 80,
    styleSheetsNotRead: ['https://cdn.test/slow.css']
  });
  assert.deepEqual(lines.map((g) => g.kind), ['scan-incomplete']);

  // Said once: the next result is left as it is.
  const next = { checksResults: [], engine: {} };
  b._warnScanGaps(next, '@surea11y/test');
  assert.deepEqual(next.engine, {});
});

test('with a time budget, a scan core cut short reports the budget the caller gave, not what was left of it', async () => {
  const b = new FakeBinding({});
  b._styleSheetFetch = fakeFetch({ 'https://cdn.test/a.css': CSS });
  const options = await b._styleSheetEngineOptions({ unreadable: ['https://cdn.test/a.css'] }, { timeBudgetMs: 1000 });
  const result = {
    checksResults: [],
    engine: { incomplete: { reason: 'timeBudget', timeBudgetMs: options.timeBudgetMs || 1000, rulesNotRun: 3 } },
    notRun: []
  };
  b.logger(() => {});
  b._warnScanGaps(result, '@surea11y/test');
  assert.deepEqual(result.engine.incomplete, { reason: 'timeBudget', timeBudgetMs: 1000, rulesNotRun: 3 });
});

test('without a time budget, or with none core reads, the step waits as before and changes no result', async () => {
  for (const timeBudgetMs of [undefined, Infinity, 0, -5, '100']) {
    const b = new FakeBinding({});
    b._styleSheetFetch = fakeFetch({ 'https://cdn.test/a.css': CSS });
    const given = timeBudgetMs === undefined ? {} : { timeBudgetMs };
    const options = await b._styleSheetEngineOptions({ unreadable: ['https://cdn.test/a.css'] }, given);
    assert.deepEqual(options, { ...given, styleSheetTexts: [{ href: 'https://cdn.test/a.css', text: CSS }] });
    const result = { checksResults: [], engine: {} };
    b.logger(() => {});
    b._warnScanGaps(result, '@surea11y/test');
    assert.deepEqual(result.engine, {});
  }
});
