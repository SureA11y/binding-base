/// <reference lib="dom" />
// Internal scaffolding consumed by each surea11y binding's own
// A11yCoreBuilder (see each binding's own hand-written .d.ts for the
// consumer-facing types -- those declare a flat, non-inheriting
// `export class A11yCoreBuilder { ... }`, so nothing here needs to be
// re-exported or referenced from a binding's own .d.ts).

export type Outcome = 'pass' | 'fail' | 'cantTell' | 'notApplicable';

export const VALID_OUTCOMES: Outcome[];

/**
 * Where an occurrence goes in a review, among the questions: 'leanFail' or
 * 'leanPass' where its lean points that way (@surea11y/core 1.14.0 and
 * later), 'open' where only a person can answer it.
 */
export type ReviewGroup = 'leanFail' | 'leanPass' | 'open';

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
  /** Where analyze() sends scan gaps instead of console.warn: called once per gap, with that frame's result, and once per scan for each of the `internals-hook` and `listener-hook` notes. `null` goes back to console.warn. */
  logger(fn: ((entry: ScanGap | ScanNote, result: ScanResultLike) => void) | null): this;
  options(partialEngineOptions: Record<string, unknown>): this;
  withCustomRules(rules: CustomRuleDescriptor | CustomRuleDescriptor[]): this;
  /** Packs from @surea11y/core/pack; the scan names them, and analyze() injects _packScript(). */
  withPacks(packs: PackLike | PackLike[]): this;
  reportOnly(outcomes: Outcome | Outcome[]): this;
  elementRef(enabled?: boolean): this;
  /** A picture of each element the scan flags, on its occurrences' `screenshot` field; `false` turns them off. Throws a TypeError with code INVALID_ENGINE_OPTIONS for an option it can't use. */
  screenshots(options?: ScreenshotOptions | boolean): this;
  /**
   * Fetch, from Node, the style sheets the page can't read (another origin's)
   * and give core their text (engineOptions.styleSheetTexts). On by default;
   * needs @surea11y/core 1.14.0 or later.
   */
  fetchStyleSheets(enabled?: boolean): this;
  frames(enabled?: boolean): this;
  /**
   * Also scan the page under each condition after scanning it as it is;
   * analyze() returns one merged result (mergeConditionResults()). Not
   * combined with frames(true) yet. null or [] turns it off.
   */
  conditions(list: ReadonlyArray<ScanCondition> | null): this;
  /** For a subclass's analyze(): scan as the page is, then under each condition, and merge. */
  _scanUnderConditions<T>(
    scan: () => Promise<T>,
    driver: {
      save: () => Promise<unknown>;
      apply: (condition: ScanCondition) => Promise<void>;
      restore: (state: unknown) => Promise<void>;
    }
  ): Promise<T & { conditionRuns: ConditionRun[] }>;
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
  /** The last step of each frame's result: adds the steps for undecided findings (_addHowToCheck()), then filters per reportOnly(). */
  _applyReportOnly<T extends { checksResults?: unknown[] }>(result: T): T;
  /** A copy of one frame's result whose undecided findings carry howToCheck, from core's addHowToCheck() (1.14.0 and later); `result` as given otherwise. */
  _addHowToCheck<T>(result: T): T;
  /**
   * What the page's live regions were given (core's getAnnouncements({ selectors: true }), 1.14.0 and later),
   * run in `frame` through _evaluateInFrame(); null without the live-region hook.
   */
  _announcementsIn(frame: unknown, options?: { includeBehindModal?: boolean }): Promise<LocatedAnnouncement[] | null>;
  /** The installed core's getAnnouncements(), or null with an older core or none that can be loaded. */
  _coreGetAnnouncements(): ((...args: any[]) => unknown) | null;
  /** The installed core's addHowToCheck(), or null with an older core or none that can be loaded. */
  _coreAddHowToCheck(): ((result: any, options?: { packs?: unknown[] }) => any) | null;
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
      /** Under forced colors, whether the page's own CSS reacted to them (@surea11y/core 1.14.0 and later). */
      forcedColorsCss?: true;
      /** Whether the internals hook ran in the page, and when (@surea11y/core 1.12.0 and later). */
      internalsHook?: 'early' | 'late';
      /** Whether the listener hook ran in the page, and when (@surea11y/core 1.14.0 and later). */
      listenerHook?: 'early' | 'late';
      /** Whether the live-region hook ran in the page, and when (@surea11y/core 1.14.0 and later). */
      liveRegionHook?: 'early' | 'late';
    };
  };
}

