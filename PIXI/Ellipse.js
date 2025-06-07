/* globals
CONFIG,
PIXI,
WeilerAthertonClipper,
*/
"use strict";

export const PATCHES = {};
PATCHES.PIXI = {};

import { Ellipse } from "../Ellipse.js";

/** @type {number} */
function majorRadius() { return Math.max(this.width, this.height); }

/** @type {number} */
function minorRadius() { return Math.min(this.width, this.height); }

/** @type {number} */
function ratio() { return this.majorRadius / this.minorRadius; }

/** @type {PIXI.Point} */
function center() { return new PIXI.Point(this.x, this.y); }

/** @type {number} */
function area() { return Math.PI * this.width * this.height; }

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
 * Shift from cartesian coordinates to the shape space.
 * @param {PIXI.Point} a
 * @param {PIXI.Point} [outPoint] A point-like object to store the result.
 * @returns {PIXI.Point}
 */
function _fromCartesianCoords(a, outPoint) {
  outPoint ??= new PIXI.Point();
  a = PIXI.Point.fromObject(a);

  a.translate(-this.x, -this.y, outPoint);
  return outPoint;
}

/**
 * Shift to cartesian coordinates from the shape space.
 * @param {Point} a
 * @param {PIXI.Point} [outPoint] A point-like object to store the result.
 * @returns {Point}
 */
function _toCartesianCoords(a, outPoint) {
  outPoint ??= new PIXI.Point();
  a = PIXI.Point.fromObject(a);

  a.translate(this.x, this.y, outPoint);
  return outPoint;
}

function _toCircleCoords(a, outPoint) {
  outPoint ??= new PIXI.Point();
  const ratio = this.height / this.width;

  outPoint.x = a.x * ratio;
  outPoint.y = a.y;
  return outPoint;
}

function _fromCircleCoords(a, outPoint) {
  outPoint ??= new PIXI.Point();
  const ratio = this.width / this.height;
  outPoint.x = a.x * ratio;
  outPoint.y = a.y;

  return outPoint;
}

function _toCircle() { return new PIXI.Circle(0, 0, this.height); }

/**
 * Determine if the point is on or nearly on this polygon.
 * @param {Point} point     Point to test
 * @param {number} epsilon  Tolerated margin of error
 * @returns {boolean}       Is the point on the circle within the allowed tolerance?
 */
function pointIsOn(point, epsilon = 1e-08) {
  const { width, height } = this;
  if ( width <= 0 || height <= 0 ) return false;

  // Move point to Ellipse-space
  const pt = PIXI.Point.fromObject(point);
  this._fromCartesianCoords(pt, pt);

  // Reject if x is outside the bounds
  if ( pt.x < -width
    || pt.x > width
    || pt.y < -height
    || pt.y > height ) return false;

  // Just like PIXI.Ellipse.prototype.contains but we are already at 0, 0
  // Normalize the coords to an ellipse
  let normx = (pt.x / width);
  let normy = (pt.y / height);
  normx *= normx;
  normy *= normy;
  return (normx + normy).almostEqual(1, epsilon);
}

/**
 * Convert to a polygon
 * @return {PIXI.Polygon}
 */
function toPolygon({ density } = {}) {
  // Default to the larger radius for density
  density ??= PIXI.Circle.approximateVertexDensity(this.majorRadius);

  // Translate to a circle to get the circle polygon
  const cirPoly = this._toCircle().toPolygon({ density });

  // Translate back to ellipse coordinates
  const cirPts = cirPoly.points;
  const ln = cirPts.length;
  const pts = Array(ln);
  for ( let i = 0; i < ln; i += 2 ) {
    const cirPt = new PIXI.Point(cirPts[i], cirPts[i + 1]);
    const ePt = new PIXI.Point();

    this._fromCircleCoords(cirPt, ePt);
    this._toCartesianCoords(ePt, ePt);

    pts[i] = ePt.x;
    pts[i+1] = ePt.y;
  }

  cirPoly.points = pts;
  return cirPoly;
}

/**
 * Get all the intersection points for a segment A|B
 * Intersections must be sorted from A to B
 * @param {Point} a
 * @param {Point} b
 * @returns {Point[]}
 */
function segmentIntersections(a, b) {
  // Translate to a circle.
  const cir = this._toCircle();

  // Move to ellipse coordinates and then to circle coordinates.
  a = this._toCircleCoords(this._fromCartesianCoords(a));
  b = this._toCircleCoords(this._fromCartesianCoords(b));

  // Get the intersection points and convert back to cartesian coords.
  // Add t0 to indicate distance from a, to match other segmentIntersection functions.
  const dist2 = PIXI.Point.distanceSquaredBetween(a, b);
  return cir.segmentIntersections(a, b).map(ix => {
    const newIx = this._toCartesianCoords(this._fromCircleCoords(ix));
    newIx.t0 =  Math.sqrt(PIXI.Point.distanceSquaredBetween(a, ix) / dist2);
    return newIx;
  });
}

