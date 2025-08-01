/* globals
canvas,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { elevationForUnit, unitElevation, roundNearWhole, pixelsToGridUnits, gridUnitsToPixels, NULL_SET } from "../util.js";
import { GEOMETRY_CONFIG } from "../const.js";
import { Pool } from "../Pool.js";

// ----- NOTE: 3d versions of Foundry typedefs ----- //

/**
 * @typedef {object} RegionMovementWaypoint3d
 * @property {number} x            The x-coordinates in pixels (integer).
 * @property {number} y            The y-coordinates in pixels (integer).
 * @property {number} elevation    The elevation in grid units.
 */


/**
 * A 3d point that can function as a Point3d|RegionMovementWaypoint.
 * Does not handle GridOffset3d so that it can be passed to 2d Foundry functions that
 * treat objects with {i,j} parameters differently.
 */
export class RegionMovementWaypoint3d extends GEOMETRY_CONFIG.threeD.Point3d {

  static classTypes = new Set([this.name]); // Alternative to instanceof

  inheritsClassType(type) {
    let proto = this;
    let classTypes = proto.constructor.classTypes;
    do {
      if ( classTypes.has(type) ) return true;
      proto = Object.getPrototypeOf(proto);
      classTypes = proto?.constructor?.classTypes;

    } while ( classTypes );
    return false;
  }

  objectMatchesClassType(obj) {
    return this.constructor.classTypes.equals(obj.constructor.classTypes || NULL_SET);
  }

  objectOverlapsClassType(obj) {
    return this.constructor.classTypes.intersects(obj.constructor.classTypes || NULL_SET);
  }


  static #pool = new Pool(_pool => new RegionMovementWaypoint3d());

  static release(...args) { args.forEach(arg => this.#pool.release(arg)); }

  static get tmp() { return this.#pool.acquire(); }

  /** @type {number<grid units>} */
  get elevation() { return pixelsToGridUnits(this.z); }

  /** @type {number<grid units>} */
  set elevation(value) { this.z = gridUnitsToPixels(value); }

  /**
   * Factory function to convert a generic point object to a RegionMovementWaypoint3d.
   * @param {Point|PIXI.Point|GridOffset|RegionMovementWaypoint|GridOffset3d|GridCoordinates3d} pt
   *   i, j, k assumed to refer to the center of the grid
   * @returns {RegionMovementWaypoint3d}
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
    const newPt = new this(x, y);
    if ( Object.hasOwn(pt, "z") ) newPt.z = pt.z;
    else if ( Object.hasOwn(pt, "elevation") ) newPt.elevation = pt.elevation;
    else if ( Object.hasOwn(pt, "k") ) newPt.elevation = elevationForUnit(pt.k);
    return newPt;
  }

  /**
   * Construct a point given a 2d location and an elevation in grid units.
   * @param {Point} location      Object with {x, y} properties
   * @param {number} [elevation = 0]    Elevation in grid units
   * @returns {RegionMovementWaypoint3d}
   */
  static fromLocationWithElevation(location, elevation = 0) {
    const pt = new this(location.x, location.y);
    pt.elevation = elevation;
    return pt;
  }

  /**
   * Given a token, modify this point to match the center point of the token for that position.
   * @param {Token} token
   * @param {RegionMovementWaypoint3d} outPoint
   * @returns {RegionMovementWaypoint3d} The outPoint
   */
  centerPointToToken(token, outPoint) {
    outPoint ??= new this.constructor();
    const center = token.getCenterPoint(this);
    outPoint.set(center.x, center.y, this.z);
    return outPoint;
  }

  /**
   * Modify this point to center it in elevation units.
   * @param {RegionMovementWaypoint3d} outPoint
   * @returns {RegionMovementWaypoint3d} The outPoint
   */
  centerElevation(outPoint) {
    outPoint ??= new this.constructor();
    outPoint.copyFrom(this);
    outPoint.elevation = elevationForUnit(unitElevation(this.elevation));
    return outPoint;
  }
}

GEOMETRY_CONFIG.threeD.RegionMovementWaypoint3d ??= RegionMovementWaypoint3d;

