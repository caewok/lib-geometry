/* globals
PIXI,
*/
"use strict";

import { CutawayPolygon } from "../CutawayPolygon.js";

export const PATCHES = {};
PATCHES.PIXI = {};

/* Temporary shapes for calculations */
const _tmpCir = new PIXI.Circle();
const _tmpRect = new PIXI.Rectangle();

/**
 * Set a temporary rectangle to the rectangle representing the rounded rectangle.
 * @param {PIXI.RoundedRectangle} rr
 * @returns {PIXI.Rectangle}
 */
function tmpRect(rr) {
  _tmpRect.x = rr.x;
  _tmpRect.y = rr.y;
  _tmpRect.width = rr.width;
  _tmpRect.height = rr.height;
  return _tmpRect;
}

/** @type {number} */
const SIDES = {
  TL: 0,
  TR: 1,
  BR: 2,
  BL: 3,
};

/**
 * Set a temporary circle to the circle representing a corner of the rounded rectangle.
 * @param {PIXI.RoundedRectangle} rr
 * @param {SIDES} side
 * @returns {PIXI.Circle}
 */
function tmpCircle(rr, side) {
  _tmpCir.radius = rr.radius;
  switch ( side ) {
    case SIDES.TL:
      _tmpCir.x = rr.x + rr.width;
      _tmpCir.y = rr.y + rr.height;
      break;
    case SIDES.TR:
      _tmpCir.x = rr.x - rr.width;
      _tmpCir.y = rr.y + rr.height;
      break;
    case SIDES.BR:
      _tmpCir.x = rr.x - rr.width;
      _tmpCir.y = rr.y - rr.height;
      break;
    case SIDES.BL:
      _tmpCir.x = rr.x + rr.width;
      _tmpCir.y = rr.y - rr.height;
      break;
  }
  return _tmpCir;
}

/* ----- NOTE: Foundry Rectangle methods ----- */

/*
Remember, contains for rectangles returns true if on the left or top edge.
Returns false if on the bottom or right edge.
*/

/**
 * Calculate center of this rectangle.
 * @type {PIXI.Point}
 */
function center() { return tmpRect(this).center; }

/**
 * Return the bounding box for a PIXI.Rectangle.
 * The bounding rectangle is normalized such that the width and height are non-negative.
 * @returns {PIXI.Rectangle}
 */
function getBounds() { return tmpRect(this).getBounds(); }

/**
 * Determine if a point is on or nearly on this rectangle.
 * @param {Point} p           Point to test
 * @returns {boolean}         Is the point on the rectangle boundary?
 */
function pointIsOn(p) {
  if ( p.x >= this.x && p.x <= this.x + this.width ) {
    if ( p.y >= this.y && p.y <= this.y + this.height ) {
      const d = this.radius * 2;

      // Check each corner.
      // TL
      if ( p.x <= this.x + d && p.y <= this.y + d ) {
        // Must be in the TL circle quadrant. x < center.x, y < center.x
        const cir = tmpCircle(this, SIDES.TL);
        const cirCenter = cir.center;
        if ( p.x > cirCenter.x || p.y > cirCenter.y ) return false;
        return cir.pointIsOn(p);
      }

      // TR
      if ( p.x >= this.x - d && p.y <= this.y + d ) {
        // Must be in the TR circle quadrant. x > center.x, y < center.x
        const cir = tmpCircle(this, SIDES.TR);
        const cirCenter = cir.center;
        if ( p.x < cirCenter.x || p.y > cirCenter.y ) return false;
        return cir.pointIsOn(p);
      }

      // BL
      if ( p.x >= this.x - d && p.y >= this.y - d ) {
        // Must be in the BL circle quadrant. x > center.x, y > center.x
        const cir = tmpCircle(this, SIDES.BL);
        const cirCenter = cir.center;
        if ( p.x < cirCenter.x || p.y < cirCenter.y ) return false;
        return cir.pointIsOn(p);
      }

      // BR
      if ( p.x <= this.x + d && p.y >= this.y - d ) {
        // Must be in the BR circle quadrant. x < center.x, y > center.x
        const cir = tmpCircle(this, SIDES.BR);
        const cirCenter = cir.center;
        if ( p.x > cirCenter.x || p.y < cirCenter.y ) return false;
        return cir.pointIsOn(p);
      }

      // Otherwise, within the rectangular portion.
      return tmpRect(this).pointIsOn(p);
    }
  }
  return false;
}

/**
   * Get all the points (corners) for a polygon approximation of a rectangle between two points on the rectangle.
   * The two points can be anywhere in 2d space on or outside the rectangle.
   * The starting and ending side are based on the zone of the corresponding a and b points.
   * (See PIXI.Rectangle.CS_ZONES.)
   * This is the rectangular version of PIXI.Circle.prototype.pointsBetween, and is similarly used
   * to draw the portion of the shape between two intersection points on that shape.
   * @param { Point } a   A point on or outside the rectangle, representing the starting position.
   * @param { Point } b   A point on or outside the rectangle, representing the starting position.
   * @returns { Point[]}  Points returned are clockwise from start to end.
   */
