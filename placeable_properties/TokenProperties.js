/* globals
canvas,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { gridUnitsToPixels, pixelsToGridUnits, clamp } from "../util.js";
import { OTHER_MODULES } from "../const.js";

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

  /**
   * Determine the token height.
   * TODO: Add config option, replacing Wall Height.
   * @param {TokenDocument} tokenD
   * @returns {number} Full token height in pixel units.
   */
  static _fullVerticalHeight(tokenD) {
    const WH = OTHER_MODULES.WALL_HEIGHT;
    return (WH ? tokenD.flags[WH.ID]?.[WH.FLAGS.TOKEN_HEIGHT] : 0)
      || this._calculateTokenHeightFromTokenShape(tokenD);
  }

  /**
   * Determine the token height from its shape.
   * Comparable to wall height method.
   * Full height before any "ducking" or prone.
   * @param {TokenDocument} tokenD
   * @returns {number} Full token height in pixel units.
   */
  static _calculateTokenHeightFromTokenShape(tokenD) {
    const { width, height, texture } = tokenD;
    const d = canvas.scene.dimensions.distance
      * Math.max(width, height)
      * (Math.abs(texture.scaleX) + Math.abs(texture.scaleY))
      * 0.5;
    return pixelsToGridUnits(d);
  }

  /**
   * Calculated vertical height of a token.
   * Accounts for prone multiplier.
   * @param {TokenDocument} tokenD
   * @returns {number} Height in pixel units.
   */
  static verticalHeight(tokenD) {
    const heightMult = this.isProne(tokenD) ? clamp(CONFIG.GeometryLib.CONFIG.proneMultiplier, 0, 1) : 1;
    return heightMult * this._fullTokenHeight(tokenD);
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
