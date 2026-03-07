/* globals
canvas,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
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
 * An object representing points of a horizontal Tile
 * @typedef {object} Point3dTile
 * @property {Point3d} tl
 * @property {Point3d} tr
 * @property {Point3d} bl
 * @property {Point3d} br
 */
import { PoolableMixin } from "../Pool.js";
import { mix } from "../mixwith.js";
import { Matrix } from "../Matrix.js";
import { gridUnitsToPixels, roundDecimals, roundNearWhole } from "../util.js";

/**
 * 3-D version of PIXI.Point
 * See https://pixijs.download/dev/docs/packages_math_src_Point.ts.html
 */
// export class Point3d extends PIXI.Point { // Cannot extend PIXI.Point b/c on load, not yet patched with Poolable.
export class Point3d extends mix(PIXI.Point).with(PoolableMixin) {
  toJSON() { return { ...this }; }

  static [Symbol.hasInstance](instance) {
    return instance && instance.constructor && instance.constructor._geoLibType === this._geoLibType;
  }

  static get _geoLibType() { return this.name; }

  z = 0;

  /**
   * @param {number} [x=0] - position of the point on the x axis
   * @param {number} [y=0] - position of the point on the y axis
   * @param {number} [z=0] - position of the point on the z axis
   */
  constructor(x = 0, y = 0, z = 0) {
    super(x, y);
    this.z = z;
  }

  static onRelease(obj) {
    obj.z = 0;
    super.onRelease(obj);
  }

  /**
   * Iterator: x then y.
   */
  [Symbol.iterator]() {
    const keys = ["x", "y", "z"];
    const data = this;
    let index = 0;
    return {
      next() {
        if ( index < 3 ) return {
          value: data[keys[index++]],
          done: false };
        else return { done: true };
      }
    };
  }

  /**
   * Construct a Point3d from any object that has x and y and z properties.
   * Recognizes elevationZ and elevation as potential z properties.
   * @param {object} obj
   * @returns {Point3d}
   */
  static fromObject(obj) {
    const pt = super.fromObject(obj);
    pt.z = obj.z ?? obj.elevationZ ?? (gridUnitsToPixels(obj.elevation) || 0); // gridUnitsToPixels(undefined) = NaN. Use || b/c NaN || 0 returns 0.
    return pt;
  }

