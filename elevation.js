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
VisionSource,
Wall
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { addClassGetter, addClassMethod, gridUnitsToPixels, pixelsToGridUnits } from "./util.js";
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

function addHook(name, fn) {
  const hooks = CONFIG.GeometryLib.hooks ??= new Map();
  const id = Hooks.on(name, fn);
  hooks.set(id, name);
  return id;
}

export function registerElevationAdditions() {
  CONFIG.GeometryLib.registered ??= new Set();
  if ( CONFIG.GeometryLib.registered.has("Elevation") ) return;

  // Define elevation getters.
  // Because elevation is saved to flags, use an async method instead of a setter.
  // Point Source (LightSource, VisionSource, SoundSource, MovementSource)
  addClassGetter(PointSource.prototype, "elevationE", pointSourceElevationE);
  addClassGetter(PointSource.prototype, "elevationZ", zElevation);
  addClassMethod(PointSource.prototype, "setElevationE", setPointSourceElevationE);
  addClassMethod(PointSource.prototype, "setElevationZ", setZElevation);

  // VisionSource
  addClassGetter(VisionSource.prototype, "elevationE", visionSourceElevationE);
  addClassMethod(VisionSource.prototype, "setElevationE", setVisionSourceElevationE);

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

  for ( const placeableClass of Object.values(basicPlaceables) ) {
    addClassGetter(placeableClass.prototype, "elevationE", placeableObjectElevationE);
    addClassGetter(placeableClass.prototype, "elevationZ", zElevation);
    addClassMethod(placeableClass.prototype, "setElevationE", setPlaceableObjectElevationE);
    addClassMethod(placeableClass.prototype, "setElevationZ", setZElevation);
  }

  // Tile
  // Sync tile.document.elevation with tile.document.flags.elevatedvision.elevation
  addHook("preUpdateTile", preUpdateTileHook);
  addHook("updateTile", updateTileHook);
  addHook("drawTile", drawTileHook);

  // Token
  addClassGetter(Token.prototype, "elevationE", tokenElevationE);
  addClassGetter(Token.prototype, "elevationZ", zElevation);
  addClassGetter(Token.prototype, "bottomE", tokenElevationE); // alias
  addClassGetter(Token.prototype, "bottomZ", zBottom); // alias
  addClassGetter(Token.prototype, "topE", tokenTopE);
  addClassGetter(Token.prototype, "topZ", zTop);

  // Don't set the topE, which is calculated.
  addClassMethod(Token.prototype, "setElevationE", setTokenElevationE);
  addClassMethod(Token.prototype, "setElevationZ", setZBottom);
  addClassMethod(Token.prototype, "setBottomE", setTokenElevationE); // alias
  addClassMethod(Token.prototype, "setBottomZ", setZBottom); // alias

  // Handle Token "ducking"
  CONFIG.GeometryLib.proneStatusId = "prone";
  CONFIG.GeometryLib.proneMultiplier = 0.33;
  addClassGetter(Token.prototype, "isProne", getIsProne);
  addClassGetter(Token.prototype, "tokenVisionHeight", getTokenLOSHeight);
  addClassMethod(Token.prototype, "setTokenVisionHeight", setTokenLOSHeight);

  // Sync token.tokenHeight between EV and Wall Height
  // Also clear the _tokenHeight cached property.
  addHook("preUpdateToken", preUpdateTokenHook);

  // Wall
  addClassGetter(Wall.prototype, "topE", wallTopE);
  addClassGetter(Wall.prototype, "topZ", zTop);
  addClassGetter(Wall.prototype, "bottomE", wallBottomE);
  addClassGetter(Wall.prototype, "bottomZ", zBottom);

  addClassMethod(Wall.prototype, "setTopE", setWallTopE);
  addClassMethod(Wall.prototype, "setTopZ", setZTop);
  addClassMethod(Wall.prototype, "setBottomE", setWallBottomE);
  addClassMethod(Wall.prototype, "setBottomZ", setZBottom);

  // Sync wall bottom and top elevations between EV and Wall Height
  addHook("preUpdateWall", preUpdateWallHook);

  CONFIG.GeometryLib.registered.add("Elevation");
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
  return this.object?.elevationE ?? this.document.elevation ?? Number.MAX_SAFE_INTEGER;
}

