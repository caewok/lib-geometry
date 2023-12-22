/* globals
*/
"use strict";

export const MODULE_KEYS = {
  EV: {
    ID: "elevatedvision",
    TOKEN_HEIGHT: "tokenHeight",
    WALL: { TOP: "top", BOTTOM: "bottom" },
    ELEVATION: "elevation",
    ACTIVE: false
  },

  WH: {
    ID: "wall-height",
    TOKEN_HEIGHT: "tokenHeight",
    WALL: { TOP: "top", BOTTOM: "bottom" },
    ACTIVE: false
  },

  LEVELS: {
    ID: "levels",
    ACTIVE: false
  },

  LEVELSAUTOCOVER: {
    ID: "levelsautocover",
    DUCKING: "ducking",
    ACTIVE: false
  }
};

let MOD = MODULE_KEYS.EV;
MODULE_KEYS.EV.FLAG_TOKEN_HEIGHT = `flags.${MOD.ID}.${MOD.TOKEN_HEIGHT}`;
MODULE_KEYS.EV.FLAG_WALL_TOP = `flags.${MOD.ID}.${MOD.ELEVATION}.${MOD.WALL.TOP}`;
MODULE_KEYS.EV.FLAG_WALL_BOTTOM = `flags.${MOD.ID}.${MOD.ELEVATION}.${MOD.WALL.BOTTOM}`;
MODULE_KEYS.EV.FLAG_PLACEABLE_ELEVATION = `flags.${MOD.ID}.${MOD.ELEVATION}`;

MOD = MODULE_KEYS.WH;
MODULE_KEYS.WH.FLAG_TOKEN_HEIGHT = `flags.${MOD.ID}.${MOD.TOKEN_HEIGHT}`;
MODULE_KEYS.WH.FLAG_WALL_TOP = `flags.${MOD.ID}.${MOD.WALL.TOP}`;
MODULE_KEYS.WH.FLAG_WALL_BOTTOM = `flags.${MOD.ID}.${MOD.WALL.BOTTOM}`;


// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function() {
  MODULE_KEYS.LEVELS.ACTIVE = game.modules.get(MODULE_KEYS.LEVELS.ID)?.active;
  MODULE_KEYS.EV.ACTIVE = game.modules.get(MODULE_KEYS.EV.ID)?.active;
  MODULE_KEYS.WH.ACTIVE = game.modules.get(MODULE_KEYS.WH.ID)?.active;
  MODULE_KEYS.LEVELSAUTOCOVER.ACTIVE = game.modules.get(MODULE_KEYS.LEVELSAUTOCOVER.ID)?.active;
});
