/// <reference lib="dom" />
// Internal scaffolding consumed by each surea11y binding's own
// A11yCoreBuilder (see each binding's own hand-written .d.ts for the
// consumer-facing types -- those declare a flat, non-inheriting
// `export class A11yCoreBuilder { ... }`, so nothing here needs to be
// re-exported or referenced from a binding's own .d.ts).

export type Outcome = 'pass' | 'fail' | 'cantTell' | 'notApplicable';

export const VALID_OUTCOMES: Outcome[];

export function canReconstructAsFunction(src: string): boolean;
export function toReconstructableSource(fn: (...args: unknown[]) => unknown): string;

export interface CustomRuleDescriptor {
  id: string;
  meta?: Record<string, unknown>;
  runInPage: ((ctx: unknown) => unknown) | string;
  applicability?: ((ctx: unknown) => boolean) | string;
  data?: Record<string, unknown>;
}

export interface EngineArgs {
  contextSelector: string | string[] | null;
  engineOptions: Record<string, unknown>;
  runOnly: Record<string, unknown> | null;
}

export class A11yCoreBuilderBase {
  constructor(opts?: { url?: string });
  include(selector: string): this;
  exclude(selector: string, opts?: { rules?: string | string[] }): this;
  withTags(tags: string | string[]): this;
  disableTags(tags: string | string[]): this;
  withRules(ruleIds: string | string[]): this;
  disableRules(ruleIds: string | string[]): this;
  options(partialEngineOptions: Record<string, unknown>): this;
  withCustomRules(rules: CustomRuleDescriptor | CustomRuleDescriptor[]): this;
  /** Packs from @surea11y/core/pack; the scan names them, and analyze() injects _packScript(). */
  withPacks(packs: object | object[]): this;
  reportOnly(outcomes: Outcome | Outcome[]): this;
  elementRef(enabled?: boolean): this;
  frames(enabled?: boolean): this;
  analyze(): unknown;
  _normalizeCustomRule(rule: CustomRuleDescriptor): CustomRuleDescriptor;
  _buildEngineArgs(): EngineArgs;
  /** The script that registers this scan's packs in a page, or null without packs. */
  _packScript(): string | null;
  _applyReportOnly<T extends { checksResults?: unknown[] }>(result: T): T;
}

/** The `code` on an error @surea11y/core throws for input it cannot use (1.10.0 and later). */
export type EngineErrorCode = 'INVALID_RUN_ONLY' | 'INVALID_CONTEXT_SELECTOR';

export const ENGINE_ERROR_CODES: EngineErrorCode[];

/** The key under which a createInPageScan() function returns an engine error. */
export const ENGINE_ERROR_KEY: '__surea11yEngineError';

/** An engine error rebuilt on the Node side of a driver, with its `code`. */
export class EngineError extends Error {
  constructor(message: string, opts?: { code?: string; selector?: string | null });
  name: 'EngineError';
  code: EngineErrorCode | (string & {});
  /** The selector that failed to parse, for INVALID_CONTEXT_SELECTOR; otherwise null. */
  selector: string | null;
}

/** Same parameters as core's runa11yCoreInPage; returns its result, or an engine error as a plain object. */
export type InPageScan = (
  pageUrl: string | null,
  contextSelector: string | string[] | null,
  engineOptions: Record<string, unknown> | null,
  runOnly: Record<string, unknown> | string | string[] | null
) => unknown;

/**
 * Wraps core's runa11yCoreInPage so an engine error survives a driver's
 * serialization boundary. The returned function is self-contained.
 */
export function createInPageScan(runa11yCoreInPage: (...args: any[]) => unknown): InPageScan;

/** Throws an EngineError when `value` is one returned by a createInPageScan() function; otherwise returns `value`. */
export function rethrowEngineError<T>(value: T): T;

/** The parts of a scan result formatFailures() and getScanGaps() read (core's ScanResult has more). */
export interface ScanResultLike {
  checksResults: ReadonlyArray<object>;
  /** How the contextSelector resolved; null without one (@surea11y/core 1.10.0 and later). */
  contextMatch?: { elementCount: number; unmatchedSelectors: string[] } | null;
  /** Custom rules that did not run, and why (@surea11y/core 1.10.0 and later). */
  skippedCustomRules?: Array<{ id: string | null; reason: string }>;
  engine?: { version?: string };
}

export type ScanGap =
  | { kind: 'context-not-found'; message: string; selectors: string[] }
  | { kind: 'context-partly-not-found'; message: string; selectors: string[] }
  | { kind: 'custom-rule-skipped'; message: string; rule: { id: string | null; reason: string } };

/** What a scan result says it left out; [] for a result from before @surea11y/core 1.10.0. Throws a TypeError for anything but one result. */
export function getScanGaps(result: ScanResultLike): ScanGap[];

/**
 * A failure message for an assertion. Given a whole result, also lists its
 * scan gaps and the engine version. Throws a TypeError for anything else
 * than a result or a checksResults array.
 */
export function formatFailures(input: ScanResultLike | ReadonlyArray<object>, opts?: { outcomes?: Outcome[] }): string;

/** Where an occurrence or a margin points: what queryOccurrenceElement() and formatOccurrenceLocation() read. */
export interface OccurrenceLocation {
  selector?: string;
  /** The shadow hosts leading to the element, outermost first (@surea11y/core 1.10.0 and later). */
  shadowHostSelectors?: string[];
}

/**
 * Finds the element an occurrence points at, through its shadow hosts. Runs
 * in the page and is self-contained, so a driver can serialize it. Returns
 * null when anything on the way is missing.
 */
export function queryOccurrenceElement(
  selector: string,
  shadowHostSelectors?: string[] | null,
  root?: { querySelector(selector: string): unknown } | null
): Element | null;

/** The occurrence's location for a person to read, as `host >>> selector`; empty without a selector. */
export function formatOccurrenceLocation(occurrence: OccurrenceLocation | null | undefined): string;
