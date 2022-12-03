/* globals

*/
"use strict";

// Add methods to PIXI.Point
let isRegistered = false;
export function registerPIXIPointMethods() {
  if ( isRegistered ) return;
  isRegistered = true;

  // ----- Static Methods ----- //
  Object.defineProperty(PIXI.Point, "midPoint", {
    value: midPoint,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point, "fromAngle", {
    value: fromAngle,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point, "distanceBetween", {
    value: distanceBetween,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point, "distanceSquaredBetween", {
    value: distanceBetween,
    writable: true,
    configurable: true
  });

  // ----- Methods ----- //

  Object.defineProperty(PIXI.Point.prototype, "add", {
    value: add2d,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "subtract", {
    value: subtract2d,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "multiply", {
    value: multiply2d,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "multiplyScalar", {
    value: multiplyScalar2d,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "dot", {
    value: dot2d,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "magnitude", {
    value: magnitude2d,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "magnitudeSquared", {
    value: magnitudeSquared2d,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "almostEqual", {
    value: almostEqual2d,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "normalize", {
    value: normalize,
    writable: true,
    configurable: true
  });

  // For parallel with Point3d
  Object.defineProperty(PIXI.Point.prototype, "to2d", {
    value: function() { return this; },
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "to3d", {
    value: to3d,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "projectToward", {
    value: projectToward,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "projectToAxisValue", {
    value: projectToAxisValue,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "translate", {
    value: translate,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "rotate", {
    value: rotate,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point, "flatMapPoints", {
    value: flatMapPoints,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point, "key", {
    value: key,
    writable: true,
    configurable: true
  });
}

/**
 * Distance between two 2d points
 * @param {PIXI.Point} a
 * @param {PIXI.Point} b
 * @returns {number}
 */
function distanceBetween(a, b) {
  return b.subtract(a).magnitude();
}

/**
 * Distance squared between two 2d points
 * @param {PIXI.Point} a
 * @param {PIXI.Point} b
 * @returns {number}
 */
function distanceSquaredBetween(a, b) {
  return b.subtract(a).magnitudeSquared();
}

/**
 * Hashing key for a 2d point, rounded to nearest integer.
 * Ordered, so sortable.
 * @returns {number}
 */
function key() {
  const x = Math.round(this.x);
  const y = Math.round(this.y);
  return (x << 16) ^ y;
}

/**
 * Take an array of 2d points and flatten them to an array of numbers,
 * like what is used by PIXI.Polygon.
 * Much faster than Array.flatMap.
 * @param {Point[]} ptsArr        Array of objects with x, y values
 * @param {function} transformFn  Function to apply to each object
 * @returns {number[]} An array with [pt0.x, pt0.y, pt1.x, ...]
 */
function flatMapPoints(ptsArr, transformFn) {
  const N = ptsArr.length;
  const ln = N * 2;
    const newArr = Array(ln);
    for ( let i = 0; i < N; i += 1 ) {
      const j = i * 2;
      const pt = transformFn(ptsArr[i], i);
      newArr[j] = pt.x;
      newArr[j + 1] = pt.y;
    }
  return newArr;
}

/**
 * Same as Ray.fromAngle but returns a point instead of constructing the full Ray.
 * @param {Point}   origin    Starting point.
 * @param {Number}  radians   Angle to move from the starting point.
 * @param {Number}  distance  Distance to travel from the starting point.
 * @returns {Point}  Coordinates of point that lies distance away from origin along angle.
 */
function pointFromAngle(origin, radians, distance) {
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  return new this(origin.x + (dx * distance), origin.y + (dy * distance));
}

/**
 * Point between two points on a line
 * @param {PIXI.Point} a
 * @param {PIXI.Point} b
 * @returns {PIXI.Point}
 */
function midPoint(a, b) {
  return new this( a.x + ((b.x - a.x) / 2), a.y + ((b.y - a.y) / 2));
}

/**
 * Convert 2d point to 3d
 * @param [object] [options]    Choices that affect the axes used.
 * @param [string] [options.x]  What 2d axis to use for the 3d x axis
 * @param [string] [options.y]  What 2d axis to use for the 3d y axis
 * @param [string] [options.z]  What 2d axis to use for the 3d z axis
 * @returns {Point3d}
 */
function to3d({ x = "x", y = "y", z} = {}) {
  const x3d = x ? this[x] : 0;
  const y3d = y ? this[y] : 0;
  const z3d = z ? this[z] : 0;
  return new Point3d(x3d, y3d, z3d);
}

/**
 * Add a point to this one.
 * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
 * @param {PIXI.Point} other    The point to add to `this`.
 * @param {PIXI.Point} [outPoint]    A point-like object in which to store the value.
 *   (Will create new point if none provided.)
 * @returns {PIXI.Point}
 */
function add2d(other, outPoint) {
  outPoint ??= new this.constructor();
  outPoint.x = this.x + other.x;
  outPoint.y = this.y + other.y;

  return outPoint;
}

/**
 * Subtract a point from this one.
 * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
 * @param {PIXI.Point} other    The point to subtract from `this`.
 * @param {PIXI.Point} [outPoint]    A point-like object in which to store the value.
 *   (Will create new point if none provided.)
 * @returns {PIXI.Point}
 */
function subtract2d(other, outPoint) {
  outPoint ??= new this.constructor();
  outPoint.x = this.x - other.x;
  outPoint.y = this.y - other.y;

  return outPoint;
}

/**
 * Multiply `this` point by another.
 * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
 * @param {PIXI.Point} other    The point to subtract from `this`.
 * @param {PIXI.Point} [outPoint]    A point-like object in which to store the value.
 *   (Will create new point if none provided.)
 * @returns {PIXI.Point}
 */
function multiply2d(other, outPoint) {
  outPoint ??= new this.constructor();
  outPoint.x = this.x * other.x;
  outPoint.y = this.y * other.y;

  return outPoint;
}

/**
 * Multiply `this` point by a scalar
 * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
 * @param {PIXI.Point} other    The point to subtract from `this`.
 * @param {PIXI.Point} [outPoint]    A point-like object in which to store the value.
 *   (Will create new point if none provided.)
 * @returns {PIXI.Point}
 */
function multiplyScalar2d(scalar, outPoint) {
  outPoint ??= new this.constructor();
  outPoint.x = this.x * scalar;
  outPoint.y = this.y * scalar;

  return outPoint;
}

/**
 * Dot product of this point with another.
 * (Sum of the products of the components)
 * @param {PIXI.Point} other
 * @return {number}
 */
function dot2d(other) {
  return (this.x * other.x) + (this.y * other.y);
}

/**
 * Magnitude (length, or sometimes distance) of this point.
 * Square root of the sum of squares of each component.
 * @returns {number}
 */
function magnitude2d() {
  // Same as Math.sqrt(this.x * this.x + this.y * this.y)
  return Math.hypot(this.x, this.y);
}

/**
 * Magnitude squared.
 * Avoids square root calculations.
 * @returns {number}
 */
function magnitudeSquared2d() {
  return Math.pow(this.x, 2) + Math.pow(this.y, 2);
}

/**
 * Test if `this` is nearly equal to another point.
 * @param {PIXI.Point} other
 * @param {number} epsilon
 * @returns {boolean}
 */
function almostEqual2d(other, epsilon = EPSILON) {
  return this.x.almostEqual(other.x, epsilon) && this.y.almostEqual(other.y, epsilon);
}

/**
 * Normalize the point.
 * @param {PIXI.Point} [outPoint]    A point-like object in which to store the value.
 *   (Will create new point if none provided.)
 * @returns {PIXI.Point}
 */
function normalize(outPoint) {
  outPoint ??= new this.constructor();
  this.multiplyScalar(1 / this.magnitude(), outPoint);
  return outPoint;
}

/**
 * Project along a line from this point toward another point by some
 * proportion of the distance between this and the other point.
 * @param {Point3d|PIXI.Point} other
 * @param {number} t  Ratio to move toward the other point.
 * @returns {Point3d|PIXI.Point}
 */
function projectToward(other, t, outPoint) {
  outPoint ??= new this.constructor();
  const delta = other.subtract(this, outPoint);
  this.add(delta.multiplyScalar(t, outPoint), outPoint);
  return outPoint;
}

/**
 * Find the point along a line from this point to another point
 * that equals the given coordinate value for the given coordinate.
 * @param {Point3d|PIXI.Point} other      Other point on the line
 * @param {number} value                  Value
 * @param {string} coordinate             "x", "y", or "z"
 * @param {Point3d|PIXI.Point} [outPoint] A point-like object to store the result.
 * @returns {t|null}    Null if the line is parallel to that coordinate axis.
 *   Pass an outPoint if the actual point is desired.
 */
function projectToAxisValue(other, value, coordinate, outPoint) {
  outPoint ??= new this.constructor();
  coordinate ??= "x";
  other.subtract(this, outPoint);
  if ( outPoint[coordinate] === 0 ) return null; // Line is parallel to that coordinate axis.

  const t = (value - this[coordinate]) / outPoint[coordinate];
  this.add(outPoint.multiplyScalar(t, outPoint), outPoint);
  return t;
}

/**
 * Rotate a point around a given angle
 * @param {number} angle  In radians
 * @param {Point3d|PIXI.Point} [outPoint] A point-like object to store the result.
 * @returns {Point} A new point
 */
function rotate(angle, outPoint) {
  outPoint ??= new this.constructor();

  const cAngle = Math.cos(angle);
  const sAngle = Math.sin(angle);
  outPoint.x = (this.x * cAngle) - (this.y * sAngle);
  outPoint.y = (this.y * cAngle) + (this.x * sAngle)
  return outPoint;
}

/**
 * Translate a point by a given dx, dy
 * @param {number} dx
 * @param {number} dy
 * @param {Point3d|PIXI.Point} [outPoint] A point-like object to store the result.
 * @returns {Point} A new point
 */
function translate(dx, dy, outPoint) {
  outPoint ??= new this.constructor();

  outPoint.x = this.x + dx;
  outPoint.y = this.y + dy;

  return outPoint;
}
