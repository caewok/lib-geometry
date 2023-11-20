/* globals
CONFIG,
PIXI,
foundry
*/
"use strict";

import { Point3d } from "../3d/Point3d.js";
import { addClassGetter, addClassMethod } from "../util.js";

// Add methods to PIXI.Point
export function registerPIXIPointMethods() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.registered ??= new Set();
  if ( CONFIG.GeometryLib.registered.has("PIXI.Point") ) return;

  // ----- Getters/Setters ----- //
  addClassGetter(PIXI.Point.prototype, "key", key);
  addClassGetter(PIXI.Point.prototype, "sortKey", sortKey);

  // ----- Static Methods ----- //
  addClassMethod(PIXI.Point, "midPoint", midPoint);
  addClassMethod(PIXI.Point, "fromAngle", fromAngleStatic);
  addClassMethod(PIXI.Point, "distanceBetween", distanceBetween);
  addClassMethod(PIXI.Point, "distanceSquaredBetween", distanceSquaredBetween);
  addClassMethod(PIXI.Point, "angleBetween", angleBetween);
  addClassMethod(PIXI.Point, "flatMapPoints", flatMapPoints);
  addClassMethod(PIXI.Point, "fromObject", fromObject);
  addClassMethod(PIXI.Point, "invertKey", invertKey);

  // ----- Methods ----- //
  addClassMethod(PIXI.Point.prototype, "add", add2d);
  addClassMethod(PIXI.Point.prototype, "subtract", subtract2d);
  addClassMethod(PIXI.Point.prototype, "multiply", multiply2d);
  addClassMethod(PIXI.Point.prototype, "multiplyScalar", multiplyScalar2d);
  addClassMethod(PIXI.Point.prototype, "copyPartial", copyPartial);
  addClassMethod(PIXI.Point.prototype, "dot", dot2d);
  addClassMethod(PIXI.Point.prototype, "magnitude", magnitude2d);
  addClassMethod(PIXI.Point.prototype, "magnitudeSquared", magnitudeSquared2d);
  addClassMethod(PIXI.Point.prototype, "almostEqual", almostEqual2d);
  addClassMethod(PIXI.Point.prototype, "normalize", normalize);
  addClassMethod(PIXI.Point.prototype, "to3d", to3d);
  addClassMethod(PIXI.Point.prototype, "projectToward", projectToward);
  addClassMethod(PIXI.Point.prototype, "towardsPoint", towardsPoint);
  addClassMethod(PIXI.Point.prototype, "towardsPointSquared", towardsPointSquared);
  addClassMethod(PIXI.Point.prototype, "projectToAxisValue", projectToAxisValue);
  addClassMethod(PIXI.Point.prototype, "translate", translate);
  addClassMethod(PIXI.Point.prototype, "rotate", rotate);
  addClassMethod(PIXI.Point.prototype, "roundDecimals", roundDecimals);
  addClassMethod(PIXI.Point.prototype, "fromAngle", fromAngle);

  // For parallel with Point3d
  addClassMethod(PIXI.Point.prototype, "to2d", function() { return this; });

  CONFIG.GeometryLib.registered.add("PIXI.Point");
}

/**
 * Invert a wall key to get the coordinates.
 * Key = (MAX_TEXTURE_SIZE * x) + y, where x and y are integers.
 * @param {number} key      Integer key
 * @returns {PIXI.Point} coordinates
 */
function invertKey(key) {
  const x = Math.floor(key * MAX_TEXTURE_SIZE_INV);
  const y = key - (MAX_TEXTURE_SIZE * x);
  return new PIXI.Point(x, y);
}

/**
 * Use Math.roundDecimals to round the point coordinates to a certain number of decimals
 * @param {number} places   Number of decimals places to use when rounding.
 * @returns {this}
 */
function roundDecimals(places = 0) {
  this.x = Math.roundDecimals(this.x, places);
  this.y = Math.roundDecimals(this.y, places);
  return this;
}

/**
 * Construct a PIXI point from any object that has x and y properties.
 * @param {object} obj
 * @returns {PIXI.Point}
 */
function fromObject(obj) {
  const x = obj.x ?? 0;
  const y = obj.y ?? 0;
  return new this(x, y);
}

/**
 * Get the angle between three 2d points, A --> B --> C.
 * Assumes A|B and B|C have lengths > 0.
 * @param {Point} a   First point
 * @param {Point} b   Second point
 * @param {Point} c   Third point
 * @param {object} [options]  Options that affect the calculation
 * @param {boolean} [options.clockwiseAngle]  If true, return the clockwise angle.
 * @returns {number}  Angle, in radians
 */
