'use strict';

const { toReconstructableSource } = require('./customRuleReconstruction');
const { getScanGaps } = require('./scanGaps');
const { getScanNotes } = require('./scanNotes');

// See surea11y's docs/OUTPUT_SCHEMA.md -- the only valid `outcome` values a
// checksResults entry can carry.
const VALID_OUTCOMES = ['pass', 'fail', 'cantTell', 'notApplicable'];

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

// What surea11y's runOnly.wcag accepts.
const WCAG_VERSIONS = ['2.0', '2.1', '2.2'];
const WCAG_LEVELS = ['A', 'AA', 'AAA'];

// Core reads a WCAG level in any case; the builder sends it in capitals.
function normalizeLevel(level) {
  return typeof level === 'string' ? level.trim().toUpperCase() : level;
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
 * `withBestPractices()`/`includeMode()`/`wcagLevel()`/`logger()` are the
 * exception: each call replaces the previous value rather than merging with
 * it.
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
    this._saidInternalsNote = false;
    this._engineOptions = {};
    this._reportOutcomes = null;
    this._elementRef = false;
    this._customRules = [];
    this._packs = [];
    this._packScriptSource = null;
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
   * Where analyze() sends the scan gaps it reports (see `_warnScanGaps()`):
   * `fn(gap, result)` is called once per gap, with the gap as getScanGaps()
   * gives it and the result of the frame it came from, instead of printing
   * it with console.warn; and once for the `internals-hook` note, as
   * getScanNotes() gives it (tell them apart by `kind`). `() => {}`
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
   * `internals-hook` note of getScanNotes() goes the same way, once per
   * builder: custom elements the internals hook would have let the engine
   * read. Other notes are left to formatFailures().
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
    // The internals-hook note, said once per builder (one builder per scan,
    // so once per scan, whichever frame asked first): it is advice about how
    // the page was loaded, the same for every frame.
    const notes = this._saidInternalsNote ? [] : getScanNotes(result).filter((n) => n.kind === 'internals-hook');
    if (notes.length) this._saidInternalsNote = true;
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

  /** Filters a single native result object's checksResults per .reportOnly(), if set. */
  _applyReportOnly(result) {
    if (!this._reportOutcomes || !result || !Array.isArray(result.checksResults)) return result;
    return {
      ...result,
      checksResults: result.checksResults.filter((r) => this._reportOutcomes.includes(r.outcome))
    };
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
