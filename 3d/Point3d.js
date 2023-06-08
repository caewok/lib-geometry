/* globals
PIXI,
canvas
*/
"use strict";

/**
 * An object representing top and bottom points, like that for a Token.
 * @typedef {object} Point3dToken
 * @property {Point3d} top
 * @property {Point3d} bottom
 */

/**
 * An object representing points of a vertical Wall
 * TODO: Flip these, so top and bottom represent segments A|B
 * @typedef {object} Point3dWall
 * @property {object} [A]
 * @property {Point3d} [A.top]
 * @property {Point3d} [A.bottom]
 * @property {object} [B]
 * @property {Point3d} [B.top]
 * @property {Point3d} [B.bottom]
 */


/**
 * 3-D version of PIXI.Point
 * See https://pixijs.download/dev/docs/packages_math_src_Point.ts.html
 */
export class Point3d extends PIXI.Point {
  /**
   * @param {number} [x=0] - position of the point on the x axis
   * @param {number} [y=0] - position of the point on the y axis
   * @param {number} [z=0] - position of the point on the z axis
   */
  constructor(x = 0, y = 0, z = 0) {
    super(x, y);
    this.z = z;
  }

  /**
   * Check if 3d points are oriented clockwise.
   * ChatGPT
   * This function calculates the cross product of the two edge vectors of the triangle
   * formed by the three points using the subtract and cross functions. It then checks
   * if the z component of the cross product is greater than zero, which indicates that
   * the points are oriented clockwise. If the z component is less than or equal to zero,
   * the points are oriented counter-clockwise.
   *
   * Note that this function assumes that the points are given in a right-handed coordinate system,
   * where the positive z-axis points out of the screen. If the points are given in a
   * left-handed coordinate system, the function should be modified to check if the z
   * component of the cross product is less than zero.
   * @param {Point3d} a
   * @param {Point3d} b
   * @param {Point3d} c
   * @returns {number} The z-component of the cross. Comparable to foundry.utils.orient2d
   *   0: colinear
   *   positive: CCW (right-handed system, incl. Foundry)
   *   negative: CW (right-handed system, incl. Foundry)
   */
  static orient(a, b, c) {
    const dBA = b.subtract(a);
    const dCB = c.subtract(b);
    const crossProduct = dBA.cross(dCB);

    return -crossProduct.z;
  }

  /**
   * Point between two points on a line
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {Point3d}
   */
  static midPoint(a, b) {
    const point = super.midPoint(a, b);
    point.z = a.z + ((b.z - a.z) * 0.5);
    return point;
  }

  /**
   * Same as Ray.fromAngle but returns a point instead of constructing the full Ray.
   * @param {Point}   origin    Starting point.
   * @param {Number}  radians   Angle to move from the starting point in XY plane
   * @param {Number}  distance  Distance to travel from the starting point in XY plane.
   * @param {Number}  dz        Change in z direction from the origin
   * @returns {Point}  Coordinates of point that lies distance away from origin along angle.
   */
  static fromAngle(origin, radians, distance, dz = 0) {
    const point = super.fromAngle(origin, radians, distance);
    point.z = dz;
    return point;
  }

  /**
   * Distance between two 3d points
   * @param {object} a    Any object with x,y,z properties
   * @param {object} b    Any object with x,y,z properties
   * @returns {number}
   */
  static distanceBetween(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    return Math.hypot(dx, dy, dz);
  }

  /**
   * Distance squared between two 3d points
   * @param {object} a    Any object with x,y,z properties
   * @param {object} b    Any object with x,y,z properties
   * @returns {number}
   */
  static distanceSquaredBetween(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    return Math.pow(dx, 2) + Math.pow(dy, 2) + Math.pow(dz, 2);
  }

  /**
   * Determine the center point for the source.
   * @param {PointSource} source
   * @returns {Point3d}
   */
  static fromPointSource(source) {
    const { x, y, elevationZ } = source;
    return new Point3d(x, y, elevationZ);
  }

  /**
   * Determine the token top and bottom center points.
   * @param {Token} token
   * @returns {Point3dToken}
   */
  static fromToken(token) {
    const { x, y } = token.center;
    return {
      top: new Point3d(x, y, token.topZ),
      bottom: new Point3d(x, y, token.bottomZ)
    };
  }

