/* globals
CONFIG,
PIXI,
WeilerAthertonClipper,
*/
"use strict";

import { GEOMETRY_CONFIG } from "./const.js";

/* Testing
api = game.modules.get('tokenvisibility').api;
drawing = api.drawing

function rotatePoint(point, angle) {
  return {
    x: (point.x * Math.cos(angle)) - (point.y * Math.sin(angle)),
    y: (point.y * Math.cos(angle)) + (point.x * Math.sin(angle))
  };
}

function translatePoint(point, dx, dy) {
  return {
    x: point.x + dx,
    y: point.y + dy
  };
}

[d] = canvas.drawings.placeables

halfWidth = d.document.shape.width / 2;
halfHeight = d.document.shape.height / 2;
x = d.document.x + halfWidth;
y = d.document.y + halfHeight
rotation = d.document.rotation

e = new Ellipse(x, y, halfWidth, halfHeight, { rotation })
drawing.drawShape(e)

pts = [...e.toPolygon().iteratePoints()]
pts.forEach(pt => api.drawing.drawPoint(pt))

bounds = e.getBounds()
drawing.drawShape(bounds)
*/


/**
 * Ellipse class structured similarly to PIXI.Circle
 * - x, y center
 * - major, minor axes
 * - rotation
 */
export class Ellipse extends PIXI.Ellipse {
  /**
   * Default representation has the major axis horizontal (halfWidth), minor axis vertical (halfHeight)
   *
   * @param {Number}  x       Center of ellipse
   * @param {Number}  y       Center of ellipse
   * @param {Number}  halfWidth   Semi-major axis
   * @param {Number}  halfHeight   Semi-minor axis
   * Optional:
   * @param {Number}  rotation  Amount in degrees the ellipse is rotated
   */
  constructor(x, y, halfWidth, halfHeight, { rotation = 0 } = {}) {
    super(x, y, halfWidth, halfHeight);
    this.rotation = rotation;
    this.recalculateProperties();
  }

  clone() {
    const out = super.clone();
    out.rotation = this.rotation;
    out.recalculateProperties();
    return out;
  }

  /**
   * Recalculate properties set on construction.
   */
  recalculateProperties() {
    const halfWidth = this.width;
    const halfHeight = this.height;

    this.rotation = Math.normalizeDegrees(this.rotation);
    this.radians = Math.toRadians(this.rotation);

    this.major = Math.max(halfWidth, halfHeight);
    this.minor = Math.min(halfWidth, halfHeight);
    this.ratio = halfWidth / halfHeight;
    this.ratioInv = 1 / this.ratio;
  }

  /**
   * Construct an ellipse that mirrors that of a Drawing ellipse
   * @param {Drawing} drawing
   * @returns {Ellipse}
   */
  static fromDrawing(drawing) {
    const { x, y, rotation, shape } = drawing;
    const { width, height } = shape;

    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const centeredX = x + halfWidth;
    const centeredY = y + halfHeight;

    const out = new this(centeredX, centeredY, halfWidth, halfHeight, { rotation });
    out._drawing = drawing; // For debugging
    return out;
  }

  /**
   * Center of the ellipse
   * @type {Point}
   */
  get center() { return new PIXI.Point(this.x, this.y); }

  /**
   * Area of the ellipse
   * @type {number}
   */
  get area() { return Math.PI * this.width * this.height; }

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
   * Shift from cartesian coordinates to the shape space.
   * @param {PIXI.Point} a
   * @param {PIXI.Point} [outPoint] A point-like object to store the result.
   * @returns {PIXI.Point}
   */
  fromCartesianCoords(a, outPoint) {
    outPoint ??= new PIXI.Point();
    a = PIXI.Point.fromObject(a);

    a.translate(-this.x, -this.y, outPoint).rotate(-this.radians, outPoint);
    return outPoint;
  }

  /**
   * Shift to cartesian coordinates from the shape space.
   * @param {Point} a
   * @param {PIXI.Point} [outPoint] A point-like object to store the result.
   * @returns {Point}
   */
  toCartesianCoords(a, outPoint) {
    outPoint ??= new PIXI.Point();
    a = PIXI.Point.fromObject(a);

    a.rotate(this.radians, outPoint).translate(this.x, this.y, outPoint);
    return outPoint;
  }

  toCircleCoords(a, outPoint) {
    outPoint ??= new PIXI.Point();

    outPoint.x = a.x * this.ratioInv;
    outPoint.y = a.y;
    return outPoint;
  }

  fromCircleCoords(a, outPoint) {
    outPoint ??= new PIXI.Point();

    outPoint.x = a.x * this.ratio;
    outPoint.y = a.y;

    return outPoint;
  }

