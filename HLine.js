/* globals
PIXI,
foundry
*/
"use strict";

import { HPoint } from "./HPoint.js";

// Homogenous Line class.
// Dual homogenous representation.

export class HLine extends HPoint {
  /**
   * Point on the line, used when treating line as ray or segment. See `create` method.
   * @type {HPoint}
   */
  A;

  /**
   * Point on the line, used when treating line as segment. See `create` method.
   * @type {HPoint}
   */
  B;

  /**
   * Create a line that intersects the two points. Return the dual homogenous representation.
   * @param {HPoint} A
   * @param {HPoint} B
   * @returns {HLine} If the two points are equal, this will be the degenerate {0,0,0} vector.
   */
  static create(A, B) {
    const l = new this();
    l._x = tmp._x;
    A.cross(B, l);
    l.A = A;
    l.B = B;
    return l;
  }

  /**
   * Test whether this line intersects another.
   * If the point is needed, `intersection` will be faster
   * @param {HLine} other
   * @returns {boolean}
   */
  intersects(other) {
    return ((this._x * other._y) - (this._y * other._x)) !== 0;
  }

  /**
   * Test whether this line is almost parallel with another.
   * @param {HLine} other
   * @returns {boolean}
   */
  almostParallel(other, epsilon = 1e-08) {
    return ((this._x * other._y) - (this._y * other._x)).almostEqual(0, epsilon);
  }

  /**
   * Find intersection between this and another homogenous line.
   * @param {HLine} other
   * @returns {HPoint} If _w === 0, the lines do not intersect.
   */
  intersection(other, outPoint) {
    outPoint ??= new HPoint();
    this.cross(other, outPoint);
    return outPoint;
  }

  /**
   * Dual-line normalization of the dual homogenous coordinates of this line.
   * @param {HPoint} [outPoint]   Where to store the value; creates new HPoint if not provided.
   * @returns {HPoint}
   *   Where ∂ is the angle of the line and ∆ is the orthogonal distance from origin to the line
   *   x: l1 = cos ∂
   *   y: l2 = sin ∂
   *   w: -∆
   */
  normD(outPoint) {
    const denom = Math.sqrt(Math.pow(this._x, 2) + Math.pow(this._y, 2));
    const signW = Math.sign(this._w);
    outPoint ??= new HPoint();
    outPoint._x = (-signW * this._x) / denom;
    outPoint._y = (-signW * this._y) / denom;
    outPoint._w = (-signW * this._w) / denom;
    return outPoint;
  }

  /**
   * Euclidean distance from this line to the point.
   * @param {HPoint} pt
   * @returns {number}
   */
  distanceToPoint(pt) {
    const tmp = HPoint.tmp;
    this.normD(tmp);
    const tmp2 = HPoint.tmp2;
    return Math.abs(pt.norm(tmp2).dot(tmp));
  }

  /**
   * Orientation of a point to this line, in the direction A --> B --> pt.
   * Does not adjust for scale, just direction. Same as foundry.utils.orient2dFast
   * only if w === 1 for the point. Otherwise just same sign.
   * @param {HPoint} pt
   * @returns {number}
   *   - CCW: positive
   *   - CW: negative
   *   - collinear: 0
   */
  orient(pt) { return this.dot(pt) * Math.sign(this._w) * Math.sign(pt._w); }

  /**
   * Does this point lie on the same side of the line as the origin?
   * @param {HPoint} pt
   * @returns {number}
   *  < 0: pt and origin on the same side of the line
   *    0: pt collinear with the line
   *  > 0: pt and origin on different sides of the line
   */
  orientToOrigin(pt) { return pt.norm(HPoint.tmp).dot(this.normD(HPoint.tmp2)); }

  /**
   * Do two points lie on the same side of the line?
   * @param {HPoint} a
   * @param {HPoint} b
   * @returns {number}
   *   < 0: Different sides of the line
   *     0: One or both points are collinear
   *   > 0: Same sides of the line
   */
  orientPoints(a, b) {
    // See orientToOrigin.
    const normD = this.normD(HPoint.tmp2);
    const oA = a.norm(HPoint.tmp).dot(normD);
    const oB = b.norm(HPoint.tmp).dot(normD);
    return oA * oB;
  }