async function setPointSourceElevationE(value) {
  if ( !this.object ) return;
  return this.object.setElevationE(value);
}

// Set VisionSource (but not MovementSource) to the top elevation of the token
function visionSourceElevationE() {
  return this.object?.topE ?? this.object?.elevationE ?? this.document.elevation ?? 0;
}

async function setVisionSourceElevationE(_value) {
  console.warn("Cannot set elevationE for a vision source because it is calculated from token height.");
  return;
}

// NOTE: PlaceableObject Elevation
// Drawing, AmbientLight, AmbientSound, MeasuredTemplate, Note, Tile, Wall, Token
// Default is to use the object's cached elevation property.
// Wall, Tile, Token are broken out.
// TODO: Would be 2x faster by accessing the flag directly and not using getProperty.

function placeableObjectElevationE() {
  return getProperty(this.document, MODULE_KEYS.EV.FLAG_PLACEABLE_ELEVATION) ?? 0;
}

async function setPlaceableObjectElevationE(value) {
  return this.document.update({ [MODULE_KEYS.EV.FLAG_PLACEABLE_ELEVATION]: value });
}

// NOTE: Wall Elevation
function wallTopE() {
  return getProperty(this.document, MODULE_KEYS.EV.FLAG_WALL_TOP)
    ?? getProperty(this.document, MODULE_KEYS.WH.FLAG_WALL_TOP)
    ?? Number.POSITIVE_INFINITY;
}

function wallBottomE() {
  return getProperty(this.document, MODULE_KEYS.EV.FLAG_WALL_BOTTOM)
    ?? getProperty(this.document, MODULE_KEYS.WH.FLAG_WALL_BOTTOM)
    ?? Number.NEGATIVE_INFINITY;
}

async function setWallTopE(value) {
  if ( !Number.isNumeric(value) ) {
    console.err("setWallTopE value must be a number.");
    return;
  }
  return this.document.update({ [MODULE_KEYS.EV.FLAG_WALL_TOP]: value });
}

async function setWallBottomE(value) {
  if ( !Number.isNumeric(value) ) {
    console.err("setWallTopE value must be a number.");
    return;
  }
  return this.document.update({ [MODULE_KEYS.EV.FLAG_WALL_BOTTOM]: value });
}

// NOTE: Token Elevation
// Has document.elevation already
function tokenElevationE() { return this.document.elevation; }

async function setTokenElevationE(value) { return this.document.update({ elevation: value }); }

// Don't allow setting of token.topE b/c it is ambiguous.

/**
 * Top elevation of a token.
 * @returns {number} In grid units.
 * Returns 1/3 the height if the token is prone.
 */
function tokenTopE() {
  const isProne = this.isProne;
  const heightMult = isProne ? CONFIG.GeometryLib.proneMultiplier : 1;
  return this.bottomE + (this.tokenVisionHeight * heightMult);
}

/** @type {boolean} */
function getIsProne() {
  const proneStatusId = CONFIG.GeometryLib.proneStatusId;
  return Boolean((proneStatusId !== "" && this.actor && this.actor.statuses?.has(proneStatusId))
    || (game.modules.get(MODULE_KEYS.LEVELSAUTOCOVER.ID)?.active
    && this.document.flags?.[MODULE_KEYS.LEVELSAUTOCOVER.ID]?.[MODULE_KEYS.LEVELSAUTOCOVER]?.DUCKING));
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
  // Use || to ignore 0 height values.
  return getProperty(this.document, MODULE_KEYS.EV.FLAG_TOKEN_HEIGHT)
    || getProperty(this.document, MODULE_KEYS.WH.FLAG_TOKEN_HEIGHT)
    || calculateTokenHeightFromTokenShape(this);
}

