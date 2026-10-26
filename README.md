# @surea11y/binding-base

Shared, driver-agnostic scaffolding for [`@surea11y/core`](https://github.com/SureA11y/core)'s framework bindings — `@surea11y/playwright`, `@surea11y/puppeteer`, `@surea11y/selenium`, `@surea11y/webdriverio`, and `@surea11y/cypress`.

> **Looking to check accessibility?** Install `@surea11y/core` with the package for your tool instead: [`@surea11y/playwright`](https://github.com/SureA11y/playwright), [`@surea11y/puppeteer`](https://github.com/SureA11y/puppeteer), [`@surea11y/selenium`](https://github.com/SureA11y/selenium), [`@surea11y/webdriverio`](https://github.com/SureA11y/webdriverio) or [`@surea11y/cypress`](https://github.com/SureA11y/cypress) for browser tests, [`@surea11y/test-matchers`](https://github.com/SureA11y/test-matchers) for Jest or Vitest component tests. For the terminal or CI, install [`@surea11y/cli`](https://github.com/SureA11y/cli) on its own; it brings core with it. None of them needs this package installed separately.

**Not useful on its own.** This package has no driver dependency and doesn't know how to scan a page by itself — it exists purely to hold the logic that was, until this package existed, copy-pasted byte-for-byte across all five binding projects' own `A11yCoreBuilder.js` files: the fluent scoping methods (`include`/`exclude`/`withTags`/`disableTags`/`withRules`/`disableRules`/`options`), `reportOnly()`/`elementRef()`/`frames()`'s flag-tracking, `withCustomRules()`'s validation, and `formatFailures()`; since 1.2.0, what every binding needs to read `@surea11y/core` 1.10.0's errors and results the same way; since 1.3.0, what core 1.11 adds to a scan: packs, WCAG targets and best practices; and, since 1.4.0, what core 1.12.0 adds: `wcagLevel()`, notes on forced colors and the internals hook, and `plannedChecks()`/`plannedCriteria()`, the list of what a scan will check before it runs; since 1.5.0, `.screenshots()`, a picture of each element a scan flags, with what a binding needs to take them; and, since 1.6.0, fetching the style sheets a page can't read, which core 1.14.0 then checks, and what else core 1.14.0 adds: the steps that answer each undecided finding, findings read by their own outcome and lean, and notes on the listener and live-region hooks.

Extracted once five real consumers existed and the duplication was actually costing something — each binding carried the same logic in parallel, and keeping it in sync by hand across five packages was no longer worth the cost once there were that many consumers to justify a shared package.

## What's here

- **`A11yCoreBuilderBase`** — a class each binding's own `A11yCoreBuilder` extends. Owns the constructor's shared state, every scoping/config method, and `_buildEngineArgs()` (derives surea11y's `(pageUrl, contextSelector, engineOptions, runOnly)` call shape from that state). Does **not** implement `analyze()` — that's 100% driver-specific and stays in each binding.
- **`withWcag(version, level?)` / `withBestPractices()`** — select by conformance target, core 1.11's `runOnly.wcag`: `withWcag('2.2', 'AA')` runs the rules for WCAG 2.2's A and AA criteria, and `withBestPractices()` adds the rules that name no WCAG criterion. `withTags()` and `withRules()` add to a target's rules, and the disable methods apply after. The level is read in any case (`'aa'` is `'AA'`). A version other than `'2.0'`, `'2.1'` or `'2.2'`, or a level other than A, AA or AAA, throws a `TypeError` with `code: 'INVALID_RUN_ONLY'` at the call. Each call replaces the previous target.
- **`includeMode(mode)`** — how `withTags()` and `withRules()` combine when both are given, core's `runOnly.includeMode`. `'and'`, the engine's default, runs only the rules that match both; `'or'` runs those that match either. It's what lets a scan say "this area, plus these checks". A team that owns a design system's form components, say, can run every rule about forms and the contrast check too, in one scan:

  ```js
  builder.withTags('forms').withRules('contrast-computable').includeMode('or');
  ```

  Without `includeMode('or')`, those two lines run no rule at all, since `contrast-computable` isn't tagged `forms`, and a scan of no rules looks clean. The same goes for a WCAG level tag beside a best practice: `.withTags('wcag2a').withRules('region')` runs nothing, and with `'or'` runs the `wcag2a` rules plus `region`. The mode is sent only when set, and on its own, with no other selection, it changes nothing, as in core. Anything other than `'and'` or `'or'` throws a `TypeError` with `code: 'INVALID_RUN_ONLY'` at the call. Each call replaces the previous mode. A `withWcag()` target doesn't need it: its rules are always added to what tags and rules select.
- **`wcagLevel(level)`** — the WCAG level of the criteria a scan *reports*, without changing which rules *run* (core's `engineOptions.wcagLevel`, core 1.12.0 and later). Use it when you select checks by rule id or tag but gate on a level. `contrast-computable` checks both 1.4.3 (AA) and 1.4.6 (AAA), so a contrast-only scan reports an AAA failure an AA site never aimed for, unless you say the level:

  ```js
  const results = await new A11yCoreBuilder({ page })
    .withRules('contrast-computable')
    .wcagLevel('AA')
    .analyze();

  results.rulesResults.map((r) => r.ruleId); // ['wcag-1.4.3-contrast-minimum'] -- no 1.4.6
  results.engine.wcagLevel;                 // 'AA'
  ```

  The check itself still runs and reports in `checksResults`. A `withWcag()` target already implies its level, so you rarely need both; when you give both, `wcagLevel()` wins. The level is read in any case and sent in capitals, and wins over one given through `options()`. Anything other than A, AA or AAA throws a `TypeError` with `code: 'INVALID_ENGINE_OPTIONS'` (the code core uses for the option) at the call; `null` clears it; each call replaces the previous level.
- **`plannedChecks()` / `plannedCriteria()`** — what a scan with this builder *will* check, before it runs: the rules it runs (core's `getChecksForRunOnly()`, entries with `ruleId`) and the criteria it reports in `rulesResults` (`getRulesForRunOnly()`, entries with `id`). They're worked out from the same selection and options `analyze()` sends, packs, custom rules and `wcagLevel()` included, so they match the result. Synchronous, in Node, no page needed. Use them to record what a run covers next to its result, or to catch a selection that picks nothing, which would otherwise look like a clean scan:

  ```js
  const builder = new A11yCoreBuilder({ page }).withTags('forms').withRules('contrast-computable');
  if (!builder.plannedChecks().length) throw new Error('This selection runs no rule -- did you mean includeMode("or")?');

  new A11yCoreBuilder({ page }).withWcag('2.2', 'AA').plannedCriteria().map((r) => r.id);
  // ['wcag-1.1.1-non-text-content', 'wcag-1.2.1-audio-only-video-only-prerecorded', ...]
  ```

  They need `@surea11y/core` 1.12.0 or later, installed beside the binding (every binding depends on it); an older or missing core throws an error saying so.
- **`_normalizeCustomRule(rule)`** — the one real point of behavioral divergence across bindings, exposed as an overridable hook. The default (correct for Playwright/Puppeteer/Selenium/WebdriverIO) stringifies a live `runInPage`/`applicability` function via `toReconstructableSource()`, since those drivers cross a real serialization boundary (`page.evaluate()`/`executeScript()`/`browser.execute()`) that can't carry a live `Function` reference. Cypress overrides this to a no-op passthrough, since its test code shares a browser tab with the page it's scanning and needs no stringification.
- **`canReconstructAsFunction`/`toReconstructableSource`** — the reconstruction-verification helpers `_normalizeCustomRule`'s default uses, exported separately in case a binding needs them directly.
- **`formatFailures`** — turns a `checksResults` array into a short, human-readable failure block, in the order a review takes. Framework-agnostic, no assertion-library dependency. See [below](#formatfailuresresultorchecks--outcomes-howtocheck-).
- **How to check, in each result** — `_applyReportOnly(result)`, the last step a binding's `analyze()` runs on each frame's result, first passes it through core's `addHowToCheck()` (core 1.14.0 and later, `_addHowToCheck()`), with the packs given to `withPacks()`: each undecided finding gets `howToCheck`, the steps a person takes to answer it, in the scan's locale. Core leaves them out of the in-page engine, so a result from `runa11yCoreInPage` has none until then. With an older core it does nothing. In a browser bundle (a Cypress spec), where this package can't load core, the result is left as it is; a binding there adds the steps with `applyHowToCheck()` from `@surea11y/core/how-to-check` and the review dictionaries it imports.
- **`VALID_OUTCOMES`** — the four valid `checksResults` outcome strings (`'pass' | 'fail' | 'cantTell' | 'notApplicable'`), typed as `Outcome` in the `.d.ts`. Exported so a binding can validate against the same list `reportOnly()` uses internally.
- **`createInPageScan(runa11yCoreInPage)` / `rethrowEngineError(value)` / `EngineError` / `ENGINE_ERROR_CODES`** — keep the `code` of an engine error across the driver. Since 1.10.0, `@surea11y/core` throws with `code: 'INVALID_RUN_ONLY'` when a rule or tag list names nothing it knows, and `code: 'INVALID_CONTEXT_SELECTOR'` (with `selector`) for an `include()` selector the browser can't parse. Since 1.11.0 it also throws `INVALID_ENGINE_OPTIONS` for an option `strictOptions: true` rejects, and `PAGE_BUILTINS_BROKEN` when the page's scripts broke a JavaScript built-in the engine relies on. `page.evaluate()`/`executeScript()`/`browser.execute()` keep only the message. `createInPageScan()` wraps core's function in a self-contained one with the same four parameters that returns such an error as a plain object; `rethrowEngineError()` throws it again on the Node side as an `EngineError` with `code` and `selector`, and returns anything else unchanged. Errors without a `code` are thrown in the page as before.
- **`fetchStyleSheets(enabled = true)` / `_styleSheetEngineOptions(frame, engineOptions)`** — style sheets from another origin. A page's script can't read their rules, so a rule that reads the CSS, as core's `css-orientation-lock` does, can't tell whether a CDN's CSS locks the orientation and asks about it. Core 1.14.0 reads their text from `engineOptions.styleSheetTexts` instead, and its `preloadStyleSheets()` fetches, in the page, those a server shares (CORS). A binding drives the browser from Node, where no CORS applies, so it fetches the rest: in its `analyze()`, before each frame's scan,

  ```js
  engineOptions = await this._styleSheetEngineOptions(frame, engineOptions);
  ```

  asks the page which sheets it can't read (through `_evaluateInFrame()`), fetches them, each within five seconds, and adds their text, leaving out any the caller already gave. A binding whose driver has a request API that carries the page's cookies can set `this._styleSheetFetch` to a `fetch`-like function using it; otherwise the global `fetch` is used. On by default, as axe fetches such sheets; `.fetchStyleSheets(false)` turns it off. It does nothing with an older core, and never throws. `findUnreadableStyleSheets` (the in-page step, self-contained) and `fetchStyleSheetTexts(hrefs, { fetch, timeoutMs })` are exported for a binding that runs the steps itself.
- **`getScanGaps(result)`** — what a result says it left out, which its `checksResults` alone would pass over as clean: `{ kind: 'context-not-found' }` when the `include()` scope matched nothing (since core 1.10.0 nothing is then scanned), `'context-partly-not-found'` when some of several selectors matched nothing, one `'custom-rule-skipped'` per entry of `skippedCustomRules` (except a rule the caller excluded, see below), and, since core 1.11, one `'pack-skipped'` per entry of `skippedPacks` (a pack whose `core` range leaves out the running core, or that the page didn't register). Each has a `message`. A result from an earlier core gives `[]`.

  A custom rule the caller turned off on purpose isn't a gap. Core lists it in `skippedCustomRules` too, with the reason `excluded by the selection.` and, since core 1.12.0, `excluded: true`; `getScanGaps()` leaves it out, so a binding doesn't warn about it and `@surea11y/test-matchers` doesn't fail on it:

  ```js
  const results = await new A11yCoreBuilder({ page })
    .withCustomRules(orgRules)      // several rules, one of them 'org-banner-text'
    .disableRules('org-banner-text') // not on this page
    .analyze();

  results.skippedCustomRules; // [{ id: 'org-banner-text', reason: 'excluded by the selection.', excluded: true }]
  getScanGaps(results);       // [] -- nothing the scan was asked to check was left out
  ```

  A custom rule the selection leaves out on its own, such as one tagged `best-practice` under a `withWcag()` target, is still a gap: the caller asked for it and it didn't run.
- **`getScanNotes(result[, { hookReasonCodes }])`** — what a reader should know about *how* the page was scanned (core 1.12.0 and later). Unlike a gap, a note doesn't mean anything was left out, so `@surea11y/test-matchers` doesn't fail on one. Each has a `kind` and a `message`:
  - `'forced-colors'`: the page was shown in forced colors (Windows high contrast, or emulated `forced-colors: active`), so contrast findings may differ with forced colors off. Often an accident of the CI machine. With `pageCss: true` (core 1.14.0 and later), the page's own CSS also reacted to them, a `forced-colors` media query or a system color such as `GrayText`, so contrast was measured in colors the page has only then.
  - `'internals-hook'`: the scan asked about custom elements because it couldn't read the name or states they set through a private `ElementInternals`, and the [internals hook](#the-internals-hook) wasn't installed (`hook: 'none'`), or was installed after the page's scripts ran (`'late'`). `elementCount` says how many elements.
  - `'listener-hook'` and `'live-region-hook'` (core 1.14.0 and later): findings that core's listener hook (the event listeners a page adds from script, which the keyboard rules read) or live-region hook (what live regions were given) would have decided, or given a lean, were judged without it (`hook: 'none'`), or with one installed late (`'late'`). `findingCount` counts them and `rules` names their rules. Which findings those are is core's `HOOK_REASON_CODES` (the codes each hook `decides` or `leans`; one it only `reports` is given only where the hook ran), read from the core installed beside the binding. A caller where core can't be loaded, such as a browser bundle, passes them as `hookReasonCodes`, imported from `@surea11y/core/how-to-check` (core 1.14.0 and later), which needs no Node; without them there is no such note. Each note names the binding's installer, `installListenerHook()` or `installLiveRegionHook()`, which core's binding authors' guide asks every binding to offer beside `installInternalsHook()`.

  ```js
  for (const note of getScanNotes(results)) {
    if (note.kind === 'internals-hook') {
      console.log(`${note.elementCount} components could not be checked; install the hook before page.goto()`);
    }
  }
  ```

  `formatFailures()` prints every note, and a binding's `analyze()` prints each hook note (`internals-hook`, `listener-hook`, `live-region-hook`) once per scan (see `logger()` below).
- **`logger(fn)` / `_warnScanGaps(result, source)`** — where a binding's `analyze()` sends the scan gaps it reports. By default each gap is printed with `console.warn`, once per scanned frame, as `@surea11y/puppeteer (https://example.com/): Nothing was scanned: the scan scope matched no element ("#main").`, so a mistyped scope shows in a test run's log even where nothing asserts on it. That stays the default. A project that already handles gaps itself can take them over with `logger(fn)`: `fn(gap, result)` is called once per gap, with the gap as `getScanGaps()` gives it and the result of the frame it came from, and `console.warn` isn't called. The hook notes of `getScanNotes()` go the same way, each once per builder rather than once per frame; check `kind` to tell a note from a gap. `() => {}` silences them, and `null` brings `console.warn` back. Anything other than a function or `null` throws a `TypeError`. Each call replaces the previous logger.

  That fits a scanning service, which shows gaps to its users and wants them once in its own structured log rather than again as a loose line on the server's console for every scan:

  ```js
  const results = await new A11yCoreBuilder({ page })
    .include('#checkout')
    .logger((gap, frame) => log.warn({ url: frame.url, kind: gap.kind }, gap.message))
    .analyze();
  ```

  A batch job that writes `getScanGaps()` into its own report can use `.logger(() => {})` to keep its output to the report. A binding's `analyze()` calls `this._warnScanGaps(result, '@surea11y/<binding>')` for each scanned frame's result. It passes over anything that isn't a scan result, such as a frame that errored. `@surea11y/cypress` shows gaps in the Command Log instead and doesn't use it.
- **`screenshots(options?)`** — a picture of each element a scan flags, beside its finding. Off by default: pictures of real pages can hold personal data, and they end up as CI artifacts. Each occurrence considered gets a `screenshot` field:

  ```js
  const results = await new A11yCoreBuilder({ page })
    .screenshots({ dir: 'a11y-shots', padding: 16 })
    .analyze();

  results.checksResults[0].occurrences[0].screenshot;
  // { path: 'a11y-shots/element-3f9a1c07.png', box: { x: 20, y: 20, width: 120, height: 40 } }
  ```

  | Option | Default | |
  |---|---|---|
  | `dir` | none | Write each picture there. Without it, each comes back as `{ buffer, box }`, for a caller that stores images its own way. |
  | `outcomes` | `['fail']` | Which occurrences to picture, by their own outcome: `occurrenceOutcome` where the rule gives one, else the rule's. For contrast, `['fail', 'cantTell']` shows the background the engine couldn't judge. |
  | `padding` | `0` | CSS pixels of context around the element. |
  | `highlight` | `true` | Draw a box around the element. It is drawn over the page, outside the element, and removed after; the element itself is never restyled, which could change the contrast being reported. With it, the picture holds at least the 4px it takes. |
  | `max` | `50` | At most this many pictures per scan, frames included. |

  One picture per element: the occurrences about the same element share one `screenshot` object and one file, named `element-` and a hash of where the element is (frame, shadow hosts, selector), so it keeps its name from run to run. `box` is where the element shows in the picture, in CSS pixels (the image is larger by the device pixel ratio), and `cropped: true` says only part of it shows, as for an element taller than the viewport, which is pictured from its top-left corner. With no picture, `screenshot` says why: `{ skipped }` with `'no-element'` (no selector, or nothing matches it), `'page-level'` (a finding about the whole page, on `<html>`, `<head>` or `<body>`), `'not-rendered'` (no layout box, such as `display: none`), `'zero-size'`, `'off-screen'` (outside the page, such as `left: -9999px`), `'max-reached'` or `'capture-failed'` (with the driver's `error`). A failed picture never fails the scan.

  The element is scrolled into view for its picture and the page is put back afterwards: scroll positions, and the highlight removed, also when a capture fails. Something drawn over the element, such as a sticky header, shows as it does on screen. The pictures are taken right after each frame's scan, but focus, hover, animations or content that loads late can still differ from what the scan saw. `.screenshots()` and `.screenshots(true)` use the defaults, `.screenshots(false)` turns them off, and each call replaces the previous options. An option it can't use throws a `TypeError` with `code: 'INVALID_ENGINE_OPTIONS'` at the call, and so does a scan with `output.includeSelector: false`, since an element is found by its selector. `formatFailures()` names each written file under its finding (`   screenshot: a11y-shots/element-3f9a1c07.png`). A binding that doesn't take screenshots yet throws when `.screenshots()` is called; see [Screenshots of failing elements](#screenshots-of-failing-elements) for what one needs.
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

### `formatFailures(resultOrChecks, { outcomes?, howToCheck? })`

Given `checksResults`, it lists one entry per `fail`/`cantTell` occurrence, each read by its own outcome (`occurrenceOutcome` where the rule gives one), since a rule's findings can sit in different tiers: a failing rule's questions are questions, and `{ outcomes: ['fail'] }` leaves them out. The entries come in the order a review takes, the groups core's HTML report uses: failures, then the questions that lean fail, those that lean pass, and those only a person can answer (a lean is core 1.14.0's). A question says so beside its severity, which way it leans and why (with how often a lean of its kind was right, `(right in 9 of 10 known cases)`, where core counted it against the ACT test cases on at least five cases: `lean.measured`), the lean's caution, and what would settle it; with `howToCheck: true`, also the steps that answer it:

```
1) img-alt-present (serious): This <img> has no alt attribute.
   at html > body > main > img:nth-of-type(1)
   Add an alt attribute that says what the image shows, or alt="" if the image is purely decorative.
2) heading-order (minor, likely fails): This heading jumps from level 1 to level 3, skipping a level.
   at html > body > main > h3
   Go down one level at a time, so an <h2> is followed by an <h3> rather than an <h4>, and the outline of the page stays easy to follow.
   Why it likely fails: The heading skips a level after the one before it.
3) aria-checked-state-mismatch (moderate, likely passes): This element’s aria-checked value does not match its actual checked/indeterminate state.
   at input[aria-label="Agree"]
   Make aria-checked match the real state, or remove it; a native checkbox or radio button already exposes its state.
   Why it likely passes: Browsers ignore aria-checked on a native checkbox or radio button and expose its real state.
   Caution: ARIA in HTML forbids aria-checked here; remove it so no tool reads the wrong state.
4) img-alt-quality (minor, needs review): Check that this image's alt text is accurate and fits its context.
   at html > body > main > img:nth-of-type(2)
   The alt text should give the information or purpose the image has on this page, without repeating nearby text or reading like a file name.
```

`outcomes` takes the outcomes (`'fail'`, `'cantTell'`, and `'pass'`/`'notApplicable'` for the rare occurrence such a rule carries) and the review groups among the questions (`'leanFail'`, `'leanPass'`, `'open'`; `'cantTell'` is all three), so an assertion that gates on failures and likely failures says `{ outcomes: ['fail', 'leanFail'] }`, to go with core's `leaningFailures(result)`. Anything else throws a `TypeError`, rather than list nothing.

Given the whole result, it also adds the result's scan gaps, its notes (`getScanNotes()`) and the core release that produced it (`engine.version`), and a scan that left something out does not read as clean: with no findings, it opens with "No accessibility violations found in what was scanned." rather than "No accessibility violations found.", or, when the scope matched nothing, with the gap itself:

```
1) img-alt-present (serious): Image has no text alternative.
   at my-gallery >>> img
   Add an alt attribute.

Part of the scan scope was not scanned: no element matched "#sidebar".
Custom rule "my-rule" did not run: runInPage source could not be turned back into a function.
Pack "@acme/a11y-policy" did not run: it supports core ^2.0.0, and this is core 1.12.0.

The page was shown in forced colors (high contrast); contrast findings may differ with forced colors off.
2 custom elements were asked about because the scan could not read the name or states they set through ElementInternals. Install the internals hook before the page loads (installInternalsHook() in your binding) to have them checked, and roles set the same way.

Scanned with @surea11y/core 1.12.0.
```

It throws a `TypeError` for any other input, such as the `{ topFrame, frames }` tree of a `frames(true)` scan: format `topFrame` and each frame on its own.

With `{ failOnSeverity }`, as `getGatingFailures()` below takes it, a failure below that level is still listed, marked `(moderate, below failOnSeverity serious, does not fail the test)`.

### `getGatingFailures(resultOrChecks, { failOnSeverity? })` and `SEVERITIES`

The failing rule results that should fail a test: every `fail`, or with `failOnSeverity` only those whose severity is that level or above (`SEVERITIES` lists them least to most severe: `minor`, `moderate`, `serious`, `critical`). The severity is the rule result's own, which a profile can set, so it counts the same failures `surea11y scan --fail-on-severity` does for the same page. `fail` keeps its meaning, a definite violation; the level only picks which ones stop the test, and every failure stays in the result. A level that isn't a severity throws a `TypeError`. Each binding re-exports both, for a test to gate on serious problems first:

```js
const results = await new A11yCoreBuilder({ page }).analyze();
assert.deepStrictEqual(
  getGatingFailures(results, { failOnSeverity: 'serious' }),
  [],
  formatFailures(results, { failOnSeverity: 'serious' })
);
```

### Scans under conditions: `conditions(list)` and `mergeConditionResults(runs)`

A page can fail differently in dark mode or at phone width: text that reads well on white fails contrast on a dark background, and a control big enough at 1280 pixels shrinks at 320. **`conditions([{ colorScheme: 'dark' }, { width: 320 }])`** asks a binding to scan the page as it is, then under each condition (a color scheme, a viewport width in CSS pixels, or both), and to put the viewport and scheme back afterwards. A condition with anything else, or a value that isn't one, throws a `TypeError`.

A binding's `analyze()` calls **`_scanUnderConditions(scan, { save, apply, restore })`** with its own driver steps: `save()` resolves to what `restore(state)` needs, `apply(condition)` sets the scheme and width, and `restore` runs even when a scan throws. It refuses `.frames(true)` with conditions for now. It returns **`mergeConditionResults()`** of the scans, one result:

- a rule's outcome is its worst across the scans (`fail`, `cantTell`, `pass`, `notApplicable`), so a contrast failure only in dark mode fails the rule;
- an occurrence is kept once per element, rule and reason code, with the `conditions` it appeared under (`['default', 'dark']`), which `formatFailures()` prints as `seen in: default, dark`;
- `conditionRuns` lists each scan's condition and `engine.environment`.

`formatFailures()`, `getGatingFailures()` and the test matchers read it as any result. A picture taken by `.screenshots()` under a condition has the condition in its file name, so it doesn't overwrite the default scan's. `readConditions()` and `conditionLabel()` (`'dark'`, `'width 320'`, `'dark, width 320'`) are exported for bindings that run their own loop, as Cypress does.

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
    "@surea11y/binding-base": "^1.5.0"
  }
}
```

A project installs core beside the binding (`npm install @surea11y/core @surea11y/playwright`), so the binding and the project share one copy of the engine. The bindings list core under `dependencies` through 1.x and move it to `peerDependencies` in 2.0.

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
    this._warnScanGaps(result, '@surea11y/<binding>'); // once per scanned frame
    return this._applyReportOnly(result);
  }
}
```

This package's own `.d.ts` is not referenced by any binding's consumer-facing `.d.ts` — each binding's `A11yCoreBuilder.d.ts` declares a flat, non-inheriting ambient `export class A11yCoreBuilder { ... }`, so the inheritance here is invisible to TypeScript consumers.

### The internals hook

Many web components keep their `ElementInternals` in a private field (`this.#internals = this.attachInternals()`). No script can read a name, a state or a role set there, so core asks about the element (`name_internals`, `state_internals`) instead of judging it. A role set there isn't even asked about: the element simply has no role for the scan, so a component that is a switch only through its internals isn't checked at all. `internalsHookScript()` from `@surea11y/core` (1.12.0 and later) returns a script that, run before the page's own scripts, records every element's internals for the scan to read. See core's [`INTEGRATION.md`](https://github.com/SureA11y/core/blob/main/docs/INTEGRATION.md#reading-private-elementinternals-the-internals-hook).

Only the driver can run code before a page loads, and every builder works on a page that is already loaded, so this isn't a builder method. Each binding offers it the same way: a static **`A11yCoreBuilder.installInternalsHook(target)`**, called before navigating, opt-in, doing nothing else. It returns what the driver's call returns (a Promise in most bindings).

```js
// Playwright: every frame, and again after each navigation
static installInternalsHook(page) {
  return page.addInitScript({ content: internalsHookScript() });
}
// Puppeteer:        page.evaluateOnNewDocument(internalsHookScript())
// Selenium (CDP):   cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: internalsHookScript() })
// WebdriverIO:      WebDriver BiDi script.addPreloadScript, with the script wrapped in a function
// Cypress:          cy.on('window:before:load', (win) => win.eval(internalsHookScript()))
```

A user then writes:

```js
await A11yCoreBuilder.installInternalsHook(page); // before goto
await page.goto('https://example.com/');
const results = await new A11yCoreBuilder({ page }).analyze();
results.engine.environment.internalsHook; // 'early'
```

What a binding's docs should say about it, in its own words:

- **What it changes.** The engine reads the names, states *and roles* components set through private internals. Their questions become passes or fails, and a component that has a role only through its internals is checked for that role (an unnamed `switch` fails `binary-control-name-present`). Without the hook such components aren't checked for their role, and nothing in the result says so. The result records the hook in `engine.environment.internalsHook`: `'early'`, `'late'` or absent.
- **When to install it.** Before the page loads. Installed after the page's scripts ran, it is `'late'` and reads only internals attached after it; a page that is already loaded can't be fixed.
- **What it can't cover.** Frames the driver's before-load API doesn't reach (Cypress's `window:before:load` reaches the app's frame only), and drivers with no before-load script at all.
- **What a page can notice.** `HTMLElement.prototype.attachInternals` is no longer native code, an extra stack frame appears in errors thrown through it, and a global symbol (`Symbol.for('surea11y.internals')`) holds the record. Any script on the page can read every component's internals through it, so it is for test and audit runs, not production.

A binding needs no other code for the advice, as long as its `analyze()` calls the shared `_warnScanGaps(result, source)` rather than a `_warnScanGaps()` of its own: it prints `getScanNotes()`'s `internals-hook` note once per scan when the scan asked about internals without an early hook, and hands it to `logger()` when one is set.

### The listener hook

Core's keyboard rules read inline handlers (`onclick="…"`) from the markup. A listener a page adds with `addEventListener`, or sets as a property (`el.onclick = fn`), leaves no trace a script can read, so a `role="button"` given its click listener from script isn't checked at all, and an inline `onclick` whose key handling was added from script is only asked about (`CLICK_HANDLER_NO_KEY_HANDLER`). `listenerHookScript()` from `@surea11y/core` (1.14.0 and later) returns a script that, run before the page's own scripts, records which elements have click, key, focus and mouse listeners. See core's [`INTEGRATION.md`](https://github.com/SureA11y/core/blob/main/docs/INTEGRATION.md#seeing-listeners-added-from-script-the-listener-hook).

Each binding offers it as it offers the internals hook: a static **`A11yCoreBuilder.installListenerHook(target)`**, called before navigating, opt-in, doing nothing else, through the same driver call as `installInternalsHook()` with `listenerHookScript()` in place of `internalsHookScript()`. The two can be installed together.

```js
await A11yCoreBuilder.installListenerHook(page); // before goto
await page.goto('https://example.com/');
const results = await new A11yCoreBuilder({ page }).analyze();
results.engine.environment.listenerHook; // 'early'
```

What a binding's docs should say about it, in its own words:

- **What it changes.** `click-handler-keyboard-operable` judges an element given a click listener from script as one with an inline `onclick`, and counts a key listener on the element or inside it. A focusable control with no key listener anywhere a key event from it goes fails (`CLICK_HANDLER_NO_KEY_LISTENER`); one whose only key listeners are on an ancestor, the document or the window is asked about. A click listener on a container (a framework's root) makes no element inside it a candidate. `mouse-only-event-handlers` asks about pointer listeners added from script. The result records the hook in `engine.environment.listenerHook`: `'early'`, `'late'` or absent.
- **When to install it.** Before the page loads. Only an early hook proves an element has no key listener, so only then does a control fail for lack of one; a late hook sees only listeners added after it.
- **What a page can notice.** `addEventListener`, `removeEventListener` and the `on…` property setters are no longer native code, and a global symbol (`Symbol.for('surea11y.listeners')`) holds the record. It is for test and audit runs, not production.

The advice needs no other code in a binding that calls the shared `_warnScanGaps()`: it prints the `listener-hook` note once per scan, naming the installer, as it does the `internals-hook` note. Core's [`BINDING_AUTHORS_GUIDE.md`](https://github.com/SureA11y/core/blob/main/docs/BINDING_AUTHORS_GUIDE.md) shows the three hooks for each driver and tables what each changes.

### The live-region hook

A scan sees the page at one moment, so it can't tell how a live region was filled while the test ran. `liveRegionHookScript()` from `@surea11y/core` (1.14.0 and later) returns a script that, run before the page's own scripts, records each text a shown live region is given from the load event on, and the ways of filling one that are commonly not announced, which core's `live-region-announcements` (WCAG 4.1.3) then asks about. See core's [`INTEGRATION.md`](https://github.com/SureA11y/core/blob/main/docs/INTEGRATION.md#seeing-what-live-regions-are-given-the-live-region-hook).

Each binding offers it as it offers the other two hooks, a static **`A11yCoreBuilder.installLiveRegionHook(target)`** called before navigating, and a static **`A11yCoreBuilder.announcements(target, { includeBehindModal? })`** that reads what the page made available to announce. That method returns **`_announcementsIn(frame, { includeBehindModal? })`**, which runs core's `getAnnouncements({ selectors: true })` in the frame through `_evaluateInFrame()`, so each entry names its region by `selector` (and `shadowHostSelectors`) rather than holding an element no driver can return. It resolves to `[{ text, politeness, time, order, behindModal, selector }]`, or `null` without the hook, and needs core 1.14.0 and a binding that implements `_evaluateInFrame()`. A test can click Save and expect `'Saved'` among the texts.

What a binding's docs should say about it: it records what the page made available to announce, not what a screen reader said; the result records it in `engine.environment.liveRegionHook`; and a global symbol (`Symbol.for('surea11y.liveRegions')`) holds the record, so it is for test and audit runs, not production.

### Screenshots of failing elements

A screenshot has to come from whatever drives the browser: nothing in a page's JavaScript can read what was painted. Everything else is shared: `_captureScreenshots()` plans the pictures, runs its in-page step in each frame (find the element, scroll it into view, draw the highlight, put the page back), works out where the element is on the top-level page across frames, names and writes the files, and fills in `screenshot`. A binding gives it the driver through two methods, and calls it once per scanned frame, after the scan and before `reportOnly()`:

```js
class A11yCoreBuilder extends A11yCoreBuilderBase {
  // Run fn(...args) in the frame and resolve to what it returns (a plain
  // value; fn may return a Promise, which the driver waits for). `frame` is
  // whatever this binding passes in, given back unchanged.
  _evaluateInFrame(frame, fn, args) { /* page.evaluate / executeScript / browser.execute */ }

  // A PNG (Buffer or base64) of `box`: whole CSS pixels relative to the
  // top-level page's viewport. `view` is { devicePixelRatio, viewport, scroll }
  // of the top-level page.
  _captureBox(box, view) { /* the driver's screenshot */ }

  async analyze() {
    // ...for each scanned frame:
    const result = rethrowEngineError(await frame.evaluate(inPageScan, ...));
    await this._captureScreenshots(result, frame, framePath); // nothing unless .screenshots() was called
    return this._applyReportOnly(result);
  }
}
```

`framePath` leads from the top-level page to the scanned frame, outermost first: one `{ frame, iframe }` per `<iframe>` on the way, where `frame` is the frame holding it (as `_evaluateInFrame()` takes it) and `iframe` is that `<iframe>` in it, given whichever way the driver has it: a CSS selector, `{ selector, index }` (the index among the elements `selector` matches, by default `'iframe, frame'`), or an element handle; `null` when the binding couldn't find it (a frame detached after its scan), which fails that frame's pictures rather than the scan. Leave it out, or pass `[]`, for the top-level page. The top-level page must be the first frame of a scan, as it is in every binding: a scan's `max` and file names count from it. The frame's name in a file name is worked out in the page from the `<iframe>` itself, so it is the same whichever way it is given.

Per driver. The Puppeteer, Playwright and Selenium rows were checked against real browsers (Chromium, Firefox and WebKit through Playwright, Chrome through Puppeteer and Selenium, at device pixel ratios 1 and 2); WebdriverIO's follows Selenium's, through its own calls:

| Binding | `_evaluateInFrame(frame, fn, args)` | `_captureBox(box, view)` | A step of `framePath` |
|---|---|---|---|
| Puppeteer | `frame.evaluate(fn, ...args)` | `page.screenshot({ clip: { ...box, x: box.x + view.scroll.x, y: box.y + view.scroll.y } })`: its clip is relative to the document | `{ frame: f.parentFrame(), iframe: await f.frameElement() }` |
| Playwright | `frame.evaluate(new Function('args', 'return (' + fn + ')(...args)'), args)`: its evaluate takes one argument | `page.screenshot({ clip: box })`: its clip is relative to the viewport | as Puppeteer |
| Selenium | switch to the frame, then `driver.executeScript(fn, ...args)` | `cropViewportScreenshot(await driver.takeScreenshot(), box, view)` | `{ frame: parentPath, iframe: { index } }`, the index of its `By.css('iframe, frame')` |
| WebdriverIO | switch to the frame, then `browser.execute(fn, ...args)` | `cropViewportScreenshot(await browser.takeScreenshot(), box, view)` | `{ frame: parentPath, iframe: { selector: 'iframe', index } }`, as its `$$('iframe')` |
| Cypress | — | — | overrides `_captureScreenshots()` |

A driver that switches frames is left in whichever frame the step used last, the top-level page in a frame scan: switch back if the traversal goes on from the scanned frame. **`cropViewportScreenshot(image, box, view)`** cuts the box out of a whole-viewport screenshot in Node, with no image library and nothing from the page, scaling CSS pixels by the image's width over the viewport's.

Cypress's `analyze()` returns a chainable and its specs run in the browser, so its picture is a queued `cy.screenshot()` command that no Promise can wait for. Its builder overrides `_captureScreenshots()` and runs the same steps around its own command, with the pieces `_captureScreenshots()` itself is built from:

- **`screenshotFrameKey({ evaluateInFrame, framePath })`** names the frame for file names;
- **`planScreenshots(result, { outcomes, frameKey })`** lists the elements to picture, grouped as the shared step groups them, with their file names (**`screenshotFileName()`**);
- **`prepareElementScreenshot({ evaluateInFrame, frame, framePath, element, options, token })`** gets one element ready and resolves to `{ clip, view, box, cropped }`, the page held: the binding then takes `clip` its own way;
- **`releaseElementScreenshot({ evaluateInFrame, frame, framePath, token })`** puts the page back, and must follow a prepare that didn't skip; a prepare that resolves to `{ skipped }` has put it back already;
- **`screenshotToken()`** names one element's capture for the two.

`evaluateInFrame(frame, fn, args)` is what `_evaluateInFrame()` is; in Cypress, which runs in the page's own browser, `win.eval('(' + fn + ')')(...args)`, and **`screenshotInPage`** is that `fn`. `SCREENSHOT_SKIPS` lists the reasons a `screenshot` can give.

A binding that implements neither (an older one) throws an error naming the two methods when `.screenshots()` is called, so it never silently takes no pictures.

## Proposals

- [`docs/ELEMENT_SCREENSHOTS.md`](./docs/ELEMENT_SCREENSHOTS.md) — the design of `.screenshots()`, in this package since 1.5.0: what each binding adds, and what was decided and why.

## Testing

No browser needed:

```bash
npm test
```

Besides unit tests, this runs the builder's arguments through the real `@surea11y/core` in jsdom, sending the scan and `queryOccurrenceElement()` into the page from their source as a driver does, drives `.screenshots()` through a fake binding whose frames are jsdom windows given a layout, decodes and crops PNGs of every kind a browser writes, and compiles `src/index.d.ts` against core's own types. `@surea11y/core`, `jsdom` and `typescript` are dev dependencies only.

## Maintainer

Maintained by [Jorge Rumoroso](https://github.com/rumoroso).

## License

MIT — see [`LICENSE`](./LICENSE).

This package has no runtime dependency on [`@surea11y/core`](https://github.com/SureA11y/core) (MPL-2.0): each binding depends on core itself and passes in what this package needs, such as `runa11yCoreInPage`. Core is a dev dependency, for the tests only. MPL-2.0's copyleft is file-level and applies only to `@surea11y/core`'s own source files; using it as a normal package dependency doesn't affect this package's license.
