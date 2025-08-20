/* globals
foundry,
PIXI,
*/
"use strict";

export const PATCHES = {};
PATCHES.PIXI = {};

import { CutawayPolygon } from "../CutawayPolygon.js";

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
  return Math.pow(this.radius, 2) * Math.PI;
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

/**
 * Does this circle overlap something else?
 * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon|PIXI.Ellipse} other
 * @returns {boolean}
 */
function overlaps(other) {
  if ( other instanceof PIXI.Circle ) return this._overlapsCircle(other);
  if ( other instanceof PIXI.Polygon ) return other._overlapsCircle(this);
  if ( other instanceof PIXI.Rectangle ) return other._overlapsCircle(this);
  if ( other instanceof PIXI.Ellipse ) return other._overlapsCircle(this);
  if ( other.toPolygon) return other.toPolygon()._overlapsCircle(this);
  console.warn("overlaps|shape not recognized.", other);
  return false;
}

/**
 * Does this circle envelop (completely enclose) something else?
 * This is a one-way test; call other.envelops(this) to test the other direction.
 * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon|PIXI.Ellipse} other
 * @returns {boolean}
 */
function envelops(other) {
  if ( other instanceof PIXI.Polygon ) return this._envelopsPolygon(other);
  if ( other instanceof PIXI.Circle ) return this._envelopsCircle(other);
  if ( other instanceof PIXI.Rectangle ) return this._envelopsRectangle(other);
  if ( other.toPolygon ) return this._envelopsPolygon(other.toPolygon());
  console.warn("envelops|shape not recognized.", other);
  return false;
}

/**
 * Detect overlap between this circle and another.
 * @param {PIXI.Circle} other
 * @returns {boolean}
 */
function _overlapsCircle(circle) {
  // Test distance between the two centers.
  // See https://www.geeksforgeeks.org/check-two-given-circles-touch-intersect/#
  const dist2 = PIXI.Point.distanceSquaredBetween(this, circle);
  const r1 = this.radius;
  const r2 = circle.radius;

  // Test for overlap using the radii.
  // if ( dist <= Math.pow(r1 - r2, 2) return true; // This (1) inside circle (2).
  // if ( dist <= Math.pow(r2 - r1, 2) ) return true; // Circle (2) inside this (1).
  // if ( dist < Math.pow(r1 + r2, 2) ) return true; // Circles intersect one another.
  // if ( dist === Math.pow(r1 + r2, 2) ) return true; // Circles touch.

  // Combine the above tests.
  if ( dist2 <= Math.pow(Math.abs(r1 - r2), 2) ) return true;
  if ( dist2 <= Math.pow(r1 + r2, 2) ) return true;
  return false;
}

/**
 * Detect whether this circle envelops another.
 * @param {PIXI.Circle} other
 * @returns {boolean}
 */
function _envelopsCircle(circle) {
  // Test distance between the two centers.
  // See https://www.geeksforgeeks.org/check-two-given-circles-touch-intersect/#
  const dist2 = PIXI.Point.distanceSquaredBetween(this, circle);
  const r1 = this.radius;
  const r2 = circle.radius;
  return (dist2 <= Math.pow(r1 - r2, 2));
}

/**
 * Detect whether this circle envelops a rectangle.
 * @param {PIXI.Rectangle} rect
 * @returns {boolean}
 */
function _envelopsRectangle(rect) {
  // All 4 points of the rectangle must be contained by the circle.
  const { top, left, right, bottom } = rect;
  return (this.contains(left, top)
      && this.contains(right, top)
      && this.contains(right, bottom)
      && this.contains(left, bottom));
}

/**
 * Detect whether this circle envelops a polygon.
 * @param {PIXI.Polygon} poly
 * @returns {boolean}
 */
function _envelopsPolygon(poly) {
  // All points of the polygon must be contained in the circle.
  const iter = poly.iteratePoints({ close: false });
  for ( const pt of iter ) {
    if ( !this.contains(pt.x, pt.y) ) return false;
    pt.release();
  }
  return true;
}

/**
 * Test whether line segment AB intersects this circle.
 * Equivalent to PIXI.Rectangle.prototype.lineSegmentIntersects.
 * @param {Point} a                       The first endpoint of segment AB
 * @param {Point} b                       The second endpoint of segment AB
 * @param {object} [options]              Options affecting the intersect test.
 * @param {boolean} [options.inside]      If true, a line contained within the circle will
 *                                        return true.
 * @returns {boolean} True if intersects.
 */
