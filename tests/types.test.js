'use strict';

// src/index.d.ts is written by hand. Compile a typical use of it beside
// @surea11y/core's own types, so a declaration that doesn't fit the
// engine's (as formatFailures()'s once didn't) fails here.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('index.d.ts compiles against @surea11y/core\'s types', () => {
  // TypeScript 7 exports no bin/tsc subpath, so find it beside its package.json.
  const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
  const file = path.join(__dirname, 'types', 'usage.ts');
  try {
    execFileSync(process.execPath, [tsc, '--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--lib', 'es2022,dom', file], { stdio: 'pipe' });
  } catch (e) {
    assert.fail(String(e.stdout) + String(e.stderr));
  }
});
