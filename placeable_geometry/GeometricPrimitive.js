/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_LIB_ID } from "../const.js";
import { VertexObject } from "../placeable_vertices/VertexObject.js";
import { AABB3d } from "../3d/AABB3d.js";
import { almostBetween } from "../util.js";
import { Point3d } from "../3d/Point3d.js";
import { combineTypedArrays } from "../util.js";
import { MatrixFloat32 } from "../Matrix.js";

/* Geometric Primitives

Data container: VertexObject
- Store vertices and indices.

Data container: Faces
- Can generate face points
- Ray intersection

Geometric Primitives include:
- VertexObject
- Faces
- AABB
- ModelMatrix
- Face points
- Internal Points
- Ray intersection test

Basic work flow:
0. Construct. Pass id used for tracking.

1. Initialize. Insert the instance into model matrix or vertices tracking.
- Model: Store de-scaled instance.

2. For a given primitive, one can set:
- center
- rotation
- scale

These are handled differently for the two main types: instanced and model:
- Instance: Model matrix updated, which is stored in a per-class tracker.
- Model: Local transform matrix stored for the given instance.

3. Update. Updates the shape. Must be triggered before the step #2 changes are applied.
- Instanced: Transform instance faces to model faces. No vertices changes (handle by model matrix).
- Model: Transform instance faces to model faces using the local model matrix.

4. Destroy.

Instanced Registry: 1 per geometric primitive, storing model
*/


export class GeometricPrimitive {

  static DIRTY = {
    NONE:             0,
    FACES:            1 << 0, // 1
    AABB:             1 << 1, // 2
    FACE_POINTS:      1 << 2, // 4
    INTERNAL_POINTS:  1 << 3, // 8
    VERTICES:         1 << 4, // 16
    ALL:              ~0,     // All bits set
  };


  /** @type {string} */
  id;

  /** @type {ModelMatrix} */
  modelMatrix;

  /**
   * @param {string} id       Unique string per instance; used for debugging and for child classes
   *                          to track model and vertices arrays.
   */
  constructor(id) {
    this.id = id;
  }

  #initialized = false;

