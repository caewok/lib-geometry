/* globals
PIXI,
ClipperLib,
libWrapper
*/
"use strict";

import { WeilerAthertonClipper } from "../WeilerAtherton.js";

// ----------------  ADD METHODS TO THE PIXI.CIRCLE PROTOTYPE ------------------------
export function registerPIXICircleMethods() {
  CONFIG.Geometry ??= {};
  CONFIG.Geometry.Registered ??= {};
  if ( CONFIG.Geometry.Registered.PIXIPolygon ) return;
  CONFIG.Geometry.Registered.PIXIPolygon = true;

  // ----- Getters/Setters ----- //
  if ( !Object.hasOwn(PIXI.Circle.prototype, "area") ) {
    Object.defineProperty(PIXI.Circle.prototype, "area", {
      get: area,
      enumerable: false
    });
  }

  if ( !Object.hasOwn(PIXI.Circle.prototype, "center") ) {
    Object.defineProperty(PIXI.Circle.prototype, "center", {
      get: center,
      enumerable: false
    });
  }

  // ----- Methods ----- //

  /**
   * Get all intersection points for a segment A|B
   * Intersections are sorted from A to B.
   * @param {Point} a
   * @param {Point} b
   * @returns {Point[]}
   */
  Object.defineProperty(PIXI.Circle.prototype, "segmentIntersections", {
    value: function(a, b) {
      const ixs = lineCircleIntersection(a, b, this, this.radius);
      return ixs.intersections;
    },
    writable: true,
    configurable: true
  });

  /**
   * Calculate an x,y point on this circle's circumference given an angle
   * 0: due east
   * π / 2: due south
   * π or -π: due west
   * -π/2: due north
   * @param {number} angle    Angle of the point, in radians.
   * @returns {Point}
   */
  Object.defineProperty(PIXI.Circle.prototype, "pointAtAngle", {
    value: function(angle) {
      return {
        x: this.x + (this.radius * Math.cos(angle)),
        y: this.y + (this.radius * Math.sin(angle)) };
    },
    writable: true,
    configurable: true
  });

  /**
   * Calculate the angle of a point in relation to a circle.
   * This is the angle of a line from the circle center to the point.
   * Reverse of PIXI.Circle.prototype.pointAtAngle.
   * @param {Point} point
   * @returns {number} Angle in radians.
   */
  Object.defineProperty(PIXI.Circle.prototype, "angleAtPoint", {
    value: function(point) {
      return Math.atan2(point.y - this.y, point.x - this.x);
    },
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Circle.prototype, "pointsForArc", {
    value: pointsForArc,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Circle.prototype, "intersectPolygon", {
    value: intersectPolygonPIXICircle,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Circle.prototype, "pointsBetween", {
    value: pointsBetween,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Circle.prototype, "translate", {
    value: translate,
    writable: true,
    configurable: true
  });
}

/**
 * Determine the center of this circle.
 * Trivial, but used to match center method for other shapes.
 * @returns {PIXI.Point}
 */
function center() {
  return new PIXI.Point(this.x, this.y);
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
 * Get all the points for a polygon approximation of a circle between two points on the circle.
 * Points are clockwise from a to b.
 * @param {Point} a
 * @param {Point} b
 * @param {object} [options]
 * @param {number} [density]  How many points used to construct the approximation.
 * @return { Point[]}
 */
function pointsBetween(a, b, { density } = {}) {
  const fromAngle = this.angleAtPoint(a);
  const toAngle = this.angleAtPoint(b);
  return this.pointsForArc(fromAngle, toAngle, { density, includeEndpoints: false });
}

/**
 * Get the points that would approximate a circular arc along this circle, given
 * a starting and ending angle. Points returned are clockwise.
 * If from and to are the same, a full circle will be returned.
 *
 * @param {Point}   fromAngle     Starting angle, in radians. π is due north, π/2 is due east
 * @param {Point}   toAngle       Ending angle, in radians
 * @param {object}  [options]     Options which affect how the circle is converted
 * @param {number}  [options.density]           The number of points which defines the density of approximation
 * @param {boolean} [options.includeEndpoints]  Whether to include points at the circle
 *                                              where the arc starts and ends.
 * @returns {Point[]}
 */
function pointsForArc(fromAngle, toAngle, {density, includeEndpoints=true} = {}) {
  const pi2 = 2 * Math.PI;
  density ??= this.constructor.approximateVertexDensity(this.radius);
  const points = [];
  const delta = pi2 / density;

  if ( includeEndpoints ) points.push(this.pointAtAngle(fromAngle));

  // Determine number of points to add
  let dAngle = toAngle - fromAngle;
  while ( dAngle <= 0 ) dAngle += pi2; // Angles may not be normalized, so normalize total.
  const nPoints = Math.round(dAngle / delta);

  // Construct padding rays (clockwise)
  for ( let i = 1; i < nPoints; i++ ) points.push(this.pointAtAngle(fromAngle + (i * delta)));

  if ( includeEndpoints ) points.push(this.pointAtAngle(toAngle));
  return points;
}

/**
 * Intersect this PIXI.Circle with a PIXI.Polygon.
 * Use the WeilerAtherton algorithm
 * @param {PIXI.Polygon} polygon      A PIXI.Polygon
 * @param {object} [options]          Options which configure how the intersection is computed
 * @param {number} [options.density]  The number of points which defines the density of approximation
 * @returns {PIXI.Polygon}            The intersected polygon
 */
function intersectPolygon(polygon, {density, ...options} = {}) {
  if ( !this.radius ) return new PIXI.Polygon([]);
  options.clipType ??= ClipperLib.ClipType.ctIntersection;

  if ( options.clipType !== ClipperLib.ClipType.ctIntersection
    && options.clipType !== ClipperLib.ClipType.ctUnion) {
    const approx = this.toPolygon({density})
    return polygon.intersectPolygon(approx, options);
  }

  const union = options.clipType === ClipperLib.ClipType.ctUnion;
  const wa = WeilerAthertonClipper.fromPolygon(polygon, { union, density });
  const res = wa.combine(this)[0];

  if ( !res ) return new PIXI.Polygon([]);

  return res instanceof PIXI.Polygon ? res : res.toPolygon();
}