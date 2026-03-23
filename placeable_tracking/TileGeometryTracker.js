/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { PlaceableGeometryTracker } from "./PlaceableGeometryTracker.js";
import { TileGeometry } from "../placeable_geometry/TileGeometry.js";

export class TileGeometryTracker extends PlaceableGeometryTracker {

  static DOCUMENT_NAME = "Tile";

  static LAYER = "tiles";

  static GEOMETRY = TileGeometry;

  static UPDATE_KEYS = new Set([
    ...TileGeometry.TRACKER_TYPES.position,
    ...TileGeometry.TRACKER_TYPES.scale,
    ...TileGeometry.TRACKER_TYPES.rotation,
  ]);
}
