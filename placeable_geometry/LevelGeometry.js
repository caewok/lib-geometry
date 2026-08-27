/* globals
canvas,
CONFIG,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import {
  TileGeometry,
  TileFullGeometry,
  TileBoundingRectGeometry,
  TileBoundingPolygonGeometry,
  TilePolygonsGeometry,
  TileTrianglesGeometry,
} from "./TileGeometry.js";

import { GEOMETRY_LIB_ID } from "../const.js";
import { gridUnitsToPixels, NULL_SET } from "../util.js";
import { AABB3d } from "../3d/AABB3d.js";
import { Point3d } from "../3d/Point3d.js";
import { mix } from "../mixwith.js";

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


const LevelCalculationsMixin = superclass => class extends superclass {

  /** @type {string} */
  static PLACEABLE_NAME = "Level";

  /** @type {string} */
  static LAYER = "levels";

  /** @type {string} */
  static LEVEL_TYPE = "background";

  /** @type {number} */
  static alphaThreshold(level) { return level[this.LEVEL_TYPE].alphaThreshold || 0; }


  get level() { return this.placeableDocument; }

  /**
   * Create an id used for the model matrix tracking.
   * @type {string}
   */
  get placeableId() { return `${this.placeableDocument.uuid}_${this.constructor.LEVEL_TYPE}`; }

  // AABB required for Quadtree.
  aabb = new AABB3d();

  /**
   * Does this geometry currently block a given sense type?
   * @param {CONST.WALL_RESTRICTION_TYPES} [senseType="sight"]
   * @returns {boolean}
   */
  static blocksSense(_placeableDocument, _senseType = "sight") { return true; }

  /**
   * Does this placeable exist on this level?
   * @param {string} levelId
   * @returns {boolean} True if seen from this level or the levelId is null or "".
   */
  static isPresentAtLevel(placeableDocument, levelId) {
    if ( !canvas.scene.levels.has(levelId) ) return !levelId;
    if ( placeableDocument.id === levelId ) return true;
    return !placeableDocument.visibility.levels.has(levelId);
  }

  /**
   * Combines sense test with level test with any other tests specific to the placeable document.
   * @param {object} [opts]
   * @prop {CONST.WALL_RESTRICTION_TYPES} [opts.senseType = "sight"]
   * @prop {string} [opts.levelId]
   * @prop {...}                      Other options used by subclasses
   * @returns {boolean}
   */
  static couldBlock(placeableDocument, opts = {}) {
    return this.blocksSense(placeableDocument, opts.senseType)
        && this.isPresentAtLevel(placeableDocument, opts.levelId);
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
   * Get the source for a level document.
   * @param {Level} levelD
   * @returns {string} The url.
   */
  static textureSource(levelD) { return levelD[this.LEVEL_TYPE].src; }

};

const LevelBackgroundMixin = superclass => class extends superclass {
  /** @type {string} */
  static LEVEL_TYPE = "background";

  static get cacheManager() { return CONFIG[GEOMETRY_LIB_ID].levelBackgroundPixelCache; }

  /**
   * Finite elevation of the level background (bottom).
   * @type {number}
   */
  get elevationZ() {
    return this.constructor.finiteElevation(this.placeableDocument.bottomZ);
  }
};

const LevelForegroundMixin = superclass => class extends superclass {
  /** @type {string} */
  static LEVEL_TYPE = "foreground";

  static get cacheManager() { return CONFIG[GEOMETRY_LIB_ID].levelForegroundPixelCache; }

  /**
   * Finite elevation of the level background (bottom).
   * @type {number}
   */
  get elevationZ() {
    return this.constructor.finiteElevation(this.placeableDocument.topZ);
  }
};

