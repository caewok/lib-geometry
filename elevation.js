/* globals
canvas,
CONFIG,
flattenObject,
game,
getProperty,
Hooks,
isEmpty,
PointSource,
PlaceableObject,
Tile,
Token,
Wall
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { addClassGetter, gridUnitsToPixels, pixelsToGridUnits } from "./util.js";
import { MODULE_KEYS } from "./const.js";

/* Elevation properties for Placeable Objects
Generally:
- elevation and elevationZ properties
- topE/bottomE and topZ/bottomZ for walls, tokens

1. Walls.
- topE/bottomE and topZ/bottomZ: When Wall Height is active, non-infinite are possible.
Use Wall Height flag

2. Tokens.
- topE/bottomE. topE === bottomE unless Wall Height is active.
- bottomE === elevation

3. Other placeables
- elevationE and elevationZ
- If the light or vision is attached to a token, use token topZ, which would be losHeight
- Add elevation property to the config
- Don't patch the PlaceableObject elevation getter at the moment, as it might screw up
the display of the light object on the canvas. Eventually may want to patch this so
lights can display with varying canvas elevation.

4. Updating elevation
- Objects with data.elevation get updated there.
- Other objects use elevatedvision flags.

*/

export function registerElevationAdditions() {
  if ( CONFIG.GeometryLib.proneStatusId ) return; // Already registered.

  // Point Source (LightSource, VisionSource, SoundSource, MovementSource)
  addClassGetter(PointSource.prototype, "elevationE", pointSourceElevationE, setPointSourceElevationE);
  addClassGetter(PointSource.prototype, "elevationZ", zElevation, setZElevation);

  // PlaceableObject (Drawing, AmbientLight, AmbientSound, MeasuredTemplate, Note, Tile, Wall, Token)
  addClassGetter(PlaceableObject.prototype, "elevationE", placeableObjectElevationE, setPlaceableObjectElevationE);
  addClassGetter(PlaceableObject.prototype, "elevationZ", zElevation, setZElevation);

//   // Drawing
//   Hooks.on("updateDrawing", updatePlaceableHook);
//
//   // MeasuredTemplate
//   Hooks.on("updateMeasuredTemplate", updatePlaceableHook);
//
//   // Note
//   Hooks.on("updateNote", updatePlaceableHook);

  // Tile
  addClassGetter(Tile.prototype, "elevationE", tileElevationE, setTileElevationE);

  // Token
  addClassGetter(Token.prototype, "elevationE", tokenElevationE, setTokenElevationE);
  addClassGetter(Token.prototype, "bottomE", tokenBottomE, setTokenBottomE);
  addClassGetter(Token.prototype, "topE", tokenTopE);

  addClassGetter(Token.prototype, "elevationZ", zElevation, setZElevation);
  addClassGetter(Token.prototype, "bottomZ", zBottom, setZBottom);
  addClassGetter(Token.prototype, "topZ", zTop);

  // Handle Token "ducking"
  CONFIG.GeometryLib.proneStatusId = "prone";
  CONFIG.GeometryLib.proneMultiplier = 0.33;
  addClassGetter(Token.prototype, "losHeight", getTokenLOSHeight, setTokenLOSHeight);

  Hooks.on("updateToken", updateTokenHook);

  // Wall
  addClassGetter(Wall.prototype, "topE", wallTopE, setWallTopE);
  addClassGetter(Wall.prototype, "topZ", zTop, setZTop);
  addClassGetter(Wall.prototype, "bottomE", wallBottomE, setWallBottomE);
  addClassGetter(Wall.prototype, "bottomZ", zBottom, setZBottom);
  Hooks.on("updateWall", updateWallHook);

  // Register new render flag for elevation changes to placeables.
  CONFIG.AmbientLight.objectClass.RENDER_FLAGS.refreshElevation = {};
  CONFIG.AmbientLight.objectClass.RENDER_FLAGS.refreshField.propagate.push("refreshElevation");

  CONFIG.AmbientSound.objectClass.RENDER_FLAGS.refreshElevation = {};
  CONFIG.AmbientSound.objectClass.RENDER_FLAGS.refreshField.propagate.push("refreshElevation");

  Hooks.on("updatePlaceable", updatePlaceableHook);
  Hooks.on("updateAmbientLightDocument", updateAmbientLightDocumentHook);
  Hooks.on("updateAmbientSoundDocument", updateAmbientSoundDocumentHook);
  Hooks.on("refreshAmbientLight", refreshAmbientLightHook);
  Hooks.on("refreshAmbientSound", refreshAmbientSoundHook);
}

