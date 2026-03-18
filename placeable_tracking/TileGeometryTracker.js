/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { PlaceableGeometryTracker } from "./PlaceableGeometryTracker.js";
import { TileGeometry } from "../placeable_geometry/TileGeometry.js";

const TRACKER_TYPES = {
  position: [
    "x",
    "y",
    "elevation",
  ],
  scale: [
    "width",
    "height",
  ],
  rotation: [
    "rotation",
  ],
  texture: [
    "texture.alphaThreshold",
    "texture.anchorX",
    "texture.anchorY",
    "texture.fit",
    "texture.fill",
    "texture.offsetX",
    "texture.offsetY",
    "texture.rotation",
    "texture.scaleX",
    "texture.scaleY",
    "texture.src",
  ],
};

export class TileGeometryTracker extends PlaceableGeometryTracker {

  static DOCUMENT_NAME = "Tile";

  static LAYER = "tiles";

  static TRACKER_TYPES = TRACKER_TYPES;

  static TRACKERS = {
    position: TRACKER_TYPES.position,
    scale: TRACKER_TYPES.scale,
    rotation: TRACKER_TYPES.rotation,
    shape: [...TRACKER_TYPES.position, TRACKER_TYPES.scale, TRACKER_TYPES.rotation],
    alphaThreshold: ["texture.alphaThreshold"],
  };

  static GEOMETRY = TileGeometry;
}
