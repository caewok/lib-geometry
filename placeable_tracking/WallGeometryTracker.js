/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { PlaceableGeometryTracker } from "./PlaceableGeometryTracker.js";
import { WallGeometry } from "../placeable_geometry/WallGeometry.js";

const TRACKER_TYPES = {
  position: [
    "c",
    "flags-wall-height.top",
    "flags.wall-height.bottom",
  ],
  direction: [
    "dir",
  ],
  restriction: [
    "light",
    "move",
    "sight",
    "sound",
  ],
  door: [
    "door",
    "ds",
  ],
  threshold: [
    "threshold.attenuation",
    "threshold.light",
    "threshold.sight",
    "threshold.sound",
  ],
};


export class WallGeometryTracker extends PlaceableGeometryTracker {

  static DOCUMENT_NAME = "Wall";

  static LAYER = "walls";

  static TRACKER_TYPES = TRACKER_TYPES;

  static TRACKERS = {
    shape: TRACKER_TYPES.position,
    direction: TRACKER_TYPES.direction,
  };

  static GEOMETRY = WallGeometry;
}
