/* globals
CONFIG
*/
"use strict";

import { Point3d } from "./Point3d.js";
import { Matrix } from "../Matrix.js";

// Class to represent a plane
export class Plane {
  /**
   * Default construction is the XY canvas plane
   * @param {Point3d} normal    Normal vector to the plane
   * @param {Point3d} point     Point on the plane
   */
  constructor(point = new Point3d(0, 0, 0), normal = new Point3d(0, 0, 1)) {
    this.normal = normal.normalize(normal);
    this.point = point;
  }

  /**
   * Construct plane from set of 3 points that lie on the plane
   * @param {Point3d} a
   * @param {Point3d} b
   * @param {Point3d} c
   * @returns {Plane}
   */
  static fromPoints(a, b, c) {
    const vAB = b.subtract(a);
    const vAC = c.subtract(a);

    const normal = vAB.cross(vAC);
    return new Plane(a, normal);
  }

  /**
   * Construct a plane from a wall
   * @param {Wall} wall
   * @returns {Plane}
   */
  static fromWall(wall) {
    const pts = Point3d.fromWall(wall, { finite: true }); // Need finite so Normal can be calculated

    // To keep the points simple, use different Z values
    const A = pts.A.top;
    const B = pts.A.bottom;
    const C = pts.B.bottom;

    B.z = (A.z + B.z) * 0.5;
    A.z = B.z + 1;
    C.z = B.z;

    return Plane.fromPoints(pts.A.top, pts.A.bottom, pts.B.bottom);
  }

  /**
   * Determine the angle between two vectors
   * @param {Point3d} v1
   * @param {Point3d} v2
   * @returns {number}
   */
  static angleBetweenVectors(v1, v2) {
    return Math.acos(v1.dot(v2) / v1.magnitude());
  }

  static angleBetweenSegments(a, b, c, d) {
    // Dot product of the two vectors
    // Divide by magnitude of the first
    // Divide by magnitude of the second
    const V1 = b.subtract(a);
    const V2 = d.subtract(c);
    const mag = (V1.magnitude() * V2.magnitude());
    if ( !mag ) return 0;

    return Math.acos(V1.dot(V2) / (V1.magnitude() * V2.magnitude()));
  }

  /**
   * Return representation of plane as ax + by + cx + d
   * a, b, c is the plane's normal
   * @returns {object} Object with a, b, c, d
   */
  get equation() {
    const N = this.normal;
    const P = this.point;

    return {
      a: N.x,
      b: N.y,
      c: N.z,
      d: -N.dot(P)
    };
  }

  /**
   * Matrix to convert planar points to 2d
   */
  get conversion2dMatrix() {
    if ( !this._conversion2dMatrix ) {
      this._conversion2dMatrix = this._calculateConversion2dMatrix();
      this._conversion2dMatrixInverse = this._conversion2dMatrix.invert();
    }
    return this._conversion2dMatrix;
  }

  get conversion2dMatrixInverse() {
    if ( !this._conversion2dMatrixInverse ) {
      this._conversion2dMatrixInverse = this.conversion2dMatrix.invert();
    }
    return this._conversion2dMatrixInverse;
  }

  /** @type {object} { u: Point3d, v: Point3d } */
  get axisVectors() {
    return this._axisVectors || (this._axisVectors = this._calculateAxisVectors());
  }

  /**
   * Cache the denominator calculation for to2d().
   * Denominator value chosen based on highest magnitude, to increase numerical stability
   * by using a larger-magnitude divisor.
   * @type {number}
   */
  get denom2d() {
    if ( typeof this._denom2d === "undefined" ) {
      const { u, v } = this.axisVectors;

      const denom1 = (u.x * v.y) - (v.x * u.y);
      const denom2 = (u.x * v.z) - (v.x * u.z);
      const denom3 = (u.y * v.z) - (v.y * u.z);

      const absDenom1 = Math.abs(denom1);
      const absDenom2 = Math.abs(denom2);
      const absDenom3 = Math.abs(denom3);

      if ( absDenom1 > absDenom2 && absDenom1 && absDenom3) {
        this._denom2d = denom1;
        this._numeratorFn2d = numerator2dv1;
      } else if ( absDenom2 > absDenom1 && absDenom2 > absDenom3 ) {
        this._denom2d = denom2;
        this._numeratorFn2d = numerator2dv2;
      } else {
        this._denom2d = denom3;
        this._numeratorFn2d = numerator2dv3;
      }
    }

    return this._denom2d;
  }

  /**
   * Cache the function used to calculate the numerator for to2d().
   * See this.denom2d
   * @type {Function}
   */
  get numeratorFn2d() {
    if ( typeof this._numeratorFn2d === "undefined" ) this.denom2d;
    return this._numeratorFn2d;
  }

