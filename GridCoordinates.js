/* globals
canvas,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_CONFIG } from "./const.js";
import { Pool } from "./Pool.js";

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
 * A 2d point that can function as Point|GridOffset2D. For just a point, use PIXI.Point.
 */
export class GridCoordinates extends PIXI.Point {
  static #pool = new Pool(this);

  static releaseObj(obj) { this.#pool.release(obj); }

  static get tmp() { return this.#pool.acquire(); }

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

  /**
   * @returns {PIXI.Point}
   */
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
   * Test if this offset is equal to another
   * @param {GridOffset} other
   * @returns {boolean}
   */
  offsetsEqual(other) {
    return this.i === other.i && this.j === other.j;
  }

  /**
   * Determine the number of diagonals based on two 2d offsets for a square grid.
   * If hexagonal, no diagonals.
   * @param {GridOffset} aOffset
   * @param {GridOffset} bOffset
   * @returns {number}
   */
  static numDiagonal(aOffset, bOffset) {
    const res = this.measurePath([aOffset, bOffset]);
    return res.diagonals;
  }

  /**
   * Returns the points for the shortest, direct path passing through the given waypoints.
   * See canvas.grid.getDirectPath
   * @param {GridCoordinates[]|GridCoordinates} waypoints    Either an array or a single point.
   * @param {GridCoordinates} [end]                          If provided, this is the endpoint.
   *   (For ease of use, backward compatibility)
   * @returns {GridCoordinates[]}
   */
  static directPath(waypoints, end) {
    if ( !Array.isArray(waypoints) ) waypoints = [waypoints];
    if ( end ) waypoints.push(end);
    const offsets = canvas.grid.getDirectPath(waypoints);
    return offsets.map(offset => this.fromOffset(offset));
  }

  /**
   * Measure a shortest, direct path through the given waypoints.
   * See canvas.grid.measurePath
   * @param {GridCoordinates[]} waypoints
   * @param {object} options                  Additional measurement options
   *   - @prop {GridMeasurePathCostFunction2D<SegmentData>} [options.cost] The function that returns the cost
   *   for a given move between grid spaces (default is the distance travelled along the direct path)
   * @returns {GridMeasurePathResult}
   */
  static measurePath(waypoints, options) {
    return canvas.grid.measurePath(waypoints, options);
  }

  /**
   * Measure the distance between two points accounting for the current grid rules.
   * For square, this accounts for the diagonal rules. For hex, measures in number of hexes.
   * A and B must be points only if point-to-point measurement intended.
   * If they are offsets, the distance will use the offset distance.
   * @param {Point} a
   * @param {Point} b
   * @param {object} options                  Additional measurement options
   *   - @prop {GridMeasurePathCostFunction2D<SegmentData>} [options.cost] The function that returns the cost
   *   for a given move between grid spaces (default is the distance travelled along the direct path)
   * @returns {number} Distance, in grid units
   */
  static gridDistanceBetween(a, b, options) {
    const res = this.measurePath([a, b], options);
    return res.distance;
  };
}

// Synonyms
GridCoordinates.getDirectPath = GridCoordinates.directPath; // Match Foundry's canvas.grid.getDirectPath.


GEOMETRY_CONFIG.GridCoordinates ??= GridCoordinates;
