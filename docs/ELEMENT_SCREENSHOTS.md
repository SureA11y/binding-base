# Screenshots of failing elements

A design, not yet built: a picture of each element a scan flags, beside its finding. It is planned for `@surea11y/binding-base` 1.5.0. This file records what the feature needs, which project each part belongs in, and the decisions taken (see [Decisions](#decisions)). It lives here because most of the work is in this package; each binding adds two small driver methods (Cypress, one step of its own), and core needs nothing.

## Why core does not take the screenshot

The engine runs inside the page as plain JavaScript. Nothing in a page's JavaScript can read the pixels the browser painted, and under jsdom nothing is painted at all. A screenshot has to come from whatever drives the browser: a binding, or a tool that calls the engine through its own driver.

[`@surea11y/core`](https://github.com/SureA11y/core) already returns everything that driver needs to find the element (see [`OUTPUT_SCHEMA.md`](https://github.com/SureA11y/core/blob/main/docs/OUTPUT_SCHEMA.md)):

- `selector` on each occurrence, absent with `output.includeSelector: false`.
- `shadowHostSelectors` for an element inside a shadow tree.
- `structuralPath`, a fallback when a selector no longer resolves to one element.
- The frame's `selector` and `path` in a cross-frame result, which lead to the right `<iframe>`.

So the engine needs no change to make this possible, and keeps its zero runtime dependencies and deterministic output.

## What users can do today

Every binding has `.elementRef(true)`, which puts a live element reference on each `fail`/`cantTell` occurrence. The Puppeteer and Playwright documentation already shows a screenshot:

```js
const results = await new A11yCoreBuilder({ page }).elementRef(true).analyze();
const [firstFail] = results.checksResults.filter((r) => r.outcome === 'fail');
await firstFail.occurrences[0].elementHandle.screenshot({ path: 'flagged.png' });
```

The other bindings differ: WebdriverIO's field is `occurrence.element` and its call is `.saveScreenshot(path)`; Selenium's `takeScreenshot()` returns a base64 string rather than writing a file; Cypress gives a plain DOM `Element` to `cy.wrap()` and documents no screenshot.

What that leaves to each user, in a different way per binding: skipping elements that can't be pictured, page-level findings, context around the element, marking which element is meant, naming files, a cap on how many, and cross-frame positions. The option below does those once.

## The option

```js
const results = await new A11yCoreBuilder({ page })
  .screenshots({
    dir: 'a11y-shots',      // omit to get each image back as a Buffer instead of a file
    outcomes: ['fail'],     // which occurrences to capture; default ['fail']
    padding: 16,            // px of context around the element; default 0
    highlight: true,        // draw a box around the element; default true
    max: 50,                // at most this many elements per scan; default 50
  })
  .analyze();
```

Screenshots are off unless `.screenshots()` is called; `.screenshots()` with no options turns them on with the defaults, and `.screenshots(false)` turns them off again. Each call replaces the previous options.

One picture is taken per element, not per finding: when several rules flag the same element, it is captured once, and every occurrence about it carries the same `screenshot` object. Each occurrence it considered gets the field:

```js
occurrence.screenshot =
  { path: 'a11y-shots/element-3f9a1c.png', box: { x, y, width, height } }
  // or { buffer, box } without dir; or, when nothing was captured:
  { skipped: 'no-element' | 'not-rendered' | 'zero-size' | 'max-reached' | 'capture-failed' }
```

A `skipped` reason says why there is no picture, so a missing image never looks like a bug. `max-reached` marks the elements past the cap, so a report can say how many were left out. Some rules flag elements that are invisible by definition: `css-hidden-focus` reports focusable elements that CSS hides.

For a contrast finding the picture shows the real background, the part the engine is least sure of, so the docs suggest asking for its questions too:

```js
builder.withRules('contrast-computable').screenshots({ outcomes: ['fail', 'cantTell'] });
```

### How a capture works

For each occurrence, in each scanned frame:

1. **Group by element.** Occurrences with the same frame, `shadowHostSelectors` and `selector` are one element, captured once. `max` counts elements.
2. **Find the element** with `queryOccurrenceElement` from `@surea11y/binding-base`, which follows `shadowHostSelectors`. No selector (a page-level finding such as `page-title-present`) is `no-element`.
3. **Measure it.** No layout box (`display: none`) is `not-rendered`; a box with no width or height is `zero-size`.
4. **Scroll it into view.**
5. **Draw the highlight as an overlay:** an absolutely positioned outline `<div>` placed over the element's box, removed after the capture. Never restyle the element itself: an outline or background on it could change the contrast being reported.
6. **Capture the padded box.** Use a clipped page screenshot rather than the driver's element screenshot, so the padding and overlay are included.
7. **Name the file by the element:** `element-` plus a short hash of the frame path, `shadowHostSelectors` and `selector`, not a counter or a rule id. The same element gets the same name on the next run, which helps diffing and baselines, and every finding about it points to one file.

Captures for a frame are taken right after that frame's scan, before the next frame is scanned, to keep the time between what the scan saw and the picture short.

### Details

- **Which occurrences.** An occurrence is captured when its own outcome is in `outcomes`: its `occurrenceOutcome` where core gives one, otherwise its rule's `outcome`. A `fail` rule can hold `cantTell` occurrences, and those follow `cantTell`.
- **Before `reportOnly()`.** Captures are planned from the full result, then `reportOnly()` trims it as before. `outcomes` alone decides what is captured.
- **With `elementRef(true)`.** Both work together; the element reference is not used to take the picture, since the box and the overlay come from the shared helper.
- **An element taller or wider than the viewport** is captured as far as the viewport goes, from its top-left corner, and the field says so: `{ path, box, cropped: true }`.
- **The page is left as it was.** The overlay is removed after each capture, also when the capture fails, and the scroll position of each scrolled container and the window is put back after the frame's captures.
- **Something drawn over the element**, such as a sticky header after scrolling, shows in the picture as it does on screen. The overlay is drawn above everything (`z-index` at its maximum, `pointer-events: none`), so the element's place is still marked.
- **A failed capture never fails the scan.** The occurrence gets `{ skipped: 'capture-failed', error }` with the driver's message, and the scan's result is returned as usual.
- **File names** come from a short hash computed in plain JavaScript (FNV-1a, 8 hex digits) over the frame key, `shadowHostSelectors` and `selector`, so they are the same on every platform and nothing Node-only is needed to compute them.
- **Writing files** uses Node's `fs`, loaded through `module.require` as `@surea11y/core/pack` is, so a Cypress spec's browser bundle doesn't take it in. Cypress writes through its own command instead.
- **In `formatFailures()`**, an occurrence with a picture gets one more line under its location: `   screenshot: a11y-shots/element-3f9a1c.png`. A buffer or a skipped capture adds nothing.

### The binding contract

The shared code in this package plans the captures, groups occurrences by element, runs the in-page helper, works out the box, names and writes files, and fills in `occurrence.screenshot`. It reaches the driver through two methods a binding's builder implements:

```js
class A11yCoreBuilder extends A11yCoreBuilderBase {
  // Run a self-contained function in one scanned frame (the binding's
  // page.evaluate / executeScript / browser.execute), and return its result.
  _evaluateInFrame(frame, fn, arg) { /* driver-specific */ }

  // Take a PNG of the box, in CSS pixels relative to the top-level page's
  // viewport, and return it as a Buffer (or base64 string, which the shared
  // code decodes). The shared code has already added each <iframe>'s offset.
  _captureBox(box) { /* driver-specific */ }
}
```

`frame` is whatever the binding's own frame traversal holds (a Playwright `Frame`, a WebdriverIO frame path); the shared code passes it back unchanged, along with a stable frame key the binding gives (the chain of `<iframe>` selectors leading to it, empty for the top page). A driver with only a viewport screenshot implements `_captureBox` with the shared crop helper: it sends the viewport image and the box, scaled by `devicePixelRatio`, into the page and cuts it on a `<canvas>`.

A binding's `analyze()` calls the shared step once per scanned frame, after the scan and before `reportOnly()`:

```js
const result = rethrowEngineError(await frame.evaluate(inPageScan, ...));
await this._captureScreenshots(result, frame, frameKey); // does nothing unless .screenshots() was called
return this._applyReportOnly(result);
```

A binding that has not implemented the two methods throws an error naming them when `.screenshots()` is used. Cypress's `analyze()` returns a chainable, not a Promise, so its builder overrides `_captureScreenshots` to run the same plan through Cypress commands (`cy.wrap(el).screenshot({ padding })`) and keeps Cypress in charge of where the images go.

### Types

```ts
type ScreenshotSkip = 'no-element' | 'not-rendered' | 'zero-size' | 'max-reached' | 'capture-failed';

interface ScreenshotOptions {
  dir?: string;
  outcomes?: Outcome[];   // default ['fail']
  padding?: number;       // default 0, CSS px
  highlight?: boolean;    // default true
  max?: number;           // default 50, elements per scan
}

type OccurrenceScreenshot =
  | { path: string; box: Box; cropped?: true }
  | { buffer: Buffer; box: Box; cropped?: true }
  | { skipped: ScreenshotSkip; error?: string };

interface Box { x: number; y: number; width: number; height: number }
```

`screenshots(options?: ScreenshotOptions | false): this` validates its options at the call: an unknown key, an outcome that isn't one of the four, a `padding` or `max` that isn't a finite number of 0 or more (`max` a whole number of 1 or more), or a `dir` that isn't a non-empty string throws a `TypeError`, as `reportOnly()` does.

### How it is tested

- **binding-base, without a browser:** the planning (grouping by element, `max`, outcomes by occurrence, file names, skip reasons, the error for selectors turned off) against stored results, and the in-page helper and the canvas crop in jsdom, through a fake builder whose `_evaluateInFrame` and `_captureBox` record what they are given.
- **Each binding, in a real browser:** a page with a failing element, one in a shadow tree, one in an `<iframe>`, one hidden by CSS and one taller than the viewport; each gets the expected `screenshot` field, the page's scroll position and DOM are as they were afterwards, and the scan's own result is unchanged apart from the field.

## Where each part belongs

| Project | What changes | Why there |
|---|---|---|
| `@surea11y/binding-base` (this package) | Everything that does not depend on the driver. `.screenshots(options)` on `A11yCoreBuilderBase`, with option validation as `reportOnly()` does it. The planning: which occurrences, grouping by element, the cap, file names, skip reasons and the `screenshot` field's shape. `_captureScreenshots(result, frame, frameKey)`, the step each `analyze()` calls. An in-page helper beside `queryOccurrenceElement` in [`src/shadowDom.js`](../src/shadowDom.js) that measures the element, scrolls it into view, adds or removes the overlay and puts the scroll position back; like that function, self-contained so every driver can send it. Adding each `<iframe>`'s offset to the box. Cropping a viewport image to the box on a `<canvas>` in the page, for drivers with no clipped screenshot; no image library. The two methods each binding implements, `_evaluateInFrame` and `_captureBox` (see [The binding contract](#the-binding-contract)). Types in [`src/index.d.ts`](../src/index.d.ts). `formatFailures` naming the screenshot path in a failure message. | All five bindings extend this class, and it already holds `elementRef()`, `reportOnly()` and the element lookup. Done here once, the option behaves the same in every binding, and a new binding built on this class writes only `_evaluateInFrame` and `_captureBox`. |
| [`@surea11y/playwright`](https://github.com/SureA11y/playwright) | `_evaluateInFrame` (`frame.evaluate`) and `_captureBox`: `page.screenshot({ clip })` on the top page. Playwright gives a frame element's box relative to the main page, so one clip covers `.frames(true)` too. Optionally `attach: testInfo`, so the images appear in Playwright's HTML report beside the failing test. | Only the driver call is Playwright-specific. |
| [`@surea11y/puppeteer`](https://github.com/SureA11y/puppeteer) | `_evaluateInFrame` and `_captureBox`: `page.screenshot({ clip })`, as for Playwright. | Same. |
| [`@surea11y/selenium`](https://github.com/SureA11y/selenium) | `_evaluateInFrame` (`executeScript`, after switching to the frame) and `_captureBox`: a viewport screenshot (`driver.takeScreenshot()`), cropped with binding-base's crop helper, with binding-base's frame offsets for `.frames(true)`. | Selenium has no clipped screenshot, but the crop and the offsets are shared, so only the driver call is here. |
| [`@surea11y/webdriverio`](https://github.com/SureA11y/webdriverio) | `_evaluateInFrame` and `_captureBox`, as for Selenium: `browser.takeScreenshot()`, then binding-base's crop and frame offsets. | Same. |
| [`@surea11y/cypress`](https://github.com/SureA11y/cypress) | Its own `_captureScreenshots`, since its `analyze()` returns a chainable, running the shared plan through Cypress's own command: `cy.wrap(el).screenshot({ padding })`, which supports padding and saves under Cypress's own screenshots folder, so `dir` maps onto its naming. | Cypress owns where screenshots go. |
| [`@surea11y/core`](https://github.com/SureA11y/core) | Nothing required, and no engine change. One optional touch, a few lines in [`BINDING_AUTHORS_GUIDE.md`](https://github.com/SureA11y/core/blob/main/docs/BINDING_AUTHORS_GUIDE.md), in two parts. True today, and can go in at any time: that a new binding can extend this package's `A11yCoreBuilderBase` and write only `analyze()` (the guide does not mention this package yet), and that a binding may add its own fields to an occurrence, which core never sets or reads, such as `elementHandle` (`element` in WebdriverIO and Cypress) from `.elementRef(true)`. Once this option ships: `screenshot` and its shape, as one more such field. Not its HTML report: `screenshot` is not part of core's output, so drawing it there would tie core to a binding feature; whoever takes the images shows them, as surea11y-lab does. | Keeps the engine and its report free of drivers. |
| `surea11y-lab` | Nothing of its own: it gets the option through `@surea11y/puppeteer` (see below). | It is moving its scans to that binding. |

Order: binding-base first (1.5.0), then Puppeteer (surea11y-lab's binding) and Playwright (a clipped screenshot makes them the simplest), then Cypress, Selenium and WebdriverIO. The optional lines in core's guide can come once the option is released.

## surea11y-lab

surea11y-lab is moving its scans from its own `page.evaluate(runa11yCoreInPage, …)` to `@surea11y/puppeteer` (its branch `evaluate/surea11y-puppeteer-binding`), so it gets this option from the binding rather than building its own. That makes it the option's first user, and binding-base plus Puppeteer the first pair to build.

What the lab needs from the option, written up as a follow-up to that branch in its `docs/surea11y-puppeteer-binding-evaluation.md`:

- **The image as a buffer**, without `dir`: the lab stores images through its own `captureScreenshotArtifact`, so the option must not decide where they go.
- **A `skipped` reason** for every occurrence without an image, for its report to show.
- **No change to results** beyond the added field, which its parity harness checks.

Its browser extension runs in the page with no driver, so no binding covers it; an element screenshot there would be the visible tab cropped to the element's box, separate work.

## Decisions

Taken on 2026-10-16, before building it:

- **Off by default.** Screenshots of real pages can hold personal data, and they end up as CI artifacts, so users turn them on deliberately with `.screenshots()`.
- **One picture per element.** Several rules can flag the same element; it is captured once, and each finding points to the same file. `max` (default 50) counts elements, which bounds the cost of a page with hundreds of contrast failures.
- **`fail` only by default.** `outcomes` defaults to `['fail']`. The docs suggest `['fail', 'cantTell']` for contrast, where the picture shows the background the engine couldn't judge.
- **A Buffer unless `dir` is given.** The caller decides where images go; surea11y-lab stores them through its own `captureScreenshotArtifact`. With `dir`, the option writes files there.
- **Timing.** Each frame's elements are captured right after its scan. Focus, hover, animation or lazy-loaded content can still differ from what the scan saw; the docs say so, and name the focus rules as the ones to watch.
- **Selectors turned off is an error.** With `output.includeSelector: false` there is nothing to find. Asking for screenshots too throws a `TypeError` with `code: 'INVALID_ENGINE_OPTIONS'` when the scan's arguments are built, before anything runs, rather than skipping every occurrence.
- **Shipped in binding-base 1.5.0**, not 1.4.0, so 1.4.0's core 1.12 changes reach the bindings without waiting on it.
- **Two driver methods per binding**, `_evaluateInFrame` and `_captureBox`, rather than one: the shared step has to run its helper in each frame as well as take the picture, and with both, everything else stays in this package. Cypress replaces the step itself.
