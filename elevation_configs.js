/* globals
canvas,
CONFIG,
FormDataExtended,
foundry,
game,
libWrapper,
renderTemplate
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { registerGeometry } from "./registration.js";
import { HookPatch, LibWrapperPatch } from "../Patcher.js";

// Optional placeable configurations for elevation.
// Walls handled by Wall Height.
// AmbientLight
// Tile
// MeasuredTemplate

const group = "ELEVATION_CONFIG";
const perf_mode = "FAST";
const PATCHES = {};

const TEMPLATE = `modules/${MODULE_ID}/scripts/geometry/templates/placeable-elevation-config.html`;

/** @type {enum: string} */
const LEGEND_LABELS = {
  TileConfig: [],
  AmbientLightConfig: [],
  AmbientSoundConfig: [],
  MeasuredTemplateConfig: []
};

/**
 * Cause the requested placeable type to add an elevation configuration to its config app.
 * If already requested, additional modules will be added to the legend to track who did what.
 * @param {string} type           One of TileConfig|AmbientLightConfig|AmbientSoundConfig|MeasuredTemplateConfig
 * @param {string} [moduleLabel]  Localized module label. Defaults to the localized module key.
 */
export function registerElevationConfig(type, moduleLabel) {
  if ( !CONFIG.GeometryLib?.PATCHER ) registerGeometry();

  const PATCHER = CONFIG.GeometryLib.PATCHER;
  PATCHER.LEGEND_LABELS ??= LEGEND_LABELS;

  // Add this module label to the legend.
  moduleLabel ??= game.i18n.localize(MODULE_ID);
  PATCHER.LEGEND_LABELS[type].push(`${moduleLabel}`);
  for ( const patch of PATCHES[type] ) PATCHER.addPatch(patch);
  PATCHER.registerGroup(group);
}

/**
 * Inject html to add controls to the ambient light configuration to allow user to set elevation.
 */
async function renderAmbientLightConfig(app, html, data) {
  const findString = "div[data-tab='basic']:last";
  addConfigData(data, "AmbientLightConfig");
  await injectConfiguration(app, html, data, TEMPLATE, findString);
}

/**
 * Inject html to add controls to the ambient sound configuration to allow user to set elevation.
 */
async function renderAmbientSoundConfig(app, html, data) {
  const findString = ".form-group:last";
  addConfigData(data, "AmbientSoundConfig");
  await injectConfiguration(app, html, data, TEMPLATE, findString);
}
/**
 * Inject html to add controls to the tile configuration to allow user to set elevation.
 */
async function renderTileConfig(app, html, data) {
  const findString = "div[data-tab='basic']:last";
  addConfigData(data, "TileConfig");
  data.gridUnits = canvas.scene.grid.units || game.i18n.localize("GridUnits");
  await injectConfiguration(app, html, data, TEMPLATE, findString);
}

async function renderMeasuredTemplateConfig(app, html, data) {
  const findString = "div[data-tab='basic']:last";
  addConfigData(data, "MeasuredTemplateConfig");
  await injectConfiguration(app, html, data, TEMPLATE, findString);
}

/**
 * Helper to inject configuration html into the application config.
 */
async function injectConfiguration(app, html, data, template, findString) {
  const myHTML = await renderTemplate(template, data);
  const form = html.find(findString);
  form.append(myHTML);
  app.setPosition(app.position);
}

function addConfigData(data, type) {
  data.geometrylib = {
    legend: LEGEND_LABELS[type].join(", ")
  };
}

/**
 * Wrapper for AmbientSoundConfig.defaultOptions
 * Make the sound config window resize height automatically, to accommodate
 * the elevation config.
 * @param {Function} wrapper
 * @return {Object} See AmbientSoundConfig.defaultOptions.
 */
function defaultOptionsAmbientSoundConfig(wrapper) {
  const options = wrapper();
  return foundry.utils.mergeObject(options, {
    height: "auto"
  });
}

/**
 * Wrapper for TileConfig.prototype._onChangeInput.
 * Link Levels bottom elevation with EV elevation of the tile
 * If one changes, the other should change.
 */
async function _onChangeInputTileConfig(wrapper, event) {
  await wrapper(event);

  // If EV elevation or levels bottom elevation updated, update the other.
  // Update preview object
  const fdo = new FormDataExtended(this.form).object;
  if ( Object.hasOwn(fdo, "flags.elevatedvision.elevation") ) {
    fdo["flags.levels.rangeBottom"] = fdo["flags.elevatedvision.elevation"];
  } else if ( Object.hasOwn(fdo, "flags.levels.rangeBottom") ) {
    fdo["flags.elevatedvision.elevation"] = fdo["flags.levels.rangeBottom"];
  } else return;

  // To allow a preview without glitches
  fdo.width = Math.abs(fdo.width);
  fdo.height = Math.abs(fdo.height);

  // Handle tint exception
  let tint = fdo["texture.tint"];
  if ( !foundry.data.validators.isColorString(tint) ) fdo["texture.tint"] = null;

  // Update preview object
  foundry.utils.mergeObject(this.document, foundry.utils.expandObject(fdo));
  this.document.object.refresh();
}

const cfg = { group, perf_mode };

PATCHES.TileConfig = [
  HookPatch.create("renderTileConfig", renderTileConfig, cfg),
  LibWrapperPatch.create("TileConfig.prototype._onChangeInput", _onChangeInputTileConfig, cfg)
];

PATCHES.AmbientLightConfig = [
  HookPatch.create("renderAmbientLightConfig", renderAmbientLightConfig, cfg)
];

PATCHES.AmbientSoundConfig = [
  HookPatch.create("renderAmbientSoundConfig", renderAmbientSoundConfig, cfg),
  LibWrapperPatch.create("AmbientSoundConfig.defaultOptions", defaultOptionsAmbientSoundConfig, cfg)
];

PATCHES.MeasuredTemplateConfig = [
  HookPatch.create("renderMeasuredTemplateConfig", renderMeasuredTemplateConfig, cfg)
];
