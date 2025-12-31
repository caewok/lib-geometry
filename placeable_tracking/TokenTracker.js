/* globals
CONFIG,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { AbstractPlaceableTracker } from "./AbstractPlaceableTracker.js";

class AbstractTokenTracker extends AbstractPlaceableTracker {
  /** @type {string} */
  static PLACEABLE_NAME = "Token";

  /** @type {string} */
  static layer = "tokens";
}

export class TokenPositionTracker extends AbstractTokenTracker {
  /** @type {string} */
  static ID = "positionTracker";

  static DOCUMENT_KEYS = new Set([
    "x",
    "y",
    "elevation",
  ]);

  static REFRESH_FLAGS = new Set([
    "refreshPosition",
    "refreshElevation",
  ]);
}

export class TokenScaleTracker extends AbstractTokenTracker {
  /** @type {string} */
  static ID = "scaleTracker";

  static DOCUMENT_KEYS = new Set([
    "width",
    "height",
  ]);

  static REFRESH_FLAGS = new Set([
    "refreshSize",
  ]);
}

export class TokenShapeTracker extends AbstractTokenTracker {
  /** @type {string} */
  static ID = "shapeTracker";

  static DOCUMENT_KEYS = new Set([
    "shape",
  ]);
}
