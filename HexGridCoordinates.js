/* globals
canvas,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { roundNearWhole } from "./util.js";
import { GridCoordinates } from "./GridCoordinates.js";
import { Pool } from "./Pool.js";

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
 * 2d Cube coordinates
 * @typedef {object}        HexagonalGridCube
 */

/**
 * A mixin which adds hex-specific calculations to the point class.
 */
export function HexCoordinateMixin(Base) {
  return class HexCoordinate extends Base {
    /**
     * Create this point from hex coordinates plus optional elevation.
     * @param {HexagonalGridCube} hexCube
     * @param {number} [elevation]            Elevation in grid units
     * @returns {HexGridCoordinates3d}
     */
    static fromHexCube(hexCube) {
      const pt = new this();
      return pt.setToHexCube(hexCube);
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
      this.x = roundNearWhole(pt.x);
      this.y = roundNearWhole(pt.y);
    }

    /** @type {number} */
    set r(value) {
      const pt = canvas.grid.cubeToPoint({ q: this.q, r: value });
      this.x = roundNearWhole(pt.x);
      this.y = roundNearWhole(pt.y);
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
      return obj;
    }

    /**
     * Set {x, y, z} based on a hex cube. Faster than setting individually.
     * @param {HexagonalGridCube3d}
     * @param {number} [elevation]    Elevation, in grid units
     * @returns {this} For convenience.
     */
    setToHexCube(hexCube) {
      const { x, y } = canvas.grid.cubeToPoint(hexCube);
      this.x = roundNearWhole(x);
      this.y = roundNearWhole(y);
      return this;
    }

    /**
     * Set x, y, z to center of hex.
     */
    centerToHexCube() {
      const q = Math.round(this.q);
      const r = Math.round(this.r);
      return this.setToHexCube({ q, r });
    }
  }
}



/**
 * A 2d point that can also represent a 3d hex coordinate (q, r, s).
 */
export class HexGridCoordinates extends HexCoordinateMixin(GridCoordinates) {

  static classTypes = new Set([this.name]); // Alternative to instanceof

  static #pool = new Pool(this);

  static releaseObj(obj) { this.#pool.release(obj); }

  static get tmp() { return this.#pool.acquire(); }


}