// NOTE: PointSource Elevation
// Abstract base class used by LightSource, VisionSource, SoundSource, MovementSource.
// Can be attached to a Token.
// Has data.elevation already
// Changes to token elevation appear to update the source elevation automatically.
function pointSourceElevationE() { return this.data.elevation ?? 0; }

function setPointSourceElevationE(value) {
  this.data.elevation = value;
  if ( typeof this.object?.elevationE !== "undefined" ) this.object.elevationE = value;
}

// NOTE: PlaceableObject Elevation
// Drawing, AmbientLight, AmbientSound, MeasuredTemplate, Note, Tile, Wall, Token
// Default is to use the object's cached elevation property.
// Wall, Tile, Token are broken out.
function placeableObjectElevationE() {
  return this._elevationE
    ?? (this._elevationE = this.document.getFlag(MODULE_KEYS.EV.ID, MODULE_KEYS.EV.ELEVATION) ?? 0);
}

function setPlaceableObjectElevationE(value) {
  this._elevationE = value;

  // Async method
  this.document.update({ flags: { [MODULE_KEYS.EV.ID]: { [MODULE_KEYS.EV.ELEVATION]: value } } });
}

// Note Tile Elevation
// Has document.elevation already but does not save it.
function tileElevationE() {
  if ( typeof this._elevationE !== "undefined" ) return this._elevationE;

  const e = getProperty(this.document.flags, MODULE_KEYS.EV.FLAG_PLACEABLE_ELEVATION) ?? this.document.elevation ?? 0;
  this._elevationE = e;
  return e;
}

function setTileElevationE(value) {
  this._elevationE = value;
  this.document.elevation = value;

  // Async method
  this.document.update({ flags: { [MODULE_KEYS.EV.ID]: { [MODULE_KEYS.EV.ELEVATION]: value } } });
}


// NOTE: Wall Elevation
function wallTopE() {
  if ( typeof this._topE !== "undefined" ) return this._topE;

  const flags = this.document.flags;
  this._topE = getProperty(flags, MODULE_KEYS.EV.FLAG_WALL_TOP)
    ?? getProperty(flags, MODULE_KEYS.WH.FLAG_WALL_TOP)
    ?? Number.POSITIVE_INFINITY;
  return this._topE;
}

function wallBottomE() {
  if ( typeof this._bottomE !== "undefined" ) return this._bottomE;
  const flags = this.document.flags;
  this._bottomE = getProperty(flags, MODULE_KEYS.EV.FLAG_WALL_BOTTOM)
    ?? getProperty(flags, MODULE_KEYS.WH.FLAG_WALL_BOTTOM)
    ?? Number.NEGATIVE_INFINITY;
  return this._bottomE;
}

function setWallTopE(value) {
  if ( !Number.isNumeric(value) ) {
    console.err("setWallTopE value must be a number.");
    return;
  }

  this._topE = value;

  // Async method
  const MOD = MODULE_KEYS.EV;
  this.document.update({ flags: { [MOD.ID]: { [MOD.ELEVATION]: { [MOD.WALL.TOP]: value } } } });
}

function setWallBottomE(value) {
  if ( !Number.isNumeric(value) ) {
    console.err("setWallTopE value must be a number.");
    return;
  }

  this._bottomE = value;

  // Async method
  const MOD = MODULE_KEYS.EV;
  this.document.update({ flags: { [MOD.ID]: { [MOD.ELEVATION]: { [MOD.WALL.BOTTOM]: value } } } });
}

// NOTE: Token Elevation
// Has document.elevation already
function tokenElevationE() { return this.document.elevation; }

function setTokenElevationE(value) {
  this.document.elevation = value;
  this.document.update({ elevation: value }); // Async
}

function tokenBottomE() { return this.document.elevation; }

function setTokenBottomE(value) { this.elevationE = value; }

// Don't allow setting of token.topE b/c it is ambiguous.

