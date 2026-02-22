/* globals
canvas,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { roundNearWhole, pixelsToGridUnits, gridUnitsToPixels } from "../util.js";
import { ElevatedPoint } from "./ElevatedPoint.js";
import { GridCoordinates } from "../GridCoordinates.js";

// ----- NOTE: 3d versions of Foundry typedefs ----- //

/**
 * @typedef {object} ElevatedPoint
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
 * A 3d point that can function as Point3d|GridOffset3D|RegionMovementWaypoint.
 * Links z to the elevation property.
 */
export class GridCoordinates3d extends ElevatedPoint {

  static classTypes = new Set([this.name]); // Alternative to instanceof

  /**
   * Factory function that converts a GridOffset to GridCoordinates.
   * @param {GridOffset|GridOffset3d} offset
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
    return pt.centerToGrid();
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
  get k() { return canvas.grid.getOffset({ x: this.x, y: this.y, elevation: this.elevation }).k; }

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
    return canvas.grid.getOffset({ x: this.x, y: this.y, elevation: this.elevation });
  }

  /**
   * Convert this point to a new one based on its offset.
   * Sets x,y,z to equal the top left for i,j,k
   * @returns {GridCoordinates3d} New object
   */
  get topLeft() {
    const tl = this.constructor.fromObject(canvas.grid.getTopLeftPoint({ x: this.x, y: this.y }));
    tl.z = gridUnitsToPixels(this.constructor.elevationForUnit(this.k));
    return tl;
  }

  /**
   * Center this point on its grid space
   * Sets x,y,z to equal the center for i,j,k
   * @returns {GridCoordinates3d} New object
   */
  get center() {
    return this.constructor.fromObject(canvas.grid.getCenterPoint({ x: this.x, y: this.y, elevation: this.elevation }));
  }

  /**
   * Convert this point to a RegionMovementWaypoint.
   * @returns {ElevatedPoint}
   */
  toWaypoint() { return ElevatedPoint.fromObject(this); }

  /**
   * Change this point to a specific offset value, in place.
   * Faster than setting each {i, j, k} separately.
   * @param {GridOffset} offset       Either i, j or i, j, k
   * @param {number} elevation        Override k with a specific grid elevation
   * @returns {this}
   */
  setOffset(offset, elevation) {
    if ( elevation ) offset = { i: offset.i, j: offset.j, elevation };
    const pt = canvas.grid.getCenterPoint(offset);
    this.x = pt.x;
    this.y = pt.y;
    if ( Object.hasOwn(pt, "elevation") ) this.elevation = pt.elevation;
    this.roundNearWhole();
    return this;
  }

  /**
   * Center this point based on its current offset value.
   */
  centerToGrid() { return this.setOffset(this); }

  /**
   * Center the 2d coordinates of this point but leave elevation alone.
   */
  centerTo2dGrid() { return this.setOffset({ i: this.i, j: this.j }); }

  /**
   * Conversion to 2d.
   * @returns {GridCoordinates}
   */
  to2d() { return GridCoordinates.fromObject(this); }

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

  addOffset(offset, outPoint) {
    outPoint = super.addOffset(offset, outPoint);
    outPoint.k += (offset.k || 0);
    return outPoint;
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
  static elevationForUnit(k) { return roundNearWhole(k * canvas.scene.dimensions.distance); }

}
