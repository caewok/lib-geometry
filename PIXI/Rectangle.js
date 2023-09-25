/* globals
CONFIG,
PIXI
*/
"use strict";

import { addClassGetter, addClassMethod } from "../util.js";

// ----------------  ADD METHODS TO THE PIXI.RECTANGLE PROTOTYPE ------------------------
export function registerPIXIRectangleMethods() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.registered ??= new Set();
  if ( CONFIG.GeometryLib.registered.has("PIXI.Rectangle") ) return;

  // ----- Static methods ----- //
  addClassMethod(PIXI.Rectangle, "gridRectangles", gridRectangles);

  // ----- Getters/Setters ----- //
  addClassGetter(PIXI.Rectangle.prototype, "area", area);
  // center - in v11

  // ----- Iterators ----- //
  addClassMethod(PIXI.Rectangle.prototype, "iterateEdges", iterateEdges);

  // ----- Methods ----- //
  // _getEdgeZone - in v11
  // intersectPolygon - in v11
  // pointsBetween - in v11
  // segmentIntersections - in v11
  addClassMethod(PIXI.Rectangle.prototype, "difference", difference);
  addClassMethod(PIXI.Rectangle.prototype, "translate", translate);
  addClassMethod(PIXI.Rectangle.prototype, "viewablePoints", viewablePoints);

  // Overlap methods
  addClassMethod(PIXI.Rectangle.prototype, "overlaps", overlaps);
  addClassMethod(PIXI.Rectangle.prototype, "_overlapsCircle", overlapsCircle);
  addClassMethod(PIXI.Rectangle.prototype, "_overlapsPolygon", overlapsPolygon);
  addClassMethod(PIXI.Rectangle.prototype, "_overlapsRectangle", overlapsRectangle);

  // Envelop methods
  addClassMethod(PIXI.Rectangle.prototype, "envelops", envelops);
  addClassMethod(PIXI.Rectangle.prototype, "_envelopsCircle", envelopsCircle);
  addClassMethod(PIXI.Rectangle.prototype, "_envelopsRectangle", envelopsRectangle);
  addClassMethod(PIXI.Rectangle.prototype, "_envelopsPolygon", envelopsPolygon);

  // ----- Helper methods ----- //
  addClassMethod(PIXI.Rectangle.prototype, "scaledArea", scaledArea);

  CONFIG.GeometryLib.registered.add("PIXI.Rectangle");
}

/**
 * Calculate area of rectangle
 * @returns {number}
 */
function area() {
  return this.width * this.height;
}

/**
 * Iterate over the rectangle's edges in order.
 * (Use close = true to return the last --> first edge.)
 * @param {object} [options]
 * @param {boolean} [close]   If true, return last point --> first point as edge.
 * @returns Return an object { A: {x, y}, B: {x, y}} for each edge
 * Edges link, such that edge0.B === edge.1.A.
 */
function* iterateEdges({close = true} = {}) {
  const A = { x: this.x, y: this.y };
  const B = { x: this.x + this.width, y: this.y };
  const C = { x: this.x + this.width, y: this.y + this.height };
  const D = { x: this.x, y: this.y + this.height };

  yield { A, B };
  yield { A: B, B: C };
  yield { A: C, B: D };
  if ( close ) yield { A: D, B: A };
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
 * Does this rectangle envelop something else?
 * This is a one-way test; call other.envelops(this) to test the other direction.
 * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon} shape
 * @returns {boolean}
 */
function envelops(shape) {
  if ( shape instanceof PIXI.Polygon ) { return this._envelopsPolygon(shape); }
  if ( shape instanceof PIXI.Circle ) { return this._envelopsCircle(shape); }
  if ( shape instanceof PIXI.Rectangle ) { return this._envelopsRectangle(shape); }
  if ( shape.toPolygon) return this._envelopsPolygon(shape.toPolygon());
  console.warn("overlaps|shape not recognized.", shape);
  return false;
}

/**
 * Does this rectangle overlap a circle?
 * @param {PIXI.Circle} circle
 * @return {boolean}
 */
function overlapsCircle(circle) {
  // https://www.geeksforgeeks.org/check-if-any-point-overlaps-the-given-circle-and-rectangle

  // {xn,yn} is the nearest point on the rectangle to the circle center
  const xn = Math.max(this.left, Math.min(circle.x, this.right));
  const yn = Math.max(this.top, Math.min(circle.y, this.bottom));

  // Find the distance between the nearest point and the center of the circle
  const dx = xn - circle.x;
  const dy = yn - circle.y;
  return (Math.pow(dx, 2) + Math.pow(dy, 2)) <= Math.pow(circle.radius, 2);
}

/**
 * Does this rectangle overlap a polygon?
 * @param {PIXI.Polygon} poly
 * @return {boolean}
 */
