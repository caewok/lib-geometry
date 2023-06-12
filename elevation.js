/* globals
canvas,
CONFIG,
flattenObject,
foundry,
game,
getProperty,
Hooks,
PointSource,
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

  // PlaceableObjects (Drawing, AmbientLight, AmbientSound, MeasuredTemplate, Note, Tile, Wall, Token)
  // Don't handle Wall or Token here
  const basicPlaceables = {
    Drawing: CONFIG.Drawing.objectClass,
    Note: CONFIG.Note.objectClass,
    MeasuredTemmplate: CONFIG.MeasuredTemplate.objectClass,
    AmbientLight: CONFIG.AmbientLight.objectClass,
    AmbientSound: CONFIG.AmbientSound.objectClass,
    Tile: CONFIG.Tile.objectClass
  };

  for ( const [placeableName, placeableClass] of Object.entries(basicPlaceables) ) {
    addClassGetter(placeableClass.prototype, "elevationE", placeableObjectElevationE, setPlaceableObjectElevationE);
    addClassGetter(placeableClass.prototype, "elevationZ", zElevation, setZElevation);
    Hooks.on(`update${placeableName}`, updatePlaceableHookElevationE);
  }

  // Tile
  // Sync tile.document.elevation with tile.document.flags.elevatedvision.elevation
  Hooks.on("preUpdateTile", preUpdateTileHook);

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

  // Sync token.tokenHeight between EV and Wall Height
  Hooks.on("preUpdateToken", preUpdateTokenHook);
  Hooks.on("updateToken", updateTokenHook);

  // Wall
  addClassGetter(Wall.prototype, "topE", wallTopE, setWallTopE);
  addClassGetter(Wall.prototype, "topZ", zTop, setZTop);
  addClassGetter(Wall.prototype, "bottomE", wallBottomE, setWallBottomE);
  addClassGetter(Wall.prototype, "bottomZ", zBottom, setZBottom);

  // Sync wall bottom and top elevations between EV and Wall Height
  Hooks.on("preUpdateWall", preUpdateWallHook);
  Hooks.on("updateWall", updateWallHook);
}

/* Elevation handling
Ignore data.elevation in PointSources (for now)
Sync document.elevation in Tile
Use document.elevation in Token

PointSource (LightSource, VisionSource, SoundSource, MovementSource)
  - elevationE -->
    --> object.elevationE
        --> object.document.flags.elevatedvision.elevation
    --> data.elevation
    --> 0

Placeable (AmbientLight, AmbientSound, Drawing, Note, MeasuredTemplate, Wall, Token, Tile)
  - elevationE
    --> document.flags.elevatedvision.elevation
    --> 0


Tile
  - elevationE
    --> document.flags.elevatedvision.elevation
    --> Sync to document.elevation

Wall
  - topE
    --> document.flags.elevatedvision.elevation.top
  - bottomE
    --> document.flags.elevatedvision.elevation.bottom

Token
  - topE
    --> Calculated via document.flags.elevatedvision.tokenHeight
  - bottomE
    --> document.elevation
  - elevationE
    --> document.elevation
  - tokenHeight
    --> document.flags.elevatedvision.tokenHeight
*/


// NOTE: PointSource Elevation
// Abstract base class used by LightSource, VisionSource, SoundSource, MovementSource.
// Can be attached to a Token.
// Has data.elevation already but ignoring this for now as it may have unintended consequences.
// Changes to token elevation appear to update the source elevation automatically.
function pointSourceElevationE() {
  return this._elevationE ?? (this._elevationE = this.object?.elevationE ?? this.data.elevation ?? 0);
}

