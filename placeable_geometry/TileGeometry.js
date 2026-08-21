/* globals
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Geometry
import { PlaceableGeometry } from "./PlaceableGeometry.js";
import { QuadPrimitive, TexturedQuadPrimitive } from "./InstancedGeometricPrimitive.js";
import { PlanarPolygonPrimitive } from "./ModelGeometricPrimitive.js";


// LibGeometry
import { GEOMETRY_LIB_ID } from "../const.js";
import { Point3d } from "../3d/Point3d.js";
import { Segment } from "../Segment.js";
import { Polygon3d, Polygons3d, Triangle3d } from "../3d/Polygon3d.js";
import { AABB3d } from "../3d/AABB3d.js";
import { mix } from "../mixwith.js";

// Tile alpha bounds
import { Polygon3dVertices } from "../placeable_vertices/BasicVertices.js";

import { GeometrySubclassMixin } from "./TokenGeometry.js";

const TRACKER_TYPES = {
  position2d: [
    "x",
    "y",
    "texture.anchorX",
    "texture.anchorY",
  ],
  elevation: ["elevation"],
  scale: [
    "width",
    "height",
    "texture.scaleX",
    "texture.scaleY",
  ],
  rotation: [
    "rotation",
    "texture.rotation",
  ],

  texture: [
    "texture.alphaThreshold",
    "texture.src",
    "texture.fit",
    "texture.fill",
    "texture.offsetX",
    "texture.offsetY",
  ],
  level: [
    "levels",
  ],
};

/**
 * Mostly static methods used to calculate values from the placeable document.
 */
const TileDocumentCalculationsMixin = superclass => class extends superclass {
  /** @type {string} */
  static PLACEABLE_NAME = "Tile";

  /** @type {string} */
  static LAYER = "tiles";

  /** @type {number} */
  get alphaThreshold() { return this.placeableDocument.texture.alphaThreshold || 0; }

  get tile() { return this.placeableDocument.object; }

  get pixelCache() { return this.constructor.cacheManager.pixelCacheForDocument(this.placeableDocument); }

  static get cacheManager() { return CONFIG[GEOMETRY_LIB_ID].tilePixelCache; }

  // AABB required for Quadtree.
  aabb = new AABB3d();

  // ----- NOTE: Levels ----- //

  /**
   * Does this geometry currently block a given sense type?
   * @param {CONST.WALL_RESTRICTION_TYPES} [senseType="sight"]
   * @returns {boolean}
   */
  static blocksSense(placeableDocument, senseType = "sight") {
    if ( senseType === "light" ) return placeableDocument.restrictions.light;
    return true;
  }

  /**
   * Does this placeable exist on this level?
   * @param {string} levelId
   * @returns {boolean} True if seen from this level or the levelId is null or "".
   */
  static isPresentAtLevel(placeableDocument, levelId) {
    return PlaceableGeometry.isPresentAtLevel(placeableDocument, levelId);
  }

  /**
   * Combines sense test with level test with any other tests specific to the placeable document.
   * @param {object} [opts]
   * @prop {CONST.WALL_RESTRICTION_TYPES} [opts.senseType = "sight"]
   * @prop {string} [opts.levelId]
   * @prop {...}                      Other options used by subclasses
   * @returns {boolean}
   */
  static couldBlock(placeableDocument, opts) {
    return PlaceableGeometry.couldBlock(placeableDocument, opts);
  }

  /**
   * Determine the tile rotation.
   * @param {TileDocument} tileD
   * @returns {Point3d}    Rotation, in radians, along the z axis.
   */
  static tileRotation(tileD) {
    return Point3d.tmp.set(0, 0, Math.toRadians(tileD.rotation || 0));
  }

  /**
   * Determine the center of the tile, in pixel units.
   * @param {TileDocument} tileD
   * @returns {Point3d}
   */
  static tileCenter(tileD) {
    const { x, y, width, height, texture, elevationZ } = tileD;
    const anchorX = texture?.anchorX ?? 0.5;
    const anchorY = texture?.anchorY ?? 0.5;

    // Shift TL by the difference between the center (0.5) and the anchor position.
    return Point3d.tmp.set(
      x + (width * (0.5 - anchorX)),
      y + (height * (0.5 - anchorY)),
      elevationZ,
    );
  }

  /**
   * Determine the tile 3d dimensions, in pixel units.
   * @param {TileDocument} tileD
   * @returns {Point3d} x: width, y: height, z: zHeight
   */
  static tileDimensions(tileD) { return Point3d.tmp.set(tileD.width, tileD.height, 1); }

  /**
   * Finite elevation of a tile.
   * @param {PlaceableDocument} placeableD
   * @returns {number}
   */
  get elevationZ() {
    return this.placeableDocument.elevationZ; // Tiles are always finite elevation.
  }
}

export class TileFullGeometry extends mix(PlaceableGeometry).with(TileDocumentCalculationsMixin) {

