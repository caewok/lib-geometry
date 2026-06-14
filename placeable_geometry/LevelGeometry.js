/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { TileGeometry } from "./TileGeometry.js";
import { GEOMETRY_LIB_ID } from "../const.js";
import { gridUnitsToPixels, NULL_SET } from "../util.js";
import { AABB3d } from "../3d/AABB3d.js";

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


export class LevelBackgroundGeometry extends TileGeometry {

  /** @type {string} */
  static PLACEABLE_NAME = "Level";

  /** @type {string} */
  static layer = "levels";

  /** @type {boolean} */
  static foreground = false;

  get level() { return this.placeableDocument; }

  get tile() { throw Error("LevelGeometry does not have a tile"); }

  get alphaThreshold() { return this.level.background.alphaThreshold; }

  get elevationZ() { return gridUnitsToPixels(this.placeableDocument.elevation.base); }

  static get cacheManager() { return CONFIG[GEOMETRY_LIB_ID].levelBackgroundPixelCache; }

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
    const cache = this.cacheManager.pixelCacheForDocument(levelD);
    if ( !cache ) return canvas.scene.dimensions.sceneRect.center;
    const { width, height } = cache;
    using TL = cache._toCanvasCoordinates(0, 0);
    using BR = cache._toCanvasCoordinates(width, height);
    return PIXI.Point.midPoint(TL, BR);
  }

}

export class LevelForegroundGeometry extends LevelBackgroundGeometry {

  /** @type {boolean} */
  static foreground = true;

  static get cacheManager() { return CONFIG[GEOMETRY_LIB_ID].levelForegroundPixelCache; }

  get elevationZ() { return gridUnitsToPixels(this.placeableDocument.elevation.top); }

}