  /**
   * Calculate the ratio of how far from A --> B a point on the line lies.
   * @param {HPoint} pt
   * @returns {number}
   */
  tInterval(pt, simple = false) {
    const { A, B } = this;

    // Simple
    if ( simple ) return tInterval(A, B, pt);

    let interval;
    let dist;
    // All three points have the same w values.
    if ( A._w === B._w && A._w === pt._w ) {
      dist = B._x - A._x;
      if ( !dist ) {
        dist = B._y - A._y;
        interval = pt._y - A._y;
      } else interval = pt._x - A._x;

    // A and B have the same w values
    } else if ( A._w === B._w ) {
      dist = (B._x - A._x) * (pt._w * A._w);
      if ( !dist ) {
        dist = (B._y - A._y) * (pt._w * A._w);
        interval = ((pt._y * A._w) - (pt._w * A._y)) * A._w;
      } else interval = ((pt._x * A._w) - (pt._w * A._x)) * A._w;

    // A and point have the same w values
    } else if ( A._w === pt._w ) {
      dist = (B._x * A._w) - (A._x * B._w);
      if ( !dist ) {
        dist = (B._y * A._w) - (A._y * B._w);
        interval = (pt._y - A._y) * B._w;
      } else interval = (pt._x - A._x) * B._w;

    // All three points have different w values
    } else {
      dist = (B._x * A._w - A._x * B._w) * pt._w;
      if ( !dist ) {
        dist = (B._y * A._w - A._y * B._w) * pt._w;
        interval = (pt._y * A._w - A._y * pt._w) * B._w;
      } else interval = (pt._x * A._w - A._x * pt._w) * B._w;
    }

    return interval / dist;
  }
}

/*
A and pt equal w
interval: pt._x / A._w - A._x / A._w => (pt._x - A._x) / A._w
dist: B._x / B._w - A._x / A._w => (B._x * A._w - A._x * B._w) / (A._w * B._w)
=> (pt._x - A._x) * (A._w * B._w) / (B._x * A._w - A._x * B._w) * A._w
=> (pt._x - A._x) * B._w / (B._x * A._w - A._x * B._w)


A and B equal w
interval: pt._x / pt._w - A._x / A._w => ((pt._x * A._w) - (pt._w * A._x)) / (pt._w * A._w)
dist: B._x / A._w - A._x / A._w => (B._x - A._x) / A._w
=> ((pt._x * A._w) - (pt._w * A._x)) * A._w / ((B._x - A._x) * (pt._w * A._w))


All w equal
interval = (pt._x - A._x) / _w
dist = (B._x - A._x) / _w
=> (pt._x - A._x) / (B._x - A._x)


Non equal
interval = pt._x / pt._w - A._x / A._w
dist = B._x / B._w - A._x / A._w

(pt._x * A._w - A._x * pt._w) / (pt._w * A._w)

(B._w * A._w) / (B._x * A._w - A._x * B._w)

=>
(pt._x * A._w - A._x * pt._w) * (B._w * A._w) /

(pt._w * A._w) * (B._x * A._w - A._x * B._w)

=>
(pt._x * A._w - A._x * pt._w) * B._w /
(B._x * A._w - A._x * B._w) * pt._w
*/

/**
 * Get the percentage interval of point c, assumed to be on line formed by a|b.
 * @param {Point} a
 * @param {Point} b
 * @param {Point} c
 * @returns {number}
 */
export function tInterval(a, b, c) {
  let dist = b.x - a.x
  let interval;
  if ( !dist ) {
    dist = b.y - a.y;
    interval = c.y - a.y;
  } else interval = c.x - a.x;
  return interval / dist;
}


