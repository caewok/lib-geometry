/* globals
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
import { AABB3d } from "../3d/AABB3d.js";
import { MatrixFloat32 } from "../Matrix.js";
import { Point3d } from "../3d/Point3d.js";
import { Quad3d, Polygon3d, Polygons3d, Triangle3d } from "../3d/Polygon3d.js";
import { FixedLengthTrackingBuffer } from "../placeable_tracking/TrackingBuffer.js";


// Tile alpha bounds
import { Polygon3dVertices } from "../placeable_vertices/BasicVertices.js";

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
  texturePosition: [
    "texture.anchorX",
    "texture.anchorY",
    "texture.fit",
    "texture.fill",
    "texture.offsetX",
    "texture.offsetY",
    "texture.rotation",
    "texture.scaleX",
    "texture.scaleY",

  ],
  texture: [
    "texture.alphaThreshold",
    "texture.src",
  ],
};
 
/**
 * @typedef {function} TileAlphaBoundingBoxMixin
 *
 * Add faces for the tile alpha bounding rectangle.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
const TileAlphaBoundingBoxMixin = superclass => class extends superclass {

  /** @type {object<Quad3d|Polygon3d>} */
  #alphaBoundingBox = {
    top: new Quad3d(),
    bottom: new Quad3d(),
  };
  
  /** @type {boolean} */
  #needsUpdate = true;

	update(updateKeys) {
		super.update(updateKeys);
		const KEYS = this.constructor.UPDATE_KEYS;
		this.#needsUpdate ||= updateKeys.some(key => KEYS.texturePosition.has(key))
		  || updateKeys.some(key => KEYS.texture.has(key));
	}

  shapeUpdated() {
    this.#needsUpdate = true;
    super.shapeUpdated();
  }
  
  get alphaBoundingBox() {
    if ( this.#needsUpdate ) {
      this._updateAlphaBoundingBox();
      this.#needsUpdate = false;
    }
    return this.#alphaBoundingBox;
  }

  /**
   * Convert polygon or rectangle representing a tile shape to top and bottom faces.
   * Bottom faces have opposite orientation.
   */
  _updateAlphaBoundingBox() {
    const rectOrPoly = this.tile.evPixelCache.getThresholdCanvasBoundingBox(this.alphaThreshold).toPolygon();
    const bb = this.#alphaBoundingBox;
    const elevationZ = this.tile.elevationZ
        
		Quad3d.fromPolygon(rectOrPoly, elevationZ, bb.top);
		Quad3d.fromPolygon(rectOrPoly, elevationZ, bb.bottom);
    bb.bottom.reverseOrientation();
  }
} 
 
/**
 * @typedef {function} TileAlphaBoundingPolygonMixin
 *
 * Add faces for the tile alpha bounding polygon.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */ 
