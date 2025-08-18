/* globals
canvas,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { elevationForUnit, unitElevation, roundNearWhole, pixelsToGridUnits, gridUnitsToPixels } from "../util.js";
import { GEOMETRY_CONFIG } from "../const.js";
import { Pool } from "../Pool.js";
import { Point3d } from "./Point3d.js";

// ----- NOTE: 3d versions of Foundry typedefs ----- //

/**
 * @typedef {object} RegionMovementWaypoint3d|ElevatedPoint
 * @property {number} x            The x-coordinates in pixels (integer).
 * @property {number} y            The y-coordinates in pixels (integer).
 * @property {number} elevation    The elevation in grid units.
 */


/**
 * A 3d point that can function as a Point3d|RegionMovementWaypoint|ElevatedPoint.
 * Does not handle GridOffset3d so that it can be passed to 2d Foundry functions that
 * treat objects with {i,j} parameters differently.
 */
export class ElevatedPoint extends Point3d {

  static classTypes = new Set([this.name, "RegionMovementWaypoint3d"]); // Alternative to instanceof

  static #pool = new Pool(this);

  static releaseObj(obj) { this.#pool.release(obj); }

  static get tmp() { return this.#pool.acquire(); }

  /** @type {number<grid units>} */
  get elevation() { return pixelsToGridUnits(this.z); }

  /** @type {number<grid units>} */
  set elevation(value) { this.z = gridUnitsToPixels(value); }

  /**
   * Factory function to convert a generic point object to a RegionMovementWaypoint3d.
   * @param {Point|PIXI.Point|GridOffset|RegionMovementWaypoint|GridOffset3d|GridCoordinates3d} pt
   *   i, j, k assumed to refer to the center of the grid
   * @returns {ElevatedPoint}
   */
  static fromPoint(pt) {
    // Priority: x,y,z | elevation | i, j, k
    let x;
    let y;
    if ( Object.hasOwn(pt, "x") ) {
      x = pt.x;
      y = pt.y;
    } else if ( Object.hasOwn(pt, "i") ) {
      const res = canvas.grid.getCenterPoint(pt);
      x = roundNearWhole(res.x);
      y = roundNearWhole(res.y);
    }

    // Process elevation.
    const newPt = this.tmp.set(x, y, 0);
    if ( Object.hasOwn(pt, "z") ) newPt.z = pt.z;
    else if ( Object.hasOwn(pt, "elevation") ) newPt.elevation = pt.elevation;
    else if ( Object.hasOwn(pt, "k") ) newPt.elevation = elevationForUnit(pt.k);
    return newPt;
  }

  /**
   * Construct a point given a 2d location and an elevation in grid units.
   * @param {Point} location      Object with {x, y} properties
   * @param {number} [elevation = 0]    Elevation in grid units
   * @returns {ElevatedPoint}
   */
  static fromLocationWithElevation(location, elevation = 0) {
    const pt = this.tmp(location.x, location.y, 0)
    pt.elevation = elevation;
    return pt;
  }

  /**
   * Given a token, modify this point to match the center point of the token for that position.
   * @param {Token} token
   * @param {ElevatedPoint} outPoint
   * @returns {ElevatedPoint} The outPoint
   */
  centerPointToToken(token, outPoint) {
    outPoint ??= this.constructor.tmp;
    const center = token.getCenterPoint(this);
    outPoint.set(center.x, center.y, this.z);
    return outPoint;
  }

  /**
   * Modify this point to center it in elevation units.
   * @param {ElevatedPoint} outPoint
   * @returns {ElevatedPoint} The outPoint
   */
  centerElevation(outPoint) {
    outPoint ??= this.constructor.tmp;
    outPoint.copyFrom(this);
    outPoint.elevation = elevationForUnit(unitElevation(this.elevation));
    return outPoint;
  }
}

GEOMETRY_CONFIG.threeD.ElevatedPoint ??= ElevatedPoint;
GEOMETRY_CONFIG.threeD.RegionMovementWaypoint3d ??= ElevatedPoint; // For backwards compatibility

