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

export class RegionProperties {

  /** @type {string} */
  static PLACEABLE_NAME = "Region";

  /** @type {string} */
  static LAYER = "regions";

  // ----- NOTE: Elevation ----- //

  static MAX_ELEV = 1e06;

  /**
   * Is the top of this region finite or infinite?
   * @param {RegionDocument} regionD
   * @returns {boolean} True if finite.
   */
  static topIsFinite(regionD) { return Number.isFinite(regionD.elevation.top); }

  /**
   * Is the top of this region finite or infinite?
   * @param {RegionDocument} regionD
   * @returns {boolean} True if finite.
   */
  static bottomIsFinite(regionD) { return Number.isFinite(regionD.elevation.bottom); }

  /**
   * Bottom of the region on the z-axis.
   * @param {RegionDocument} regionD
   * @returns {number} Finite elevation in pixel units.
   */
  static bottomZ(regionD) {
    const bottom = regionD.elevation.bottom;
    if ( Number.isFinite(bottom) ) return bottom;
    return -this.MAX_ELEV;
  }

  /**
   * Middle of the region on the z-axis.
   * @param {RegionDocument} regionD
   * @returns {number} Finite elevation in pixel units.
   */
  static midZ(regionD) { return this.bottomZ + (this.zHeight(regionD) * 0.5); }

  /**
   * Height along the z axis.
   * @param {RegionDocument} regionD
   * @returns {number} Finite elevation in pixel units.
   */
  static zHeight(regionD) { return this.topZ(regionD) - this.bottomZ(regionD); }

  /**
   * Top of the region on the z-axis.
   * @param {RegionDocument} regionD
   * @returns {number} Finite elevation + full height in pixel units.
   */
  static topZ(regionD) {
    const top = regionD.elevation.top;
    if ( Number.isFinite(top) ) return top + (!this.topInclusive(regionD) * -1);
    return this.MAX_ELEV;
  }

  static topInclusive(regionD) { return regionD.elevation.topInclusive; }

  // ----- NOTE: Shapes ----- //

  /**
   * Is this shape currently restricted by walls?
   * Presumes without test that isWallRestricted returns true; test this separately.
   * @param {RegionShape} regionShape
   * @returns {boolean} True if restricted.
   */
  static shapeIsWallRestricted(regionShape, regionD) {
    if ( !regionD._shapeConstraints ) return false;
    const restrictionBounds = regionD._shapeConstraints.map(constraintArr => new PIXI.Polygon(constraintArr));
    for ( const r of restrictionBounds ) {
      for ( const poly of regionShape.polygons ) {
        if ( poly.overlaps(r) ) return true;
      }
    }
    return false;
  }

  /**
   * Is this shape a hole?
   * @param {RegionShape} regionShape
   * @returns {boolean} True if hole.
   */
  static shapeIsHole(regionShape) { return regionShape.hole; }

  /**
   * Is this shape constrained by the grid?
   * @param {RegionShape} regionShape
   * @returns {boolean} True if restricted.
   */
  static shapeIsGridConstrained(regionShape) { return regionShape.isAffectedByGrid; }

  /**
   * X,Y,Z center of the shape, without regard to anchor
   * @param {RegionShape} regionShape
   * @returns {Point3d}
   */
  static shapeCenter(regionShape) {
    const origin = regionShape.origin;
    return Point3d.tmp.set(origin.x, origin.y, z);
  }

  /**
   * Rotation of the shape along each axis.
   * @param {RegionShape} regionShape
   * @returns {Point3d}
   */


  // ----- NOTE: Properties ----- //

  /**
   * Is this region restricted by walls?
   * @param {RegionDocument} regionD
   * @returns {boolean}
   */
  static wallRestricted(regionD) { return regionD.restriction.enabled; }




}