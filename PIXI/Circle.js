/* globals
PIXI
*/
"use strict";

import { addClassGetter, addClassMethod } from "../util.js";

// ----------------  ADD METHODS TO THE PIXI.CIRCLE PROTOTYPE ------------------------
export function registerPIXICircleMethods() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.registered ??= new Set();
  if ( CONFIG.GeometryLib.registered.has("PIXI.Circle") ) return;


  // ----- Getters/Setters ----- //
  addClassGetter(PIXI.Circle.prototype, "area", area);
  // center - in v11

  // ----- Methods ----- //
  // segmentIntersections - in v11
  // pointAtAngle - in v11
  addClassMethod(PIXI.Circle.prototype, "angleAtPoint", angleAtPoint);
  // pointsForArc - in v11
  // intersectPolygon - in v11
  // pointsBetween - in v11
  addClassMethod(PIXI.Circle.prototype, "translate", translate);
  addClassMethod(PIXI.Circle.prototype, "scaledArea", scaledArea);

  CONFIG.GeometryLib.registered.add("PIXI.Circle");
}

/**
 * Calculate the angle of a point in relation to a circle.
 * This is the angle of a line from the circle center to the point.
 * Reverse of PIXI.Circle.prototype.pointAtAngle.
 * @param {Point} point
 * @returns {number} Angle in radians.
 */
function angleAtPoint(point) {
  return Math.atan2(point.y - this.y, point.x - this.x);
}

/**
 * Determine the area of this circle
 * @returns {number}
 */
function area() {
  return Math.pow(this.radius * 2) * Math.PI;
}

/**
 * Move this circle by given x,y delta
 * @param {number} dx
 * @param {number} dy
 * @returns {PIXI.Circle} New circle
 */
function translate(dx, dy) {
  return new PIXI.Circle(this.x + dx, this.y + dy, this.radius);
}

/**
 * Area that matches clipper measurements, so it can be compared with Clipper Polygon versions.
 * Used to match what Clipper would measure as area, by scaling the points.
 * @param {object} [options]
 * @param {number} [scalingFactor]  Scale like with PIXI.Polygon.prototype.toClipperPoints.
 * @returns {number}  Positive if clockwise. (b/c y-axis is reversed in Foundry)
 */
function scaledArea({scalingFactor = 1} = {}) {
  return this.toPolygon().scaledArea({scalingFactor});
}