  /**
   * Determine the token exact center point in 3d.
   * For height, uses the average between token bottom and top.
   * @param {Token} token
   * @returns {Point3d}
   */
  static fromTokenCenter(token) {
    const { center, bottomZ, topZ } = token;
    const e = bottomZ + ((topZ - bottomZ) * 0.5);
    return new Point3d(center.x, center.y, e);
  }

  /**
   * Determine the wall top and bottom points
   * @param {Wall} wall         Wall to convert to points object
   * @param {object} [options]  Options that affect the conversion
   * @param {boolean} [finite]  Force infinite z values to finite min/max safe integers
   * @returns {Point3dWall}
   */
  static fromWall(wall, { finite = false } = {}) {
    const { topZ, bottomZ, A, B } = wall;

    // Use MAX instead of Number.MAX_SAFE_INTEGER to improve numerical accuracy
    // particularly when converting to/from 2d.
    const numDigits = numPositiveDigits(canvas.dimensions.maxR);
    const MAX = Number(`1e0${numDigits}`);

    const top = (finite && !isFinite(topZ)) ? MAX : topZ;
    const bottom = (finite && !isFinite(bottomZ)) ? -MAX : bottomZ;

    return {
      A: {
        top: new Point3d(A.x, A.y, top),
        bottom: new Point3d(A.x, A.y, bottom)
      },
      B: {
        top: new Point3d(B.x, B.y, top),
        bottom: new Point3d(B.x, B.y, bottom)
      }
    };
  }

  /**
   * Hash key for this point, with coordinates rounded to nearest integer.
   * Ordered, so sortable.
   * @returns {BigInt}
   */
  get key() {
    const z = Math.round(this.z);
    const key2d = super.key;
    return (BigInt(key2d) << 32n) ^ BigInt(z);
  }

  /**
   * Sort key. If z values are equal, will arrange points from north-west to south-east along z plane.
   * @returns {number}
   */
  get sortKey() {
    return (MAX_TEXTURE_SIZE2 * Math.roundFast(this.z))
      + (MAX_TEXTURE_SIZE * Math.roundFast(this.x))
      + Math.roundFast(this.y);
  }

  /**
   * Drop the z dimension; return a new PIXI.Point
   * @param [object] [options]    Options that affect which axes are used
   * @param [string] [options.x]  Which 3d axis to use for the x axis
   * @param [string] [options.y]  Which 3d axis to use for the y axis
   * @returns {PIXI.Point}
   */
  to2d({x = "x", y = "y"} = {}) {
    return new PIXI.Point(this[x], this[y]);
  }

  /**
   * For parallel with PIXI.Point
   */
  to3d() {
    return this;
  }

  /**
   * Creates a clone of this point
   * @returns A clone of this point
   */
  clone() {
    return new this.constructor(this.x, this.y, this.z);
  }

  /**
   * Copies `x` and `y` and `z` from the given point into this point
   * @param {Point} p - The point to copy from
   * @returns {Point3d} The point instance itself
   */
  copyFrom(p) {
    this.set(p.x, p.y, p.z);
    return this;
  }

  /**
   * Copies this point's x and y and z into the given point (`p`).
   * @param p - The point to copy to. Can be any of type that is or extends `IPointData`
   * @returns {Point} The point (`p`) with values updated
   */
  copyTo(p) {
    p.set(this.x, this.y, this.z);
    return p;
  }

  /**
   * Accepts another point (`p`) and returns `true` if the given point is equal to this point
   * @param p - The point to check
   * @returns {boolean} Returns `true` if both `x` and `y` are equal
   */
  equals(p) {
    const z = p.z ?? 0;
    return (p.x === this.x) && (p.y === this.y) && (z === this.z);
  }

  /*
   * Sets the point to a new `x` and `y` position.
   * If `y` is omitted, both `x` and `y` will be set to `x`.
   * If `z` is omitted, it will be set to 0
   * @param {number} [x=0] - position of the point on the `x` axis
   * @param {number} [y=x] - position of the point on the `y` axis
   * @returns {Point3d} The point instance itself
   */
  set(x = 0, y = x, z = 0) {
    super.set(x, y);
    this.z = z;
    return this;
  }

