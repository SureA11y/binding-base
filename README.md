# @surea11y/binding-base

Shared, driver-agnostic scaffolding for [`@surea11y/core`](https://github.com/SureA11y/core)'s framework bindings — `@surea11y/playwright`, `@surea11y/puppeteer`, `@surea11y/selenium`, `@surea11y/webdriverio`, and `@surea11y/cypress`.

**Not useful on its own.** This package has no driver dependency and doesn't know how to scan a page by itself — it exists purely to hold the logic that was, until this package existed, copy-pasted byte-for-byte across all five binding projects' own `A11yCoreBuilder.js` files: the fluent scoping methods (`include`/`exclude`/`withTags`/`disableTags`/`withRules`/`disableRules`/`options`), `reportOnly()`/`elementRef()`/`frames()`'s flag-tracking, `withCustomRules()`'s validation, and `formatFailures()`.

Extracted once five real consumers existed and the duplication was actually costing something — each binding carried the same logic in parallel, and keeping it in sync by hand across five packages was no longer worth the cost once there were that many consumers to justify a shared package.

## What's here

- **`A11yCoreBuilderBase`** — a class each binding's own `A11yCoreBuilder` extends. Owns the constructor's shared state, every scoping/config method, and `_buildEngineArgs()` (derives surea11y's `(pageUrl, contextSelector, engineOptions, runOnly)` call shape from that state). Does **not** implement `analyze()` — that's 100% driver-specific and stays in each binding.
- **`_normalizeCustomRule(rule)`** — the one real point of behavioral divergence across bindings, exposed as an overridable hook. The default (correct for Playwright/Puppeteer/Selenium/WebdriverIO) stringifies a live `runInPage`/`applicability` function via `toReconstructableSource()`, since those drivers cross a real serialization boundary (`page.evaluate()`/`executeScript()`/`browser.execute()`) that can't carry a live `Function` reference. Cypress overrides this to a no-op passthrough, since its test code shares a browser tab with the page it's scanning and needs no stringification.
- **`canReconstructAsFunction`/`toReconstructableSource`** — the reconstruction-verification helpers `_normalizeCustomRule`'s default uses, exported separately in case a binding needs them directly.
- **`formatFailures`** — turns a `checksResults` array into a short, human-readable failure block. Framework-agnostic, no assertion-library dependency.
- **`VALID_OUTCOMES`** — the four valid `checksResults` outcome strings (`'pass' | 'fail' | 'cantTell' | 'notApplicable'`), typed as `Outcome` in the `.d.ts`. Exported so a binding can validate against the same list `reportOnly()` uses internally.

### `exclude(selector, opts?)`

`exclude(selector)` skips elements matching `selector` everywhere in the scanned scope (surea11y's `engineOptions.excludeSelectors`). Passing `opts.rules` scopes that exclusion to just the named rule ID(s) instead — on top of, not instead of, any global exclusions from other `.exclude(selector)` calls:

```js
builder
  // global: skipped by every rule
  .exclude('#cookie-banner')
  // rule-scoped: '.mat-select' is only skipped by aria-required-children --
  // color-contrast and every other rule still sees it
  .exclude('.mat-select', { rules: ['aria-required-children'] })
  // one selector can be scoped to several rules in one call
  .exclude('.mat-option', { rules: ['aria-required-children', 'color-contrast'] });
```

`opts.rules` accepts a single rule ID or an array, and the same bare / `a11ycore-`-prefixed forms `withRules()`/`disableRules()` accept. `_buildEngineArgs()` compiles the accumulated rule-scoped selectors into `engineOptions.rules[ruleId].excludeSelectors`, merged with (never clobbering) any per-rule config already set via a raw `.options({ rules })` call.

## What's deliberately NOT here

Anything that actually touches a driver: the constructor's driver-handle validation, `analyze()`'s injection mechanics, all frame-traversal logic (each binding's is structurally different — flat array iteration, recursive DOM walk, stateful context-switching with unwinding, stateful context-switching with index-path replay), and `_attachElementRefs()` (different API per driver, and even the output field name differs: `elementHandle` vs `element`).

## Consuming this from a binding

```json
{
  "dependencies": {
    "@surea11y/binding-base": "^1.0.0"
  }
}
```

```js
const { A11yCoreBuilderBase } = require('@surea11y/binding-base');

class A11yCoreBuilder extends A11yCoreBuilderBase {
  constructor({ page, url } = {}) {
    super({ url });
    if (!page) throw new Error('...');
    this._page = page;
  }

  async analyze() {
    const { contextSelector, engineOptions, runOnly } = this._buildEngineArgs();
    // ...driver-specific injection, using contextSelector/engineOptions/runOnly...
    const result = /* ...native result from the driver-specific injection above... */;
    return this._applyReportOnly(result);
  }
}
```

This package's own `.d.ts` is not referenced by any binding's consumer-facing `.d.ts` — each binding's `A11yCoreBuilder.d.ts` declares a flat, non-inheriting ambient `export class A11yCoreBuilder { ... }`, so the inheritance here is invisible to TypeScript consumers.

## Testing

Pure Node logic, no browser needed:

```bash
npm test
```

## Maintainer

Maintained by [Jorge Rumoroso](https://github.com/rumoroso).

## License

MIT — see [`LICENSE`](./LICENSE).

This package depends on [`@surea11y/core`](https://github.com/SureA11y/core), which is MPL-2.0. MPL-2.0's copyleft is file-level and applies only to `@surea11y/core`'s own source files; consuming it as a normal package dependency doesn't affect this package's license.
