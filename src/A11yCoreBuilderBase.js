'use strict';

const { toReconstructableSource } = require('./customRuleReconstruction');
const { readConditions, conditionLabel, mergeConditionResults } = require('./conditions');
const { getScanGaps } = require('./scanGaps');
const { getScanNotes } = require('./scanNotes');
const { normalizeScreenshotOptions, captureScreenshots } = require('./screenshots');
const { findUnreadableStyleSheets, fetchStyleSheetTexts } = require('./styleSheets');

const { VALID_OUTCOMES } = require('./review');

// @surea11y/core/pack prepares packs with Node's fs and vm, so it is loaded
// through Node's own require with the id in a variable, which a bundler
// doesn't follow: a Cypress spec bundles this package for the browser.
const CORE_PACK = '@surea11y/core/pack';
function loadCorePack() {
  if (typeof module !== 'object' || !module || typeof module.require !== 'function') {
    throw new Error('packs are prepared in Node');
  }
  return module.require(CORE_PACK);
}

// The catalog functions plannedChecks()/plannedCriteria() call, loaded the
// same way, so a bundle for the browser doesn't take in the whole engine.
const CORE = '@surea11y/core';
function loadCoreCatalog(method) {
  let core;
  try {
    if (typeof module !== 'object' || !module || typeof module.require !== 'function') {
      throw new Error('the catalog is read in Node');
    }
    core = module.require(CORE);
  } catch (err) {
    throw new Error(`A11yCoreBuilder.${method}(): needs @surea11y/core 1.12.0 or later, installed beside the binding, in Node.`, { cause: err });
  }
  if (typeof core.getRulesForRunOnly !== 'function' || typeof core.getChecksForRunOnly !== 'function') {
    throw new Error(`A11yCoreBuilder.${method}(): needs @surea11y/core 1.12.0 or later; the installed core has no getRulesForRunOnly().`);
  }
  return core;
}

// What surea11y's runOnly.wcag accepts.
const WCAG_VERSIONS = ['2.0', '2.1', '2.2'];
const WCAG_LEVELS = ['A', 'AA', 'AAA'];

// Core reads a WCAG level in any case; the builder sends it in capitals.
function normalizeLevel(level) {
  return typeof level === 'string' ? level.trim().toUpperCase() : level;
}

// How core reads an on/off engine option (see its docs/ENGINE_OPTIONS.md):
// these spell off.
function isOff(value) {
  return value === false || value === 0 || value === 'false' || value === '0';
}

// What surea11y's runOnly.includeMode accepts.
const INCLUDE_MODES = ['and', 'or'];

// withTags()/disableTags()/withRules()/disableRules() take a string or an
// array of strings. Anything else (undefined from a missing config value,
// a number) can name no rule or tag, so the engine would throw
// INVALID_RUN_ONLY for it only once the page is open; throw it here, where
// the call is, with the same code.
function selectionValues(method, kind, value) {
  const list = Array.isArray(value) ? value : [value];
  for (const v of list) {
    if (typeof v !== 'string' || !v.trim()) {
      const err = new TypeError(`A11yCoreBuilder.${method}(): each ${kind} must be a non-empty string, not ${v === '' ? 'an empty string' : String(v)}.`);
      err.code = 'INVALID_RUN_ONLY';
      throw err;
    }
  }
  return list;
}

/**
 * Shared, driver-agnostic scaffolding for every surea11y binding's own
 * `A11yCoreBuilder` (Playwright/Puppeteer/Selenium/WebdriverIO/Cypress).
 * Not meant to be used directly -- each binding's own `A11yCoreBuilder`
 * extends this class and adds exactly the parts that are genuinely
 * driver-specific: the constructor's driver-handle validation, `analyze()`'s
 * actual injection mechanics, all frame-traversal logic, and
 * `_attachElementRefs()`. See each binding's own README.md for the
 * user-facing API and driver-specific behavior -- this class's own doc
 * comments describe the shared mechanics only, not end-user usage.
 *
 * Every method here was, until this package existed, copy-pasted
 * byte-for-byte across all five binding projects. Extracted once five real
 * consumers existed and the duplication was actually costing something.
 *
 * Mutability contract (identical in every binding that extends this):
 * `include()`/`exclude()`/`withRules()`/`disableRules()`/`withTags()`/
 * `disableTags()`/`options()`/`withCustomRules()`/`withPacks()` accumulate
 * across calls, with no reset between `analyze()` calls -- create one
 * builder per scan. `reportOnly()`/`frames()`/`elementRef()`/`withWcag()`/
 * `withBestPractices()`/`includeMode()`/`wcagLevel()`/`logger()`/
 * `screenshots()` are the exception: each call replaces the previous value
 * rather than merging with it.
 */
