/* globals
CONFIG,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { AbstractPlaceableTracker } from "./AbstractPlaceableTracker.js";

class AbstractTileTracker extends AbstractPlaceableTracker {
  /** @type {string} */
  static PLACEABLE_NAME = "Tile";

  /** @type {string} */
  static layer = "tiles";
}

export class TilePositionTracker extends AbstractTileTracker {
  /** @type {string} */
  static ID = "positionTracker";

  static DOCUMENT_KEYS = new Set([
    "x",
    "y",
    "elevation",
  ]);
}

export class TileScaleTracker extends AbstractTileTracker {
  /** @type {string} */
  static ID = "scaleTracker";

  static DOCUMENT_KEYS = new Set([
    "width",
    "height",
  ]);
}

export class TileRotationTracker extends AbstractTileTracker {
  /** @type {string} */
  static ID = "rotationTracker";

  static DOCUMENT_KEYS = new Set([
    "rotation",
  ]);
}