function angleBetween(a, b, c, { clockwiseAngle = false } = {}) {
  // See https://mathsathome.com/angle-between-two-vectors/
  // Create new pixi points so that 2d distance works when passing 3d points.
  const ba = new PIXI.Point(a.x - b.x, a.y - b.y);
  const bc = new PIXI.Point(c.x - b.x, c.y - b.y);
  const dot = ba.dot(bc);
  const denom = ba.magnitude() * bc.magnitude();

  let angle = Math.acos(dot / denom);
  if ( clockwiseAngle && foundry.utils.orient2dFast(a, b, c) > 0 ) angle = (Math.PI * 2) - angle;
  return angle;
}

/**
 * Distance between two 2d points
 * @param {object} a    Any object with x,y properties
 * @param {object} b    Any object with x,y properties
 * @returns {number}
 */
function distanceBetween(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

/**
 * Distance squared between two 2d points
 * @param {object} a    Any object with x,y properties
 * @param {object} b    Any object with x,y properties
 * @returns {number}
 */
function distanceSquaredBetween(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.pow(dx, 2) + Math.pow(dy, 2);
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
function fromAngleStatic(origin, radians, distance) {
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  return new this(origin.x + (dx * distance), origin.y + (dy * distance));
}

/**
 * Same as Ray.fromAngle but returns a point instead of constructing the full Ray.
 * @param {Number}  radians   Angle to move from the starting point.
 * @param {Number}  distance  Distance to travel from the starting point.
 * @param {PIXI.Point} [outPoint]    A point-like object in which to store the value.
 *   (Will create new point if none provided.)
 * @returns {Point}  Coordinates of point that lies distance away from origin along angle.
 */
function fromAngle(radians, distance, outPoint) {
  outPoint ??= new this.constructor();
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  outPoint.copyFrom({ x: dx, y: dy});
  return this.add(outPoint.multiplyScalar(distance, outPoint), outPoint);
}

/**
 * Copies `x` and `y` and `z` from the given point into this point.
 * Only copies properties that exist on p.
 * So it is permissible to pass, e.g., pt.copyFrom({y: 2}).
 * @param {Point} p - The point to copy from
 * @returns {Point3d} The point instance itself
 */
function copyPartial(p) {
  if ( Object.hasOwn(p, "x") ) this.x = p.x;
  if ( Object.hasOwn(p, "y") ) this.y = p.y;
  return this;
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
function almostEqual2d(other, epsilon = 1e-08) {
  return this.x.almostEqual(other.x, epsilon) && this.y.almostEqual(other.y, epsilon);
}

/**
 * Normalize the point.
 * @param {PIXI.Point} [outPoint]    A point-like object in which to store the value.
 *   (Will create new point if none provided.)
 * @returns {PIXI.Point}
 */
function normalize(outPoint) {
  return this.multiplyScalar(1 / this.magnitude(), outPoint);
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
 * Project a certain distance toward a known point.
 * @param {PIXI.Point} other    The point toward which to project
 * @param {number} distance     The distance to move from this toward other.
 * @returns {Point3d|PIXI.Point}
 */
function towardsPoint(other, distance, outPoint) {
  outPoint ??= new this.constructor();
  const delta = other.subtract(this, outPoint);
  const t = distance / delta.magnitude();
  this.add(delta.multiplyScalar(t, outPoint), outPoint);
  return outPoint;
}

/**
 * Project a certain squared-distance toward a known point.
 * @param {PIXI.Point} other    The point toward which to project
 * @param {number} distance2     The distance-squared to move from this toward other.
 * @returns {Point3d|PIXI.Point}
 */
function towardsPointSquared(other, distance2, outPoint) {
  outPoint ??= new this.constructor();
  const delta = other.subtract(this, outPoint);
  const t = Math.sqrt(distance2 / delta.magnitudeSquared());
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
  const { x, y } = this; // Avoid accidentally using the outPoint values when calculating new y.
  outPoint.x = (x * cAngle) - (y * sAngle);
  outPoint.y = (y * cAngle) + (x * sAngle);
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

/**
 * The effective maximum texture size that Foundry VTT "ever" has to worry about.
 * @type {number}
 */
const MAX_TEXTURE_SIZE = Math.pow(2, 16);
const MAX_TEXTURE_SIZE_INV = 1 / MAX_TEXTURE_SIZE;

/**
 * Sort key, arranging points from north-west to south-east
 * @returns {number}
 */
function sortKey() {
  const x = Math.round(this.x);
  const y = Math.round(this.y);
  return (MAX_TEXTURE_SIZE * x) + y;
}
