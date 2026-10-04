/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometricPrimitive } from "./GeometricPrimitive.js";
import { AABB3d } from "../3d/AABB3d.js";
import { CutawayPolygon } from "../CutawayPolygon.js";

/**
 * A container of 1 or more primitives.
 * Stores no geometry of its own. Each child keeps its own prototype faces and model matrix.
 *
 * The container's model matrix is the transform of the frame the children live in.
 * Identity by default, which is how FoundryVTT regions are handled: children matrices are
 * canvas-space matrices. A child's world matrix is parent.world x child.model
 *
 * Rendering: iterable drawables. Each yields a prototype VO and the matrix to draw it with.
 * Queries (e.g., aabb, rayIntersection, internalPoints, verticalSlice, containsProjectedXY)
 * combine the children's answers.
 */
export class CombinedGeometricPrimitive extends GeometricPrimitive {

  /** @type {GeometricPrimitive[]} */
  children = [];

  // ----- NOTE: Static factory methods ----- //

  /**
   * Combine primitives.
   * @param {string} id
   * @param {GeometricPrimitive[]} [children]
   * @returns {CombinedGeometricPrimitive}
   */
  static combine(id, children = []) {
    const out = new this(id);
    children.forEach(c => out.addChild(c));
    out.initialize();
    return out;
  }

  // ----- NOTE: Lifecycle ----- //

  initialize() { this.dirty = this.constructor.DIRTY.ALL; }

  /**
   * Destroy this geometric primitive and the children.
   */
  destroy() {
    for ( const child of this.children ) {
      child.parent = null;
      child.destroy();
    }
    this.children.length = 0;
    this.#faces.length = 0; // Faces belong to the children; do not release again in super.destroy.
    super.destroy();
  }

  // ----- NOTE: Children ----- //

  /**
   * Add a child. Its model matrix is interpreted in this container's frame.
   * @param {GeometricPrimitive} child
   * @returns {GeometricPrimitive} Same child.
   */
  addChild(child) {
    child.parent?.removeChild(child);
    child.parent = this;
    this.children.push(child);
    child._markTransformChanged(); // The child's world matrix changed; this also notifies this container.
    return child;
  }

  /**
   * Remove a child without destroying it.
   * @param {GeometricPrimitive} child
   * @returns {boolean} True if the child was present.
   */
  removeChild(child) {
    const i = this.children.indexOf(child);
    if ( !~i ) return false;
    this.children.splice(i, 1);
    child.parent = null;
    child._markTransformChanged();
    this.childChanged(child);
    return true;
  }

  /**
   * A child's transform or content changed. (Or a child was added/removed.)
   * Everything cached here that depends on the children is stale, and so is whatever is above.
   * @param {GeometricPrimitive} _child
   */
  childChanged(_child) {
    this.contentVersion = this.constructor._nextVersion();
    this.dirty = this.constructor.DIRTY.TRANSFORM;
    this.parent?.childChanged(this);
  }

  // ----- NOTE: Prototype and drawables ----- //

  /**
   * Inspection and debugging only. Children have different matrices, so these cannot
   * be drawn with one matrix. Use drawables() to render.
   * @type {POlygon3d[]}
   */
  get prototypeFaces() { return this.children.flatMap(child => child.prototypeFaces); }

  /**
   * A container has no single instance VO.
   * @type {VertexObject|null}
   */
  get instanceVO() { return null; }

  /** A container has no single sides VO.
   * @type {VertexObject|null}
   */
  get sidesVO() { return null; }

  /**
   * Drawable vertices for each of the children, in turn.
   * @param {object} [opts]
   * @param {boolean} [opts.sidesOnly]
   * @yields {object}
   */
  *drawables(opts) {
    for ( const child of this.children ) yield *child.drawables(opts);
  }

  // ----- NOTE: Faces ----- //

  /** @type {Polygon3d[]} */
  #faces = [];

