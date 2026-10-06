# @surea11y/binding-base

Shared, driver-agnostic scaffolding for [`@surea11y/core`](https://github.com/SureA11y/core)'s framework bindings — `@surea11y/playwright`, `@surea11y/puppeteer`, `@surea11y/selenium`, `@surea11y/webdriverio`, and `@surea11y/cypress`.

**Not useful on its own.** This package has no driver dependency and doesn't know how to scan a page by itself — it exists purely to hold the logic that was, until this package existed, copy-pasted byte-for-byte across all five binding projects' own `A11yCoreBuilder.js` files: the fluent scoping methods (`include`/`exclude`/`withTags`/`disableTags`/`withRules`/`disableRules`/`options`), `reportOnly()`/`elementRef()`/`frames()`'s flag-tracking, `withCustomRules()`'s validation, and `formatFailures()`; and, since 1.2.0, what every binding needs to read `@surea11y/core` 1.10.0's errors and results the same way.

Extracted once five real consumers existed and the duplication was actually costing something — each binding carried the same logic in parallel, and keeping it in sync by hand across five packages was no longer worth the cost once there were that many consumers to justify a shared package.

## What's here

- **`A11yCoreBuilderBase`** — a class each binding's own `A11yCoreBuilder` extends. Owns the constructor's shared state, every scoping/config method, and `_buildEngineArgs()` (derives surea11y's `(pageUrl, contextSelector, engineOptions, runOnly)` call shape from that state). Does **not** implement `analyze()` — that's 100% driver-specific and stays in each binding.
- **`_normalizeCustomRule(rule)`** — the one real point of behavioral divergence across bindings, exposed as an overridable hook. The default (correct for Playwright/Puppeteer/Selenium/WebdriverIO) stringifies a live `runInPage`/`applicability` function via `toReconstructableSource()`, since those drivers cross a real serialization boundary (`page.evaluate()`/`executeScript()`/`browser.execute()`) that can't carry a live `Function` reference. Cypress overrides this to a no-op passthrough, since its test code shares a browser tab with the page it's scanning and needs no stringification.
- **`canReconstructAsFunction`/`toReconstructableSource`** — the reconstruction-verification helpers `_normalizeCustomRule`'s default uses, exported separately in case a binding needs them directly.
- **`formatFailures`** — turns a `checksResults` array into a short, human-readable failure block. Framework-agnostic, no assertion-library dependency.
- **`VALID_OUTCOMES`** — the four valid `checksResults` outcome strings (`'pass' | 'fail' | 'cantTell' | 'notApplicable'`), typed as `Outcome` in the `.d.ts`. Exported so a binding can validate against the same list `reportOnly()` uses internally.
- **`createInPageScan(runa11yCoreInPage)` / `rethrowEngineError(value)` / `EngineError` / `ENGINE_ERROR_CODES`** — keep the `code` of an engine error across the driver. Since 1.10.0, `@surea11y/core` throws with `code: 'INVALID_RUN_ONLY'` when a rule or tag list names nothing it knows, and `code: 'INVALID_CONTEXT_SELECTOR'` (with `selector`) for an `include()` selector the browser can't parse. `page.evaluate()`/`executeScript()`/`browser.execute()` keep only the message. `createInPageScan()` wraps core's function in a self-contained one with the same four parameters that returns such an error as a plain object; `rethrowEngineError()` throws it again on the Node side as an `EngineError` with `code` and `selector`, and returns anything else unchanged. Errors without a `code` are thrown in the page as before.
- **`getScanGaps(result)`** — what a result says it left out, which its `checksResults` alone would pass over as clean: `{ kind: 'context-not-found' }` when the `include()` scope matched nothing (since core 1.10.0 nothing is then scanned), `'context-partly-not-found'` when some of several selectors matched nothing, and one `'custom-rule-skipped'` per entry of `skippedCustomRules`. Each has a `message`. A result from an earlier core gives `[]`.
- **`queryOccurrenceElement(selector, shadowHostSelectors, root?)`** — finds the element an occurrence points at, through its shadow hosts. Since core 1.10.0 an occurrence inside a shadow tree carries `shadowHostSelectors`, and its `selector` holds only inside the last host's shadow root, so looking it up in the document finds the wrong element or none. Self-contained, so a driver can send it into the page. **`formatOccurrenceLocation(occurrence)`** gives the same location as text, `host >>> selector`.

### `formatFailures(resultOrChecks, { outcomes? })`

Given `checksResults`, it lists one entry per `fail`/`cantTell` occurrence, as it always has. Given the whole result, it also adds the result's scan gaps and the core release that produced it (`engine.version`), and a scan whose scope matched nothing does not read as clean:

```
1) img-alt-present (serious): Image has no text alternative.
   at my-gallery >>> img
   Add an alt attribute.

Part of the scan scope was not scanned: no element matched "#sidebar".
Custom rule "my-rule" did not run: runInPage source could not be turned back into a function.

Scanned with @surea11y/core 1.10.0.
```

It throws a `TypeError` for anything else, such as the `{ topFrame, frames }` tree of a `frames(true)` scan: format `topFrame` and each frame on its own.

### Rule and tag lists

`withTags()`/`disableTags()`/`withRules()`/`disableRules()` take a string or an array of strings, and throw a `TypeError` with `code: 'INVALID_RUN_ONLY'` at the call for anything else (`undefined` from a missing config value, an empty string). Since core 1.10.0 the scan itself throws `INVALID_RUN_ONLY` when none of the rule IDs, or none of the tags, in an include list is one it knows, and warns about an unknown one beside known ones.

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
    "@surea11y/binding-base": "^1.2.0"
  }
}
```

```js
const { runa11yCoreInPage } = require('@surea11y/core');
const { A11yCoreBuilderBase, createInPageScan, rethrowEngineError } = require('@surea11y/binding-base');

const inPageScan = createInPageScan(runa11yCoreInPage);

class A11yCoreBuilder extends A11yCoreBuilderBase {
  constructor({ page, url } = {}) {
    super({ url });
    if (!page) throw new Error('...');
    this._page = page;
  }

  async analyze() {
    const { contextSelector, engineOptions, runOnly } = this._buildEngineArgs();
    // ...driver-specific injection of inPageScan, using contextSelector/engineOptions/runOnly, e.g.
    const result = rethrowEngineError(await this._page.evaluate(inPageScan, this._url, contextSelector, engineOptions, runOnly));
    return this._applyReportOnly(result);
  }
}
```

This package's own `.d.ts` is not referenced by any binding's consumer-facing `.d.ts` — each binding's `A11yCoreBuilder.d.ts` declares a flat, non-inheriting ambient `export class A11yCoreBuilder { ... }`, so the inheritance here is invisible to TypeScript consumers.

## Testing

No browser needed:

```bash
npm test
```

Besides unit tests, this runs the builder's arguments through the real `@surea11y/core` in jsdom, sending the scan and `queryOccurrenceElement()` into the page from their source as a driver does, and compiles `src/index.d.ts` against core's own types. `@surea11y/core`, `jsdom` and `typescript` are dev dependencies only.

## Maintainer

Maintained by [Jorge Rumoroso](https://github.com/rumoroso).

## License

MIT — see [`LICENSE`](./LICENSE).

This package has no runtime dependency on [`@surea11y/core`](https://github.com/SureA11y/core) (MPL-2.0): each binding depends on core itself and passes in what this package needs, such as `runa11yCoreInPage`. Core is a dev dependency, for the tests only. MPL-2.0's copyleft is file-level and applies only to `@surea11y/core`'s own source files; using it as a normal package dependency doesn't affect this package's license.
