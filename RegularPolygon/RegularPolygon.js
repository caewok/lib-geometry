/* globals
PIXI,
foundry,
ClipperLib,
WeilerAthertonClipper
*/
"use strict";

import { GEOMETRY_CONFIG } from "../const.js";

/* Define a set of Regular Polygon shapes
Each should extend PIXI.Polygon like LimitedAnglePolygon does.
Each is non-changeable; modifications result in new object.
Each are referenced in local space for the contains test:
- local origin 0, 0
- rotation considered after: all oriented up

Each can be intersected quickly using WA
*/

export class RegularPolygon extends PIXI.Polygon {

  /**
   * Vertices when the polygon is centered on 0,0.
   * @type {PIXI.Point[]}
   */
  _fixedPoints;

  /**
   * Vertices taking into account the origin {x, y}.
   * @type {number[]}
   */
  _points;

  /** @type {boolean} */
  _isClockwise = true;

  /** @type {PIXI.Point} */
  origin = new PIXI.Point();

  /** @type {number} */
  numSides = 3;

  /** @type {number} */
  rotation = 0;

  /** @type {number} */
  radians = 0;

  /**
   * @param {Point} origin   Center point of the polygon.
   * @param {number} radius  Circumscribed circle radius.
   * @param {object} options Options that affect the polygon shape
   * @param {number} options.numSides  Number of sides for this polygon
   * @param {number} options.rotation  Rotation, in degrees, from a starting point due east
   */
  constructor(origin, radius, { numSides = 3, rotation = 0 } = {}) {
    super([]);

    this.origin.copyFrom(origin);
    this.numSides = numSides;
    this.radius = radius;
    this.rotation = Math.normalizeDegrees(rotation);
    this.radians = Math.toRadians(this.rotation);
  }


  // Getters/setters for x and y for backwards compatibility.

  /** @type {number} */
  get x() { return this.origin.x; }

  set x(value) { this.origin.x = value; }

  /** @type {number} */

  get y() { return this.origin.y; }

  set y(value) { return this.origin.y = value; }

  get center() { return { x: this.x, y: this.y }; }

  get points() { return this._points || (this._points = this._generatePoints()); }

  set points(value) { }

  get fixedPoints() { return this._fixedPoints || (this._fixedPoints = this._generateFixedPoints()); }

  /**
   * Calculate the distance of the line segment from the center to the midpoint of a side.
   * @type {number}
   */
  get apothem() {
    return this.radius * Math.cos(Math.PI / this.numSides);
  }

  /**
   * Calculate length of a side of this regular polygon.
   * @type {number}
   */
  get sideLength() {
    return 2 * this.radius * Math.sin(Math.PI / this.numSides);
  }

  /**
   * Calculate area of the regular polygon.
   * @type {number}
   */
  get area() {
    return this.numSides * this.sideLength * this.apothem;
  }

  /**
   * Circumscribed (outer) circle passing through the points
   * @type {PIXI.Circle}
   */
  get outerCircle() { return new PIXI.Circle(0, 0, this.radius); }

  /**
   * Largest circle that will fit inside the polygon
   * @type {PIXI.Circle}
   */
  get innerCircle() { return new PIXI.Circle(0, 0, this.apothem); }

  /**
   * Interior angle of two sides, in degrees
   * @type {number}
   */
  get interiorAngle() { return (180 + (180 * (this.numSides - 3))) / this.numSides; }

  /**
   * Area that matches clipper measurements, so it can be compared with Clipper Polygon versions.
   * Used to match what Clipper would measure as area, by scaling the points.
   * @param {object} [options]
   * @param {number} [scalingFactor]  Scale like with PIXI.Polygon.prototype.toClipperPoints.
   * @returns {number}  Positive if clockwise. (b/c y-axis is reversed in Foundry)
   */
  scaledArea({scalingFactor = 1} = {}) {
    return this.toPolygon().scaledArea({scalingFactor});
  }

  /**
   * Shift this polygon to a new position.
   * @param {number} dx   Change in x position
   * @param {number} dy   Change in y position
   * @returns {RegularPolygon}    New polygon
   */
  translate(dx, dy) {
    const copy = new this.constructor(this.origin.add({x: dx, y: dy}), this.radius,
      { numSides: this.numSides, rotation: this.rotation });
    if ( this._fixedPoints ) copy._fixedPoints = [...this._fixedPoints]; // Copy the points.
    return copy;
  }

  /**
   * Generate the points of the shape in shape-space (before rotation or translation)
   * @return {Points[]}
   */
  _generateFixedPoints() {
    const { numSides, radius } = this;
    const angles = Array.fromRange(numSides).map(i => (360 / numSides) * i);
    const radAngles = angles.map(a => Math.toRadians(a));
    return radAngles.map(angle => PIXI.Point.fromAngle({x: 0, y: 0}, angle, radius));
  }

