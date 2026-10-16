// Compiled, not run, by tests/types.test.js: this package's hand-written
// types against @surea11y/core's own, as a binding uses them together.
import type { ScanResult } from '@surea11y/core';
import {
  A11yCoreBuilderBase,
  EngineError,
  createInPageScan,
  formatFailures,
  formatOccurrenceLocation,
  getScanGaps,
  getScanNotes,
  queryOccurrenceElement,
  rethrowEngineError,
  cropViewportScreenshot,
  planScreenshots,
  screenshotFileName,
  SCREENSHOT_DEFAULTS
} from '../../src/index';
import type { OccurrenceScreenshot, ScreenshotBox, ScreenshotView } from '../../src/index';
import { runa11yCoreInPage } from '@surea11y/core';
import { definePack } from '@surea11y/core/pack';

declare const result: ScanResult;

const pack = definePack({ name: '@acme/a11y-rules', version: '1.0.0', namespace: 'acme', core: '^1.11.1' });
const builder = new A11yCoreBuilderBase()
  .withRules('img-alt-present')
  .include('main')
  .withWcag('2.2', 'AA')
  .withBestPractices()
  .includeMode('or')
  .wcagLevel('AA')
  .wcagLevel('aa')
  .withWcag('2.1', 'aaa')
  .withPacks([pack]);
const packScript: string | null = builder._packScript();
const planned: string[] = builder.plannedChecks().map((c) => c.ruleId).concat(builder.plannedCriteria().map((r) => r.id));
const { contextSelector, engineOptions, runOnly } = builder._buildEngineArgs();
const scan = createInPageScan(runa11yCoreInPage);
const scanned: ScanResult = rethrowEngineError(result);
scan(null, contextSelector, engineOptions, runOnly);

const filtered: ScanResult = builder._applyReportOnly(scanned);
const message: string = formatFailures(filtered) + formatFailures(filtered.checksResults, { outcomes: ['fail'] });

builder.logger((gap, frameResult) => {
  const line: string = `${frameResult.url ?? ''}: ${gap.message}`;
  if (gap.kind === 'pack-skipped') gap.pack.reason.toUpperCase();
  if (gap.kind === 'internals-hook') gap.elementCount.toFixed();
  return void line;
}).logger(() => {}).logger(null);
builder._warnScanGaps(result, '@surea11y/example');

for (const gap of getScanGaps(result)) {
  if (gap.kind === 'custom-rule-skipped') gap.rule.reason.toUpperCase();
  else if (gap.kind === 'pack-skipped') gap.pack.reason.toUpperCase();
  else gap.selectors.join(', ');
}

for (const note of getScanNotes(result)) {
  if (note.kind === 'internals-hook') note.hook.toUpperCase();
  else note.message.toUpperCase();
}

const occurrence = result.checksResults[0].occurrences[0];
const element: Element | null = queryOccurrenceElement(occurrence.selector, occurrence.shadowHostSelectors, document);
const where: string = formatOccurrenceLocation(occurrence);

try {
  rethrowEngineError({});
} catch (e) {
  if (e instanceof EngineError && e.code === 'INVALID_CONTEXT_SELECTOR') String(e.selector);
  if (e instanceof EngineError && e.code === 'INVALID_ENGINE_OPTIONS') String(e.message);
}

// A binding that takes screenshots: two driver methods, and the step in analyze().
declare const page: { evaluate(fn: (...args: any[]) => unknown, ...args: unknown[]): Promise<unknown>; screenshot(o: object): Promise<Uint8Array> };
class ShotBuilder extends A11yCoreBuilderBase {
  _evaluateInFrame(frame: unknown, fn: (...args: any[]) => unknown, args: unknown[]): Promise<unknown> {
    return page.evaluate(fn, ...args);
  }
  async _captureBox(box: ScreenshotBox, view: ScreenshotView): Promise<Uint8Array> {
    return cropViewportScreenshot(await page.screenshot({}), box, view);
  }
}
const shots = new ShotBuilder().screenshots({ dir: 'a11y-shots', outcomes: ['fail', 'cantTell'], padding: 8, highlight: true, max: 10 }).screenshots(false).screenshots();
const shot: Promise<ScanResult> = shots._captureScreenshots(scanned, page, [{ frame: page, iframe: { index: 0 } }, { frame: page, iframe: '#checkout' }]);
const fileName: string = screenshotFileName([], null, 'img') + planScreenshots(result, { outcomes: SCREENSHOT_DEFAULTS.outcomes }).elements.map((e) => e.name).join();
declare const field: OccurrenceScreenshot;
const described: string = 'skipped' in field ? field.skipped : 'path' in field ? field.path : String(field.buffer.byteLength);

export { message, element, where, packScript, shot, fileName, described };
