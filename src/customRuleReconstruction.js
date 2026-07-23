'use strict';

// a11y-core revives a customRules runInPage/applicability STRING back into a
// function via `new Function('return (' + value + ')')()` (see its own
// src/core/dom-runner.js) -- the exact same mechanism used here, purely to
// verify a candidate string will actually reconstruct before it ever crosses
// whichever driver-specific serialization boundary the calling binding has
// (page.evaluate()/executeScript()/browser.execute()).
function canReconstructAsFunction(src) {
  try {
    // eslint-disable-next-line no-new-func
    return typeof new Function('return (' + src + ')')() === 'function';
  } catch (e) {
    return false;
  }
}

// Converts a live function to a source string a11y-core can revive on the
// page side. Function.prototype.toString() on an ES6 method-shorthand
// property (e.g. `{ runInPage(ctx) { ... } }`, the idiomatic way to write
// one of these descriptors, including `async`/generator variants) omits the
// `function` keyword entirely -- so the *exact same* revival mechanism
// a11y-core uses can't parse it back as a standalone expression. Verified
// with `canReconstructAsFunction` above (real check, not a regex guess at
// the syntax) and patched by re-adding `function ` when needed.
function toReconstructableSource(fn) {
  const direct = fn.toString();
  if (canReconstructAsFunction(direct)) return direct;
  const patched = direct.replace(/^(async\s+)?(\*\s*)?/, '$1function ');
  if (canReconstructAsFunction(patched)) return patched;
  // Some other shape neither form can reconstruct (e.g. a computed method
  // name) -- hand back the plain toString() anyway; a11y-core's own revival
  // will skip it the same way it always has for an unreconstructable
  // descriptor, rather than this method inventing a different failure mode.
  return direct;
}

module.exports = { canReconstructAsFunction, toReconstructableSource };
