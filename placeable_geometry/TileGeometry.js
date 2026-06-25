/* globals
canvas,
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
  PlaceableFacesMixin,
  PlaceableVerticesMixin,
  QUADS,
} from "./PlaceableGeometry.js";

// Vertices
import { BasicVertices } from "../placeable_vertices/BasicVertices.js";
import { VerticesIndicesFixedLengthTrackingBuffer } from "../../geometry/placeable_tracking/TrackingBuffer.js";


// LibGeometry
import { GEOMETRY_LIB_ID } from "../const.js";
import { gridUnitsToPixels } from "../util.js";
import { AABB3d } from "../3d/AABB3d.js";
import { MatrixFloat32 } from "../Matrix.js";
import { Point3d } from "../3d/Point3d.js";
import { Quad3d, Polygon3d, Polygons3d, Triangle3d } from "../3d/Polygon3d.js";

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

  /** @type {object<Quad3d>} */
  #alphaBoundingBox = [
    new Quad3d(),
    new Quad3d(),
  ];

  /** @type {boolean} */
  #needsUpdate = true;

	update(updateKeys) {
		super.update(updateKeys);
		const KEYS = this.constructor.UPDATE_KEYS;
		this.#needsUpdate ||= updateKeys.some(key => KEYS.texture.has(key));
	}

  shapeUpdated() {
    this.#needsUpdate = true;
    super.shapeUpdated();
  }

  get alphaBoundingBox() {
    this.#updateCachedValues()
    return this.#alphaBoundingBox;
  }

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

    const rectOrPoly = cache.getThresholdCanvasBoundingBox(this.alphaThreshold).toPolygon();
    const bb = this.#alphaBoundingBox;
    const elevationZ = this.elevationZ;

		Quad3d.fromPolygon(rectOrPoly, elevationZ, bb[0]);
		Quad3d.fromPolygon(rectOrPoly, elevationZ, bb[1]);
    bb[1].reverseOrientation(); // Bottom.
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

  /** @type {Polygon3d[]} */
  #alphaBoundingPolygon = [
    new Polygon3d(),
    new Polygon3d(),
  ];

  /** @type {boolean} */
  #needsUpdate = true;

	update(updateKeys) {
		super.update(updateKeys);
		const KEYS = this.constructor.UPDATE_KEYS;
		this.#needsUpdate ||= updateKeys.some(key => KEYS.texture.has(key));
	}

  shapeUpdated() {
    this.#needsUpdate = true;
    super.shapeUpdated();
  }

  get alphaBoundingPolygon() {
    this.#updateCachedValues()
    return this.#alphaBoundingPolygon;
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
    const bp = this.#alphaBoundingPolygon;
    const elevationZ = this.elevationZ;

    Polygon3d.fromPolygon(poly, elevationZ, bp[0]);
    Polygon3d.fromPolygon(poly, elevationZ, bp[1]);
    bp[1].reverseOrientation(); // Bottom.
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

  /** @type {Polygons3d[]} */
  #alphaThresholdPolygons = [
    new Polygons3d(),
    new Polygons3d(),
  ];

  /** @type {boolean} */
  #needsUpdate = true;

  shapeUpdated() {
    this.#needsUpdate = true;
    super.shapeUpdated();
  }

  get alphaThresholdPolygons() {
    this.#updateCachedValues();
    return this.#alphaThresholdPolygons;
  }

  #updateCachedValues() {
    if ( !this.#needsUpdate ) return
    this._updatePathsToFacePolygons();
    this.#needsUpdate = false;
  }

	update(updateKeys) {
		super.update(updateKeys);
		const KEYS = this.constructor.UPDATE_KEYS;
		this.#needsUpdate ||= updateKeys.some(key => KEYS.texture.has(key));
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

    Polygons3d.fromPolygons(polys, this.elevationZ, this.#alphaThresholdPolygons[0]);
    this.#alphaThresholdPolygons[0].clone(this.#alphaThresholdPolygons[1]).reverseOrientation(); // Reverse orientation but keep the hole designations.
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
  #alphaThresholdTriangles = [
    new Polygons3d(),
    new Polygons3d(),
  ];

  /** @type {boolean} */
  #needsUpdate = true;

  shapeUpdated() {
    this.#needsUpdate = true;
    super.shapeUpdated();
  }

  get alphaThresholdTriangles() {
    this.#updateCachedValues();
    return this.#alphaThresholdTriangles;
  }

  #updateCachedValues() {
    if ( !this.#needsUpdate ) return
    this._updatePathsToFaceTriangles();
    this.#needsUpdate = false;
  }

	update(updateKeys) {
		super.update(updateKeys);
		const KEYS = this.constructor.UPDATE_KEYS;
		this.#needsUpdate ||= updateKeys.some(key => KEYS.texture.has(key));
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
    const cache = this.pixelCache;
    if ( !cache ) return;

    const polys = cache.getCanvasAlphaISOBands(this.alphaThreshold);
    if ( !polys ) return;

    // Convert the polygons to top and bottom faces.
    // Then make these into triangles.
    // Trickier than leaving as polygons but can dramatically cut down the number of polys
    // for more complex shapes.
    const elev = this.elevationZ;
    const { top, bottom } = Polygon3dVertices.polygonTopBottomFaces(polys, { topZ: elev, bottomZ: elev });

    // Trim the UVs and Normals.
    const topTrimmed = Polygon3dVertices.cutVertexData(top, { startingOffset: 3, deletionLength: 5, stride: 8 });
    const bottomTrimmed = Polygon3dVertices.cutVertexData(bottom, { startingOffset: 3, deletionLength: 5, stride: 8 });

    // Drop any triangles that are nearly collinear or have very small areas.
    // Note: This works b/c the triangles all have z values of 0, which can be safely ignored.
    const triTop = Triangle3d
      .fromVertices(topTrimmed)
      .filter(tri => !foundry.utils.orient2dFast(tri.a, tri.b, tri.c).almostEqual(0, 1e-06));
    Polygons3d.from3dPolygons(triTop, this.#alphaThresholdTriangles[0]);

    const triBottom = Triangle3d
      .fromVertices(bottomTrimmed)
      .filter(tri => !foundry.utils.orient2dFast(tri.a, tri.b, tri.c).almostEqual(0, 1e-06));
    Polygons3d.from3dPolygons(triBottom, this.#alphaThresholdTriangles[1]);

    this.#alphaThresholdTriangles[0].setZ(this.elevationZ);
    this.#alphaThresholdTriangles[1].setZ(this.elevationZ);
  }
}

/**
 * Prototype order:
 * TileGeometryTracker -> PlaceableFacesMixin -> PlaceableMatricesMixin -> PlaceableAABBMixin -> PlaceableGeometry
 */
export class TileGeometry extends mix(PlaceableGeometry).with(
  PlaceableAABBMixin, PlaceableModelMatrixMixin, PlaceableFacesMixin, PlaceableVerticesMixin,
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

  initialize() {
    this.constructor.cacheManager.cacheDocument(this.placeableDocument); // Async.
    super.initialize();
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

  // ----- NOTE: Matrices ----- //

  calculateTranslationMatrix() {
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
    const { width, height } = this.placeableDocument;
    return MatrixFloat32.scale(width, height, 1.0, mat);
  }

  // ----- NOTE: Polygon3d ---- //

  /** @type {Faces} */
  static prototypeFaces = [QUADS.up.clone(), QUADS.down.clone()];

  /**
   * Update the faces for this tile.
   * Either use pixelCache or for a basic tile, use the modelMatrix.
   */
  _updateFaces() {
    super._updateFaces();
    const top = this.faces[0];
    const bottom = this.faces[1];

    // Confirm orientation.
    const ctr = this.constructor.tileCenter(this.placeableDocument);
    const ctrTop = Point3d.tmp.set(ctr.x, ctr.y, this.elevationZ + 100);
    if ( !top.isFacing(ctrTop) ) top.reverseOrientation();

    // Create the bottom as a mirror of the top.
    top.clone(bottom);
    bottom.reverseOrientation();

    this.#updateModelVertices();
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

  // ----- NOTE: Vertices ----- //

  /**
   * Update instance vertices.
   * Add in the UVs for the tile.
   */
  static updateInstanceVertices() {
    const vo = super.updateInstanceVertices();

    // Add UVs.
    if ( vo.indices ) vo.expand(vo);
    vo.vertices = BasicVertices.appendUVs(vo.vertices, { stride: vo.stride, uvsOffset: 6 })
    vo.hasUVs = true;
    vo.condense(vo);
    return vo;
  }

  /**
   * Store the vertices for every tile.
   */
  static _viTracker;

  static get viTracker()  {
    if ( !this._viTracker ) {
      const stride = 8; // Stride = position + normals + uv
      const initialMaxFacets = canvas.scene.tiles.size;

      // For tiles, the instance vertices and indices match the model.
      const vo = this.instanceVO;
      const verticesFacetLengths = vo.vertices.length;
      const indicesFacetLengths = vo.indices.length;
      this._viTracker = new VerticesIndicesFixedLengthTrackingBuffer({
        stride,
        numFacets: 0,
        verticesFacetLengths,
        indicesFacetLengths,
        initialMaxFacets
      });
    }
    return this._viTracker;
  }

  /**
   * Vertices with normals and indices.
   * @type {object<VertexObject>}
   */
  _modelVO;

  get modelVO() {
    const vo = this._modelVO ||= this.#createModelVO();

    // Update the vertices and indices.
    // Must do this each time b/c additions or subtractions may have modified the tracker buffer.
    const { vertices, indices } = this.constructor.viTracker.viewFacetById(this.placeableId);
    vo.vertices = vertices;
    vo.indices = indices;
    return vo;
  }

  /**
   * Create the model VO.
   * Basic tiles are all the same shape: quad.
   */
  #createModelVO() {
    // Basic tiles can be instanced, so can just transform the instanceVO to a modelVO.
    const vo = this.constructor.instanceVO.transformToModel(this.modelMatrix.model);
    this.constructor.viTracker.addFacet({ id: this.placeableId, newVertices: vo.vertices, newIndices: vo.indices } );
    return vo;
  }

  /**
   * Update the model vertices for this placeable.
   * Default approach transforms them using the model matrix.
   * Alternatively, could use the faces.
   */
  #updateModelVertices() {
    // Uses the existing instance vertices and the model matrix.
    // Just like transforming prototype faces to model faces.
    this.constructor.instanceVO.transformToModel(this.modelMatrix.model, this.modelVO);
  }

  destroy() {
    this.constructor.viTracker.deleteFacet(this.placeableId);
    this._modelVO = null;
    this.modelMatrix = null;
    super.destroy();
  }

  // ----- NOTE: Tile characteristics ----- //

  /**
   * Determine the tile rotation.
   * @param {TileDocument} tileD
   * @returns {number}    Rotation, in radians.
   */
  static tileRotation(tileD) { return Math.toRadians(tileD.rotation); }

  /**
   * Determine the center of the tile, in pixel units.
   * @param {TileDocument} tileD
   * @returns {Point3d}
   */
  static tileCenter(tileD) {
    const { x, y, width, height, texture } = tileD;
    const anchorX = texture?.anchorX ?? 0.5;
    const anchorY = texture?.anchorY ?? 0.5;

    // Shift TL by the difference between the center (0.5) and the anchor position.
    return PIXI.Point.tmp.set(
      x + (width * (0.5 - anchorX)),
      y + (height * (0.5 - anchorY)),
    );
  }
}