  /**
   * Which side of the plane lies a 3d point.
   * The returned value may be negative or positive depending on specific orientation of
   * the plane and point, but the value should remain the same sign for other points on that side.
   * @param {Point3d} p
   * @returns {number}
   *   - Positive: p is above the plane
   *   - Negative: p is below the plane
   *   - Zero: p is on the plane ()
   * Point nearly on the plane will return very small values.
   */
  whichSide(p) {
    const { u, v } = this.axisVectors;
    const p0 = this.point;

    // Assuming p0, u, v are CCW:
    // - Positive if p0, u, v are seen as CCW from p
    // - Negative if p0, u, v are seen as CW from p
    return CONFIG.GeometryLib.utils.orient3dFast(p0, u, v, p);
  }

  isPointOnPlane(p) {
    // https://math.stackexchange.com/questions/684141/check-if-a-point-is-on-a-plane-minimize-the-use-of-multiplications-and-divisio
    const vs = this.axisVectors;
    const a = this.point;
    const b = this.point.add(vs.v);
    const c = this.point.add(vs.u);

    const m = new Matrix([
      [a.x, b.x, c.x, p.x],
      [a.y, b.y, c.y, p.y],
      [a.z, b.z, c.z, p.z],
      [1,   1,   1,   1]    // eslint-disable-line no-multi-spaces
    ]);

    return m.determinant().almostEqual(0);
  }


  /**
   * Calculate axis vectors for the plane.
   * @returns {object} {u: Point3d, v: Point3d} Two vectors on the plane, normalized
   */
  _calculateAxisVectors() {
    // https://math.stackexchange.com/questions/64430/find-extra-arbitrary-two-points-for-a-plane-given-the-normal-and-a-point-that-l
    // Find the minimum index
    const n = this.normal;
    const w = (n.x < n.y && n.x < n.z) ? new Point3d(1, 0, 0)
      : n.y < n.z ? new Point3d(0, 1, 0) : new Point3d(0, 0, 1);

    const u = new Point3d();
    const v = new Point3d();
    w.cross(n, u).normalize(u);
    n.cross(u, v).normalize(v);

    return { u, v };
  }

  /**
   * Convert a 3d point on the plane to 2d
   * https://math.stackexchange.com/questions/3528493/convert-3d-point-onto-a-2d-coordinate-plane-of-any-angle-and-location-within-the
   * More numerically stable than _calculateConversion2dMatrix
   */
  to2d(pt) {
    const point = this.point;
    const denom = this.denom2d;
    const { numU, numV } = this.numeratorFn2d.call(this, pt);

    return new PIXI.Point(numU / denom, numV / denom);
  }

  /**
   * Convert a 2d point in plane coordinates to a 3d point.
   * Inverse of to2d()
   * More numerically stable than using the inverse of _calculateConversion2dMatrix
   */
  to3d(pt) {
    const { u, v } = this.axisVectors;
    const point = this.point;

    return new Point3d(
      point.x + (pt.x * u.x) + (pt.y * v.x),
      point.y + (pt.x * u.y) + (pt.y * v.y),
      point.z + (pt.x * u.z) + (pt.y * v.z)
    );
  }

  /**
   * 2d conversion matrix, take two.
   * Matrix should take points on the plane and shift to 2d: {x,y,z} * M = {x, y, 0}
   * Inverse of matrix should reverse the operation: {x, y, 0} * Minv = {x, y, z}
   * https://stackoverflow.com/questions/49769459/convert-points-on-a-3d-plane-to-2d-coordinates
   * @returns {Matrix} 4x4 matrix
   */
  _calculateConversion2dMatrix() {
    const { normal: N, point: P } = this;
    const vs = this.axisVectors;

    const u = P.add(vs.u);
    const v = P.subtract(vs.v);
    const A = P;
    const n = P.add(N);

    // Three points
    /* Original version, for testing
    A = terrainWallPoints.A.top
    B = terrainWallPoints.A.bottom
    C = terrainWallPoints.B.bottom

    AB = B.subtract(A);
    AC = C.subtract(A);
    N = AB.cross(AC);
    U = AB.normalize()
    uN = N.normalize();
    V = U.cross(uN);
    u = A.add(U);
    v = A.add(V);
    n = A.add(uN);
    */

    // Adjust for row-major matrix and left-hand coordinate system

    const S = new Matrix([
      [A.x, A.y, A.z, 1],
      [u.x, u.y, u.z, 1],
      [v.x, v.y, v.z, 1],
      [n.x, n.y, n.z, 1]
    ]);

    const D = new Matrix([
      [0, 0, 0, 1],
      [1, 0, 0, 1],
      [0, 1, 0, 1],
      [0, 0, 1, 1]
    ]);

    const Sinv = S.invert();
    return Sinv.multiply4x4(D);
  }