async function setTokenLOSHeight(value) {
  if ( !Number.isNumeric(value) || value < 0 ) {
    console.err("tokenVisionHeight value must be 0 or greater.");
    return;
  }
  return this.document.update({ [MODULE_KEYS.EV.FLAG_TOKEN_HEIGHT]: value });
}

// NOTE: Hooks

/**
 * Monitor tile document updates for updated elevation and sync the document with the flag.
 * Note Tile Elevation has document.elevation already but does not save it (in v11).
 */
function preUpdateTileHook(_tileD, changes, _options, _userId) {
  const flatData = flattenObject(changes);
  const changeKeys = new Set(Object.keys(flatData));
  const evFlag = MODULE_KEYS.EV.FLAG_PLACEABLE_ELEVATION;
  const updates = {};
  if ( changeKeys.has(evFlag) ) updates.elevation = flatData[evFlag];
  else if ( changeKeys.has("elevation") ) updates[evFlag] = changes.elevation;
  foundry.utils.mergeObject(changes, updates);
}

function updateTileHook(tileD, changed, _options, _userId) {
  const flatData = flattenObject(changed);
  const changeKeys = new Set(Object.keys(flatData));
  const evFlag = MODULE_KEYS.EV.FLAG_PLACEABLE_ELEVATION;
  if ( changeKeys.has(evFlag) ) tileD.elevation = flatData[evFlag] ?? undefined; // Avoid setting null.
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
  const evFlag = MODULE_KEYS.EV.FLAG_TOKEN_HEIGHT;
  const whFlag = MODULE_KEYS.WH.FLAG_TOKEN_HEIGHT;
  const updates = {};
  if ( changes.has(evFlag) ) {
    const e = flatData[evFlag];
    updates[whFlag] = e;
  } else if ( changes.has(whFlag) ) {
    const e = flatData[whFlag];
    updates[evFlag] = e;
  }
  foundry.utils.mergeObject(data, updates);

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
  const evTopFlag = MODULE_KEYS.EV.FLAG_WALL_TOP;
  const evBottomFlag = MODULE_KEYS.EV.FLAG_WALL_BOTTOM;
  const whTopFlag = MODULE_KEYS.WH.FLAG_WALL_TOP;
  const whBottomFlag = MODULE_KEYS.WH.FLAG_WALL_BOTTOM;
  const updates = {};
  if ( changes.has(evTopFlag) ) {
    const e = flatData[evTopFlag];
    updates[whTopFlag] = e;
  } else if ( changes.has(whTopFlag) ) {
    const e = flatData[whTopFlag];
    updates[evTopFlag] = e;
  }

  if ( changes.has(evBottomFlag) ) {
    const e = flatData[evBottomFlag];
    updates[whBottomFlag] = e;
  } else if ( changes.has(whBottomFlag) ) {
    const e = flatData[whBottomFlag];
    updates[evBottomFlag] = e;
  }

  foundry.utils.mergeObject(data, updates);
}

/**
 * Monitor tiles drawn to canvas and sync elevation.
 */
function drawTileHook(tile) {
  if ( !game.modules.get("elevatedvision")?.active ) return;
  if ( tile.document.elevation !== tile.elevationE ) tile.document.elevation = tile.elevationE;
}


// NOTE: Helper functions to convert to Z pixels.

/**
 * Helper to convert to Z value for a top elevation.
 */
function zTop() { return gridUnitsToPixels(this.topE); }

async function setZTop(value) { return this.setTopE(pixelsToGridUnits(value)); }

/**
 * Helper to convert to Z value for a bottom elevation.
 */
function zBottom() { return gridUnitsToPixels(this.bottomE); }

async function setZBottom(value) { return this.setBottomE(pixelsToGridUnits(value)); }

/**
 * Helper to convert to Z value for an elevationE.
 */
function zElevation() { return gridUnitsToPixels(this.elevationE); }

async function setZElevation(value) { return this.setElevationE(pixelsToGridUnits(value)); }