  /**
   * Canvas faces of all children, borrowed (not cloned).
   * @type {Polygon3d[]}
   */
  get faces() {
    this._syncWorld();
    if ( this.isDirty(this.constructor.DIRTY.FACES) ) {
      this.#faces.length = 0;
      this._collectFaces(this.#faces);
      this._clearDirty(this.constructor.DIRTY.FACES);
    }
    return this.#faces;
  }

  /**
   * Fill the array with the faces that represent this container for face-based tests.
   * @param {Polygon3d[]} out
   */
  _collectFaces(out) {
    for ( const child of this.children ) out.push(...child.faces);
  }

  validate() { return this.children.every(child => child.validate()); }

  // ----- NOTE: AABB ----- //

  _calculateAABB(aabb) {
    return AABB3d.union(this.children.map(child => child.aabb), aabb);
  }

  /** @type {Point3d} */
  get center() { return this.aabb.getCenter(); }

  // ----- NOTE: Queries ----- //

  /**
   * Does any child's XY footprint potentially contain this canvas location?
   * @param {PIXI.Point} canvasLoc
   * @returns {boolean}
   */
  containsProjectedXY(canvasLoc) {
    return this.children.some(child => child.containsProjectedXY(canvasLoc));
  }

  /**
   * Nearest hit among the children. Each child applies its own culling direction, so holes work.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {object} [opts]
   * @param {number} [opts.minT=0]
   * @param {number} [opts.maxT=1]
   * @returns {number|null} The t of the nearest intersection, if any
   */
  firstRayIntersection(rayOrigin, rayDirection, { minT = 0, maxT = 1 } = {}) {
    let best = null;
    const opts = { minT, maxT };
    for ( const child of this.children ) {
      opts.maxT = best ?? maxT;
      const t = child.rayIntersection(rayOrigin, rayDirection, opts);
      if ( t !== null && (best === null || t < best) ) best = t;
    }
    return best;
  }

  /**
   * Does this ray hit this object in 3d?
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
    for ( const child of this.children ) {
      const t = child.rayIntersection(rayOrigin, rayDirection, opts);
      if ( t !== null ) return t;
    }
    return null;
  }

  /**
   * Determine all ray hits for this object in 3d.
   * Ignores intersections behind the ray.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {object} [opts]
   * @param {number} [opts.minT=0]        Ignore hits earlier in the segment than this (multiple of rayDirection)
   * @param {number} [opts.maxT=1]        Ignore hits later in the segment than this (multiple of rayDirection)
   * @returns {number[]} The distance along the ray, as a multiple of rayDirection
   */
  allRayIntersections(rayOrigin, rayDirection, opts) {
    const out = [];
    for ( const child of this.children ) {
      const t = child.rayIntersection(rayOrigin, rayDirection, opts);
      if ( t !== null ) out.push(t);
    }
    return out;
  }

  /**
   * Union of the children's cross-sections. Child-specific options (topZ, thickness...) are not forwarded.
   * @param {PIXI.Point} start
   * @param {PIXI.Point} end
   * @returns {CutawayPolygon[]}
   */
  verticalSlice(start, end) {
    if ( start.almostEqual(end) ) return [];
    if ( !this.aabb.overlapsSegment(start, end) ) return [];
    const cutaways = [];
    for ( const child of this.children ) cutaways.push(...child.verticalSlice(start, end));

    const ClipperPaths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths;
    return ClipperPaths.union(cutaways).map(poly => CutawayPolygon.fromPolygon(poly, start, end));
  }

  /**
   * Concatenate the children's internal points, bucket by bucket.
   * @param {object} ip   Modified in place
   * @returns {object}
   */
  _generateInternalPoints(ip) {
    const BUCKETS = ["top", "middle", "bottom"];
    ip.center = this.aabb.getCenter(); // Not guaranteed to be in a shape.
    for ( const bucket of BUCKETS ) ip[bucket] = { corners: [], mids: [] };
    for ( const child of this.children ) {
      const childPoints = child.internalPoints;
      for ( const bucket of BUCKETS ) {
        ip[bucket].corners.push(...(childPoints[bucket].corners || []));
        ip[bucket].mids.push(...(childPoints[bucket].mids || []));
      }
    }
    return ip;
  }
}

