'use strict';

const { A11yCoreBuilderBase, VALID_OUTCOMES } = require('./A11yCoreBuilderBase');
const { canReconstructAsFunction, toReconstructableSource } = require('./customRuleReconstruction');
const { ENGINE_ERROR_CODES, ENGINE_ERROR_KEY, EngineError, createInPageScan, rethrowEngineError } = require('./engineErrors');
const { formatFailures } = require('./formatFailures');
const { getScanGaps } = require('./scanGaps');
const { getScanNotes } = require('./scanNotes');
const { queryOccurrenceElement, formatOccurrenceLocation } = require('./shadowDom');
const {
  SCREENSHOT_DEFAULTS,
  SCREENSHOT_SKIPS,
  planScreenshots,
  screenshotFileName,
  screenshotFrameKey,
  screenshotToken,
  prepareElementScreenshot,
  releaseElementScreenshot
} = require('./screenshots');
const { screenshotInPage } = require('./screenshotsInPage');
const { cropViewportScreenshot } = require('./png');
const { findUnreadableStyleSheets, fetchStyleSheetTexts } = require('./styleSheets');

module.exports = {
  A11yCoreBuilderBase,
  findUnreadableStyleSheets,
  fetchStyleSheetTexts,
  VALID_OUTCOMES,
  canReconstructAsFunction,
  toReconstructableSource,
  ENGINE_ERROR_CODES,
  ENGINE_ERROR_KEY,
  EngineError,
  createInPageScan,
  rethrowEngineError,
  formatFailures,
  getScanGaps,
  getScanNotes,
  queryOccurrenceElement,
  formatOccurrenceLocation,
  SCREENSHOT_DEFAULTS,
  SCREENSHOT_SKIPS,
  planScreenshots,
  screenshotFileName,
  screenshotFrameKey,
  screenshotToken,
  prepareElementScreenshot,
  releaseElementScreenshot,
  screenshotInPage,
  cropViewportScreenshot
};