/**
 * Does the segment a|b intersect this ellipse?
 * @param {Point} a
 * @param {Point} b
 * @returns {boolean} True if intersection occurs
 */
function lineSegmentIntersects(a, b) {
  // Translate to a circle.
  const cir = this._toCircle();

  // Move to ellipse coordinates and then to circle coordinates.
  a = this._toCircleCoords(this._fromCartesianCoords(a));
  b = this._toCircleCoords(this._fromCartesianCoords(b));

  // Test for intersection on the circle.
  return cir.lineSegmentIntersects(a, b);
}

/**
 * Does this ellipse overlap something else?
 * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon|PIXI.Ellipse} other
 * @returns {boolean}
 */
function overlaps(other) {
  if ( other instanceof Ellipse ) return other._overlapsEllipse(this);
  if ( other instanceof PIXI.Ellipse ) return this._overlapsEllipse(other);
  if ( other instanceof PIXI.Circle ) return this._overlapsCircle(other);

  // Conversion to circle space may rotate the rectangle, so use polygon.
  if ( other instanceof PIXI.Rectangle ) return this._overlapsPolygon(other.toPolygon());
  if ( other instanceof PIXI.Polygon ) return this._overlapsPolygon(other);
  if ( other.toPolygon ) return this._overlapsPolygon(other.toPolygon());
  console.warn("overlaps|shape not recognized.", other);
  return false;
}

function _overlapsEllipse(other) {
  // Simple test based on centers and shortest radius.
  const r2 = Math.pow(this.minorRadius + other.minorRadius, 2); // Sum the two minor axis radii.
  const d2 = PIXI.Point.distanceSquaredBetween(this.center, other.center);
  if ( d2 < r2 ) return true;

  // Aligned to axis, so can use quick test.
  return this.constructor.quickEllipsesOverlapTest(
    this.x, this.y, this.majorRadius, this.minorRadius,
    other.x, other.y, other.majorRadius, other.minorRadius
  );
}

/**
 * Test for ellipses overlap where neither is rotated.
 * @param {number} ax       X coordinate
 * @param {number} ay       Y coordinate
 * @param {number} aMajor   Major axis radius
 * @param {number} aMinor   Minor axis radius
 * @param {number} bx       X coordinate
 * @param {number} by       Y coordinate
 * @param {number} bMajor   Major axis radius
 * @param {number} bMinor   Minor axis radius
 */
function quickEllipsesOverlapTest(ax, ay, aMajor, aMinor, bx, by, bMajor, bMinor) {
  // Check if the distance between the centers of the two ellipses
  // is less than the sum of their effective radii along the line
  // connecting their centers.
  // (x2 - x1)² / (a1 + a2)² + (y2 - y1)² / (b1 + b2)² <= 1
  const dx = bx - ax;
  const dy = by - ay;
  const major = aMajor + bMajor;
  const minor = aMinor + bMinor;
  return ((dx * dx) / (major * major)) + ((dy * dy) / (minor * minor)) <= 1;
}

function _overlapsCircle(circle) {
  if ( circle.contains(this.x, this.y) ) return true;

  // Simple test based on radius.
  const r2 = Math.pow(circle.radius + this.minorRadius, 2);
  const d2 = PIXI.Point.distanceSquaredBetween(this.center, circle.center);
  if ( d2 < r2 ) return true;

  // Aligned to axis, so can use quick test.
  return this.constructor.quickEllipsesOverlapTest(
    this.x, this.y, this.majorRadius, this.minorRadius,
    circle.x, circle.y, circle.radius, circle.radius
  );
}

function _overlapsRectangle(other) {
  const rectCtr = other.center;
  if ( this.contains(rectCtr.x, rectCtr.y) ) return true;

  // Conversion to circle space may rotate the rectangle, so use polygon.
  return this._overlapsPolygon(other.toPolygon());
}

function _overlapsPolygon(other) {
  // Convert this ellipse to a circle and test against converted polygon.
  const cir = this._toCircle();

  // Move polygon to ellipse coordinates.
  const pts = [...other.iteratePoints({ close: false })].map(pt => this._toCircleCoords(pt));
  const poly = new PIXI.Polygon(pts);
  return poly._overlapsCircle(cir);
}

/**
 * Get all the points for a polygon approximation of a circle between two points on the circle.
 * Points are clockwise from a to b.
 * @param { Point } a
 * @param { Point } b
 * @return { Point[]}
 */
function pointsBetween(a, b, { density } = {}) {
  // Default to the larger radius for density
  density ??= PIXI.Circle.approximateVertexDensity(this.majorRadius);

  // Translate to a circle
  const cir = this._toCircle();

  // Move to ellipse coordinates and then to circle coordinates
  a = this._toCircleCoords(this._fromCartesianCoords(a));
  b = this._toCircleCoords(this._fromCartesianCoords(b));

  // Get the points and translate back to cartesian coordinates
  const pts = cir.pointsBetween(a, b, { density });
  return pts.map(pt => this._toCartesianCoords(this._fromCircleCoords(pt)));
}