function lineSegmentIntersects(a, b, { inside = false } = {}) {
  const aContained = this.contains(a.x, a.y);
  const bContained = this.contains(b.x, b.y);
  if ( aContained && bContained ) return inside;
  if ( aContained || bContained ) return true;

  // Both endpoints are outside the circle.
  // Test if the closest point on the segment to the circle is within the circle.
  const ctr = this.center;
  const closest = foundry.utils.closestPointToSegment(ctr, a, b);
  const r2 = this.radius * this.radius;
  const d2 = PIXI.Point.distanceSquaredBetween(closest, ctr);
  return r2 > d2;
}

/**
 * Cutaway a line segment start|end that moves through this circle.
 * Assumes a cylinder, not a sphere.
 * @param {Point3d} start     Starting endpoint for the segment
 * @param {Point3d} end       Ending endpoint for the segment
 * @param {object} [opts]
 * @param {number} [opts.top=1e06]        Top (elevation in pixel units) of the polygon
 * @param {number} [opts.bottom=-1e06]    Bottom (elevation in pixel units) of the polygon
 * @param {number} [opts.isHole=false]    Treat this shape as a hole; reverse the points of the returned polygon
 * @returns {CutawayPolygon[]}
 */
function cutaway(a, b, opts) { return CutawayPolygon.cutawayBasicShape(this, a, b, opts); }

/**
 * Does this circle equal another in position and size?
 * @param {PIXI.Circle} other
 * @returns {boolean}
 */
function equals(other) {
  if ( !(other instanceof PIXI.Circle) ) return false;
  return this.x === other.x
    && this.y === other.y
    && this.radius === other.radius;
}

/**
 * Does this circle almost equal another in position and size?
 * @param {PIXI.Circle} other
 * @param {number} [epsilon=1e-08]    Count as equal if at least this close
 * @returns {boolean}
 */
function almostEqual(other, epsilon = 1e-08) {
  if ( !(other instanceof PIXI.Circle) ) return false;
  return this.x.almostEqual(other.x, epsilon)
    && this.y.almostEqual(other.y, epsilon)
    && this.radius.almostEqual(other.radius, epsilon);
}


/**
 * Return the t0 values from the Foundry quadratic intersection.
 * ----
 * Determine the points of intersection between a line segment (p0,p1) and a circle.
 * There will be zero, one, or two intersections
 * See https://math.stackexchange.com/a/311956.
 * @param {Point} p0            The initial point of the line segment
 * @param {Point} p1            The terminal point of the line segment
 * @param {Point} center        The center of the circle
 * @param {number} radius       The radius of the circle
 * @param {number} [epsilon=0]  A small tolerance for floating point precision
 */
function quadraticIntersection(p0, p1, center, radius, epsilon=0) {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;

  // Quadratic terms where at^2 + bt + c = 0
  const a = Math.pow(dx, 2) + Math.pow(dy, 2);
  const b = (2 * dx * (p0.x - center.x)) + (2 * dy * (p0.y - center.y));
  const c = Math.pow(p0.x - center.x, 2) + Math.pow(p0.y - center.y, 2) - Math.pow(radius, 2);

  // Discriminant
  let disc2 = Math.pow(b, 2) - (4 * a * c);
  if ( disc2.almostEqual(0) ) disc2 = 0; // segment endpoint touches the circle; 1 intersection
  else if ( disc2 < 0 ) return []; // no intersections

  // Roots
  const disc = Math.sqrt(disc2);
  const t1 = (-b - disc) / (2 * a);

  // If t1 hits (between 0 and 1) it indicates an "entry"
  const intersections = [];
  if ( t1.between(0-epsilon, 1+epsilon) ) {
    intersections.push({
      x: p0.x + (dx * t1),
      y: p0.y + (dy * t1),
      t0: t1,
    });
  }
  if ( !disc2 ) return intersections; // 1 intersection

  // If t2 hits (between 0 and 1) it indicates an "exit"
  const t2 = (-b + disc) / (2 * a);
  if ( t2.between(0-epsilon, 1+epsilon) ) {
    intersections.push({
      x: p0.x + (dx * t2),
      y: p0.y + (dy * t2),
      t0: t2,
    });
  }
  return intersections;
}

/**
 * Get all intersection points on this circle for a segment A|B
 * Intersections are sorted from A to B.
 * @param {Point} a             The first endpoint on segment A|B
 * @param {Point} b             The second endpoint on segment A|B
 * @returns {Point[]}           Points where the segment A|B intersects the circle
 */
function segmentIntersections(a, b) {
  const ixs = lineCircleIntersection(a, b, this, this.radius);
  return ixs.intersections;
};

/**
 * Determine the intersection between a line segment and a circle.
 * @param {Point} a                   The first vertex of the segment
 * @param {Point} b                   The second vertex of the segment
 * @param {Point} center              The center of the circle
 * @param {number} radius             The radius of the circle
 * @param {number} epsilon            A small tolerance for floating point precision
 * @returns {LineCircleIntersection}  The intersection of the segment AB with the circle
 */