  /**
   * Generate the points that represent this shape as a polygon in Cartesian space.
   * @return {Points[]}
   */
  _generatePoints() {
    // Faster to use for loop rather than flatten
    const pts = [];
    const fp = this.fixedPoints;
    const ln = fp.length;
    for ( let i = 0; i < ln; i += 1 ) {
      const pt = this.toCartesianCoords(fp[i]);
      pts.push(pt.x, pt.y);
    }
    return pts;
  }

  /**
   * Generate the bounding box (in Cartesian coordinates)
   * @returns {PIXI.Rectangle}
   */
  getBounds() {
    // Default to the bounding box of the radius circle
    const { x, y } = this.origin;
    const r = this.radius;
    const r2 = r * 2;
    return new PIXI.Rectangle(x - r, y - r, r2, r2);
  }

  /**
   * Shift from cartesian coordinates to the shape space.
   * @param {PIXI.Point} a
   * @param {PIXI.Point} [outPoint] A point-like object to store the result.
   * @returns {PIXI.Point}
   */
  fromCartesianCoords(a, outPoint) {
    const { x, y } = this.origin;
    outPoint ??= new PIXI.Point;
    a = PIXI.Point._tmp.copyFrom(a);
    a.translate(-x, -y, outPoint).rotate(-this.radians, outPoint);
    return outPoint;
  }

  /**
   * Shift to cartesian coordinates from the shape space.
   * @param {Point} a
   * @param {PIXI.Point} [outPoint] A point-like object to store the result.
   * @returns {Point}
   */
  toCartesianCoords(a, outPoint) {
    const { x, y } = this.origin;
    outPoint ??= new PIXI.Point;
    a = PIXI.Point._tmp.copyFrom(a);
    a.rotate(this.radians, outPoint).translate(x, y, outPoint);
    return outPoint;
  }

  /**
   * Does the shape contain the point?
   * @param {number} x
   * @param {number} y
   * @returns {boolean} True if point {x,y} is contained within the shape.
   */
  contains(x, y) {
    const pt = this.fromCartesianCoords(new PIXI.Point(x, y));

    // Test the outer and inner circles
    if ( !this.outerCircle.contains(pt.x, pt.y) ) return false;
    if ( this.innerCircle.contains(pt.x, pt.y) ) return true;

    // Use orientation to test the point.
    // Moving clockwise, must be clockwise to each side.
    const { fixedPoints: fp, numSides } = this;
    const orient2dFast = foundry.utils.orient2dFast;
    for ( let i = 0; i < numSides; i += 1 ) {
      const fp0 = fp[i];
      const fp1 = fp[(i + 1) % numSides];
      if ( orient2dFast(fp0, fp1, pt) >= 0 ) return false;
    }

    return true;
  }

  /**
   * Determine if the point is on or nearly on this polygon.
   * @param {Point} point     Point to test
   * @param {number} epsilon  Tolerated margin of error
   * @returns {boolean}       Is the point on the circle within the allowed tolerance?
   */
  pointIsOn(point, epsilon = 1e-08) {
    const closestPointToSegment = foundry.utils.closestPointToSegment;
    const pt = this.fromCartesianCoords(PIXI.Point.fromObject(point));

    // Test each side in turn.
    const { fixedPoints: fp, numSides } = this;
    for ( let i = 0; i < numSides; i += 1 ) {
      const fp0 = fp[i];
      const fp1 = fp[(i + 1) % numSides];
      const closestPoint = closestPointToSegment(point, fp0, fp1);
      if ( pt.almostEqual(closestPoint, epsilon) ) return true;
    }
    return false;
  }

  /**
   * Convert the shape to a normal polygon, for testing.
   * @returns {PIXI.Polygon}
   */
  toPolygon() { return new PIXI.Polygon(this.points); }

  /**
   * Get all intersection points for a segment A|B
   * Intersections must be sorted from A to B.
   * @param {Point} a
   * @param {Point} b
   * @returns {Point[]}
   */
  segmentIntersections(a, b) {
    a = this.fromCartesianCoords(a);
    b = this.fromCartesianCoords(b);

    const ixs = [];
    const fp = this.fixedPoints;
    const ln = fp.length;

    // To ensure intersections are clockwise, start with the side for a
    let aSide = this._getSide(a);
    if ( !~aSide ) aSide = 0;

    let prevIx = {x: 0, y: 0}; // If polygon has radius, no intersections at 0,0.
    for ( let i = 0; i < ln; i += 1 ) {
      const j = (i + aSide) % ln;
      const x = foundry.utils.lineSegmentIntersection(fp[j], fp[(j + 1) % ln], a, b);

      // Because we are cycling over sides, it is possible for an intersection to occur
      // at a shared vertex and thus be repeated.
      if ( x && !prevIx.almostEqual(x) ) {
        ixs.push(x);
        prevIx = x;
      }
    }

    return ixs.map(ix => this.toCartesianCoords(ix));
  }