/**
 * Intersect this shape with a PIXI.Polygon.
 * Use WeilerAtherton to perform precise intersect.
 * @param {PIXI.Polygon} polygon      A PIXI.Polygon
 * @param {object} [options]          Options which configure how the intersection is computed
 * @param {number} [options.density]              The number of points which defines the density of approximation
 * @param {number} [options.clipType]             The clipper clip type
 * @param {string} [options.weilerAtherton=true]  Use the Weiler-Atherton algorithm. Otherwise, use Clipper.
 * @returns {PIXI.Polygon|null}       The intersected polygon or null if no solution was present
 */
function intersectPolygon(polygon, { density, clipType, weilerAtherton=true, ...options } = {}) {
  if ( !this.majorRadius || !this.minorRadius ) return new PIXI.Polygon([]);

  // Default to the larger radius for density
  density ??= PIXI.Circle.approximateVertexDensity(this.majorRadius);
  clipType ??= WeilerAthertonClipper.CLIP_TYPES.INTERSECT;

  // Use Weiler-Atherton for efficient intersection or union.
  if ( weilerAtherton && polygon._isPositive ) {
    const res = WeilerAthertonClipper.combine(polygon, this, { clipType, density, ...options });
    if ( !res.length ) return new PIXI.Polygon([]);
    return res[0];
  }

  // Otherwise, use Clipper polygon intersection.
  const approx = this.toPolygon({ density });
  return polygon.intersectPolygon(approx, options);
}

/**
 * Return a quadrangle cutaway for this ellipse
 * @param {Point3d} a       Starting endpoint for the segment
 * @param {Point3d} b       Ending endpoint for the segment
 * @param {object} [opts]
 * @param {Point3d} [opts.start]              Starting endpoint for the segment
 * @param {Point3d} [opts.end]                Ending endpoint for the segment
 * @param {function} [opts.topElevationFn]    Function to calculate the top elevation for a position
 * @param {function} [opts.bottomElevationFn] Function to calculate the bottom elevation for a position
 * @param {function} [opts.cutPointsFn]       Function that returns the steps along the a|b segment top
 * @param {number} [opts.isHole=false]        Treat this shape as a hole; reverse the points of the returned polygon
 * @returns {PIXI.Polygon[]}
 */
function cutaway(a, b, opts) { return CONFIG.GeometryLib.CutawayPolygon.cutawayBasicShape(this, a, b, opts); }

/**
 * Does this ellipse equal another in position and size?
 * @param {PIXI.Circle} other
 * @returns {boolean}
 */
function equals(other) {
  if ( !(other instanceof PIXI.Ellipse) ) return false;
  return this.x === other.x
    && this.y === other.y
    && this.width === other.width
    && this.height === other.height;
}

/**
 * Does this ellipse almost equal another in position and size?
 * @param {PIXI.Circle} other
 * @param {number} [epsilon=1e-08]    Count as equal if at least this close
 * @returns {boolean}
 */
function almostEqual(other, epsilon = 1e-08) {
  if ( !(other instanceof PIXI.Ellipse) ) return false;
  return this.x.almostEqual(other.x, epsilon)
    && this.y.almostEqual(other.y, epsilon)
    && this.width.almostEqual(other.width, epsilon)
    && this.height.almostEqual(other.height, epsilon);
}

/**
 * Get the point on the edge of the ellipse at a given angle.
 * @param {number} radians    Angle in radians
 * @returns {PIXI.Point} Point at the edge intersection
 */
function pointAtAngle(radians) {
  const x = this.x + (this.width * Math.cos(radians));
  const y = this.y + (this.height * Math.sin(radians));
  return new PIXI.Point(x, y);
}

/**
 * Calculate the angle of a point in relation to a circle.
 * This is the angle of a line from the circle center to the point.
 * Reverse of PIXI.Ellipse.prototype.pointAtAngle.
 * @param {Point} point
 * @returns {number} Angle in radians.
 */
function angleAtPoint(point) {
  return Math.atan2(point.y - this.y, point.x - this.x);
}


PATCHES.PIXI.GETTERS = {
  majorRadius,
  minorRadius,
  ratio,
  center,
  area,
};

PATCHES.PIXI.METHODS = {
  // Conversion to circle space
  _fromCartesianCoords,
  _toCartesianCoords,
  _toCircleCoords,
  _fromCircleCoords,
  _toCircle,

  // Conversion
  toPolygon,

  // Intersection
  pointIsOn,
  lineSegmentIntersects,
  segmentIntersections,
  intersectPolygon,
  cutaway,

  // Overlap
  overlaps,
  _overlapsEllipse,
  _overlapsCircle,
  _overlapsRectangle,
  _overlapsPolygon,

  // TODO: Envelop methods

  // Equality
  equals,
  almostEqual,

  // Other
  pointsBetween,
  pointAtAngle,
  angleAtPoint,
  scaledArea,
};

PATCHES.PIXI.STATIC_METHODS = {
  quickEllipsesOverlapTest,
};