  _toCircle() { return new PIXI.Circle(0, 0, this.height); }

  /**
   * Bounding box of the ellipse
   * @return {PIXI.Rectangle}
   */
  getBounds() {
    // Bounds rectangle measured from top left corner. x, y, width, height
    switch ( this.rotation ) {
      case 0:
      case 180:
        return new PIXI.Rectangle(this.x - this.width, this.y - this.height, this.width * 2, this.height * 2);

      case 90:
      case 270:
        return new PIXI.Rectangle(this.x - this.height, this.y - this.width, this.height * 2, this.width * 2);
    }

    // Default to bounding box of the radius circle
    return new PIXI.Rectangle(this.x - this.major, this.y - this.major, this.major * 2, this.major * 2);
  }

  /**
   * Test whether the ellipse contains a given point {x,y}.
   * @param {number} x
   * @param {number} y
   * @return {Boolean}
   */
  contains(x, y) {
    const { width, height } = this;
    if ( width <= 0 || height <= 0 ) return false;

    // Move point to Ellipse-space
    const pt = new PIXI.Point(x, y);
    this.fromCartesianCoords(pt, pt);

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

    return (normx + normy <= 1);
  }

  /**
   * Determine if the point is on or nearly on this polygon.
   * @param {Point} point     Point to test
   * @param {number} epsilon  Tolerated margin of error
   * @returns {boolean}       Is the point on the circle within the allowed tolerance?
   */
  pointIsOn(point, epsilon = 1e-08) {
    const { width, height } = this;
    if ( width <= 0 || height <= 0 ) return false;

    // Move point to Ellipse-space
    const pt = PIXI.Point.fromObject(point);
    this.fromCartesianCoords(pt, pt);

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
  toPolygon({ density } = {}) {
    // Default to the larger radius for density
    density ??= PIXI.Circle.approximateVertexDensity(this.major);

    // Translate to a circle to get the circle polygon
    const cirPoly = this._toCircle().toPolygon({ density });

    // Translate back to ellipse coordinates
    const cirPts = cirPoly.points;
    const ln = cirPts.length;
    const pts = Array(ln);
    for ( let i = 0; i < ln; i += 2 ) {
      const cirPt = new PIXI.Point(cirPts[i], cirPts[i + 1]);
      const ePt = new PIXI.Point();

      this.fromCircleCoords(cirPt, ePt);
      this.toCartesianCoords(ePt, ePt);

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
  segmentIntersections(a, b) {
    // Translate to a circle.
    const cir = this._toCircle();

    // Move to ellipse coordinates and then to circle coordinates.
    a = this.toCircleCoords(this.fromCartesianCoords(a));
    b = this.toCircleCoords(this.fromCartesianCoords(b));

    // Get the intersection points and convert back to cartesian coords.
    // Add t0 to indicate distance from a, to match other segmentIntersection functions.
    const dist2 = PIXI.Point.distanceSquaredBetween(a, b);
    return cir.segmentIntersections(a, b).map(ix => {
      const newIx = this.toCartesianCoords(this.fromCircleCoords(ix));
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
  lineSegmentIntersects(a, b) {
    // Translate to a circle.
    const cir = this._toCircle();

    // Move to ellipse coordinates and then to circle coordinates.
    a = this.toCircleCoords(this.fromCartesianCoords(a));
    b = this.toCircleCoords(this.fromCartesianCoords(b));

    // Test for intersection on the circle.
    return cir.lineSegmentIntersects(a, b);
  }

  /**
   * Does this ellipse overlap something else?
   * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon|PIXI.Ellipse} other
   * @returns {boolean}
   */
  overlaps(other) {
    if ( other instanceof Ellipse ) return this._overlapsEllipse(other);
    if ( other instanceof PIXI.Circle ) return this._overlapsCircle(other);

    // Conversion to circle space may rotate the rectangle, so use polygon.
    if ( other instanceof PIXI.Rectangle ) return this._overlapsPolygon(other.toPolygon());
    if ( other instanceof PIXI.Polygon ) return this._overlapsPolygon(other);
    if ( other.toPolygon ) return this._overlapsPolygon(other.toPolygon());
    console.warn("overlaps|shape not recognized.", other);
    return false;
  }

  _overlapsEllipse(other) {
    // Simple test based on centers and shortest radius.
    const r2 = Math.pow(this.minor + other.minor, 2); // Sum the two minor axis radii.
    const d2 = PIXI.Point.distanceSquaredBetween(this.center, other.center);
    if ( d2 < r2 ) return true;

    // If aligned to an axis, use the quick test.
    // Check if the distance between the centers of the two ellipses
    // is less than the sum of their effective radii along the line
    // connecting their centers.
    if ( this.rotation % 90 === 0 && other.rotation % 90 === 0 ) {
      // (x2 - x1)² / (a1 + a2)² + (y2 - y1)² / (b1 + b2)² <= 1
      const thisIsVertical = this.rotation === 90 || this.rotation === 270;
      const otherIsVertical = other.rotation === 90 || other.rotation === 270;
      const [thisWidth, thisHeight] = thisIsVertical ? [this.height, this.width] : [this.width, this.height];
      const [otherWidth, otherHeight] = otherIsVertical ? [other.height, other.width] : [other.width, other.height];
      return this.constructor.quickEllipsesOverlapTest(
        this.x, this.y, thisWidth, thisHeight,
        other.x, other.y, otherWidth, otherHeight
      );
    }

    // Convert to this ellipse's circle space and test circle-ellipse overlap.
    // Move to ellipse coordinates and then to circle coordinates.
    // Use the major-minor points to determine height and width of the converted ellipse.
    const otherCtr = PIXI.Point._tmp1.set(other.x, other.y);
    const otherV = otherCtr.fromAngle(other.radians, other.width, PIXI.Point._tmp2);
    const otherCV = otherCtr.fromAngle(other.radians + Math.PI_1_2, other.height, PIXI.Point._tmp3);

    const c = this.toCircleCoords(this.fromCartesianCoords(otherCtr));
    const v = this.toCircleCoords(this.fromCartesianCoords(otherV));
    const cv = this.toCircleCoords(this.fromCartesianCoords(otherCV));
    const w = PIXI.Point.distanceBetween(c, v);
    const h = PIXI.Point.distanceBetween(c, cv);
    const ellipse = new Ellipse(c.x, c.y, w, h, { rotation: other.rotation });
    return ellipse._overlapsCircle(this._toCircle());
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
  static quickEllipsesOverlapTest(ax, ay, aMajor, aMinor, bx, by, bMajor, bMinor) {
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

  _overlapsCircle(circle) {
    if ( circle.contains(this.x, this.y) ) return true;

    // Simple test based on radius.
    const r2 = Math.pow(circle.radius + this.minor, 2);
    const d2 = PIXI.Point.distanceSquaredBetween(this.center, circle.center);
    if ( d2 < r2 ) return true;

    // Align this ellipse to the axis at 0,0 and rotate to 0º.
    // I.e, move the circle and then rotate it.
    const cirCtr = PIXI.Point._tmp1;
    circle.center.translate(-this.x, -this.y, cirCtr).rotate(-this.radians, cirCtr);
    return this.constructor.quickEllipsesOverlapTest(
      0, 0, this.major, this.minor,
      cirCtr.x, cirCtr.y, circle.radius, circle.radius
    );
  }

  _overlapsRectangle(other) {
    const rectCtr = other.center;
    if ( this.contains(rectCtr.x, rectCtr.y) ) return true;

    // Conversion to circle space may rotate the rectangle, so use polygon.
    return this._overlapsPolygon(other.toPolygon());
  }

  _overlapsPolygon(other) {
    // Convert this ellipse to a circle and test against converted polygon.
    const cir = this.toCircle();

    // Move polygon to ellipse coordinates.
    const pts = [...other.iteratePoints({ close: false })].map(pt => this.toCircleCoords(pt));
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
  pointsBetween(a, b, { density } = {}) {
    // Default to the larger radius for density
    density ??= PIXI.Circle.approximateVertexDensity(this.major);

    // Translate to a circle
    const cir = this._toCircle();

    // Move to ellipse coordinates and then to circle coordinates
    a = this.toCircleCoords(this.fromCartesianCoords(a));
    b = this.toCircleCoords(this.fromCartesianCoords(b));

    // Get the points and translate back to cartesian coordinates
    const pts = cir.pointsBetween(a, b, { density });
    return pts.map(pt => this.toCartesianCoords(this.fromCircleCoords(pt)));
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
  intersectPolygon(polygon, { density, clipType, weilerAtherton=true, ...options } = {}) {
    if ( !this.major || !this.minor ) return new PIXI.Polygon([]);

    // Default to the larger radius for density
    density ??= PIXI.Circle.approximateVertexDensity(this.major);
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
  cutaway(a, b, opts) { return CONFIG.GeometryLib.CutawayPolygon.cutawayBasicShape(this, a, b, opts); }
}

GEOMETRY_CONFIG.Ellipse ??= Ellipse;