class A11yCoreBuilderBase {
  /**
   * @param {{ url?: string }} [opts] `url` overrides the URL surea11y
   *   reports for the top-level scan's result; when omitted, surea11y
   *   falls back to the page's own `document.location.href` itself.
   */
  constructor({ url } = {}) {
    this._url = url || null;
    this._scanFrames = false;
    this._includeSelectors = [];
    this._excludeSelectors = [];
    this._ruleScopedExcludeSelectors = {};
    this._includeRuleIds = [];
    this._excludeRuleIds = [];
    this._tags = [];
    this._excludeTags = [];
    this._wcag = null;
    this._bestPractices = false;
    this._includeMode = null;
    this._wcagLevel = null;
    this._logger = null;
    this._saidHookNotes = new Set();
    this._engineOptions = {};
    this._reportOutcomes = null;
    this._elementRef = false;
    this._customRules = [];
    this._packs = [];
    this._packScriptSource = null;
    this._screenshots = null;
    // Fetch the style sheets the page can't read, for core to read instead.
    this._fetchStyleSheets = true;
    this._screenshotScan = null;
    // .conditions(): the conditions to scan the page under after the default.
    this._conditions = null;
    // While a scan under a condition runs, its label: screenshots name it.
    this._screenshotCondition = null;
  }

  /**
   * Scope the scan to one region. Call multiple times to scan several,
   * possibly disjoint regions in one run (surea11y's contextSelector
   * accepts an array of selectors for exactly this -- see surea11y's
   * docs/ENGINE_OPTIONS.md). Since @surea11y/core 1.10.0, a selector that
   * matches nothing scans nothing (the result's `contextMatch` says so, and
   * getScanGaps() reports it), and one the browser can't parse throws an
   * error with `code: 'INVALID_CONTEXT_SELECTOR'`.
   */
  include(selector) {
    if (selector) this._includeSelectors.push(selector);
    return this;
  }

  /**
   * Skip elements matching this selector anywhere in the scanned scope.
   * With `opts.rules`, the exclusion applies only to the named rule ID(s)
   * instead of globally -- on top of (not instead of) any global exclusions
   * from other `.exclude(selector)` calls. Rule IDs accept the same bare /
   * `a11ycore-`-prefixed forms `withRules()`/`disableRules()` accept.
   * @param {string} selector
   * @param {{ rules?: (string|string[]) }} [opts]
   */
  exclude(selector, opts) {
    if (!selector) return this;
    const ruleIds = opts && opts.rules ? (Array.isArray(opts.rules) ? opts.rules : [opts.rules]) : null;
    if (ruleIds && ruleIds.length) {
      for (const ruleId of ruleIds) {
        if (!this._ruleScopedExcludeSelectors[ruleId]) this._ruleScopedExcludeSelectors[ruleId] = [];
        this._ruleScopedExcludeSelectors[ruleId].push(selector);
      }
    } else {
      this._excludeSelectors.push(selector);
    }
    return this;
  }

  /**
   * Only run rules carrying at least one of these tags. A tag the engine
   * doesn't know is ignored with a warning; when none of them is known, the
   * scan throws an error with `code: 'INVALID_RUN_ONLY'` (@surea11y/core
   * 1.10.0 and later), so a typo can't pass a scan that ran nothing.
   */
  withTags(tags) {
    this._tags = this._tags.concat(selectionValues('withTags', 'tag', tags));
    return this;
  }

  /**
   * Run the rules for a WCAG conformance target: `withWcag('2.2', 'AA')`
   * runs those of the version's criteria at that level and below
   * (surea11y's runOnly.wcag, @surea11y/core 1.11 and later). withTags()
   * and withRules() add to its rules; the disable methods apply after.
   * The level is read in any case and sent in capitals. Calling it again
   * replaces the target.
   */
  withWcag(version, level = 'AA') {
    const v = typeof version === 'number' ? version.toFixed(1) : version;
    const l = normalizeLevel(level);
    if (!WCAG_VERSIONS.includes(v) || !WCAG_LEVELS.includes(l)) {
      const err = new TypeError(
        `A11yCoreBuilder.withWcag(): expected a version (${WCAG_VERSIONS.join(', ')}) and a level (${WCAG_LEVELS.join(', ')}), not ${JSON.stringify(version)}, ${JSON.stringify(level)}.`
      );
      err.code = 'INVALID_RUN_ONLY';
      throw err;
    }
    this._wcag = { version: v, level: l };
    return this;
  }

  /**
   * Also run the best-practice rules, those that name no WCAG criterion
   * (surea11y's runOnly.bestPractices, @surea11y/core 1.11 and later). On its
   * own it runs the best practices only; beside a profile in options(), it
   * adds them to the profile's rules.
   */
  withBestPractices(enabled = true) {
    this._bestPractices = enabled !== false;
    return this;
  }

  /**
   * How withTags() and withRules() combine when both are given (surea11y's
   * runOnly.includeMode): `'and'`, the engine's default, runs only the rules
   * matching both; `'or'` runs those matching either, so
   * `.withTags('wcag2a').withRules('region').includeMode('or')` runs the
   * wcag2a rules plus region. Sent only when set; on its own, with nothing
   * else selected, it changes nothing. Calling it again replaces the mode.
   */
  includeMode(mode) {
    if (!INCLUDE_MODES.includes(mode)) {
      const err = new TypeError(`A11yCoreBuilder.includeMode(): expected ${INCLUDE_MODES.map((m) => `'${m}'`).join(' or ')}, not ${JSON.stringify(mode)}.`);
      err.code = 'INVALID_RUN_ONLY';
      throw err;
    }
    this._includeMode = mode;
    return this;
  }

