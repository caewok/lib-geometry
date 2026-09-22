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

export class TileProperties {

  // ----- NOTE: Elevation ----- //

  /**
   * Bottom of the wall on the z-axis.
   * @param {TileDocument} tileD
   * @returns {number} Finite elevation in pixel units.
   */
  static elevationZ(tileD) { return gridUnitsToPixels(tileD.elevation); }

  // ----- NOTE: Dimensions ----- //

  // ----- NOTE: Properties ----- //




}