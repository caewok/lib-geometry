/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { PlaceableGeometryTracker } from "./PlaceableGeometryTracker.js";
import { RegionGeometry } from "../placeable_geometry/RegionGeometry.js";

const TRACKER_TYPES = {
  elevation: [
    "elevation.bottom",
    "elevation.top",
    "flags.terrainmapper.plateauElevation",
    "flags.terrainmapper.rampFloor",
  ],
  shapes: [
    "shapes",
    "flags.terrainmapper.rampDirection",
    "flags.terrainmapper.splitPolygons",
    "flags.terrainmapper.elevationAlgorithm",
  ],
};

export class RegionGeometryTracker extends PlaceableGeometryTracker {

  static DOCUMENT_NAME = "Region";

  static LAYER = "regions";

  static TRACKERS = {
    shape: [...TRACKER_TYPES.elevation, ...TRACKER_TYPES.shapes], // Treat altogether for now; may split in the future if useful.
  };

  static GEOMETRY = RegionGeometry;
}