  /**
   * The WCAG level of the criteria the scan reports (surea11y's
   * engineOptions.wcagLevel): criteria above it are left out of
   * rulesResults, while every selected rule still runs and reports in
   * checksResults. It gives the level of a scan that names checks rather
   * than criteria: `.withRules('contrast-computable')` reports 1.4.3 and,
   * at AAA, 1.4.6; with `.wcagLevel('AA')`, 1.4.3 alone. Any case is
   * accepted and sent in capitals; it wins over a wcagLevel given through
   * options(). Calling it again replaces the level, and null clears it.
   * Needs @surea11y/core 1.12.0 or later.
   */
  wcagLevel(level) {
    if (level === null) {
      this._wcagLevel = null;
      return this;
    }
    const upper = normalizeLevel(level);
    if (!WCAG_LEVELS.includes(upper)) {
      const err = new TypeError(`A11yCoreBuilder.wcagLevel(): expected a level (${WCAG_LEVELS.join(', ')}), or null, not ${level === undefined ? 'undefined' : JSON.stringify(level)}.`);
      err.code = 'INVALID_ENGINE_OPTIONS';
      throw err;
    }
    this._wcagLevel = upper;
    return this;
  }

  /** Never run rules carrying any of these tags (applied after withTags). */
  disableTags(tags) {
    this._excludeTags = this._excludeTags.concat(selectionValues('disableTags', 'tag', tags));
    return this;
  }

  /**
   * Only run these specific rule IDs (accepts with or without the
   * `a11ycore-` prefix). Unknown IDs are handled as withTags() describes.
   */
  withRules(ruleIds) {
    this._includeRuleIds = this._includeRuleIds.concat(selectionValues('withRules', 'rule ID', ruleIds));
    return this;
  }

  /** Never run these specific rule IDs (applied after withRules). */
  disableRules(ruleIds) {
    this._excludeRuleIds = this._excludeRuleIds.concat(selectionValues('disableRules', 'rule ID', ruleIds));
    return this;
  }

  /** Merge arbitrary engineOptions (locale, contrast.mode, policyContract, ...) -- see surea11y's docs/ENGINE_OPTIONS.md. */
  options(partialEngineOptions) {
    this._engineOptions = { ...this._engineOptions, ...(partialEngineOptions || {}) };
    return this;
  }

  /**
   * Register one or more custom rules for just this scan (surea11y's
   * engineOptions.customRules escape hatch -- see surea11y's
   * docs/ENGINE_OPTIONS.md). A
   * descriptor is { id, meta?, runInPage, applicability?, data? }, the same
   * shape as an internal surea11y rule module's own export. Call multiple
   * times to register several rules across one scan (accumulates, same as
   * withRules()/withTags()).
   *
   * Validates the whole batch before normalizing/pushing any of it, so one
   * invalid descriptor later in the array can't leave an earlier valid one
   * partially registered. Each valid descriptor is then passed through
   * `this._normalizeCustomRule(rule)` -- see that method's own doc comment
   * for what it does and why a subclass might override it.
   *
   * A descriptor whose `id` collides with a built-in rule overrides it for
   * that scan only (surea11y's own semantics) -- nothing here persists past
   * this one analyze() call or mutates surea11y's static rule catalog.
   */
  withCustomRules(rules) {
    const list = Array.isArray(rules) ? rules : [rules];

    for (const rule of list) {
      if (!rule || typeof rule.id !== 'string' || !rule.id) {
        throw new Error('A11yCoreBuilder.withCustomRules(): each custom rule descriptor requires a non-empty string `id`.');
      }
      if (typeof rule.runInPage !== 'function' && (typeof rule.runInPage !== 'string' || !rule.runInPage)) {
        throw new Error(`A11yCoreBuilder.withCustomRules(): custom rule "${rule.id}" requires a \`runInPage\` function or function-source string.`);
      }
      if (rule.applicability !== undefined && typeof rule.applicability !== 'function' && (typeof rule.applicability !== 'string' || !rule.applicability)) {
        throw new Error(`A11yCoreBuilder.withCustomRules(): custom rule "${rule.id}"'s \`applicability\` must be a function or function-source string when provided.`);
      }
    }

    for (const rule of list) {
      this._customRules.push(this._normalizeCustomRule(rule));
    }
    return this;
  }

  /**
   * Add packs from @surea11y/core/pack (rules, a standard or a checklist, and
   * their profiles and messages) to this scan -- see surea11y's
   * docs/ENGINE_OPTIONS.md, "Packs". Accumulates across calls. A pack is an
   * object prepared in Node, so it can't cross into the page: the scan names
   * the packs in engineOptions.packs (as name@version), and a subclass's
   * analyze() injects `_packScript()` into each page or frame after the
   * engine's bundle, which registers them there. surea11y checks each pack
   * when the script is built; one it can't run throws then. Packs need
   * @surea11y/core 1.11 or later.
   */
  withPacks(packs) {
    const list = Array.isArray(packs) ? packs : [packs];
    for (const pack of list) {
      if (!pack || typeof pack !== 'object' || typeof pack.name !== 'string' || typeof pack.version !== 'string') {
        throw new Error('A11yCoreBuilder.withPacks(): each pack must be a pack object ({ name, version, namespace, core, ... }) from @surea11y/core/pack.');
      }
    }
    this._packs.push(...list);
    this._packScriptSource = null;
    return this;
  }

