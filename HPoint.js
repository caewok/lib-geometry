/* globals
PIXI,
foundry
*/
"use strict";

// Homogenous Point class.

export class HPoint {
  _x = 0;
  _y = 0;
  _w = 0;

  /**
   * Create a new homogenous point.
   * @param {number} x        X coordinate
   * @param {number} y        Y coordinate
   * @param {number} [w=1]    Optional w value if not 1
   * @returns {HPoint}
   */
  static create(x, y, w = 1) {
    const pt = new this();
    pt._x = x || 0;
    pt._y = y || 0;
    pt._w = w;
    return pt;
  }

  /** @type {number} */
  get x() { return this._x / this._w; }

  /** @type {number} */
  get y() { return this._y / this._w; }

  /**
   * Add two homogenous points.
   * @param {HPoint} pt           Point to add to this point
   * @param {HPoint} [outPoint]   Where to store the result
   * @returns {HPoint}
   */
  add(pt, outPoint) {
    // Can only add when w is the same.
		outPoint ??= new this.constructor();
		if ( this._w !== pt._w ) pt = pt.multiply(this._w / pt._w, this.constructor.tmp);
		outPoint._x = this._x + pt._x;
	  outPoint._y = this._y + pt._y;
		outPoint._w = pt._w;
		return outPoint;
  }

  /**
   * Subtract two homogenous points.
   * @param {HPoint} pt           Point to add to this point
   * @param {HPoint} [outPoint]   Where to store the result
   * @returns {HPoint}
   */
  subtract(pt, outPoint) {
    // Can only subtract when w is the same.
		outPoint ??= new this.constructor();
		if ( this._w !== pt._w ) pt = pt.divideScalar(pt._w / this._w, this.constructor.tmp);
		outPoint._x = this._x - pt._x;
	  outPoint._y = this._y - pt._y;
		outPoint._w = pt._w;
		return outPoint;
  }

  /**
   * Multiply two homogenous points.
   * @param {HPoint} pt           Point to multiply with this point
   * @param {HPoint} [outPoint]   Where to store the result
   * @returns {HPoint}
   */
  multiply(pt, outPoint) {
    outPoint ??= new this.constructor();
    outPoint._x = this._x * pt._x;
    outPoint._y = this._y * pt._y;
    outPoint._w = this._w * pt._w;
    return outPoint;
  }


  /**
   * Multiply this point by a scalar.
   * @param {number} scalar         The number to multiply by
   * @param {HPoint} [outPoint]     Where to store the result
   * @returns {HPoint}
   */
  multiplyScalar(scalar, outPoint) { return this.divideScalar(1/scalar, outPoint); }

  /**
   * Divide this point by a scalar.
   * @param {number} scalar         The number to divide by
   * @param {HPoint} [outPoint]     Where to store the result
   * @returns {HPoint}
   */
  divideScalar(scalar, outPoint) {
    outPoint ??= new this.constructor();
    outPoint._x = this._x;
    outPoint._y = this._y;
    outPoint._w = this._w * scalar;
    return outPoint;
  }

  /**
   * Dot product of this point with another.
   * (Sum of the products of the components)
   * @param {HPoint} other
   * @returns {number}
   */
  dot(pt) {
    // Refactor to avoid repeated division.
    return ((this._x * pt._x) + (this._y * pt._y)) / (this._w * pt._w);
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
    return Math.hypot(this._x, this._y) / this._w;
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
    return (Math.pow(this._x, 2) + Math.pow(this._y, 2)) / Math.pow(this._w, 2);
  }

  /**
   * Cross two points. Only works for HPoint (3 dimensions).
   * @param {HPoint} other
   * @returns {HPoint}
   */
  cross(other, outPoint) {
    outPoint ??= new HPoint();
    outPoint._x = (this._y * other._w) - (this._w * other._y);
    outPoint._y = (this._w * other._x) - (this._x * other._w);
    outPoint._w = (this._x * other._y) - (this._y * other._x);
    return outPoint;
  }

  static tmp = new this();

  static tmp2 = new this();
}