const LevelGeometrySubclassMixin = superclass => class extends superclass {
  static UPDATE_KEYS = {
    ...super.UPDATE_KEYS,
    properties: new Set([...TRACKER_TYPES.texture, ...TRACKER_TYPES[this.LEVEL_TYPE]]),
    level: NULL_SET,
    position2d: new Set([...TRACKER_TYPES.elevation, ...TRACKER_TYPES.texture]),
  };

  // ----- NOTE: AABB ----- //
  calculateAABB() {
    const cache = this.pixelCache;
    const elevationZ = this.elevationZ;
    if ( !cache ) {
      // Cannot ascertain width and height without the texture. (At least, it would require a partial load.)
      // But there is a decent chance that the scene rect would cover the dimensions.
      AABB3d.fromLevel(this.placeableDocument, { type: this.constructor.LEVEL_TYPE, out: this.aabb });

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
};

export class LevelBackgroundFullGeometry extends mix(TileFullGeometry).with(LevelCalculationsMixin, LevelBackgroundMixin, LevelGeometrySubclassMixin) { }
export class LevelBackgroundBoundingRectGeometry extends mix(TileBoundingRectGeometry).with(LevelCalculationsMixin, LevelBackgroundMixin, LevelGeometrySubclassMixin) { }
export class LevelBackgroundBoundingPolygonGeometry  extends mix(TileBoundingPolygonGeometry).with(LevelCalculationsMixin, LevelBackgroundMixin, LevelGeometrySubclassMixin) { }
export class LevelBackgroundPolygonsGeometry  extends mix(TilePolygonsGeometry).with(LevelCalculationsMixin, LevelBackgroundMixin, LevelGeometrySubclassMixin) { }
export class LevelBackgroundTrianglesGeometry  extends mix(TileTrianglesGeometry).with(LevelCalculationsMixin, LevelBackgroundMixin, LevelGeometrySubclassMixin) { }

export class LevelForegroundFullGeometry extends mix(TileFullGeometry).with(LevelCalculationsMixin, LevelForegroundMixin, LevelGeometrySubclassMixin) { }
export class LevelForegroundBoundingRectGeometry extends mix(TileBoundingRectGeometry).with(LevelCalculationsMixin, LevelForegroundMixin, LevelGeometrySubclassMixin) { }
export class LevelForegroundBoundingPolygonGeometry extends mix(TileBoundingPolygonGeometry).with(LevelCalculationsMixin, LevelForegroundMixin, LevelGeometrySubclassMixin) { }
export class LevelForegroundPolygonsGeometry extends mix(TilePolygonsGeometry).with(LevelCalculationsMixin, LevelForegroundMixin, LevelGeometrySubclassMixin) { }
export class LevelForegroundTrianglesGeometry extends mix(TileTrianglesGeometry).with(LevelCalculationsMixin, LevelForegroundMixin, LevelGeometrySubclassMixin) { }


export class LevelBackgroundGeometry extends mix(TileGeometry).with(LevelCalculationsMixin, LevelBackgroundMixin) {

  static SUBCLASSES = {
    full: LevelBackgroundFullGeometry,
    boundingRect: LevelBackgroundBoundingRectGeometry,
    boundingPolygon: LevelBackgroundBoundingPolygonGeometry,
    polygons: LevelBackgroundPolygonsGeometry,
    triangles: LevelBackgroundTrianglesGeometry,
  };

  calculateAABB() {
    // Check if the asset is loaded. If not, load it and update the aabb again later.
    const type = this.constructor.LEVEL_TYPE;
    const src = this.placeableDocument[type].src;
    let tex;
    if ( src ) tex = PIXI.Assets.get(src); // May return null.
    if ( src && !tex ) PIXI.Assets.load(src).then((tex) => {
      if ( tex ) this.calculateAABB();
    });
    AABB3d.fromLevel(this.placeableDocument, { type, out: this.aabb });
  }

  /**
   * Finite elevation of the level background (bottom).
   * @type {number}
   */
  get elevationZ() {
    return this.constructor.finiteElevation(this.placeableDocument.bottomZ);
  }
}

export class LevelForegroundGeometry extends mix(TileGeometry).with(LevelCalculationsMixin, LevelForegroundMixin) {

  static SUBCLASSES = {
    full: LevelForegroundFullGeometry,
    boundingRect: LevelForegroundBoundingRectGeometry,
    boundingPolygon: LevelForegroundBoundingPolygonGeometry,
    polygons: LevelForegroundPolygonsGeometry,
    triangles: LevelForegroundTrianglesGeometry,
  };


  calculateAABB() {
    // Check if the asset is loaded. If not, load it and update the aabb again later.
    const type = this.constructor.LEVEL_TYPE;
    const src = this.placeableDocument[type].src;
    let tex;
    if ( src ) tex = PIXI.Assets.get(src); // May return null.
    if ( src && !tex ) PIXI.Assets.load(src).then((tex) => {
      if ( tex ) this.calculateAABB();
    });
    AABB3d.fromLevel(this.placeableDocument, { type, out: this.aabb });
  }

  /**
   * Finite elevation of the level background (bottom).
   * @type {number}
   */
  get elevationZ() {
    return this.constructor.finiteElevation(this.placeableDocument.topZ);
  }
}