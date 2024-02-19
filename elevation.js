/* globals
canvas,
CONFIG,
flattenObject,
foundry,
game,
getProperty
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { gridUnitsToPixels, pixelsToGridUnits } from "./util.js";
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

export const PATCHES = {};
PATCHES.PointSource = { ELEVATION: {} };
PATCHES.VisionSource = { ELEVATION: {} };
PATCHES.PlaceableObject = { ELEVATION: {} };
PATCHES.Tile = { ELEVATION: {} };
PATCHES.Token = { ELEVATION: {} };
PATCHES.Wall = { ELEVATION: {} };

CONFIG.GeometryLib ??= {};
CONFIG.GeometryLib.proneStatusId = "prone";
CONFIG.GeometryLib.proneMultiplier = 0.33;
CONFIG.GeometryLib.visionHeightMultiplier = 1;

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
 * Calculated vertical height of a token.
 * Accounts for prone multiplier.
 * @type {number}  Returns the height, at least 1 pixel high.
 */
function getTokenVerticalHeight() {
  const isProne = this.isProne;
  const heightMult = isProne ? Math.clamped(CONFIG.GeometryLib.proneMultiplier, 0, 1) : 1;
  return (getTokenHeight(this) * heightMult) || 1; // Force at least 1 pixel high.
}

/**
 * Calculated vision height.
 */
function getTokenVisionHeight() {
  return Math.max(1, this.verticalHeight * Math.clamped(CONFIG.GeometryLib.visionHeightMultiplier, 0, 1));
}

function getTokenVisionE() { return this.bottomE + this.visionHeight; }

function getTokenVisionZ() { return gridUnitsToPixels(this.visionE); }

/**
 * Top elevation of a token. Accounts for prone status.
 * @returns {number} In grid units.
 */
function tokenTopE() {
  return this.bottomE + this.verticalHeight;
}

/** @type {boolean} */
function getIsProne() {
  const proneStatusId = CONFIG.GeometryLib.proneStatusId;
  return Boolean((proneStatusId !== "" && this.actor && this.actor.statuses?.has(proneStatusId))
    || (MODULE_KEYS.LEVELSAUTOCOVER.ACTIVE
    && this.document.flags?.[MODULE_KEYS.LEVELSAUTOCOVER.ID]?.[MODULE_KEYS.LEVELSAUTOCOVER]?.DUCKING));
}

function getTokenHeight(token) {
  // Use || to ignore 0 height values.
  return getProperty(token.document, MODULE_KEYS.EV.FLAG_TOKEN_HEIGHT)
    || getProperty(token.document, MODULE_KEYS.WH.FLAG_TOKEN_HEIGHT)
    || calculateTokenHeightFromTokenShape(token);
}

/**
 * Calculate token LOS height.
 * Comparable to Wall Height method.
 * Does not consider "ducking" here—that is done in tokenVerticalHeight, tokenTopElevation.
 */
function calculateTokenHeightFromTokenShape(token) {
  const { width, height, texture } = token.document;
  return canvas.scene.dimensions.distance
    * Math.max(width, height)
    * (Math.abs(texture.scaleX) + Math.abs(texture.scaleY))
    * 0.5;
}

async function setTokenVerticalHeight(value) {
  if ( !Number.isNumeric(value) || value < 0 ) {
    console.err("token vertical height must be 0 or greater.");
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
  if ( !MODULE_KEYS.EV.ACTIVE ) return;
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


// ---- NOTE: PointSource ----- //
PATCHES.PointSource.ELEVATION.GETTERS = {
  elevationE: pointSourceElevationE,
  elevationZ: zElevation
};

PATCHES.PointSource.ELEVATION.METHODS = {
  setElevationE: setPointSourceElevationE,
  setElevationZ: setZElevation
};

// ---- NOTE: VisionSource ----- //
PATCHES.VisionSource.ELEVATION.GETTERS = { elevationE: visionSourceElevationE };
PATCHES.VisionSource.ELEVATION.METHODS = { setElevationE: setVisionSourceElevationE };

// ---- NOTE: PlaceableObject ----- //
PATCHES.PlaceableObject.ELEVATION.GETTERS = {
  elevationE: placeableObjectElevationE,
  elevationZ: zElevation
};

PATCHES.PlaceableObject.ELEVATION.METHODS = {
  setElevationE: setPlaceableObjectElevationE,
  setElevationZ: setZElevation
};

// ---- NOTE: Tile ----- //
PATCHES.Tile.ELEVATION.HOOKS = {
  preUpdateTile: preUpdateTileHook,
  updateTile: updateTileHook,
  drawTile: drawTileHook
};

// ---- NOTE: Token ----- //
PATCHES.Token.ELEVATION.GETTERS = {
  elevationE: tokenElevationE,
  elevationZ: zElevation,
  bottomE: tokenElevationE, // Alias
  bottomZ: zBottom, // Alias
  topE: tokenTopE,
  topZ: zTop,
  verticalHeight: getTokenVerticalHeight,

  // Prone or "ducking"
  isProne: getIsProne,

  // Token vision Height
  visionE: getTokenVisionE,
  visionZ: getTokenVisionZ,
  visionHeight: getTokenVisionHeight
};

PATCHES.Token.ELEVATION.METHODS = {
  setElevationE: setTokenElevationE,
  setElevationZ: setZBottom,
  setBottomE: setTokenElevationE, // Alias
  setBottomZ: setZBottom, // Alias
  setVerticalHeight: setTokenVerticalHeight // Async
};

PATCHES.Token.ELEVATION.HOOKS = { preUpdateToken: preUpdateTokenHook };

// ---- NOTE: Wall ----- //
PATCHES.Wall.ELEVATION.GETTERS = {
  topE: wallTopE,
  topZ: zTop,
  bottomE: wallBottomE,
  bottomZ: zBottom
};

PATCHES.Wall.ELEVATION.METHODS = {
  setTopE: setWallTopE,
  setTopZ: setZTop,
  setBottomE: setWallBottomE,
  setBottomZ: setZBottom
};

PATCHES.Wall.ELEVATION.HOOKS = { preUpdateWall: preUpdateWallHook };