function setPointSourceElevationE(value) {
  this._elevationE = value;
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
 * Monitor placeable document updates for updated elevation and update the cached data property accordingly.
 */
function updatePlaceableHookElevationE(placeableD, data, _options, _userId) {
  const flatData = flattenObject(data);
  const changed = new Set(Object.keys(flatData));
  const evChangeFlag = `flags.${MODULE_KEYS.EV.FLAG_PLACEABLE_ELEVATION}`;
  if ( changed.has(evChangeFlag) && placeableD.object ) {
    const e = flatData[evChangeFlag];
    placeableD.object._elevationE = e;
  }
}

/**
 * Monitor tile document updates for updated elevation and sync the document with the flag.
 * Note Tile Elevation has document.elevation already but does not save it (in v11).
 */
function preUpdateTileHook(placeableD, data, _options, _userId) {
  const flatData = flattenObject(data);
  const changes = new Set(Object.keys(flatData));
  const evChangeFlag = `flags.${MODULE_KEYS.EV.FLAG_PLACEABLE_ELEVATION}`;
  const updates = {};
  if ( changes.has(evChangeFlag) ) {
    const e = flatData[evChangeFlag];
    updates.elevation = e;
  } else if ( changes.has("elevation") ) {
    const e = data.elevation;
    updates[evChangeFlag] = e;
  }
  foundry.utils.mergeObject(data, updates);
}

/**
 * Monitor token updates for updated losHeight and update the cached data property accordingly.
 * Sync Wall Height and Elevated Vision flags. Prefer EV.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function preUpdateTokenHook(tokenD, data, _options, _userId) {
  const flatData = flattenObject(data);
  const changes = new Set(Object.keys(flatData));
  const evChangeFlag = MODULE_KEYS.EV.FLAG_TOKEN_HEIGHT;
  const whChangeFlag = MODULE_KEYS.WH.FLAG_TOKEN_HEIGHT;
  const updates = {};
  if ( changes.has(evChangeFlag) ) {
    const e = flatData[evChangeFlag];
    updates[whChangeFlag] = e;
  } else if ( changes.has(whChangeFlag) ) {
    const e = flatData[whChangeFlag];
    updates[evChangeFlag] = e;
  }
  foundry.utils.mergeObject(data, updates);
}

function updateTokenHook(tokenD, data, _options, _userId) {
  const flatData = flattenObject(data);
  const changed = new Set(Object.keys(flatData));
  const evChangeFlag = MODULE_KEYS.EV.FLAG_TOKEN_HEIGHT;
  if ( changed.has(evChangeFlag) ) {
    const tokenHeight = flatData[evChangeFlag];
    tokenD.object._tokenHeight = tokenHeight;
  }

  if ( changed.has("elevation") ) {
    const e = data.elevation;
    if ( tokenD.object.light ) tokenD.object.light._elevationZ = e;
    if ( tokenD.object.vision ) tokenD.object.vision._elevationZ = e;
  }
}

/**
 * Monitor wall updates for updated top and bottom elevation and update the cached data property.
 * Sync Wall Height and Elevated Vision flags. Prefer EV
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function preUpdateWallHook(wallD, data, _options, _userId) {
  const flatData = flattenObject(data);
  const changes = new Set(Object.keys(flatData));
  const evChangeTopFlag = MODULE_KEYS.EV.FLAG_WALL_TOP;
  const evChangeBottomFlag = MODULE_KEYS.EV.FLAG_WALL_BOTTOM;
  const whChangeTopFlag = MODULE_KEYS.WH.FLAG_WALL_TOP;
  const whChangeBottomFlag = MODULE_KEYS.WH.FLAG_WALL_BOTTOM;
  const updates = {};
  if ( changes.has(evChangeTopFlag) ) {
    const e = flatData[evChangeTopFlag];
    updates[whChangeTopFlag] = e;
  } else if ( changes.has(whChangeTopFlag) ) {
    const e = flatData[whChangeTopFlag];
    updates[evChangeTopFlag] = e;
  }

  if ( changes.has(evChangeBottomFlag) ) {
    const e = flatData[evChangeBottomFlag];
    updates[whChangeBottomFlag] = e;
  } else if ( changes.has(whChangeBottomFlag) ) {
    const e = flatData[whChangeBottomFlag];
    updates[evChangeBottomFlag] = e;
  }

  foundry.utils.mergeObject(data, updates);
}


function updateWallHook(wallD, data, _options, _userId) {
  const flatData = flattenObject(data);
  const changed = new Set(Object.keys(flatData));
  const evChangeTopFlag = MODULE_KEYS.EV.FLAG_WALL_TOP;
  const evChangeBottomFlag = MODULE_KEYS.EV.FLAG_WALL_BOTTOM;

  if ( changed.has(evChangeTopFlag) ) {
    const wallTop = flatData[evChangeTopFlag];
    wallD.object._topE = wallTop;

  }

  if ( changed.has(evChangeBottomFlag) ) {
    const wallBottom = flatData[evChangeBottomFlag];
    wallD.object._bottomE = wallBottom;
  }
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
