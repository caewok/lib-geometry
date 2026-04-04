/* globals
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Mixing
import { mix } from "../mixwith.js";
import {
  PlaceableGeometry,
  PlaceableAABBMixin,
  PlaceableModelMatrixMixin,
  PlaceableFacesMixin
} from "./PlaceableGeometry.js";

// LibGeometry
import { NULL_SET } from "../util.js";
import { GEOMETRY_LIB_ID } from "../const.js";
import { AABB3d } from "../3d/AABB3d.js";
import { MatrixFloat32 } from "../Matrix.js";
import { Point3d } from "../3d/Point3d.js";
import { Quad3d, Polygon3d, Polygons3d, Triangle3d } from "../3d/Polygon3d.js";

// Tile alpha bounds
import { Polygon3dVertices } from "../placeable_vertices/BasicVertices.js";
import * as MarchingSquares from "./marchingsquares-esm.js";

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

const AbstractTileAlpha = superclass => class extends superclass {
  /**
   * Representation of the tile alpha iso bands as polygons in tile local pixel space.
   * @type {ClipperPaths|Clipper2Paths}
   */
  #alphaThresholdPaths;

  /** @type {ClipperPaths|Clipper2Paths} */
  alphaThresholdPathsCanvas;

  shapeUpdated() {
    super.shapeUpdated();
    this.#alphaThresholdPaths = this.convertTileToIsoBands();
  }

  alphaThresholdUpdated() {
    this.#alphaThresholdPaths = this.convertTileToIsoBands();
  }

  _placeableUpdated() {
    super._placeableUpdated();

    // Convert alpha threshold paths from local to canvas space.
    // Uses the evPixelCache matrix to do the transform.
    const paths = this.#alphaThresholdPaths;
    const pixelCache = this.tile.evPixelCache;
    if ( !(paths && pixelCache) ) return;
    this.alphaThresholdPathsCanvas = paths.transform(pixelCache.toCanvasTransform);
  }

  /**
   * For a given tile, convert its pixels to an array of polygon isobands representing
   * alpha values at or above the threshold. E.g., alpha between 0.75 and 1.
   * @param {Tile} tile
   * @returns {ClipperPaths|null} The polygon paths or, if error, the local alpha bounding box.
   *   Coordinates returned are local to the tile pixels, between 0 and width/height of the tile pixels.
   *   Null is returned if no alpha threshold is set or no evPixelCache is defined.
   */
  convertTileToIsoBands() {
    const { tile, alphaThreshold } = this;
    if ( !(alphaThreshold && tile.evPixelCache) ) return null;
    const cache = tile.evPixelCache;
    const threshold = 255 * alphaThreshold;
    const pixels = cache.pixels;
    const ClipperPaths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths;

    // Convert pixels to isobands.
    const width = cache.bufferWidth;
    const height = cache.bufferHeight;
    const rowViews = new Array(height);
    for ( let r = 0, start = 0, rMax = height; r < rMax; r += 1, start += width ) {
      // TODO: Use single Typed view instead of slicing?
      rowViews[r] = pixels.slice(start, start + width);
    }

    let bands;
    try {
      bands = MarchingSquares.isoBands(rowViews, threshold, 256 - threshold);
    } catch ( err ) {
      console.error(err);
      const poly = cache.getThresholdLocalBoundingBox(alphaThreshold).toPolygon();
      return ClipperPaths.fromPolygons([poly]);
    }

    /* Don't want to scale between 0 and 1 b/c using evPixelCache transform on the local coordinates.
    // Create polygons scaled between 0 and 1, based on width and height.
    const invWidth = 1 / width;
    const invHeight = 1 / height;
    const nPolys = lines.length;
    const polys = new Array(nPolys);
    for ( let i = 0; i < nPolys; i += 1 ) {
      polys[i] = new PIXI.Polygon(bands[i].flatMap(pt => [pt[0] * invWidth, pt[1] * invHeight]))
    }
    */
    const nPolys = bands.length;
    const polys = new Array(nPolys);
    for ( let i = 0; i < nPolys; i += 1 ) {
      const poly = new PIXI.Polygon(bands[i].flatMap(pt => pt)); // TODO: Can we lose the flatMap?

      // Polys from MarchingSquares are CW if hole; reverse
      poly.reverseOrientation();
      polys[i] = poly;
    }

    // Use Clipper to clean the polygons. Leave as clipper paths for earcut later.
    const paths = ClipperPaths.fromPolygons(polys, { scalingFactor: 100 });
    return paths.clean().trimByArea(CONFIG[GEOMETRY_LIB_ID].CONFIG.alphaAreaThreshold ?? 25);
  }
}


