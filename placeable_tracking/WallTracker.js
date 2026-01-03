/* globals
CONFIG,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { AbstractPlaceableTracker } from "./AbstractPlaceableTracker.js";

class AbstractWallTracker extends AbstractPlaceableTracker {
  /** @type {string} */
  static PLACEABLE_NAME = "Wall";

  /** @type {string} */
  static layer = "walls";
}

export class WallPositionTracker extends AbstractWallTracker {
  /** @type {string} */
  static ID = "positionTracker";

  static DOCUMENT_KEYS = new Set([
    "flags.wall-height.top",
    "flags.wall-height.top",
    "c",
    "dir",
    "light",
    "move",
    "sight",
    "sound",
  ]);
}

export class WallTypeTracker extends AbstractWallTracker {
  /** @type {string} */
  static ID = "typeTracker";

  static DOCUMENT_KEYS = new Set([
    "dir",
    "light",
    "move",
    "sight",
    "sound",
  ]);
}

export class WallDoorTracker extends AbstractWallTracker {
  /** @type {string} */
  static ID = "doorTracker";

  static DOCUMENT_KEYS = new Set([
    "door",
    "ds",
  ]);
}

export class WallThresholdTracker extends AbstractWallTracker {
  /** @type {string} */
  static ID = "thresholdTracker";

  static DOCUMENT_KEYS = new Set([
    "threshold.attenuation",
    "threshold.light",
    "threshold.sight",
    "threshold.sound",
  ]);
}
