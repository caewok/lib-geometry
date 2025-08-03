

// Typed array for Point3d with pool
 class Pool {

  initialSize = 100;

  pool = new Set();

  objConstructor;

  /**
   * @param {function} objConstructor     Function that can construct a blank object.
   *   Given this pool when constructed. Should return a blank, initialized object.
   */
  constructor(objConstructor) {
    this.objConstructor = objConstructor;
  }

  increasePool(n = this.initialSize) {
    for ( let i = 0; i < n; i += 1 ) this.pool.add(this.objConstructor(this));
  }

  /**
   * Get an object from the pool.
   */
  acquire() {
    // If empty, add objects to the pool.
    if ( !this.pool.size ) this.increasePool();

    // Retrieve an object from the pool and remove it from the pool.
    const obj = this.pool.first();
    this.pool.delete(obj);
    return obj;
  }

  /**
   * Release an object back to the pool.
   * @param {obj} object        Object to return.
   */
  release(obj) {
    // Basic test that the object belongs.
    if ( !this.pool.size ) this.increasePool();

    const testObj = this.pool.first();
    const isValid = testObj.constructor.classTypes
      ? testObj.objectMatchesClassType(obj)
      : obj instanceof testObj.constructor;
    if ( !isValid) {
      console.warn("Pool object does not match other instance in the pool.", { testObj, obj });
      return;
    }
    this.pool.add(obj);
  }
}

class Point2dPool extends Pool {

  increasePool(n = this.initialSize) {
    const buffer = new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT * 2);
    for ( let i = 0; i < n; i += 1 ) {
      const obj = new Point2dTyped(new Float32Array(buffer, i * Float32Array.BYTES_PER_ELEMENT * 2, 2));
      this.pool.add(obj);
    }
  }

}

class Point3dPool extends Pool {

  increasePool(n = this.initialSize) {
    const buffer = new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT * 3);
    for ( let i = 0; i < n; i += 1 ) {
      const obj = new Point3dTyped(new Float32Array(buffer, i * Float32Array.BYTES_PER_ELEMENT * 3, 3));
      this.pool.add(obj);
    }
  }

}

class HPoint2dPool extends Pool {

  increasePool(n = this.initialSize) {
    const buffer = new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT * 3);
    for ( let i = 0; i < n; i += 1 ) {
      const obj = new HPoint2d(new Float32Array(buffer, i * Float32Array.BYTES_PER_ELEMENT * 3, 3));
      this.pool.add(obj);
    }
  }

}

class HLine2dPool extends Pool {

  increasePool(n = this.initialSize) {
    const buffer = new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT * 3);
    for ( let i = 0; i < n; i += 1 ) {
      const obj = new HLine2d(new Float32Array(buffer, i * Float32Array.BYTES_PER_ELEMENT * 3, 3));
      this.pool.add(obj);
    }
  }

}

class HPoint3dPool extends Pool {

  increasePool(n = this.initialSize) {
    const buffer = new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT * 4);
    for ( let i = 0; i < n; i += 1 ) {
      const obj = new HPoint3d(new Float32Array(buffer, i * Float32Array.BYTES_PER_ELEMENT * 4, 4));
      this.pool.add(obj);
    }
  }

}

class HPlanePool extends Pool {

  increasePool(n = this.initialSize) {
    const buffer = new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT * 4);
    for ( let i = 0; i < n; i += 1 ) {
      const obj = new HPlane(new Float32Array(buffer, i * Float32Array.BYTES_PER_ELEMENT * 4, 4));
      this.pool.add(obj);
    }
  }

}




class Point2dTyped {

  arr;

  get x() { return this.arr[0]; }

  get y() { return this.arr[1]; }

  constructor(arr) {
    this.arr = arr ?? new Float32Array(2);
  }

  static #pool = new Point2dPool();

