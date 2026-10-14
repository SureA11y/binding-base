# @surea11y/binding-base

Shared, driver-agnostic scaffolding for [`@surea11y/core`](https://github.com/SureA11y/core)'s framework bindings — `@surea11y/playwright`, `@surea11y/puppeteer`, `@surea11y/selenium`, `@surea11y/webdriverio`, and `@surea11y/cypress`.

> **Looking to check accessibility?** Install the package for your tool instead: [`@surea11y/playwright`](https://github.com/SureA11y/playwright), [`@surea11y/puppeteer`](https://github.com/SureA11y/puppeteer), [`@surea11y/selenium`](https://github.com/SureA11y/selenium), [`@surea11y/webdriverio`](https://github.com/SureA11y/webdriverio) or [`@surea11y/cypress`](https://github.com/SureA11y/cypress) for browser tests, [`@surea11y/test-matchers`](https://github.com/SureA11y/test-matchers) for Jest or Vitest component tests, or [`@surea11y/cli`](https://github.com/SureA11y/cli) for the terminal or CI. None of them needs this package installed separately.

**Not useful on its own.** This package has no driver dependency and doesn't know how to scan a page by itself — it exists purely to hold the logic that was, until this package existed, copy-pasted byte-for-byte across all five binding projects' own `A11yCoreBuilder.js` files: the fluent scoping methods (`include`/`exclude`/`withTags`/`disableTags`/`withRules`/`disableRules`/`options`), `reportOnly()`/`elementRef()`/`frames()`'s flag-tracking, `withCustomRules()`'s validation, and `formatFailures()`; since 1.2.0, what every binding needs to read `@surea11y/core` 1.10.0's errors and results the same way; and, since 1.3.0, what core 1.11 adds to a scan: packs, WCAG targets and best practices.

Extracted once five real consumers existed and the duplication was actually costing something — each binding carried the same logic in parallel, and keeping it in sync by hand across five packages was no longer worth the cost once there were that many consumers to justify a shared package.

## What's here

- **`A11yCoreBuilderBase`** — a class each binding's own `A11yCoreBuilder` extends. Owns the constructor's shared state, every scoping/config method, and `_buildEngineArgs()` (derives surea11y's `(pageUrl, contextSelector, engineOptions, runOnly)` call shape from that state). Does **not** implement `analyze()` — that's 100% driver-specific and stays in each binding.
- **`withWcag(version, level?)` / `withBestPractices()`** — select by conformance target, core 1.11's `runOnly.wcag`: `withWcag('2.2', 'AA')` runs the rules for WCAG 2.2's A and AA criteria, and `withBestPractices()` adds the rules that name no WCAG criterion. `withTags()` and `withRules()` add to a target's rules, and the disable methods apply after. A version other than `'2.0'`, `'2.1'` or `'2.2'`, or a level other than `'A'`, `'AA'` or `'AAA'`, throws a `TypeError` with `code: 'INVALID_RUN_ONLY'` at the call. Each call replaces the previous target.
- **`includeMode(mode)`** — how `withTags()` and `withRules()` combine when both are given, core's `runOnly.includeMode`. `'and'`, the engine's default, runs only the rules that match both; `'or'` runs those that match either. It's what lets a scan say "this area, plus these checks". A team that owns a design system's form components, say, can run every rule about forms and the contrast check too, in one scan:

  ```js
  builder.withTags('forms').withRules('contrast-computable').includeMode('or');
  ```

  Without `includeMode('or')`, those two lines run no rule at all, since `contrast-computable` isn't tagged `forms`, and a scan of no rules looks clean. The same goes for a WCAG level tag beside a best practice: `.withTags('wcag2a').withRules('region')` runs nothing, and with `'or'` runs the `wcag2a` rules plus `region`. The mode is sent only when set, and on its own, with no other selection, it changes nothing, as in core. Anything other than `'and'` or `'or'` throws a `TypeError` with `code: 'INVALID_RUN_ONLY'` at the call. Each call replaces the previous mode. A `withWcag()` target doesn't need it: its rules are always added to what tags and rules select.
- **`wcagLevel(level)`** — the WCAG level of the criteria a scan reports, core's `engineOptions.wcagLevel` (the core release after 1.11.1). Criteria above it are left out of `rulesResults`, while every selected rule still runs and reports in `checksResults`. It's what lets a scan that names a few checks say it is meant as WCAG AA. A team that gates each pull request on colour contrast alone, say, runs one check, which covers both 1.4.3 (AA) and 1.4.6 (AAA):

  ```js
  builder.withRules('contrast-computable').wcagLevel('AA');
  ```

  Without `wcagLevel('AA')`, that scan reports 1.4.6 as well, so a site that meets AA can show a failing AAA criterion it never aimed for. With it, the scan reports 1.4.3 alone, and `results.engine.wcagLevel` says `'AA'`. `withWcag()` targets already imply their level; `wcagLevel()` is for selections that don't, and wins when both are given. `'A'`, `'AA'` or `'AAA'` in any case is accepted and sent in capitals, and it wins over a level given through `options()`. Anything else throws a `TypeError` with `code: 'INVALID_ENGINE_OPTIONS'` at the call, `null` clears it, and each call replaces the previous level.
- **`_normalizeCustomRule(rule)`** — the one real point of behavioral divergence across bindings, exposed as an overridable hook. The default (correct for Playwright/Puppeteer/Selenium/WebdriverIO) stringifies a live `runInPage`/`applicability` function via `toReconstructableSource()`, since those drivers cross a real serialization boundary (`page.evaluate()`/`executeScript()`/`browser.execute()`) that can't carry a live `Function` reference. Cypress overrides this to a no-op passthrough, since its test code shares a browser tab with the page it's scanning and needs no stringification.
- **`canReconstructAsFunction`/`toReconstructableSource`** — the reconstruction-verification helpers `_normalizeCustomRule`'s default uses, exported separately in case a binding needs them directly.
- **`formatFailures`** — turns a `checksResults` array into a short, human-readable failure block. Framework-agnostic, no assertion-library dependency.
- **`VALID_OUTCOMES`** — the four valid `checksResults` outcome strings (`'pass' | 'fail' | 'cantTell' | 'notApplicable'`), typed as `Outcome` in the `.d.ts`. Exported so a binding can validate against the same list `reportOnly()` uses internally.
- **`createInPageScan(runa11yCoreInPage)` / `rethrowEngineError(value)` / `EngineError` / `ENGINE_ERROR_CODES`** — keep the `code` of an engine error across the driver. Since 1.10.0, `@surea11y/core` throws with `code: 'INVALID_RUN_ONLY'` when a rule or tag list names nothing it knows, and `code: 'INVALID_CONTEXT_SELECTOR'` (with `selector`) for an `include()` selector the browser can't parse. Since 1.11.0 it also throws `INVALID_ENGINE_OPTIONS` for an option `strictOptions: true` rejects, and `PAGE_BUILTINS_BROKEN` when the page's scripts broke a JavaScript built-in the engine relies on. `page.evaluate()`/`executeScript()`/`browser.execute()` keep only the message. `createInPageScan()` wraps core's function in a self-contained one with the same four parameters that returns such an error as a plain object; `rethrowEngineError()` throws it again on the Node side as an `EngineError` with `code` and `selector`, and returns anything else unchanged. Errors without a `code` are thrown in the page as before.
- **`getScanGaps(result)`** — what a result says it left out, which its `checksResults` alone would pass over as clean: `{ kind: 'context-not-found' }` when the `include()` scope matched nothing (since core 1.10.0 nothing is then scanned), `'context-partly-not-found'` when some of several selectors matched nothing, one `'custom-rule-skipped'` per entry of `skippedCustomRules`, and, since core 1.11, one `'pack-skipped'` per entry of `skippedPacks` (a pack whose `core` range leaves out the running core, or that the page didn't register). Each has a `message`. A result from an earlier core gives `[]`.
- **`logger(fn)` / `_warnScanGaps(result, source)`** — where a binding's `analyze()` sends the scan gaps it reports. By default each gap is printed with `console.warn`, once per scanned frame, as `@surea11y/puppeteer (https://example.com/): Nothing was scanned: the scan scope matched no element ("#main").`, so a mistyped scope shows in a test run's log even where nothing asserts on it. That stays the default. A project that already handles gaps itself can take them over with `logger(fn)`: `fn(gap, result)` is called once per gap, with the gap as `getScanGaps()` gives it and the result of the frame it came from, and `console.warn` isn't called. `() => {}` silences them, and `null` brings `console.warn` back. Anything other than a function or `null` throws a `TypeError`. Each call replaces the previous logger.

  That fits a scanning service, which shows gaps to its users and wants them once in its own structured log rather than again as a loose line on the server's console for every scan:

  ```js
  const results = await new A11yCoreBuilder({ page })
    .include('#checkout')
    .logger((gap, frame) => log.warn({ url: frame.url, kind: gap.kind }, gap.message))
    .analyze();
  ```

  A batch job that writes `getScanGaps()` into its own report can use `.logger(() => {})` to keep its output to the report. A binding's `analyze()` calls `this._warnScanGaps(result, '@surea11y/<binding>')` for each scanned frame's result. It passes over anything that isn't a scan result, such as a frame that errored. `@surea11y/cypress` shows gaps in the Command Log instead and doesn't use it.
- **`queryOccurrenceElement(selector, shadowHostSelectors, root?)`** — finds the element an occurrence points at, through its shadow hosts. Since core 1.10.0 an occurrence inside a shadow tree carries `shadowHostSelectors`, and its `selector` holds only inside the last host's shadow root, so looking it up in the document finds the wrong element or none. Self-contained, so a driver can send it into the page. **`formatOccurrenceLocation(occurrence)`** gives the same location as text, `host >>> selector`.

### `withPacks(packs)` and `_packScript()`

A pack brings rules, a standard or a checklist, and their profiles and messages, from a package of its own: a national standard such as RGAA, or an organisation's own policy. It is written with `definePack` from `@surea11y/core/pack` (see core's [`docs/PACKS.md`](https://github.com/SureA11y/core/blob/main/docs/PACKS.md)), and needs `@surea11y/core` 1.11.1 or later. A pack is an object prepared in Node and can't cross into the page, so `withPacks()` does two things:

- `_buildEngineArgs()` names the packs in `engineOptions.packs`, as `name@version`, after any names a raw `.options({ packs })` gave.
- `_packScript()` returns the script that registers them in a page, built once per set of packs, or `null` without packs. A binding's `analyze()` injects it in every frame it scans, before the scan.

The script is built with the core the binding loads (`@surea11y/core/pack`'s `packScript`), and a page refuses packs prepared with another core version. A pack surea11y can't run throws when the script is built; one the page doesn't run is listed in the result's `skippedPacks`, which `getScanGaps()` reports as `'pack-skipped'`. A pack's profile is chosen with `.options({ profile })`:

```js
const policy = require('@acme/a11y-policy'); // a pack, written with definePack()

builder.withPacks(policy).options({ profile: 'acme-policy' });
```

### `formatFailures(resultOrChecks, { outcomes? })`

Given `checksResults`, it lists one entry per `fail`/`cantTell` occurrence, as it always has. Given the whole result, it also adds the result's scan gaps and the core release that produced it (`engine.version`), and a scan that left something out does not read as clean: with no findings, it opens with "No accessibility violations found in what was scanned." rather than "No accessibility violations found.", or, when the scope matched nothing, with the gap itself:

```
1) img-alt-present (serious): Image has no text alternative.
   at my-gallery >>> img
   Add an alt attribute.

Part of the scan scope was not scanned: no element matched "#sidebar".
Custom rule "my-rule" did not run: runInPage source could not be turned back into a function.
Pack "@acme/a11y-policy" did not run: it supports core ^2.0.0, and this is core 1.11.1.

Scanned with @surea11y/core 1.11.1.
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
    "@surea11y/binding-base": "^1.3.0"
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