  static UPDATE_KEYS = {
    ...super.UPDATE_KEYS,
    properties: new Set(TRACKER_TYPES.texture),
    level: new Set(TRACKER_TYPES.level),
    position2d: new Set(TRACKER_TYPES.position2d),
    elevation: new Set(TRACKER_TYPES.elevation),
    scale: new Set(TRACKER_TYPES.scale),
    rotation: new Set(TRACKER_TYPES.rotation),
  };

  get shape() { return this.shapes[0]; } // Tiles currently always only using a single shape.

  initialize() {
    this.constructor.cacheManager.cacheDocument(this.placeableDocument); // Async.
    this.createShapes();
    super.initialize();
  }

  createShapes() {
    this.shapes.forEach(shape => shape.destroy());
    this.shapes.length = 1;
    this.shapes[0] = new TexturedQuadPrimitive(this.placeableId);
    this.shapes[0].direction = TexturedQuadPrimitive.CULL_FACES.DOUBLE; // Tiles block on both sides.
  }

  // ----- NOTE: Update ----- //

  _update() {
    // No changes required if properties (texture) is updated. But see mixin classes.

    // No changes required if level is updated.

    if ( this._updateFlags.positionXY || this._updateFlags.elevation ) {
      const ctr = this.constructor.tileCenter(this.placeableDocument);
      this.shape.setPosition(ctr);
    }

    if ( this._updateFlags.rotation ) {
      const angles = this.constructor.tileRotation(this.placeableDocument);
      this.shape.setRotation(angles);
    }

    if ( this._updateFlags.scale ) {
      const dims = this.constructor.tileDimensions(this.placeableDocument);
      this.shape.setScale(dims);
    }
    super._update();
  }

  // ----- NOTE: Faces ---- //

  /**
   * Determine where a ray hits this object in 3d.
   * Stops at the first hit for a triangle facing the correct direction.
   * Ignores intersections behind the ray.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {object} [opts]
   * @param {number} [opts.minT=0]        Ignore hits earlier in the segment than this (multiple of rayDirection)
   * @param {number} [opts.maxT=1]        Ignore hits later in the segment than this (multiple of rayDirection)
   * @returns {number|null} The distance along the ray, as a multiple of rayDirection
   */
  rayIntersection(rayOrigin, rayDirection, { alphaThreshold, ...opts } = {}) {
    const t = super.rayIntersection(rayOrigin, rayDirection, opts);
    if ( t === null ) return null;

    // Hits the tile border; does it hit a solid pixel?
    const pixelCache = this.pixelCache;
    alphaThreshold ??= this.alphaThreshold;
    if ( !(alphaThreshold && pixelCache) ) return t;

    // Threshold test at the intersection point.
    const pxThreshold = 255 * this.alphaThreshold;
    using projPt = Point3d.tmp;
    rayOrigin.add(rayDirection.multiplyScalar(t, projPt), projPt);
    const px = pixelCache.pixelAtCanvas(projPt.x, projPt.y);
    if ( px > pxThreshold ) return t;
    return null;
  }
}

export class TileBoundingRectGeometry extends TileFullGeometry {

  /**
   * Create an id used for the model matrix tracking.
   * @type {string}
   */
  get placeableId() { return `${super.placeableId}_boundingRect`; }

  /** @type {PIXI.Polygon|PIXI.Rectangle} */
  get _boundingRect() {
    const cache = this.pixelCache;
    if ( !cache ) return this.placeableDocument.shape.bounds;
    return cache.getThresholdCanvasBoundingBox(this.alphaThreshold);
  }

  createShapes() {
    this.shapes.forEach(shape => shape.destroy());
    this.shapes.length = 0;
    this.shapes.push(new QuadPrimitive(this.placeableId));
  }

  _update() {
    const rectOrPoly = this._boundingRect;

    if ( this._updateFlags.positionXY || this._updateFlags.elevation ) {
      const ctr = rectOrPoly.center;
      this.shape.setPosition({ x: ctr.x, y: ctr.y, z: this.elevationZ });
    }

    if ( this._updateFlags.rotation || this._updateFlags.scale ) {
      using dims = Point3d.tmp;
      using angles = Point3d.tmp;

      if ( rectOrPoly instanceof PIXI.Polygon ) {
        // Determine the rotation angle of the box.
        const iter = rectOrPoly.iteratePoints();
        const a = iter.next().value;
        const b = iter.next().value;
        const c = iter.next().value;
        using s0 = new Segment(a, b);
        using s1 = new Segment(b, c);
        angles.set(0, 0, s0.angleXY );
        dims.set(s0.length, s1.length, 1 );
      } else {
        angles.set(0, 0, 0);
        dims.set(rectOrPoly.width, rectOrPoly.height, 1)
      }
      this.shape.setRotation(angles);
      this.shape.setScale(dims);
    }

    PlaceableGeometry.prototype._update.call(this); // Skip super._update.
  }

}

export class TileBoundingPolygonGeometry extends TileFullGeometry {
  /**
   * Create an id used for the model matrix tracking.
   * @type {string}
   */
  get placeableId() { return `${super.placeableId}_boundingPolygon`; }

