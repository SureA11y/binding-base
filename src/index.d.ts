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
  reportOnly(outcomes: Outcome | Outcome[]): this;
  elementRef(enabled?: boolean): this;
  frames(enabled?: boolean): this;
  analyze(): unknown;
  _normalizeCustomRule(rule: CustomRuleDescriptor): CustomRuleDescriptor;
  _buildEngineArgs(): EngineArgs;
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

export function formatFailures(checksResults: Array<Record<string, unknown>>, opts?: { outcomes?: Outcome[] }): string;
