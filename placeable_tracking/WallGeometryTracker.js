/* globals
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Trackers
import { WallTypeTracker, WallPositionTracker } from "./WallTracker.js";

// Mixing
import { mix } from "../mixwith.js";
import {
  AbstractPlaceableGeometryTracker,
  PlaceableAABBMixin,
  PlaceableModelMatrixMixin,
  PlaceableFacesMixin
} from "./AbstractPlaceableGeometryTracker.js";

// LibGeometry
import { AABB3d } from "../3d/AABB3d.js";
import { MatrixFloat32 } from "../MatrixFlat.js";
import { Quad3d } from "../3d/Polygon3d.js";
import { gridUnitsToPixels } from "../util.js";

/**
 * Prototype order:
 * WallGeometryTracker -> PlaceableFacesMixin -> PlaceableMatricesMixin -> PlaceableAABBMixin -> AbstractPlaceableGeometryTracker
 */
export class WallGeometryTracker extends mix(AbstractPlaceableGeometryTracker).with(PlaceableAABBMixin, PlaceableModelMatrixMixin, PlaceableFacesMixin) {
  /** @type {string} */
  static PLACEABLE_NAME = "Wall";

  /** @type {string} */
  static layer = "walls";

  /** @type {TrackerKeys} */
  static TRACKERS = {
    shape: WallTypeTracker,
    position: WallPositionTracker,
  };

  get wall() { return this.placeable; }

  get edge() { return this.placeable.edge; }

  // ----- NOTE: AABB ----- //
  calculateAABB() { return AABB3d.fromEdge(this.edge, this._aabb); }

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
    top: new Quad3d(),
    bottom: new Quad3d(),
    sides: [],
  }

  /**
   * Create the initial face shapes for this wall, using a 0.5 x 0.5 x 0.5 unit cube.
   * Normal walls have front (top) and back (bottom). One-directional walls have only top.
   */
  _initializePrototypeFaces() {
    this.constructor.QUADS.south.clone(this._prototypeFaces.top);
    if ( this.constructor.isDirectional(this.edge) ) this._prototypeFaces.bottom = null;
    else {
      this._prototypeFaces.bottom ??= new Quad3d();
      this.constructor.QUADS.south.clone(this._prototypeFaces.bottom);
    }
    super._initializePrototypeFaces();
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
   * @param {number} [cutoff=1]   Ignore hits further along the ray from this (treat ray as segment)
   * @returns {number|null} The distance along the ray
   */
  rayIntersection(...opts) {
    // Ignore one-directional walls facing away from the viewpoint.
    const edge = this.edge;
    if ( edge.direction && (edge.orientPoint(opts.rayOrigin) === edge.direction) ) return false;

    // Top and bottom are the same (just opposite orientations) and so only need to test one.
    return this.constructor.rayIntersectionForFaces([this.faces.top], ...opts);
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
    const ctr = new PIXI.Point();
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
    const delta = edge.b.subtract(edge.a, PIXI.Point.tmp);
    const out = Math.atan2(delta.y, delta.x);
    delta.release();
    return out;
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