  /** @type {PIXI.Polygon} */
  get _boundingPolygon() {
    const cache = this.pixelCache;
    if ( !cache ) return this.placeableDocument.shape.bounds;
    return cache.getThresholdCanvasBoundingPolygon(this.alphaThreshold);
  }

  createShapes() {
    const cache = this.pixelCache;
    if ( !cache ) return super.createShapes();

    this.shapes.forEach(shape => shape.destroy());
    this.shapes.length = 0;

    const poly = this._boundingPolygon;
    const elevationZ = this.elevationZ;
    const poly3d = Polygon3d.fromPolygon(poly, elevationZ);
    const opts = {
      center: this.constructor.tileCenter(this.placeableDocument),
      dims: this.constructor.tileDimensions(this.placeableDocument),
      angles: this.constructor.tileRotation(this.placeableDocument),
    };
    this.shapes.push(PlanarPolygonPrimitive.fromPolygon3d(this.placeableId, poly3d, opts));
  }

  _update() {
    if ( this._updateFlags.texture ) this.createShapes();
    super._update();
  }
}

export class TilePolygonsGeometry extends TileFullGeometry {
  /**
   * Create an id used for the model matrix tracking.
   * @type {string}
   */
  get placeableId() { return `${super.placeableId}_polygons`; }

  /** @type {PIXI.Polygon[]} */
  get _polygons() {
    const cache = this.pixelCache;
    if ( !cache ) return this.placeableDocument.shape.bounds;
    const polys = cache.getCanvasAlphaISOBands(this.alphaThreshold);
    polys.forEach(poly => poly.clean());
    return polys;
  }

  createShapes() {
    const cache = this.pixelCache;
    if ( !cache ) return super.createShapes();

    const polys = this._polygons;
    if ( !polys ) return super.createShapes();

    const elevationZ = this.elevationZ;
    const polys3d = Polygons3d.fromPolygons(polys, elevationZ);
    const opts = {
      center: this.constructor.tileCenter(this.placeableDocument),
      dims: this.constructor.tileDimensions(this.placeableDocument),
      angles: this.constructor.tileRotation(this.placeableDocument),
    };
    const shape = PlanarPolygonPrimitive.fromPolygon3d(`${this.placeableId}_alphaThresholdPolygons`, polys3d, opts);
    this.shapes.push(shape);
  }

  _update() {
    if ( this._updateFlags.texture ) this.createShapes();
    super._update();
  }
}

export class TileTrianglesGeometry extends TileFullGeometry {
  /**
   * Create an id used for the model matrix tracking.
   * @type {string}
   */
  get placeableId() { return `${super.placeableId}_triangles`; }

  /** @type {PIXI.Polygon[]} */
  get _polygons() {
    const cache = this.pixelCache;
    if ( !cache ) return this.placeableDocument.shape.bounds;
    const polys = cache.getCanvasAlphaISOBands(this.alphaThreshold);
    polys.forEach(poly => poly.clean());
    return polys;
  }

  createShapes() {
    const cache = this.pixelCache;
    if ( !cache ) return super.createShapes();

    const polys = this._polygons;
    if ( !polys ) return super.createShapes();

    this.shapes.forEach(shape => shape.destroy());
    this.shapes.length = 0;

    // Convert the polygons to top and bottom faces.
    // Then make these into triangles.
    // Trickier than leaving as polygons but can dramatically cut down the number of polys
    // for more complex shapes.
    const elevationZ = this.elevationZ;
    const { top } = Polygon3dVertices.polygonTopBottomFaces(polys, { topZ: elevationZ, bottomZ: elevationZ });

    // Trim the UVs and Normals.
    const topTrimmed = Polygon3dVertices.cutVertexData(top, { startingOffset: 3, deletionLength: 5, stride: 8 });

    // Drop any triangles that are nearly collinear or have very small areas.
    // Note: This works b/c the triangles all have z values of 0, which can be safely ignored.
    const triTop = Triangle3d
      .fromVertices(topTrimmed)
      .filter(tri => !foundry.utils.orient2dFast(tri.a, tri.b, tri.c).almostEqual(0, 1e-06));
    const shape = PlanarPolygonPrimitive.fromPolygon3d(`${this.placeableId}`, triTop);
    this.shapes.push(shape);
  }

  _update() {
    if ( this._updateFlags.texture ) this.createShapes();
    super._update();
  }
}

export class TileGeometry extends mix(Object).with(GeometrySubclassMixin, TileDocumentCalculationsMixin) {

  static SUBCLASSES = {
    full: TileFullGeometry,
    boundingRect: TileBoundingRectGeometry,
    boundingPolygon: TileBoundingPolygonGeometry,
    polygons: TilePolygonsGeometry,
    triangles: TileTrianglesGeometry,
  };

  _calculateAABB() {
    AABB3d.fromTileDocument(this.placeableDocument, this.aabb);
  }
}
