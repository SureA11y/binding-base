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
  exclude(selector: string): this;
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

export function formatFailures(checksResults: Array<Record<string, unknown>>, opts?: { outcomes?: Outcome[] }): string;