function lineCircleIntersection(a, b, center, radius, epsilon=1e-8) {
  const r2 = Math.pow(radius, 2);
  let intersections = [];

  // Test whether endpoint A is contained
  const ar2 = Math.pow(a.x - center.x, 2) + Math.pow(a.y - center.y, 2);
  const aInside = ar2 < r2 - epsilon;

  // Test whether endpoint B is contained
  const br2 = Math.pow(b.x - center.x, 2) + Math.pow(b.y - center.y, 2);
  const bInside = br2 < r2 - epsilon;

  // Find quadratic intersection points
  const contained = aInside && bInside;
  if ( !contained ) intersections = quadraticIntersection(a, b, center, radius, epsilon);

  // Return the intersection data
  return {
    aInside,
    bInside,
    contained,
    outside: !contained && !intersections.length,
    tangent: !aInside && !bInside && intersections.length === 1,
    intersections
  };
}

/**
 * Calculates the intersection points of a line segment and a circle using a geometric approach.
 *
 * @param {PIXI.Point} a - The first point of the line segment.
 * @param {PIXI.Point} b - The second point of the line segment.
 * @param {PIXI.Point} center - The center of the circle.
 * @param {number} radius - The radius of the circle.
 * @returns {Array<{x: number, y: number}>} An array of intersection points. The array will be empty if there are no intersections.
 */
function segmentIntersectionsGeometric(a, b) {
  const { radius, center } = this;
  const intersections = [];

  // Vector representing the line segment
  const delta = b.subtract(a);

  // Squared length of the segment.
  const len2 = delta.magnitudeSquared();

  // Handle the case of a zero-length segment (a single point).
  if ( !len2 ) {
    const dist2 = PIXI.Point.distanceSquaredBetween(a, center);

    // Check if the point is on the circle's circumference
    if ( Math.abs(dist2 - (radius * radius)) < 1e-6 ) {
      delta.release();
      return [{ x: a.x, y: a.y, t0: 0 }];
    }
    return [];
  }

  // Find the projection of the vector (center - a) onto the line segment vector (d).
  // The parameter 't' represents how far along the infinite line the closest point is from 'a'.
  const ca = center.subtract(a);
  const t = ca.dot(a) / len2;

  // This is the closest point on the infinite line to the circle's center.
  const closestPoint = PIXI.Point.tmp;
  a.add(delta.multiplyScalar(t, closestPoint), closestPoint);

  // Calculate the squared distance from the circle center to this closest point.
  const dist2 = PIXI.Point.distanceSquaredBetween(center, closestPoint);

  // If this distance is greater than the radius, the line doesn't intersect the circle.
  if (dist2 > radius * radius) {
    delta.release();
    closestPoint.release();
    return [];
  }


  // The line intersects the circle. Now we find the intersection points.
  // We have a right triangle formed by:
  // 1. The circle's center
  // 2. The closest point on the line
  // 3. The intersection point
  // The hypotenuse is the radius. We can use the Pythagorean theorem.
  // radius^2 = dist^2 + half_chord_length^2
  const halfChordDist2 = (radius * radius) - dist2;
  const halfChordDist = Math.sqrt(halfChordDist2);

  // The distance from the 'closestPoint' to each intersection point along the line.
  // We calculate this as a fraction of the segment's length.
  const offset = halfChordDist / Math.sqrt(len2);

  // The two potential intersection points are at parameter values t +/- offset.
  const t1 = t - offset;
  const t2 = t + offset;

  // Check if the first intersection point lies on the segment [a, b].
  // The parameter 't' must be between 0 and 1 for the point to be on the segment.
  if (t1 >= 0 && t1 <= 1) {
    intersections.push({
      x: a.x + t1 * delta.x,
      y: a.y + t1 * delta.y,
      t0: t1,
    });
  }

  // Check the second intersection point.
  if (t2 >= 0 && t2 <= 1) {
    // Avoid adding the same point twice if the line is tangent to the circle.
    if (Math.abs(t1 - t2) > 1e-6) {
      intersections.push({
        x: a.x + t2 * delta.x,
        y: a.y + t2 * delta.y,
        t0: t2,
      });
    }
  }
  delta.release();
  closestPoint.release();
  return intersections;
}



PATCHES.PIXI.GETTERS = { area };

PATCHES.PIXI.METHODS = {
  angleAtPoint,
  translate,
  scaledArea,
  lineSegmentIntersects,
  segmentIntersectionsGeometric,
  segmentIntersections,

  // Equality
  equals,
  almostEqual,

  // Overlap methods
  overlaps,
  _overlapsCircle,

  // Envelop methods
  envelops,
  _envelopsCircle,
  _envelopsRectangle,
  _envelopsPolygon,

  cutaway
};


