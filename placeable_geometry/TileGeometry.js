/* globals
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Mixing
import { mix } from "../mixwith.js";

// Geometry
import { PlaceableGeometry } from "./PlaceableGeometry.js";
import { QuadPrimitive, TexturedQuadPrimitive } from "./InstancedGeometricPrimitive.js";
import { PlanarPolygonPrimitive } from "./ModelGeometricPrimitive.js";

// LibGeometry
import { GEOMETRY_LIB_ID } from "../const.js";
import { gridUnitsToPixels } from "../util.js";
import { AABB3d } from "../3d/AABB3d.js";
import { Point3d } from "../3d/Point3d.js";
import { Segment } from "../Segment.js";
import { Polygon3d, Polygons3d, Triangle3d } from "../3d/Polygon3d.js";

// Tile alpha bounds
import { Polygon3dVertices } from "../placeable_vertices/BasicVertices.js";

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
 * @typedef {function} TileAlphaBoundingBoxMixin
 *
 * Add faces for the tile alpha bounding rectangle.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
// NOTE: TileAlphaBoundingBoxMixin
const TileAlphaBoundingBoxMixin = superclass => class extends superclass {

  /** @type {object<GeometricPrimitive[]>} */
  #alphaBoundingBoxShapes = [];

  /** @type {boolean} */
  #needsUpdate = true;

  _update() {
    this.#needsUpdate ||= Object.values(this._updateFlags).some(value => Boolean(value));
    super._update();
  }

  get alphaBoundingBoxShapes() {
    this.#updateCachedValues()
    return this.#alphaBoundingBoxShapes;
  }

  get alphaBoundingBoxShape() { return this.alphaBoundingBoxShapes()[0]; }

  #updateCachedValues() {
    if ( !this.#needsUpdate ) return
    this._updateAlphaBoundingBox();
    this.#needsUpdate = false;
  }

  /**
   * Convert polygon or rectangle representing a tile shape to top and bottom faces.
   * Bottom faces have opposite orientation.
   */
  _updateAlphaBoundingBox() {
    const cache = this.pixelCache;
    if ( !cache ) return;

    // TODO: Cache updating.
    this.#alphaBoundingBoxShapes.forEach(shape => shape.destroy());
    this.#alphaBoundingBoxShapes.length = 0;

    const rectOrPoly = cache.getThresholdCanvasBoundingBox(this.alphaThreshold);
    const elevationZ = this.elevationZ;
    const center2d = rectOrPoly.center;

    const shape = new QuadPrimitive(`${this.placeableId}_alphaBoundingBox`);
    shape.initialize();
    using ctr = Point3d.tmp.set(
      center2d.x,
      center2d.y,
      elevationZ,
    );
    shape.setPosition(ctr);

    if ( rectOrPoly instanceof PIXI.Polygon ) {
      // Determine the rotation angle of the box.
      const iter = rectOrPoly.iteratePoints();
      const a = iter.next().value;
      const b = iter.next().value;
      const c = iter.next().value;
      using s0 = new Segment(a, b);
      using s1 = new Segment(b, c);
      shape.setRotation({ x: 0, y: 0, z: s0.angleXY });
      shape.setScale({ x: s0.length, y: s1.length, z: 1 });
    } else { // Rectangle; no rotation.
      shape.setScale({ x: rectOrPoly.width, y: rectOrPoly.height, z: 1 });
    }
    this.#alphaBoundingBoxShapes.push(shape);
  }
}

