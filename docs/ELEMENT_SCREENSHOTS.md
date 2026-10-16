# Screenshots of failing elements

A design, not yet built: a picture of each element a scan flags, beside its finding. It is planned for `@surea11y/binding-base` 1.5.0. This file records what the feature needs, which project each part belongs in, and the decisions taken (see [Decisions](#decisions)). It lives here because most of the work is in this package; each binding adds only its capture call, and core needs nothing.

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

## The proposed option

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

A `skipped` reason says why there is no picture, so a missing image never looks like a bug. Some rules flag elements that are invisible by definition: `css-hidden-focus` reports focusable elements that CSS hides.

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

## Where each part belongs

| Project | What changes | Why there |
|---|---|---|
| `@surea11y/binding-base` (this package) | Everything that does not depend on the driver. `.screenshots(options)` on `A11yCoreBuilderBase`, with option validation as `reportOnly()` does it. The planning: which occurrences, the cap, file names, skip reasons and the `screenshot` field's shape. An in-page helper beside `queryOccurrenceElement` in [`src/shadowDom.js`](../src/shadowDom.js) that measures the element, scrolls it into view and adds or removes the overlay; like that function, self-contained so every driver can send it. Adding each `<iframe>`'s offset to the box, for drivers that report a frame element's box relative to its frame. Cropping a viewport image to the box by sending it back into the page and cutting it on a `<canvas>`, for drivers with no clipped screenshot; no image library. One method each binding implements, `captureBox(box)`, returning the image; a binding without it gets a clear error. Types in [`src/index.d.ts`](../src/index.d.ts). `formatFailures` naming the screenshot path in a failure message. | All five bindings extend this class, and it already holds `elementRef()`, `reportOnly()` and the element lookup. Done here once, the option behaves the same in every binding, and a new binding built on this class writes only `captureBox`. |
| [`@surea11y/playwright`](https://github.com/SureA11y/playwright) | `captureBox`: `page.screenshot({ clip })` on the top page. Playwright gives a frame element's box relative to the main page, so one clip covers `.frames(true)` too. Optionally `attach: testInfo`, so the images appear in Playwright's HTML report beside the failing test. | Only the driver call is Playwright-specific. |
| [`@surea11y/puppeteer`](https://github.com/SureA11y/puppeteer) | `captureBox`: `page.screenshot({ clip })`, as for Playwright. | Same. |
| [`@surea11y/selenium`](https://github.com/SureA11y/selenium) | `captureBox`: a viewport screenshot (`driver.takeScreenshot()`), cropped with binding-base's crop helper, with binding-base's frame offsets for `.frames(true)`. | Selenium has no clipped screenshot, but the crop and the offsets are shared, so only the driver call is here. |
| [`@surea11y/webdriverio`](https://github.com/SureA11y/webdriverio) | `captureBox`, as for Selenium: `browser.takeScreenshot()`, then binding-base's crop and frame offsets. | Same. |
| [`@surea11y/cypress`](https://github.com/SureA11y/cypress) | `captureBox`, through Cypress's own command: `cy.wrap(el).screenshot({ padding })`, which supports padding and saves under Cypress's own screenshots folder, so `dir` maps onto its naming. | Cypress owns where screenshots go. |
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
