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

export class TileGeometry {
  /** @type {string} */
  static PLACEABLE_NAME = "Tile";

  /** @type {string} */
  static LAYER = "tiles";

  /**
   * Full tile, no alpha
   * @type {TileFullGeometry}
   */
  #full;

  get full() {
    if ( !this.#full ) {
      this.#full = new TileGeometry(this.placeableDocument);
      this.#full.initialize();
      this.#full.forceUpdate();
    }
    return this.#full;
  };

  /**
   * Alpha tile, bounding box
   * @type {TileBoundingRectGeometry}
   */
  #boundingRect;

  get boundingRect() {
    if ( !this.#boundingRect ) {
      this.#boundingRect = new TileBoundingRectGeometry(this.placeableDocument);
      this.#boundingRect.initialize();
      this.#boundingRect.forceUpdate();
    }
    return this.#boundingRect;
  };

  /**
   * Alpha tile, bounding polygon
   * @type {TileBoundingPolygonGeometry}
   */
  #boundingPolygon;

  get boundingPolygon() {
    if ( !this.#boundingPolygon ) {
      this.#boundingPolygon = new TileBoundingPolygonGeometry(this.placeableDocument);
      this.#boundingPolygon.initialize();
      this.#boundingPolygon.forceUpdate();
    }
    return this.#boundingPolygon;
  };

  /**
   * Alpha tile, polygons to model alpha holes.
   * @type {TilePolygonsGeometry}
   */
  #polygons;

  get polygons() {
    if ( !this.#polygons ) {
      this.#polygons = new TileBoundingPolygonGeometry(this.placeableDocument);
      this.#polygons.initialize();
      this.#polygons.forceUpdate();
    }
    return this.#polygons;
  };

  /**
   * Alpha tile, triangles to model alpha holes.
   * @type {TileTrianglesGeometry}
   */
  #triangles;

  get triangles() {
    if ( !this.#triangles ) {
      this.#triangles = new TileBoundingPolygonGeometry(this.placeableDocument);
      this.#triangles.initialize();
      this.#triangles.forceUpdate();
    }
    return this.#triangles;
  };

  /** @type {CanvasDocument} */
  placeableDocument;

  /**
   * @param {CanvasDocument} placeable
   */
  constructor(placeableDocument) {
    this.placeableDocument = placeableDocument;
  }

  #iterateGeometries(methodName, ...args) {
    if ( this.#full ) this.#full[methodName](...args);
    if ( this.#boundingRect ) this.#boundingRect[methodName](...args);
    if ( this.#boundingPolygon ) this.#boundingPolygon[methodName](...args);
    if ( this.#polygons ) this.#polygons[methodName](...args);
    if ( this.#triangles ) this.#triangles[methodName](...args);
  }

  initialize() { this.#iterateGeometries("initialize"); }

  destroy() {
    this.#iterateGeometries("destroy");
    this.#full = null;
    this.#boundingRect = null;
    this.#boundingPolygon = null;
    this.#polygons = null;
    this.#triangles = null;
  }

  update(updateKeys, opts) {  this.#iterateGeometries("update", updateKeys, opts); }

  forceUpdate() {  this.#iterateGeometries("forceUpdate"); }

  // ----- NOTE: AABB ----- //

  // AABB required for Quadtree.
  aabb = new AABB3d();

  calculateAABB() {
    this.#iterateGeometries("calculateAABB");
    if ( !this.#full ) AABB3d.fromTileDocument(this.placeableDocument, this.aabb);
    else AABB3d.copyFrom(this.#full.aabb);
  }

  /*
  Other calculations are handled only by the sub-geometries, including:
  - shape iteration
  - face iteration
  - intersection
  - drawing
  - face points
  - internal points
  */
}

export class TileFullGeometry extends PlaceableGeometry {
  /** @type {string} */
  static PLACEABLE_NAME = "Tile";

  /** @type {string} */
  static LAYER = "tiles";

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

  // ----- NOTE: Tile characteristics ----- //

  /**
   * Finite elevation of a tile.
   * @param {PlaceableDocument} placeableD
   * @returns {number}
   */
  get elevationZ() {
    return this.placeableDocument.elevationZ; // Tiles are always finite elevation.
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
}

export class TileBoundingRectGeometry extends TileFullGeometry {

  /**
   * Create an id used for the model matrix tracking.
   * @type {string}
   */
  get placeableId() { return `${super.placeableId}_boundingRect`; }

  createShapes() {
    const cache = this.pixelCache;
    if ( !cache ) return super.createShapes();

    this.shapes.forEach(shape => shape.destroy());
    this.shapes.length = 0;

    const poly = cache.getThresholdCanvasBoundingPolygon(this.alphaThreshold);
    const elevationZ = this.elevationZ;
    const poly3d = Polygon3d.fromPolygon(poly, elevationZ);
    this.shapes.push(PlanarPolygonPrimitive.fromPolygon3d(`${this.placeableId}`, poly3d));
  }

}

export class TileBoundingPolygonGeometry extends TileFullGeometry {
  /**
   * Create an id used for the model matrix tracking.
   * @type {string}
   */
  get placeableId() { return `${super.placeableId}_boundingPolygon`; }

  createShapes() {
    const cache = this.pixelCache;
    if ( !cache ) return super.createShapes();

    this.shapes.forEach(shape => shape.destroy());
    this.shapes.length = 0;

    const rectOrPoly = cache.getThresholdCanvasBoundingBox(this.alphaThreshold);
    const elevationZ = this.elevationZ;
    const center2d = rectOrPoly.center;

    const shape = new QuadPrimitive(`${this.placeableId}`);
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
    this.shapes.push(shape);
  }
}

export class TilePolygonsGeometry extends TileFullGeometry {
  /**
   * Create an id used for the model matrix tracking.
   * @type {string}
   */
  get placeableId() { return `${super.placeableId}_polygons`; }

  createShapes() {
    const cache = this.pixelCache;
    if ( !cache ) return super.createShapes();

    const polys = cache.getCanvasAlphaISOBands(this.alphaThreshold);
    if ( !polys ) return super.createShapes();

    const elevationZ = this.elevationZ;
    const polys3d = Polygons3d.fromPolygons(polys, elevationZ);
    const shape = PlanarPolygonPrimitive.fromPolygon3d(`${this.placeableId}_alphaThresholdPolygons`, polys3d);
    this.shapes.push(shape);
  }
}

export class TileTrianglesGeometry extends TileFullGeometry {
  /**
   * Create an id used for the model matrix tracking.
   * @type {string}
   */
  get placeableId() { return `${super.placeableId}_triangles`; }

  createShapes() {
    const cache = this.pixelCache;
    if ( !cache ) return super.createShapes();

    const polys = cache.getCanvasAlphaISOBands(this.alphaThreshold);
    if ( !polys ) return super.createShapes();

    this.shapes.forEach(shape => shape.destroy());
    this.shapes.length = 0;

    // TODO: Fix. Need to convert multiple polygons with holes to triangles.
    console.error("Not yet implemented.");
    return super.createShapes();

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
}
