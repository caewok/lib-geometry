/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { PlaceableTracker } from "./AbstractPlaceableTracker.js";

class AbstractRegionTracker extends PlaceableTracker {
  /** @type {string} */
  static PLACEABLE_NAME = "Region";

  /** @type {string} */
  static layer = "regions";
}

export class RegionUpdateTracker extends AbstractRegionTracker {
  /** @type {string} */
  static ID = "updateTracker";

  static DOCUMENT_KEYS = new Set([
    "shapes",
    "flags.terrainmapper.rampDirection",
    "flags.terrainmapper.splitPolygons",
    "flags.terrainmapper.elevationAlgorithm",
  ]);
}

export class RegionElevationTracker extends AbstractRegionTracker {
  /** @type {string} */
  static ID = "elevationTracker";

  static DOCUMENT_KEYS = new Set([
    "elevation.bottom",
    "elevation.top",
    "flags.terrainmapper.plateauElevation",
    "flags.terrainmapper.rampFloor",
  ]);
}