  /**
   * The script that registers this scan's packs in a page, for a subclass's
   * analyze() to inject after the engine's bundle, in every frame it scans;
   * null without packs. Built once per set of packs (surea11y's packScript).
   */
  _packScript() {
    if (!this._packs.length) return null;
    if (this._packScriptSource === null) {
      let packScript;
      try {
        ({ packScript } = loadCorePack());
      } catch (err) {
        throw new Error('A11yCoreBuilder.withPacks(): packs need @surea11y/core 1.11 or later, which runs them.', { cause: err });
      }
      this._packScriptSource = packScript(this._packs);
    }
    return this._packScriptSource;
  }

  /**
   * Per-rule normalization step for `withCustomRules()`. Default behavior
   * (correct for Playwright/Puppeteer/Selenium/WebdriverIO, i.e. every
   * binding whose driver crosses a real serialization boundary --
   * page.evaluate()/executeScript()/browser.execute() -- to reach the page):
   * converts a live `runInPage`/`applicability` function to a function-source
   * string via `toReconstructableSource()`, since that boundary cannot carry
   * a live Function reference (surea11y reconstructs the string back into a
   * function with `new Function` on the page side). A string is passed
   * through unchanged.
   *
   * Override this in a binding that does NOT cross such a boundary (Cypress
   * is the one binding today where this applies -- its test code runs in the
   * same browser tab as the page, so a live cross-realm function reference
   * survives without stringification) to
   * just return `{ ...rule }` unchanged.
   */
  _normalizeCustomRule(rule) {
    const normalized = {
      ...rule,
      runInPage: typeof rule.runInPage === 'function' ? toReconstructableSource(rule.runInPage) : rule.runInPage
    };
    if (typeof rule.applicability === 'function') normalized.applicability = toReconstructableSource(rule.applicability);
    return normalized;
  }

  /**
   * Post-filter `checksResults` down to only the given outcomes (e.g.
   * .reportOnly(['fail', 'cantTell']) to drop pass/notApplicable noise).
   * Binding-layer only -- surea11y itself always computes every rule's
   * outcome; this just trims what analyze() hands back. Applied per-frame
   * when combined with .frames(true).
   */
  reportOnly(outcomes) {
    const list = Array.isArray(outcomes) ? outcomes : [outcomes];
    for (const outcome of list) {
      if (!VALID_OUTCOMES.includes(outcome)) {
        throw new Error(`A11yCoreBuilder.reportOnly(): invalid outcome "${outcome}" -- must be one of ${VALID_OUTCOMES.join(', ')}.`);
      }
    }
    this._reportOutcomes = list;
    return this;
  }

  /**
   * Opt in to resolving each fail/cantTell occurrence's `selector` to a live,
   * driver-native element reference. Default off -- resolving one per
   * occurrence costs a real page query. What exactly gets attached (field
   * name and type) is entirely up to the subclass's own `analyze()`/
   * `_attachElementRefs()` -- this method only tracks the on/off flag.
   */
  elementRef(enabled = true) {
    this._elementRef = !!enabled;
    return this;
  }

  /**
   * Opt in to a picture of each element the scan flags, beside its finding:
   * every occurrence considered gets a `screenshot` field, the picture
   * (`{ buffer, box }`, or `{ path, box }` with `dir`) or why there is none
   * (`{ skipped }`). Off by default: pictures of real pages can hold
   * personal data, and they end up as CI artifacts.
   *
   * One picture per element: the occurrences that point at the same element
   * share it. `outcomes` (default `['fail']`) picks occurrences by their own
   * outcome (`occurrenceOutcome` where the rule gives one), `padding` (CSS
   * px, default 0) adds context around the element, `highlight` (default
   * true) draws a box around it over the page, and `max` (default 50) is
   * how many pictures one scan takes. With `dir`, each picture is written
   * there as `element-<hash>.png`, named after where the element is, so it
   * keeps its name from run to run.
   *
   * `.screenshots()` and `.screenshots(true)` turn them on with the
   * defaults, `.screenshots(false)` off; each call replaces the previous
   * options. Throws a TypeError with `code: 'INVALID_ENGINE_OPTIONS'` for an
   * option it can't use, and an Error when the binding doesn't take
   * screenshots (see `_captureScreenshots()`).
   * @param {{ dir?: string, outcomes?: string[], padding?: number, highlight?: boolean, max?: number }|boolean} [options]
   */
  screenshots(options) {
    const normalized = normalizeScreenshotOptions(options);
    if (normalized && !this._takesScreenshots()) {
      throw new Error(
        'A11yCoreBuilder.screenshots(): this binding does not take screenshots yet. ' +
        'A binding takes them by implementing _evaluateInFrame() and _captureBox() and calling _captureScreenshots() in analyze() ' +
        '(see @surea11y/binding-base\'s README.md, "Screenshots of failing elements").'
      );
    }
    this._screenshots = normalized;
    return this;
  }

