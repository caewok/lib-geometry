/* globals
canvas,
CONST,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { isOdd } from "./util.js";
import { GRID_DIAGONALS, gridDistanceBetween, alternatingGridDistance } from "./grid_distance.js";
import { GridCoordinates3d } from "./3d/GridCoordinates3d.js";

// ----- NOTE: Foundry typedefs  ----- //

/**
 * A pair of row and column coordinates of a grid space.
 * @typedef {object} GridOffset
 * @property {number} i    The row coordinate
 * @property {number} j    The column coordinate
 */

/**
 * An offset of a grid space or a point with pixel coordinates.
 * @typedef {GridOffset|Point} GridCoordinates
 */



/**
 * A 2d point that can function as Point|GridOffset. For just a point, use PIXI.Point.
 */
export class GridCoordinates extends PIXI.Point {
  static GRID_DIAGONALS = GRID_DIAGONALS;

  /**
   * Factory function that converts a GridOffset to GridCoordinates.
   * The {x, y} coordinates are centered.
   * @param {GridOffset} offset
   * @returns {GridCoordinates}
   */
  static fromOffset(offset) {
    const pt = new this();
    pt.setOffset(offset);
    return pt;
  }

  /**
   * Factory function that converts a Foundry GridCoordinates.
   * If the object has x,y properties, those are favored over i,j.
   * @param {object}
   * @returns {GridCoordinates}
   */
  static fromObject(obj) {
    const newObj = super.fromObject(obj);
    if ( Object.hasOwn(obj, "i") && !Object.hasOwn(obj, "x") ) newObj.i = obj.i;
    if ( Object.hasOwn(obj, "j") && !Object.hasOwn(obj, "y") ) newObj.j = obj.j;
    return newObj;
  }

  /** @type {number} */
  get i() { return canvas.grid.getOffset({ x: this.x, y: this.y }).i }

  /** @type {number} */
  get j() { return canvas.grid.getOffset({ x: this.x, y: this.y }).j }

  /** @type {number} */
  set i(value) { this.y = canvas.grid.getCenterPoint({ i: value, j: this.j }).y; }

  /** @type {number} */
  set j(value) { this.x = canvas.grid.getCenterPoint({ i: this.i, j: value }).x; }

  /**
   * Faster than getting i and j separately.
   * @type {object}
   */
  get offset() { return canvas.grid.getOffset({ x: this.x, y: this.y }); }

  /**
   * Convert this point to a new one based on its offset.
   * Sets x,y,z to equal the top left for i,j,k
   * @returns {PIXI.Point} New object
   */
  get topLeft() {
    return this.constructor.fromObject(canvas.grid.getTopLeftPoint({ x: this.x, y: this.y }));
  }

  /**
   * Convert this point to a new one based on its offset.
   * Sets x,y,z to equal the center for i,j,k
   * @returns {GridCoordinates3d} New object
   */
  get center() {
    return this.constructor.fromObject(canvas.grid.getCenterPoint({ x: this.x, y: this.y }));
  }

  toPoint() { return PIXI.Point.fromObject(this); }

  /**
   * Change this point to a specific offset value. The point will be centered.
   * @param {GridOffset} offset
   */
  setOffset(offset) {
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
   * For compatibility with PIXI.Point.
   * @returns {this}
   */
  to2d() { return this; }

  /**
   * Convert to 3d.
   * @returns {GridCoordinates3d}
   */
  to3d() { return GridCoordinates3d.fromObject(this); }

  /**
   * Determine the number of diagonals based on two 2d offsets for a square grid.
   * If hexagonal, no diagonals.
   * @param {GridOffset} aOffset
   * @param {GridOffset} bOffset
   * @returns {number}
   */
  static numDiagonal(aOffset, bOffset) {
    if ( canvas.grid.isHexagonal ) return 0;
    let di = Math.abs(aOffset.i - bOffset.i);
    let dj = Math.abs(aOffset.j - bOffset.j);
    return Math.min(di, dj);
  }

  /**
   * Measure the distance between two points accounting for the current grid rules.
   * For square, this accounts for the diagonal rules. For hex, measures in number of hexes.
   * @param {Point} a
   * @param {Point} b
   * @param {function} [altGridDistFn]    Function generated from alternatingGridDistance; used for alternating rules
   * @param {GRID_DIAGONALS} [diagonals]  Diagonal rule to use
   * @returns {number} Distance, in grid units
   */
  static gridDistanceBetween = gridDistanceBetween;

  /**
   * Measure the distance between two offsets accounting for the current grid rules.
   * Uses `gridDistanceBetween`.
   * @param {GridOffset} aOffset
   * @param {GridOffset} bOffset
   * @param {function} [altGridDistFn]    Function generated from alternatingGridDistance; used for alternating rules
   * @param {GRID_DIAGONALS} [diagonals]  Diagonal rule to use
   * @returns {number} Distance, in grid units
   */
  static gridDistanceBetweenOffsets(aOffset, bOffset, altGridDistFn, diagonals) {
    return this.gridDistanceBetween(this.fromOffset(aOffset), this.fromOffset(bOffset), altGridDistFn, diagonals);
  }

  /**
   * Return a function that can repeatedly measure segments, tracking the alternating diagonals.
   */
  static alternatingGridDistanceFn = alternatingGridDistance;

  /**
   * Measure distance, offset, and cost for a given 2d segment a|b.
   * Uses `gridDistanceBetween`.
   * @param {Point} a                   Start of the segment
   * @param {Point} b                   End of the segment
   * @param {number} [numPrevDiagonal=0]  Number of diagonals thus far
   * @param {function} [costFn]           Optional cost function; defaults to canvas.controls.ruler._getCostFunction
   * @param {GRID_DIAGONALS} diagonals    Diagonal rule to use
   * @returns {object}
   *   - @prop {number} distance          gridDistanceBetween for a|b
   *   - @prop {number} offsetDistance    gridDistanceBetweenOffsets for a|b
   *   - @prop {number} cost              Measured cost using the cost function
   *   - @prop {number} numDiagonal       Number of diagonals between the offsets if square or hex elevation
   */
  static gridMeasurementForSegment(a, b, numPrevDiagonal = 0, costFn, diagonals) {
    costFn ??= canvas.controls.ruler._getCostFunction();
    const lPrevStart = diagonals === CONST.GRID_DIAGONALS.ALTERNATING_2 ? 1 : 0;
    const lPrev = isOdd(numPrevDiagonal) ? lPrevStart : Number(!lPrevStart);
    const aOffset = this.fromObject(a);
    const bOffset = this.fromObject(b);
    const distance = this.gridDistanceBetween(a, b, this.alternatingGridDistanceFn({ lPrev }), diagonals);
    const offsetDistance = this.gridDistanceBetweenOffsets(a, b, this.alternatingGridDistanceFn({ lPrev }), diagonals);
    const cost = costFn ? costFn(a, b, offsetDistance) : offsetDistance;
    const numDiagonal = this.numDiagonal(aOffset, bOffset);
    return { distance, offsetDistance, cost, numDiagonal };
  }

  // Temporary instances for performance.
  static _tmp = new this();
  static _tmp2 = new this();
  static _tmp3 = new this();
}
