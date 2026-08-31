/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_LIB_ID } from "../const.js";
import { VertexObject } from "../placeable_vertices/VertexObject.js";
import { AABB3d } from "../3d/AABB3d.js";
import { almostBetween, cutaway } from "../util.js";
import { Point3d } from "../3d/Point3d.js";
import { combineTypedArrays } from "../util.js";
import { ModelMatrixAnchor } from "../ModelMatrix.js";
import { MatrixFloat32 } from "../Matrix.js";
import { Segment } from "../Segment.js";
import { CutawayPolygon } from "../CutawayPolygon.js";
import { Polygon3d } from "../3d/Polygon3d.js";

/** @type {Matrix<4,4>} */
const IDENTITY_MATRIX = MatrixFloat32.identity(4, 4);
Object.freeze(IDENTITY_MATRIX);

/* Geometric Primitives

Data container: modelMatrix
- Track translation/scale/rotation
- Model matrix buffer can be passed to webGL2
- Both instanced and non-instanced (basic scale/rotation/translation of model shape)

Data container: Prototype shapes
- Array of GeometricPrimitives

Data container: Shapes (Model)
- Array of GeometricPrimitives

Data container: Instance Vertex Object
- Store vertices and indices.

Data container: Model Vertex Object
- Store vertices and indices

Data container: Faces
- Can generate face points
- Ray intersection

Data container: AABB
- Combination of shape AABBs

Data container: Face Points
- Surface points

Data container: Internal Points
- Comparable to Foundry 9 points

Method: RayIntersection
- Intersection tests for shapes



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

  /**
   * Treat this shape as being:
   * • double-blocking (double-walled) (NONE)
   * • blocking in direction of its faces (CULL_BACK)
   * • blocking in opposite direction of its faces (CULL_FRONT)
   * In gl.disable(gl.CULL_FACE), corresponds to gl.FRONT, gl.BACK or gl.disable(gl.CULL_FACE).
   * @type {enum}
   */
  static CULL_FACES = {
    NONE: 0,
    FRONT: -1,
    BACK: 1,

    // Synonyms
    DOUBLE: 0,
    LEFT: -1,
    RIGHT: 1
  };

  /** @type {enum} */
  direction = this.constructor.CULL_FACES.BACK;

  /** @type {string} */
  id;

  /**
   * @param {string} id       Unique string per instance; used for debugging and for child classes
   *                          to track model and vertices arrays.
   */
  constructor(id) {
    this.id = id;
  }

  initialize() {
    this._initializeFaces();
  }

  static create(...args) {
    const out = new this(...args);
    out.initialize();
    return out;
  }

  #center = new Point3d();

  get center() {
    // Multiply the origin (0, 0, 0) by the translation to find the new center.
    return this.modelMatrix._translation.multiplyPoint3d(this.#center);
  }

  /**
   * Destroy this geometric primitive, releasing associated memory in buffers.
   */
  destroy() {
    this.#faces.forEach(face => face.release());
    this.#faces.length = 0;
    this.modelMatrix.destroy();
    this.modelMatrix = null;
    this.id = null;
  }

  // ----- NOTE: Update Flags ----- //

  static DIRTY = {
    NONE:             0,
    FACES:            1 << 0, // 1
    AABB:             1 << 1, // 2
    FACE_POINTS:      1 << 2, // 4
    INTERNAL_POINTS:  1 << 3, // 8
    MODEL_VERTICES:   1 << 5, // 32
    INSTANCE_VERTICES: 1 << 6, // 64
    ALL:              ~0,     // All bits set
  };

  /** @type {DIRTY} */
  #dirtyFlags = this.constructor.DIRTY.ALL;

  get dirty() { return this.#dirtyFlags; }

  set dirty(flag) { this.#dirtyFlags |= flag; }

  isDirty(flag = this.constructor.DIRTY.ALL) { return this.#dirtyFlags & flag; }

  _clearDirty(flag) { this.#dirtyFlags &= ~flag; }

  // ----- NOTE: Model Matrix ----- //

  // Every object has a model matrix, although some might be identity matrices.
  // Model matrix used to change prototype faces --> model faces.
  // Model matrix might be used to change instance vertices --> model vertices

  /** @type {ModelMatrix} */
  modelMatrix = ModelMatrixAnchor.create();

  /**
   * @type {Point3d|object} center
   */
  setPosition(center) {
    this.modelMatrix.translation = center;
    this.dirty = this.constructor.DIRTY.ALL;
  }

  /**
   * @type {Point3d|object} angles
   */
  setRotation(angles) {
    this.modelMatrix.rotation = angles;
    this.dirty = this.constructor.DIRTY.ALL;
  }

  /**
   * @type {Point3d|object} dims
   */
  setScale(dims) {
    this.modelMatrix.scale = dims;
    this.dirty = this.constructor.DIRTY.ALL;
  }

  setAnchor(anchors) {
    this.modelMatrix.anchor = anchors;
    this.dirty = this.constructor.DIRTY.ALL;
  }

  // ----- NOTE: AABB ----- //

  /** @type {AABB3d} */
  #aabb = new AABB3d();

  get aabb() {
    if ( this.isDirty(this.constructor.DIRTY.AABB) ) this.updateAABB();
    return this.#aabb;
  }

  /**
   * Trigger update of the AABB.
   */
  updateAABB() {
    this._calculateAABB(this.#aabb);
    this._clearDirty(this.constructor.DIRTY.AABB);
  }

  /**
   * Method for child class to define how the AABB is defined.
   * Defaults to union of all model faces AABB.
   */
  _calculateAABB(aabb) { AABB3d.union(this.faces.map(face => face.aabb), aabb); }

  // ----- NOTE: Faces ----- //

  // Prototype faces should be set at initialization and not otherwise be dirty.

  /** @type {Polygon3d[]} */
  get prototypeFaces() { return []; }

  #faces = [];

  /** @type {Polygon3d[]} */
  get faces() {
    if ( this.isDirty(this.constructor.DIRTY.FACES) ) this.updateFaces();
    return this.#faces;
  }

  /**
   * Convert prototype faces to faces.
   * After this is called, the faces are marked dirty because they have yet to be transformed.
   */
  _initializeFaces() {
    this.#faces.length = 0;
    this.prototypeFaces.forEach(f => this.#faces.push(f.clone()));
    this.dirty = this.constructor.DIRTY.FACES;
  }

  /**
   * Trigger update of the faces.
   */
  updateFaces() {
    this._generateFaces(this.#faces);
    this._clearDirty(this.constructor.DIRTY.FACES);
  }

  /**
   * Update the faces for this primitive.
   * Default is to use the model matrix.
   */
  _generateFaces(faces) {
    const M = this.modelMatrix.model;
    const numSides = this.prototypeFaces.length;
    for ( let i = 0; i < numSides; i += 1 ) this.prototypeFaces[i].transform(M, faces[i]);
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
  rayIntersection(rayOrigin, rayDirection, { minT = 0, maxT = 1, direction = this.constructor.CULL_FACES.BACK } = {}) {
    for ( const face of this.faces ) {
      if ( (direction * face.plane.whichSide(rayOrigin)) >= 0 ) {
         const t = face.intersectionT(rayOrigin, rayDirection);
         if ( t !== null && t >= minT && t <= maxT ) return t;
      }
    }
    return null;
  }

  // ----- NOTE: Debug ----- //

  /**
   * Draw face, omitting an axis.
   */
  draw2d(opts) {
    for ( const face of this.faces ) face.draw2d(opts);
  }

  // ----- NOTE: Vertices ----- //
  /** @type {boolean} */
  static HAS_UVs = false;

  /** @type {VertexObject} */
  #instanceVO = new VertexObject();

  /** @type {VertexObject} */
  get instanceVO() {
    if ( this.isDirty(this.constructor.DIRTY.INSTANCE_VERTICES) ) this.updateInstanceVertices();
    return this.#instanceVO;
  }

  /**
   * Trigger an update of the instance vertices.
   */
  updateInstanceVertices() {
    this._generateInstanceVertices(this.#instanceVO);
    this._clearDirty(this.constructor.DIRTY.INSTANCE_VERTICES);
  }

  /**
   * Create instance vertices.
   * Default approach uses the prototype faces.
   */
  _generateInstanceVertices(vo) {
    return this.constructor.generateVerticesForFaces(this.iteratePrototypeFaces(), vo);
  }

  /** @type {VertexObject} */
  #modelVO = new VertexObject();

  /** @type {VertexObject} */
  get modelVO() {
    if ( this.isDirty(this.constructor.DIRTY.MODEL_VERTICES) ) this.updateModelVertices();
    return this.#modelVO;
  }

  /**
   * Increment when the model vertices are updated.
   * @type {number}
   */
  modelVerticesVersion = 0;

  /**
   * Trigger an update of the model vertices.
   */
  updateModelVertices() {
    this._generateModelVertices(this.#modelVO);
    this._clearDirty(this.constructor.DIRTY.MODEL_VERTICES);
  }

  /**
   * Create vertices for this placeable using its faces.
   * @param {Polygon3d[]} faces
   * @param {boolean} [addNormals=false]
   * @returns {Float32Array} The vertices
   */
  _generateModelVertices(vo) {
    this.modelVerticesVersion += 1;
    return this.constructor.generateVerticesForFaces(this.faces, vo);
  }

  /**
   * From an array of faces, generate vertices/indices.
   * @param {Polygon3d[]} faces         Array or iterator of faces
   * @param {VertexObject} [vo]
   * @returns {VertexObject}
   */
  static generateVerticesForFaces(faces, vo) {
    vo ??= new VertexObject();
    // Add vertices from faces.
    vo.vertices = this.verticesFromFaces(faces, true);
    vo.indices = null;
    vo.hasNormals = true;
    vo.hasUVs = this.HAS_UVs;
    vo.condense(vo);
    return vo;
  }

  static verticesFromFaces(faces, addNormals = true) {
    // Store each Float32 array for each face separately.
    const vertices = [];
    for ( const face of faces ) {
      if ( !face ) continue;
      vertices.push(face.toVertices({ addNormals }));
    }

    // Combine.
    return combineTypedArrays(vertices);
  }

  // ----- NOTE: Face points ----- //

  /** @typedef {Point3d[][]} */
  #facePoints = [];

  get facePoints() {
    if ( this.isDirty(this.constructor.DIRTY.FACE_POINTS) ) this.updateFacePoints();
    return this.#facePoints;
  }

  /** @yield {Point3d} */
  *iterateFacePoints() {
    for ( const pts of this.facePoints ) yield* pts;
  }

  /**
   * Trigger update of the face points.
   */
  updateFacePoints() {
    this._generateFacePoints(this.#facePoints);
    this._clearDirty(this.constructor.DIRTY.FACE_POINTS);
  }

  /**
   * For each face, generate points encompassed by its surface.
   * Generates an array of points per face.
   * @param {Point3d[]} fp
   */
  _generateFacePoints(fp) {
    const opts = { spacing: CONFIG[GEOMETRY_LIB_ID].CONFIG.perPixelSpacing || 10, startAtEdge: false };
    const faces = this.faces;
    const numSides = faces.length;
    fp.length = numSides;
    for ( let i = 0; i < numSides; i += 1 ) fp[i] = faces[i].pointsLattice(opts);
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
    if ( this.isDirty(this.constructor.INTERNAL_POINTS) ) this.updateInternalPoints();
    return this.#internalPoints;
  }

  /**
   * Trigger update of the internal points.
   */
  updateInternalPoints() {
    this._generateInternalPoints(this.#internalPoints);
    this._clearDirty(this.constructor.DIRTY.INTERNAL_POINTS);
  }

  /**
   * Calculate internal points for bottom, middle, and top elevations.
   * @param {InternalPoints} ip       Object in which to store the points
   * @returns {InternalPoints}
   */
  _generateInternalPoints(ip) {
    // Find the center using AABB bounds and default to that to calculate point locations.
    const { min, max } = this.aabb;
    const center = this.aabb.getCenter();

    ip.center = center;
    ip.top = {
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
    };

    ip.middle =  {
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
    };

    ip.bottom = {
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
    };
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
      middle.mids[i] = Point3d.midPoint(top.mids[i], bottom.mids[i]);
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

  // ----- NOTE: Vertical Cutaway -----

  /**
   * Slice this 3d shape with a vertical plane, returning 2d cross-section(s).
   * @param {PIXI.Point} start     Starting point of the slice on the XY plane
   * @param {PIXI.Point} end        Ending point of the slice on the XY plane
   * @returns {CutawayPolygon[]}
   */
  verticalSlice(start, end) {
    using dirXY = Point3d.tmp;
    end.subtract(start, dirXY).normalize(dirXY);

    // Define the normal of the vertical slicing plane. Perpendicular to dirXY.
    using sliceNormal = Point3d.tmp.set(-dirXY.y, dirXY.x, 0);

    // Iterate through each polygon to find intersection segments.
    using dirA = PIXI.Point.tmp;
    using dirB = PIXI.Point.tmp;
    const segments2d = [];
    for ( const face of this.faces ) {
      const interPoints3d = [];
      for ( const edge of face.iterateEdges() ) {
        const { a, b } = edge;

        // Distance from plane = (point - origin) • normal.
        a.to2d(dirA).subtract(start, dirA);
        b.to2d(dirB).subtract(start, dirB);
        const distA = dirA.dot(sliceNormal);
        const distB = dirB.dot(sliceNormal);

        // Check if endpoints are on opposite sides of the slicing plane.
        if ( distA * distB < 0 ) {
          // Linear interpolation to find the exact intersection point.
          const t = distA / (distA - distB);
          const pInter = Point3d.tmp;
          b.subtract(a, pInter).multiplyScalar(t, pInter).add(a, pInter); // a + (t * (b - a))
          interPoints3d.push(pInter);
        } else if ( distA.almostEqual(0) ) interPoints3d.push(a);

        // A convex/planar polygon sliced by a plane should yield exactly 2 unique points.
        const uniquePts = getUniquePoints(interPoints3d);
        if ( uniquePts.length === 2 ) {
          // Map the 3d points to the 2d coordinate system.
          const pt0 = cutaway.to2d(uniquePts[0], start, end);
          const pt1 = cutaway.to2d(uniquePts[1], start, end);
          segments2d.push(new Segment(pt0, pt1));

        } else console.warn(`GeometricPrimitive|verticalSlice found ${uniquePts.length} unique points`, uniquePts);
      }
    }
    return this.#assembleCutawayPolygons(segments2d, start, end);
  }

  /**
   * Stitch a list of disconnected 2d segments into an ordered array of 2d polygons (islands).
   * @param {Segment[]} segments      Array of 2d line segments
   * @returns {PIXI.Polygon[]} Array of 2d polygons
   */
  #assembleCutawayPolygons(segments, start, end) {
    if ( segments.length === 0 ) return [];

    // Continue building new islands as long as there are unassigned segments.
    const polygons = [];
    const unvisited = [...segments];
    while ( unvisited.length > 0 ) {
      const polyPoints = [];

      // Start a new loop with the first available unvisited segment.
      const startSegment = unvisited.shift();
      let targetPoint = startSegment.b;
      polyPoints.push(startSegment.a);

      // Trace the current loop until it closes or hits a dead end.
      while ( true ) {
        // Check if the loop closed back on itself.
        if ( targetPoint.almostEqual(startSegment.a) ) break;

        polyPoints.push(targetPoint);

        // Find the next segment connecting our current target point.
        const nextIndex = unvisited.findIndex(seg =>
          seg.a.almostEqual(targetPoint) || seg.b.almostEqual(targetPoint));
        if ( nextIndex === -1 ) break; // Open loop discontinuity. Save as-is.

        // Set the new target point to the other end of the found segment.
        const nextSegment = unvisited.splice(nextIndex, 1)[0];
        targetPoint = nextSegment.a.almostEqual(targetPoint) ? nextSegment.b : nextSegment.a;
      }
      const cutaway = CutawayPolygon.fromCutawayPoints(polyPoints, start, end);
      polygons.push(cutaway);
    }
    return polygons;
  }
}

/**
 * Container to facilitate combining multiple shapes.
 * This does not combine model matrices or vertices/indices.
 * Merely a wrapper for the underlying shapes.
 * Empty shapes are allowed.
 */
export class CombinedGeometricPrimitive extends GeometricPrimitive {

  /**
   * Initialize the values for this geometric primitive.
   */
  initialize() { this.shapes.forEach(shape => shape.initialize); }

  /**
   * Destroy this geometric primitive, releasing associated memory in buffers.
   */
  destroy() {
    this.shapes.forEach(shape => shape.destroy());
    this.shapes.length = 0;
  }

  // ----- NOTE: Dirty ----- //

  get dirtyShapes() {
    let dirty = 0;
    this.shapes.forEach(shape => dirty |= shape.dirty);
    return dirty;
  }

  set dirtyShapes(flag) { this.shapes.forEach(shape => shape.dirty = flag); }

  isDirtyShapes(flag = this.constructor.DIRTY.ALL) {
    return this.shapes.some(shape => shape.isDirty(flag));
  }

  _clearDirtyShapes(flag) { this.shapes.forEach(shape => shape._clearDirty(flag)) }

  // ----- NOTE: Add/remove shapes ----- //

  /** @type {GeometricPrimitive[]} */
  shapes = [];

  /**
   * Add a primitive shape to this container.
   * @param {GeometricPrimitive} shape
   */
  addShape(shape) {
    this.shapes.push(shape);
    this.dirty = this.constructor.DIRTY.ALL;
    if ( this.initialized ) this._initializeFaces();
  }

  /**
   * Remove a primitive shape from this container by id.
   * @param {string} id
   * @returns {GeometricPrimitive|null} Null if nothing removed
   */
  removeShapeById(id) {
    const idx = this.shapes.findIndex(shape => shape.id === id);
    if ( !~idx ) return null;
    return this.removeShapeByIndex(idx);
  }

  /**
   * Remove a primitive shape from this container by its index.
   *
   */
  removeShapeByIndex(idx) {
    const shape = this.shapes.splice(idx, 1)[0] || null;
    if ( shape ) {
      this.dirty = this.constructor.DIRTY.ALL;
      this._initializeFaces();
    }
    return shape;
  }

  // ----- NOTE: AABB ----- //

  /**
   * Method for child class to define how the AABB is defined.
   * Defaults to union of all model faces AABB.
   */
  _calculateAABB(aabb) {
    const shapeAABBs = this.shapes.map(shape => shape.aabb);
    AABB3d.union(shapeAABBs, aabb);
  }

  /** @type {Point3d} */
  get center() {
    const centers = this.shapes.map(shape => shape.center);
    const poly3d = new Polygon3d.from3dPoints(centers);
    return poly3d.centroid;
  }

  // ----- NOTE: Model Matrix ----- //

  /** @type {ModelMatrix} */
  modelMatrix = ModelMatrixAnchor.create();

  /**
   * Mworld = Mlocal x M.container (row-major)
   * @returns {Matrix}
   */
  worldModelForShape(shape) { return shape.modelMatrix.model.multiply4x4(this.modelMatrix.model); }

  // ----- NOTE: Faces ----- //


  // Return as a flat array.
  get prototypeFaces() { return super.prototypeFaces.flatMap(arr => arr); }

  _initializeFaces() {
    const n = this.shapes.length;
    super.prototypeFaces = new Array(n);
    for ( let i = 0; i < n; i += 1 ) {
      const shape = this.shapes[i];
      if ( !shape ) continue;
      super.prototypeFaces[i] = shape.prototypeFaces;
    }
  }

  // Return as a flat array.
  get faces() { return super.faces.flatMap(arr => arr); }

  /**
   * Update the faces for this primitive.
   * Default is to use the world matrix on the prototypes.
   */
  _generateFaces(faces) {
    const protoFaces = super.prototypeFaces;
    for ( let i = 0, numShapes = this.shapes.length; i < numShapes; i += 1 ) {
      const shape = this.shapes[i];
      if ( !shape ) continue;

      // Calculate each face from the world model.
      const worldM = this.worldModelForShape(shape);
      const protoArr = protoFaces[i];
      const faceArr = faces[i];
      for ( let j = 0, numProtos = protoArr.length; j < numProtos; j += 1 ) {
        protoArr[j].transform(worldM, faceArr[j]);
      }
    }
  }

  // ----- NOTE: Face points ----- //

  /**
   * For each face, generate points encompassed by its surface.
   * @param {Point3d[]} fp
   */
  _generateFacePoints(fp) {
    fp.length = 0;
    for ( const shape of this.shapes ) {
      fp.push(...shape.facePoints);
    }
  }

  // ----- NOTE: Internal points ----- //

  // Default is a single set of points based on AABB.
  // TODO: More sophisticated version testing for containment.

}

// ----- NOTE: Helper functions -----

/**
 * Filters out duplicate intersection points. (Fixes issues with shared vertices.)
 * @param {Point3d[]} points
 * @returns {Point3d[]} The unique points
 */
function getUniquePoints(points) {
  const unique = [];
  using zero = Point3d.tmp.set(0, 0, 0);
  using tmp = Point3d.tmp;
  for ( const p of points ) {
    const isDuplicate = unique.some(u =>  u.subtract(p, tmp).almostEqual(zero))
    if ( !isDuplicate ) unique.push(p);
  }
  return unique;
}
