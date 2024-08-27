/* globals
canvas,
CONFIG,
CONST
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { isOdd } from "../util.js";
import "./RegionMovementWaypoint3d.js";
import "../GridCoordinates.js";
import { GRID_DIAGONALS, gridDistanceBetween, alternatingGridDistance } from "../grid_distance.js";
import { GEOMETRY_CONFIG } from "../const.js";

// ----- NOTE: 3d versions of Foundry typedefs ----- //

/**
 * @typedef {object} RegionMovementWaypoint3d
 * @property {number} x            The x-coordinates in pixels (integer).
 * @property {number} y            The y-coordinates in pixels (integer).
 * @property {number} elevation    The elevation in grid units.
 */

/**
 * Row, column, elevation coordinates of a grid space. Follows from GridOffset
 * The vertical assumes the grid cubes are stacked upon one another.
 * @typedef {object} GridOffset3d
 * @property {number} i     The row coordinate
 * @property {number} j     The column coordinate
 * @property {number} k     The elevation, where 0 is at the scene elevation, negative is below the scene.
 *   k * canvas.scene.dimensions.distance === elevation in grid units.
 */

/**
 * An offset of a grid space or a point with pixel coordinates.
 * @typedef {GridOffset3d|Point3d} GridCoordinates3d
 */


/**
 * A 3d point that can function as Point3d|GridOffset3d|RegionMovementWaypoint.
 * Links z to the elevation property.
 */
export class GridCoordinates3d extends GEOMETRY_CONFIG.threeD.RegionMovementWaypoint3d {
  static GRID_DIAGONALS = GRID_DIAGONALS;

  /**
   * Factory function that converts a GridOffset to GridCoordinates.
   * @param {GridOffset} offset
   * @param {number} [elevation]      Override the elevation in offset, if any. In grid units
   * @returns {GridCoordinates3d}
   */
  static fromOffset(offset, elevation) {
    const pt = new this();
    pt.setOffset(offset);
    if ( typeof elevation !== "undefined" ) pt.elevation = elevation;
    return pt;
  }

  /**
   * Factory function to determine the grid square/hex center for the point.
   * @param {Point3d}
   * @returns {GridCoordinate3d}
   */
  static gridCenterForPoint(pt) {
    pt = new this(pt.x, pt.y, pt.z);
    return pt.centerToOffset();
  }

  /**
   * Factory function that converts a Foundry GridCoordinates.
   * If the object has x,y,z,elevation properties, those are favored over i,j,k.
   * @param {object}
   * @returns {GridCoordinates3d}
   */
  static fromObject(obj) {
    const newObj = super.fromObject(obj);
    if ( Object.hasOwn(obj, "i") && !Object.hasOwn(obj, "x") ) newObj.i = obj.i;
    if ( Object.hasOwn(obj, "j") && !Object.hasOwn(obj, "y") ) newObj.j = obj.j;
    if ( Object.hasOwn(obj, "k")
      && !(Object.hasOwn(obj, "z")
        || Object.hasOwn(obj, "elevationZ")
        || Object.hasOwn(obj, "elevation")) ) newObj.k = obj.k;
    return newObj;
  }

  /** @type {number} */
  get i() { return canvas.grid.getOffset({ x: this.x, y: this.y }).i }

  /** @type {number} */
  get j() { return canvas.grid.getOffset({ x: this.x, y: this.y }).j }

  /** @type {number} */
  get k() { return this.constructor.unitElevation(CONFIG.GeometryLib.utils.pixelsToGridUnits(this.z)); }

  /** @type {number} */
  set i(value) { this.y = canvas.grid.getCenterPoint({ i: value, j: this.j }).y; }

  /** @type {number} */
  set j(value) { this.x = canvas.grid.getCenterPoint({ i: this.i, j: value }).x; }

  /** @type {number} */
  set k(value) { this.elevation = this.constructor.elevationForUnit(value); }

  /**
   * Faster than getting i and j separately.
   * @type {object}
   */
  get offset() {
    const o = canvas.grid.getOffset({ x: this.x, y: this.y });
    o.k = this.k;
    return o;
  }

  /**
   * Convert this point to a new one based on its offset.
   * Sets x,y,z to equal the top left for i,j,k
   * @returns {GridCoordinates3d} New object
   */
  get topLeft() {
    const tl = this.constructor.fromObject(canvas.grid.getTopLeftPoint({ x: this.x, y: this.y }));
    tl.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(this.constructor.elevationForUnit(this.k));
    return tl;
  }

  /**
   * Convert this point to a new one based on its offset.
   * Sets x,y,z to equal the center for i,j,k
   * @returns {GridCoordinates3d} New object
   */
  get center() {
    const center = this.constructor.fromObject(canvas.grid.getCenterPoint({ x: this.x, y: this.y }));
    center.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(this.constructor.elevationForUnit(this.k));
    return center;
  }

  /**
   * Convert this point to a RegionMovementWaypoint.
   * @returns {RegionMovementWaypoint3d}
   */
  toWaypoint() { return CONFIG.GeometryLib.threeD.RegionMovementWaypoint3d.fromObject(this); }

  /**
   * Change this point to a specific offset value.
   * Faster than setting each {i, j, k} separately.
   * @param {GridOffset} offset
   */
  setOffset(offset) {
    const { x, y } = canvas.grid.getCenterPoint(offset);
    this.x = x;
    this.y = y;
    this.elevation = this.constructor.elevationForUnit(offset.k || 0);
    return this;
  }

  /**
   * Change this point to a specific offset value in the 2d axes. Do not modify elevation.
   * Faster than setting each {i, j} separately.
   * @param {GridOffset} offset
   */
  setOffset2d(offset) {
    const { x, y } = canvas.grid.getCenterPoint(offset);
    this.x = x;
    this.y = y;
    return this;
  }