  /**
   * Use Math.roundDecimals to round the point coordinates to a certain number of decimals
   * @param {number} places   Number of decimals places to use when rounding.
   * @returns {this}
   */
  roundDecimals(places = 0) {
    super.roundDecimals(places);
    this.z = Math.roundDecimals(this.z, places);
    return this;
  }

  /**
   * Add a point to this one.
   * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
   * @param {PIXI.Point} other    The point to add to `this`.
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  add(other, outPoint) {
    outPoint ??= new this.constructor();
    super.add(other, outPoint);
    outPoint.z = this.z + (other.z ?? 0);

    return outPoint;
  }

  /**
   * Subtract a point from this one.
   * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
   * @param {Point3d|PIXI.Point} other    The point to subtract from `this`.
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  subtract(other, outPoint) {
    outPoint ??= new this.constructor();
    super.subtract(other, outPoint);
    outPoint.z = this.z - (other.z ?? 0);

    return outPoint;
  }

  /**
   * Multiply `this` point by another.
   * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
   * @param {Point3d|PIXI.Point} other    The point to subtract from `this`.
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  multiply(other, outPoint) {
    outPoint ??= new this.constructor();
    super.multiply(other, outPoint);
    outPoint.z = this.z * (other.z ?? 0);

    return outPoint;
  }

  /**
   * Divide `this` point by another.
   * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
   * @param {Point3d|PIXI.Point} other    The point to subtract from `this`.
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  divide(other, outPoint) {
    outPoint ??= new this.constructor();
    super.divide(other, outPoint);
    outPoint.z = this.z / other.z;

    return outPoint;
  }

  /**
   * Multiply `this` point by a scalar
   * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
   * @param {Point3d|PIXI.Point} other    The point to subtract from `this`.
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  multiplyScalar(scalar, outPoint) {
    outPoint ??= new this.constructor();
    super.multiplyScalar(scalar, outPoint);
    outPoint.z = this.z * scalar;

    return outPoint;
  }

  /**
   * Dot product of this point with another.
   * (Sum of the products of the components)
   * @param {Point3d} other
   * @return {number}
   */
  dot(other) {
    return super.dot(other) + (this.z * (other.z ?? 0));
  }

  /**
   * Magnitude (length, or sometimes distance) of this point.
   * Square root of the sum of squares of each component.
   * @returns {number}
   */
  magnitude() {
    // Same as Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z)
    return Math.hypot(this.x, this.y, this.z);
  }

  /**
   * Magnitude squared.
   * Avoids square root calculations.
   * @returns {number}
   */
  magnitudeSquared() {
    return super.magnitudeSquared() + Math.pow(this.z, 2);
  }

  /**
   * Test if `this` is nearly equal to another point.
   * @param {PIXI.Point} other
   * @param {number} epsilon
   * @returns {boolean}
   */
  almostEqual(other, epsilon = 1e-08) {
    return super.almostEqual(other, epsilon) && this.z.almostEqual(other.z ?? 0, epsilon);
  }

  /**
   * Cross product between this point, considered here as a vector, and another vector.
   * @param {Point3d} other
   * @param {Point3d} [outPoint]  A point-like object in which to store the value.
   * @returns {Point3d}
   */
  cross(other, outPoint) {
    outPoint ??= new this.constructor();
    outPoint.x = (this.y * other.z) - (this.z * other.y);
    outPoint.y = (this.z * other.x) - (this.x * other.z);
    outPoint.z = (this.x * other.y) - (this.y * other.x);

    return outPoint;
  }

  /**
   * Normalize the point.
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  normalize(outPoint = new Point3d()) {
    return super.normalize(outPoint);
  }
}

/**
 * The effective maximum texture size that Foundry VTT "ever" has to worry about.
 * @type {number}
 */
const MAX_TEXTURE_SIZE = Math.pow(2, 16);
const MAX_TEXTURE_SIZE2 = Math.pow(MAX_TEXTURE_SIZE, 2);

/**
 * Count the number of positive integer digits.
 * Will return 0 for negative numbers.
 * Will truncate any decimals.
 * https://stackoverflow.com/questions/14879691/get-number-of-digits-with-javascript
 * @param {number}      A positive number
 * @returns {number}    The number of digits before the decimal
 */
export function numPositiveDigits(n) {
  return (Math.log(n) * Math.LOG10E) + 1 | 0;
}