  /**
   * Whether to fetch, from Node, the style sheets the page can't read
   * (another origin's) and give core their text, so a rule that reads the
   * CSS, as css-orientation-lock does, can check them instead of asking. On
   * by default, as axe fetches them; `false` sends no request but the page's
   * own. Needs @surea11y/core 1.14.0 or later, and a binding that implements
   * `_evaluateInFrame()`; otherwise it does nothing.
   * @param {boolean} [enabled=true]
   */
  fetchStyleSheets(enabled = true) {
    if (typeof enabled !== 'boolean') {
      const err = new TypeError(`A11yCoreBuilder.fetchStyleSheets(): expected true or false, not ${JSON.stringify(enabled)}.`);
      err.code = 'INVALID_ENGINE_OPTIONS';
      throw err;
    }
    this._fetchStyleSheets = enabled;
    return this;
  }

  /**
   * The engine options for a scan of `frame`, with the text of the style
   * sheets it can't read added to `styleSheetTexts`, for a subclass's
   * analyze() to call before each frame's scan:
   *
   *   const options = await this._styleSheetEngineOptions(frame, engineOptions);
   *
   * Asks the page which sheets it can't read (_evaluateInFrame()), fetches
   * them from Node, where no CORS applies, with `this._styleSheetFetch` if a
   * binding sets one (its driver's request API, which carries the page's
   * cookies) or the global fetch, each within five seconds, and leaves out
   * any whose text the caller already gave. Never throws: when anything
   * fails, or with fetchStyleSheets(false), an older core or no
   * _evaluateInFrame(), it returns `engineOptions` as given.
   */
  async _styleSheetEngineOptions(frame, engineOptions) {
    const given = engineOptions || {};
    if (!this._fetchStyleSheets || typeof this._evaluateInFrame !== 'function') return given;
    try {
      if (!this._coreReadsStyleSheetTexts()) return given;
      const hrefs = await this._evaluateInFrame(frame, findUnreadableStyleSheets, []);
      const have = Array.isArray(given.styleSheetTexts) ? given.styleSheetTexts : [];
      const wanted = (Array.isArray(hrefs) ? hrefs : []).filter((h) => !have.some((s) => s && s.href === h));
      if (!wanted.length) return given;
      const fetched = await fetchStyleSheetTexts(wanted, { fetch: this._styleSheetFetch || globalThis.fetch });
      return fetched.length ? { ...given, styleSheetTexts: have.concat(fetched) } : given;
    } catch {
      return given;
    }
  }

  /**
   * Whether the @surea11y/core installed beside the binding reads
   * engineOptions.styleSheetTexts: it has preloadStyleSheets(), which came
   * with it (1.14.0). False where core can't be loaded (a browser bundle).
   */
  _coreReadsStyleSheetTexts() {
    try {
      if (typeof module !== 'object' || !module || typeof module.require !== 'function') return false;
      return typeof module.require(CORE).preloadStyleSheets === 'function';
    } catch {
      return false;
    }
  }

  /**
   * Whether this binding can take screenshots: it implements the two
   * driver methods the shared step uses, or replaces the step itself.
   */
  _takesScreenshots() {
    if (this._captureScreenshots !== A11yCoreBuilderBase.prototype._captureScreenshots) return true;
    return typeof this._evaluateInFrame === 'function' && typeof this._captureBox === 'function';
  }

  /**
   * Opt in to also scanning every sub-frame reachable from the top page.
   * Default off; when off, analyze() returns the same single native result
   * object it always has. When on, analyze() instead returns
   * { topFrame, frames } -- how frames are actually reached and traversed is
   * entirely driver-specific, implemented by the subclass's own analyze().
   */
  frames(enabled = true) {
    this._scanFrames = !!enabled;
    return this;
  }

  /**
   * Also scan the page under each condition, after scanning it as it is:
   * `{ colorScheme: 'light' | 'dark' }`, `{ width: px }` (the viewport's
   * width in CSS pixels, its height kept), or both, such as
   * `[{ colorScheme: 'dark' }, { width: 320 }]`. analyze() then returns one
   * result merged from the scans (mergeConditionResults()): a rule's
   * outcome is its worst across them, and each occurrence lists the
   * `conditions` it appeared under ('default' for the page as it was).
   * The viewport and color scheme are put back afterwards. Not combined
   * with .frames(true) yet. An empty list or null turns it off.
   * @param {Array<{ colorScheme?: 'light'|'dark', width?: number }>|null} list
   */
  conditions(list) {
    this._conditions = readConditions(list, 'A11yCoreBuilder.conditions()');
    return this;
  }

