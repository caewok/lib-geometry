/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { PlaceableGeometryTracker } from "./PlaceableGeometryTracker.js";
import { WallGeometry } from "../placeable_geometry/WallGeometry.js";

export class WallGeometryTracker extends PlaceableGeometryTracker {

  static DOCUMENT_NAME = "Wall";

  static LAYER = "walls";

  static GEOMETRY = WallGeometry;

  static UPDATE_KEYS = new Set([
    ...WallGeometry.TRACKER_TYPES.position,
    ...WallGeometry.TRACKER_TYPES.direction,
  ]);
}
