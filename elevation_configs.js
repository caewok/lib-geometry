/* globals
canvas,
FormDataExtended,
foundry,
game,
Hooks,
libWrapper,
renderTemplate
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";

// Optional placeable configurations for elevation.
// Walls handled by Wall Height.
// AmbientLight
// Tile
// MeasuredTemplate

const TEMPLATE = `modules/${MODULE_ID}/scripts/geometry/templates/placeable-elevation-config.html`;

/** @type {enum: boolean} */
const CONFIG_REGISTERED = {
  Tile: false,
  AmbientLight: false,
  AmbientSound: false,
  MeasuredTemplate: false
};

/** @type {enum: string} */
const LEGEND_LABELS = {
  Tile: [],
  AmbientLight: [],
  AmbientSound: [],
  MeasuredTemplate: []
};

/** @type {enum: function} */
const HOOK_FUNCTIONS = {
  Tile: renderTileConfigHook,
  AmbientLight: renderAmbientLightConfigHook,
  AmbientSound: renderAmbientSoundConfigHook,
  MeasuredTemplate: renderMeasuredTemplateConfigHook
};

/**
 * Cause the requested placeable type to add an elevation configuration to its config app.
 * If already requested, additional modules will be added to the legend to track who did what.
 * @param {string} type           One of Tile|AmbientLight|AmbientSound|MeasuredTemplate
 * @param {string} [moduleLabel]  Localized module label. Defaults to the localized module key.
 */
export function registerElevationConfig(type, moduleLabel) {
  // Add this module label to the legend.
  moduleLabel ??= game.i18n.localize(MODULE_ID);
  LEGEND_LABELS[type].push(`${moduleLabel}`);
  if ( CONFIG_REGISTERED[type] ) return;

  // Add hook for rendering the config and if necessary, wrap additional methods.
  Hooks.on(`render${type}Config`, HOOK_FUNCTIONS[type]);
  switch ( type ) {
    case "Tile": libWrapper.register(MODULE_ID, "TileConfig.prototype._onChangeInput", _onChangeInputTileConfig, libWrapper.WRAPPER); break;
    case "AmbientSound": libWrapper.register(MODULE_ID, "AmbientSoundConfig.defaultOptions", defaultOptionsAmbientSoundConfig, libWrapper.WRAPPER); break;
  }
}

/**
 * Inject html to add controls to the ambient light configuration to allow user to set elevation.
 */
async function renderAmbientLightConfigHook(app, html, data) {
  const findString = "div[data-tab='basic']:last";
  addConfigData(data, "AmbientLight");
  await injectConfiguration(app, html, data, TEMPLATE, findString);
}

/**
 * Inject html to add controls to the ambient sound configuration to allow user to set elevation.
 */
async function renderAmbientSoundConfigHook(app, html, data) {
  const findString = ".form-group:last";
  addConfigData(data, "AmbientSound");
  await injectConfiguration(app, html, data, TEMPLATE, findString);
}
/**
 * Inject html to add controls to the tile configuration to allow user to set elevation.
 */
async function renderTileConfigHook(app, html, data) {
  const findString = "div[data-tab='basic']:last";
  addConfigData(data, "Tile");
  data.gridUnits = canvas.scene.grid.units || game.i18n.localize("GridUnits");
  await injectConfiguration(app, html, data, TEMPLATE, findString);
}

async function renderMeasuredTemplateConfigHook(app, html, data) {
  const findString = "div[data-tab='basic']:last";
  addConfigData(data, "MeasuredTemplate");
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