  /**
   * Runs `scan()` as the page is, then once under each condition, and
   * merges the results; for a subclass's Promise-based analyze() to call
   * when .conditions() was given. The driver work is the subclass's:
   * `save()` resolves to whatever `restore(state)` needs to put the page
   * back, and is called before the first scan, so it can refuse a
   * condition the driver can't set; `apply(condition)` sets one condition's
   * color scheme and width. `restore` runs even when a scan throws. Throws when
   * .frames(true) is also set.
   * @param {() => Promise<object>} scan
   * @param {{ save: () => Promise<*>, apply: (condition: object) => Promise<void>, restore: (state: *) => Promise<void> }} driver
   */
  async _scanUnderConditions(scan, { save, apply, restore }) {
    this._assertConditionsAlone();
    // Saved first, so a condition the driver can't set is refused before
    // any scan.
    const state = await save();
    const runs = [{ condition: 'default', result: await scan() }];
    try {
      for (const condition of this._conditions) {
        await apply(condition);
        this._screenshotCondition = conditionLabel(condition);
        try {
          runs.push({ condition: this._screenshotCondition, result: await scan() });
        } finally {
          this._screenshotCondition = null;
        }
      }
    } finally {
      await restore(state);
    }
    return mergeConditionResults(runs);
  }

  /** Throws when .conditions() and .frames(true) are both set, which can't be combined yet. */
  _assertConditionsAlone() {
    if (this._conditions && this._scanFrames) {
      throw new Error('A11yCoreBuilder: .conditions() and .frames(true) can\'t be combined yet; scan the frames and the conditions in two analyze() calls.');
    }
  }

  /**
   * Where analyze() sends the scan gaps it reports (see `_warnScanGaps()`):
   * `fn(gap, result)` is called once per gap, with the gap as getScanGaps()
   * gives it and the result of the frame it came from, instead of printing
   * it with console.warn; and once each for the `internals-hook` and
   * `listener-hook` notes, as getScanNotes() gives them (tell them apart by
   * `kind`). `() => {}`
   * silences them; `null` goes back to console.warn. Calling it again
   * replaces the logger.
   * @param {((gap: object, result: object) => void)|null} fn
   */
  logger(fn) {
    if (fn !== null && typeof fn !== 'function') {
      throw new TypeError(`A11yCoreBuilder.logger(): expected a function, or null for console.warn, not ${fn === undefined ? 'undefined' : JSON.stringify(fn) || String(fn)}.`);
    }
    this._logger = fn;
    return this;
  }

  /**
   * Says what one scanned frame's result left out (getScanGaps()), so a scan
   * that skipped something doesn't pass unnoticed as clean where nothing
   * asserts on it. A subclass's analyze() calls it once per scanned frame.
   * Each gap goes to the logger() function when one is set; otherwise it is
   * printed with console.warn as `<source> (<frame url>): <message>`. The
   * `internals-hook` and `listener-hook` notes of getScanNotes() go the same
   * way, each once per builder: elements one of the hooks would have let the
   * engine judge. Other notes are left to formatFailures().
   * Anything that isn't a scan result is passed over: the caller sees it as
   * it is.
   * @param {object} result one frame's scan result
   * @param {string} source what the line names as its sender, the binding's package name
   */
  _warnScanGaps(result, source) {
    let gaps;
    try {
      gaps = getScanGaps(result);
    } catch (e) {
      return;
    }
    // The internals-hook and listener-hook notes, each said once per builder
    // (one builder per scan, so once per scan, whichever frame asked first):
    // they are advice about how the page was loaded, the same for every frame.
    const said = this._saidHookNotes;
    const notes = getScanNotes(result).filter(
      (n) => (n.kind === 'internals-hook' || n.kind === 'listener-hook') && !said.has(n.kind)
    );
    for (const n of notes) said.add(n.kind);
    for (const entry of gaps.concat(notes)) {
      if (this._logger) {
        this._logger(entry, result);
      } else {
        const where = result.url ? ` (${result.url})` : '';
        console.warn(`${source}${where}: ${entry.message}`);
      }
    }
  }