function pointsBetween(a, b) {
  // It is difficult to identify the starting point given the circular corners, so use polygon for now.
  return this.toPolygon().pointsBetween(a, b);
}

/**
 * Get all intersection points for a segment A|B
 * Intersections are sorted from A to B.
 * @param {Point} a   Endpoint A of the segment
 * @param {Point} b   Endpoint B of the segment
 * @returns {Point[]} Array of intersections or empty if no intersection.
 *  If A|B is parallel to an edge of this rectangle, returns the two furthest points on
 *  the segment A|B that are on the edge.
 *  The return object's t0 property signifies the location of the intersection on segment A|B.
 *  This will be NaN if the segment is a point.
 *  The return object's t1 property signifies the location of the intersection on the rectangle edge.
 *  The t1 value is measured relative to the intersecting edge of the rectangle.
 */
function segmentIntersections(a, b) {
  const diameter = this.radius * 2;
  const ixs = [];

  // TL
  const tlIxs = tmpCircle(this, SIDES.TL).segmentIntersections(a, b)
    .filter(ix => ix.x.between(this.x, this.x + diameter, true) && ix.y.between(this.y, this.y + diameter));
  ixs.push(...tlIxs);

  // TR
  const trIxs = tmpCircle(this, SIDES.TR).segmentIntersections(a, b)
    .filter(ix => ix.x.between(this.x, this.x + diameter, true) && ix.y.between(this.y, this.y + diameter));
  ixs.push(...trIxs);

  // BR
  const brIxs = tmpCircle(this, SIDES.BR).segmentIntersections(a, b)
    .filter(ix => ix.x.between(this.x, this.x + diameter, true) && ix.y.between(this.y, this.y + diameter));
  ixs.push(...brIxs);

  // BL
  const blIxs = tmpCircle(this, SIDES.BL).segmentIntersections(a, b)
    .filter(ix => ix.x.between(this.x, this.x + diameter, true) && ix.y.between(this.y, this.y + diameter));
  ixs.push(...blIxs);

  // Remainder
  const rectIxs = tmpRect(this).segmentIntersections(a, b)
    .filter(ix => (ix.x.between(this.x + diameter, this.x + this.width - diameter) && ix.y.almostEqual(this.y)) // Top
      || (ix.x.between(this.x + diameter, this.x + this.width - diameter) && ix.y.almostEqual(this.y + this.height)) // Bottom
      || (ix.y.between(this.y + diameter, this.y + this.height - diameter) && ix.x.almostEqual(this.x)) // Left
      || (ix.y.between(this.y + diameter, this.y + this.height - diameter) && ix.x.almostEqual(this.x + this.width))); // Right
  ixs.push(...rectIxs);

  // Sort to order a --> b.
  ixs.sort((a, b) => a.t0 - b.t0);
  return ixs;
}


/**
 * Convert this PIXI.Rectangle into a PIXI.Polygon
 * @returns {PIXI.Polygon}      The Rectangle expressed as a PIXI.Polygon
 */
function toPolygon() {
  const diameter = this.radius * 2;
  const points = [];

  // TL
  let a = PIXI.Point.tmp.set(this.x, this.y + diameter); // Use new a and b each time b/c part of out points.
  let b = PIXI.Point.tmp.set(this.x + diameter, this.y);
  const tl = tmpCircle(this, SIDES.TL).pointsBetween(a, b);
  points.push(a, ...tl, b);

  // TR
  a =  PIXI.Point.tmp.set(this.x + this.width - diameter, this.y);
  b =  PIXI.Point.tmp.set(this.x + this.width, this.y + diameter);
  const tr = tmpCircle(this, SIDES.TR).pointsBetween(a, b);
  points.push(a, ...tr, b);

  // BR
  a =  PIXI.Point.tmp.set(this.x + this.width, this.y + this.height - diameter);
  b =  PIXI.Point.tmp.set(this.x + this.width - diameter, this.y + this.height);
  const br = tmpCircle(this, SIDES.BR).pointsBetween(a, b);
  points.push(a, ...br, b);

  // BL
  a = PIXI.Point.tmp.set(this.x + diameter, this.y + this.height);
  b = PIXI.Point.tmp.set(this.x, this.y + this.height - diameter);
  const bl = tmpCircle(this, SIDES.BL).pointsBetween(a, b);
  points.push(a, ...bl, b);

  const poly = new PIXI.Polygon(points);
  points.forEach(pt => pt.release()); // PIXI.Polygon copies all the point coordinate values.
  return poly;
}