export type ScanGap =
  | { kind: 'context-not-found'; message: string; selectors: string[] }
  | { kind: 'context-partly-not-found'; message: string; selectors: string[] }
  | { kind: 'custom-rule-skipped'; message: string; rule: { id: string | null; reason: string } }
  | { kind: 'pack-skipped'; message: string; pack: { name: string | null; reason: string } };

export type ScanNote =
  | { kind: 'forced-colors'; message: string; pageCss?: true }
  | { kind: 'internals-hook'; message: string; hook: 'none' | 'late'; elementCount: number }
  | { kind: 'listener-hook' | 'live-region-hook'; message: string; hook: 'none' | 'late'; findingCount: number; rules: string[] };

/** A text a live region was given, as _announcementsIn() returns it: the region named by a selector. */
export interface LocatedAnnouncement {
  text: string;
  politeness: 'polite' | 'assertive';
  /** performance.now() when the hook saw it. */
  time: number;
  /** Its place among all the changes the page made. */
  order: number;
  /** Given to a region behind an open modal dialog: listed only with includeBehindModal. */
  behindModal: boolean;
  /** The region; null once it has left the page. */
  selector: string | null;
  /** The shadow hosts leading to the region, outermost first. */
  shadowHostSelectors?: string[];
}

/** Core's HOOK_REASON_CODES, as getScanNotes() reads it. */
export interface HookReasonCodes {
  readonly [hook: string]: ReadonlyArray<{ readonly ruleId: string; readonly reasonCode: string; readonly effect: 'reports' | 'decides' | 'leans' }>;
}

/**
 * What a reader should know about how the page was scanned: forced colors,
 * custom elements the internals hook would have let the engine read, and
 * findings the listener or live-region hook would have decided (core
 * 1.14.0 and later, from its HOOK_REASON_CODES, or `hookReasonCodes` where
 * core can't be loaded). Throws a TypeError for anything but one result.
 */
export function getScanNotes(result: ScanResultLike, options?: { hookReasonCodes?: HookReasonCodes | null }): ScanNote[];

/** What a scan result says it left out; [] for a result from before @surea11y/core 1.10.0. Throws a TypeError for anything but one result. */
export function getScanGaps(result: ScanResultLike): ScanGap[];

/**
 * A failure message for an assertion: one entry per occurrence, by its own
 * outcome, failures first, then the questions that lean fail, lean pass,
 * and those only a person can answer. Given a whole result, also lists its
 * scan gaps, notes and the engine version. `outcomes` picks occurrences by
 * outcome or review group (default ['fail', 'cantTell']); `howToCheck` lists
 * each question's steps. Throws a TypeError for anything else than a result
 * or a checksResults array, or an outcome it doesn't know.
 */
export function formatFailures(
  input: ScanResultLike | ReadonlyArray<object>,
  opts?: { outcomes?: Array<Outcome | ReviewGroup>; howToCheck?: boolean; failOnSeverity?: Severity }
): string;

/** A rule result's severity, least to most severe in SEVERITIES. */
export type Severity = 'minor' | 'moderate' | 'serious' | 'critical';

/** The four severities, least to most severe. */
export const SEVERITIES: ReadonlyArray<Severity>;

/** A condition to scan a page under: a color scheme, a viewport width in CSS pixels, or both. */
export interface ScanCondition {
  colorScheme?: 'light' | 'dark';
  width?: number;
}

/** One scan of a merged result: its condition's label ('default' for the page as it was) and environment. */
export interface ConditionRun {
  condition: string;
  environment: Record<string, unknown> | null;
}

