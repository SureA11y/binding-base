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

export type WcagVersion = '2.0' | '2.1' | '2.2';
export type WcagLevel = 'A' | 'AA' | 'AAA';
/** A level as withWcag() and wcagLevel() take it: in capitals or lower case (any case is accepted at run time, as core reads it). */
export type WcagLevelInput = WcagLevel | Lowercase<WcagLevel>;
export type IncludeMode = 'and' | 'or';

/** A catalog entry of a rule a scan will run (core's CheckCatalogEntry has more). */
export interface PlannedCheck {
  ruleId: string;
  title?: string;
  tags?: string[];
  [key: string]: unknown;
}

/** A catalog entry of a criterion a scan will report (core's RuleCatalogEntry has more). */
export interface PlannedCriterion {
  id: string;
  title?: string;
  [key: string]: unknown;
}

/** What `.screenshots()` takes; each option left out keeps its default. */
export interface ScreenshotOptions {
  /** Write each picture there as `element-<hash>.png`; without it, each comes back as a Buffer. */
  dir?: string;
  /** Which occurrences to picture, by their own outcome (`occurrenceOutcome` where given). Default `['fail']`. */
  outcomes?: Outcome[];
  /** CSS pixels of context around the element. Default 0. */
  padding?: number;
  /** Draw a box around the element, over the page. Default true. */
  highlight?: boolean;
  /** At most this many pictures per scan. Default 50. */
  max?: number;
}

/** Why an occurrence has no picture. */
export type ScreenshotSkip =
  | 'no-element'
  | 'page-level'
  | 'not-rendered'
  | 'zero-size'
  | 'off-screen'
  | 'max-reached'
  | 'capture-failed';

/**
 * A picture's bytes: Node's Buffer where its types are installed, which is
 * what the pictures are; a Uint8Array, which Buffer extends, elsewhere.
 */
export type ScreenshotBuffer = typeof globalThis extends { Buffer: { prototype: infer B } } ? B : Uint8Array;

/** A box in CSS pixels. */
export interface ScreenshotBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The `screenshot` field `.screenshots()` puts on each occurrence it
 * considered: the picture, with where the element shows in it (`box`, CSS
 * pixels; the image itself may be larger by the device pixel ratio) and
 * `cropped` when only part of the element shows; or why there is none.
 * Occurrences about the same element share one object.
 */
export type OccurrenceScreenshot =
  | { path: string; box: ScreenshotBox; cropped?: true }
  | { buffer: ScreenshotBuffer; box: ScreenshotBox; cropped?: true }
  | { skipped: ScreenshotSkip; error?: string };

/** The top-level page when a picture is taken: the second argument of `_captureBox()`. */
export interface ScreenshotView {
  devicePixelRatio: number;
  /** innerWidth and innerHeight, in CSS pixels. */
  viewport: { width: number; height: number };
  /** scrollX and scrollY, in CSS pixels. */
  scroll: { x: number; y: number };
}

/**
 * One <iframe> on the way from the top-level page to a scanned frame: the
 * frame holding it, as the binding's `_evaluateInFrame()` takes it, and the
 * <iframe> in it as a CSS selector, `{ selector, index }` (by default among
 * `'iframe, frame'`) or a driver's element handle.
 */
export interface FramePathStep<Frame = unknown> {
  frame: Frame;
  /** null when the binding could not find it (a frame detached after its scan): that frame's pictures fail. */
  iframe: string | { selector?: string; index: number } | object | null;
}

/** A pack from @surea11y/core/pack's definePack(): the fields withPacks() reads. */
export interface PackLike {
  name: string;
  version: string;
}

export class A11yCoreBuilderBase {
  constructor(opts?: { url?: string });
  include(selector: string): this;
  exclude(selector: string, opts?: { rules?: string | string[] }): this;
  withTags(tags: string | string[]): this;
  disableTags(tags: string | string[]): this;
  withRules(ruleIds: string | string[]): this;
  disableRules(ruleIds: string | string[]): this;
  /** Run the rules for a WCAG conformance target (@surea11y/core 1.11 and later). */
  withWcag(version: WcagVersion | 2.0 | 2.1 | 2.2, level?: WcagLevelInput): this;
  /** Also run the best-practice rules, those that name no WCAG criterion (@surea11y/core 1.11 and later). */
  withBestPractices(enabled?: boolean): this;
  /** How withTags() and withRules() combine when both are given: 'and' (the engine's default) or 'or'. */
  includeMode(mode: IncludeMode): this;
  /** The WCAG level of the criteria the scan reports, without changing which rules run; null clears it (@surea11y/core 1.12.0 and later). */
  wcagLevel(level: WcagLevelInput | null): this;
  /** Where analyze() sends scan gaps instead of console.warn: called once per gap, with that frame's result, and once per scan for the `internals-hook` note. `null` goes back to console.warn. */
  logger(fn: ((entry: ScanGap | ScanNote, result: ScanResultLike) => void) | null): this;
  options(partialEngineOptions: Record<string, unknown>): this;
  withCustomRules(rules: CustomRuleDescriptor | CustomRuleDescriptor[]): this;
  /** Packs from @surea11y/core/pack; the scan names them, and analyze() injects _packScript(). */
  withPacks(packs: PackLike | PackLike[]): this;
  reportOnly(outcomes: Outcome | Outcome[]): this;
  elementRef(enabled?: boolean): this;
  /** A picture of each element the scan flags, on its occurrences' `screenshot` field; `false` turns them off. Throws a TypeError with code INVALID_ENGINE_OPTIONS for an option it can't use. */
  screenshots(options?: ScreenshotOptions | boolean): this;
  frames(enabled?: boolean): this;
  /** The rules a scan with this builder will run, from core's getChecksForRunOnly(); in Node, no page needed (@surea11y/core 1.12.0 and later). */
  plannedChecks(): PlannedCheck[];
  /** The criteria a scan with this builder will report in rulesResults, from core's getRulesForRunOnly() (@surea11y/core 1.12.0 and later). */
  plannedCriteria(): PlannedCriterion[];
  analyze(): unknown;
  _normalizeCustomRule(rule: CustomRuleDescriptor): CustomRuleDescriptor;
  _buildEngineArgs(): EngineArgs;
  /** The script that registers this scan's packs in a page, or null without packs. */
  _packScript(): string | null;
  /** Sends each of a frame's scan gaps to the logger(), or prints it with console.warn as `<source> (<url>): <message>`. */
  _warnScanGaps(result: unknown, source: string): void;
  _applyReportOnly<T extends { checksResults?: unknown[] }>(result: T): T;
  /** The screenshots step, once per scanned frame, after the scan and before reportOnly(); does nothing unless screenshots() was called. */
  _captureScreenshots<T>(result: T, frame: unknown, framePath?: FramePathStep[]): Promise<T>;
  /** Implemented by a binding that takes screenshots: run `fn(...args)` in `frame` and resolve to its result. */
  _evaluateInFrame?(frame: unknown, fn: (...args: any[]) => unknown, args: unknown[]): Promise<unknown>;
  /** Implemented by a binding that takes screenshots: a PNG of `box`, CSS pixels relative to the top-level viewport. */
  _captureBox?(box: ScreenshotBox, view: ScreenshotView): Promise<Uint8Array | string>;
}

