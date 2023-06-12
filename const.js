/* globals
*/
"use strict";

export const MODULE_KEYS = {
  EV: {
    ID: "elevatedvision",
    TOKEN_HEIGHT: "tokenHeight",
    WALL: { TOP: "top", BOTTOM: "bottom" },
    ELEVATION: "elevation"
  },

  WH: {
    ID: "wall-height",
    TOKEN_HEIGHT: "tokenHeight",
    WALL: { TOP: "top", BOTTOM: "bottom" }
  },

  LEVELS: {
    ID: "levels"
  },

  LEVELSAUTOCOVER: {
    ID: "levelsautocover",
    DUCKING: "ducking"
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
