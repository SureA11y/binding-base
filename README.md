# a11y-core-binding-base

Shared, driver-agnostic scaffolding for [`a11y-core`](../a11y-core)'s framework bindings — [`a11y-core-playwright`](../a11y-core-playwright), [`a11y-core-puppeteer`](../a11y-core-puppeteer), [`a11y-core-selenium`](../a11y-core-selenium), [`a11y-core-webdriverio`](../a11y-core-webdriverio), and [`a11y-core-cypress`](../a11y-core-cypress).

**Not useful on its own.** This package has no driver dependency and doesn't know how to scan a page by itself — it exists purely to hold the logic that was, until this package existed, copy-pasted byte-for-byte across all five binding projects' own `A11yCoreBuilder.js` files: the fluent scoping methods (`include`/`exclude`/`withTags`/`disableTags`/`withRules`/`disableRules`/`options`), `reportOnly()`/`elementRef()`/`frames()`'s flag-tracking, `withCustomRules()`'s validation, and `formatFailures()`.

Extracted once five real consumers existed and the duplication was actually costing something (each sibling binding's own `ROADMAP.md` flagged this exact extraction as the right next step, deliberately deferred until there were enough consumers to justify it — see e.g. `../a11y-core-selenium/ROADMAP.md`'s note on this).

## What's here

- **`A11yCoreBuilderBase`** — a class each binding's own `A11yCoreBuilder` extends. Owns the constructor's shared state, every scoping/config method, and `_buildEngineArgs()` (derives a11y-core's `(pageUrl, contextSelector, engineOptions, runOnly)` call shape from that state). Does **not** implement `analyze()` — that's 100% driver-specific and stays in each binding.
- **`_normalizeCustomRule(rule)`** — the one real point of behavioral divergence across bindings, exposed as an overridable hook. The default (correct for Playwright/Puppeteer/Selenium/WebdriverIO) stringifies a live `runInPage`/`applicability` function via `toReconstructableSource()`, since those drivers cross a real serialization boundary (`page.evaluate()`/`executeScript()`/`browser.execute()`) that can't carry a live `Function` reference. Cypress overrides this to a no-op passthrough, since its test code shares a browser tab with the page it's scanning and needs no stringification (see its own `ROADMAP.md` §2b/§2f).
- **`canReconstructAsFunction`/`toReconstructableSource`** — the reconstruction-verification helpers `_normalizeCustomRule`'s default uses, exported separately in case a binding needs them directly.
- **`formatFailures`** — turns a `checksResults` array into a short, human-readable failure block. Framework-agnostic, no assertion-library dependency.

## What's deliberately NOT here

Anything that actually touches a driver: the constructor's driver-handle validation, `analyze()`'s injection mechanics, all frame-traversal logic (each binding's is structurally different — flat array iteration, recursive DOM walk, stateful context-switching with unwinding, stateful context-switching with index-path replay), and `_attachElementRefs()` (different API per driver, and even the output field name differs: `elementHandle` vs `element`).

## Consuming this from a binding

```json
{
  "dependencies": {
    "@a11y-core/binding-base": "file:../binding-base"
  }
}
```

```js
const { A11yCoreBuilderBase } = require('a11y-core-binding-base');

class A11yCoreBuilder extends A11yCoreBuilderBase {
  constructor({ page, url } = {}) {
    super({ url });
    if (!page) throw new Error('...');
    this._page = page;
  }

  async analyze() {
    const { contextSelector, engineOptions, runOnly } = this._buildEngineArgs();
    // ...driver-specific injection, using contextSelector/engineOptions/runOnly...
  }
}
```

This package's own `.d.ts` is not referenced by any binding's consumer-facing `.d.ts` — each binding's `A11yCoreBuilder.d.ts` declares a flat, non-inheriting ambient `export class A11yCoreBuilder { ... }`, so the inheritance here is invisible to TypeScript consumers.

## Testing

Pure Node logic, no browser needed:

```bash
npm test
```