/** The `code` on an error @surea11y/core throws for input it cannot use (1.10.0 and later). */
export type EngineErrorCode =
  | 'INVALID_RUN_ONLY'
  | 'INVALID_CONTEXT_SELECTOR'
  | 'INVALID_ENGINE_OPTIONS'
  | 'PAGE_BUILTINS_BROKEN';

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
  /** The URL the scan reports for the page or frame. */
  url?: string | null;
  /** How the contextSelector resolved; null without one (@surea11y/core 1.10.0 and later). */
  contextMatch?: { elementCount: number; unmatchedSelectors: string[] } | null;
  /** Custom rules that did not run, and why (@surea11y/core 1.10.0 and later). */
  skippedCustomRules?: Array<{ id: string | null; reason: string; excluded?: true }>;
  /** Packs that did not run, and why (@surea11y/core 1.11 and later). */
  skippedPacks?: Array<{ name: string | null; reason: string }>;
  engine?: {
    version?: string;
    /** The level of the criteria the scan reports (@surea11y/core 1.12.0 and later). */
    wcagLevel?: WcagLevel;
    environment?: {
      /** Whether the page was shown in forced colors (@surea11y/core 1.12.0 and later). */
      forcedColors?: 'active' | 'none';
      /** Whether the internals hook ran in the page, and when (@surea11y/core 1.12.0 and later). */
      internalsHook?: 'early' | 'late';
    };
  };
}

export type ScanGap =
  | { kind: 'context-not-found'; message: string; selectors: string[] }
  | { kind: 'context-partly-not-found'; message: string; selectors: string[] }
  | { kind: 'custom-rule-skipped'; message: string; rule: { id: string | null; reason: string } }
  | { kind: 'pack-skipped'; message: string; pack: { name: string | null; reason: string } };

export type ScanNote =
  | { kind: 'forced-colors'; message: string }
  | { kind: 'internals-hook'; message: string; hook: 'none' | 'late'; elementCount: number };

/** What a reader should know about how the page was scanned: forced colors, and custom elements the internals hook would have let the engine read. Throws a TypeError for anything but one result. */
export function getScanNotes(result: ScanResultLike): ScanNote[];

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


/** The options `.screenshots()` uses for what it isn't given. */
export const SCREENSHOT_DEFAULTS: Readonly<Required<Omit<ScreenshotOptions, 'dir'>> & { dir: string | null }>;

/** Every reason an occurrence can have no picture. */
export const SCREENSHOT_SKIPS: ScreenshotSkip[];

/** One element to picture, and the occurrences about it. */
export interface PlannedScreenshot {
  key: string;
  /** Its file name, from screenshotFileName(). */
  name: string;
  selector: string;
  shadowHostSelectors: string[] | null;
  occurrences: object[];
}

/** Which elements of one frame's result to picture, grouped by element, and the occurrences with no selector. Changes nothing. */
export function planScreenshots(
  result: ScanResultLike | null | undefined,
  opts?: { outcomes?: ReadonlyArray<Outcome>; frameKey?: string[] }
): { elements: PlannedScreenshot[]; unlocated: object[] };

/** `element-<8 hex digits>.png`, from where the element is: the same on every run and platform. */
export function screenshotFileName(frameKey: string[], shadowHostSelectors: string[] | null | undefined, selector: string): string;

/** The self-contained in-page step of the screenshots, for a driver to send into a frame, as `screenshotInPage(request, element?)`. */
export function screenshotInPage(request: { op: string; [key: string]: unknown }, element?: unknown): unknown;

/** For `_captureBox()` when the driver only takes the whole viewport: cuts `box` out of that PNG (a Buffer or base64). */
export function cropViewportScreenshot(
  image: Uint8Array | string,
  box: ScreenshotBox,
  view?: Partial<Pick<ScreenshotView, 'devicePixelRatio' | 'viewport'>>
): ScreenshotBuffer;