/**
 * @typedef {function} TileAlphaPolygonsMixin
 *
 * Add faces for the tile alpha polygons.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
const TileAlphaPolygonsMixin = superclass => class extends superclass {

  /** @type {object<Polygons3d>} */
  alphaThresholdPolygons = {
    top: new Polygons3d(),
    bottom: new Polygons3d(),
  };

  shapeUpdated() {
    super.shapeUpdated();
    this._updatePathsToFacePolygons();
  }

  /**
   * Convert clipper paths representing a tile shape to top and bottom faces.
   * Bottom faces have opposite orientation.
   */
  _updatePathsToFacePolygons() {
    const paths = this.alphaThresholdPathsCanvas;
    if ( !paths ) return;

    this.alphaThresholdPolygons.top = Polygons3d.fromClipperPaths(paths);
    this.alphaThresholdPolygons.top.setZ(this.tile.elevationZ);
    this.alphaThresholdPolygons.bottom  = this.alphaThresholdPolygons.top.clone().reverseOrientation(); // Reverse orientation but keep the hole designations.
  }
}

/**
 * @typedef {function} TileAlphaTrianglesMixin
 *
 * Add faces for the tile alpha triangles.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
const TileAlphaTrianglesMixin = superclass => class extends superclass {

  /** @type {object<Polygons3d>} */
  alphaThresholdTriangles = {
    top: new Polygons3d(),
    bottom: new Polygons3d(),
  };

  shapeUpdated() {
    super.shapeUpdated();
    this._updatePathsToFaceTriangles();
  }

  /**
   * Triangulate an array of polygons or clipper paths, then convert into 3d face triangles.
   * Both top and bottom faces.
   * @param {PIXI.Polygon|ClipperPaths} polys
   * @returns {Triangle3d[]}
   */
  _updatePathsToFaceTriangles() {
    const paths = this.alphaThresholdPathsCanvas;
    if ( !paths ) return;

    // Convert the polygons to top and bottom faces.
    // Then make these into triangles.
    // Trickier than leaving as polygons but can dramatically cut down the number of polys
    // for more complex shapes.
    const elev = this.placeable.elevationZ;
    const { top, bottom } = Polygon3dVertices.polygonTopBottomFaces(paths, { topZ: elev, bottomZ: elev });

    // Trim the UVs and Normals.
    const topTrimmed = Polygon3dVertices.cutVertexData(top, { startingOffset: 3, deletionLength: 5, stride: 8 });
    const bottomTrimmed = Polygon3dVertices.cutVertexData(bottom, { startingOffset: 3, deletionLength: 5, stride: 8 });

    // Drop any triangles that are nearly collinear or have very small areas.
    // Note: This works b/c the triangles all have z values of 0, which can be safely ignored.
    this.alphaThresholdTriangles.top = Polygons3d.from3dPolygons(Triangle3d
      .fromVertices(topTrimmed)
      .filter(tri => !foundry.utils.orient2dFast(tri.a, tri.b, tri.c).almostEqual(0, 1e-06)));
    this.alphaThresholdTriangles.bottom = Polygons3d.from3dPolygons(Triangle3d
      .fromVertices(bottomTrimmed)
      .filter(tri => !foundry.utils.orient2dFast(tri.a, tri.b, tri.c).almostEqual(0, 1e-06)));

    this.alphaThresholdTriangles.top.setZ(this.tile.elevationZ);
    this.alphaThresholdTriangles.bottom.setZ(this.tile.elevationZ);
  }
}

/**
 * Prototype order:
 * TileGeometryTracker -> PlaceableFacesMixin -> PlaceableMatricesMixin -> PlaceableAABBMixin -> PlaceableGeometry
 */