  /**
   * Point between two points on a line
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {Point3d}
   */
  static midPoint(a, b) {
    const point = super.midPoint(a, b);
    a.z ||= 0;
    b.z ||= 0;
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
    const dx = (b.x - a.x) || 0; // In case x is undefined.
    const dy = (b.y - a.y) || 0;
    const dz = (b.z - a.z) || 0;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Distance squared between two 3d points
   * @param {object} a    Any object with x,y,z properties
   * @param {object} b    Any object with x,y,z properties
   * @returns {number}
   */
  static distanceSquaredBetween(a, b) {
    const dx = (b.x - a.x) || 0; // In case x is undefined.
    const dy = (b.y - a.y) || 0;
    const dz = (b.z - a.z) || 0;
    return dx * dx + dy * dy + dz * dz;
  }

  /**
   * Determine the center point for the source.
   * @param {PointSource} source
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  static fromPointSource(source, outPoint) {
    outPoint ??= this.tmp;
    const { x, y, elevationZ } = source;
    outPoint.set(
      x ?? source.object.center.x, // Vision sources have no x, y.
      y ?? source.object.center.y,
      elevationZ);
    return outPoint;
  }

  /**
   * Determine the token top and bottom center points.
   * @param {Token} token
   * @returns {Point3dToken}
   */
  static fromToken(token) {
    const { x, y } = token.center;
    return {
      top: this.tmp.set(x, y, token.topZ),
      bottom: this.tmp.set(x, y, token.bottomZ)
    };
  }

  /**
   * Determine the token exact center point in 3d.
   * For height, uses the average between token bottom and top.
   * @param {Token} token
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  static fromTokenCenter(token, outPoint) {
    outPoint ??= this.tmp;
    const { center, bottomZ, topZ } = token;
    const z = bottomZ + ((topZ - bottomZ) * 0.5);
    outPoint.set(center.x, center.y, z);
    return outPoint;
  }

  /**
   * Determine the token vision point using the token vision multiplier in GeometryLib.
   * @param {Token} token
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  static fromTokenVisionHeight(token, outPoint) {
    outPoint ??= this.tmp;
    const { center, visionZ } = token;
    outPoint.set(center.x, center.y, visionZ);
    return outPoint;
  }

  /**
   * Determine the wall top and bottom points
   * @param {Wall} wall         Wall to convert to points object
   * @param {object} [options]  Options that affect the conversion
   * @param {boolean} [finite]  Force infinite z values to finite min/max safe integers
   * @returns {Point3dWall}
   */
  static fromWall(wall, { finite = false } = {}) {
    const { topZ, bottomZ, edge } = wall;

    // Use MAX instead of Number.MAX_SAFE_INTEGER to improve numerical accuracy
    // particularly when converting to/from 2d.
    const numDigits = numPositiveDigits(canvas.dimensions.maxR);
    const MAX = Number(`1e0${numDigits}`);

    const top = (finite && !isFinite(topZ)) ? MAX : topZ;
    const bottom = (finite && !isFinite(bottomZ)) ? -MAX : bottomZ;

    return {
      A: {
        top: this.tmp.set(edge.a.x, edge.a.y, top),
        bottom: this.tmp.set(edge.a.x, edge.a.y, bottom)
      },
      B: {
        top: this.tmp(edge.b.x, edge.b.y, top),
        bottom: this.tmp(edge.b.x, edge.b.y, bottom)
      }
    };
  }

  /**
   * Determine the tile corners and elevation.
   * @param {Tile} tile     Tile to convert to points object
   * @returns {Point3dTile} Points labeled in line with the tile texture, not necessarily its
   *   current orientation. So tl is top left of the tile texture before transforms.
   */
  static fromTile(tile) {
    const { elevationZ, bounds, document } = tile;
    const { width, height, texture, rotation } = document;
    const { scaleX, scaleY, offsetX, offsetY } = texture;

    // Build the points around 0,0 center.
    const w1_2 = width * scaleX * 0.5;
    const h1_2 = height * scaleY * 0.5;
    const pts = [
      Point3d.tmp.set(-w1_2, -h1_2, 0), // TL
      Point3d.tmp.set(w1_2, -h1_2, 0),  // TR
      Point3d.tmp.set(w1_2, h1_2, 0),   // BL
      Point3d.tmp.set(-w1_2, h1_2, 0)   // BR
    ];

    // Rotate points to match tile rotation.
    if ( rotation ) {
      const rotZ = Matrix.rotationZ(Math.toRadians(rotation));
      pts.forEach(pt => rotZ.multiplyPoint3d(pt, pt));
    }

    // Translate to canvas position.
    const center = bounds.center;
    const trM = Matrix.translation(center.x + offsetX, center.y + offsetY, elevationZ);
    pts.forEach(pt => trM.multiplyPoint3d(pt, pt));

    return {
      tl: pts[0],
      tr: pts[1],
      br: pts[2],
      bl: pts[3]
    };
  }

  /**
   * Get the angle between three 2d points, A --> B --> C.
   * Assumes A|B and B|C have lengths > 0.
   * See https://mathsathome.com/angle-between-two-vectors/
   * @param {Point3d} a   First point
   * @param {Point3d} b   Second point
   * @param {Point3d} c   Third point
   * @returns {number}  Angle, in radians
   */
  static angleBetween(a, b, c) {
    using tmp0 = this.tmp;
    using tmp1 = this.tmp;
    const ba = a.subtract(b, tmp0);
    const bc = c.subtract(b, tmp1);
    const dot = ba.dot(bc);
    const denom = ba.magnitude() * bc.magnitude();
    return Math.acos(dot / denom);
  }

  /**
   * Hash key for this point, with coordinates rounded to nearest integer.
   * Ordered, so sortable.
   * @returns {BigInt}
   */
  get key() { return this.constructor.key(this); }

  static key(pt) {
    const key2d = PIXI.Point.key(pt);
    const z = Math.round(pt.z || 0);
    return (BigInt(key2d) << 32n) ^ BigInt(z);
  }

  /**
   * Convert a 3d BitInt key back to {x, y, z}
   * Requires positive integers.
   * @param {BigInt} key3d
   * @returns {Point3d}
   */
  static invertKey(key3d, outPoint) {
    outPoint ??= this.tmp;

    // Extract the lower 32 bits for Z
    // Using the & mask ensures we only get the bits shifted into the lower area.
    outPoint.z = Number(key3d & 0xFFFFFFFFn);

    // Extract the upper 32 bits for the 2D key
    const k2d = Number(key3d >> 32n);

    // Use existing 2d logic.
    return super.invertKey(k2d, outPoint);
  }

  /**
   * Drop the z dimension; return a new PIXI.Point
   * @param {object} [opts]    Options that affect which axes are used
   * @param {string} [opts.x]  Which 3d axis to use for the x axis
   * @param {string} [opts.y]  Which 3d axis to use for the y axis
   * @param {boolean} [opts.homogeous] Whether to divde by the third ("z") axis
   * @returns {PIXI.Point}
   */
  to2d({x = "x", y = "y", homogenous = false} = {}, outPoint) {
    outPoint ??= PIXI.Point.tmp;

    if ( homogenous ) {
      let z = "z"
      if ( !(x === "x" && y === "y") ) { // In rare case when homogenous along another dimension.
        const coords = new Set(["x", "y", "z"]);
        coords.delete(x);
        coords.delete(y);
        z = coords.first();
      }
      return outPoint.set(this[x] / this[z], this[y] / this[z]);
    }
    return outPoint.set(this[x], this[y]);
  }

  /**
   * For parallel with PIXI.Point
   */
  to3d() {
    return this;
  }

  /**
   * Copy this point, return a new point.
   * @param {PIXI.Point} out    The new point to copy to.
   * @returns {PIXI.Point}
   */
  clone(out) {
    out = super.clone(out);
    out.z = this.z;
    return out;
  }

  /**
   * Copies `x` and `y` and `z` from the given point into this point.
   * @param {Point} p - The point to copy from
   * @returns {Point3d} The point instance itself
   */
  copyFrom(p) {
    this.set(p.x, p.y, p.z);
    return this;
  }

  /**
   * Copies `x` and `y` and `z` from the given point into this point.
   * Only copies properties that exist on p.
   * @param {Point} p - The point to copy from
   * @returns {Point3d} The point instance itself
   */
  copyPartial(p) {
    if ( Object.hasOwn(p, "z") ) this.z = p.z;
    return super.copyPartial(p);
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
   * Use roundDecimals to round the point coordinates to a certain number of decimals
   * @param {number} places   Number of decimals places to use when rounding.
   * @returns {this}
   */
  roundDecimals(places = 0) {
    super.roundDecimals(places);
    this.z = roundDecimals(this.z, places);
    return this;
  }

  /**
   * Round the point coordinates that are vary near a whole number, in place.
   * @param {number} [epsilon=1e-08]
   * @returns {this}
   */
  roundNearWhole(epsilon) {
    super.roundNearWhole(epsilon);
    this.z = roundNearWhole(this.z, epsilon);
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
    outPoint ??= this.constructor.tmp;
    super.add(other, outPoint);
    outPoint.z = this.z + (other.z || 0);

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
    outPoint ??= this.constructor.tmp;
    super.subtract(other, outPoint);
    outPoint.z = this.z - (other.z || 0);

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
    outPoint ??= this.constructor.tmp;
    super.multiply(other, outPoint);
    outPoint.z = this.z * (other.z || 0);

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
    outPoint ??= this.constructor.tmp;
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
    outPoint ??= this.constructor.tmp;
    super.multiplyScalar(scalar, outPoint);
    outPoint.z = this.z * scalar;

    return outPoint;
  }

  /**
   * Get the minimum of x and y values, respectively, between two points.
   * @param {Point3d} other    The point to compare to `this`.
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  min(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    super.min(other, outPoint);
    outPoint.z = Math.min(this.z, other.z);
    return outPoint;
  }

  /**
   * Get the maximum of x and y values, respectively, between two points.
   * @param {Point3d} other    The point to compare to `this`.
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  max(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    super.max(other, outPoint);
    outPoint.z = Math.max(this.z, other.z);
    return outPoint;
  }

  /**
   * Get the absolute of the coordinates.
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  abs(outPoint) {
    outPoint ??= this.constructor.tmp;
    super.abs(outPoint);
    outPoint.z = Math.abs(this.z);
    return outPoint;
  }

  /**
   * Get the floor of the coordinates.
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  floor(outPoint) {
    outPoint ??= this.constructor.tmp;
    super.abs(outPoint);
    outPoint.z = Math.floor(this.z);
    return outPoint;
  }

  /**
   * Get the ceil of the coordinates.
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  ceil(outPoint) {
    outPoint ??= this.constructor.tmp;
    super.abs(outPoint);
    outPoint.z = Math.ceil(this.z);
    return outPoint;
  }

  /**
   * Dot product of this point with another.
   * (Sum of the products of the components)
   * @param {Point3d} other
   * @return {number}
   */
  dot(other) {
    return super.dot(other) + (this.z * (other.z || 0));
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
    return super.magnitudeSquared() + (this.z ** 2);
  }

  /**
   * Test if `this` is nearly equal to another point.
   * @param {Point3d} other
   * @param {number} [epsilon=1e-08]
   * @returns {boolean}
   */
  almostEqual(other, epsilon = 1e-08) {
    return super.almostEqual(other, epsilon) && this.z.almostEqual(other.z ?? 0, epsilon);
  }

  /**
   * Test if `this` is equal in 2d to another point.
   * @param {Point3d|PIXI.Point} other
   * @returns {boolean}
   */
  equalXY(other) {
    using pt2d = PIXI.Point.tmp.set(this.x, this.y);
    return pt2d.equals(other);
  }

  /**
   * Test if `this` is almost equal in 2d to another point.
   * @param {Point3d|PIXI.Point} other
   * @param {number} [epsilon=1e-08]
   * @returns {boolean}
   */
  almostEqualXY(other, epsilon) {
    using pt2d = PIXI.Point.tmp.set(this.x, this.y);
    return pt2d.almostEqual(other, epsilon);
  }

  /**
   * Cross product between this point, considered here as a vector, and another vector.
   * @param {Point3d} other
   * @param {Point3d} [outPoint]  A point-like object in which to store the value.
   * @returns {Point3d}
   */
  cross(other, outPoint) {
    outPoint ??= this.constructor.tmp;

    // Avoid overwriting other incase it is outPoint.
    const x = (this.y * other.z) - (this.z * other.y);
    const y = (this.z * other.x) - (this.x * other.z);
    outPoint.z = (this.x * other.y) - (this.y * other.x);
    outPoint.x = x;
    outPoint.y = y;

    return outPoint;
  }

  /**
   * Normalize the point.
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  normalize(outPoint) {
    outPoint ??= this.constructor.tmp;
    return super.normalize(outPoint);
  }
}

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

Point3d.prototype.toString = function() { return `{x: ${this.x}, y: ${this.y}, z: ${this.z}}`};

Point3d.ZERO = new Point3d(0, 0, 0);
Object.freeze(Point3d.ZERO);

