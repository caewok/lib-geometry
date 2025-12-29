/* globals
CONST,
game,
Hooks
*/
"use strict";

export const GEOMETRY_CONFIG = {};
GEOMETRY_CONFIG.CenteredPolygons = {};
GEOMETRY_CONFIG.Graph = {};
GEOMETRY_CONFIG.RegularPolygons = {};
GEOMETRY_CONFIG.threeD = {};
GEOMETRY_CONFIG.placeableGeometry = {};

// Elevated Vision flags used
export const MODULE_ID = "libGeometry";

// The Wall Height keys

// Track certain modules that complement features of this module.
export const OTHER_MODULES = {
  EV: {
    ID: "elevatedvision",
    FLAGS: {
      TOKEN_HEIGHT: "tokenHeight",
      ELEVATION: "elevation",
    }
  },

  WH: {
    ID: "wall-height",
    FLAGS: {
      TOKEN_HEIGHT: "tokenHeight",
      ELEVATION: "wall-height",
    }
  },

  LEVELS: {
    ID: "levels",
  },

  LEVELSAUTOCOVER: {
    ID: "levelsautocover",
    FLAGS: {
      DUCKING: "ducking"
    }
  },

  TERRAIN_MAPPER: {
    ID: "terrainmapper",
  }
};

// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function() {
  for ( const [key, obj] of Object.entries(OTHER_MODULES) ) {
    if ( !game.modules.get(obj.KEY)?.active ) delete OTHER_MODULES[key];
  }
});