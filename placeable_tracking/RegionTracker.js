/* globals
CONFIG,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { AbstractPlaceableTracker } from "./AbstractPlaceableTracker.js";

export class RegionUpdateTracker extends AbstractPlaceableTracker {
  /** @type {string} */
  static ID = "updateTracker";

  /** @type {string} */
  static PLACEABLE_NAME = "Region";

  /** @type {string} */
  static layer = "regions";

  static DOCUMENT_KEYS = new Set([
    "shapes",
    "elevation.bottom",
    "elevation.top",
  ]);
}