/**
 * @typedef {function} TileAlphaBoundingPolygonMixin
 *
 * Add faces for the tile alpha bounding polygon.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
// NOTE: TileAlphaBoundingPolygonMixin
const TileAlphaBoundingPolygonMixin = superclass => class extends superclass {

  /** @type {object<GeometricPrimitive[]>} */
  #alphaBoundingPolygonShapes = [];

  /** @type {boolean} */
  #needsUpdate = true;

	_update() {
    this.#needsUpdate ||= Object.values(this._updateFlags).some(value => Boolean(value));
    super._update();
  }

  get alphaBoundingPolygonShapes() {
    this.#updateCachedValues()
    return this.#alphaBoundingPolygonShapes;
  }

  #updateCachedValues() {
    if ( !this.#needsUpdate ) return
    this._updateAlphaBoundingPolygon();
    this.#needsUpdate = false;
  }

  /**
   * Convert polygon representing a tile shape to top and bottom faces.
   * Bottom faces have opposite orientation.
   */
  _updateAlphaBoundingPolygon() {
    const cache = this.pixelCache;
    if ( !cache ) return;

    const poly = cache.getThresholdCanvasBoundingPolygon(this.alphaThreshold);
    const elevationZ = this.elevationZ;

    const poly3d = Polygon3d.fromPolygon(poly, elevationZ);
    const shape = PlanarPolygonPrimitive.fromPolygon3d(`${this.placeableId}_alphaBoundingPolygon`, poly3d);
    this.#alphaBoundingPolygonShapes.push(shape);
  }
}

/**
 * @typedef {function} TileAlphaPolygonsMixin
 *
 * Add faces for the tile alpha polygons.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
// NOTE: TileAlphaPolygonsMixin
const TileAlphaPolygonsMixin = superclass => class extends superclass {

  /** @type {object<GeometricPrimitive[]>} */
  #alphaThresholdPolygonShapes = [];

  /** @type {boolean} */
  #needsUpdate = true;

	_update() {
    this.#needsUpdate ||= Object.values(this._updateFlags).some(value => Boolean(value));
    super._update();
  }

  get alphaThresholdPolygonShapes() {
    this.#updateCachedValues();
    return this.#alphaThresholdPolygonShapes;
  }

  #updateCachedValues() {
    if ( !this.#needsUpdate ) return
    this._updatePathsToFacePolygons();
    this.#needsUpdate = false;
  }



  /**
   * Convert clipper paths representing a tile shape to top and bottom faces.
   * Bottom faces have opposite orientation.
   */
  _updatePathsToFacePolygons() {
    const cache = this.pixelCache;
    if ( !cache ) return;

    const polys = cache.getCanvasAlphaISOBands(this.alphaThreshold);
    if ( !polys ) return;

    const polys3d = Polygons3d.fromPolygons(polys, this.elevationZ);
    const shape = PlanarPolygonPrimitive.fromPolygon3d(`${this.placeableId}_alphaThresholdPolygons`, polys3d);
    this.#alphaThresholdPolygonShapes.push(shape);
  }
}

/**
 * @typedef {function} TileAlphaTrianglesMixin
 *
 * Add faces for the tile alpha triangles.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
// NOTE: TileAlphaTrianglesMixin
const TileAlphaTrianglesMixin = superclass => class extends superclass {

  /** @type {Polygons3d[]} */
  #alphaThresholdTriangleShapes = [];

  /** @type {boolean} */
  #needsUpdate = true;

  get alphaThresholdTriangleShapes() {
    this.#updateCachedValues();
    return this.#alphaThresholdTriangleShapes;
  }

  #updateCachedValues() {
    if ( !this.#needsUpdate ) return
    this._updatePathsToFaceTriangles();
    this.#needsUpdate = false;
  }

	_update() {
    this.#needsUpdate ||= Object.values(this._updateFlags).some(value => Boolean(value));
    super._update();
  }

  /**
   * Triangulate an array of polygons or clipper paths, then convert into 3d face triangles.
   * Both top and bottom faces.
   * @param {PIXI.Polygon|ClipperPaths} polys
   * @returns {Triangle3d[]}
   */
  _updatePathsToFaceTriangles() {
    // TODO: Fix. Need to convert multiple polygons with holes to triangles.
    console.error("Not yet implemented.")
    const cache = this.pixelCache;
    if ( !cache ) return;

    const polys = cache.getCanvasAlphaISOBands(this.alphaThreshold);
    if ( !polys ) return;

    // Convert the polygons to top and bottom faces.
    // Then make these into triangles.
    // Trickier than leaving as polygons but can dramatically cut down the number of polys
    // for more complex shapes.
    const elev = this.elevationZ;
    const { top } = Polygon3dVertices.polygonTopBottomFaces(polys, { topZ: elev, bottomZ: elev });

    // Trim the UVs and Normals.
    const topTrimmed = Polygon3dVertices.cutVertexData(top, { startingOffset: 3, deletionLength: 5, stride: 8 });

    // Drop any triangles that are nearly collinear or have very small areas.
    // Note: This works b/c the triangles all have z values of 0, which can be safely ignored.
    const triTop = Triangle3d
      .fromVertices(topTrimmed)
      .filter(tri => !foundry.utils.orient2dFast(tri.a, tri.b, tri.c).almostEqual(0, 1e-06));
    const shape = PlanarPolygonPrimitive.fromPolygon3d(`${this.placeableId}_alphaThresholdTriangles`, triTop);
    this.#alphaThresholdTriangleShapes.push(shape);
  }
}

