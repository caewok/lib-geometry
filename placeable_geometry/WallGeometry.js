/* globals
CONST,
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
import { AABB3d } from "../3d/AABB3d.js";
import { MatrixFloat32 } from "../Matrix.js";
import { Quad3d } from "../3d/Polygon3d.js";
import { gridUnitsToPixels } from "../util.js";

/**
 * Prototype order:
 * WallGeometryTracker -> PlaceableFacesMixin -> PlaceableMatricesMixin -> PlaceableAABBMixin -> PlaceableGeometry
 */
export class WallGeometry extends mix(PlaceableGeometry).with(PlaceableAABBMixin, PlaceableModelMatrixMixin, PlaceableFacesMixin) {
  /** @type {string} */
  static PLACEABLE_NAME = "Wall";

  /** @type {string} */
  static layer = "walls";

  get wall() { return this.placeable; }

  get edge() { return this.placeable.edge; }

  // ----- NOTE: Updating ----- //

  shapeUpdated() {
    // Handle as one group b/c wall coordinate changes impact all three.
    this.calculateTranslationMatrix();
    this.calculateRotationMatrix();
    this.calculateScaleMatrix();
    super.shapeUpdated();
  }

  directionUpdated() {
    this._updateFaces();
  }

  // ----- NOTE: AABB ----- //
  calculateAABB() { return AABB3d.fromEdge(this.edge, this.aabb); }

  // ----- NOTE: Matrices ---- //

  calculateTranslationMatrix() {
    const mat = super.calculateTranslationMatrix();
    const edge = this.edge;
    const pos = this.constructor.edgeCenter(edge);
    const { top, bottom } = this.constructor.edgeElevation(edge);
    const zHeight = top - bottom;
    const z = top - (zHeight * 0.5);
    return MatrixFloat32.translation(pos.x, pos.y, z, mat);
  }

  calculateRotationMatrix() {
    const mat = super.calculateRotationMatrix();
    const rot = this.constructor.edgeAngle(this.edge);
    return MatrixFloat32.rotationZ(rot, true, mat);
  }

  calculateScaleMatrix() {
    const mat = super.calculateScaleMatrix();
    const edge = this.edge;
    const ln = this.constructor.edgeLength(edge);
    const { top, bottom } = this.constructor.edgeElevation(edge);
    const scaleZ = top - bottom;
    return MatrixFloat32.scale(ln, 1.0, scaleZ, mat);
  }

  // ----- NOTE: Faces ---- //

  /** @type {Faces} */
  _prototypeFaces = {
    top: new Quad3d(),      // Left
    bottom: new Quad3d(),   // Right
    sides: [],
  }

  /**
   * Create the initial face shapes for this wall, using a 0.5 x 0.5 x 0.5 unit cube.
   * Normal walls have front (top) and back (bottom). One-directional walls have only top.
   */
  _initializePrototypeFaces() {
    this.constructor.QUADS.north.clone(this._prototypeFaces.top);
    this.constructor.QUADS.south.clone(this._prototypeFaces.bottom);
    super._initializePrototypeFaces();
  }

  _updateFaces() {
    const M = this.modelMatrix.model;
    const hasTop = this.edge.direction === 0 || this.edge.direction === 1;    // 1: Restricts from left (from a --> b).
    const hasBottom = this.edge.direction === 0 || this.edge.direction === 2; // 2: Restricts from right (from a --> b).

    if ( hasTop && this._prototypeFaces.top ) {
      this.faces.top ??= new Quad3d();
      this._prototypeFaces.top.transform(M, this.faces.top);
    } else this.faces.top = null;
    if ( hasBottom && this._prototypeFaces.bottom ) {
      this.faces.bottom ??= new Quad3d();
      this._prototypeFaces.bottom.transform(M, this.faces.bottom);
    } else this.faces.bottom = null;
  }

  updateShape() {
    this._initializePrototypeFaces(); // In case wall direction changed.
    super.updateShape();
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
  rayIntersection(rayOrigin, rayDirection, opts) {
    if ( this.wall.isOpen ) return null; // If door is open, no intersection.
    return super.rayIntersection(rayOrigin, rayDirection, opts);
  }


  // ----- NOTE: Wall characteristics ----- //

  /**
   * Determine the top and bottom edge elevations. Null values will be given large constants.
   * @param {Edge} edge
   * @returns {object}
   * - @prop {number} top         1e05 if null
   * - @prop {number} bottom      -1e05 if null
   */
  static edgeElevation(edge) {
    let { top, bottom } = edge.elevationLibGeometry.a;
    top ??= 1e05;
    bottom ??= -1e05;
    top = gridUnitsToPixels(top);
    bottom = gridUnitsToPixels(bottom);
    return { top, bottom };
  }

  /**
   * Determine the 2d center point of the edge.
   * @param {Edge} edge
   * @returns {PIXI.Point}
   */
  static edgeCenter(edge) {
    const ctr = PIXI.Point.tmp;
    return edge.a.add(edge.b, ctr).multiplyScalar(0.5, ctr);
  }

  /**
   * Determine the 2d length of the edge.
   * @param {Edge} edge
   * @returns {number}
   */
  static edgeLength(edge) { return PIXI.Point.distanceBetween(edge.a, edge.b); }

  /**
   * Angle of the edge on the 2d canvas.
   * @param {Edge} edge
   * @returns {number} Angle in radians
   */
  static edgeAngle(edge) {
    using delta = edge.b.subtract(edge.a, PIXI.Point.tmp);
    return Math.atan2(delta.y, delta.x);
  }

  /**
   * Is this a terrain (limited) edge?
   * @param {Edge} edge
   * @returns {boolean}
   */
  static isTerrain(edge, { senseType = "sight" } = {}) {
    return edge[senseType] === CONST.WALL_SENSE_TYPES.LIMITED;
  }

  /**
   * Is this a directional edge?
   * @param {Edge} edge
   * @returns {boolean}
   */
  static isDirectional(edge) { return Boolean(edge.direction); }
}