function overlapsPolygon(poly) {
  if ( poly.contains(this.left, this.top)
    || poly.contains(this.right, this.top)
    || poly.contains(this.left, this.bottom)
    || poly.contains(this.right, this.bottom)) return true;

  const pts = poly.iteratePoints({ close: true });
  let a = pts.next().value;
  if ( this.contains(a.x, a.y) ) return true;

  for ( const b of pts ) {
    if ( this.lineSegmentIntersects(a, b) || this.contains(b.x, b.y) ) return true;
    a = b;
  }

  return false;
}

/**
 * Does this rectangle overlap another?
 * @param {PIXI.Rectangle} other
 * @return {boolean}
 */
function overlapsRectangle(rect) {
  // https://www.geeksforgeeks.org/find-two-rectangles-overlap
  // One rectangle is completely above the other
  if ( this.top > rect.bottom || rect.top > this.bottom ) return false;

  // One rectangle is completely to the left of the other
  if ( this.left > rect.right || rect.left > this.right ) return false;

  return true;
}

/**
 * Does this rectangle envelop another?
 * @param {PIXI.Rectangle} rect
 * @returns {boolean}
 */
function envelopsRectangle(rect) {
  // All 4 points must be contained within.
  const { top, left, right, bottom } = rect;
  return (this.contains(left, top)
       && this.contains(right, top)
       && this.contains(right, bottom)
       && this.contains(left, bottom));
}

/**
 * Does this rectangle envelop a circle?
 * @param {PIXI.Circle} circle
 * @returns {boolean}
 */
function envelopsCircle(circle) {
  // Center point must be contained.
  if ( !this.contains(circle.x, circle.y) ) return false;

  // Four compass points extending from the circle must be contained.
  const r = circle.radius;
  return (this.contains(circle.x - r, circle.y)   // W
       && this.contains(circle.x + r, circle.y)   // E
       && this.contains(circle.x, circle.y - r)   // N
       && this.contains(circle.x, circle.y + r)); // S
}

/**
 * Does this rectangle envelop a polygon?
 * @param {PIXI.Polygon} poly
 * @returns {boolean}
 */
function envelopsPolygon(poly) {
  // All points of the polygon must be contained in the circle.
  const iter = poly.iteratePoints({ close: false });
  for ( const pt of iter ) {
    if ( !this.contains(pt.x, pt.y) ) return false;
  }
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
    case zones.TOPLEFT: return [
      { x: bbox.left, y: bbox.bottom },
      { x: bbox.left, y: bbox.top },
      { x: bbox.right, y: bbox.top }
    ];
    case zones.TOPRIGHT: return [
      { x: bbox.left, y: bbox.top },
      { x: bbox.right, y: bbox.top },
      { x: bbox.right, y: bbox.bottom }
    ];
    case zones.BOTTOMLEFT: return [
      { x: bbox.right, y: bbox.bottom },
      { x: bbox.left, y: bbox.bottom },
      { x: bbox.left, y: bbox.top }
    ];
    case zones.BOTTOMRIGHT: return [
      { x: bbox.right, y: bbox.top },
      { x: bbox.right, y: bbox.bottom },
      { x: bbox.left, y: bbox.bottom }
    ];
    case zones.RIGHT: return [{ x: bbox.right, y: bbox.top }, { x: bbox.right, y: bbox.bottom }];
    case zones.LEFT: return [{ x: bbox.left, y: bbox.bottom }, { x: bbox.left, y: bbox.top }];
    case zones.TOP: return [{ x: bbox.left, y: bbox.top }, { x: bbox.right, y: bbox.top }];
    case zones.BOTTOM: return [{ x: bbox.right, y: bbox.bottom }, { x: bbox.left, y: bbox.bottom }];
  }

  return undefined; // Should not happen
}

/**
 * Get the difference between the two rectangles
 * If no overlap, will return null
 * @param {PIXI.Rectangle} other
 * @returns {null| {A: PIXI.Rectangle, B: PIXI.Rectangle}}
 *   A: portion of this rectangle
 *   B: portion of other rectangle
 */
