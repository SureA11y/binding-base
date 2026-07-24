'use strict';

const { toReconstructableSource } = require('./customRuleReconstruction');

// See a11y-core's docs/OUTPUT_SCHEMA.md -- the only valid `outcome` values a
// checksResults entry can carry.
const VALID_OUTCOMES = ['pass', 'fail', 'cantTell', 'notApplicable'];

/**
 * Shared, driver-agnostic scaffolding for every a11y-core binding's own
 * `A11yCoreBuilder` (Playwright/Puppeteer/Selenium/WebdriverIO/Cypress).
 * Not meant to be used directly -- each binding's own `A11yCoreBuilder`
 * extends this class and adds exactly the parts that are genuinely
 * driver-specific: the constructor's driver-handle validation, `analyze()`'s
 * actual injection mechanics, all frame-traversal logic, and
 * `_attachElementRefs()`. See each binding's own README.md/ROADMAP.md for the
 * user-facing API and driver-specific behavior -- this class's own doc
 * comments describe the shared mechanics only, not end-user usage.
 *
 * Every method here was, until this package existed, copy-pasted
 * byte-for-byte across all five binding projects. Extracted once five real
 * consumers existed (each sibling binding's own ROADMAP.md flagged this as
 * the right threshold, deliberately deferred until then).
 *
 * Mutability contract (identical in every binding that extends this):
 * `include()`/`exclude()`/`withRules()`/`disableRules()`/`withTags()`/
 * `disableTags()`/`options()`/`withCustomRules()` accumulate across calls,
 * with no reset between `analyze()` calls -- create one builder per scan.
 * `reportOnly()`/`frames()`/`elementRef()` are the exception: each call
 * replaces the previous value rather than merging with it.
 */
class A11yCoreBuilderBase {
  /**
   * @param {{ url?: string }} [opts] `url` overrides the URL a11y-core
   *   reports for the top-level scan's result; when omitted, a11y-core
   *   falls back to the page's own `document.location.href` itself.
   */
  constructor({ url } = {}) {
    this._url = url || null;
    this._scanFrames = false;
    this._includeSelectors = [];
    this._excludeSelectors = [];
    this._includeRuleIds = [];
    this._excludeRuleIds = [];
    this._tags = [];
    this._excludeTags = [];
    this._engineOptions = {};
    this._reportOutcomes = null;
    this._elementRef = false;
    this._customRules = [];
  }

  /**
   * Scope the scan to one region. Call multiple times to scan several,
   * possibly disjoint regions in one run (a11y-core's contextSelector
   * accepts an array of selectors for exactly this -- see a11y-core's
   * docs/ENGINE_OPTIONS.md).
   */
  include(selector) {
    if (selector) this._includeSelectors.push(selector);
    return this;
  }

  /** Skip elements matching this selector anywhere in the scanned scope. */
  exclude(selector) {
    if (selector) this._excludeSelectors.push(selector);
    return this;
  }

  /** Only run rules carrying at least one of these tags. */
  withTags(tags) {
    this._tags = this._tags.concat(Array.isArray(tags) ? tags : [tags]);
    return this;
  }

  /** Never run rules carrying any of these tags (applied after withTags). */
  disableTags(tags) {
    this._excludeTags = this._excludeTags.concat(Array.isArray(tags) ? tags : [tags]);
    return this;
  }

  /** Only run these specific rule IDs (accepts with or without the a11ycore- prefix). */
  withRules(ruleIds) {
    this._includeRuleIds = this._includeRuleIds.concat(Array.isArray(ruleIds) ? ruleIds : [ruleIds]);
    return this;
  }

  /** Never run these specific rule IDs (applied after withRules). */
  disableRules(ruleIds) {
    this._excludeRuleIds = this._excludeRuleIds.concat(Array.isArray(ruleIds) ? ruleIds : [ruleIds]);
    return this;
  }

  /** Merge arbitrary engineOptions (locale, contrast.mode, policyContract, ...) -- see a11y-core's docs/ENGINE_OPTIONS.md. */
  options(partialEngineOptions) {
    this._engineOptions = { ...this._engineOptions, ...(partialEngineOptions || {}) };
    return this;
  }

  /**
   * Register one or more custom rules for just this scan (a11y-core's
   * engineOptions.customRules escape hatch -- see a11y-core's
   * docs/ENGINE_OPTIONS.md). A
   * descriptor is { id, meta?, runInPage, applicability?, data? }, the same
   * shape as an internal a11y-core rule module's own export. Call multiple
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
   * that scan only (a11y-core's own semantics) -- nothing here persists past
   * this one analyze() call or mutates a11y-core's static rule catalog.
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
   * Per-rule normalization step for `withCustomRules()`. Default behavior
   * (correct for Playwright/Puppeteer/Selenium/WebdriverIO, i.e. every
   * binding whose driver crosses a real serialization boundary --
   * page.evaluate()/executeScript()/browser.execute() -- to reach the page):
   * converts a live `runInPage`/`applicability` function to a function-source
   * string via `toReconstructableSource()`, since that boundary cannot carry
   * a live Function reference (a11y-core reconstructs the string back into a
   * function with `new Function` on the page side). A string is passed
   * through unchanged.
   *
   * Override this in a binding that does NOT cross such a boundary (Cypress
   * is the one binding today where this applies -- its test code runs in the
   * same browser tab as the page, so a live cross-realm function reference
   * survives without stringification; see its own ROADMAP.md §2b/§2f) to
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
   * Binding-layer only -- a11y-core itself always computes every rule's
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
   * Builds the three arguments every binding passes into a11y-core's
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
    if (this._customRules.length) {
      // Concatenated with, not replaced by, any customRules already present
      // via a raw .options({ customRules }) call, so the two ways of
      // registering a custom rule compose rather than one silently
      // clobbering the other.
      const existing = Array.isArray(this._engineOptions.customRules) ? this._engineOptions.customRules : [];
      engineOptions.customRules = existing.concat(this._customRules);
    }
    if (this._excludeSelectors.length) {
      engineOptions.excludeSelectors = this._excludeSelectors;
    }

    const hasRunOnly = this._includeRuleIds.length || this._excludeRuleIds.length || this._tags.length || this._excludeTags.length;
    const runOnly = hasRunOnly
      ? {
        includeRuleIds: this._includeRuleIds.length ? this._includeRuleIds : undefined,
        excludeRuleIds: this._excludeRuleIds.length ? this._excludeRuleIds : undefined,
        tags: this._tags.length ? this._tags : undefined,
        excludeTags: this._excludeTags.length ? this._excludeTags : undefined
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
   * returns a Cypress chainable instead (see its own ROADMAP.md §2c) -- an
   * `async` stub here would misleadingly imply every binding's analyze() is
   * Promise-shaped.
   */
  analyze() {
    throw new Error('A11yCoreBuilderBase.analyze() must be implemented by a subclass.');
  }
}

module.exports = { A11yCoreBuilderBase, VALID_OUTCOMES };