/**
 * Prototype order:
 * TileGeometryTracker -> PlaceableFacesMixin -> PlaceableMatricesMixin -> PlaceableAABBMixin -> PlaceableGeometry
 */
export class TileGeometry extends mix(PlaceableGeometry).with(
  TileAlphaBoundingBoxMixin, TileAlphaBoundingPolygonMixin, TileAlphaPolygonsMixin, TileAlphaTrianglesMixin) {

  /** @type {string} */
  static PLACEABLE_NAME = "Tile";

  /** @type {string} */
  static LAYER = "tiles";

  static TRACKER_TYPES = TRACKER_TYPES;

  static UPDATE_KEYS = {
    ...super.UPDATE_KEYS,
    properties: new Set(TRACKER_TYPES.texture),
    level: new Set(TRACKER_TYPES.level),
    position2d: new Set(TRACKER_TYPES.position2d),
    elevation: new Set(TRACKER_TYPES.elevation),
    scale: new Set(TRACKER_TYPES.scale),
    rotation: new Set(TRACKER_TYPES.rotation),
  };

  get tile() { return this.placeableDocument.object; }

  get alphaThreshold() { return this.placeableDocument.texture.alphaThreshold || 0; }

  get pixelCache() { return this.constructor.cacheManager.pixelCacheForDocument(this.placeableDocument); }

  get elevationZ() { return gridUnitsToPixels(this.placeableDocument.elevation); }

  static get cacheManager() { return CONFIG[GEOMETRY_LIB_ID].tilePixelCache; }

  get shape() { return this.shapes[0]; } // Tiles currently always only using a single shape.

  initialize() {
    this.constructor.cacheManager.cacheDocument(this.placeableDocument); // Async.
    this.createShapes();
    super.initialize();
  }

  createShapes() {
    this.shapes.forEach(shape => shape.destroy());
    this.shapes.length = 0;
    this.shapes.push(new TexturedQuadPrimitive(this.placeableId));
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
      this.shape.setScale(angles);
    }

    if ( this._updateFlags.scale ) {
      const dims = this.constructor.tileDimensions(this.placeableDocument);
      this.shape.setScale(dims);
    }
    super._update();
  }

  // ----- NOTE: AABB ----- //
  calculateAABB() {
    const cache = this.pixelCache;
    if ( cache ) {
      const bbox = cache.getThresholdCanvasBoundingBox(this.alphaThreshold);
      if ( bbox instanceof PIXI.Polygon ) AABB3d.fromPolygon(bbox, this.elevationZ, this.aabb);
      else AABB3d.fromRectangle(bbox, this.elevationZ, this.aabb);

    // Fall back on tile dimensions instead of alpha dimensions.
    } else AABB3d.fromTileDocument(this.placeableDocument, this.aabb);
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

  // ----- NOTE: Tile characteristics ----- //

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
  static tileDimensions(tileD) {
    return Point3d.tmp.set(tileD.width, tileD.height, 1);
  }
}