  /**
   * Builds the three arguments every binding passes into surea11y's
   * `runa11yCoreInPage(pageUrl, contextSelector, engineOptions, runOnly)` --
   * everything derivable from this builder's own accumulated state, with no
   * driver-specific work at all. A subclass's `analyze()` calls this first,
   * then does its own driver-specific injection/frame-traversal with the
   * result.
   * @returns {{ contextSelector: (string|string[]|null), engineOptions: object, runOnly: (object|null) }}
   */
  _buildEngineArgs() {
    const contextSelector = this._includeSelectors.length
      ? (this._includeSelectors.length === 1 ? this._includeSelectors[0] : this._includeSelectors)
      : null;

    const engineOptions = { ...this._engineOptions };
    // Screenshots find each element by its selector: without selectors
    // there would be nothing to picture, so say so before the scan runs
    // rather than skip every occurrence.
    if (this._screenshots && engineOptions.output && typeof engineOptions.output === 'object' && isOff(engineOptions.output.includeSelector)) {
      const err = new TypeError('A11yCoreBuilder.screenshots(): screenshots find each element by its selector, so they need output.includeSelector; turn one of them off.');
      err.code = 'INVALID_ENGINE_OPTIONS';
      throw err;
    }
    if (this._wcagLevel) engineOptions.wcagLevel = this._wcagLevel;
    if (this._customRules.length) {
      // Concatenated with, not replaced by, any customRules already present
      // via a raw .options({ customRules }) call, so the two ways of
      // registering a custom rule compose rather than one silently
      // clobbering the other.
      const existing = Array.isArray(this._engineOptions.customRules) ? this._engineOptions.customRules : [];
      engineOptions.customRules = existing.concat(this._customRules);
    }
    if (this._packs.length) {
      // The page has the packs registered by _packScript(); the scan names
      // them, after any names already given through a raw .options({ packs }).
      const existing = Array.isArray(this._engineOptions.packs) ? this._engineOptions.packs : [];
      engineOptions.packs = existing.concat(this._packs.map((p) => `${p.name}@${p.version}`));
    }
    if (this._excludeSelectors.length) {
      engineOptions.excludeSelectors = this._excludeSelectors;
    }
    const ruleScopedIds = Object.keys(this._ruleScopedExcludeSelectors);
    if (ruleScopedIds.length) {
      // Merged with, not clobbering, any per-rule config already present via
      // a raw .options({ rules }) call -- same compose-not-clobber pattern as
      // customRules above.
      const existingRules = this._engineOptions.rules || {};
      const rules = { ...existingRules };
      for (const ruleId of ruleScopedIds) {
        const existingRuleConfig = existingRules[ruleId] || {};
        const existingExcludeSelectors = Array.isArray(existingRuleConfig.excludeSelectors) ? existingRuleConfig.excludeSelectors : [];
        rules[ruleId] = {
          ...existingRuleConfig,
          excludeSelectors: existingExcludeSelectors.concat(this._ruleScopedExcludeSelectors[ruleId])
        };
      }
      engineOptions.rules = rules;
    }

    // includeMode alone selects nothing, so it doesn't make a runOnly: the
    // engine wouldn't let it take precedence over engineOptions either.
    const hasRunOnly = this._includeRuleIds.length || this._excludeRuleIds.length || this._tags.length || this._excludeTags.length || this._wcag || this._bestPractices;
    const runOnly = hasRunOnly
      ? {
        includeRuleIds: this._includeRuleIds.length ? this._includeRuleIds : undefined,
        excludeRuleIds: this._excludeRuleIds.length ? this._excludeRuleIds : undefined,
        tags: this._tags.length ? this._tags : undefined,
        excludeTags: this._excludeTags.length ? this._excludeTags : undefined,
        ...(this._wcag ? { wcag: { ...this._wcag } } : {}),
        ...(this._bestPractices ? { bestPractices: true } : {}),
        ...(this._includeMode ? { includeMode: this._includeMode } : {})
      }
      : null;

    return { contextSelector, engineOptions, runOnly };
  }

  /**
   * The rules a scan with this builder will run, as core's
   * getChecksForRunOnly() lists them (catalog entries with `ruleId`, `title`,
   * `tags`...), worked out from the same selection and options analyze()
   * sends, packs and custom rules included. Synchronous, in Node, with no
   * page: for recording what a scan covers, or checking a selection picked
   * what was meant before running it. Needs @surea11y/core 1.12.0 or later.
   * @returns {object[]}
   */
  plannedChecks() {
    const { runOnly, engineOptions } = this._plannedArgs();
    return loadCoreCatalog('plannedChecks').getChecksForRunOnly(runOnly, engineOptions);
  }

  /**
   * The criteria a scan with this builder will report in `rulesResults`
   * (WCAG criteria and standards' requirements), as core's
   * getRulesForRunOnly() lists them (catalog entries with `id`, `title`,
   * `criteria`...), following wcagLevel() and the WCAG version as the scan
   * does. Same conditions as plannedChecks().
   * @returns {object[]}
   */
  plannedCriteria() {
    const { runOnly, engineOptions } = this._plannedArgs();
    return loadCoreCatalog('plannedCriteria').getRulesForRunOnly(runOnly, engineOptions);
  }

  /**
   * _buildEngineArgs() as the catalog functions take it: in Node, packs are
   * passed as the pack objects themselves, where the page gets their names.
   */
  _plannedArgs() {
    const { runOnly, engineOptions } = this._buildEngineArgs();
    if (this._packs.length) {
      const existing = Array.isArray(this._engineOptions.packs) ? this._engineOptions.packs : [];
      engineOptions.packs = existing.concat(this._packs);
    }
    return { runOnly, engineOptions };
  }

  /**
   * The last step of each frame's result, for a subclass's analyze() to call
   * once per scanned frame: gives each undecided finding the steps a person
   * takes to answer it (`howToCheck`, see `_addHowToCheck()`), then filters
   * checksResults per .reportOnly(), if set. Returns a copy where it changes
   * anything.
   */
  _applyReportOnly(result) {
    const withSteps = this._addHowToCheck(result);
    if (!this._reportOutcomes || !withSteps || !Array.isArray(withSteps.checksResults)) return withSteps;
    return {
      ...withSteps,
      checksResults: withSteps.checksResults.filter((r) => this._reportOutcomes.includes(r.outcome))
    };
  }

