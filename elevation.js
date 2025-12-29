/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_CONFIG } from "./const.js";
import { gridUnitsToPixels } from "./util.js";
import { OTHER_MODULES } from "./const.js";




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
PATCHES.Token = { ELEVATION: {} };
PATCHES.Wall = { ELEVATION: {} };
PATCHES.Region = { ELEVATION: {} };

GEOMETRY_CONFIG.proneStatusId = "prone";
GEOMETRY_CONFIG.proneMultiplier = 0.33;
GEOMETRY_CONFIG.visionHeightMultiplier = 1;

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

// Set VisionSource (but not MovementSource) to the top elevation of the token
function visionSourceElevationE() {
  return this.object?.topE ?? this.object?.elevationE ?? this.document.elevation ?? 0;
}

// NOTE: PlaceableObject Elevation
function placeableObjectElevationE() { return this.document.elevation; }

// NOTE: Wall Elevation
function wallTopE() {
  // Previously used foundry.utils.getProperty but it is slow.
  const WH = OTHER_MODULES.WH;
  return (WH ? this.document.flags[WH.ID]?.top : undefined)
    ?? Number.POSITIVE_INFINITY;
}

function wallBottomE() {
  const WH = OTHER_MODULES.WH;
  return (WH ? this.document.flags[WH.ID]?.bottom : undefined)
    ?? Number.NEGATIVE_INFINITY;
}

// ----- NOTE: Region elevation ----- //
function regionTopE() {
  return this.document.elevation.top ?? Number.POSITIVE_INFINITY;
}

function regionBottomE() {
  return this.document.elevation.bottom ?? Number.NEGATIVE_INFINITY;
}

// ----- NOTE: Token elevation ----- //

/**
 * Calculated vertical height of a token.
 * Accounts for prone multiplier.
 * @type {number}  Returns the height, at least 1 pixel high.
 */
function getTokenVerticalHeight() {
  const isProne = this.isProne;
  const heightMult = isProne ? Math.clamp(CONFIG.GeometryLib.proneMultiplier, 0, 1) : 1;
  return (getTokenHeight(this) * heightMult) || 1; // Force at least 1 pixel high.
}

/**
 * Calculated vision height.
 */
function getTokenVisionHeight() {
  return Math.max(1, this.verticalHeight * Math.clamp(CONFIG.GeometryLib.visionHeightMultiplier, 0, 1));
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
    || (OTHER_MODULES.LEVELSAUTOCOVER
    && this.document.flags?.[OTHER_MODULES.LEVELSAUTOCOVER.ID]?.[OTHER_MODULES.LEVELSAUTOCOVER.FLAGS.DUCKING]));
}

function getTokenHeight(token) {
  // Use || to ignore 0 height values.
  // Previously used foundry.utils.getProperty or getFlag but it is slow.
  const WH = OTHER_MODULES.WH;
  return (WH ? token.document.flags[WH.ID]?.[WH.FLAGS.TOKEN_HEIGHT] : 0)
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

// NOTE: Helper functions to convert to Z pixels.

/**
 * Helper to convert to Z value for a top elevation.
 */
function zTop() { return gridUnitsToPixels(this.topE); }

/**
 * Helper to convert to Z value for a bottom elevation.
 */
function zBottom() { return gridUnitsToPixels(this.bottomE); }

/**
 * Helper to convert to Z value for an elevationE.
 */
function zElevation() { return gridUnitsToPixels(this.elevationE); }


// ---- NOTE: PointSource ----- //
PATCHES.PointSource.ELEVATION.GETTERS = {
  elevationE: pointSourceElevationE,
  elevationZ: zElevation
};

// ---- NOTE: VisionSource ----- //
PATCHES.VisionSource.ELEVATION.GETTERS = { elevationE: visionSourceElevationE };

// ---- NOTE: PlaceableObject ----- //
PATCHES.PlaceableObject.ELEVATION.GETTERS = {
  elevationE: placeableObjectElevationE,
  elevationZ: zElevation
};

// ---- NOTE: Token ----- //
PATCHES.Token.ELEVATION.GETTERS = {
  bottomE: placeableObjectElevationE, // Alias
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

// ---- NOTE: Wall ----- //
PATCHES.Wall.ELEVATION.GETTERS = {
  topE: wallTopE,
  topZ: zTop,
  bottomE: wallBottomE,
  bottomZ: zBottom
};

// ----- NOTE: Region ----- //
PATCHES.Region.ELEVATION.GETTERS = {
  topE: regionTopE,
  topZ: zTop,
  bottomE: regionBottomE,
  bottomZ: zBottom
};