  /**
   * Center this point based on its current offset value.
   */
  centerToOffset() { return this.setOffset(this); }

  /**
   * Conversion to 2d.
   * @returns {GridCoordinates}
   */
  to2d() { return CONFIG.GeometryLib.GridCoordinates.fromObject(this); }

  /**
   * @returns {this}
   */
  to3d() { return this; }

  /**
   * Test if this offset is equal to another.
   * @param {GridOffset} other
   * @returns {boolean}
   */
  offsetsEqual(other) {
    return this.i === other.i && this.j === other.j && this.k === other.k;
  }

  /**
   * Test if this offset is equal to another in 2d (i,j).
   * @param {GridOffset} other
   * @returns {boolean}
   */
  offsetsEqual2d(other) {
    return this.i === other.i && this.j === other.j;
  }

  /**
   * Determine the number of diagonals based on two offsets.
   * If hexagonal, only elevation diagonals count.
   * @param {GridOffset} aOffset
   * @param {GridOffset} bOffset
   * @returns {number}
   */
  static numDiagonal(aOffset, bOffset) {
    if ( canvas.grid.isHexagonal ) return Math.abs(aOffset.k - bOffset.k);
    let di = Math.abs(aOffset.i - bOffset.i);
    let dj = Math.abs(aOffset.j - bOffset.j);
    let dk = Math.abs(aOffset.k - bOffset.k);
    const midAxis = di.between(dj, dk) ? di
      : dj.between(di, dk) ? dj : dk;
    return midAxis;
  }

  /**
   * Calculate the unit elevation for a given set of coordinates.
   * @param {number} elevation    Elevation in grid units
   * @returns {number} Elevation in number of grid steps.
   */
  static unitElevation(elevation) { return Math.round(elevation / canvas.scene.dimensions.distance); }

  /**
   * Calculate the grid unit elevation from unit elevation.
   * Inverse of `unitElevation`.
   * @param {number} k            Unit elevation
   * @returns {number} Elevation in grid units
   */
  static elevationForUnit(k) { return k * canvas.scene.dimensions.distance; }

  /**
   * Measure the distance between two points accounting for the current grid rules.
   * For square, this accounts for the diagonal rules. For hex, measures in number of hexes.
   * @param {Point3d} a
   * @param {Point3d} b
   * @param {function} [altGridDistFn]    Function generated from alternatingGridDistance; used for alternating rules
   * @param {GRID_DIAGONALS} [diagonals]  Diagonal rule to use
   * @returns {number} Distance, in grid units
   */
  static gridDistanceBetween = gridDistanceBetween;

  /**
   * Measure the distance between two offsets accounting for the current grid rules.
   * Uses `gridDistanceBetween`.
   * @param {GridOffset3d} aOffset
   * @param {GridOffset3d} bOffset
   * @param {function} [altGridDistFn]    Function generated from alternatingGridDistance; used for alternating rules
   * @param {GRID_DIAGONALS} [diagonals]  Diagonal rule to use
   * @returns {number} Distance, in grid units
   */
  static gridDistanceBetweenOffsets(aOffset, bOffset, opts) {
    return this.gridDistanceBetween(this.fromOffset(aOffset), this.fromOffset(bOffset), opts);
  }

  /**
   * Measure distance, offset, and cost for a given segment a|b.
   * Uses `gridDistanceBetween`.
   * @param {Point3d} a                   Start of the segment
   * @param {Point3d} b                   End of the segment
   * @param {object} [opts]
   * @param {number} [opts.numPrevDiagonal=0]   Number of diagonals thus far
   * @param {function} [opts.costFn]            Optional cost function; defaults to canvas.controls.ruler._getCostFunction
   * @param {GRID_DIAGONALS} [opts.diagonals]   Diagonal rule to use
   * @returns {object}
   *   - @prop {number} distance          gridDistanceBetween for a|b
   *   - @prop {number} offsetDistance    gridDistanceBetweenOffsets for a|b
   *   - @prop {number} cost              Measured cost using the cost function
   *   - @prop {number} numDiagonal       Number of diagonals between the offsets if square or hex elevation
   */
  static gridMeasurementForSegment(a, b, { numPrevDiagonal = 0, costFn, diagonals } = {}) {
    costFn ??= canvas.controls.ruler._getCostFunction();
    const lPrevStart = canvas.grid.diagonals === CONST.GRID_DIAGONALS.ALTERNATING_2 ? 1 : 0;
    const lPrev = isOdd(numPrevDiagonal) ? lPrevStart : Number(!lPrevStart);
    const aOffset = this.fromObject(a);
    const bOffset = this.fromObject(b);

    const altGridDistFn1 = this.alternatingGridDistanceFn({ lPrev });
    const altGridDistFn2 = this.alternatingGridDistanceFn({ lPrev });
    const distance = this.gridDistanceBetween(a, b, { altGridDistFn: altGridDistFn1, diagonals });
    const offsetDistance = this.gridDistanceBetweenOffsets(a, b, { altGridDistFn: altGridDistFn2, diagonals });
    const cost = costFn ? costFn(a, b, offsetDistance) : offsetDistance;
    const numDiagonal = this.numDiagonal(aOffset, bOffset);
    return { distance, offsetDistance, cost, numDiagonal };
  }

  /**
   * Return a function that can repeatedly measure segments, tracking the alternating diagonals.
   */
  static alternatingGridDistanceFn = alternatingGridDistance;

  // Temporary instances for performance.
  static _tmp = new this();
  static _tmp2 = new this();
  static _tmp3 = new this();
}

GEOMETRY_CONFIG.threeD.GridCoordinates3d ??= GridCoordinates3d;