/** Checks a list of conditions as .conditions() takes it; null for none. Throws a TypeError for a bad one. */
export function readConditions(list: unknown, where?: string): ScanCondition[] | null;

/** A condition's label, as occurrences list it: 'dark', 'width 320', 'dark, width 320'; 'default' for null. */
export function conditionLabel(condition: ScanCondition | null): string;

/**
 * One result from the scans of a page under several conditions, the default
 * scan first: each rule's worst outcome, occurrences merged by element, rule
 * and reason code with the `conditions` they appeared under, and
 * `conditionRuns`.
 */
export function mergeConditionResults<T extends { checksResults: ReadonlyArray<object> }>(
  runs: ReadonlyArray<{ condition: string; result: T }>
): T & { conditionRuns: ConditionRun[] };

/**
 * The failing rule results that fail a test: every `fail`, or with
 * `failOnSeverity` only those whose severity is that level or above, as
 * `surea11y scan --fail-on-severity` counts them. Throws a TypeError for a
 * level that is not a severity.
 */
export function getGatingFailures<T extends { outcome: string; severity?: string }>(
  input: { checksResults: ReadonlyArray<T> } | ReadonlyArray<T>,
  opts?: { failOnSeverity?: Severity }
): T[];

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

/** How a binding runs a self-contained function in a frame: `fn(...args)`, resolving to what it returns (its `_evaluateInFrame()`). */
export type EvaluateInFrame = (frame: any, fn: (...args: any[]) => unknown, args: unknown[]) => Promise<unknown> | unknown;

/** The frame's name in file names: its <iframe>s, outermost first; [] for the page. Rejects when an <iframe> is gone. */
export function screenshotFrameKey(opts: { evaluateInFrame: EvaluateInFrame; framePath?: FramePathStep[] }): Promise<string[]>;

/** A token naming one element's capture, for prepareElementScreenshot() and releaseElementScreenshot(). */
export function screenshotToken(): string;

/** What to capture for one element, the page held until releaseElementScreenshot(); or why not, the page already put back. Never rejects. */
export function prepareElementScreenshot(opts: {
  evaluateInFrame: EvaluateInFrame;
  frame: unknown;
  framePath?: FramePathStep[];
  element: Pick<PlannedScreenshot, 'selector' | 'shadowHostSelectors'>;
  options: Readonly<Required<Omit<ScreenshotOptions, 'dir'>> & { dir: string | null }>;
  token: string;
}): Promise<
  | { clip: ScreenshotBox; view: ScreenshotView; box: ScreenshotBox; cropped: boolean }
  | { skipped: ScreenshotSkip; error?: string }
>;

/** Puts the page back after prepareElementScreenshot() with the same token. Never rejects. */
export function releaseElementScreenshot(opts: { evaluateInFrame: EvaluateInFrame; frame: unknown; framePath?: FramePathStep[]; token: string }): Promise<void>;

/** The self-contained in-page step of the screenshots, for a driver to send into a frame, as `screenshotInPage(request, element?)`. */
export function screenshotInPage(request: { op: string; [key: string]: unknown }, element?: unknown): unknown;

/** For `_captureBox()` when the driver only takes the whole viewport: cuts `box` out of that PNG (a Buffer or base64). */
export function cropViewportScreenshot(
  image: Uint8Array | string,
  box: ScreenshotBox,
  view?: Partial<Pick<ScreenshotView, 'devicePixelRatio' | 'viewport'>>
): ScreenshotBuffer;

/** In the page: the URLs of the style sheets it can't read. Self-contained. */
export function findUnreadableStyleSheets(): string[];
/** In Node: the text of each style sheet that answered in time. Never rejects. */
export function fetchStyleSheetTexts(
  hrefs: string[],
  options?: { fetch?: (url: string, init?: unknown) => Promise<{ ok: boolean; text(): Promise<string> }>; timeoutMs?: number }
): Promise<Array<{ href: string; text: string }>>;
