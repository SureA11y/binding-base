// Compiled, not run, by tests/types.test.js: this package's hand-written
// types against @surea11y/core's own, as a binding uses them together.
import type { ScanResult } from '@surea11y/core';
import {
  A11yCoreBuilderBase,
  EngineError,
  createInPageScan,
  createInPageAnnouncements,
  getGatingFailures,
  SEVERITIES,
  readConditions,
  conditionLabel,
  mergeConditionResults,
  formatFailures,
  formatOccurrenceLocation,
  getScanGaps,
  getScanNotes,
  queryOccurrenceElement,
  rethrowEngineError,
  cropViewportScreenshot,
  planScreenshots,
  screenshotFileName,
  SCREENSHOT_DEFAULTS,
  prepareElementScreenshot,
  releaseElementScreenshot,
  screenshotFrameKey,
  screenshotToken
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
const readAnnouncements = createInPageAnnouncements(() => null);
const said: string[] = (readAnnouncements() || []).map((a) => `${a.politeness}: ${a.text} at ${a.time}`);

const filtered: ScanResult = builder._applyReportOnly(scanned);
const message: string = formatFailures(filtered) + formatFailures(filtered.checksResults, { outcomes: ['fail'] });
const gating = getGatingFailures(scanned, { failOnSeverity: 'serious' });
const gatingIds: string[] = gating.map((c) => c.ruleId);
const marked: string = formatFailures(scanned, { failOnSeverity: SEVERITIES[2] });

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
  else if (note.kind === 'listener-hook') note.elementCount.toFixed();
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

// A binding that takes the picture itself, between prepare and release.
async function ownCapture(win: Window): Promise<string> {
  const evaluateInFrame = (frame: Window, fn: (...args: any[]) => unknown, args: unknown[]) => fn(...args);
  const frameKey: string[] = await screenshotFrameKey({ evaluateInFrame, framePath: [] });
  const token = screenshotToken();
  const [planned] = planScreenshots(result, { frameKey }).elements;
  const ready = await prepareElementScreenshot({ evaluateInFrame, frame: win, element: planned, options: SCREENSHOT_DEFAULTS, token });
  if ('skipped' in ready) return ready.skipped;
  await releaseElementScreenshot({ evaluateInFrame, frame: win, token });
  return `${ready.clip.width}x${ready.clip.height} at ${ready.view.devicePixelRatio}, element ${ready.box.width} cropped ${ready.cropped}`;
}

export { message, element, where, packScript, shot, fileName, described, ownCapture };

builder.conditions([{ colorScheme: 'dark' }, { width: 320 }]).conditions(null);
const checked = readConditions([{ colorScheme: 'dark', width: 320 }]);
const label: string = conditionLabel(checked ? checked[0] : null);
const merged = mergeConditionResults([{ condition: 'default', result: scanned }]);
const runLabels: string[] = merged.conditionRuns.map((r) => r.condition);