  static release(...args) { args.forEach(arg => this.#pool.release(arg)); }

  release() {
    // No need to clear the object, as no cache used.
    this.constructor.release(this);
  }

  static get tmp() { return this.#pool.acquire(); }

  static from(x, y) {
    const out = this.tmp;
    out.arr[0] = x;
    out.arr[1] = y;
    return out;
  }

  set(x, y) { this.arr[0] = x; this.arr[1] = y; return this; }


  add(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    outPoint.arr.set(this.arr);
    outPoint.arr[0] += other.arr[0];
    outPoint.arr[1] += other.arr[1];
    return outPoint;
  }

  subtract(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    outPoint.arr.set(this.arr);
    outPoint.arr[0] += other.arr[0];
    outPoint.arr[1] += other.arr[1];
    return outPoint;
  }

  multiply(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    outPoint.arr.set(this.arr);
    outPoint.arr[0] *= other.arr[0];
    outPoint.arr[1] *= other.arr[1];
    return outPoint;
  }

  divide(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    outPoint.arr.set(this.arr);
    outPoint.arr[0] /= other.arr[0];
    outPoint.arr[1] /= other.arr[1];
    return outPoint;
  }

  multiplyScalar(scalar, outPoint) {
    outPoint ??= this.constructor.tmp;
    outPoint.arr.set(this.arr);
    outPoint.arr[0] *= scalar;
    outPoint.arr[1] *= scalar;
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
}


class Point3dTyped extends Point2dTyped {

  get z() { return this.arr[2]; }

  constructor(arr) {
    arr ??= new Float32Array(3);
    super(arr);
  }

  static #pool = new Point3dPool();

  static release(...args) { args.forEach(arg => this.#pool.release(arg)); }

  static get tmp() { return this.#pool.acquire(); }

  static from(x, y, z = 0) {
    const out = this.tmp;
    out.arr[0] = x;
    out.arr[1] = y;
    out.arr[2] = z;
    return out;
  }

  set(x, y, z = 0) { this.arr[0] = x; this.arr[1] = y; this.arr[2] = z; return this; }

  add(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    super.add(other, outPoint);
    outPoint.arr[2] += other.arr[2];
    return outPoint;
  }

  subtract(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    super.subtract(other, outPoint);
    outPoint.arr[2] -= other.arr[2];
    return outPoint;
  }


  multiply(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    super.multiply(other, outPoint);
    outPoint.arr[2] *= other.arr[2];
    return outPoint;
  }

  divide(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    super.divide(other, outPoint);
    outPoint.arr[2] /= other.arr[2];
    return outPoint;
  }

  multiplyScalar(scalar, outPoint) {
    outPoint ??= this.constructor.tmp;
    super.multiplyScalar(scalar, outPoint);
    outPoint.arr[2] *= scalar;
    return outPoint;
  }

  cross(other, outPoint) {
    outPoint ??= this.constructor.tmp;

    // Avoid overwriting other incase it is outPoint.
    const x = (this.arr[1] * other.arr[2]) - (this.arr[2] * other.arr[1]);
    const y = (this.arr[2] * other.arr[0]) - (this.arr[0] * other.arr[2]);
    outPoint.arr[2] = (this.arr[0] * other.arr[1]) - (this.arr[1] * other.arr[0]);
    outPoint.arr[0] = x;
    outPoint.arr[1] = y;

    return outPoint;
  }

}


class HPoint2d {

  static W_INDEX = 2;

  arr;

  get x() { return this.arr[0] / this.arr[this.constructor.W_INDEX]; }

  get y() { return this.arr[1] / this[this.constructor.W_INDEX]; }

  get w() { return this.arr[this.constructor.W_INDEX]; }


  set x(value) { this.arr[0] = value; }

  set y(value) { this.arr[1] = value; }

  set w(value) { this.arr[this.constructor.W_INDEX] = value; }

  constructor(arr) {
    this.arr = arr ?? new Float32Array(3);
    this.arr[this.constructor.W_INDEX] = 1;
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

  static #pool = new HPoint2dPool();

  static release(...args) { args.forEach(arg => this.#pool.release(arg)); }

  release() {
    // No need to clear the object, as no cache used.
    this.constructor.release(this);
  }

  static get tmp() { return this.#pool.acquire(); }

  static from(x, y, w = 1) {
    const out = this.tmp;
    out.arr[0] = x;
    out.arr[1] = y;
    out.arr[2] = w;
    return out;
  }

  set(x, y, w = 1) { this.arr[0] = x; this.arr[1] = y; this.arr[this.constructor.W_INDEX] = w; return this; }


  /*
  x0/w0 + x1/w1 = x2/w2
  (x0*w1 + x1*w0) / w0*w1 = x2/w2
  x2 = x0*w1 + x1*w0
  w2 = w0*w1
  */

  add(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    const w0 = this.arr[this.constructor.W_INDEX];
    const w1 = other.arr[this.constructor.W_INDEX];
    outPoint.arr[0] = this.arr[0] * w1 + other.arr[0] * w0;
    outPoint.arr[1] = this.arr[1] * w1 + other.arr[1] * w0;
    outPoint.arr[this.constructor.W_INDEX] = w0 * w1;
    return outPoint;
  }

  subtract(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    const w0 = this.arr[this.constructor.W_INDEX];
    const w1 = other.arr[this.constructor.W_INDEX];
    outPoint.arr[0] = this.arr[0] * w1 - other.arr[0] * w0;
    outPoint.arr[1] = this.arr[1] * w1 - other.arr[1] * w0;
    outPoint.arr[this.constructor.W_INDEX] = w0 * w1;
    return outPoint;
  }

  /*
    x0/w0 * x1/w1 = x2/w2
    x2 = x0*x1
    w2 = w0*w1

  */
  multiply(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    outPoint.arr.set(this.arr);
    outPoint.arr[0] *= other.arr[0];
    outPoint.arr[1] *= other.arr[1];
    outPoint.arr[this.constructor.W_INDEX] *= other.arr[this.constructor.W_INDEX];
    return outPoint;
  }

  /*
   1 / pt
   1 / (x0 / w0), 1 / (y0 / w0)

   w0 / x0,  w0 / y0

   w0 * y0 / x0 * y0,  w0 * x0 / x0 * y0 => x = w0 * y0, y = w0 * x0, w = x0 * y0
   */
  invert(outPoint) {
    outPoint ??= this.constructor.tmp;
    const w = this.arr[this.constructor.W_INDEX];
    outPoint[0] = w * this.arr[1];
    outPoint[1] = w * this.arr[0];
    outPoint[this.constructor.W_INDEX] = this.arr[0] * this.arr[1];
    return outPoint;
  }

  divide(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    const inv = other.invert(outPoint);
    return this.multiply(inv, outPoint);
  }


  multiplyScalar(scalar, outPoint) {
    outPoint ??= this.constructor.tmp;
    outPoint.arr.set(this.arr);
    outPoint.arr[this.constructor.W_INDEX] *= (1 / scalar);
    return outPoint;
  }

  /**
   * Magnitude (length, or sometimes distance) of this point.
   * Square root of the sum of squares of each component.
   * @returns {number}
   */

  /*
    sqrt(x * x + y * y)
    x0/w0 * x0/w0 + y0/w0 * y0/w0 = num
    (x0 * x0 + y0 * y0) / w0

  */
  magnitude() {
    return Math.sqrt(this.magnitudeSquared);
  }

  magnitudeSquared() {
    return (this.arr[0] * this.arr[0] + this.arr[1] * this.arr[1]) / this.arr[2];
  }

  normalize(outPoint) {
    return this.multiplyScalar(1 / this.magnitude(), outPoint);
  }

  /**
   * Cross product, treating w as a coordinate.
   */
  cross(other, outPoint) {
    outPoint ??= this.constructor.tmp;

    // Avoid overwriting other incase it is outPoint.
    const x = (this.arr[1] * other.arr[2]) - (this.arr[2] * other.arr[1]);
    const y = (this.arr[2] * other.arr[0]) - (this.arr[0] * other.arr[2]);
    outPoint.arr[2] = (this.arr[0] * other.arr[1]) - (this.arr[1] * other.arr[0]);
    outPoint.arr[0] = x;
    outPoint.arr[1] = y;
    return outPoint;
  }
}

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

  static W_INDEX = 3;

  get z() { return this.arr[2] / this.arr[3]; }

  set z(value) { this.arr[2] = value; }

  constructor(arr) {
    arr ??= new Float32Array(3);
    super(arr);
  }

  static #pool = new Point3dPool();

  static release(...args) { args.forEach(arg => this.#pool.release(arg)); }

  static get tmp() { return this.#pool.acquire(); }

  static from(x, y, z = 0, w = 1) {
    const out = this.tmp;
    out.arr[0] = x;
    out.arr[1] = y;
    out.arr[2] = z;
    out.arr[3] = w;
    return out;
  }

  set(x, y, z = 0, w = 1) {
    super.set(x, y, w);
    this.arr[2] = z;
    return this;
  }

  add(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    super.add(other, outPoint);
    outPoint.arr[2] = this.arr[2] * other.arr[3] + other.arr[2] * this.arr[3];
    return outPoint;
  }

  subtract(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    super.subtract(other, outPoint);
    outPoint.arr[2] = this.arr[2] * other.arr[3] - other.arr[2] * this.arr[3];
    return outPoint;
  }


  multiply(other, outPoint) {
    outPoint ??= this.constructor.tmp;
    super.multiply(other, outPoint);
    outPoint.arr[2] *= other.arr[2];
    return outPoint;
  }

  invert(outPoint) {
    outPoint ??= this.constructor.tmp;
    super.invert(outPoint);
    const z = this.arr[2];
    outPoint[0] *= z;
    outPoint[1] *= z;
    outPoint[2] = this.arr[3] * this.arr[0] * this.arr[1];
    outPoint[3] *= z;
    return outPoint;
  }

  multiplyScalar(scalar, outPoint) {
    outPoint ??= this.constructor.tmp;
    super.multiplyScalar(scalar, outPoint);
    outPoint.arr[2] *= scalar;
    return outPoint;
  }


  magnitudeSquared() {
    return (this.arr[0] * this.arr[0] + this.arr[1] * this.arr[1] + this.arr[2] * this.arr[2]) / this.arr[3];
  }
}

class HLine2d extends HPoint2d {

  static #pool = new HLine2dPool();

  static release(...args) { args.forEach(arg => this.#pool.release(arg)); }

  static from2dPoints(a, b) {
    const out = this.tmp;
    return a.cross(b, out);
  }

  /**
   * Intersection of this line with another in 2d space.
   * @returns {HPoint2d}
   */
  intersection(other, outPoint) {
    outPoint ??= HPoint2d.tmp;
    return this.cross(other, outPoint);
  }

  /**
   * Is a point on this line (or vice-versa)
   * @param {HPoint2d}
   * @returns {boolean}
   */
  isCoincident(pt) { return this.dot(pt) === 0; }

  isNearlyCoincident(pt, epsilon = 1e-06) { return this.dot(pt).almostEqual(o, epsilon); }
}

class HPlane extends HPoint3d {

  static #pool = new HPlanePool();

  static release(...args) { args.forEach(arg => this.#pool.release(arg)); }

  static from3dPoints(a, b) {
    const out = this.tmp;
    return a.cross(b, out);
  }


}

function benchFn(cl) {
  const outPoint = cl.tmp;
  const pt = cl.tmp;
  const pt2 = cl.tmp;
  pt.set(Math.random(), Math.random(), 1);
  pt2.set(Math.random(), Math.random(), 1);
  pt
    .multiplyScalar(2, outPoint)
    .add(pt2, outPoint)
    .subtract(pt2, outPoint)
    .multiply(pt2, outPoint)
    .divide(pt2, outPoint)
    .normalize(outPoint);
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
await QBenchmarkLoopFn(N, benchFn, "PIXI.Point", PIXI.Point)
await QBenchmarkLoopFn(N, benchFn, "Point3d", Point3d)
await QBenchmarkLoopFn(N, benchFn, "Point2dTyped", Point2dTyped)
await QBenchmarkLoopFn(N, benchFn, "Point3dTyped", Point3dTyped)
await QBenchmarkLoopFn(N, benchFn, "HPoint2d", HPoint2d)
await QBenchmarkLoopFn(N, benchFn, "HPoint3d", HPoint3d)