/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { gridUnitsToPixels, clamp } from "../util.js";
import { getTokenHeight, calculateTokenHeightFromTokenShape } from "../elevation.js";

/* Token Placeable Properties

Static methods to access basic properties of placeables / placeable documents.
Nearly all take a placeableDocument as a parameter.
All return pixel units where applicable.

Meant to facilitate access of Foundry document properties in a consistent manner.
*/

export class TokenProperties {

  // ----- NOTE: Elevation ----- //

  /**
   * Bottom of the token on the z-axis.
   * @param {TokenDocument} tokenD
   * @returns {number} Elevation in pixel units.
   */
  static bottomZ(tokenD) { return gridUnitsToPixels(tokenD.elevation); }

  /**
   * Top of the token on the z-axis.
   * @param {TokenDocument} tokenD
   * @returns {number} Elevation + full height in pixel units.
   */
  static topZ(tokenD) { return this.bottomZ(tokenD) + this.verticalHeight(tokenD); }

  /**
   * Is this token prone?
   * @param {TokenDocument} tokenD
   * @returns {boolean}
   */
  static isProne(tokenD) {
    const actor = tokenD.actor;
    if ( !actor ) return false;
    const proneStatusId = CONFIG.GeometryLib.CONFIG.proneStatusId;
    return proneStatusId !== "" && actor.statuses && actor.statuses.has(proneStatusId);
  }

  static tokenHeightMultiplier = getTokenHeight;

  /**
   * Determine the token height from its shape.
   * Comparable to wall height method.
   * Full height before any "ducking" or prone.
   * @param {TokenDocument} tokenD
   * @returns {number} Full token height in pixel units.
   */
  static calculateTokenHeightFromTokenShape = calculateTokenHeightFromTokenShape;

  /**
   * Calculated vertical height of a token.
   * Accounts for prone multiplier.
   * @param {TokenDocument} tokenD
   * @returns {number} Height in pixel units.
   */
  static verticalHeight(tokenD) {
    const heightMult = this.isProne ? clamp(CONFIG.GeometryLib.CONFIG.proneMultiplier, 0, 1) : 1;
    return gridUnitsToPixels((this.tokenHeightMultiplier(tokenD)
      || this.calculateTokenHeightFromTokenShape(tokenD)) * heightMult) || 1; // Force at least 1 pixel high
  }

  /**
   * Calculated vision height of the token
   * Accounts for prone multiplier.
   * @param {TokenDocument} tokenD
   * @returns {number} Height in pixel units.
   */
  static visionHeight(tokenD) {
    return Math.max(1, this.verticalHeight(tokenD) * clamp(CONFIG.GeometryLib.CONFIG.visionHeightMultiplier, 0, 1));
  }


}
