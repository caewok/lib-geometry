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
import { MatrixFloat32 } from "../Matrix.js";

const TRACKER_TYPES = {
  background: [
    "background.alphaThreshold",
    "background.src",
  ],
  foreground: [
    "foreground.alphaThreshold",
    "foreground.src",
  ],
  elevation: [
    "elevation.bottom",
    "elevation.top",
    "elevation.base",
  ],
  position2d: [
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

/**
 * On canvas ready, make sure the level textures are loaded so the dimensions can be determined.
 */
Hooks.on("canvasReady", async () => {
  const promises = [];
  canvas.scene.levels.forEach(levelD => {
    promises.push(LevelBackgroundGeometry.cacheManager.cacheDocument(levelD));
    promises.push(LevelForegroundGeometry.cacheManager.cacheDocument(levelD));
  });
  await Promise.allSettled(promises);

  // Now force updates for all level geometries, to update aabb and matrices.
  const bgMgr = CONFIG[GEOMETRY_LIB_ID].geometryManager.levels.background;
  const fgMgr = CONFIG[GEOMETRY_LIB_ID].geometryManager.levels.foreground;
  canvas.scene.levels.forEach(levelD => {
    bgMgr.geomForDocument(levelD).forceUpdate();
    fgMgr.geomForDocument(levelD).forceUpdate();
  });
});


export class LevelBackgroundGeometry extends TileGeometry {

  /** @type {string} */
  static PLACEABLE_NAME = "Level";

  /** @type {string} */
  static LAYER = "levels";

  /** @type {string} */
  static LEVEL_TYPE = "background";

  get level() { return this.placeableDocument; }

  get tile() { throw Error("LevelGeometry does not have a tile"); }

  get alphaThreshold() { return this.level.background.alphaThreshold; }

  get elevationZ() { return gridUnitsToPixels(this.placeableDocument.elevation.base); }

  /**
   * Create an id used for the model matrix tracking.
   * @type {string}
   */
  get placeableId() { return `${this.placeableDocument.uuid}_${this.constructor.LEVEL_TYPE}`; }

  static get cacheManager() { return CONFIG[GEOMETRY_LIB_ID].levelBackgroundPixelCache; }

  static TRACKER_TYPES = TRACKER_TYPES;

  static UPDATE_KEYS = {
    ...super.UPDATE_KEYS,
    properties: new Set([...TRACKER_TYPES.texture, ...TRACKER_TYPES[this.LEVEL_TYPE]]),
    level: NULL_SET,
    position2d: new Set([...TRACKER_TYPES.elevation, ...TRACKER_TYPES.texture]),
  };

  // ----- NOTE: AABB ----- //
  calculateAABB() {
    const cache = this.pixelCache;
    if ( !cache ) {
      // Cannot ascertain width and height without the texture. (At least, it would require a partial load.)
      // But there is a decent chance that the scene rect would cover the dimensions.
      AABB3d.fromRectangle(canvas.scene.dimensions.sceneRect, this.elevationZ, this.aabb);

    } else {
      // Use the cache to find the boundary points.
      const { width, height } = cache;
      using TL = cache._toCanvasCoordinates(0, 0);
      using BL = cache._toCanvasCoordinates(0, height);
      using TR = cache._toCanvasCoordinates(width, 0);
      using BR = cache._toCanvasCoordinates(width, height);
      AABB3d.fromPoints([TL, BL, TR, BR], this.aabb);
      this.aabb.min.z = this.elevationZ;
      this.aabb.max.z = this.elevationZ;
    }
  }

  // ----- NOTE: Matrices ----- //

  calculateTranslationMatrix() {
    // Calculate the matrix first to avoid recalculating after the reload is done.
    const mat = super.calculateTranslationMatrix();
    const ctr = this.constructor.tileCenter(this.placeableDocument);
    return MatrixFloat32.translation(ctr.x, ctr.y, this.elevationZ, mat);
  }

  calculateRotationMatrix() {
    const mat = super.calculateRotationMatrix();
    const rot = this.constructor.tileRotation(this.placeableDocument)
    return MatrixFloat32.rotationZ(rot, true, mat);
  }

  calculateScaleMatrix() {
    const mat = super.calculateScaleMatrix();
    const { width, height } = this.constructor.tileDimensions(this.placeableDocument);
    return MatrixFloat32.scale(width, height, 1.0, mat);
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

  static tileDimensions(levelD) {
    const cache = this.cacheManager.pixelCacheForDocument(levelD);
    if ( !cache ) {
      const { width, height } = canvas.scene;
      return { width, height };
    }

    const { width, height } = cache;
    using TL = cache._toCanvasCoordinates(0, 0);
    using BL = cache._toCanvasCoordinates(0, height);
    using TR = cache._toCanvasCoordinates(width, 0);

    return {
      width: PIXI.Point.distanceBetween(TL, TR),
      height: PIXI.Point.distanceBetween(TL, BL),
    };
  }

}

export class LevelForegroundGeometry extends LevelBackgroundGeometry {

  /** @type {string} */
  static LEVEL_TYPE = "foreground";

  static get cacheManager() { return CONFIG[GEOMETRY_LIB_ID].levelForegroundPixelCache; }

  get elevationZ() { return gridUnitsToPixels(this.placeableDocument.elevation.top); }

}
