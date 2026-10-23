/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_CONFIG } from "./const.js";
import { gridUnitsToPixels, pixelsToGridUnits, clamp } from "./util.js";
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
PATCHES.BaseEffectSource = { ELEVATION: {} };
PATCHES.PointVisionSource = { ELEVATION: {} };
PATCHES.PlaceableObject = { ELEVATION: {} };
PATCHES.Token = { ELEVATION: {} };
PATCHES.Wall = { ELEVATION: {} };
PATCHES.Region = { ELEVATION: {} };
PATCHES.TokenDocument = { ELEVATION: {} };
PATCHES.WallDocument = { ELEVATION: {} };
PATCHES.TileDocument = { ELEVATION: {} };
PATCHES.RegionDocument = { ELEVATION: {} };
PATCHES.LevelDocument = { ELEVATION: {} };

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



// NOTE: Wall Elevation
function wallTopZ() {
  // Previously used foundry.utils.getProperty but it is slow.
  const WH = OTHER_MODULES.WALL_HEIGHT;
  const elev =  (WH ? this.document.flags[WH.ID]?.top : undefined)
    ?? Number.POSITIVE_INFINITY;
  return gridUnitsToPixels(elev);
}

function wallBottomZ() {
  const WH = OTHER_MODULES.WALL_HEIGHT;
  const elev = (WH ? this.document.flags[WH.ID]?.bottom : undefined)
    ?? Number.NEGATIVE_INFINITY;
  return gridUnitsToPixels(elev);
}

// ----- NOTE: Token elevation ----- //

/**
 * Calculated vertical height of a token.
 * Accounts for prone multiplier.
 * @type {number}  Returns the height, at least 1 pixel high.
 */
function getTokenVerticalHeightZ() {
  const isProne = this.isProne;
  const heightMult = isProne ? clamp(CONFIG.GeometryLib.CONFIG.proneMultiplier, 0, 1) : 1;
  return gridUnitsToPixels((getTokenHeight(this) * heightMult)) || 1; // Force at least 1 pixel high.
}

/**
 * Calculated vision height.
 */
function getTokenVisionHeightZ() {
  return Math.max(1, this.verticalHeightZ * clamp(CONFIG.GeometryLib.CONFIG.visionHeightMultiplier, 0, 1));
}

function getTokenVisionZ() { return this.bottomZ + this.visionHeightZ; }

/**
 * Top elevation of a token. Accounts for prone status.
 * @returns {number} In grid units.
 */
function tokenTopZ() { return this.bottomZ + this.verticalHeightZ; }

/** @type {boolean} */
function getIsProne() {
  const proneStatusId = CONFIG.GeometryLib.CONFIG.proneStatusId;
  return Boolean((proneStatusId !== "" && this.actor && this.actor.statuses?.has(proneStatusId))
    || (OTHER_MODULES.LEVELS_AUTOCOVER
    && this.flags?.[OTHER_MODULES.LEVELS_AUTOCOVER.ID]?.[OTHER_MODULES.LEVELS_AUTOCOVER.FLAGS.DUCKING]));
}

function getTokenHeight(tokenD) {
  // Use || to ignore 0 height values.
  // Previously used foundry.utils.getProperty or getFlag but it is slow.
  const WH = OTHER_MODULES.WALL_HEIGHT;
  return (WH ? tokenD.flags[WH.ID]?.[WH.FLAGS.TOKEN_HEIGHT] : 0)
    || calculateTokenHeightFromTokenShape(tokenD);
}

/**
 * Calculate token LOS height.
 * Comparable to Wall Height method.
 * Does not consider "ducking" here—that is done in tokenVerticalHeight, tokenTopElevation.
 */
function calculateTokenHeightFromTokenShape(tokenD) {
  const { width, height, texture } = tokenD;
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
function zElevation() { return gridUnitsToPixels(this.elevation); }


// Document patches.
PATCHES.TokenDocument.ELEVATION.GETTERS = {
  topZ: tokenTopZ,
  bottomZ: zElevation,
  isProne: getIsProne,
  visionZ: getTokenVisionZ,
  visionHeightZ: getTokenVisionHeightZ,
  verticalHeightZ: getTokenVerticalHeightZ,
};

PATCHES.WallDocument.ELEVATION.GETTERS = {
  topZ: wallTopZ,
  bottomZ: wallBottomZ,
};

PATCHES.RegionDocument.ELEVATION.GETTERS = {
  topZ: function() { return gridUnitsToPixels(this.elevation.top); },
  bottomZ: function() { return gridUnitsToPixels(this.elevation.bottom); },
};

PATCHES.LevelDocument.ELEVATION.GETTERS = {
  topZ: function() { return gridUnitsToPixels(this.elevation.top); },
  bottomZ: function() { return gridUnitsToPixels(this.elevation.bottom); },
};

PATCHES.TileDocument.ELEVATION.GETTERS = {
  elevationZ: function() { return gridUnitsToPixels(this.elevation); },
};

// ---- NOTE: PointSource ----- //
PATCHES.BaseEffectSource.ELEVATION.GETTERS = {
  elevationE: function() { return this.data.elevation || 0; },
  elevationZ: function() { return gridUnitsToPixels(this.data.elevation || 0); }
};

// Set VisionSource (but not MovementSource) to the top elevation of the token
function visionSourceElevationE() {
  if ( this.object ) return this.object.topE ?? this.object.elevationE ?? (this.data.elevation || 0);
  else return this.data.elevation || 0;
}

// ---- NOTE: VisionSource ----- //
PATCHES.PointVisionSource.ELEVATION.GETTERS = {
  elevationE: visionSourceElevationE,
  elevationZ: function() { return gridUnitsToPixels(this.elevationE); },
};



// Deprecated placeable patches.





// ---- NOTE: PlaceableObject ----- //
PATCHES.PlaceableObject.ELEVATION.GETTERS = {
  elevationE: function() { return this.document.elevation || 0; },
  elevationZ: function() { return gridUnitsToPixels(this.document.elevation || 0); },
};

// ---- NOTE: Token ----- //
PATCHES.Token.ELEVATION.GETTERS = {
  bottomE: function() { return this.document.elevation || 0; },
  bottomZ: function() { return this.document.bottomZ; },
  topE: function() { return pixelsToGridUnits(this.document.topZ); },
  topZ: function() { return this.document.topZ; },
  verticalHeight: function() { return pixelsToGridUnits(this.document.verticalHeightZ); },

  // Prone or "ducking"
  isProne: function() { return this.document.isProne; },

  // Token vision Height
  visionE: function() { return pixelsToGridUnits(this.document.visionZ); },
  visionZ: function() { return this.document.visionZ; },
  visionHeight: function() { return pixelsToGridUnits(this.document.visionHeightZ); },
};

// ---- NOTE: Wall ----- //
PATCHES.Wall.ELEVATION.GETTERS = {
  topE: function() { return pixelsToGridUnits(this.document.topZ); },
  topZ: function() { return this.document.topZ; },
  bottomE: function() { return pixelsToGridUnits(this.document.bottomZ); },
  bottomZ: function() { return this.document.bottomZ; },
};

// ----- NOTE: Region ----- //
PATCHES.Region.ELEVATION.GETTERS = {
  topE: function() { return this.document.elevation.top; },
  topZ: function() { return gridUnitsToPixels(this.document.elevation.top); },
  bottomE: function() { return this.document.elevation.bottom; },
  bottomZ: function() { return gridUnitsToPixels(this.document.elevation.bottom); },
};
