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

  toMatrix() { return new Matrix([[this._x, this._y, this._w]]); }

  /**
   * Normalize the point by dividing the components by w.
   * @param {HPoint} [outPoint]   Where to store the result. If undefined, modifies in place.
   * @returns {HPoint}
   */
  norm(outPoint) {
    outPoint ??= this;
    outPoint._x = this.x;
    outPoint._y = this.y;
    outPoint._w = 1;
    return outPoint;
  }

  /**
   * Convert to a Cartesian point.
   * @returns {PIXI.Point}
   */
  cart() { return new PIXI.Point(this.x, this.y); }

  /** @type {number} */
  get x() { return this._x / this._w; }

  /** @type {number} */
  get y() { return this._y / this._w; }

  /**
   * Add two homogenous points.
   * @param {HPoint} pt           Point to add to this point
   * @param {HPoint} [outPoint]   Where to store the result. If undefined, modifies in place.
   * @returns {HPoint}
   */
  add(pt, outPoint) {
    // Can only add when w is the same.
		outPoint ??= this;
		if ( this._w !== pt._w ) pt = pt.scale(this._w / pt._w, this.constructor.tmp);
		outPoint._x = this._x + pt._x;
	  outPoint._y = this._y + pt._y;
		outPoint._w = pt._w;
		return outPoint;
  }

  /**
   * Subtract two homogenous points.
   * @param {HPoint} pt           Point to add to this point
   * @param {HPoint} [outPoint]   Where to store the result. If undefined, modifies in place.
   * @returns {HPoint}
   */
  subtract(pt, outPoint) {
    // Can only subtract when w is the same.
		outPoint ??= this;
		if ( this._w !== pt._w ) pt = pt.scale(this._w / pt._w, this.constructor.tmp);
		outPoint._x = this._x - pt._x;
	  outPoint._y = this._y - pt._y;
		outPoint._w = pt._w;
		return outPoint;
  }

  /**
   * Multiply two homogenous points.
   * @param {HPoint} pt           Point to multiply with this point
   * @param {HPoint} [outPoint]   Where to store the result. If undefined, modifies in place.
   * @returns {HPoint}
   */
  multiply(pt, outPoint) {
    outPoint ??= this;
    outPoint._x = this._x * pt._x;
    outPoint._y = this._y * pt._y;
    outPoint._w = this._w * pt._w;
    return outPoint;
  }

  /**
   * Scale this point by a given number.
   * Comparable to multiply but using a scalar instead of a point.
   * E.g., if the point is {1,2,3} and it is scaled by 2, it would be {2,4,6}.
   * @param {number} scalar         The number to multiply by
   * @param {HPoint} [outPoint]   Where to store the result. If undefined, modifies in place.
   * @returns {HPoint}
   */
  scale(scalar, outPoint) {
    outPoint ??= this;
    outPoint._x = this._x * scalar;
    outPoint._y = this._y * scalar;
    outPoint._w = this._w * scalar;
    return outPoint;
  }

  /**
   * Multiply this point by a scalar.
   * @param {number} scalar         The number to multiply by
   * @param {HPoint} [outPoint]   Where to store the result. If undefined, modifies in place.
   * @returns {HPoint}
   */
  multiplyScalar(scalar, outPoint) { return this.divideScalar(1/scalar, outPoint); }

  /**
   * Divide this point by a scalar.
   * @param {number} scalar         The number to divide by
   * @param {HPoint} [outPoint]   Where to store the result. If undefined, modifies in place.
   * @returns {HPoint}
   */
  divideScalar(scalar, outPoint) {
    outPoint ??= this;
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
    return (this._x * pt._x) + (this._y * pt._y) + (this._w * pt._w);
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
   * @param {HPoint} [outPoint]   Where to store the result. If undefined, modifies in place.
   * @returns {HPoint}
   */
  cross(other, outPoint) {
    outPoint ??= this;
    outPoint._x = (this._y * other._w) - (this._w * other._y);
    outPoint._y = (this._w * other._x) - (this._x * other._w);
    outPoint._w = (this._x * other._y) - (this._y * other._x);
    return outPoint;
  }

  // TODO: Get a translate matrix and translate this point to another instead of towardsPoint, etc.

  /**
   * Locate a point along the line between this point and another point, at a given distance.
   * @param {HPoint} other
   * @param {number} distance
   * @param {HPoint} [outPoint]   Where to store the result. If undefined, modifies in place.
   * @returns {HPoint}
   */
  towardsPoint(other, distance, outPoint) {
    outPoint ??= this;
    const delta = other.subtract(this, outPoint);
    const t = distance / delta.magnitude();
    this.add(delta.multiplyScalar(t, outPoint), outPoint);
    return outPoint;
  }

  static tmp = new this();

  static tmp2 = new this();

  static distanceBetween(a, b) {
    // Simple: return a.subtract(b, this.tmp).magnitude();
    if ( a._w === b._w ) {
      const A = Math.pow(a._x - b._x, 2) + Math.pow(a._y - b._y, 2);
      return Math.sqrt(A) / a._w;
    }

    const X2 = Math.pow((a._x * b._w) - (b._x * a._w), 2);
    const Y2 = Math.pow((a._y * b._w) - (b._y * a._w), 2);
    return Math.sqrt(X2 + Y2) / (a._w * b._w);
  }

  static distanceSquaredBetween(a, b) {
    // Simple: return a.subtract(b, this.tmp).magnitudeSquared();
    if ( a._w === b._w ) {
      const A = Math.pow(a._x - b._x, 2) + Math.pow(a._y - b._y, 2);
      return A / Math.pow(a._w, 2);
    }

    const X2 = Math.pow((a._x * b._w) - (b._x * a._w), 2);
    const Y2 = Math.pow((a._y * b._w) - (b._y * a._w), 2);
    return (X2 + Y2) / Math.pow(a._w * b._w, 2);
  }
}

/* Testing



*/