/**
 * Test whether a line segment AB intersects this rectangle.
 * @param {Point} a                       The first endpoint of segment AB
 * @param {Point} b                       The second endpoint of segment AB
 * @param {object} [options]              Options affecting the intersect test.
 * @param {boolean} [options.inside]      If true, a line contained within the rectangle will
 *                                        return true.
 * @returns {boolean} True if intersects.
 */
function lineSegmentIntersects(a, b, { inside = false } = {}) {
  const rect = tmpRect(this);
  if ( !rect.lineSegmentIntersects(a, b, { inside }) ) return false;

  // Difficult to test the rest without getting the actual intersections.
  // For now, convert to polygon.
  return this.toPolygon().lineSegmentIntersects(a, b, { inside });
}

/**
 * Intersect with a PIXI.Polygon.
 * See PIXI.Rectangle.prototype.intersectPolygon
 */
function intersectPolygon(polygon, opts) {
  return this.toPolygon().intersectPolygon(polygon, opts);
}


/* ----- NOTE: libGeometry Rectangle methods ----- */

/**
 * Calculate area of rectangle
 * @returns {number}
 */
function area() {
  let area = this.width * this.height;

  // Subtract each circle's bounds but add back in the circle area.
  for ( const side of Object.values(SIDES) ) {
    const cirTL = tmpCircle(this, side);
    area -= cirTL.getBounds().area;
    area += cirTL.area;
  }
  return area;
}

/**
 * Does this rectangle equal another in position and size?
 * @param {PIXI.Rectangle} other
 * @returns {boolean}
 */
function equals(other) {
  if ( !(other instanceof PIXI.RoundedRectangle) ) return false;
  return this.x === other.x
    && this.y === other.y
    && this.width === other.width
    && this.height === other.height
    && this.radius === other.radius;
}

/**
 * Does this rectangle almost equal another in position and size?
 * @param {PIXI.Rectangle} other
 * @param {number} [epsilon=1e-08]    Count as equal if at least this close
 * @returns {boolean}
 */
function almostEqual(other, epsilon = 1e-08) {
  if ( !(other instanceof PIXI.RoundedRectangle) ) return false;
  return this.x.almostEqual(other.x, epsilon)
    && this.y.almostEqual(other.y, epsilon)
    && this.width.almostEqual(other.width, epsilon)
    && this.height.almostEqual(other.height, epsilon)
    && this.radius.almostEqual(other.radius, epsilon);
}


/**
 * Iterate over the rectangles's {x, y} points in order.
 * @param {object} [options]
 * @param {boolean} [options.close]   If close, include the first point again.
 * @returns {x, y} PIXI.Point
 */
function* iteratePoints({close = true} = {}) {
  const poly = this.toPolygon();
  for ( const pt of poly.iteratePoints({ close }) ) yield pt;
}

/**
 * Does this rectangle overlap something else?
 * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon} shape
 * @returns {boolean}
 */
function overlaps(shape) { return this.toPolygon().overlaps(shape); }

/**
 * Does this rectangle envelop something else?
 * This is a one-way test; call other.envelops(this) to test the other direction.
 * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon} shape
 * @returns {boolean}
 */
function envelops(shape) { return this.toPolygon().envelops(shape); }

/**
 * Move this rectangle by given x,y delta.
 * @param {number} dx
 * @param {number} dy
 * @returns {PIXI.Rectangle} New rectangle.
 */
function translate(dx, dy) {
  return new PIXI.RoundedRectangle(this.x + dx, this.y + dy, this.width, this.height, this.radius);
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
  return this.toPolygon.viewablePoints(origin, { outermostOnly });
}

/**
 * Cutaway a line segment start|end that moves through this rectangle.
 * @param {Point3d} a       Starting endpoint for the segment
 * @param {Point3d} b       Ending endpoint for the segment
 * @param {object} [opts]
 * @param {Point3d} [opts.start]              Starting endpoint for the segment
 * @param {Point3d} [opts.end]                Ending endpoint for the segment
 * @param {function} [opts.topElevationFn]    Function to calculate the top elevation for a position
 * @param {function} [opts.bottomElevationFn] Function to calculate the bottom elevation for a position
 * @param {number} [opts.isHole=false]        Treat this shape as a hole; reverse the points of the returned polygon
 * @returns {CutawayPolygon[]}
 */
function cutaway(a, b, opts) { return CutawayPolygon.cutawayBasicShape(this, a, b, opts); }

PATCHES.PIXI.GETTERS = {
  center,
  area,
};

PATCHES.PIXI.METHODS = {
  // Foundry
  getBounds,
  pointIsOn,
  pointsBetween,
  segmentIntersections,
  toPolygon,
  lineSegmentIntersects,
  intersectPolygon,


  // Iterators
  iteratePoints,

  // Equality
  equals,
  almostEqual,

  // Other methods
  translate,
  viewablePoints,

  // Overlap methods
  overlaps,

  // Envelop methods
  envelops,

  // Used by Elevation Ruler and Terrain Mapper
  cutaway,

  // Helper methods
  scaledArea
};