/**
 * Top elevation of a token.
 * @returns {number} In grid units.
 * Returns 1/3 the height if the token is prone.
 */
function tokenTopE() {
  const proneStatusId = CONFIG.GeometryLib.proneStatusId;
  const isProne = (proneStatusId !== "" && this.actor && this.actor.statuses.has(proneStatusId))
    || (game.modules.get(MODULE_KEYS.LEVELSAUTOCOVER.ID)?.active
    && this.document.flags?.[MODULE_KEYS.LEVELSAUTOCOVER.ID]?.[MODULE_KEYS.LEVELSAUTOCOVER].DUCKING);
  const heightMult = isProne ? CONFIG.GeometryLib.proneMultiplier : 1;
  return this.bottomE + (this.losHeight * heightMult);
}

/**
 * Calculate token LOS height.
 * Comparable to Wall Height method.
 * Does not consider "ducking" here—that is done in tokenTopElevation.
 */
function calculateTokenHeightFromTokenShape(token) {
  const { width, height, texture } = token.document;
  return canvas.scene.dimensions.distance * Math.max(width, height) *
    ((Math.abs(texture.scaleX) + Math.abs(texture.scaleY)) * 0.5);
}

function getTokenLOSHeight() {
  if ( typeof this._losHeight !== "undefined" ) return this._losHeight;

  const flags = this.document.flags;
  this._losHeight = getProperty(flags, MODULE_KEYS.EV.FLAG_TOKEN_HEIGHT)
    ?? getProperty(flags, MODULE_KEYS.WH.FLAG_TOKEN_HEIGHT)
    ?? calculateTokenHeightFromTokenShape(this);
  return this._losHeight;
}

function setTokenLOSHeight(value) {
  if ( !Number.isNumeric(value) || value < 0 ) {
    console.err("setTokenLOSHeight value must be 0 or greater.");
    return;
  }

  this._losHeight = value;

  // Async method
  this.document.update({ flags: { [MODULE_KEYS.EV.ID]: { [MODULE_KEYS.EV.TOKEN_HEIGHT]: value } } });
}

// NOTE: Hooks

/**
 * Monitor placeable object updates for updated elevation and update the cached data property accordingly.
 */
function updatePlaceableHook(placeableD, data, _options, _userId) {
  const flatData = flattenObject(data);
  const changed = new Set(Object.keys(flatData));
  const evChangeFlag = `flags.${MODULE_KEYS.EV.FLAG_PLACEABLE_ELEVATION}`;
  if ( changed.has(evChangeFlag) ) {
    const e = flatData[evChangeFlag];
    placeableD.object._elevationE = e;
  }
}

/**
 * Hook when the elevation flag is changed in the AmbientLightDocument.
 * Used below to update the underlying source elevation.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateAmbientLightDocumentHook(doc, data, _options, _userId) {
  const changeFlag = `flags.${MODULE_KEYS.EV.FLAG_PLACEABLE_ELEVATION}`;
  const flatData = flattenObject(data);
  const changed = new Set(Object.keys(flatData));
  if ( !changed.has(changeFlag) ) return;

  doc.object.renderFlags.set({
    refreshElevation: true
  });
}

/**
 * Hook when the elevation flag is changed in the AmbientSoundDocument.
 * Used below to update the underlying source elevation.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateAmbientSoundDocumentHook(doc, data, _options, _userId) {
  const changeFlag = `flags.${MODULE_KEYS.EV.FLAG_PLACEABLE_ELEVATION}`;
  const flatData = flattenObject(data);
  const changed = new Set(Object.keys(flatData));
  if ( !changed.has(changeFlag) ) return;

  doc.object.renderFlags.set({
    refreshElevation: true
  });
}

/**
 * Hook ambient light refresh to address the refreshElevation renderFlag.
 * Update the source elevation.
 * See AmbientLight.prototype._applyRenderFlags.
 * @param {PlaceableObject} object    The object instance being refreshed
 * @param {RenderFlags} flags
 */
function refreshAmbientLightHook(light, flags) {
  if ( flags.refreshElevation ) light.source.data.elevation = light.document.getFlag(
    MODULE_KEYS.EV.ID,
    MODULE_KEYS.EV.ELEVATION) ?? 0;
}

