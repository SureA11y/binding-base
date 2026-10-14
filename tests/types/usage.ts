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
  queryOccurrenceElement,
  rethrowEngineError
} from '../../src/index';
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
  .withPacks([pack]);
const packScript: string | null = builder._packScript();
const { contextSelector, engineOptions, runOnly } = builder._buildEngineArgs();
const scan = createInPageScan(runa11yCoreInPage);
const scanned: ScanResult = rethrowEngineError(result);
scan(null, contextSelector, engineOptions, runOnly);

const filtered: ScanResult = builder._applyReportOnly(scanned);
const message: string = formatFailures(filtered) + formatFailures(filtered.checksResults, { outcomes: ['fail'] });

builder.logger((gap, frameResult) => {
  const line: string = `${frameResult.url ?? ''}: ${gap.message}`;
  if (gap.kind === 'pack-skipped') gap.pack.reason.toUpperCase();
  return void line;
}).logger(() => {}).logger(null);
builder._warnScanGaps(result, '@surea11y/example');

for (const gap of getScanGaps(result)) {
  if (gap.kind === 'custom-rule-skipped') gap.rule.reason.toUpperCase();
  else if (gap.kind === 'pack-skipped') gap.pack.reason.toUpperCase();
  else gap.selectors.join(', ');
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

export { message, element, where, packScript };
