/* globals
game,
Hooks
*/
"use strict";

export const GEOMETRY_CONFIG = {};
GEOMETRY_CONFIG.CenteredPolygons = {};
GEOMETRY_CONFIG.Graph = {};
GEOMETRY_CONFIG.RegularPolygons = {};
GEOMETRY_CONFIG.threeD = {};

export const MODULE_KEYS = {
  EV: {
    ID: "elevatedvision",
    ACTIVE: false,
    FLAGS: {
      TOKEN_HEIGHT: "tokenHeight",
      ELEVATION: "elevation",
    }
  },

  WH: {
    ID: "wall-height",
    ACTIVE: false,
    FLAGS: {
      TOKEN_HEIGHT: "tokenHeight",
      ELEVATION: "wall-height"
    }
  },

  LEVELS: {
    ID: "levels",
    ACTIVE: false
  },

  LEVELSAUTOCOVER: {
    ID: "levelsautocover",
    ACTIVE: false,
    FLAGS: {
      DUCKING: "ducking"
    }
  },

  TERRAIN_MAPPER: {
    ID: "terrainmapper",
    ACTIVE: false,
  }
};

/**
 * Foundry's CONST.GRID_DIAGONALS plus Euclidean.
 * @enum {number}
 */
export const GRID_DIAGONALS = { EUCLIDEAN: -1, ...CONST.GRID_DIAGONALS };


// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function() {
  for ( const obj of Object.values(MODULE_KEYS) ) obj.ACTIVE = game.modules.get(obj.ID)?.active
});
