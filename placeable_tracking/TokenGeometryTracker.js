/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { PlaceableGeometryTracker } from "./PlaceableGeometryTracker.js";
import { TokenGeometry } from "../placeable_geometry/TokenGeometry.js";

const TRACKER_TYPES = {
  position: [
    "x",
    "y",
    "elevation",
  ],
  scale: [
    "width",
    "height"
  ],
  shape: [
    "shape",
  ],
  disposition: [
    "disposition",
  ],
  refresh: [
    "refreshPosition",
    "refreshElevation",
  ]
};

export class TokenGeometryTracker extends PlaceableGeometryTracker {

  static DOCUMENT_NAME = "Token";

  static LAYER = "tokens";

  static TRACKER_TYPES = TRACKER_TYPES;

  static TRACKERS = {
    position: TRACKER_TYPES.position,
    scale: TRACKER_TYPES.scale,
    shape: [...TRACKER_TYPES.position, ...TRACKER_TYPES.scale, ...TRACKER_TYPES.shape],
  };

  static GEOMETRY = TokenGeometry;
}
