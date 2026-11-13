/* globals
canvas,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { gridUnitsToPixels, pixelsToGridUnits, clamp } from "../util.js";
import { FLAGS } from "../const.js";

/* Wall Placeable Properties

Static methods to access basic properties of placeables / placeable documents.
Nearly all take a placeableDocument as a parameter.
All return pixel units where applicable.

Meant to facilitate access of Foundry document properties in a consistent manner.
*/

export class WallProperties {

  // ----- NOTE: Elevation ----- //

  static MAX_ELEV = 1e06;

  /**
   * Is the top of this wall finite or infinite?
   * @param {WallDocument} wallD
   * @returns {boolean} True if finite.
   */
  static topIsFinite(wallD) {
    const elev = this.flags[FLAGS.WH_ID]?.[FLAGS.WALL.TOP];
    return Number.isFinite(elev); // Wall Height uses null to indicate infinity.
  }

  /**
   * Is the top of this region finite or infinite?
   * @param {WallDocument} wallD
   * @returns {boolean} True if finite.
   */
  static bottomIsFinite(wallD) {
    const elev = this.flags[FLAGS.WH_ID]?.[FLAGS.WALL.BOTTOM];
    return Number.isFinite(elev); // Wall Height uses null to indicate infinity.
  }


  /**
   * Bottom of the wall on the z-axis.
   * @param {WallDocument} wallD
   * @returns {number} Finite elevation in pixel units.
   */
  static bottomZ(wallD) {
    const elev = this.flags[FLAGS.WH_ID]?.[FLAGS.WALL.BOTTOM];
    return elev ? gridUnitsToPixels(elev) : -this.MAX_ELEV;
  }

  /**
   * Top of the wall on the z-axis.
   * @param {WallDocument} wallD
   * @returns {number} Finite elevation + full height in pixel units.
   */
  static topZ(wallD) {
    const elev = this.flags[FLAGS.WH_ID]?.[FLAGS.WALL.TOP];
    return elev ? gridUnitsToPixels(elev) : this.MAX_ELEV;
  }

  // ----- NOTE: Dimensions ----- //

  // ----- NOTE: Properties ----- //




}