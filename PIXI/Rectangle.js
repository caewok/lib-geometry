/* globals
PIXI,
CONFIG
*/
"use strict";

import { addClassGetter, addClassMethod } from "../util.js";

// ----------------  ADD METHODS TO THE PIXI.RECTANGLE PROTOTYPE ------------------------
export function registerPIXIRectangleMethods() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.Registered ??= {};
  if ( CONFIG.GeometryLib.Registered.PIXIRectangle ) return;
  CONFIG.GeometryLib.Registered.PIXIRectangle = true;

  // ----- Getters/Setters ----- //
  addClassGetter(PIXI.Rectangle.prototype, "area", area);

  // ----- Methods ----- //
  addClassMethod(PIXI.Rectangle.prototype, overlaps, "overlaps");
  addClassMethod(PIXI.Rectangle.prototype, translate, "translate");
  addClassMethod(PIXI.Rectangle.prototype, viewablePoints, "viewablePoints");

  // ----- Helper methods ----- //
  addClassMethod(PIXI.Rectangle.prototype, overlapsCircle, "_overlapsCircle");
  addClassMethod(PIXI.Rectangle.prototype, overlapsPolygon, "_overlapsPolygon");
  addClassMethod(PIXI.Rectangle.prototype, overlapsRectangle, "_overlapsRectangle");
  addClassMethod(PIXI.Rectangle.prototype, scaledArea, "scaledArea");
}

/**
 * Calculate area of rectangle
 * @returns {number}
 */
function area() {
  return this.width * this.height;
}

/**
 * Does this rectangle overlap something else?
 * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon} shape
 * @returns {boolean}
 */
function overlaps(shape) {
  if ( shape instanceof PIXI.Polygon ) { return this._overlapsPolygon(shape); }
  if ( shape instanceof PIXI.Circle ) { return this._overlapsCircle(shape); }
  if ( shape instanceof PIXI.Rectangle ) { return this._overlapsRectangle(shape); }

  if ( shape.toPolygon) return this._overlapsPolygon(shape.toPolygon());

  console.warn("overlaps|shape not recognized.", shape);
  return false;
}

/**
 * Does this rectangle overlap a circle?
 * @param {PIXI.Circle} circle
 * @return {Boolean}
 */
function overlapsCircle(circle) {
  // https://www.geeksforgeeks.org/check-if-any-point-overlaps-the-given-circle-and-rectangle
  // {xn,yn} is the nearest point on the rectangle to the circle center
  const xn = Math.max(this.right, Math.min(circle.x, this.left));
  const yn = Math.max(this.top, Math.min(circle.y, this.bottom));

  // Find the distance between the nearest point and the center of the circle
  const dx = xn - circle.x;
  const dy = yn - circle.y;
  return (Math.pow(dx, 2) + Math.pow(dy, 2)) <= Math.pow(circle.radius, 2);
}

/**
 * Does this rectangle overlap a polygon?
 * @param {PIXI.Polygon} poly
 * @return {Boolean}
 */
function overlapsPolygon(poly) {
  if ( poly.contains(this.left, this.top)
    || poly.contains(this.right, this.top)
    || poly.contains(this.left, this.bottom)
    || poly.contains(this.right, this.bottom)) return true;

  poly.close();
  const pts = poly.points;
  const ln = pts.length;
  let a = { x: pts[0], y: pts[1] };
  if ( this.contains(a.x, a.y) ) return true;
  for ( let i = 2; i < ln; i += 2 ) {
    const b = { x: pts[i], y: pts[i+1] };
    if ( this.lineSegmentIntersects(a, b) || this.contains(b.x, b.y) ) return true;
    a = b;
  }
  return false;
}

/**
 * Does this rectangle overlap another?
 * @param {PIXI.Rectangle} other
 * @return {Boolean}
 */
function overlapsRectangle(other) {
  // https://www.geeksforgeeks.org/find-two-rectangles-overlap
  // One rectangle is completely above the other
  if ( this.top > other.bottom || other.top > this.bottom ) return false;

  // One rectangle is completely to the left of the other
  if ( this.left > other.right || other.left > this.right ) return false;

  return true;
}

/**
 * Move this rectangle by given x,y delta.
 * @param {number} dx
 * @param {number} dy
 * @returns {PIXI.Rectangle} New rectangle.
 */
function translate(dx, dy) {
  return new PIXI.Rectangle(this.x + dx, this.y + dy, this.width, this.height);
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

/**
 * Returns the viewable of the rectangle that make up the viewable perimeter
 * as seen from an origin.
 * @param {Point} origin                  Location of the viewer, in 2d.
 * @param {object} [options]
 * @param {boolean} [options.outermostOnly]   Return only the outermost two points
 * @returns {Point[]|null}
 */
function viewablePoints(origin, { outermostOnly = true } = {}) {
  const pts = getViewablePoints(this, origin);

  if ( !pts || !outermostOnly ) return pts;

  const ln = pts.length;
  return [pts[0], pts[ln - 1]];
}

/**
 * Helper function to get all the viewable points
 * @param {PIXI.Rectangle} bbox   Bounding box of the shape
 * @param {Point} origin
 * @returns {Point[]|null}
 */
function getViewablePoints(bbox, origin) {
  const zones = PIXI.Rectangle.CS_ZONES;

  switch ( bbox._getZone(origin) ) {
    case zones.INSIDE: return null;
    case zones.TOPLEFT: return [{ x: bbox.left, y: bbox.bottom },  { x: bbox.left, y: bbox.top }, { x: bbox.right, y: bbox.top }];
    case zones.TOPRIGHT: return [{ x: bbox.left, y: bbox.top }, { x: bbox.right, y: bbox.top }, { x: bbox.right, y: bbox.bottom }];
    case zones.BOTTOMLEFT: return [{ x: bbox.right, y: bbox.bottom }, { x: bbox.left, y: bbox.bottom }, { x: bbox.left, y: bbox.top }];
    case zones.BOTTOMRIGHT: return [{ x: bbox.right, y: bbox.top }, { x: bbox.right, y: bbox.bottom }, { x: bbox.left, y: bbox.bottom }];

    case zones.RIGHT: return [{ x: bbox.right, y: bbox.top }, { x: bbox.right, y: bbox.bottom }];
    case zones.LEFT: return [{ x: bbox.left, y: bbox.bottom }, { x: bbox.left, y: bbox.top }];
    case zones.TOP: return [{ x: bbox.left, y: bbox.top }, { x: bbox.right, y: bbox.top }];
    case zones.BOTTOM: return [{ x: bbox.right, y: bbox.bottom }, { x: bbox.left, y: bbox.bottom }];
  }

  return undefined; // Should not happen
}