  /**
   * A copy of one frame's result whose undecided findings carry
   * `howToCheck`, the steps a person takes to answer them, from
   * @surea11y/core's addHowToCheck() (1.14.0 and later), in the scan's
   * locale. The in-page engine leaves them out, so a result from
   * runa11yCoreInPage comes without them. The packs given to withPacks() add
   * their rules' own steps. Never throws: with an older core, in a browser
   * bundle (a Cypress spec, which reads them with core's
   * @surea11y/core/how-to-check instead), or for anything but a result, it
   * returns `result` as given.
   */
  _addHowToCheck(result) {
    if (!result || typeof result !== 'object' || !Array.isArray(result.checksResults)) return result;
    const addHowToCheck = this._coreAddHowToCheck();
    if (!addHowToCheck) return result;
    try {
      return addHowToCheck(result, this._packs.length ? { packs: this._packs } : undefined);
    } catch {
      return result;
    }
  }

  /**
   * The @surea11y/core installed beside the binding's addHowToCheck(), which
   * came with 1.14.0, or null: an older core, or none that can be loaded (a
   * browser bundle).
   */
  _coreAddHowToCheck() {
    try {
      if (typeof module !== 'object' || !module || typeof module.require !== 'function') return null;
      const { addHowToCheck } = module.require(CORE);
      return typeof addHowToCheck === 'function' ? addHowToCheck : null;
    } catch {
      return null;
    }
  }

  /**
   * The screenshots step, for a subclass's analyze() to call once per
   * scanned frame, after the scan and before reportOnly(); it does nothing
   * unless `.screenshots()` was called:
   *
   *   const result = rethrowEngineError(await frame.evaluate(inPageScan, ...));
   *   await this._captureScreenshots(result, frame, framePath);
   *   return this._applyReportOnly(result);
   *
   * It plans the pictures, runs its in-page step in the frames, works out
   * where the element is on the top-level page, names and writes the files
   * and puts `screenshot` on the occurrences. It reaches the driver through
   * two methods the subclass implements:
   *
   * - `_evaluateInFrame(frame, fn, args)`: run the self-contained `fn` in
   *   `frame` as `fn(...args)` and resolve to what it returns (a plain,
   *   JSON-safe value; `fn` may return a Promise). `frame` is whatever the
   *   subclass passes here or in `framePath`, given back unchanged: a
   *   Playwright or Puppeteer Frame, or what a driver that switches frames
   *   needs to switch there. `args` are JSON values, except that the second
   *   one may be an element handle the subclass put in `framePath`.
   * - `_captureBox(box, view)`: resolve to a PNG (a Buffer, or a base64
   *   string) of `box`, whole CSS pixels relative to the top-level page's
   *   viewport. `view` is `{ devicePixelRatio, viewport, scroll }` of the
   *   top-level page (`viewport` its innerWidth/innerHeight, `scroll` its
   *   scrollX/scrollY), for a driver whose clip is relative to the document
   *   or that only takes the whole viewport, which cropViewportScreenshot()
   *   then cuts.
   *
   * `framePath` leads from the top-level page to `frame`, outermost first:
   * one `{ frame, iframe }` per `<iframe>` on the way, `frame` the frame
   * holding that `<iframe>` (as `_evaluateInFrame()` takes it) and `iframe`
   * the `<iframe>` in it: a CSS selector, `{ selector, index }` (the index
   * among the elements `selector` matches, by default `'iframe, frame'`),
   * or an element handle in that frame; null when the binding could not
   * find it, which fails that frame's pictures. `[]` (the default) for the
   * top-level page, which must be the first frame a scan passes, since a
   * scan's `max` and file names count from it.
   *
   * Never throws for a picture it can't take: the occurrences get
   * `{ skipped }`, and the result is returned as the scan gave it, with the
   * field added. A subclass whose analyze() isn't Promise-based (Cypress)
   * overrides this step instead, with planScreenshots() and
   * screenshotInPage.
   * @param {object} result one frame's scan result, changed in place
   * @param {*} frame the scanned frame, as `_evaluateInFrame()` takes it
   * @param {Array<{ frame: *, iframe: (string|{ selector?: string, index: number }|object) }>} [framePath]
   * @returns {Promise<object>} `result`
   */
  async _captureScreenshots(result, frame, framePath = []) {
    if (!this._screenshots) return result;
    return captureScreenshots(this, result, frame, framePath);
  }

  /**
   * Must be implemented by every subclass -- entirely driver-specific, so
   * there's no shared behavior to provide here. Deliberately not `async`:
   * most bindings return a Promise from their own override, but Cypress's
   * returns a Cypress chainable instead -- an
   * `async` stub here would misleadingly imply every binding's analyze() is
   * Promise-shaped.
   */
  analyze() {
    throw new Error('A11yCoreBuilderBase.analyze() must be implemented by a subclass.');
  }
}

module.exports = { A11yCoreBuilderBase, VALID_OUTCOMES };
