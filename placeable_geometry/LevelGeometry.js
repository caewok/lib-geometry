/* globals
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { TileGeometry } from "./TileGeometry.js";

const TRACKER_TYPES = {
  background: [
    "background.alphaThreshold",
    "background.src",
  ],
  elevation: [
    "elevation.bottom",
    "elevation.top",
    "elevation.base",
  ],
  position: [
    "textures.offsetX",
    "textures.offsetY",
  ],

  rotation: [
    "textures.anchorX",
    "textures.anchorY",
  ],

  scale: [
    "textures.scaleX",
    "textures.scaleY",
  ],

  texture: [
    "textures.fit",
  ],

  textures: [
    "textures.anchorX",
    "textures.anchorY",
    "textures.fit",
    "textures.offsetX",
    "textures.offsetY",
    "textures.rotation",
    "textures.scaleX",
    "textures.scaleY",
  ],
};


export LevelBackgroundGeometry extends TileGeometry {

  /** @type {string} */
  static PLACEABLE_NAME = "Level";

  /** @type {string} */
  static layer = "levels";

  /** @type {boolean} */
  static foreground = false;

  get scene() { return this.placeable; }

  get tile() { return this.placeable; }

  get alphaThreshold() { return this.scene.background.alphaThreshold; }

  get pixelCache() { return CONFIG[GEOMETRY_LIB_ID].levelBackgroundPixelCache.cacheForDocument(this.placeableDocument); }

  get elevationZ() { gridUnitsToPixels(this.placeableDocument.elevation.base); }

  static TRACKER_TYPES = TRACKER_TYPES;

  static UPDATE_KEYS = {
    position: new Set([...TRACKER_TYPES.elevation, ...TRACKER_TYPES.textures]),
    scale: new Set(TRACKER_TYPES.scale),
    rotation: new Set(TRACKER_TYPES.rotation),
    shape: NULL_SET,
    properties: NULL_SET,
    texture: new Set(TRACKER_TYPES.texture),
    texturePosition: new Set(TRACKER_TYPES.texturePosition),
  };

  // ----- NOTE: AABB ----- //
  calculateAABB() {
    const cache = this.pixelCache;
    if ( !cache ) {
      // Cannot ascertain width and height without the texture. (At least, it would require a partial load.)
      // But there is a decent chance that the scene rect would cover the dimensions.
      AABB3d.fromRectangle(canvas.scene.dimensions.sceneRect, this.elevationZ, this.aabb);
    } else {
      // Lazy way is to use the cache to find the boundary points.
      const { width, height } = cache;
      using TL = cache._toCanvasCoordinates(0, 0);
      using BL = cache._toCanvasCoordinates(0, height);
      using TR = cache._toCanvasCoordinates(width, 0);
      using BR = cache._toCanvasCoordinates(width, height);
      AABB3d.fromPoints([TL, BL, TR, BR], this.elevationZ, this.aabb);
    }
  }

  // ----- NOTE: Scene texture characteristics ----- //

  static tileRotation(levelD) { return Math.toRadians(levelD.textures.rotation || 0); }

  /**
   * Determine the center of the tile, in pixel units.
   * @param {Tile} tile
   * @returns {Point3d}
   */
  static tileCenter(levelD) {
    const ctr = tile.center;
    return Point3d.tmp.set(ctr.x, ctr.y, tile.elevationZ);
  }

}

export LevelForegroundGeometry extends LevelBackgroundGeometry {

  /** @type {boolean} */
  static foreground = true;

  get pixelCache() { return CONFIG[GEOMETRY_LIB_ID].levelForegroundPixelCache.cacheForDocument(this.placeableDocument); }

  get elevationZ() { gridUnitsToPixels(this.placeableDocument.elevation.top); }
}