export class TileGeometry extends mix(PlaceableGeometry).with(
  PlaceableAABBMixin, PlaceableModelMatrixMixin, PlaceableFacesMixin,
  AbstractTileAlpha, TileAlphaPolygonsMixin, TileAlphaTrianglesMixin) {
  /** @type {string} */
  static PLACEABLE_NAME = "Tile";

  /** @type {string} */
  static layer = "tiles";

  static TRACKER_TYPES = TRACKER_TYPES;

  static UPDATE_KEYS = {
    position: new Set(TRACKER_TYPES.position),
    scale: new Set(TRACKER_TYPES.scale),
    rotation: new Set(TRACKER_TYPES.rotation),
    shape: NULL_SET,
    properties: NULL_SET,
  };

  get tile() { return this.placeable; }

  get alphaThreshold() { return this.tile.document.texture.alphaThreshold || 0; }

  get useAlphaPolygonBounds() { return CONFIG[GEOMETRY_LIB_ID].CONFIG.useAlphaPolygonBounds; }


  // ----- NOTE: AABB ----- //
  calculateAABB() { return AABB3d.fromTileAlpha(this.tile, this.alphaThreshold, this.aabb); }

  // ----- NOTE: Matrices ----- //

  calculateTranslationMatrix() {
    const mat = super.calculateTranslationMatrix();
    const ctr = this.constructor.tileCenter(this.tile);
    return MatrixFloat32.translation(ctr.x, ctr.y, ctr.z, mat);
  }

  calculateRotationMatrix() {
    const mat = super.calculateRotationMatrix();
    const rot = this.constructor.tileRotation(this.tile)
    return MatrixFloat32.rotationZ(rot, true, mat);
  }

  calculateScaleMatrix() {
    const mat = super.calculateScaleMatrix();
    const { width, height } = this.tile.document;
    return MatrixFloat32.scale(width, height, 1.0, mat);
  }

  // ----- NOTE: Polygon3d ---- //

  /** @type {Faces} */
  _prototypeFaces = {
    top: new Quad3d(),
    bottom: new Quad3d(),
    sides: [],
  }

  /**
   * Create the initial face shapes for this tile, assuming a 0.5 x 0.5 flat planar rectangle.
   * Alpha bounds handled in _updateFaces.
   */
  _initializePrototypeFaces() {
    // Create the basic tile prototype face.
    this.constructor.QUADS.up.clone(this._prototypeFaces.top);
    this.constructor.QUADS.down.clone(this._prototypeFaces.bottom);
    super._initializePrototypeFaces();
  }

  /**
   * Update the faces for this tile.
   * Either use evPixelCache or for a basic tile, use the modelMatrix.
   */
  _updateFaces() {
    const tile = this.tile;
    const pixelCache = tile.evPixelCache;
    if ( !(pixelCache && this.alphaThreshold) ) {
      if ( !(this.faces.top instanceof Quad3d) ) {
        this.faces.top = new Quad3d();
        this.faces.bottom = new Quad3d();
      }
      return super._updateFaces();
    }

    const alphaBoundsFn = this.useAlphaPolygonBounds ? "getThresholdCanvasBoundingPolygon" : "getThresholdCanvasBoundingBox";
    const alphaShape = pixelCache[alphaBoundsFn](this.alphaThreshold) || tile.bounds;
    const elevZ = tile.elevationZ;
    if ( alphaShape instanceof PIXI.Polygon ) {
      if ( !(this.faces.top instanceof Polygon3d) ) {
        this.faces.top = new Polygon3d();
        this.faces.bottom = new Polygon3d();
      }
      Polygon3d.fromPolygon(alphaShape, elevZ, this.faces.top);
    } else { // Must be PIXI.Rectangle
      if ( !(this.faces.top instanceof Quad3d) ) {
        this.faces.top = new Quad3d();
        this.faces.bottom = new Quad3d();
      }
      Quad3d.fromRectangle(alphaShape, elevZ, this.faces.top);
    }

    // Confirm orientation.
    const ctr = this.tile.center;
    const ctrTop = Point3d.tmp.set(ctr.x, ctr.y, elevZ + 100);
    if ( !this.faces.top.isFacing(ctrTop) ) this.faces.top.reverseOrientation();

    // Create the bottom as a mirror of the top.
    this.faces.top.clone(this.faces.bottom);
    this.faces.bottom.reverseOrientation();
    super._updateFaces();
  }

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
  static rayIntersectionForFace(face, rayOrigin, rayDirection, opts) {
    const t = super.rayIntersectionForFace(face, rayOrigin, rayDirection, opts);
    if ( t === null ) return null;

    // Hits the tile border.
    if ( !(this.alphaThreshold && this.tile.evPixelCache) ) return t;

    // Threshold test at the intersection point.
    const pxThreshold = 255 * this.alphaThreshold;
    using projPt = Point3d.tmp;
    rayOrigin.add(rayDirection.multiplyScalar(t, projPt), projPt);
    const px = this.tile.evPixelCache.pixelAtCanvas(projPt.x, projPt.y);
    if ( px > pxThreshold ) return t;
    return null;
  }

  // ----- NOTE: Tile characteristics ----- //

  /**
   * Determine the tile rotation.
   * @param {Tile} tile
   * @returns {number}    Rotation, in radians.
   */
  static tileRotation(tile) { return Math.toRadians(tile.document.rotation); }

  /**
   * Determine the center of the tile, in pixel units.
   * @param {Tile} tile
   * @returns {Point3d}
   */
  static tileCenter(tile) {
    const ctr = tile.center;
    return Point3d.tmp.set(ctr.x, ctr.y, tile.elevationZ);
  }
}
