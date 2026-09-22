/* globals
canvas,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { gridUnitsToPixels, pixelsToGridUnits, clamp } from "../util.js";
import { OTHER_MODULES } from "../const.js";

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
   * Is the top of this region finite or infinite?
   * @param {RegionDocument} regionD
   * @returns {boolean} True if finite.
   */
  static topIsFinite(regionD) { return Number.isFinite(regionD.elevation.top);
    const WH = OTHER_MODULES.WALL_HEIGHT;
    return WH ? wallD.flags[WH.ID]?.top : false; // Wall Height uses null to indicate infinity.
  }

  /**
   * Is the top of this region finite or infinite?
   * @param {RegionDocument} regionD
   * @returns {boolean} True if finite.
   */
  static bottomIsFinite(regionD) {
    const WH = OTHER_MODULES.WALL_HEIGHT;
    return WH ? wallD.flags[WH.ID]?.top : false; // Wall Height uses null to indicate infinity.
  }


  /**
   * Bottom of the wall on the z-axis.
   * @param {WallDocument} wallD
   * @returns {number} Finite elevation in pixel units.
   */
  static bottomZ(wallD) {
    const WH = OTHER_MODULES.WALL_HEIGHT;
    if ( WH ) {
      const bottom = wallD.flags[WH.ID]?.bottom;
      if ( bottom ) return gridUnitsToPixels(bottom);
    }
    return -this.MAX_ELEV;
  }

  /**
   * Top of the wall on the z-axis.
   * @param {WallDocument} wallD
   * @returns {number} Finite elevation + full height in pixel units.
   */
  static topZ(wallD) {
    const WH = OTHER_MODULES.WALL_HEIGHT;
    if ( WH ) {
      const top = wallD.flags[WH.ID]?.top;
      if ( top ) return gridUnitsToPixels(top);
    }
    return this.MAX_ELEV;
  }

  // ----- NOTE: Dimensions ----- //

  // ----- NOTE: Properties ----- //




}