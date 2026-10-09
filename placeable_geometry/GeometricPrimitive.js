/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_LIB_ID } from "../const.js";
import { VertexObject } from "../placeable_vertices/VertexObject.js";
import { AABB3d } from "../3d/AABB3d.js";
import { Point3d } from "../3d/Point3d.js";
import { combineTypedArrays } from "../util.js";
import { ModelMatrixAnchor } from "../ModelMatrix.js";
import { MatrixFloat32 } from "../Matrix.js";
import { CutawayPolygon } from "../CutawayPolygon.js";
import { Plane } from "../3d/Plane.js";
import { Segment } from "../Segment.js";
import { Polygon3d } from "../3d/Polygon3d.js";


/** @type {Matrix<4,4>} */
const IDENTITY_MATRIX = MatrixFloat32.identity(4, 4);
Object.freeze(IDENTITY_MATRIX);

/**
 * Global monotonic counter used to stamp transform changes.
 * Stamps are never reused, so a primitive that is re-parented always looks "changed" to cached values.
 */
let VERSION_COUNTER = 0;


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

  /** @type {GeometricPrimitive} */
  parent = null; // Parent container, if any. Change to model are flagged here.

  /** @type {boolean} */
  isHole = false;

  /** @type {boolean} */
  #reversed = false;

  get reversed() { return this.#reversed; }

  /**
   * Toggle hole status of this shape, and mark the children as changed.
   */
  reverseOrientation() {
    this.#reversed = !this.#reversed;
    this.isHole = !this.isHole;
    this._markOrientationChanged();
    return this;
  }

  /**
   * Mark as dirty based on an orientation change.
   */
  _markOrientationChanged() {
    const D = this.constructor.DIRTY;
    this.dirty = D.FACES | D.MODEL_VERTICES | D.INSTANCE_VERTICES | D.DERIVED;
    this.contentVersion = this.constructor._nextVersion(); // Track change for any renderer.
    this.parent?.childChanged(this);
  }

  /**
   * @param {string} id       Unique string per instance; used for debugging and for child classes
   *                          to track model and vertices arrays.
   */
  constructor(id) {
    this.id = id;
  }

  initialize() {
    this.dirty = this.constructor.DIRTY.ALL;
    this.#calculatePrototypeAABB();
  }

  static create(...args) {
    const out = new this(...args);
    out.initialize();
    return out;
  }

  /**
   * @returns {number} A new, never-before-used version stamp.
   */
  static _nextVersion() { return ++VERSION_COUNTER; }

  #center = new Point3d();

  /**
   * Center is defined as the origin for the prototype shape.
   */
  get center() {
    // If anchor is at 0, 0, then the center is the origin (0, 0, 0).
    // Multiply the origin (0, 0, 0) by the translation to find the new center.
    if ( this.modelMatrix.anchor.equals({ x: 0, y: 0, z: 0 }) ) {
      return this.modelMatrix._translation.multiplyPoint3d(this.#center);
    }
    return this.constructor.calculateCentroid(this.faces, this.#center);
  }

  /**
   * Centroid is the center of mass of all the face points.
   * @param {Polygon3d[]} faces
   * @returns {Point3d}
   */
  static calculateCentroid(faces, out) {
    out ??= Point3d.tmp;
    out.set(0, 0, 0);
    if ( !faces || faces.length === 0 ) return out;

    for ( const face of faces ) out.add(face.centroid, out);
    const scale = 1 / faces.length;
    return out.multiplyScalar(scale, out);
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
    MODEL_VERTICES:   1 << 4, // 16
    INSTANCE_VERTICES: 1 << 5, // 32
    DERIVED:          1 << 6, // 64. Geometry derived from other primitives (e.g. caps of a holed solid)

    // Everything that depends on the world transform.
    // Excludes INSTANCE_VERTICES, which depend only on the prototype faces and so survive any matrix change.
    TRANSFORM:         (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 6),
    ALL:              ~0,     // All bits set
  };

  /** @type {DIRTY} */
  #dirtyFlags = this.constructor.DIRTY.ALL;

  get dirty() { return this.#dirtyFlags; }

  set dirty(flag) { this.#dirtyFlags |= flag; }

  isDirty(flag = this.constructor.DIRTY.ALL) { return this.#dirtyFlags & flag; }

  _clearDirty(flag) { this.#dirtyFlags &= ~flag; }


  // ----- NOTE: Update tracking ----- //

  /**
   * Stamp of this primitive's own transform.
   * @type {number}
   */
  transformVersion = this.constructor._nextVersion();

  /**
   * Stamp bumped when something below this primitive changes (children added, removed, or changed).
   * Stays 0 for leaves.
   * @type {number}
   */
  contentVersion = 0;

  /**
   * Changes whenever this primitive's world transform chages: its own or any ancestor's.
   * @type {number}
   */
  get worldVersion() { return Math.max(this.transformVersion, this.parent?.worldVersion ?? 0); }

  /**
   * One number a renderer can poll per root. Changes if anything in or above this subtree changed.
   * @type {number}
   */
  get changeStamp() { return Math.max(this.worldVersion, this.contentVersion); }

  /** @type {number} */
  #syncedWorldVersion = -1;

  /**
   * If an ancestor's transform changed since this primitive last looked, flag the
   * transform-dependent caches as dirty.
   * Called at the top of every cached getter.
   */
  _syncWorld() {
    const version = this.worldVersion;
    if ( version === this.#syncedWorldVersion ) return;
    this.#syncedWorldVersion = version;
    this.dirty = this.constructor.DIRTY.TRANSFORM;
  }

  /**
   * Call after any change to this primitive's own model matrix.
   * Does not touch the instance vertices, which depend only on the prototype.
   */
  _markTransformChanged() {
    this.transformVersion = this.constructor._nextVersion();
    this.dirty = this.constructor.DIRTY.TRANSFORM;
    this.parent?.childChanged(this);
  }

  /**
   * Called by a child when its transform or content changed. Containers override.
   * @param {GeometricPrimitive} _child
   */
  childChanged(_child) { }

  // ----- NOTE: Model Matrix ----- //

  // Every object has a model matrix, although some might be identity matrices.
  // Model matrix used to change prototype faces --> model faces.
  // Model matrix might be used to change instance vertices --> model vertices

  /** @type {ModelMatrix} */
  modelMatrix = ModelMatrixAnchor.create();

  /** {type} {Matrix<4x4>} */
  #worldMatrix;

  /** @type {number} */
  #worldMatrixVersion = -1;

  /**
   * Local-to-canvas matrix: The parent's world matrix times this primitive's model matrix.
   * Identical to the model matrix for a root primitive.
   * @type {Matrix<4x4>}
   */
  get worldMatrix() {
    const version = this.worldVersion;
    if ( version !== this.#worldMatrixVersion ) {
      const local = this.modelMatrix.model;
      this.#worldMatrix = this.parent ? this.parent.worldMatrix.multiply4x4(local) : local;
      this.#worldMatrixVersion = version;
    }
    return this.#worldMatrix;
  }

  /**
   * @param {Point3d|object} center
   * @returns {boolean} True if change was made. Triggers parent update, if any.
   */
  setPosition(center) {
    if ( this.modelMatrix.translation.almostEqual(center) ) return false;
    this.modelMatrix.translation = center;
    this._markTransformChanged();
    return true;
  }

  /**
   * @param {Point3d|object} angles
   * @returns {boolean} True if change was made. Triggers parent update, if any.
   */
  setRotation(angles) {
    if ( this.modelMatrix.rotation.almostEqual(angles) ) return false;
    this.modelMatrix.rotation = angles;
    this._markTransformChanged();
    return true;
  }

  /**
   * @param {Point3d|object} dims
   * @returns {boolean} True if change was made. Triggers parent update, if any.
   */
  setScale(dims) {
    if ( this.modelMatrix.scale.almostEqual(dims) ) return false;
    this.modelMatrix.scale = dims;
    this._markTransformChanged();
    return true;
  }

  /**
   * @param {Point3d|object} anchors
   * @returns {boolean} True if change was made. Triggers parent update, if any.
   */
  setAnchor(anchors) {
    if ( this.modelMatrix.anchor.almostEqual(anchors) ) return false;
    this.modelMatrix.anchor = anchors;
    this._markTransformChanged();
    return true;
  }

  // ----- NOTE: AABB ----- //

  /** @type {AABB3d} */
  #aabb = new AABB3d();

  #prototypeAABB = new AABB3d();

  get aabb() {
    this._syncWorld();
    if ( this.isDirty(this.constructor.DIRTY.AABB) ) this.updateAABB();

    if ( this.faces.length && CONFIG[GEOMETRY_LIB_ID].CONFIG.debug ) {
      if ( Number.isNaN(this.#prototypeAABB.min.x)
        || Number.isNaN(this.#prototypeAABB.min.y)
        || Number.isNaN(this.#prototypeAABB.min.z)
        || Number.isNaN(this.#prototypeAABB.max.x)
        || Number.isNaN(this.#prototypeAABB.max.y)
        || Number.isNaN(this.#prototypeAABB.max.z) ) console.error(`${this.constructor.name}|Prototype AABB is NaN.`);

      if ( Number.isNaN(this.#aabb.min.x)
        || Number.isNaN(this.#aabb.min.y)
        || Number.isNaN(this.#aabb.min.z)
        || Number.isNaN(this.#aabb.max.x)
        || Number.isNaN(this.#aabb.max.y)
        || Number.isNaN(this.#aabb.max.z)

       ) console.error(`${this.constructor.name}|AABB is NaN.`);

      if ( !(Number.isFinite(this.#prototypeAABB.min.x)
          && Number.isFinite(this.#prototypeAABB.min.y)
          && Number.isFinite(this.#prototypeAABB.min.z)
          && Number.isFinite(this.#prototypeAABB.max.x)
          && Number.isFinite(this.#prototypeAABB.max.y)
          && Number.isFinite(this.#prototypeAABB.max.z)) ) console.warn(`${this.constructor.name}|Prototype AABB is not finite.`);

      if ( !(Number.isFinite(this.#aabb.min.x)
          && Number.isFinite(this.#aabb.min.y)
          && Number.isFinite(this.#aabb.min.z)
          && Number.isFinite(this.#aabb.max.x)
          && Number.isFinite(this.#aabb.max.y)
          && Number.isFinite(this.#aabb.max.z)) ) console.warn(`${this.constructor.name}|AABB is not finite.`);
    }


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
   * Define the prototype aabb based on prototype.
   * @param {AABB3d} aabb       The prototype AABB object to modify
   */
  #calculatePrototypeAABB() {
    const aabb = this.#prototypeAABB;
    AABB3d.union(this.prototypeFaces.map(face => face.aabb), aabb);
  }

  _calculateAABB(aabb) {
    this.#prototypeAABB.transform(this.worldMatrix, aabb);
  }

  /**
   * Does this shape's XY dimensions potentially contain this canvas location?
   * Meant to be a relatively quick test. Should only reject if it is certain not to contain it.
   * @param {PIXI.Point} canvasLoc
   * @returns {boolean}
   */
  containsProjectedXY(canvasLoc) { return this.aabb.almostContainsPoint(canvasLoc, ["x", "y"]); }

  // ----- NOTE: Faces ----- //

  // Prototype faces should be set at initialization and not otherwise be dirty.

  /** @type {Polygon3d[]} */
  get prototypeFaces() { return []; }

  #faces = [];

  /** @type {Polygon3d[]} */
  get faces() {
    this._syncWorld();
    if ( this.isDirty(this.constructor.DIRTY.FACES) ) this.updateFaces();
    return this.#faces;
  }

  /**
   * Trigger update of the faces.
   */
  updateFaces(validate) {
    validate ??= CONFIG[GEOMETRY_LIB_ID].CONFIG.debug;

    this._generateFaces(this.#faces);
    this._clearDirty(this.constructor.DIRTY.FACES);

    // Must come after clearing faces to avoid calling updateFaces again when this.faces is accessed.
    if ( validate && !this.validate() ) console.warn(`${this.constructor.name}|Shape fails validation!`, this);
  }

  /**
   * Update the faces for this primitive.
   * Default is to use the model matrix.
   */
  _generateFaces(faces) {
    // Release old face points before destroying them.
    faces.forEach(face => face.release());
    const protoFaces = this.prototypeFaces;
    const numSides = faces.length = protoFaces.length;

    // Transform the prototype faces by the model matrix.
    // Pre-calculate the inverse transpose to use with transforming the normal.
    const M = this.worldMatrix;
    const invTransposeM = M.invert().transpose();
    const mirrors = Polygon3d.isMirroringTransform(M);
    for ( let i = 0; i < numSides; i += 1 ) {
      const face = protoFaces[i].transform(M, invTransposeM, mirrors);
      faces[i] = this.reversed ? face.invertRole() : face;
    }
    this._clearDirty(this.constructor.DIRTY.FACES);
  }

  // ----- NOTE: Intersection testing ----- //

  /**
   * @typedef {Object} CrossingData
   * @prop {number} t       Where along the ray the crossing occurs
   * @prop {-1|1} s         Direction of the crossing: +1 enters (see faceCrossings)
   * @prop {-1|1|0} ds      Combined direction (see clusterCrossings)
   */

  /**
   * Count the number of faces crossed by a given ray for a given polygon or polygons.
   * @param {Polygon3d} face
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {CrossingData[]} [out=[]]     Where to store the crossing data
   */
  static faceCrossings(face, rayOrigin, rayDirection, out = []) {
    for ( const poly of face.polygons ?? [face] ) {
      // Treat hole rings as real surfaces here, to facilitate the shoelace counting.
      const t = poly.intersectionT(rayOrigin, rayDirection, { holesBlock: true, signed: true });
      if ( t === null ) continue;
      out.push({ t, s: poly.plane.normal.dot(rayDirection) < 0 ? 1 : -1, ds: null }); // +1 enters material.
    }
    return out;
  }

  /**
   * Organize crossing data by distance along the ray.
   * @param {CrossingData[]} crossings
   * @param {number} [epsilon=1e-06]
   * @returns {CrossingData[]}
   */
  static clusterCrossings(crossings, epsilon = 1e-06) {
    crossings.sort((a, b) => a.t - b.t); // Sort by distance along the ray.
    const out = [];
    for ( let i = 0, n = crossings.length; i < n; ) {
      const first = crossings[i];
      let pos = false;
      let neg = false;
      while ( i < n && (crossings[i].t - first.t <= epsilon) ) {
        if ( crossings[i].s > 0 ) pos = true;
        else neg = true;
        i += 1;
      }
      first.ds = pos - neg;
      out.push(first); // { t: first.t, s: first.s, ds: pos - neg }
    }
    return out;
  }

  /**
   * Locate the position along the ray when the first crossing occurs.
   * @param {CrossingData[]} crossings    Output from clusterCrossings
   * @param {object} [opts]
   * @param {number} [opts.minT=0]        Ignore hits earlier in the segment than this (multiple of rayDirection)
   * @param {number} [opts.maxT=1]        Ignore hits later in the segment than this (multiple of rayDirection)
   * @param {number} [opts.direction=this.CULL_FACES.BACK]    Orientation of a blocking face
   * @returns {number|null} The direction along the ray if it is blocked
   */
  static firstBlockedT(crossings, { minT = 0, maxT = 1, direction = this.CULL_FACES.BACK }) {
    let depth = 0; // Crossings behind the origin still count, so a ray that starts inside material is handled.
    for ( const { t, ds } of crossings ) {
      const before = depth;
      depth += ds;
      if ( t < minT || t > maxT ) continue;
      const entered = before <= 0 && depth > 0;
      const exited = before > 0 && depth <= 0;
      if ( (direction >= 0 && entered)
        || (direction <= 0 && exited) ) return t;
    }
    return null;
  }

  /**
   * Determine where a ray first hits this object in 3d.
   * Ignores intersections behind the ray.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {object} [opts]
   * @param {boolean} [opts.sidesOnly=false]
   * @param {number} [opts.minT=0]        Ignore hits earlier in the segment than this (multiple of rayDirection)
   * @param {number} [opts.maxT=1]        Ignore hits later in the segment than this (multiple of rayDirection)
   * @returns {number|null} The distance along the ray, as a multiple of rayDirection
   */
  rayIntersection(rayOrigin, rayDirection, { sidesOnly = false, ...opts } = {}) {
    const crossings = [];
    const faces = sidesOnly ? this.sideFaces : this.faces;
    for ( const face of faces ) this.constructor.faceCrossings(face, rayOrigin, rayDirection, crossings);
    const clustered = this.constructor.clusterCrossings(crossings);
    return this.constructor.firstBlockedT(clustered, { ...opts, direction: this.direction });
  }

  // ----- NOTE: Debug ----- //

  /**
   * Draw face, omitting an axis.
   */
  draw2d(opts) {
    for ( const face of this.faces ) face.draw2d(opts);
  }

  drawTransformed(M, opts, invTransposeM, mirrors) {
    invTransposeM ??= M.invert().transpose();
    mirrors ??= Polygon3d.isMirroringTransform(M);
    for ( const face of this.faces ) {
      face.transform(M, invTransposeM, mirrors).draw2d(opts);
    }
  }

  /**
   * Draw normals for the faces, extending out from the centroid of each.
   */
  drawNormals(opts) {
    for ( const face of this.faces ) face.drawNormal(opts);
  }

  /**
   * Validate aspects of this shape, to be defined by child class.
   * The parent tests faces for consistent
   * @returns {boolean} True if valid (tests pass).
   */
  validate() {
    // Outward for solids, inward for holes.
    const worldDir = this.isHole ? -1 : 1;
    const protoDir = (this.isHole !== this.reversed) ? -1 : 1;
    return this._hasConsistentFaceDirection(this.prototypeFaces) === protoDir
      && this._hasConsistentFaceDirection(this.faces) === worldDir;
  }

  /**
   * Test whether all provided faces face a consistent direction: all inward or all outward.
   * Outward means from an outside viewer, the face is counter-clockwise.
   * @returns {1|-1|0} 1 if all face outward; -1 if all face inward; 0 if mixed.
   */
  _hasConsistentFaceDirection(faces) {
    if ( !faces || faces.length < 3 ) return 0;

    // Default to simple version: Test each face against the centroid.
    const centroid = this.constructor.calculateCentroid(faces);
    const iter = faces.values();
    const firstFace = iter.next().value;
    const dir = -Math.sign(firstFace.plane.whichSide(centroid));
    for ( const face of iter ) {
      if ( -Math.sign(face.plane.whichSide(centroid)) !== dir ) return 0;
    }
    return dir;
  }

  /**
   * Test if a point is inside an array of faces, by counting the number of intersections
   * of a directional ray from that point.
   * @param {Point3d} rayOrigin               The point to test
   * @param {Point3d} rayDirection            The direction of the ray
   * @param {Polygon3d[]} faces
   * @returns {boolean} True if odd number of intersections
   */
  static testFaceOrientation(face, faces) {
    const rayOrigin = face.interiorPoint();
    const otherFaces = faces.filter(f => f !== face);
    const MAX_ATTEMPTS = 10;

    /*
    Start with the face's own -normal (guarantees the ray starts by heading into
    the solid). But -normal is, by construction, parallel to every OTHER face
    whose plane shares that same normal direction -- e.g. testing any vertical
    riser/side face on a Steps shape produces a horizontal ray that is parallel to
    *every* tread's plane, and since a riser sits directly at a tread's own
    elevation, that ray will frequently be exactly coplanar with a tread, not just
    parallel-and-offset. A ray embedded in another face's plane doesn't cleanly
    cross it, so intersectionT's "no single-point solution" case (returned as
    null, then coerced to `t = 0` and skipped below) silently drops what should be
    a real, countable interaction -- corrupting the parity count.
    Detect that degeneracy and nudge the ray direction until no other face's
    plane is (nearly) parallel to it.
    */

    const netAlong = baseDirection => {
       using rayDirection = baseDirection.clone();
       for ( let attempts = 0; attempts < MAX_ATTEMPTS && rayIsDegenerate(rayDirection, otherFaces); attempts += 1 ) {
         using nudged = perturbDirection(baseDirection);
         rayDirection.copyFrom(nudged);
       }
       const crossings = [];
       for ( const other of otherFaces ) this.faceCrossings(other, rayOrigin, rayDirection, crossings);
       return this.clusterCrossings(crossings.filter(c => c.t > 1e-06)).reduce((sum, c) => sum + c.ds, 0);
    };

    using into = face.plane.normal.multiplyScalar(-1);
    if ( netAlong(into) === -1 ) return 1;                // Heads into material, leaves once.
    if ( netAlong(face.plane.normal) === 1 ) return -1;   // Heads into a void, leaves once.
    return 0;
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
    const reversed = this.reversed !== Polygon3d.isMirroringTransform(this.worldMatrix);
    const protoFaces = reversed
      ? this.prototypeFaces.map(face => face.clone().reverseOrientation()) : this.prototypeFaces;
    return this.constructor.generateVerticesForFaces(protoFaces, vo);
  }

  /** @type {VertexObject} */
  #modelVO = new VertexObject();

  /** @type {VertexObject} */
  get modelVO() {
    this._syncWorld();
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
    vo ||= new VertexObject();
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

  // ----- NOTE: Drawables ----- //

  /**
   * @typedef {Object} GeometricDrawableData
   *
   * @prop {GeometricPrimitive} primitive
   * @prop {VertexObject} vo
   * @prop {Matrix<4x4>} matrix
   * @prop {number} direction
   * @prop {number} version
   */

  /**
   * Yield what a renderer needs to draw this primitive: prototype VO and the matrix to apply it.
   * Leaves yield themselves; containers yield their descendant's drawables.
   * @param {object} [opts]
   * @yields {GeometricDrawableData}
   */
  *drawables(_opts) {
    yield {
      primitive: this,
      vo: this.instanceVO,
      matrix: this.worldMatrix,
      direction: this.direction,
      version: this.version,
    };
  }

  // ----- NOTE: Face points ----- //

  /** @typedef {Point3d[][]} */
  #facePoints = [];

  get facePoints() {
    this._syncWorld();
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
    this._syncWorld();
    if ( this.isDirty(this.constructor.DIRTY.INTERNAL_POINTS) ) this.updateInternalPoints();
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
      a = b;
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
   * Slice this 3d shape with a vertical plane, returning 2d cross-section(s) as CutawayPolygons.
   * Correctly handles shapes with holes (internal cavities, Polygons3d hole faces, etc.).
   * @param {PIXI.Point|Point3d} start     Starting point of the slice on the XY plane
   * @param {PIXI.Point|Point3d} end       Ending point of the slice on the XY plane
   * @returns {CutawayPolygon[]} Array of CutawayPolygon cross-sections (solids and holes)
   */
  verticalSlice(start, end) {
    if ( start.almostEqual(end) ) return [];
    if ( !this.aabb.overlapsSegment(start, end) ) return [];

    // Build the vertical plane for the start|end line.
    if ( !Object.hasOwn(start, "z") ) start = Point3d.tmp.set(start.x, start.y, 0);
    if ( !Object.hasOwn(end, "z") ) end = Point3d.tmp.set(end.x, end.y, 0);
    using c = start.clone();
    c.z += 50; // To construct the normal plane.
    const plane = Plane.fromPoints(start, end, c);

    // 4. Intersect each face with the vertical plane
    const dirSegments2d = [];
    using a2d = PIXI.Point.tmp;
    using b2d = PIXI.Point.tmp;
    for ( const face of this.faces ) {
      const segments = face.intersectPlane(plane);
      if ( !segments.length ) continue;

      // Map 3D endpoints to 2D Cutaway coordinates (u = distance along slice, v = z elevation)
      segments.forEach(segment => {
        CutawayPolygon.to2d(segment.a, start, end, a2d);
        CutawayPolygon.to2d(segment.b, start, end, b2d);

        if ( PIXI.Point.distanceSquaredBetween(a2d, b2d) < 1e-06 ) return;
        dirSegments2d.push(new Segment(a2d.clone(), b2d.clone()));
      });
      segments.forEach(s => s.release());

    }

    // 5. Assemble directed 2D segments into closed loops
    const polyPointsArr = this.#assemblePolygons(dirSegments2d);
    const out = polyPointsArr.map(polyPoints => CutawayPolygon.fromCutawayPoints(polyPoints, start, end));
    dirSegments2d.forEach(s => s.release());
    return out;
  }

  /**
   * Stitch directed 2D segments into ordered, closed polygon loops.
   * Maintains loop direction so outer boundaries and holes are properly oriented.
   * @param {Segment<PIXI.Point>[]} segments   Directed 2D line segments
   * @returns {PIXI.Point[][]} Array of polygon points, grouped by polygon
   */
  #assemblePolygons(segments) {
    if ( !segments.length ) return [];

    const polygons = [];
    const unvisited = [...segments];

    while ( unvisited.length > 0 ) {
      const startSeg = unvisited.shift();
      const polyPoints = [startSeg.a];

      let targetPoint = startSeg.b;
      const loopStart = startSeg.a;

      while ( unvisited.length > 0 ) {
        polyPoints.push(targetPoint);

        // Determine the closest a point to this b point.
        // Assume no open loops.
        let minDist = PIXI.Point.distanceSquaredBetween(loopStart, targetPoint)
        let nextIdx = -1;
        for ( let i = 0, n = unvisited.length; i < n; i++ ) {
          const s = unvisited[i];
          const dist = PIXI.Point.distanceSquaredBetween(s.a, targetPoint);
          if ( dist < minDist ) {
            minDist = dist;
            nextIdx = i;
          }
        }
        if ( !~nextIdx ) break; // Reached the beginning.

        const nextSeg = unvisited.splice(nextIdx, 1)[0];
        targetPoint = nextSeg.b;
      }

      if ( polyPoints.length >= 3 ) polygons.push(polyPoints);
    }

    return polygons;
  }
}



// ----- NOTE: Helper functions -----

/**
 * True if `direction` is (nearly) parallel to any of the given faces' planes --
 * i.e. the ray would run coplanar with, rather than cross, that face.
 * @param {Point3d} direction
 * @param {Polygon3d[]} otherFaces
 * @param {number} [epsilon=1e-6]
 * @returns {boolean}
 */
function rayIsDegenerate(direction, otherFaces, epsilon = 1e-08) {
  return otherFaces.some(f => direction.dot(f.plane.normal).almostEqual(0, epsilon));
}

/**
 * Return a new direction close to `direction` but nudged by a small random amount,
 * to break an exact parallel/coplanar alignment with some other face's plane.
 * Kept intentionally small so the ray still reliably starts by heading into the
 * solid, the way the un-nudged -normal does.
 * @param {Point3d} direction
 * @param {number} [scale=1e-3]
 * @returns {Point3d} A new, normalized Point3d.
 */
function perturbDirection(direction, scale = 1e-03) {
  using jitter = Point3d.tmp.set(
    (Math.random() - 0.5) * scale,
    (Math.random() - 0.5) * scale,
    (Math.random() - 0.5) * scale,
  );
  const perturbed = direction.add(jitter);
  return perturbed.normalize(perturbed);
}