  /**
   * Calculate the rotation matrix to shift points on the plane to a 2d version.
   * https://stackoverflow.com/questions/49769459/convert-points-on-a-3d-plane-to-2d-coordinates
   * @returns {Matrix} 4x4 rotation matrix
   */
//   calculate2dRotationMatrix() {
//     const n = this.normal;
//     const p0 = this.point;
//     const vs = this.axisVectors;
//     const u = vs.u;
//     const v = vs.v;
//
//     // Translate such that 0,0,0 in world is the pl.point
//     return new Matrix([
//       [u.x, u.y, u.z, 0], // X-axis
//       [v.x, v.y, v.z, 0], // Y-axis
//       [n.x, n.y, n.z, 0], // Z-axis
//       [p0.x, p0.y, p0.z, 1] // Translation
//     ]);
//   }

  /**
   * Intersection point between ray and the plane
   * @param {Point3d} v  Point (or vertex) on the ray, representing 1 unit of movement along the ray
   * @param {Point3d} l  Origin of the ray.
   * @returns {Point3d|null}
   */
  rayIntersection(v, l) {
    // Eisemann, Real-Time Shadows, p. 24 (Projection Matrix for Planar Shadows)

    const { normal: N, point: P } = this;

    const dotNV = N.dot(v);
    const dotNL = N.dot(l);
    // Right-handed system: const denom = dotNL - dotNV;
    const denom = dotNV - dotNL;

    if ( denom.almostEqual(0) ) return null;

    const d = N.dot(P);

    const outPoint = new Point3d();

    v.multiplyScalar(dotNL + d, outPoint);
    const b = l.multiplyScalar(dotNV + d);

    outPoint.subtract(b, outPoint);
    outPoint.multiplyScalar(1 / denom, outPoint);

    return outPoint;
  }

  /**
   * Line, defined by a point and a vector
   * https://www.wikiwand.com/en/Line%E2%80%93plane_intersection
   * @param {Point3d} vector
   * @param {Point3d} l0
   * @returns {Point3d|null}
   */
  lineIntersection(l0, l) {
    const N = this.normal;
    const P = this.point;

    const dot = N.dot(l);

    // Test if line and plane are parallel and do not intersect.
    if ( dot.almostEqual(0) ) return null;

    const w = l0.subtract(P);
    const fac = -N.dot(w) / dot;
    const u = l.multiplyScalar(fac);
    return l0.add(u);
  }

  /**
   * Line segment, defined by two points
   * @param {Point3d} p0
   * @param {Point3d} p1
   * @returns {Point3d|null}
   */
  lineSegmentIntersection(p0, p1) {
    return this.lineIntersection(p0, p1.subtract(p0));
  }

  /**
   * Test whether a line segment intersects a plane
   * @param {Point3d} a   First point of the segment
   * @param {Point3d} b   Second point of the segment
   * @returns {boolean}
   */
  lineSegmentIntersects(a, b) {
    const vs = this.axisVectors;
    const p0 = this.point;
    return CONFIG.GeometryLib.utils.lineSegment3dPlaneIntersects(a, b, p0, p0.add(vs.u), p0.add(vs.v));
  }

}


/**
 * Helper to calculate numerator for to2d()
 * @param {Point3d} pt    Point to convert to 2d
 * @param {Point3d} point Origin point of plane
 * @returns {object} {numU: number, numV: number}
 */
function numerator2dv1(pt) {
  const { u, v } = this.axisVectors;
  const point = this.point;

  return {
    numU: (pt.x - point.x) * v.y - (pt.y - point.y) * v.x,
    numV: (pt.y - point.y) * u.x - (pt.x - point.x) * u.y
  }
}

/**
 * Helper to calculate numerator for to2d()
 * @param {Point3d} pt    Point to convert to 2d
 * @returns {object} {numU: number, numV: number}
 */
function numerator2dv2(pt) {
  const { u, v } = this.axisVectors;
  const point = this.point;

  return {
    numU: (pt.x - point.x) * v.z - (pt.z - point.z) * v.x,
    numV: (pt.z - point.z) * u.x - (pt.x - point.x) * u.z
  }
}

/**
 * Helper to calculate numerator for to2d()
 * @param {Point3d} pt    Point to convert to 2d
 * @returns {object} {numU: number, numV: number}
 */
function numerator2dv3(pt) {
  const { u, v } = this.axisVectors;
  const point = this.point;

  return {
    numU: (pt.y - point.y) * v.z - (pt.z - point.z) * v.y,
    numV: (pt.z - point.z) * u.y - (pt.y - point.y) * u.z
  }
}
