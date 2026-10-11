'use strict';

// A Cypress spec bundles this package for the browser through webpack, which
// follows every plain require(): one of a Node-only module (core's pack.js
// uses fs and vm) fails the spec's build.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function reached(entry) {
  const seen = new Set();
  const outside = [];
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const id = m[1];
      if (!id.startsWith('.')) {
        outside.push(`${path.relative(ROOT, file)} requires ${id}`);
        continue;
      }
      const target = path.resolve(path.dirname(file), id);
      visit(fs.existsSync(target + '.js') ? target + '.js' : target);
    }
  };
  visit(entry);
  return outside;
}

test('the entry requires nothing outside this package, so a browser bundle of it builds', () => {
  assert.deepStrictEqual(reached(path.join(ROOT, 'src', 'index.js')), []);
});
