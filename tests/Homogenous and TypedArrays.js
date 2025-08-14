

// Typed array for Point3d with pool
 class Pool {

  initialSize = 100;

  #pool = new Set();

  cl;

  /**
   * @param {class} cl     Class that has a buildNObjects static method that takes a number
   *                       and returns an array with that many new objects
   */
  constructor(cl) {
    this.cl = cl;
  }

  increasePool(n = this.initialSize) {
    const objs = this.cl.buildNObjects(n);
    for ( let i = 0; i < n; i += 1 ) this.#pool.add(objs[i]);
  }

  /**
   * Get an object from the pool.
   */
  acquire() {
    // If empty, add objects to the pool.
    if ( !this.#pool.size ) this.increasePool();

    // Retrieve an object from the pool and remove it from the pool.
    const obj = this.#pool.first();
    this.#pool.delete(obj);
    return obj;
  }

  /**
   * Release an object back to the pool.
   * @param {obj} object        Object to return.
   */
  release(obj) {
    // Basic test that the object belongs.
    const cl = this.cl;
    const isValid = cl.classTypes ? obj.matchesClass(cl) : obj instanceof cl;
    if ( !isValid) {
      console.warn("Pool object does not match other instance in the pool.", { cl, obj });
      return;
    }
    this.#pool.add(obj);
  }

  /**
   * Return object to the pool without checking its class.
   * @param {obj} object        Object to return.
   */
  _release(obj) { this.#pool.add(obj); }
}


class Point2dTyped {

  arr;

  static DIMS = 2;

  get x() { return this.arr[0]; }

  get y() { return this.arr[1]; }

  constructor(arr) {
    this.arr = arr ?? new Float32Array(this.constructor.DIMS);
  }

  toString() {
    let str = "";
    const d = this.constructor.DIMS + 1;
    for ( let i = 0; i < d; i += 1 ) str += `${this.arr[i]}`;
    return `{${str}}`;
  }

  static #pool = new Pool(this);

  static _releaseObj(obj) { this.#pool._release(obj); }

  static release(...args) { args.forEach(arg => this.#pool.release(arg)); }

  // No need to clear the object, as no cache used.
  // Don't need to check the class on release, because this is an instantiated object tied to the pool.
  release() { this.constructor._releaseObj(this); }

  static get tmp() { return this.#pool.acquire(); }

  static from(x, y) {
    const out = this.tmp;
    out.arr[0] = x;
    out.arr[1] = y;
    return out;
  }

  static buildNObjects(n = 1) {
    if ( n === 1 ) return [new this()];
    const len = this.DIMS;
    const buffer = new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT * len);
    const out = Array(n);
    for ( let i = 0; i < n; i += 1 ) {
      out[i] = new this(new Float32Array(buffer, i * Float32Array.BYTES_PER_ELEMENT * len, len));
    }
    return out;
  }

  set(x, y) { this.arr[0] = x; this.arr[1] = y; return this; }

  add(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    const o = outPoint.arr;
    const b = other.arr;
    o.set(this.arr);
    for ( let i = 0; i < this.constructor.DIMS; i += 1) o[i] += b[i];
    return outPoint;
  }

  subtract(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    const o = outPoint.arr;
    const b = other.arr;
    o.set(this.arr);
    for ( let i = 0; i < this.constructor.DIMS; i += 1) o[i] -= b[i];
    return outPoint;
  }

  multiply(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    const o = outPoint.arr;
    const b = other.arr;
    o.set(this.arr);
    for ( let i = 0; i < this.constructor.DIMS; i += 1) o[i] *= b[i];
    return outPoint;
  }

  divide(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    const o = outPoint.arr;
    const b = other.arr;
    o.set(this.arr);
    for ( let i = 0; i < this.constructor.DIMS; i += 1) o[i] /= b[i];
    return outPoint;
  }

  multiplyScalar(scalar, outPoint) {
    outPoint ??= this.constructor.tmp;
    const o = outPoint.arr;
    o.set(this.arr);
    for ( let i = 0; i < this.constructor.DIMS; i += 1) o[i] *= scalar;
    return outPoint;
  }

  /**
   * Magnitude (length, or sometimes distance) of this point.
   * Square root of the sum of squares of each component.
   * @returns {number}
   */
  magnitude() {
    // Same as Math.sqrt(this.x * this.x + this.y * this.y)
    return Math.hypot(...this.arr); // Maybe a bit faster.
  }

  normalize(outPoint) {
    return this.multiplyScalar(1 / this.magnitude(), outPoint);
  }

  dot(other) {
    // Sum of the products of the components
    const a = this.arr;
    const b = other.arr;
    let out = 0;
    for ( let i = 0; i < this.constructor.DIMS; i += 1 ) out += (a[i] * b[i]);
    return out;
  }
}


class Point3dTyped extends Point2dTyped {

  get z() { return this.arr[2]; }

  constructor(arr) {
    arr ??= new Float32Array(3);
    super(arr);
  }

  static #pool = new Pool(this);

  static _releaseObj(obj) { this.#pool._release(obj); }

  static release(...args) { args.forEach(arg => this.#pool.release(arg)); }

  static get tmp() { return this.#pool.acquire(); }

  static from(x, y, z = 0) {
    const out = super.from(x, y);
    out.arr[2] = z;
    return out;
  }

  set(x, y, z = 0) { super.set(x, y); this.arr[2] = z; return this; }

  cross(other, outPoint) {
    outPoint ??= this.constructor.tmp;

    // x = a1b2 - a2b1
    // y = a2b0 - a0b2
    // z = a0b1 - a1b0
    // Avoid overwriting other incase it is outPoint.
    const x = cross2d(this, other, 1, 2);
    const y = cross2d(this, other, 2, 0);
    const z = cross2d(this, other, 0, 1);
    outPoint.arr[0] = x;
    outPoint.arr[1] = y;
    outPoint.arr[2] = z;
    return outPoint;
  }
}

/**
 * Representation of a homogenous 2d point or vector: {x, y, w}
 * In cartesian coordinates, { x/w, y/w }
 * The dual of a homogenous point is a homogenous 2d line.
 * If w = 0, the point lies toward infinity or alternatively is a vector.
 *
 * This class lightly enforces vector vs point classifications and math rules.
 * See https://math.colorado.edu/~nita/VectorsMatrices.pdf
 *
 * Throughout, "cartesian addition/subtraction/etc." refers to treating the points as
 * non-homogenous. So the points are divided by w such that w = 1 and then the math operation
 * is performed. For performance, this is done by avoiding division wherever possible.
 */
class HPoint2d {

  static DIMS = 2; // Also represents the w index.

  arr;

  get x() {
    const w = this.w;
    return w ? this.arr[0] / w : this.arr[0]; // Handle vectors differently.
  }

 get y() {
    const w = this.w;
    return w ? this.arr[1] / w : this.arr[1]; // Handle vectors differently.
  }

  get w() { return this.arr[this.constructor.DIMS]; }


  set x(value) {
    // Account for w.
    const w = this.w;
    if ( w ) this.arr[0] = value * w;
    else this.arr[0] = value;
  }

  set y(value) {
    // Account for w.
    const w = this.w;
    if ( w ) this.arr[1] = value * w;
    else this.arr[1] = value;
  }

  set w(value) { this.arr[this.constructor.DIMS] = value; }

  get isVector() { return !this.arr[this.constructor.DIMS]; }

  constructor(arr) {
    if ( !arr ) {
      arr = new Float32Array(this.constructor.DIMS + 1);
      arr[this.constructor.DIMS] = 1;
    }
    this.arr = arr;
  }

  toString() {
    let str = [];
    const d = this.constructor.DIMS + 1;
    for ( let i = 0; i < d; i += 1 ) str.push(`${this.arr[i]}`);
    return str.join(", ");
  }

  /**
   * Iterator: x then y.
   */
  [Symbol.iterator]() {
    const keys = ["x", "y"];
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


  static get tmp() { return this.#pool.acquire(); }

  static #pool = new Pool(this);

  release() { this.constructor._releaseObj(this); }

  static _releaseObj(obj) { this.#pool._release(obj); }

  static release(...args) { args.forEach(arg => this.#pool.release(arg)); }

  static createPoint(x, y, w = 1) { return this._from(x, y, w); }

  static createVector(x, y, w = 0) { return this._from(x, y, w); }

  static _from(x, y, w = 1) {
    const out = this.tmp;
    out.arr[0] = x;
    out.arr[1] = y;
    out.arr[2] = w;
    return out;
  }

  static buildNObjects(n = 1) {
    if ( n === 1 ) return [new this()];
    const len = this.DIMS + 1;
    const buffer = new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT * len);
    const out = Array(n);
    for ( let i = 0; i < n; i += 1 ) {
      out[i] = new this(new Float32Array(buffer, i * Float32Array.BYTES_PER_ELEMENT * len, len));
    }
    return out;
  }


  /**
   * Given a point, return a vector from the origin to that point.
   * If already a vector, will copy to outPoint.
   * Essentially subtracts the origin (0, 0, 1) from this point.
   * @param {HPoint2d} outPoint
   * @returns {HPoint2d} The outPoint, as a vector
   */
  vectorize(outPoint) {
    outPoint ??= this.constructor.tmp;
    outPoint.arr.set(this.arr);
    const w = outPoint.w;
    if ( !w ) return outPoint;
    if ( w === 1 ) {
      outPoint.w = 0;
      return outPoint;
    }
    const wIdx = this.constructor.DIMS;
    for ( let i = 0; i < wIdx; i += 1 ) outPoint.arr[i] /= w; // Divide out w to get 1.
    outPoint.arr[wIdx] = 0;
    return outPoint;
  }

  set(x, y, w = 1) {
    this.arr[0] = x;
    this.arr[1] = y;
    this.arr[2] = w;
    return this;
  }


  /**
   * Point representing a directional vector. I.e., vector that moves the point toward infinity
   * from point of view of the origin.
   * @param {number} angleX       Angle (in radians) between the directional vector and the x-axis
   * @param {number} angleX       Angle (in radians) between the directional vector and the x-axis
   * @param {number} angleX       Angle (in radians) between the directional vector and the x-axis
   * @returns {HPoint2d}
   */
  static fromAngles(angleX, angleY) { return this.tmp.set(Math.cos(angleX), Math.cos(angleY), 0); }

  /**
   * Does this point equal another (up to scaling in w)
   * @param {other}
   * @returns {boolean}
   */
  equals(other) {
    // Could do this by comparing x and y.
    // To avoid the division, note that a common denominator can be used.
    // e.g., {1, 1, 2} == {2, 2, 4} == {4, 4, 8} == {4, 4, 8}
    const wIdx = this.constructor.DIMS;
    const tArr = this.arr;
    const oArr = other.arr;
    const tW = tArr[wIdx];
    const oW = oArr[wIdx];
    for ( let i = 0; i < wIdx; i += 1 ) {
      if ( (tArr[i] * oW) === (oArr[i] * tW) ) return false;
    }
    return true;
  }

  almostEquals(other, epsilon = 1e-06) {
    const wIdx = this.constructor.DIMS;
    const tArr = this.arr;
    const oArr = other.arr;
    const tW = tArr[wIdx];
    const oW = oArr[wIdx];
    for ( let i = 0; i < wIdx; i += 1 ) {
      if ( (tArr[i] * oW).almostEqual(oArr[i] * tW, epsilon) ) return false;
    }
    return true;
  }

  // ----- NOTE: Component-wise math ----- //

  #processByComponent(b, outPoint, fn) {
    outPoint ??= this.constructor.tmp;
    const a = this.arr;
    const o = outPoint.arr;
    const wIdx = this.constructor.DIMS;
    for ( let i = 0, iMax = wIdx + 1; i < iMax; i += 1 ) o[i] = fn(a, b, i);
    return outPoint;
  }

  static _addComponentsFn(a, b, i) { return a[i] + b[i]; }

  static _subtractComponentsFn(a, b, i) { return a[i] - b[i]; }

  static _multiplyComponentsFn(a, b, i) { return a[i] * b[i]; }

  static _divideComponentsFn(a, b, i) { return a[i] / b[i]; }

  _componentAdd(other, outPoint) { return this.#processByComponent(other.arr, outPoint, this.constructor._addComponentsFn); }

  _componentSubtract(other, outPoint) { return this.#processByComponent(other.arr, outPoint, this.constructor._subtractComponentsFn); }

  _componentMultiply(other, outPoint) { return this.#processByComponent(other.arr, outPoint, this.constructor._multiplyComponentsFn); }

  _componentDivide(other, outPoint) { return this.#processByComponent(other.arr, outPoint, this.constructor._divideComponentsFn); }

  _componentMultiplyScalar(scalar, outPoint) {
    // Pull out this.#processByComponent for speed, b/c this is used in subtract.
    outPoint ??= this.constructor.tmp;
    const o = outPoint.arr;
    o.set(this.arr);
    const wIdx = this.constructor.DIMS;
    for ( let i = 0, iMax = wIdx + 1; i < iMax; i += 1 ) o[i] *= scalar;
    return outPoint;
  }

  // ----- NOTE: Cartesian math ----- //

  #processCartesian(b, outPoint, fn, wFn) {
    outPoint ??= this.constructor.tmp;
    const a = this.arr;
    const o = outPoint.arr;
    const wIdx = this.constructor.DIMS;
    const aw = a[wIdx];
    const bw = b[wIdx];
    for ( let i = 0; i < wIdx; i += 1 ) o[i] = fn(a, b, aw, bw, i);
    o[wIdx] = wFn(aw, bw);
    return outPoint;
  }

  /* Cartesian addition:
    x0/w0 + x1/w1 = x2/w2
    (x0*w1 + x1*w0) / w0*w1 = x2/w2
    x2 = x0*w1 + x1*w0
    w2 = w0*w1
  */
  static _addCartesianFn(a, b, aw, bw, i) { return a[i] * bw + b[i] * aw; }

  static _addCartesianWFn(aw, bw) { return aw * bw; }

  static _subtractCartesianFn(a, b, aw, bw, i) { return a[i] * bw - b[i] * aw; }

  /* Cartesian multiply is just component multiply:
    x0/w0 * x1/w1 = x2/w2
    x2 = x0*x1
    w2 = w0*w1
  */

  /* Cartesian divide is hard:
    x0/w0 / x1/w1 = x2/w2
    (multiply by w0w1): x0*w1 / x1*w0 = x2/w2
    x0*w1 = (x2 * x1 * w0)/w2
    x0*w1*w2 = x2 * x1 * w0

     x0*w1 / x1*w0,  y0*w1 / y1*w0,  z0*w1 / z1*w0

     Instead, invert the value and multiply.
     Invert: 1 / pt
     1 / x0/w0 = x/w
     1 / x0 =
     So to invert, multiply w by x * y * z and set x,y,z to 1.
  */

  _cartesianAdd(other, outPoint) { return this.#processCartesian(other.arr, outPoint, this.constructor._addCartesianFn, this.constructor._addCartesianWFn); }

  _cartesianSubtract(other, outPoint) { return this.#processCartesian(other.arr, outPoint, this.constructor._subtractCartesianFn, this.constructor._addCartesianWFn); }

  _cartesianMultiply(other, outPoint) { return this._componentMultiply(other, outPoint); }

  _cartesianInvert(outPoint) {
    outPoint ??= this.constructor.tmp;
    const o = outPoint.arr;
    const a = this.arr;
    o.fill(1);
    const wIdx = this.constructor.DIMS;
    o[wIdx] = a[wIdx];
    for ( let i = 0; i < wIdx; i += 1 ) o[wIdx] *= a[i];
    return outPoint;
  }

  _cartesianDivide(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    this._cartesianInvert(outPoint);
    outPoint._cartesianMultiply(outPoint);
  }

  /**
   * Treat as non-homogenous {x/w, y/w} and take dot product: a.x * b.x + a.y * b.y + ...
   * Only well-defined for vectors.
   * Falls back on component-wise dot product for points.
   * @param {HPoint2d} other
   * @returns {number}
   */
  _cartesianDot(other) {
    // x0/w0 * x1/w1 + y0/w0 * y1/w1 = (x0x1 + y0y1) / w0w1
    // For magnitude, this would be:
    // sqrt(x * x + y * y)
    // x0/w0 * x0/w0 + y0/w0 * y0/w0 = num
    // (x0 * x0 + y0 * y0) / w0
    const a = this.arr;
    const b = other.arr;
    let out = 0;
    const wIdx = this.constructor.DIMS;
    for ( let i = 0; i < wIdx; i += 1 ) out += (a[i] * b[i]);
    return out / (a[wIdx] * b[wIdx]);
  }

  _cartesianMagnitude() { return Math.sqrt(this._cartesianMagnitudeSquared()); }

  _cartesianMagnitudeSquared() { return this._cartesianDot(this); }

  _cartesianNormalize(outPoint) { return this.multiplyScalar(1 / this._cartesianMagnitude(), outPoint); }

  // ----- NOTE: Primary math functions ----- //

  /**
   * Add a point and a vector.
   * If both are points, cartesian addition will be used.
   * @param {HPoint2d} other      Vector or if this is a vector, a point
   * @param {HPoint2d} [outPoint]   A point to use to store the result
   * @returns {HPoint2d} The outPoint
   */
//   add(other, outPoint) {
//     if ( !(this.isVector || other.isVector) ) {
//       console.warn("Using cartesian addition for two points", { a: this, b: other });
//       return this._cartesianAdd(other, outPoint);
//     }
//     return this._componentAdd(other, outPoint);
//   }

  add(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    const a = this.arr;
    const b = other.arr;
    const o = outPoint.arr;
    const iMax = this.constructor.DIMS + 1;
    for ( let i = 0; i < iMax; i += 1 ) o[i] = a[i] + b[i];
    return outPoint;
  }

  subtract(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    const aPoint = this.constructor.tmp;
    const bPoint = this.constructor.tmp;
    const a = aPoint.arr;
    const b = bPoint.arr;
    a.set(this.arr);
    b.set(other.arr);
    const aw = this.w;
    const bw = other.w;
    if ( aw && bw && aw !== bw ) {
      // Subtract two points to get a vector
      // We need the two points to have same w so a vector is returned.
      // Use GCD. Don't scale in place b/c repeated uses can result in infinities.
      this._componentMultiplyScalar(bw, aPoint);
      other._componentMultiplyScalar(aw, bPoint);
    }
    const o = outPoint.arr;
    const iMax = this.constructor.DIMS + 1;
    for ( let i = 0; i < iMax; i += 1 ) o[i] = a[i] - b[i];
    aPoint.release();
    bPoint.release();
    return outPoint;
  }

  /**
   * Subtract two points to get a displacement vector, subtract two vectors, or subtract a vector from a point.
   * Unlike addition, two points are allowed.
   * @param {HPoint2d} other      Vector or if this is a vector, a point
   * @param {HPoint2d} [outPoint]   A point to use to store the result
   * @returns {HPoint2d} The outPoint
   */
//   subtract(other, outPoint) {
//     const aw = this.w;
//     const bw = other.w;
//     if ( !(this.isVector || other.isVector) && aw !== bw ) {
//       // Subtract two points to get a vector
//       // We need the two points to have same w so a vector is returned.
//       // Scale in place b/c it does not change the actual values. Effectively uses GCD.
//       this._componentMultiplyScalar(bw);
//       other._componentMultiplyScalar(aw);
//     }
//     return this._componentSubtract(other, outPoint);
//   }

  /**
   * Multiply points or vectors. Not well-defined; will use cartesian (component-wise after dividing by w).
   * You probably want dot or cross.
   * @param {HPoint2d} other        Vector or if this is a vector, a point
   * @param {HPoint2d} [outPoint]   A point to use to store the result
   * @returns {HPoint2d} The outPoint
   */
  multiply(other, outPoint) {
    console.warn("Multiplication of points or vectors is not well defined. Falling back on component-wise multiplication.");
    return this._componentMultiply(other, outPoint);
  }

  /**
   * Divide points or vectors. Not well-defined; will use cartesian (component-wise after dividing by w).
   * @param {HPoint2d} other        Vector or if this is a vector, a point
   * @param {HPoint2d} [outPoint]   A point to use to store the result
   * @returns {HPoint2d} The outPoint
   */
  divide(other, outPoint) {
    console.warn("Division of points or vectors is not well defined. Falling back on component-wise division.");
    return this._cartesianDivide(other, outPoint);
  }

  /**
   * Multiply a point or vector by a scalar.
   * Essentially translates a point or scales the length of the vector.
   * @param {number} scalar
   * @param {HPoint2d} [outPoint]   A point to use to store the result
   * @returns {HPoint2d} The outPoint
   */
  multiplyScalar(scalar, outPoint) {
    // Instead of modifying the w, multiply through the x, y to avoid division of the scalar.
    // Also works properly with vectors.
    outPoint ??= this.constructor.tmp;
    const o = outPoint.arr;
    o.set(this.arr);
    for ( let i = 0; i < this.constructor.DIMS; i += 1 ) o[i] *= scalar;
    return outPoint;
  }

  /**
   * Divide a point or vector by a scalar. This is equivalent to this.multiplyScalar(1/scalar) but more efficient.
   * For vectors, multiplyScalar(1/scalar) will be used because w = 0 otherwise would negate the scalar.
   * Essentially translates a point or scales the length of the vector.
   * @param {number} scalar
   * @param {HPoint2d} [outPoint]   A point to use to store the result
   * @returns {HPoint2d} The outPoint
   */
  divideScalar(scalar, outPoint) {
    if ( this.isVector ) return this.multiplyScalar(1/scalar, outPoint)
    outPoint ??= this.constructor.tmp;
    outPoint.arr.set(this.arr);
    outPoint.arr[this.constructor.DIMS] *= scalar;
    return outPoint;
  }

  /**
   * Dot product of two vectors: a.x * b.x + a.y * b.y + ...
   * Only well-defined for vectors, but accepts any (useful for testing Planes, etc.)
   * Use _cartesianDot if you want the dot of non-homogenous points.
   * @param {HPoint2d} other
   * @returns {number}
   */
  dot(other) {
    const a = this.arr;
    const b = other.arr;
    let out = 0;
    for ( let i = 0, iMax = this.constructor.DIMS + 1; i < iMax; i += 1 ) out += (a[i] * b[i]);
    return out;
  }

  /**
   * Magnitude (length, or sometimes distance) of this vector.
   * Defined as the square root of the dot product of this vector with itself.
   * Only well-defined for vectors.
   * Falls back on component-wise dot product for points.
   * @returns {number}
   */
  magnitude() { return Math.sqrt(this.magnitudeSquared()); }

  magnitudeSquared() {
    // For speed, don't just call dot.
    const a = this.arr;
    let out = 0;
    const wIdx = this.constructor.DIMS;
    for ( let i = 0; i < wIdx; i += 1 ) out += (a[i] ** 2);
    return out;
  }

  normalize(outPoint) { return this.multiplyScalar(1 / this.magnitude(), outPoint); }

  /**
   * Cross product, treating w as a coordinate.
   */
  cross(other, outPoint) {
    outPoint ??= this.constructor.tmp;

    // x = a1b2 - a2b1
    // y = a2b0 - a0b2
    // z = a0b1 - a1b0
    // Avoid overwriting other in case it is outPoint.
    // Use 0, 1, 2 here so this works when calling from HPoint3d.
    const x = cross2d(this, other, 1, 2);
    const y = cross2d(this, other, 2, 0);
    const z = cross2d(this, other, 0, 1);
    outPoint.arr[0] = x;
    outPoint.arr[1] = y;
    outPoint.arr[2] = z;
    return outPoint;
  }

  /**
   * Distance between this point and another point.
   * @param {HPoint2d} p
   * @returns {number}
   */
  distanceToPoint(p) { return Math.sqrt(this.distanceSquaredToPoint(p)); }

  distanceSquaredToPoint(p) {
    // (b.x - a.x)^2 + (b.y - a.y)^2
    const delta = p.subtract(this);
    const out = delta.magnitudeSquared();
    delta.release();
    return out;
  }


    // 2d cross product indicates orientation of a vector: ax*by - ay*bx
    // • C > 0: b is "left", CCW
    // • C < 0: b is "right", CW
    // • C = 0: vectors are parallel, antiparallel, or orthogonal
    // If C = 0, dot product distinguishes parallel from anti-parallel: D = ax*bx + ay*by
    // • D > 0: vectors are parallel; point in the same general direction
    // • D < 0: vectors are anti-parallel; point in opposite directions
    // • D = 0: vectors are perpendicular
    // angle between is cos-1(a•b / |a|•|b|) where || is magnitude

  static orientOrig(a, b, c) { return foundry.utils.orient2dFast(a, b, c); }

  static orientDet(a, b, c) {
    const mat = new CONFIG.GeometryLib.MatrixFlat([
      a.x, a.y, 1,
      b.x, b.y, 1,
      c.x, c.y, 1,
    ], 3, 3)

    // Via testing, if aw and bw don't share a sign, the result is reversed.
    return - mat.determinant() * Math.sign(a.w * b.w * c.w)
  }

  /**
   * Orientation of three points.
   * If w is positive, it is the determinant of the 3x3 matrix formed by the points.
   * @param {HPoint2d} a
   * @param {HPoint2d} b
   * @param {HPoint2d} c
   * @returns {number} Positive if ccw; negative if cw.
   */
  static orient(a, b, c) {
    const ac = a._cartesianSubtract(c);
    const bc = b._cartesianSubtract(c);
    // ac.y * bc.x - ac.x * bc.y, where ac = a - c and bc = b - c
    // cross2d(ac, bc, 1, 0) after dividing by w.
    const out = (ac.y * bc.x) - (ac.x * bc.y);
    ac.release();
    bc.release();
    return out;
  }

  static orientV2(a, b, c) {
    // Orient is
    // ac.y * bc.x - ac.x * bc.y, where ac = a - c and bc = b - c
    // (ac.y / ac.w * bc.x / bc.w) - (ac.x/ac.w * bc.y /bc.w) =
    // ((ac.y * bc.x) / (ac.w * bc.w)) - ((ac.x*bc.y) / (ac.w * bc.w))
    // (ac.y * bc.x) - (ac.x * bc.y) / (ac.w * bc.w)

    // a - c: a.x/a.w - c.x/c.w => a.x*c.w - c.x*a.w, w = c.w * a.w

    const deltaAC = a._cartesianSubtract(c);
    const deltaBC = b._cartesianSubtract(c);
    const ac = deltaAC.arr;
    const bc = deltaBC.arr;
    const cw = c.w;
    const out = ((ac[1] * bc[0]) - (ac[0] * bc[1])) / (ac[2] * bc[2])
    deltaAC.release();
    deltaBC.release();
    return out;
  }

  static orientV7(a, b, c) {
    // ac: a - c: a.x*c.w - c.x*a.w, a.y*c.w - c.y*a.w, a.w*c.w
    // bc: b - c: b.x*c.w - c.x*b.w, b.y*c.w - c.y*b.w, b.w*c.w
    // cross2d: ac.y * bc.x - ac.x * bc.y; w = ac.w * bc.w
    // (a.y⋅c.w−c.y⋅a.w)(b.x⋅c.w−c.x⋅b.w)−(a.x⋅c.w−c.x⋅a.w)(b.y⋅c.w−c.y⋅b.w)
    const ac12 = cross2d(a, c, 1, 2);
    const bc02 = cross2d(b, c, 0, 2);
    const ac02 = cross2d(a, c, 0, 2);
    const bc12 = cross2d(b, c, 1, 2);
    return ((ac12 * bc02) - (ac02 * bc12)) / (a.w * b.w * c.w * c.w);
  }

  static orientV3(a,b,c) {
    // a-c: a.x*c.w - c.x*a.w, a.y*c.w - c.y*a.w, a.w*c.w
    // b-c: b.x*c.w - c.x*b.w, b.y*c.w - c.y*b.w, b.w*c.w
    // cross2d: ac.y * bc.x - ac.x * bc.y; w = ac.w * bc.w
    // w = (a.w*c.w) * (b.w*c.w)
    // ((a.y*c.w - c.y*a.w) * (b.x*c.w - c.x*b.w)) - ((a.x*c.w - c.x*a.w)*(b.y*c.w - c.y*b.w))

    // Use the determinant of the 3x3 matrix
    // a.x(b.y*c.w - c.y*b.w) - a.y(b.x*c.w - c.x*b.w) + a.w(b.x*c.y - c.x*b.y);
    const cross12 = cross2d(b, c, 1, 2);
    const cross02 = cross2d(b, c, 0, 1);
    const cross01 = cross2d(b, c, 0, 1);

    // Via testing, if aw and bw don't share a sign, the result is reversed.
    return -(a.arr[0]*cross12 - a.arr[1]*cross02 + a.arr[2]*cross01) / (a.w * b.w * c.w);
  }

  static orientV4(a, b, c) {
    // Use determinant directly. Same sign, larger value.
    const mat = new CONFIG.GeometryLib.MatrixFlat([
      ...a.arr,
      ...b.arr,
      ...c.arr,
    ], 3, 3)

    // Via testing, if aw and bw don't share a sign, the result is reversed.
    return - mat.determinant() / (a.w * b.w * c.w);
  }

  static orientV5(a, b, c) {
    const ab = b.subtract(a);
    const bc = c.subtract(b);
    const out = bc.cross(ab).w / (a.w * b.w * c.w);
    ab.release();
    bc.release();
    return out;
  }

  static orientV6(a, b, c) {
    const ab = b.subtract(a);
    const bc = c.subtract(b);
    const out = cross2d(bc, ab, 0, 1) / (a.w * b.w * c.w);
    ab.release();
    bc.release();
    return out;
  }



  /**
   * Angle between this and another vector.
   * Defined as x•y = |x||y|cos Ø
   * @param {HPoint2d} other
   * @returns {number} Angle in radians
   */
  angleToVector(other) { return Math.acos(this.dot(other) / (this.magnitude() * other.magnitude())); }

  /**
   * Scalar triple, defined as a • (b x c)
   * Also: a • (b x c) = (a x b) • c = b • (c x a) = c • (a x b) = (a x b) • c
   * See https://en.m.wikipedia.org/wiki/Triple_product#Scalar_triple_product
   * @param {HPoint2d} b              Vector
   * @param {HPoint2d} c              Vector
   * @returns {number}
   */
  scalarTriple(b, c) {
    const bc = this.constructor.tmp;
    b.cross(c, bc);
    const out = this.a.dot(bc);
    bc.release();
    return out;
  }

  /**
   * Vector triple: a x (b x c) = (a•c)b - (a•b)c
   * @param {HPoint2d} b              Vector
   * @param {HPoint2d} c              Vector
   * @param {HPoint2d} [outPoint]
   * @returns {HPoint2d} The out point
   */
  vectorTriple(b, c, outPoint) {
    outPoint ??= this.constructor.tmp;
    const ab = this.dot(b);
    const ac = this.dot(c);
    const tmp = this.constructor.tmp;
    b.multiplyScalar(ac, tmp);
    tmp.subtract(c.multiplyScalar(ab, outPoint), outPoint);
    tmp.release();
    return outPoint;
  }
}

/**
 * A homogenous 2d line, represented by three coordinates.
 *   ax + by + c = 0 ==> {a, b, c}
 * Or in Hessian normal form:
 *   x*cosø + y*sinø - d = 0 ==> ±sqrt(a^2 + b^2) * [cosø, sinø, -d]
 *
 * lh = [a,b]T is the homogenous part of the line.
 * l0 = c is the inhomogenous (Euclidean) part.
 * lh is the normal of the line proportional to n
 * l0 is proportional to the distance d of the line from the origin with opposite sign, sign(l0) = -sign(d)
 * Line at infinity is {0, 0, 1}, where lh = 0.
 */
class HLine2d extends HPoint2d {

  static #pool = new Pool(this);

  static _releaseObj(obj) { this.#pool._release(obj); }

  static release(...args) { args.forEach(arg => this.#pool.release(arg)); }

  static get tmp() { return this.#pool.acquire(); }

  /**
   * Construct line from 2 homogenous points.
   * @param {HPoint2d} a
   * @param {HPoint2d} b
   * @returns {HLine2d}
   */
  static fromPoints(a, b) {
    const out = this.construtor.tmp;
    return b.cross(a, out);
  }

  /**
   * Construct a line from a normal and distance to the origin.
   * @param {HLine2d} normal
   * @param {number} distanceToOrigin
   * @returns {HLine2d}
   */
  static fromNormal(n, d = 0) {
    return this.constructor.tmp.set(n.arr[0], n.arr[1], d * n.arr[2]);
  }

  get normal() {
    return this.constructor.tmp.set(this.arr[0], this.arr[1], 1);
  }

  get normalDirection() {
    return Math.atan(this.arr[0]/ this.arr[1]);
  }

  // Aliases
  get a() { return this.arr[0]; }

  get b() { return this.arr[1]; }

  get c() { return this.arr[2]; }

  /**
   * Is a point on this line?
   * @param {HPoint2d} pt
   * @returns {boolean}
   */
  isPointOnLine(pt) { return this.dot(pt) === 0; }

  isPointNearlyOnLine(pt, epsilon = 1e-06) { return this.dot(pt).almostEqual(0, epsilon); }

  /**
   * What is the closest distance to a point from this line?
   * @param {HPoint2d} pt
   * @returns {number}
   */
  distanceToPoint(pt) {
    // numerator: |l•p|
    // denominator: sqrt(l.x^2 + l.y^2)
    const numerator = Math.abs(this.dot(pt));
    const denominator = Math.sqrt(this.arr[0] ** 2 + this.arr[1] ** 2);
    return numerator / denominator;
  }

  distanceSquaredToPoint(pt) {
    // numerator: |l•p| * |l•p|
    // denominator: l.x^2 + l.y^2
    const d = Math.abs(this.dot(pt));
    const denominator = (this.arr[0] ** 2) + (this.arr[1] ** 2);
    return (d * d) / denominator;
  }

  /**
   * What is the closest point on this line to a point?
   * @param {HPoint2d} pt
   * @returns {HPoint2d}
   */
  closestPointOnLine(pt, outPoint) {
    // Normal vector to this line is its first two components: (a, b)
    // Perpendicular line is (-b, a, d)

    // Using equation of a line (-bx + ay + d = 0), substitute in the point's cartesian x,y
    // Find d: -b(x/w) + a(y/w) + d = 0
    //      d = b(x/w) + a(y/w)
    //      d = (bx + ay) / w
    // Same as multiplying b and a by w.
    const a = this.arr[0];
    const b = this.arr[1];
    const x = pt.arr[0];
    const y = pt.arr[1];
    const w = pt.arr[2];
    const d = (b * x) + (a * y);
    const perp = this.constructor.tmp.set(-b * w, a * w, d);
    const out = this.cross(perp, outPoint);
    perp.release();
    return out;
  }

  /**
   * Intersection of this line with another in 2d space.
   * @param {HPoint2d} other
   * @param {HPoint2d} [outPoint]
   * @returns {HPoint2d}
   */
  intersection(other, outPoint) { return other.cross(this, outPoint); }

  /**
   * For a line defined as b.cross(a), where a --> b are two points,
   * return the value equivalent to orient2d(a, b, pt).
   * @param {HPoint2d} pt
   * @returns {number} Positive if ccw; negative if cw.
   */
  orient(pt) { return this.dot(pt); }

}

/**
 * Represents a 3d homogenous point using 4 coordinates: { x, y, z, w}
 * If w = 0, the point is at infinity (or direction moving point toward infinity).
 *   - I.e., infinitely remote stars on the celestial sphere.
 */
class HPoint3d extends HPoint2d {

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

  static DIMS = 3;

  get z() {
    const w = this.arr[this.constructor.DIMS];
    return w ? this.arr[2] / w : this.arr[2]; // Handle vectors differently.
  }

  set z(value) {
    // Account for w.
    const w = this.w;
    if ( w ) this.arr[2] = value * w;
    else this.arr[2] = value;
  }

  static #pool = new Pool(this);

  static _releaseObj(obj) { this.#pool._release(obj); }

  static release(...args) { args.forEach(arg => this.#pool.release(arg)); }

  static get tmp() { return this.#pool.acquire(); }

  static _from(x, y, z = 0, w = 1) {
    const out = this.tmp;
    out.arr[0] = x;
    out.arr[1] = y;
    out.arr[2] = z;
    out.arr[3] = w;
    return out;
  }

  set(x, y, z = 0, w = 1) {
    this.arr[0] = x;
    this.arr[1] = y;
    this.arr[2] = z;
    this.arr[3] = w;
    return this;
  }

  static createPoint(x, y, z, w = 1) { return this._from(x, y, z, w); }

  static createVector(x, y, z, w = 0) { return this._from(x, y, z, w); }

  /**
   * Point representing a directional vector. I.e., vector that moves the point toward infinity
   * from point of view of the origin.
   * @param {number} angleX       Angle (in radians) between the directional vector and the x-axis
   * @param {number} angleX       Angle (in radians) between the directional vector and the x-axis
   * @param {number} angleX       Angle (in radians) between the directional vector and the x-axis
   * @returns {HPoint2d}
   */
  static fromDirection(angleX, angleY, angleZ) {
    return this.tmp.set(Math.cos(angleX), Math.cos(angleY), Math.cos(angleZ), 0);
  }

  static from3Planes(plane1, plane2, plane3, outPoint) {
    // Use fact that planes are dual to points and use the same plane equation.
    // See https://faculty.sites.iastate.edu/jia/files/inline-files/homogeneous-coords.pdf.
    outPoint ??= this.tmp;
    return HPlane.from3Points(plane1, plane2, plane3, outPoint);
  }

  static from3PlanesV2(plane1, plane2, plane3, outPoint) {
    outPoint ??= this.tmp;
    return HPlane.from3PointsV2(plane1, plane2, plane3, outPoint);
  }

  /**
   * Cartesian cross product.
   * @param {HPoint3d} other
   * @returns {HPoint3d}
   */
  cross(other, outPoint) {
    outPoint ??= this.constructor.tmp;

    // a = this; b = other
    // x = a.y * b.z - a.z * b.y
    //   = (a.y / a.w) * (b.z * b.w) - (a.z / a.w) * (b.y / b.w)
    //   = (a.y * b.z - a.z * b.y) / (a.w * b.w)
    // Same for y, z
    // y = a.z * b.x - a.x * b.z
    // z = a.x * b.y - a.y * b.x
    // w = a.w * b.w
    // Use the 3d cross and then fill in w.
    // If either are directional vectors, this will be directional.
    super.cross(other, outPoint);
    const w = this.arr[3] * other.arr[3];
    outPoint.arr[3] = w;

    /* Could make this a direction vector...
    for ( let i = 0; i < 3; i += 1 ) outPoint[i] /= w;
    outPoint[3] = 0;
    */
    return outPoint;
  }

  /**
   * Cross product of 4d vectors a x b x c, where a is this vector.
   * @param {HPoint3d} b
   * @param {HPoint3d} c
   * @returns {HPoint3d}
   */
  cross4d(b, c, outPoint) {
    // Solve the 3x3 determinants of a 4x4 matrix.
    // [ a   b   c   d  ]
    // [ a.x a.y a.z a.w ]
    // [ b.x b.y b.z b.w ]
    // [ c.x c.y c.z c.w ]
    // See https://faculty.sites.iastate.edu/jia/files/inline-files/homogeneous-coords.pdf
    // But it swaps b and d negatives.
    const MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32;
    const a = this.arr;
    b = b.arr;
    c = c.arr;
    const aMat = MatrixFloat32.empty(3, 3);
    aMat.arr.set(a.subarray(1));
    aMat.arr.set(b.subarray(1), 3);
    aMat.arr.set(c.subarray(1), 6);

    const bMat = new MatrixFloat32([
      a[0], a[2], a[3],
      b[0], b[2], b[3],
      c[0], c[2], c[3],
    ], 3, 3);

    const cMat = new MatrixFloat32([
      a[0], a[1], a[3],
      b[0], b[1], b[3],
      c[0], c[1], c[3],
    ], 3, 3);

    const dMat = MatrixFloat32.empty(3, 3);
    dMat.arr.set(a.subarray(0, 3));
    dMat.arr.set(b.subarray(0, 3), 3);
    dMat.arr.set(c.subarray(0, 3), 6);

    const aDet = aMat.determinant();
    const bDet = bMat.determinant();
    const cDet = cMat.determinant();
    const dDet = dMat.determinant();

    outPoint ??= this.constructor.tmp;
    return outPoint.set(aDet, bDet, cDet, dDet);
  }
}

/**
 * Represent a plane in 3d, using 4 coordinates. {x, y, z, w} or {a, b, c, d}
 * Represented using Normal vector and distance to origin. { n1, n2, n3, -d}
 * Implicit representation: ax + by + cz + d = 0.
 * Or using a normal and distance S to origin, measured in direction of normal:
 *   Xt * N - S = 0, |N| = 1
 * Gives the coordinates {a, b, c, d} = ± sqrt(a^2 + b^2 + c^2) * [Nx Ny Nz -S]t
 *  (where t means transposed)
 * Thus, up to an arbitrary factor sqrt(a^2 + b^2 + c^2), the plane Normal is the first three components.
 * Ah is the homogenous part (non-normalized vector of the plane)
 * A0 is proportional to distance of the pla
 * Normal vector is [cos øx, cos øy, cos øz] = Ah / |Ah|
 */
class HPlane extends HPoint3d {

  static #pool = new Pool(this);

  static _releaseObj(obj) { this.#pool._release(obj); }

  static release(...args) { args.forEach(arg => this.#pool.release(arg)); }

  release() {
    this.#normalized = false;
    this.constructor._releaseObj(this);
  }

  static get tmp() { return this.#pool.acquire(); }


  // Aliases
  get a() { return this.arr[0]; }

  get b() { return this.arr[1]; }

  get c() { return this.arr[2]; }

  get d() { return this.arr[3]; }

  /**
   * Normal is the first three coordinates. But to normalize, must account for sign of w.
   * Returned as a separate HPoint3d vector.
   */
  #normalized = false;

  get normal() {
    if ( !this.#normalized ) this.normalize();
    const out = HPoint3d.tmp;
    out.arr.set(this.arr.subarray(0, 3));
    return out;
  }



  /**
   * Normalize the normal vector (first three coordinates), adjusting w accordingly.
   * Done in place b/c it should not change the value.
   */
  normalize() {
    const a = this.arr;
    let mag = 0;
    const wIdx = this.constructor.DIMS;
    for ( let i = 0; i < wIdx; i += 1 ) mag += (a[i] ** 2);
    let scalar = 1/Math.sqrt(mag);
    if ( this.w < 0 ) scalar *= -1;
    this._componentMultiplyScalar(scalar);
    this.#normalized = true;
    return this;
  }

  /**
   * Construct a plane from two nonparallel directions and a reference point on the plane.
   * @param {HPoint3d} dir0       A point at infinity
   * @param {HPoint3d} dir1       Another point at infinity
   * @param {HPoint3d} pt         A point
   * @returns {HPlane}
   */
  static fromVectors(dir0, dir1, pt) {
    // See Photogrammatic Computer Vision § 5.3.2.2.
    // X = X0 + t1D0 + t2D1, where t1 and t2 are the coordinates in the plane.
    // N = Ah = D1 x D2 / |D1 x D2|
    // Distance S to the origin is A0 = Ah * X0
    const c = dir0.cross(dir1);
    const Ah = c.divide(c.normalize()); // TODO: Is this correct?
    const A0 = Ah.dot(pt);
    return this.constructor.set(Ah.x, Ah.y, Ah.z, A0);
  }

  // See https://computergraphics.stackexchange.com/questions/14059/what-to-do-with-the-homogeneous-w-during-vector-operations
  // Re direction vs position vectors.


  /**
   * Construct a plane from three homogenous points.
   * @param {HPoint3d} a
   * @param {HPoint3d} b
   * @param {HPoint3d} c
   * @returns {HPlane}
   */
  static from3Points(a, b, c, outPoint) {
    // https://www.ipb.uni-bonn.de/book-pcv/pdfs/PCV-A-sample-page.pdf
    // Calculate the normal vector of the points.
    const deltaAB = b.subtract(a);
    const deltaAC = c.subtract(a);
    const n = deltaAB.cross(deltaAC).normalize();

    // Calculate d using d = -n • a (or b or c)
    const av = a.vectorize();
    const d = -n.dot(av);
    outPoint ??= this.tmp;
    outPoint.set(n.x, n.y, n.z, d);
    HPoint3d.release(deltaAB, deltaAC, n, av);
    return outPoint;
  }

  static from3PointsV2(a, b, c, outPoint) {
    // https://faculty.sites.iastate.edu/jia/files/inline-files/homogeneous-coords.pdf
    // Use the 4x4 matrix to get the 3x3 determinants for e1, e2, e3, e4
    // Then use the formula e1 - e2 + e3 - e4.
    outPoint ??= this.tmp;
    a.cross4d(b, c, outPoint);
    outPoint.arr[1] *= -1;
    outPoint.arr[3] *= -1;
    return outPoint;
  }

  /**
   * @param {HPoint3d} pt
   * @returns {boolean}
   */
  pointOnPlane(pt) {
    // https://faculty.sites.iastate.edu/jia/files/inline-files/homogeneous-coords.pdf
    return this.dot(pt) === 0;
  }

  /**
   * @param {HPlane} other
   * @returns {HPoint3d} Point as a vector, giving the direction of the line
   */
  planeIntersection(other, outPoint) {
    // Cross product of the two normals is the direction. They need not be normalized.
    outPoint ??= HPoint3d.tmp;
    this.cross(other, outPoint);
    outPoint.w = 0;
    return outPoint;
  }

  /**
   * Given a ray (vector and an origin point), find the intersection with this plane.
   * Treats a line on the plane as not intersecting.
   * @param {HPoint3d} rayOrigin        Origin of the ray
   * @param {HPoint3d} rayDirection     Direction of the ray, as a vector
   * @returns {number|null} The length along the ray where the intersection occurs
   */
  rayIntersection(rayOrigin, rayDirection) {
    // Substitute the line's equation into the plane's equation.
    // π = [A, B, C, D]
    // P = [X, Y, Z, 1], lies on plane if π•P = 0
    // P₀ = [X₀, Y₀, Z₀, 1] is the origin point
    // D = [Dx, Dy, Dz, 0] is the direction vector of the line
    // Given π•P(t) = 0
    // [A, B, C, D]ᵀ * ([X₀, Y₀, Z₀, 1]ᵀ + t * [Dx, Dy, Dz, 0]ᵀ) = 0
    // A(X₀ + tDx) + B(Y₀ + tDy) + C(Z₀ + tDz) + D(1 + t * 0) = 0
    // AX₀ + AtDx + BY₀ + BtDy + CZ₀ + CtDz + D = 0
    // t(ADx + BDy + CDz) = -(AX₀ + BY₀ + CZ₀ + D)
    // t = -(AX₀ + BY₀ + CZ₀ + D) / (ADx + BDy + CDz)
    // If ADx + BDy + CDz ≠ 0: line intersects at single point.
    // ADx + BDy + CDz = 0
    //  • AX₀ + BY₀ + CZ₀ + D = 0: P0 lies on the plane; D is parallel to the plane (line is on the plane)
    //  • AX₀ + BY₀ + CZ₀ + D ≠ 0: Starting point P0 is not on the plane; line is parallel to plane

//     const π = this.arr;
//     const P0 = rayOrigin.arr;
//     const D = rayDirection.arr;
//     const a = π[0];
//     const b = π[1];
//     const c = π[2];
//     const d = π[3];
//     const dx = D[0];
//     const dy = D[1];
//     const dz = D[2];
//     const dw = D[3];
//     const x0 = P0[0];
//     const y0 = P0[1];
//     const z0 = P0[2];
//     const w0 = P0[3];
//     const denom = (a * dx) + (b * dy) + (c * dz); // π • D
//
//     // Treat line on the plane or parallel to the plane as non-intersecting.
//     if ( !denom ) return null;
//     const num = (a * x0) + (b * y0) + (c * z0 ) + (d * w0); // π • P0
//     return -num / denom;

    const denom = this.dot(rayDirection);
    if ( !denom ) return null; // Treat line on the plane or parallel to the plane as non-intersecting.
    const num = this.dot(rayOrigin);
    return -num / denom;
  }
}

/**
 * 3d line represented as 6 Plücker coordinates.
 * Line at infinity described by coordinates (0, m)
 */
class HLine3d {

  /**
   * Direction of the line.
   * @type {HPoint3d}
   */
  direction;

  /**
   * Moment of unit force acting at p in the direction l w/r/t the origin.
   * @type {HPoint3d}
   */
  moment;

  constructor(direction, moment) {
    if ( !direction.isVector ) direction.vectorize(direction);
    if ( !moment.isVector ) moment.vectorize(moment);
    this.direction = direction;
    this.moment = moment;
  }

  static tmp() { return new this(HPoint3d.tmp, HPoint3d.tmp); }

  release() {
    this.direction.release();
    this.moment.release();
  }

  /**
   * Construct a 3d line from two 3d points.
   * @param {HPoint3d} p0
   * @param {HPoint3d} p1
   * @returns {HLine3d}
   */
  static fromPoints(p0, p1) {
    // See https://en.wikipedia.org/wiki/Pl%C3%BCcker_coordinates
    // Formed from the six 2x2 determinants
    // p01 = x0y1 - x1y0
    // p02 = x0y2 - x2y0
    // p03 = x0y3 - x3y0
    // p23 = x2y3 - x3y2
    // p31 = x3y1 - x1y3
    // p12 = x1y2 - x2y1

    const out = this.tmp;
    const arr = out.arr;
    p0 = p0.arr;
    p1 = p1.arr;
    arr[0] = cross2d(p0, p1, 0, 1); // p01 or PxY
    arr[1] = cross2d(p0, p1, 0, 2); // p02 or PxZ
    arr[2] = cross2d(p0, p1, 0, 3); // p03 or PxW

    arr[3] = cross2d(p0, p1, 2, 3); // p23 or PzW
    arr[4] = cross2d(p0, p1, 3, 1); // p31 or PwY <-- Note not PyW
    arr[5] = cross2d(p0, p1, 1, 2); // p12 or PyZ

    return out;
  }


  //

  static fromPlanes(x, y) {
    // See https://en.wikipedia.org/wiki/Pl%C3%BCcker_coordinates
    // Flipped.
    const out = this.tmp;
    const arr = out.arr;
    x = x.arr;
    y = y.arr;
    arr[0] = x[2]*y[3] - x[3]*y[2]; // p23
    arr[1] = x[3]*y[1] - x[1]*y[3]; // p31
    arr[2] = x[1]*y[2] - x[2]*y[1]; // p12

    arr[3] = x[0]*y[1] - x[1]*y[0]; // p01
    arr[4] = x[0]*y[2] - x[2]*y[0]; // p02
    arr[5] = x[0]*y[3] - x[3]*y[0]; // p03
    return out;
  }

  static fromVector(rayOrigin, rayDirection) {
    const tmp = rayOrigin.add(rayDirection);
    const out = this.fromPoints(rayOrigin, tmp);
    tmp.release();
    return out;
  }

  static fromVectorV2(rayOrigin, rayDirection) {
    // https://realtimecollisiondetection.net/blog/?p=13
    // https://www.euclideanspace.com/maths/geometry/elements/line/plucker/index.htm
    // Really should cross vectors, not points, but...
    const U = rayDirection;
    const V = rayOrigin.cross(rayDirection);
    const out = this.tmp();
    const arr = out.arr;
    arr[0] = U[0];
    arr[1] = U[1];
    arr[2] = U[2];
    arr[3] = V.x;
    arr[4] = V.y;
    arr[5] = V.z;
    return out;
  }

  static fromPointsV2(p0, p1) {
    // https://realtimecollisiondetection.net/blog/?p=13
    // https://www.euclideanspace.com/maths/geometry/elements/line/plucker/index.htm
    const dir = p0.subtract(p1);
    const out = this.fromVectorV2(p0, dir);
    dir.release();
    return out;
  }

  /**
   * Is this 3d point on the line?
   * @param {HPoint3d} p
   * @returns {boolean}
   */
  isPointOnLine(p) {
    // See https://faculty.sites.iastate.edu/jia/files/inline-files/plucker-coordinates.pdf
    // Point p lies on line l iff p x l = m
    const l = new HPoint2d(this.direction);
    const m = new HPoint2d(this.moment);
    const pt2d = HPoint2d.tmp.set(p.x, p.y, p.z);
    const out = l.cross(pt2d).equals(m);
    pt2d.release(); // Don't release l or m b/c those refer back to the Plücker array.
    return out;
  }

  isPointNearlyOnLine(p, epsilon) {
    // See https://faculty.sites.iastate.edu/jia/files/inline-files/plucker-coordinates.pdf
    // Point p lies on line l iff p x l = m
    const l = new HPoint2d(this.direction);
    const m = new HPoint2d(this.moment);
    const pt2d = HPoint2d.tmp.set(p.x, p.y, p.z);
    const out = l.cross(pt2d).almostEquals(m, epsilon);
    pt2d.release(); // Don't release l or m b/c those refer back to the Plücker array.
    return out;
  }

  /**
   * Closest distance to another 3d line
   * @param {HLine3d} other
   * @returns {number}
   */
  distanceToLine(other) {
    // See https://faculty.sites.iastate.edu/jia/files/inline-files/plucker-coordinates.pdf

  }

  _rayDeterminant(r) {
    // See https://graphics.stanford.edu/courses/cs348b-05/rayhomo.pdf
    const pxy = this.arr[0];
    const pxz = this.arr[1];
    const pxw = this.arr[2];
    const pzw = this.arr[3];
    const pwy = this.arr[4]; // TODO: Or -this.arr[4]?
    const pyz = this.arr[5];

    const rxy = r.arr[0];
    const rxz = r.arr[1];
    const rxw = r.arr[2];
    const rzw = r.arr[3];
    const rwy = r.arr[4]; // TODO: Or -this.arr[4]?
    const ryz = r.arr[5];

    return (pxy * rzw) + (pxz * rwy) + (pxw * ryz) + (pzw * rxy) + (pwy * rxz) + (pyz * rxw);
  }
}

/**
 * Cross two axes of two points.
 * E.g., p1.x * p2.y - p2.x * p1.y or equally, p1.x * p2.y - p1.y * p2.x
 * @param {HPoint2d|Point} p1
 * @param {HPoint2d|Point} p2
 * @param {number|string} idx1      First axis; string if using object points
 * @param {number|string} idx2      Second axis
 * @returns {number}
 */
function cross2d(p1, p2, idx1, idx2) {
  // e.g, p1.z * p2.w - p2.z * p1.w
  p1 = p1.arr;
  p2 = p2.arr;
  return (p1[idx1] * p2[idx2]) - (p2[idx1] * p1[idx2]);
}

class Triangle3dH {

  a; /** @type {HPoint3d} */

  b; /** @type {HPoint3d} */

  c; /** @type {HPoint3d} */

  edgeAB; /** @type {HPoint3d} */

  edgeAC; /** @type {HPoint3d} */

  constructor(a, b, c) {
    // Store the points and vectors in a single typed array.
    const pts = HPoint3d.buildNObjects(5);
    this.a = pts[0];
    this.b = pts[1];
    this.c = pts[2];
    this.edgeAB = pts[3];
    this.edgeAC = pts[4];

    // Copy the a, b, c points in case the provide points are later modified or released.
    this.a.arr.set(a.arr);
    this.b.arr.set(b.arr);
    this.c.arr.set(c.arr);

    // Store the deltas for use in triangle intersection.
    // Simple calc, so easier to store rather than use getter.
    this.b.subtract(this.a, this.edgeAB);
    this.c.subtract(this.a, this.edgeAC);
  }

  release() {
    this.a.release();
    this.b.release();
    this.c.release();
    this.edgeAB.release();
    this.edgeAC.release();
    if ( this.#plane ) this.#plane.release();
    if ( this.#ixVars ) {
      this.#ixVars.ab.delta.release();
      this.#ixVars.ab.cross.release();
      this.#ixVars.bc.delta.release();
      this.#ixVars.bc.cross.release();
      this.#ixVars.ca.delta.release();
      this.#ixVars.ca.cross.release();
    }
    this.#plane = undefined;
    this.#ixVars = undefined;
    this.a = undefined;
    this.b = undefined;
    this.c = undefined;
    this.edgeAB = undefined;
    this.edgeAC = undefined;
  }



  /** @type {HPlane} */
  #plane;

  get plane() {
    if ( !this.#plane ) this.#plane = HPlane.from3Points(this.a, this.b, this.c);
    return this.#plane;
  }

  // Cache key calculations to determine the ray intersection.
  #ixVars;

  get ixVars() {
    if ( !this.#ixVars ) {
      const { a, b, c } = this;
      const ixVarsFn = (b, c) => {
        const out = {
          delta: b.subtract(c),
          cross: null,
        };
        const bVec = b.vectorize();
        const cVec = c.vectorize();
        out.cross = bVec.cross(cVec);
        bVec.release();
        cVec.release();
        return out;
      };
      this.#ixVars = {
        ab: ixVarsFn(a, b),
        bc: ixVarsFn(b, c),
        ca: ixVarsFn(c, a),
      };
    }
    return this.#ixVars;
  }

    // https://realtimecollisiondetection.net/blog/?p=13
    // ABC is clockwise when viewed in front.
    // Can we test the ray without the translation? Or with it later, so the cross can be stored?
    // triple is a • (b x c)
    // rayDir • ((b - o) x (c - o))
    // cross: p1[idx1] * p2[idx2]) - (p2[idx1] * p1[idx2]
    // cross for x: a.y * b.z - a.z * b.y  (1, 2)
    //       for y: a.z * b.x - a.x * b.z  (2, 0)
    //       for z: a.x * b.y - a.y * b.x  (0, 1)



    /* So
      x:  b.y * c.z - b.z * c.y  (1, 2)
      y:  b.z * c.x - b.x * c.z  (2, 0)
      z:  b.x * c.y - b.y * c.x  (0, 1)

     ((b.y - o.y) * (c.z - o.z)) - ((b.z - o.z) * (c.y - o.y)) = x

     (b.y*c.z - o.y*c.z - b.y*o.z + o.y*o.z) - (b.z*c.y - o.z*c.y -o.y*b.z + o.y*o.z) = x
     b.y*c.z - o.y*c.z - b.y*o.z + o.y*o.z - b.z*c.y + o.z*c.y + o.y*b.z - o.y*o.z
     b.y*c.z - o.y*c.z - b.y*o.z - b.z*c.y + o.z*c.y + o.y*b.z
     b.y*c.z - b.z*c.y + o.y*b.z - o.y*c.z + o.z*c.y - b.y*o.z
     b.y*c.z - b.z*c.y + o.y(b.z- c.z) + o.z(c.y - b.y)
     b.y*c.z - b.z*c.y + o.y(b.z- c.z) - o.z(b.y - c.y)

     so calculate b.y*c.z - b.z*c.y = B x C, b.z - c.z = deltaBC

     x: b.y*c.z - b.z*c.y (cross.x) + o.y(b.z - c.z) - o.z(b.y - c.y) => o.y * delta.z - o.z * delta.y => o x delta
     y: b.z*c.x - b.x*c.z (cross.y) + o.z(b.x - c.x) - o.x(b.z - c.z)
     z: b.x*c.y - b.y*c.x (cross.z) + o.x(b.y - c.y) - o.y(b.x - c.x)
    */


  rayIntersection(rayOrigin, rayDirection) {
    // https://realtimecollisiondetection.net/blog/?p=13
    // ABC is clockwise when viewed in front.
    const oVec = rayOrigin.vectorize();
    if ( this.constructor._cachedScalarTripleFn(this.ixVars.ab, oVec, rayDirection) < 0 ) return null;
    if ( this.constructor._cachedScalarTripleFn(this.ixVars.bc, oVec, rayDirection) < 0 ) return null;
    if ( this.constructor._cachedScalarTripleFn(this.ixVars.ca, oVec, rayDirection) < 0 ) return null;
    return this.plane.rayIntersection(rayOrigin, rayDirection);
  }

  /**
   * Möller-Trumbore intersection algorithm for a triangle.
   */
  rayIntersectionMT(rayOrigin, rayDirection) {
    const { edgeAB, edgeAC } = this; // Edge vectors.

    // Calculate the determinant of the triangle
    const pvec = rayDirection.cross(edgeAC);

    // If the determinant is near zero, ray lies in plane of triangle
    const det = edgeAB.dot(pvec);
    if ( det > -Number.EPSILON && det < Number.EPSILON ) {
      pvec.release();
      return null; // Ray is parallel to the triangle.
    }
    const invDet = 1 / det;

    // Calculate the intersection point using barycentric coordinates
    const tvec = rayOrigin.subtract(this.a);
    const u = invDet * tvec.dot(pvec);
    if ( u < 0 || u > 1 ) {
      pvec.release(); tvec.release();
      return null; // Intersection point is outside of triangle
    }

    const qvec = tvec.cross(edgeAB);
    const v = invDet * rayDirection.dot(qvec);
    if ( v < 0 || (u + v) > 1 ) {
       pvec.release(); tvec.release(); qvec.release();
       return null; // Intersection point is outside of triangle
    }

    // Calculate the distance to the intersection point
    const t = invDet * edgeAC.dot(qvec);
    const out = t > Number.EPSILON ? t : null;
    pvec.release(); tvec.release(); qvec.release();
    return out;
  }

  static _cachedScalarTripleFn(ixVars, oVec, Q) {
    // o = o.vectorize()
    const oCross = HPoint3d.tmp;
    oVec.cross(ixVars.delta, oCross);
    ixVars.cross.add(oCross, oCross);
    const out = Q.dot(oCross);
    oCross.release();
    return out;
  }

}



// Plane - Point duality

// Plane at x = 5
// Plane at y = 10
// Plane at z = 15
// ix of three planes is { 5, 10, 15 }
// line for x/y plane formed at { 5, 10, 0, 0 }
// line for x/z plane formed at { 5, 0, 15, 0 }
// line for y/z plane formed at { 0, 10, 15, 0 }



a1 = HPoint3d.createPoint(5, 0, 0)
b1 = HPoint3d.createPoint(5, 10, 0)
c1 = HPoint3d.createPoint(5, 0, 10)
d1 = HPoint3d.createPoint(5, -10, -10);



a2 = HPoint3d.createPoint(0, 10, 0)
b2 = HPoint3d.createPoint(5, 10, 0)
c2 = HPoint3d.createPoint(0, 10, 10)
d2 = HPoint2d.createPoint(10, 10, 20)

a3 = HPoint3d.createPoint(0, 0, 15)
b3 = HPoint3d.createPoint(5, 0, 15)
c3 = HPoint3d.createPoint(0, 10, 15)
d3 = HPoint3d.createPoint(10, 20, 15)


xPlane1 = HPlane.from3Points(a1, b1, c1)
yPlane1 = HPlane.from3Points(a2, b2, c2)
zPlane1 = HPlane.from3Points(a3, b3, c3)

xPlane2 = HPlane.from3PointsV2(a1, b1, c1)
yPlane2 = HPlane.from3PointsV2(a2, b2, c2)
zPlane2 = HPlane.from3PointsV2(a3, b3, c3)


xPlane1.pointOnPlane(d1) // true
xPlane1.pointOnPlane(d2) // false

xPlane2.pointOnPlane(d1) // true
xPlane2.pointOnPlane(d2) // false

ix = HPoint3d.from3Planes(xPlane1, yPlane1, zPlane1)
ix = HPoint3d.from3Planes(xPlane2, yPlane2, zPlane2)

ix = HPoint3d.from3PlanesV2(xPlane1, yPlane1, zPlane1) // Better in numerical accuracy
ix = HPoint3d.from3PlanesV2(xPlane2, yPlane2, zPlane2) // Less good in numerical accuracy; better if planes normalized first.

ix = HPoint3d.from3PlanesV3(xPlane1, yPlane1, zPlane1)
ix = HPoint3d.from3PlanesV3(xPlane2, yPlane2, zPlane2)

// Example ray intersections with X plane x = 5
rayOrigin = HPoint3d.createPoint(0, 10, 0)
rayDirection = HPoint3d.createVector(2, 0, 0)
t = xPlane1.rayIntersection(rayOrigin, rayDirection);
rayOrigin.add(rayDirection.multiplyScalar(t));  // ix at {5, 10, 0}

// Triangle intersection; triangle on x-plane x = 5
a = HPoint3d.createPoint(5, 0, 0)
b = HPoint3d.createPoint(5, 50, 0)
c = HPoint3d.createPoint(5, 0, 100)

tri = new Triangle3dH(a, b, c);


r2 = HPoint3d.createPoint(20, 10, 0);
tri.rayIntersection(rayOrigin, r2)
tri.rayIntersectionV2(rayOrigin, rayDirection)  // 2.5
tri.rayIntersectionV3(rayOrigin, rayDirection)  // 2.5

// Move to intersect outside the triangle
rayOrigin2 = HPoint3d.createPoint(0, -10, 0)

r3 = HPoint3d.createPoint(20, -10, 0);
tri.rayIntersection(rayOrigin2, r3)
tri.rayIntersectionV2(rayOrigin2, rayDirection) // null
tri.rayIntersectionV3(rayOrigin2, rayDirection) // null


// https://faculty.sites.iastate.edu/jia/files/inline-files/homogeneous-coords.pdf
p1 = HPoint3d.createPoint(5, 4, 2)
p2 = HPoint3d.createPoint(-1, 7, 3)
p3 = HPoint3d.createPoint(2, -2, 9)
plane = HPlane.from3Points(p1, p2, p3)
planeV2 = HPlane.from3PointsV2(p1, p2, p3)

pl1 = HPlane._from(3, 5, 1, -2)
pl2 = HPlane._from(7, 0, -4, 1)
pl3 = HPlane._from(0, 2, 5, 8)
ix = HPoint3d.from3Planes(pl1, pl2, pl3)
ixV2 = HPoint3d.from3PlanesV2(pl1, pl2, pl3)
ixV3 = HPoint3d.from3PlanesV3(pl1, pl2, pl3)

// Directional versus point vectors?

a1 = Point2dTyped.from(2, 4)
b1 = Point2dTyped.from(10, 20)
c1 = a1.add(b1)
d1 = b1.subtract(a1)
e1 = a1.multiply(b1)
f1 = b1.multiply(b1)




a2 = HPoint2d._from(2, 4)
b2 = HPoint2d._from(10, 20)
c2 = a2.add(b2)
d2 = b2.subtract(a2)
e2 = a2.multiply(b2)
f2 = b2.multiply(b2)



a3 = HPoint2d.createVector(2, 4)
b3 = HPoint2d.createVector(10, 20, 0)
c3 = a3.add(b3)
d3 = b3.subtract(a3)
e3 = a3.multiply(b3)
f3 = b3.multiply(b3)

Point3d = CONFIG.GeometryLib.threeD.Point3d
MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32
Draw = CONFIG.GeometryLib.Draw

// Line intersections for x = 1, y = 1
// ax + by + c = 0 => x = 1 => -1x + 0y + 1 = 0
a = HPoint2d.from(-1, 0, 1)
b = HPoint2d.from(0, -1, 1)
a.intersection(b) // 1, 1, 1

// Line intersections for x = 1, x = 2
// x = 1 so x - 1 = 0 or -x + 1 = 0
// x = 2 so x - 2 = 0 or -x + 2 = 0
a = new Point3d(-1, 0, 1)
b = new Point3d(-1, 0, 2)
a.cross(b) // 0, 1, 0

// Construct lines that cross:
a = HPoint2d.from(10, 20)
b = HPoint2d.from(500, 500)
c = HPoint2d.from(400, 20)
d = HPoint2d.from(20, 500)
l0 = a.intersection(b); // Or HPoint2d.from2dHPoints(a, b)
l1 = c.intersection(d); // Or HPoint2d.from2dHPoints(c, d)
ix01 = l0.intersection(l1)

// Parallel line
e = HPoint2d.from(10, 50)
f = HPoint2d.from(500, 530)
l2 = e.intersection(f)
ix02 = l0.intersection(l2) // Has 0 for w

ix12 = l1.intersection(l2)

Draw.point(a)
Draw.point(b)
Draw.point(c)
Draw.point(d)
Draw.segment({ a, b })
Draw.segment({ a: c, b: d})

Draw.point(e)
Draw.point(f)
Draw.segment({ a: e, b: f})

Draw.point(ix01)
Draw.point(ix12)

// Distance between l1 and a
l1.closestDistanceToPoint(a)
l1.closestPointOnLine(a)

// Horizontal and vertical lines
a = HPoint2d.from(0, 0)
b = HPoint2d.from(0, 500)
c = HPoint2d.from(-500, 250)
d = HPoint2d.from(500, 250)
l0 = a.intersection(b); // Or HPoint2d.from2dHPoints(a, b)
l1 = c.intersection(d); // Or HPoint2d.from2dHPoints(c, d)
ix01 = l0.intersection(l1)

PIXI.Point.distanceBetween(a, ix01) // 250
l1.closestDistanceToPoint(a)  // 250
tmp = l1.closestPointOnLine(a) // Should equal ix01

HPoint2d.distanceBetweenPoints(a, ix01)



// Exactly 45º lines
a = HPoint2d.from(0, 0)
b = HPoint2d.from(500, 500)
c = HPoint2d.from(500, 0)
d = HPoint2d.from(0, 500)
l0 = a.intersection(b); // Or HPoint2d.from2dHPoints(a, b)
l1 = c.intersection(d); // Or HPoint2d.from2dHPoints(c, d)
ix01 = l0.intersection(l1)


function benchFn(cl) {
  const outPoint = cl.tmp;
  const pt = cl.tmp;
  const pt2 = cl.tmp;
  pt.set(Math.random(), Math.random(), 1);
  pt2.set(Math.random(), Math.random(), 1);
  pt
    .subtract(pt2, outPoint)
    .multiplyScalar(2, outPoint)
    .add(pt2, outPoint)
//     .multiply(pt2, outPoint)
//     .divide(pt2, outPoint)
  pt.subtract(pt2).normalize(outPoint);
  cl.release(pt, pt2);
  return outPoint
}

Point3d = CONFIG.GeometryLib.threeD.Point3d
benchFn(PIXI.Point)
benchFn(Point3d)
benchFn(Point2dTyped).arr
benchFn(Point3dTyped).arr
benchFn(HPoint2d).arr
benchFn(HPoint3d).arr

QBenchmarkLoopFn = CONFIG.GeometryLib.bench.QBenchmarkLoopFn
N = 10000
await QBenchmarkLoopFn(N, benchFn, "HPoint2d", HPoint2d)
await QBenchmarkLoopFn(N, benchFn, "HPoint3d", HPoint3d)
await QBenchmarkLoopFn(N, benchFn, "PIXI.Point", PIXI.Point)
await QBenchmarkLoopFn(N, benchFn, "Point3d", Point3d)
await QBenchmarkLoopFn(N, benchFn, "Point2dTyped", Point2dTyped)
await QBenchmarkLoopFn(N, benchFn, "Point3dTyped", Point3dTyped)
await QBenchmarkLoopFn(N, benchFn, "HPoint2d", HPoint2d)
await QBenchmarkLoopFn(N, benchFn, "HPoint3d", HPoint3d)

function benchCreationFn(cl) {
  const tmp = cl.tmp;
  tmp.set(Math.random(), Math.random());
  return tmp
}
N = 10000
await QBenchmarkLoopFn(N, benchCreationFn, "HPoint2d", HPoint2d)
await QBenchmarkLoopFn(N, benchCreationFn, "HPoint3d", HPoint3d)
await QBenchmarkLoopFn(N, benchCreationFn, "PIXI.Point", PIXI.Point)
await QBenchmarkLoopFn(N, benchCreationFn, "Point3d", Point3d)
await QBenchmarkLoopFn(N, benchCreationFn, "Point2dTyped", Point2dTyped)
await QBenchmarkLoopFn(N, benchCreationFn, "Point3dTyped", Point3dTyped)
await QBenchmarkLoopFn(N, benchCreationFn, "HPoint2d", HPoint2d)
await QBenchmarkLoopFn(N, benchCreationFn, "HPoint3d", HPoint3d)

function benchSubtractAddFn(tmp, out) {
  tmp.set(Math.random(), Math.random()); // pt
  out.set(Math.random(), Math.random()); // vec
  tmp.subtract(out, out).add(out, tmp).subtract(tmp, out).add(tmp, tmp);
  return out;
}


N = 10000

await QBenchmarkLoopFn(N, benchSubtractAddFn, "HPoint2d", HPoint2d.tmp, HPoint2d.tmp)
await QBenchmarkLoopFn(N, benchSubtractAddFn, "HPoint3d", HPoint3d.tmp, HPoint3d.tmp)
await QBenchmarkLoopFn(N, benchSubtractAddFn, "PIXI.Point", PIXI.Point.tmp, PIXI.Point.tmp)
await QBenchmarkLoopFn(N, benchSubtractAddFn, "Point3d", Point3d.tmp, Point3d.tmp)
await QBenchmarkLoopFn(N, benchSubtractAddFn, "Point2dTyped", Point2dTyped.tmp, Point2dTyped.tmp)
await QBenchmarkLoopFn(N, benchSubtractAddFn, "Point3dTyped", Point3dTyped.tmp, Point3dTyped.tmp)
await QBenchmarkLoopFn(N, benchSubtractAddFn, "Point3d", Point3d.tmp, Point3d.tmp)
await QBenchmarkLoopFn(N, benchSubtractAddFn, "PIXI.Point", PIXI.Point.tmp, PIXI.Point.tmp)
await QBenchmarkLoopFn(N, benchSubtractAddFn, "HPoint2d", HPoint2d.tmp, HPoint2d.tmp)
await QBenchmarkLoopFn(N, benchSubtractAddFn, "HPoint3d", HPoint3d.tmp, HPoint3d.tmp)





// Bench intersecting a triangle with a ray.
Point3d = CONFIG.GeometryLib.threeD.Point3d
Triangle3d = CONFIG.GeometryLib.threeD.Triangle3d
Triangle3d.prototype.rayIntersection = Triangle3d.prototype.intersectionT

a = HPoint3d.createPoint(5, 0, 0)
b = HPoint3d.createPoint(5, 50, 0)
c = HPoint3d.createPoint(5, 0, 100)
tri = new Triangle3dH(a, b, c);
triOrig = Triangle3d.from3Points(Point3d.tmp.set(...a), Point3d.tmp.set(...b), Point3d.tmp.set(...c))

rayOrigins = [
  [0, 10, 0],
  [0, -10, 0],
  [10, 20, 0],
  [3, 2, 20],
  [-10, 30, 100],
  [-10, 30, 20],
]
rayDirections = [
  [2, 0, 0],
  [3, 0, 0],
  [5, 2, 1],
  [2, 1, 5],
  [0, 0, 10],
  [1, 1, 1],
]

log = []
for ( let i = 0; i < rayOrigins.length; i += 1 ) {
  const o = rayOrigins[i];
  const d = rayDirections[i];
  const rayOrigin = HPoint3d.createPoint(...o);
  const rayDirection = HPoint3d.createVector(...d);
  const t = tri.rayIntersection(rayOrigin, rayDirection)

  const rayOriginOrig = Point3d.tmp.set(...o);
  const rayDirectionOrig = Point3d.tmp.set(...d);
  const tOrig = triOrig.intersectionT(rayOriginOrig, rayDirectionOrig);
  log.push({ origin: rayOriginOrig.toString(), direction: rayDirectionOrig.toString(), t, tOrig })
}
console.table(log)

function benchFn(rayOrigins, rayDirections, tri) {
  const nRays = rayOrigins.length;
  const indices = Array.fromRange(100).map(elem => Math.floor(Math.random() * nRays));

  const ts = Array(indices.length);
  const cl = tri.a.constructor;
  const rayOrigin = cl.tmp;
  const rayDirection = cl.tmp

  let j = 0;
  for ( const i of indices ) {
    const o = rayOrigins[i];
    const d = rayDirections[i];
    rayOrigin.set(...o); // Point
    rayDirection.set(...d, 0); // Vector
    ts[j++] = tri.rayIntersection(rayOrigin, rayDirection);
  }
  rayOrigin.release();
  rayDirection.release();
  return ts;
}

benchFn(rayOrigins, rayDirections, triOrig)
benchFn(rayOrigins, rayDirections, tri)

N = 10000
await QBenchmarkLoopFn(N, benchFn, "Original", rayOrigins, rayDirections, triOrig)
await QBenchmarkLoopFn(N, benchFn, "Homogenous", rayOrigins, rayDirections, tri)

function benchTriFn(rayOrigins, rayDirections, tri, method = "rayIntersection") {
  const nRays = rayOrigins.length;
  const indices = Array.fromRange(nRays);
  // const indices = Array.fromRange(100).map(elem => Math.floor(Math.random() * nRays));
  const ts = Array(indices.length);
  const rayOrigin = Point3d.tmp;
  const rayDirection = Point3d.tmp

  let j = 0;
  for ( const i of indices ) {
    const o = rayOrigins[i];
    const d = rayDirections[i];
    rayOrigin.set(...o); // Point
    rayDirection.set(...d, 0); // Vector
    ts[j++] = tri[method](rayOrigin, rayDirection)
  }
  rayOrigin.release();
  rayDirection.release();
  return ts;
}

function benchTriHomogenousFn(rayOrigins, rayDirections, tri, method = "rayIntersection") {
  const nRays = rayOrigins.length;
  const indices = Array.fromRange(nRays);
  // const indices = Array.fromRange(100).map(elem => Math.floor(Math.random() * nRays));
  const ts = Array(indices.length);
  const rayOrigin = HPoint3d.tmp;
  const rayDirection = HPoint3d.tmp

  let j = 0;
  for ( const i of indices ) {
    const o = rayOrigins[i];
    const d = rayDirections[i];
    rayOrigin.set(...o); // Point
    rayDirection.set(...d, 0); // Vector
    ts[j++] = tri[method](rayOrigin, rayDirection)
  }
  rayOrigin.release();
  rayDirection.release();

  return ts;
}

function benchPlaneFn(rayOrigins, rayDirections, plane, method = "lineIntersection") {
  const nRays = rayOrigins.length;
  const indices = Array.fromRange(nRays);
  // const indices = Array.fromRange(100).map(elem => Math.floor(Math.random() * nRays));
  const ts = Array(indices.length);
  const rayOrigin = Point3d.tmp;
  const rayDirection = Point3d.tmp

  let j = 0;
  for ( const i of indices ) {
    const o = rayOrigins[i];
    const d = rayDirections[i];
    rayOrigin.set(...o); // Point
    rayDirection.set(...d, 0); // Vector
    ts[j++] = plane[method](rayOrigin, rayDirection)
  }
  rayOrigin.release();
  rayDirection.release();
  return ts;
}

function benchPlaneHomogenousFn(rayOrigins, rayDirections, plane, method = "lineIntersection") {
  const nRays = rayOrigins.length;
  const indices = Array.fromRange(nRays);
  // const indices = Array.fromRange(100).map(elem => Math.floor(Math.random() * nRays));
  const ts = Array(indices.length);
  const rayOrigin = HPoint3d.tmp;
  const rayDirection = HPoint3d.tmp

  let j = 0;
  for ( const i of indices ) {
    const o = rayOrigins[i];
    const d = rayDirections[i];
    rayOrigin.set(...o); // Point
    rayDirection.set(...d, 0); // Vector
    ts[j++] = plane[method](rayOrigin, rayDirection)
  }
  rayOrigin.release();
  rayDirection.release();
  return ts;
}

triOrig.plane.rayIntersection(rayOrigin, rayDirection)
triOrig.plane.lineIntersection(rayOrigin, rayDirection)
triOrig.plane.rayIntersectionEisemann(rayOrigin, rayDirection)
tri.plane.rayIntersection(rayOrigin, rayDirection)


benchPlaneFn(rayOrigins, rayDirections, triOrig.plane, "lineIntersection")
benchPlaneFn(rayOrigins, rayDirections, triOrig.plane, "rayIntersectionEisemann") // Fails
benchPlaneHomogenousFn(rayOrigins, rayDirections, tri.plane, "rayIntersection")

benchTriFn(rayOrigins, rayDirections, triOrig, "rayIntersection")
benchTriHomogenousFn(rayOrigins, rayDirections, tri, "rayIntersection")
benchTriHomogenousFn(rayOrigins, rayDirections, tri, "rayIntersectionMT")


rayO = Point3d.tmp.set(...rayOrigins[0])
rayD = Point3d.tmp.set(...rayDirections[0])
v0 = triOrig.a
v1 = triOrig.b
v2 = triOrig.c

rayOrigin = HPoint3d.tmp.set(...rayOrigins[0])
rayDirection = HPoint3d.tmp.set(...rayDirections[0], 0)

N = 10000

await QBenchmarkLoopFn(N, benchPlaneFn, "Original lineIntersection", rayOrigins, rayDirections, triOrig.plane, "lineIntersection")
await QBenchmarkLoopFn(N, benchPlaneFn, "Original rayIntersectionEisemann", rayOrigins, rayDirections, triOrig.plane, "rayIntersectionEisemann")
await QBenchmarkLoopFn(N, benchPlaneHomogenousFn, "Homogenous rayIntersection", rayOrigins, rayDirections, tri.plane, "rayIntersection")

await QBenchmarkLoopFn(N, benchTriFn, "Original rayIntersection", rayOrigins, rayDirections, triOrig, "rayIntersection")
await QBenchmarkLoopFn(N, benchTriHomogenousFn, "Homogenous rayIntersection", rayOrigins, rayDirections, tri, "rayIntersection")
await QBenchmarkLoopFn(N, benchTriHomogenousFn, "Homogenous rayIntersectionMT", rayOrigins, rayDirections, tri, "rayIntersectionMT")


QBenchmarkLoopFn = CONFIG.GeometryLib.bench.QBenchmarkLoopFn
N = 100000
await QBenchmarkLoopFn(N, foundry.utils.orient2dFast, "orient Foundry", a, b, c)
await QBenchmarkLoopFn(N, HPoint2d.orientOrig, "orientOrig", a, b, c)
await QBenchmarkLoopFn(N, HPoint2d.orientDet, "orientDet", a, b, c)
await QBenchmarkLoopFn(N, HPoint2d.orient, "orient", a, b, c)
await QBenchmarkLoopFn(N, HPoint2d.orientV2, "orientV2", a, b, c)
await QBenchmarkLoopFn(N, HPoint2d.orientV3, "orientV3", a, b, c)
await QBenchmarkLoopFn(N, HPoint2d.orientV4, "orientV4", a, b, c)


function orientBench(fn) {
  r = () => (Math.random() - 0.5) * 5000;
  a = HPoint2d.tmp.set(r(), r(), r());
  b = HPoint2d.tmp.set(r(), r(), r())
  c = HPoint2d.tmp.set(r(), r(), r())
  const out = fn(a, b, c);
  a.release();
  b.release();
  c.release();
  return out;
}
await QBenchmarkLoopFn(N, orientBench, "orient Foundry", foundry.utils.orient2dFast)
await QBenchmarkLoopFn(N, orientBench, "orientOrig", HPoint2d.orientOrig)
await QBenchmarkLoopFn(N, orientBench, "orientDet", HPoint2d.orientDet)
await QBenchmarkLoopFn(N, orientBench, "orient", HPoint2d.orient)
await QBenchmarkLoopFn(N, orientBench, "orientV2", HPoint2d.orientV2)
await QBenchmarkLoopFn(N, orientBench, "orientV3", HPoint2d.orientV3)
await QBenchmarkLoopFn(N, orientBench, "orientV4", HPoint2d.orientV4)
await QBenchmarkLoopFn(N, orientBench, "orientV5", HPoint2d.orientV5)
await QBenchmarkLoopFn(N, orientBench, "orientV6", HPoint2d.orientV6)
await QBenchmarkLoopFn(N, orientBench, "orientV7", HPoint2d.orientV7)

function sameSign(fn1, fn2) {
  r = () => (Math.random() - 0.5) * 5000;
  a = HPoint2d.tmp.set(r(), r(), r());
  b = HPoint2d.tmp.set(r(), r(), r())
  c = HPoint2d.tmp.set(r(), r(), r())
  const out1 = fn1(a, b, c);
  const out2 = fn2(a, b, c);
  const out = Math.sign(out1) === Math.sign(out2)
  a.release();
  b.release();
  c.release();
  return out;
}

Array.fromRange(100).every(elem => sameSign(foundry.utils.orient2dFast, HPoint3d.orientOrig)) // √
Array.fromRange(100).every(elem => sameSign(foundry.utils.orient2dFast, HPoint3d.orientDet))
Array.fromRange(100).every(elem => sameSign(foundry.utils.orient2dFast, HPoint3d.orient)) // √
Array.fromRange(100).every(elem => sameSign(foundry.utils.orient2dFast, HPoint3d.orientV2)) // √
Array.fromRange(100).every(elem => sameSign(foundry.utils.orient2dFast, HPoint3d.orientV3))
Array.fromRange(100).every(elem => sameSign(foundry.utils.orient2dFast, HPoint3d.orientV4))
Array.fromRange(100).every(elem => sameSign(foundry.utils.orient2dFast, HPoint3d.orientV5))
Array.fromRange(100).every(elem => sameSign(foundry.utils.orient2dFast, HPoint3d.orientV6))

Array.fromRange(100).map(elem => sameSign(foundry.utils.orient2dFast, orientV5))
Array.fromRange(100).map(elem => sameSign(foundry.utils.orient2dFast, orientV6))

a   b   c         Num -     a ^ c
+   +   +     √       0     +
+   +   -     x       1     -
+   -   +     √       1     +
+   -   -     x       2     -

-   +   +     x       1     -
-   -   +     x       2     -
-   +   -     √       2     +
-   -   -     √       3     +

res = [];
setSign = (elem, dir) => { if ( Math.sign(elem) !== dir ) elem.w *= -1; }
for ( const i of [-1, 1] ) {
  setSign(a, i);
  for ( const j of [-1, 1] ) {
    setSign(b, j);
    for ( const k of [-1, 1] ) {
      setSign(c, k)
      const res1 = foundry.utils.orient2dFast(a, b, c);
      const res2 = HPoint2d.orientV3(a, b, c);
      res.push({ aw: a.w, bw: b.w, cw: c.w, a: i, b: j, c: k, correct: Math.sign(res1) === Math.sign(res2) })
    }
  }
}
console.table(res)

orientV3 x
orientV5 x


// Same
res = [];
target = foundry.utils.orient2dFast(a, b, c)
for ( const fnName of ["orientOrig", "orientDet", "orient", "orientV2", "orientV3", "orientV4", "orientV5", "orientV6", "orientV7"]) {
  const value = HPoint2d[fnName](a, b, c);
  res.push({ fnName, a: a.toString(), b: b.toString(), c: c.toString(), value, equal: target.almostEqual(value) });
}
console.table(res)

            Equal   Small Diff    Sign only   Amount and Sign   Amount only
orientOrig  √
orientDet                         √
orient              √
*orientV2           √
*orientV3                                      √
orientV4    √
orientV5                                                        √
orientV6                                      √
*orientV7    √

*Fastest