/**
 * Hook ambient sound refresh to address the refreshElevation renderFlag.
 * Update the source elevation.
 * See AmbientSound.prototype._applyRenderFlags.
 * @param {PlaceableObject} object    The object instance being refreshed
 * @param {RenderFlags} flags
 */
function refreshAmbientSoundHook(sound, flags) {
  if ( flags.refreshElevation ) sound.source.data.elevation = sound.document.getFlag(
    MODULE_KEYS.EV.ID,
    MODULE_KEYS.EV.ELEVATION) ?? 0;
}


/**
 * Monitor token updates for updated losHeight and update the cached data property accordingly.
 * Sync Wall Height and Elevated Vision flags. Prefer EV.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateTokenHook(tokenD, data, options, _userId) {
  const flatData = flattenObject(data);
  const changed = new Set(Object.keys(flatData));
  const evChangeFlag = MODULE_KEYS.EV.FLAG_TOKEN_HEIGHT;
  const whChangeFlag = MODULE_KEYS.WH.FLAG_TOKEN_HEIGHT;
  const updates = {};
  let evUpdated = false;
  if ( changed.has(evChangeFlag) ) {
    const tokenHeight = flatData[evChangeFlag];
    tokenD.object._tokenHeight = tokenHeight;
    updates[whChangeFlag] = tokenHeight;
    evUpdated ||= true; // Avoid circular updating by passing the evUpdated option.

  } else if ( changed.has(whChangeFlag) && !options.evUpdated ){
    const tokenHeight = flatData[whChangeFlag];
    updates[evChangeFlag] = tokenHeight;
  }
  if ( !isEmpty(updates) ) tokenD.update(updates, { evUpdated });
}

/**
 * Monitor wall updates for updated top and bottom elevation and update the cached data property.
 * Sync Wall Height and Elevated Vision flags. Prefer EV
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateWallHook(wallD, data, options, _userId) {
  const flatData = flattenObject(data);
  const changed = new Set(Object.keys(flatData));
  const evChangeTopFlag = MODULE_KEYS.EV.FLAG_WALL_TOP;
  const evChangeBottomFlag = MODULE_KEYS.EV.FLAG_WALL_BOTTOM;
  const whChangeTopFlag = MODULE_KEYS.WH.FLAG_WALL_TOP;
  const whChangeBottomFlag = MODULE_KEYS.WH.FLAG_WALL_BOTTOM;
  const updates = {};
  let evUpdated = false;

  if ( changed.has(evChangeTopFlag) ) {
    const wallTop = flatData[evChangeTopFlag];
    wallD.object._topE = wallTop;
    updates[whChangeTopFlag] = wallTop;
    evUpdated ||= true; // Avoid circular updating by passing the evUpdated option.
  } else if ( changed.has(whChangeTopFlag) && !options.evUpdated ) {
    const wallTop = flatData[whChangeTopFlag];
    updates[evChangeTopFlag] = wallTop;
  }

  if ( changed.has(evChangeBottomFlag) ) {
    const wallBottom = flatData[evChangeBottomFlag];
    wallD.object._bottomE = wallBottom;
    updates[whChangeBottomFlag] = wallBottom;
    evUpdated ||= true; // Avoid circular updating by passing the evUpdated option.
  } else if ( changed.has(whChangeBottomFlag) && !options.evUpdated ) {
    const wallBottom = flatData[whChangeBottomFlag];
    updates[evChangeBottomFlag] = wallBottom;
  }

  if ( !isEmpty(updates) ) wallD.update(updates, { evUpdated });
}

// NOTE: Helper functions to convert to Z pixels.

/**
 * Helper to convert to Z value for a top elevation.
 */
function zTop() { return gridUnitsToPixels(this.topE); }

function setZTop(value) { this.topE = pixelsToGridUnits(value); }

/**
 * Helper to convert to Z value for a bottom elevation.
 */
function zBottom() { return gridUnitsToPixels(this.bottomE); }

function setZBottom(value) { this.bottomE = pixelsToGridUnits(value); }

/**
 * Helper to convert to Z value for an elevationE.
 */
function zElevation() { return gridUnitsToPixels(this.elevationE); }

function setZElevation(value) { this.elevationE = pixelsToGridUnits(value); }
