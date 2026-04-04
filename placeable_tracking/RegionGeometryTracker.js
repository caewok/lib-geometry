/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { PlaceableGeometryTracker } from "./PlaceableGeometryTracker.js";
import { RegionGeometry } from "../placeable_geometry/RegionGeometry.js";

export class RegionGeometryTracker extends PlaceableGeometryTracker {

  static DOCUMENT_NAME = "Region";

  static LAYER = "regions";

  static GEOMETRY = RegionGeometry;

  static UPDATE_KEYS = new Set([
    ...RegionGeometry.TRACKER_TYPES.elevation,
    ...RegionGeometry.TRACKER_TYPES.shapes,
  ]);
}
