'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const core = require('@surea11y/core');
const {
  ENGINE_ERROR_CODES,
  ENGINE_ERROR_KEY,
  EngineError,
  createInPageScan,
  rethrowEngineError
} = require('../src/index.js');

// Sends a function into a jsdom page the way a driver does: by its source
// alone, so anything it needs from outside its own body is missing there.
// The value comes back through JSON, as across a driver boundary.
function runInPage(fn, ...args) {
  const dom = new JSDOM('<!doctype html><html lang="en"><body><main><img src="a.png"></main></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
    runScripts: 'outside-only'
  });
  try {
    const rebuilt = dom.window.eval('(' + fn.toString() + ')');
    return JSON.parse(JSON.stringify(rebuilt(...args)));
  } finally {
    dom.window.close();
  }
}

test('createInPageScan(): the wrapper scans like runa11yCoreInPage once serialized into a page', () => {
  const scan = createInPageScan(core.runa11yCoreInPage);
  const result = rethrowEngineError(runInPage(scan, 'https://example.com/', null, {}, { includeRuleIds: ['img-alt-present'] }));
  assert.deepStrictEqual(result.checksResults.map((r) => [r.ruleId, r.outcome]), [['img-alt-present', 'fail']]);
  assert.strictEqual(result.url, 'https://example.com/');
});

test('createInPageScan(): INVALID_RUN_ONLY comes back with its code, as an EngineError', () => {
  const scan = createInPageScan(core.runa11yCoreInPage);
  const returned = runInPage(scan, null, null, {}, { includeRuleIds: ['img-alt-presnet'] });
  assert.ok(returned[ENGINE_ERROR_KEY]);
  assert.throws(() => rethrowEngineError(returned), (err) => {
    assert.ok(err instanceof EngineError);
    assert.ok(err instanceof Error);
    assert.strictEqual(err.name, 'EngineError');
    assert.strictEqual(err.code, 'INVALID_RUN_ONLY');
    assert.strictEqual(err.message, 'runOnly.includeRuleIds: no rule named "img-alt-presnet".');
    assert.strictEqual(err.selector, null);
    return true;
  });
});

test('createInPageScan(): INVALID_CONTEXT_SELECTOR comes back with its code and selector', () => {
  const scan = createInPageScan(core.runa11yCoreInPage);
  assert.throws(
    () => rethrowEngineError(runInPage(scan, null, ['main', 'main['], {}, null)),
    (err) => err instanceof EngineError && err.code === 'INVALID_CONTEXT_SELECTOR' && err.selector === 'main['
  );
});

test('createInPageScan(): an error without a code is rethrown in the page unchanged', () => {
  const scan = createInPageScan(function runa11yCoreInPage() { throw new RangeError('boom'); });
  assert.throws(() => runInPage(scan, null, null, {}, null), (err) => err.name === 'RangeError' && err.message === 'boom');
});

test('createInPageScan(): accepts a method-shorthand function and rejects a non-function', () => {
  const holder = { runa11yCoreInPage(url) { return { url }; } };
  const scan = createInPageScan(holder.runa11yCoreInPage);
  assert.deepStrictEqual(runInPage(scan, 'u', null, {}, null), { url: 'u' });
  assert.throws(() => createInPageScan(undefined), TypeError);
});

test('rethrowEngineError(): returns anything that is not an engine error unchanged', () => {
  const result = { checksResults: [] };
  assert.strictEqual(rethrowEngineError(result), result);
  assert.strictEqual(rethrowEngineError(null), null);
  assert.strictEqual(rethrowEngineError(undefined), undefined);
});

test('ENGINE_ERROR_CODES lists the codes core types as EngineErrorCode', () => {
  assert.deepStrictEqual(ENGINE_ERROR_CODES, ['INVALID_RUN_ONLY', 'INVALID_CONTEXT_SELECTOR']);
});