  /**
   * Get all the points (corners) of the shape between
   * two points on (or nearly on) the shape.
   * Points must be sorted clockwise around the shape.
   * @param {Point} a
   * @param {Point} b
   * @returns {Point[]}
   */
  pointsBetween(a, b) {
    if ( a.x.almostEqual(b.x) && a.y.almostEqual(b.y) ) return [];

    a = this.fromCartesianCoords(a);
    b = this.fromCartesianCoords(b);

    const aSide = this._getSide(a);
    if ( !~aSide ) return []; // A is inside

    const bSide = this._getSide(b);
    if ( !~bSide ) return []; // B is inside

    const pts = [];
    const { numSides, fixedPoints: fp } = this;

    if ( aSide === bSide ) {
      // Either a is before b moving clockwise (no points)
      // or a is after b moving clockwise (all points)
      if ( foundry.utils.orient2dFast({x: 0, y: 0}, a, b) < 0 ) return [];
      pts.push(...Array.fromRange(numSides).map(i => fp[(i + aSide + 1) % numSides]));
    } else {
      let currSide = aSide;
      while ( currSide !== bSide ) {
        currSide = (currSide + 1) % numSides;
        pts.push(fp[currSide]);
      }
    }

    // If the last point is collinear to the center, drop
    if ( !foundry.utils.orient2dFast({x: 0, y: 0}, pts[pts.length - 1], b )) pts.pop();

    return pts.map(pt => this.toCartesianCoords(pt));
  }

  /**
   * Determine on which side a point lies.
   * Defined here as the side that intersects a ray from the origin through the point.
   * @param {Point} point  Point, in shape-space
   * @returns {number} 0, 1, or 2 for the side.
   *                   If point is on a corner, returns the next side
   *
   */
  _getSide(point) {
    const numSides = this.numSides;
    for ( let i = 0; i < numSides; i += 1 ) {
      const side = this._checkSide(point, i);
      if ( ~side ) return side;
    }
    return -1;
  }

  /**
   * Determine if a point is on this side
   * @param {Point} point  Point, in shape-space
   * @returns {number} Returns the side number.
   *                   If point is on a corner, returns the next side.
   *                   Returns -1 if not on this side
   */
  _checkSide(point, side) {
    const numSides = this.numSides;
    const a = this.fixedPoints[side];
    const b = this.fixedPoints[(side + 1) % numSides];
    const o = {x: 0, y: 0};

    if ( a.x.almostEqual(point.x) && b.y.almostEqual(point.y) ) return (side + 1) % numSides;

    // If point is in the triangle formed by AOB, it is on this side (where AB is a side).
    // Recall that a, b oriented clockwise around the shape.
    const oa = foundry.utils.orient2dFast(o, a, point);
    if ( oa > 0 ) return -1; // Point is ccw to OA

    const ob = foundry.utils.orient2dFast(o, b, point);
    if ( ob < 0 ) return -1; // Point is cw to OB

    return side;
  }

  /**
   * Intersect this shape with a PIXI.Polygon.
   * Use WeilerAtherton to perform precise intersect.
   * @param {PIXI.Polygon} polygon      A PIXI.Polygon
   * @param {object} [options]          Options which configure how the intersection is computed
   * @param {number} [options.clipType]       The clipper clip type (union or intersect will use WA)
   * @param {number} [options.scalingFactor]  A scaling factor passed to Polygon#toClipperPoints to preserve precision
   * @returns {PIXI.Polygon|null}       The intersected polygon or null if no solution was present
   */
  _intersectPolygon(polygon, { density, clipType, weilerAtherton = true, ...options } = {}) {
    if ( !this.radius ) return new PIXI.Polygon([]);
    clipType ??= WeilerAthertonClipper.CLIP_TYPES.INTERSECT;

    // Use Weiler-Atherton for efficient intersection or union.
    if ( weilerAtherton && polygon._isPositive ) {
      const res = WeilerAthertonClipper.combine(polygon, this, { clipType, density, ...options });
      if ( !res.length ) return new PIXI.Polygon([]);
      return res[0];
    }

    if ( options.clipType !== ClipperLib.ClipType.ctIntersection
      && options.clipType !== ClipperLib.ClipType.ctUnion) {
      return super.intersectPolygon(polygon, options);
    }

    // Otherwise, use Clipper polygon intersection
    const approx = this.toPolygon({density});
    return polygon.intersectPolygon(approx, options);
  }

  // Overlaps method added to PIXI.Polygon in PIXIPolygon.js

  /**
   * Does this polygon overlap a circle?
   * @param {PIXI.Circle} circle
   * @returns {boolean}
   */
  _overlapsCircle(circle) {
    // Determine closest point to circle center

    // If further than the radius of both, then outside
    const dx = this.center.x - circle.x;
    const dy = this.center.y - circle.y;
    const distXY2 = Math.pow(dx, 2) + Math.pow(dy, 2);
    if ( distXY2 > Math.pow(circle.radius + this.radius, 2) ) return false;

    // If within inner circle radius, then inside
    if ( distXY2 <= Math.pow(circle.radius + this.apothem, 2) ) return true;

    // Default to polygon approach
    return super._overlapsCircle(circle);
  }

}

GEOMETRY_CONFIG.RegularPolygons.RegularPolygon ??= RegularPolygon;
