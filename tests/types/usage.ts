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

declare const result: ScanResult;

const builder = new A11yCoreBuilderBase().withRules('img-alt-present').include('main');
const { contextSelector, engineOptions, runOnly } = builder._buildEngineArgs();
const scan = createInPageScan(runa11yCoreInPage);
const scanned: ScanResult = rethrowEngineError(result);
scan(null, contextSelector, engineOptions, runOnly);

const filtered: ScanResult = builder._applyReportOnly(scanned);
const message: string = formatFailures(filtered) + formatFailures(filtered.checksResults, { outcomes: ['fail'] });

for (const gap of getScanGaps(result)) {
  if (gap.kind === 'custom-rule-skipped') gap.rule.reason.toUpperCase();
  else gap.selectors.join(', ');
}

const occurrence = result.checksResults[0].occurrences[0];
const element: Element | null = queryOccurrenceElement(occurrence.selector, occurrence.shadowHostSelectors, document);
const where: string = formatOccurrenceLocation(occurrence);

try {
  rethrowEngineError({});
} catch (e) {
  if (e instanceof EngineError && e.code === 'INVALID_CONTEXT_SELECTOR') String(e.selector);
}

export { message, element, where };