/* Benchmark

Construct a triangle from random 3 points.
Determine intersection of random line with the triangle.
Test if a random point is inside the triangle, on the triangle, or outside the triangle.
Measure the circumference of the triangle.

function randomInteger(i) { return Math.floor(Math.random() * i); }

MAX_COORD = 5000;
function HTriangleCreateFn() {
  const a = HPoint.create(randomInteger(MAX_COORD), randomInteger(MAX_COORD));
  const b = HPoint.create(randomInteger(MAX_COORD), randomInteger(MAX_COORD));
  const c = HPoint.create(randomInteger(MAX_COORD), randomInteger(MAX_COORD));
  const pt = HPoint.create(randomInteger(MAX_COORD), randomInteger(MAX_COORD));
  const pt2 = HPoint.create(randomInteger(MAX_COORD), randomInteger(MAX_COORD));
  const l = HLine.create(pt, pt2);
  return { a, b, c, pt, l };
}

function HTriangleLineIntersectionFn(a, b, c, l) {
  const ixAB = HLine.create(a, b).intersection(l);
  if ( ixAB._w ) return ixAB;

  const ixBC = HLine.create(b, c).intersection(l);
  if ( ixBC._w ) return ixBC;

  const ixCA = HLine.create(c, a).intersection(l);
  if ( ixCA._w ) return ixCA;

  return null;
}

function HTriangleOrientationFn(a, b, c, pt) {
  // If doing for real, would ensure a --> b --> c are CCW.
  return HLine.create(a, b).orient(pt) > 0 && HLine.create(b, c).orient(pt) > 0 && HLine.create(c, a).orient(pt) > 0;
}

function HTriangleCircumferenceFn(a, b, c) {
  return HPoint.distanceBetween(a, b) + HPoint.distanceBetween(b, c) + HPoint.distanceBetween(c, a);
}

function HTriangleTestFn() {
  const { a, b, c, pt, l } = HTriangleCreateFn();
  return {
    ix: HTriangleLineIntersectionFn(a, b, c, l),
    orient: HTriangleOrientationFn(a, b, c, pt),
    circumference: HTriangleCircumferenceFn(a, b, c)
  };
}

function PTriangleCreateFn() {
  const a = new PIXI.Point(randomInteger(MAX_COORD), randomInteger(MAX_COORD));
  const b = new PIXI.Point(randomInteger(MAX_COORD), randomInteger(MAX_COORD));
  const c = new PIXI.Point(randomInteger(MAX_COORD), randomInteger(MAX_COORD));
  const pt = new PIXI.Point(randomInteger(MAX_COORD), randomInteger(MAX_COORD));
  const pt2 = new PIXI.Point(randomInteger(MAX_COORD), randomInteger(MAX_COORD));
  const l = new Ray(pt, pt2);
  return { a, b, c, pt, l };
}

function PTriangleLineIntersectionFn(a, b, c, l) {
  const ixAB = foundry.utils.lineLineIntersection(a, b, l.A, l.B)
  if ( !ixAB ) return ixAB;

  const ixBC = foundry.utils.lineLineIntersection(b, c, l.A, l.B)
  if ( !ixBC ) return ixBC;

  const ixCA = foundry.utils.lineLineIntersection(c, a, l.A, l.B)
  if ( !ixCA ) return ixCA;

  return null;
}

function PTriangleOrientationFn(a, b, c, pt) {
  // If doing for real, would ensure a --> b --> c are CCW.
  return foundry.utils.orient2dFast(a, b, pt) > 0 && foundry.utils.orient2dFast(b, c, pt) > 0 && foundry.utils.orient2dFast(c, a, pt) > 0;
}

function PTriangleCircumferenceFn(a, b, c) {
  return PIXI.Point.distanceBetween(a, b) + PIXI.Point.distanceBetween(b, c) + PIXI.Point.distanceBetween(c, a);
}

function PTriangleTestFn() {
  const { a, b, c, pt, l } = PTriangleCreateFn();
  return {
    ix: PTriangleLineIntersectionFn(a, b, c, l),
    orient: PTriangleOrientationFn(a, b, c, pt),
    circumference: PTriangleCircumferenceFn(a, b, c)
  };
}

function STriangleCreateFn() {
  const a = { x: randomInteger(MAX_COORD), y: randomInteger(MAX_COORD) };
  const b = { x: randomInteger(MAX_COORD), y: randomInteger(MAX_COORD) };
  const c = { x: randomInteger(MAX_COORD), y: randomInteger(MAX_COORD) };
  const pt = { x: randomInteger(MAX_COORD), y: randomInteger(MAX_COORD) };
  const pt2 = { x: randomInteger(MAX_COORD), y: randomInteger(MAX_COORD) };
  const l = new Ray(pt, pt2);
  return { a, b, c, pt, l };
}

function STriangleLineIntersectionFn(a, b, c, l) {
  const ixAB = foundry.utils.lineLineIntersection(a, b, l.A, l.B)
  if ( !ixAB ) return ixAB;

  const ixBC = foundry.utils.lineLineIntersection(b, c, l.A, l.B)
  if ( !ixBC ) return ixBC;

  const ixCA = foundry.utils.lineLineIntersection(c, a, l.A, l.B)
  if ( !ixCA ) return ixCA;

  return null;
}

function STriangleOrientationFn(a, b, c, pt) {
  // If doing for real, would ensure a --> b --> c are CCW.
  return foundry.utils.orient2dFast(a, b, pt) > 0 && foundry.utils.orient2dFast(b, c, pt) > 0 && foundry.utils.orient2dFast(c, a, pt) > 0;
}

function STriangleCircumferenceFn(a, b, c) {
  return PIXI.Point.distanceBetween(a, b) + PIXI.Point.distanceBetween(b, c) + PIXI.Point.distanceBetween(c, a);
}

function STriangleTestFn() {
  const { a, b, c, pt, l } = STriangleCreateFn();
  return {
    ix: STriangleLineIntersectionFn(a, b, c, l),
    orient: STriangleOrientationFn(a, b, c, pt),
    circumference: STriangleCircumferenceFn(a, b, c)
  };
}

N = 10000
await QBenchmarkLoopFn(N, HTriangleTestFn, "HTriangleTestFn")
await QBenchmarkLoopFn(N, PTriangleTestFn, "PTriangleTestFn")
await QBenchmarkLoopFn(N, STriangleTestFn, "STriangleTestFn")


// Compare tInterval
function intervalTestFn(simple = true) {
  const a = HPoint.create(randomInteger(MAX_COORD), randomInteger(MAX_COORD));
  const b = HPoint.create(randomInteger(MAX_COORD), randomInteger(MAX_COORD));
  const c = HPoint.create(randomInteger(MAX_COORD), randomInteger(MAX_COORD));
  const l = HLine.create(a, b);
  return l.tInterval(c, simple)
}

N = 100000
await QBenchmarkLoopFn(N, intervalTestFn, "intervalTestFn simple", true)
await QBenchmarkLoopFn(N, intervalTestFn, "intervalTestFn fast", false)

*/