const TileAlphaBoundingPolygonMixin = superclass => class extends superclass {

  /** @type {object<Polygon3d>} */
  #alphaBoundingPolygon = {
    top: new Polygon3d(),
    bottom: new Polygon3d(),
  };
  
  /** @type {boolean} */
  #needsUpdate = true;

	update(updateKeys) {
		super.update(updateKeys);
		const KEYS = this.constructor.UPDATE_KEYS;
		this.#needsUpdate ||= updateKeys.some(key => KEYS.texturePosition.has(key))
		  || updateKeys.some(key => KEYS.texture.has(key));
	}

  shapeUpdated() {
    this.#needsUpdate = true;
    super.shapeUpdated();
  }
  
  get alphaBoundingPolygon() {
    if ( this.#needsUpdate ) {
      this._updateAlphaBoundingPolygon();
      this.#needsUpdate = false;
    }
    return this.#alphaBoundingPolygon;
  }

  /**
   * Convert polygon representing a tile shape to top and bottom faces.
   * Bottom faces have opposite orientation.
   */
  _updateAlphaBoundingPolygon() {
    const poly = this.tile.evPixelCache.getThresholdCanvasBoundingPolygon(this.alphaThreshold);
    const bp = this.#alphaBoundingPolygon;
    const elevationZ = this.tile.elevationZ;
            
    Polygon3d.fromPolygon(poly, elevationZ, bp.top);
    Polygon3d.fromPolygon(poly, elevationZ, bp.bottom);
    bp.bottom.reverseOrientation();
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
  #alphaThresholdPolygons = {
    top: new Polygons3d(),
    bottom: new Polygons3d(),
  };
  
  /** @type {boolean} */
  #needsUpdate = true;

  shapeUpdated() {
    this.#needsUpdate = true;
    super.shapeUpdated();
  }
  
  get alphaThresholdPolygons() {
    if ( this.#needsUpdate ) {
      this._updatePathsToFacePolygons();
      this.#needsUpdate = false;
    }
    return this.#alphaThresholdPolygons;
  }

	update(updateKeys) {
		super.update(updateKeys);
		const KEYS = this.constructor.UPDATE_KEYS;
		this.#needsUpdate ||= updateKeys.some(key => KEYS.texturePosition.has(key))
		  || updateKeys.some(key => KEYS.texture.has(key));
	}

  /**
   * Convert clipper paths representing a tile shape to top and bottom faces.
   * Bottom faces have opposite orientation.
   */
  _updatePathsToFacePolygons() {
    const polys = this.tile.evPixelCache.getCanvasAlphaISOBands(this.alphaThreshold);
    if ( !polys ) return;
    
    Polygons3d.fromPolygons(polys, this.tile.elevationZ, this.#alphaThresholdPolygons.top);
    this.#alphaThresholdPolygons.top.clone(this.#alphaThresholdPolygons.bottom).reverseOrientation(); // Reverse orientation but keep the hole designations.
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
  #alphaThresholdTriangles = {
    top: new Polygons3d(),
    bottom: new Polygons3d(),
  };
  
  /** @type {boolean} */
  #needsUpdate = true;

  shapeUpdated() {
    this.#needsUpdate = true;
    super.shapeUpdated(); 
  }
  
  get alphaThresholdTriangles() {
    if ( this.#needsUpdate ) {
      this._updatePathsToFaceTriangles();
      this.#needsUpdate = false;
    }
    return this.#alphaThresholdTriangles;
  }

	update(updateKeys) {
		super.update(updateKeys);
		const KEYS = this.constructor.UPDATE_KEYS;
		this.#needsUpdate ||= updateKeys.some(key => KEYS.texturePosition.has(key))
		  || updateKeys.some(key => KEYS.texture.has(key));
	}

  /**
   * Triangulate an array of polygons or clipper paths, then convert into 3d face triangles.
   * Both top and bottom faces.
   * @param {PIXI.Polygon|ClipperPaths} polys
   * @returns {Triangle3d[]}
   */
  _updatePathsToFaceTriangles() {
    // TODO: Fix. Need to convert multiply polygons with holes to triangles.
    console.error("Not yet implemented.")
  
    const polys = this.tile.evPixelCache.getCanvasAlphaISOBands(this.alphaThreshold);
    if ( !polys ) return;
    
    // Convert the polygons to top and bottom faces.
    // Then make these into triangles.
    // Trickier than leaving as polygons but can dramatically cut down the number of polys
    // for more complex shapes.
    const elev = this.placeable.elevationZ;
    const { top, bottom } = Polygon3dVertices.polygonTopBottomFaces(polys, { topZ: elev, bottomZ: elev });

    // Trim the UVs and Normals.
    const topTrimmed = Polygon3dVertices.cutVertexData(top, { startingOffset: 3, deletionLength: 5, stride: 8 });
    const bottomTrimmed = Polygon3dVertices.cutVertexData(bottom, { startingOffset: 3, deletionLength: 5, stride: 8 });

    // Drop any triangles that are nearly collinear or have very small areas.
    // Note: This works b/c the triangles all have z values of 0, which can be safely ignored.
    const triTop = Triangle3d
      .fromVertices(topTrimmed)
      .filter(tri => !foundry.utils.orient2dFast(tri.a, tri.b, tri.c).almostEqual(0, 1e-06));
    Polygons3d.from3dPolygons(triTop, this.#alphaThresholdTriangles.top);
      
    const triBottom = Triangle3d
      .fromVertices(bottomTrimmed)
      .filter(tri => !foundry.utils.orient2dFast(tri.a, tri.b, tri.c).almostEqual(0, 1e-06));
    Polygons3d.from3dPolygons(triBottom, this.#alphaThresholdTriangles.bottom);

    this.#alphaThresholdTriangles.top.setZ(this.tile.elevationZ);
    this.#alphaThresholdTriangles.bottom.setZ(this.tile.elevationZ);
  }
}

/**
 * Prototype order:
 * TileGeometryTracker -> PlaceableFacesMixin -> PlaceableMatricesMixin -> PlaceableAABBMixin -> PlaceableGeometry
 */
export class TileGeometry extends mix(PlaceableGeometry).with(
  PlaceableAABBMixin, PlaceableModelMatrixMixin, PlaceableFacesMixin, 
  TileAlphaBoundingBoxMixin, TileAlphaBoundingPolygonMixin, TileAlphaPolygonsMixin, TileAlphaTrianglesMixin) {
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
    texture: new Set(TRACKER_TYPES.texture),
    texturePosition: new Set(TRACKER_TYPES.texturePosition),
  };

  get tile() { return this.placeable; }

  get alphaThreshold() { return this.tile.document.texture.alphaThreshold || 0; }
  
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
    super._updateFaces();
    
    // Confirm orientation.
    const tile = this.tile;
    const ctr = this.tile.center;
    const ctrTop = Point3d.tmp.set(ctr.x, ctr.y, tile.elevationZ + 100);
    if ( !this.faces.top.isFacing(ctrTop) ) this.faces.top.reverseOrientation();

    // Create the bottom as a mirror of the top.
    this.faces.top.clone(this.faces.bottom);
    this.faces.bottom.reverseOrientation();
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
  static rayIntersectionForFace(face, rayOrigin, rayDirection, { alphaThreshold, ...opts } = {}) {
    const t = super.rayIntersectionForFace(face, rayOrigin, rayDirection, opts);
    if ( t === null ) return null;

    // Hits the tile border.
    alphaThreshold ??= this.alphaThreshold;
    if ( !(alphaThreshold && this.tile.evPixelCache) ) return t;

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
