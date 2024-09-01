/* globals
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import "./RegionMovementWaypoint3d.js";
import "../GridCoordinates.js";
import { GEOMETRY_CONFIG } from "../const.js";

/**
 * Cube coordinates in a hexagonal grid. q + r + s = 0.
 * @typedef {object} HexagonalGridCube
 * @property {number} q    The coordinate along the E-W (columns) or SW-NE (rows) axis.
 *                         Equal to the offset column coordinate if column orientation.
 * @property {number} r    The coordinate along the NE-SW (columns) or N-S (rows) axis.
 *                         Equal to the offset row coordinate if row orientation.
 * @property {number} s    The coordinate along the SE-NW axis.
 */

/**
 * 3d Cube coordinates, adding k for elevation unit
 * @typedef {object} HexagonalGridCube3d extends HexagonalGridCube
 * @property {number} k     The coordinate of the elevation
 */

/**
 * A 3d point that can also represent a 4d hex coordinate (q, r, s, k).
 * Links z to the elevation property.
 */
export class HexCoordinates3d extends GEOMETRY_CONFIG.threeD.GridCoordinates3d {

  /**
   * Create this point from hex coordinates plus optional elevation.
   * @param {HexagonalGridCube} hexCube
   * @param {number} [elevation]            Elevation in grid units
   * @returns {HexCoordinates3d}
   */
  static fromHexCube(hexCube, elevation) {
    const pt = new this();
    return pt.setToHexCube(hexCube, elevation);
  }

  /** @type {number} */
  get q() { return canvas.grid.pointToCube(this).q; }

  /** @type {number} */
  get r() { return canvas.grid.pointToCube(this).r; }

  /** @type {number} */
  get s() { return canvas.grid.pointToCube(this).s; }

  /** @type {number} */
  set q(value) {
    const pt = canvas.grid.cubeToPoint({ q: value, r: this.r });
    this.x = pt.x;
    this.y = pt.y;
  }

  /** @type {number} */
  set r(value) {
    const pt = canvas.grid.cubeToPoint({ q: this.q, r: value });
    this.x = pt.x;
    this.y = pt.y;
  }

  /** @type {number} */
  set s(value) {
    // s = 0 - q - r
    // r = 0 - q - s
    this.r = 0 - this.q - value;
  }

  /**
   * Faster than getting q, r, s separately.
   * @type {HexagonalGridCube3d}
   */
  get hexCube() {
    const obj = canvas.grid.pointToCube(this);
    obj.k = this.k;
    return obj;
  }

  /**
   * Set {x, y, z} based on a hex cube. Faster than setting individually.
   * @param {HexagonalGridCube3d}
   * @param {number} [elevation]    Elevation, in grid units
   * @returns {this} For convenience.
   */
  setToHexCube(hexCube, elevation) {
    if ( typeof elevation === "undefined" ) {
      if ( Object.hasProperty(hexCube, "z") ) elevation = GEOMETRY_CONFIG.utils.pixelsToGridUnits(hexCube.z);
      else if ( Object.hasProperty(hexCube, "k") ) elevation = this.constructor.elevationForUnit(hexCube.k);
      else elevation = 0;
    }
    const { x, y } = canvas.grid.cubeToPoint(hexCube);
    this.x = x;
    this.y = y;
    this.elevation = elevation;
    return this;
  }

  /**
   * Set x, y, z to center of hex.
   */
  centerToHexCube() { return this.setToHexCube(this, this.elevation); }
}


GEOMETRY_CONFIG.threeD.HexCoordinates3d ??= HexCoordinates3d;

