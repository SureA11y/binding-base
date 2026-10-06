'use strict';

const { toReconstructableSource } = require('./customRuleReconstruction');

// The codes @surea11y/core (1.10.0 and later) puts on the errors it throws
// for input it cannot use: a runOnly or rule/tag list that names nothing it
// knows, and a contextSelector the browser cannot parse.
const ENGINE_ERROR_CODES = ['INVALID_RUN_ONLY', 'INVALID_CONTEXT_SELECTOR'];

// The key a scan run through createInPageScan() returns its error under.
const ENGINE_ERROR_KEY = '__surea11yEngineError';

/**
 * An error @surea11y/core threw inside the page, rebuilt on this side of
 * the driver. `code` is one of ENGINE_ERROR_CODES (or a later engine's own
 * code); `selector` is the selector that failed to parse, for
 * INVALID_CONTEXT_SELECTOR.
 */
class EngineError extends Error {
  constructor(message, { code, selector = null } = {}) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.selector = selector;
  }
}

// Runs in the page: must use nothing from outside its own body, since its
// source is embedded in createInPageScan()'s. Returns null for an error
// that carries no string `code`, which the caller rethrows as it is.
function toEngineErrorPayload(e) {
  if (!e || typeof e.code !== 'string') return null;
  return {
    __surea11yEngineError: {
      message: String(e.message),
      code: e.code,
      selector: typeof e.selector === 'string' ? e.selector : null
    }
  };
}

/**
 * Wraps core's `runa11yCoreInPage` in a function with the same four
 * parameters that, instead of throwing an engine error, returns it as a
 * plain object, so it survives page.evaluate()/executeScript()/
 * browser.execute(). Those keep an error's message and drop its `code`,
 * which is what tells a typo in withRules() from a broken page.
 *
 * The returned function uses nothing from outside its own body, so a
 * driver can serialize it as it serializes `runa11yCoreInPage`. Errors
 * without a `code` are rethrown in the page, unchanged. Pass what it
 * returns through `rethrowEngineError()`.
 *
 * @param {Function} runa11yCoreInPage core's export of that name
 * @returns {(pageUrl, contextSelector, engineOptions, runOnly) => object}
 */
function createInPageScan(runa11yCoreInPage) {
  if (typeof runa11yCoreInPage !== 'function') {
    throw new TypeError('createInPageScan(): pass @surea11y/core\'s runa11yCoreInPage function.');
  }
  const src =
    'function surea11yInPageScan(pageUrl, contextSelector, engineOptions, runOnly) {\n' +
    '  const run = (' + toReconstructableSource(runa11yCoreInPage) + ');\n' +
    '  const toPayload = (' + toEngineErrorPayload.toString() + ');\n' +
    '  try {\n' +
    '    return run(pageUrl, contextSelector, engineOptions, runOnly);\n' +
    '  } catch (e) {\n' +
    '    const payload = toPayload(e);\n' +
    '    if (!payload) throw e;\n' +
    '    return payload;\n' +
    '  }\n' +
    '}';
  // eslint-disable-next-line no-new-func
  return new Function('return (' + src + ')')();
}

/**
 * Takes what a createInPageScan() function returned in the page: throws an
 * EngineError when it is an engine error, and otherwise returns it as is.
 */
function rethrowEngineError(value) {
  const payload = value && typeof value === 'object' ? value[ENGINE_ERROR_KEY] : null;
  if (!payload || typeof payload !== 'object') return value;
  throw new EngineError(String(payload.message), { code: payload.code, selector: payload.selector });
}

module.exports = {
  ENGINE_ERROR_CODES,
  ENGINE_ERROR_KEY,
  EngineError,
  createInPageScan,
  rethrowEngineError
};