function difference(other, recurse = true) {
  if ( this.right < other.x ) return null; // Left
  if ( this.bottom < other.y ) return null; // Top
  if ( this.x > other.right ) return null; // Right
  if ( this.y > other.bottom ) return null; // Bottom

  // Completely equal
  if ( this.x === other.x
    && this.y === other.y
    && this.width === other.width
    && this.height === other.height ) return null;

  // Options:
  // 1. One rectangle contains only 1 corner of the other.
  // 2. One rectangle contains 2 corners of the other.
  // 3. One rectangle contains 4 corners of the other (encompasses the other).

  const Acontained = this.contains(other.x, other.y);
  const Bcontained = this.contains(other.right, other.y);
  const Ccontained = this.contains(other.right, other.bottom);
  const Dcontained = this.contains(other.x, other.bottom);
  const nContained = Acontained + Bcontained + Ccontained + Dcontained;

  if ( nContained === 0 && recurse ) {
    // Other contains this rectangle
    const out = other.difference(this, false); // Set recurse = false to avoid endless loops if there is an error.
    [out.thisDiff, out.otherDiff] = [out.otherDiff, out.thisDiff];
    return out;
  }

  const g = PIXI.Rectangle.gridRectangles(this, other);
  const out = { thisDiff: [], otherDiff: [], g };
  switch ( nContained ) {
    case 1:
      if ( Acontained ) {
        out.thisDiff = [g.topLeft, g.topMiddle, g.centerLeft];
        out.otherDiff = [g.centerRight, g.bottomRight, g.bottomMiddle];
      } else if ( Bcontained ) {
        out.thisDiff = [g.topMiddle, g.topRight, g.centerRight];
        out.otherDiff = [g.centerLeft, g.bottomMiddle, g.bottomLeft];
      } else if ( Ccontained ) {
        out.thisDiff = [g.centerRight, g.bottomRight, g.bottomMiddle];
        out.otherDiff = [g.topLeft, g.topMiddle, g.centerLeft];
      } else if ( Dcontained ) {
        out.thisDiff = [g.centerLeft, g.bottomMiddle, g.bottomLeft];
        out.otherDiff = [g.topMiddle, g.topRight, g.centerRight];
      }
      break;
    case 2:
      if ( Acontained && Bcontained ) {
        out.thisDiff = [g.topLeft, g.topMiddle, g.topRight, g.centerRight, g.centerLeft];
        out.otherDiff = [g.bottomMiddle];
      } else if ( Bcontained && Ccontained ) {
        out.thisDiff = [g.topMiddle, g.topRight, g.centerRight, g.bottomRight, g.bottomMiddle];
        out.otherDiff = [g.centerLeft];
      } else if ( Ccontained && Dcontained ) {
        out.thisDiff = [g.centerRight, g.bottomRight, g.bottomMiddle, g.bottomLeft, g.centerLeft];
        out.otherDiff = [g.topMiddle];
      } else if ( Dcontained && Acontained ) {
        out.thisDiff = [g.topLeft, g.topMiddle, g.bottomMiddle, g.bottomLeft, g.centerLeft];
        out.otherDiff = [g.centerRight];
      }
      break;
    case 3: break; // Shouldn't happen
    case 4:
      // Same as case 0 but for thisDiff.
      out.thisDiff = [
        g.topLeft, g.topMiddle, g.topRight,
        g.centerLeft, g.centerRight,
        g.bottomLeft, g.bottomMiddle, g.bottomRight
      ];
      break;
  }

  out.thisDiff = out.thisDiff.filter(r => r.width > 0 && r.height > 0);
  out.otherDiff = out.otherDiff.filter(r => r.width > 0 && r.height > 0);
  return out;
}

/**
 * Determine the grid coordinates of all combinations of two rectangles.
 * Order of the two rectangles does not matter.
 * @param {PIXI.Rectangle} rect1    First rectangle
 * @param {PIXI.Rectangle} rect2    Second rectangle
 * @returns {object}  Object with 9 rectangles. Some may have zero width or height.
 */
function gridRectangles(rect1, rect2) {
  // Order the xs and ys
  const xArr = [rect1.x, rect1.right, rect2.x, rect2.right].sort((a, b) => a - b);
  const yArr = [rect1.y, rect1.bottom, rect2.y, rect2.bottom].sort((a, b) => a - b);

  const [x1, x2, x3, x4] = xArr;
  const [y1, y2, y3, y4] = yArr;

  const w1 = x2 - x1;
  const w2 = x3 - x2;
  const w3 = x4 - x3;

  const h1 = y2 - y1;
  const h2 = y3 - y2;
  const h3 = y4 - y3;

  return {
    topLeft: new PIXI.Rectangle(x1, y1, w1, h1),
    topMiddle: new PIXI.Rectangle(x2, y1, w2, h1),
    topRight: new PIXI.Rectangle(x3, y1, w3, h1),

    centerLeft: new PIXI.Rectangle(x1, y2, w1, h2),
    centerMiddle: new PIXI.Rectangle(x2, y2, w2, h2),
    centerRight: new PIXI.Rectangle(x3, y2, w3, h2),

    bottomLeft: new PIXI.Rectangle(x1, y3, w1, h3),
    bottomMiddle: new PIXI.Rectangle(x2, y3, w2, h3),
    bottomRight: new PIXI.Rectangle(x3, y3, w3, h3)
  };
}