  get initialized() { return this.#initialized; }

  #center = new Point3d();

  get center() {
    // Multiply the origin (0, 0, 0) by the translation to find the new center.
    return this.modelMatrix.translation.multiplyPoint3d(this.#center);
  }

  /**
   * Initialize the values for this geometric primitive.
   */
  initialize() {
    if ( this.#initialized ) this.destroy();
    this._initializeModel();
    this._initializeFaces();
    this.dirty = this.constructor.DIRTY.ALL;
    this.#initialized = true;
  }

  _initializeModel() {}

  _initializeFaces() {
    this.#faces.length = 0;
    this.constructor.prototypeFaces.forEach(f => this.#faces.push(f.clone()));
    this.dirty = this.constructor.DIRTY.FACES;
  }

  /**
   * Destroy this geometric primitive, releasing associated memory in buffers.
   */
  destroy() {
    if ( !this.#initialized ) return;
    this._destroy();
    this.#initialized = false;
  }

  _destroy() { }

  // ----- NOTE: Updating ----- //

  // Can modify the

  // TODO: Use dirty flags to limit the updating. Is this possible with the vertices, which
  // would need to also get triggered? Maybe use a forceUpdate function to handle.

  /** @type {boolean} */
  #dirtyFlags = this.constructor.DIRTY.ALL;

  get dirty() { return this.#dirtyFlags; }

  set dirty(flag) { this.#dirtyFlags |= flag; }

  isDirty(flag) { return this.#dirtyFlags & flag; }

  _clearDirty(flag) { this.#dirtyFlags &= ~flag; }

  /**
   * @type {Point3d|object} center
   */
  setPosition(center) {
    MatrixFloat32.translation(center.x, center.y, center.z, this.modelMatrix.translation);
    this.dirty = this.constructor.DIRTY.ALL;
  }

  /**
   * @type {Point3d|object} angles
   */
  setRotation(angles) {
    MatrixFloat32.rotationXYZ(angles.x, angles.y, angles.z, true, this.modelMatrix.rotation);
    this.dirty = this.constructor.DIRTY.ALL;
  }

  /**
   * @type {Point3d|object} dims
   */
  setScale(dims) {
    MatrixFloat32.scale(dims.x || 1, dims.y || 1, dims.z || 1, this.modelMatrix.scale);
    this.dirty = this.constructor.DIRTY.ALL;
  }

  // ----- NOTE: AABB ----- //

  /** @type {AABB3d} */
  #aabb = new AABB3d();

  get aabb() {
    if ( this.isDirty(this.constructor.DIRTY.AABB) ) this.calculateAABB();
    return this.#aabb;
  }

  /**
   * Method for child class to define how the AABB is defined.
   * Defaults to union of all model faces AABB.
   */
  calculateAABB() {
    AABB3d.union(this.faces.map(face => face.aabb), this.#aabb);
    this._clearDirty(this.constructor.DIRTY.AABB);
  }

  // ----- NOTE: Faces ----- //

  /** @type {Polygon3d[]} */
  static prototypeFaces = [];

  /** @type {Polygon3d[]} */
  #faces = [];

  get faces() {
    if ( this.isDirty(this.constructor.DIRTY.FACES) ) this.updateFaces();
    return this.#faces;
  }

  /**
   * Iterate over the faces.
   * @yields {Polygon3d}
   */
  *iterateFaces() {
    yield *this.faces.values();
  }

  /**
   * Update the faces for this primitive.
   * Default is to use the model matrix.
   */
  updateFaces() {
    const M = this.modelMatrix.model;
    const numSides = this.constructor.prototypeFaces.length;
    for ( let i = 0; i < numSides; i += 1 ) this.constructor.prototypeFaces[i].transform(M, this.#faces[i]);
    this._clearDirty(this.constructor.DIRTY.FACES);
  }

  // ----- NOTE: Intersection testing ----- //

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
  rayIntersection(rayOrigin, rayDirection, opts) {
    for ( const face of this.iterateFaces(opts) ) {
      const t = this.constructor.rayIntersectionForFace(face, rayOrigin, rayDirection, opts);
      if ( t !== null ) return t;
    }
    return null;
  }

  static rayIntersectionForFace(face, rayOrigin, rayDirection, { minT = 0, maxT = 1 } = {}) {
    if ( !face.isFacing(rayOrigin) ) return null;
    const t = face.intersectionT(rayOrigin, rayDirection);
    if ( t !== null && almostBetween(t, minT, maxT) ) return t;
    return null;
  }

  // ----- NOTE: Debug ----- //

  /**
   * Draw face, omitting an axis.
   */
  draw2d(opts) {
    for ( const face of this.iterateFaces() ) face.draw2d(opts);
  }

  // ----- NOTE: Vertices ----- //

  /**
   * Vertices with normals and indices.
   * @type {object<VertexObject>}
   */
  static instanceVO = new VertexObject();

  /**
   * Update instance vertices.
   * Default approach uses the prototype faces.
   */
  static updateInstanceVertices() {
    // Add vertices from faces.
    const vo = this.instanceVO ;
    const vertices = this.verticesFromFaces(this.prototypeFaces, true);
    vo.hasNormals = true;
    vo.hasUVs = false;
    this.updateVertexObject(vo, vertices);
    return vo;
  }

  /**
   * Create vertices for this placeable using its faces.
   * @param {Polygon3d[]} faces
   * @param {boolean} [addNormals=false]
   * @returns {Float32Array} The vertices
   */
  static verticesFromFaces(faces, addNormals = true) {
    // Store each Float32 array for each face separately.
    const vertices = [];
    for ( const face of faces ) vertices.push(face.toVertices({ addNormals }));

    // Combine.
    return combineTypedArrays(vertices);
  }

  /**
   * Update a vertex object in place with vertices.
   * @param {VertexObject} vo
   * @param {Float32Array} vertices
   * @returns {VertexObject} The object, for convenience
   */
  static updateVertexObject(vo, vertices) {
    vo.indices = null;
    vo.vertices = vertices;
    vo.condense(vo);
    return vo;
  }

  // ----- NOTE: Face points ----- //

  /** @typedef {Point3d[]} */
  #facePoints = [];

  get facePoints() {
    if ( this.isDirty(this.constructor.DIRTY.FACE_POINTS) ) this.generateFacePoints();
    return this.#facePoints;
  }

  /**
   * For each face, generate points encompassed by its surface.
   */
  generateFacePoints() {
    const opts = { spacing: CONFIG[GEOMETRY_LIB_ID].CONFIG.perPixelSpacing || 10, startAtEdge: false };
    const faces = this.faces;
    const numSides = faces.length;
    this.facePoints.length = numSides;
    for ( let i = 0; i < numSides; i += 1 ) this.#facePoints[i] = faces[i].pointsLattice(opts);
  }

  // ----- NOTE: Internal points ----- //

  // See ViewerLOS

  /** @type {enum<number>} */
  static POINT_INDICES = {
    CENTER: 0,
    CORNERS: {
      FACING: 1,
      MID: 2,
      BACK: 3,
    },
    SIDES: {
      FACING: 4,
      MID: 5,
      BACK: 6,
    },
    D3: {
      // If none of TOP, MID, or BOTTOM, then midpoint is assumed.
      // Otherwise, MID may be omitted.
      TOP: 7,
      MID: 8,
      BOTTOM: 9,
    }
  };

  /* Requires SmallBitSet
  static cornersMask = SmallBitSet.fromIndices([
    this.POINT_INDICES.CORNERS.FACING,
    this.POINT_INDICES.CORNERS.MID,
    this.POINT_INDICES.CORNERS.BACK
  ]);

  static sidesMask = SmallBitSet.fromIndices([
    this.POINT_INDICES.SIDES.FACING,
    this.POINT_INDICES.SIDES.MID,
    this.POINT_INDICES.SIDES.BACK
  ]);
  */

  /**
   * @typedef {object} InternalPoints
   * @returns {object}
   * - @prop {Point3d} center
   * - @prop {object} top
   *    - @prop {Point3d[]} corners
   *    - @prop {Point3d[]} mids
   * - @prop {object} middle
   *    - @prop {Point3d[]} corners
   *    - @prop {Point3d[]} mids
   * - @prop {object} bottom
   *    - @prop {Point3d[]} corners
   *    - @prop {Point3d[]} mids
   */
  /** @typedef {InternalPoints} */
  #internalPoints = {};

  get internalPoints() {
    if ( this.isDirty(this.constructor.INTERNAL_POINTS) ) this.generateInternalPoints();
    return this.#internalPoints;
  }

  generateInternalPoints() {
    this.#internalPoints = this.getInternalPoints();
    this._clearDirty(this.constructor.INTERNAL_POINTS);
  }

  /**
   * Calculate internal points for bottom, middle, and top elevations.
   * @returns {InternalPoints}
   */
  getInternalPoints() {
    // Find the center using AABB bounds and default to that to calculate point locations.
    const { min, max } = this.aabb;
    const center = this.aabb.getCenter();
    return {
      center,
      top: {
        corners: [
          Point3d.tmp.set(min.x, min.y, max.z),
          Point3d.tmp.set(min.x, max.y, max.z),
          Point3d.tmp.set(max.x, max.y, max.z),
          Point3d.tmp.set(max.x, min.y, max.z),
        ],
        mids: [
          Point3d.tmp.set(center.x, min.y, max.z),
          Point3d.tmp.set(center.x, max.y, max.z),
          Point3d.tmp.set(min.x, center.y, max.z),
          Point3d.tmp.set(max.x, center.y, max.z),
        ],
      },
      middle: {
        corners: [
          Point3d.tmp.set(min.x, min.y, center.z),
          Point3d.tmp.set(min.x, max.y, center.z),
          Point3d.tmp.set(max.x, max.y, center.z),
          Point3d.tmp.set(max.x, min.y, center.z),
        ],
        mids: [
          Point3d.tmp.set(center.x, min.y, center.z),
          Point3d.tmp.set(center.x, max.y, center.z),
          Point3d.tmp.set(min.x, center.y, center.z),
          Point3d.tmp.set(max.x, center.y, center.z),
        ],
      },
      bottom: {
        corners: [
          Point3d.tmp.set(min.x, min.y, min.z),
          Point3d.tmp.set(min.x, max.y, min.z),
          Point3d.tmp.set(max.x, max.y, min.z),
          Point3d.tmp.set(max.x, min.y, min.z),
        ],
        mids: [
          Point3d.tmp.set(center.x, min.y, min.z),
          Point3d.tmp.set(center.x, max.y, min.z),
          Point3d.tmp.set(min.x, center.y, min.z),
          Point3d.tmp.set(max.x, center.y, min.z),
        ],
      },
    }
  }

  /**
   * For a given array of points, return the mid-points between each.
   * @param {Point3d[]}
   * @returns {Point3d[]}
   */
  static calculateMidPoints(cornerPoints = []) {
    const numPts = cornerPoints.length;
    const midPts = new Array(numPts);
    let a = cornerPoints.at(-1);
    for ( let i = 0; i < numPts; i += 1 ) {
      const b = cornerPoints[i];
      midPts[i] = Point3d.midPoint(a, b);
    }
    return midPts;
  }

  /**
   * For given polygon top and bottom, return the internal points.
   */
  static calculatePolygonCylinderInternalPoints(topFace, bottomFace) {
    const topCenter = topFace.centroid;
    const bottomCenter = bottomFace.centroid;
    const n = topFace.points.length;

    // Calculate the middle points
    const center = Point3d.midPoint(topCenter, bottomCenter);
    const top = {
      corners: topFace.points.map(pt => pt.clone()),
      mids: this.calculateMidPoints(topFace.points),
    };
    const bottom = {
      corners: bottomFace.points.map(pt => pt.clone()),
      mids: this.calculateMidPoints(bottomFace.points),
    };

    // Build the mid points from the top and bottom.
    const middle = {
      corners: new Array(n),
      mids: new Array(n),
    };
    for ( let i = 0; i < n; i += 1 ) {
      middle.corners[i] = Point3d.midPoint(top.corners[i], bottom.corners[i]);
      middle.mids[i] = Point3d.midPoint(top.mid[i], bottom.mid[i]);
    }

    return {
      center,
      top,
      middle,
      bottom,
    };
  }

  /**
   * Inset an array of points towards a center point from their current position.
   * @param {Point3d[]} points
   * @param {Point3d} center
   * @param {number} [insetPercentage = -1]         Percent, usually between 0 and 1, or -1 to inset 1 pixel.
   *   0 will not inset the points. While assumed that the inset will not exceed -1, it is possible to inset by any percentage other than -1.
   * @returns {Point3d[]} The points, modified in place.
   */
  static insetPoints(points, center, insetPercentage = -1) {
    using delta = Point3d.tmp;
    if ( !~insetPercentage ) {
      points.forEach(pt => {
        center.subtract(pt, delta);
        delta.x = Math.sign(delta.x); // 1 pixel
        delta.y = Math.sign(delta.y); // 1 pixel
        pt.add(delta, pt);
      });
    } else if ( insetPercentage ) {
      points.forEach(pt => {
        center.subtract(pt, delta);
        delta.multiplyScalar(insetPercentage, delta);
        pt.add(delta, pt);
      });
    }
    return points;
  }
}




