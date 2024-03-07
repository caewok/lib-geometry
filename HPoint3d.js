/* globals
PIXI,
foundry
*/
"use strict";

import { HPoint } from "./HPoint.js";

// Homogenous Point3d class.

export class HPoint3d extends HPoint {
  _z = 0

  /**
   * Create a new homogenous point.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} [w=1]
   */
  static create(x, y, z, w = 1) {
    const pt = super.create(x, y, w);
    pt._z = z;
    return pt;
  }

  toMatrix() { return new Matrix([[this._x, this._y, this._z, this._w]]); }

  /**
   * Normalize the point by dividing the components by w.
   * @returns {HPoint}
   */
  norm() { return this.constructor.create(this.x, this.y, this.z, 1); }

  /**
   * Convert to a Cartesian point.
   * @returns {PIXI.Point}
   */
  cart() { return new Point3d(this.x, this.y, this.z); }

  /** @type {number} */
  get z() { return this._z / this._w; }

  /**
   * Add two homogenous points.
   * @param {HPoint3d} pt           Point to add to this point
   * @param {HPoint3d} [outPoint]   Where to store the result
   * @returns {HPoint3d}
   */
  add(pt, outPoint) {
    // See https://community.khronos.org/t/adding-homogeneous-coordinates-is-too-easy/49573
		outPoint ??= new this.constructor();
		super.add(pt, outPoint);
		outPoint._z = this._z + pt._z;
		return outPoint;
  }

  /**
   * Subtract two homogenous points
   * @param {HPoint3d} pt           Point to add to this point
   * @param {HPoint3d} [outPoint]   Where to store the result
   * @returns {HPoint3d}
   */
  subtract(pt, outPoint) {
    // See https://community.khronos.org/t/adding-homogeneous-coordinates-is-too-easy/49573
		outPoint ??= new this.constructor();
		super.subtract(pt, outPoint);
		outPoint._z = this._z - pt._z;
		return outPoint;
  }

  /**
   * Multiply two homogenous points.
   * @param {HPoint3d} pt           Point to multiply with this point
   * @param {HPoint3d} [outPoint]   Where to store the result
   * @returns {HPoint3d}
   */
  multiply(pt, outPoint) {
    outPoint ??= new this.constructor();
		super.multiply(pt, outPoint);
    outPoint._z = this._z * pt._z;
    return outPoint;
  }

  /**
   * Scale this point by a given number.
   * Comparable to multiply but using a scalar instead of a point.
   * E.g., if the point is {1,2,3} and it is scaled by 2, it would be {2,4,6}.
   * @param {number} scalar         The number to multiply by
   * @param {HPoint3d} [outPoint]     Where to store the result
   * @returns {HPoint3d}
   */
  scale(scalar, outPoint) {
    outPoint ??= new this.constructor();
    super.scale(scalar, outPoint);
    outPoint._z = this._z * scalar;
    return outPoint;
  }

  /**
   * Divide this point by a scalar.
   * @param {number} scalar         The number to divide by
   * @param {HPoint3d} [outPoint]     Where to store the result
   * @returns {HPoint3d}
   */
  divideScalar(scalar, outPoint) {
    outPoint ??= new this.constructor();
    super.divideScalar(scalar, outPoint);
    outPoint._z = this._z;
    return outPoint;
  }

  /**
   * Dot product of this point with another.
   * (Sum of the products of the components)
   * @param {HPoint3d} other
   * @return {number}
   */
  dot(pt) {
    // Refactor to avoid repeated division.
    return ((this._x * pt._x) + (this._y * pt._y) + (this._z * pt._z)) / (this._w * pt._w);
  }

  /**
   * Magnitude (length, or sometimes distance) of this point.
   * Square root of the sum of squares of each component.
   * @returns {number}
   */
  magnitude() {
    // Refactor to avoid repeated division.
    // W values are identical; can factor out.
    // Same as Math.sqrt(this.x * this.x + this.y * this.y)
    return Math.hypot(this._x, this._y, this._z) / this._w;
  }

  /**
   * Magnitude squared.
   * Avoids square root calculations.
   * @returns {number}
   */
  magnitudeSquared() {
    // Refactor to avoid repeated division.
    // W values are identical; can factor out.
    // x/w * x/w + y/w * y/w
    // x2 / w2 + y2 / w2 ==> (x2 + y2) / w2
    return (Math.pow(this._x, 2) + Math.pow(this._y, 2) + Math.pow(this._z, 2)) / Math.pow(this._w, 2);
  }

  static distanceBetween(a, b) {
    // Simple: return a.subtract(b, this.tmp).magnitude();
    if ( a._w === b._w ) {
      const A = Math.pow(a._x - b._x, 2) + Math.pow(a._y - b._y, 2) + Math.pow(a._z - b._z, 2);
      return Math.sqrt(A) / a._w;
    }

    const X2 = Math.pow((a._x * b._w) - (b._x * a._w), 2);
    const Y2 = Math.pow((a._y * b._w) - (b._y * a._w), 2);
    const Z2 = Math.pow((a._z * b._w) - (b._w * a._w), 2);
    return Math.sqrt(X2 + Y2 + Z2) / (a._w * b._w);
  }

  static distanceSquaredBetween(a, b) {
    // Simple: return a.subtract(b, this.tmp).magnitudeSquared();
    if ( a._w === b._w ) {
      const A = Math.pow(a._x - b._x, 2) + Math.pow(a._y - b._y, 2) + Math.pow(a._z - b._z, 2);
      return A / Math.pow(a._w, 2);
    }

    const X2 = Math.pow((a._x * b._w) - (b._x * a._w), 2);
    const Y2 = Math.pow((a._y * b._w) - (b._y * a._w), 2);
    const Z2 = Math.pow((a._z * b._w) - (b._w * a._w), 2);
    return (X2 + Y2) / Math.pow(a._w * b._w, 2);
  }

  static tmp = new this();

  static tmp2 = new this();
}



