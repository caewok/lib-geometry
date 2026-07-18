/* globals
canvas,
CONFIG,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { TileGeometry } from "./TileGeometry.js";
import { GEOMETRY_LIB_ID } from "../const.js";
import { gridUnitsToPixels, NULL_SET } from "../util.js";
import { AABB3d } from "../3d/AABB3d.js";
import { Point3d } from "../3d/Point3d.js";

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
    const elevationZ = this.constructor.placeableElevationZ(this.placeableDocument)
    if ( !cache ) {
      // Cannot ascertain width and height without the texture. (At least, it would require a partial load.)
      // But there is a decent chance that the scene rect would cover the dimensions.
      AABB3d.fromRectangle(canvas.scene.dimensions.sceneRect, elevationZ, this.aabb);

    } else {
      // Use the cache to find the boundary points.
      const { width, height } = cache;
      using TL = cache._toCanvasCoordinates(0, 0);
      using BL = cache._toCanvasCoordinates(0, height);
      using TR = cache._toCanvasCoordinates(width, 0);
      using BR = cache._toCanvasCoordinates(width, height);
      AABB3d.fromPoints([TL, BL, TR, BR], this.aabb);
      this.aabb.min.z = elevationZ;
      this.aabb.max.z = elevationZ;
    }
  }

  // ----- NOTE: Scene texture characteristics ----- //

  static tileRotation(levelD) {
    return Point3d.tmp.set(0, 0, Math.toRadians(levelD.textures.rotation || 0));
  }

  /**
   * Determine the center of the level, in pixel units.
   * @param {Level} levelD
   * @returns {Point3d}
   */
  static tileCenter(levelD) {
    const cache = this.cacheManager.pixelCacheForDocument(levelD);
    if ( !cache ) return canvas.scene.dimensions.sceneRect.center;
    const { width, height } = cache;
    using TL = cache._toCanvasCoordinates(0, 0);
    using BR = cache._toCanvasCoordinates(width, height);
    using mid = PIXI.Point.midPoint(TL, BR);
    return Point3d.tmp.set(mid.x, mid.y, gridUnitsToPixels(levelD.elevation.base));
  }

  /**
   * Determine the level 3d dimensions, in pixel units.
   * @param {Level} levelD
   * @returns {Point3d} x: width, y: height, z: zHeight
   */
  static tileDimensions(levelD) {
    const cache = this.cacheManager.pixelCacheForDocument(levelD);
    if ( !cache ) {
      const { width, height } = canvas.scene;
      return Point3d.tmp.set(width, height, 1);
    }

    const { width, height } = cache;
    using TL = cache._toCanvasCoordinates(0, 0);
    using BL = cache._toCanvasCoordinates(0, height);
    using TR = cache._toCanvasCoordinates(width, 0);

    return Point3d.tmp.set(
      PIXI.Point.distanceBetween(TL, TR),
      PIXI.Point.distanceBetween(TL, BL),
      1,
    );
  }

  /**
   * Finite elevation of the level background (bottom).
   * @param {PlaceableDocument} placeableD
   * @returns {number}
   */
  static placeableElevationZ(placeableD) {
    const MAX_ELEV = 1e06;
    const z = gridUnitsToPixels(placeableD.elevation.bottom);
    if ( z === Number.POSITIVE_INFINITY ) return MAX_ELEV;
    if ( z === Number.NEGATIVE_INFINITY ) return -MAX_ELEV;
    return z;
  }

}

export class LevelForegroundGeometry extends LevelBackgroundGeometry {

  /** @type {string} */
  static LEVEL_TYPE = "foreground";

  static get cacheManager() { return CONFIG[GEOMETRY_LIB_ID].levelForegroundPixelCache; }

  /**
   * Finite elevation of the level background (bottom).
   * @param {PlaceableDocument} placeableD
   * @returns {number}
   */
  static placeableElevationZ(placeableD) {
    const MAX_ELEV = 1e06;
    const z = gridUnitsToPixels(placeableD.elevation.top);
    if ( z === Number.POSITIVE_INFINITY ) return MAX_ELEV;
    if ( z === Number.NEGATIVE_INFINITY ) return -MAX_ELEV;
    return z;
  }
}
