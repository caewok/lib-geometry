/* globals
CONFIG,
PIXI
*/
"use strict";

import "./Point3d.js";
import { GEOMETRY_CONFIG } from "../const.js";
import { Point3d } from "./Point3d.js";

const originPt3d = new Point3d();
Object.freeze(originPt3d);

const tmpPt3d0 = new Point3d();
const tmpPt3d1 = new Point3d();
const tmpPt3d2 = new Point3d();
const tmpPt3d3 = new Point3d();

// Class to represent a plane
export class Plane {

  /** @type {Point3d} */
  normal = new CONFIG.GeometryLib.threeD.Point3d(0, 0, 1);

  /** @type {Point3d} */
  point = new CONFIG.GeometryLib.threeD.Point3d();

  /**
   * Default construction is the XY canvas plane
   * @param {Point3d} normal    Normal vector to the plane
   * @param {Point3d} point     Point on the plane, representing the plane's origin point
   */
  constructor(point = new CONFIG.GeometryLib.threeD.Point3d(0, 0, 0), normal = new CONFIG.GeometryLib.threeD.Point3d(0, 0, 1)) {
    this.normal.copyFrom(normal.normalize());
    this.point.copyFrom(point);
  }

  /**
   * Normalize the plane.
   * See https://web.archive.org/web/20120531231005/http://crazyjoke.free.fr/doc/3D/plane%20extraction.pdf
   */
  normalizedPlaneEquation() {
    // const mag = this.normal.magnitude(); // Typically 1 b/c plane normal is normalized in constructor.
    // Divide all four equation points by magnitude.
    return Object.values(this.equation)
  }

  static normalFromPoints(a, b, c, outPoint) {
    outPoint ??= new CONFIG.GeometryLib.threeD.Point3d();
    const vAB = b.subtract(a, tmpPt3d0);
    const vAC = c.subtract(a, tmpPt3d1);
    return vAC.cross(vAB, outPoint); // So the orientation matches.
  }

  /**
   * Construct plane from set of 3 points that lie on the plane.
   * Constructed such that the plane faces the direction of the normal vector.
   * I.e., whichSide returns a value > 0 (CCW) for points a - b - c - d where d is on the facing side.
   * and the normal also faces d.
   * @param {Point3d} a           Points arranged counterclockwise from view of a point facing the plane.
   * @param {Point3d} b
   * @param {Point3d} c
   * @returns {Plane}
   */
  static fromPoints(a, b, c) {
    a = a.clone();
    b = b.clone();
    c = c.clone();
    const N = this.normalFromPoints(a, b, c);
    const plane = new Plane(a, N);
    plane._threePoints = {a, b, c};
    return plane;
  }

  static fromMultiplePoints(pts) {
    const pointsAreCollinear = CONFIG.GeometryLib.utils.pointsAreCollinear;
    const iter = Iterator.from(pts);
    const a = iter.next().value;

    // Ensure no duplicates or collinearity
    let b = null;
    for (const point of iter) {
      if (!point.almostEqual(a)) {
        b = point;
        break;
      }
    }

    let c = null;
    for (const point of iter) {
      if (!point.almostEqual(a) && !point.almostEqual(b) && !pointsAreCollinear(a, b, point)) {
        c = point;
        break;
      }
    }
    if (!c) {
      console.error("Insufficient number of points to calculate plane.", pts);
      return new this();
    }

    return this.fromPoints(a, b, c);
  }


  /**
   * Construct a plane from a wall
   * @param {Wall} wall
   * @returns {Plane}
   */
  static fromWall(wall) {
    const pts = CONFIG.GeometryLib.threeD.Point3d.fromWall(wall, { finite: true }); // Need finite so Normal can be calculated

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
    const v1Mag = v1.magnitude();
    const v2Mag = v2.magnitude();
    if ( !v1Mag || !v2Mag ) return 0;
    return Math.acos(v1.dot(v2) / (v1Mag * v2Mag));
  }

  static angleBetweenSegments(a, b, c, d) {
    const V1 = b.subtract(a, tmpPt3d0);
    const V2 = d.subtract(c, tmpPt3d1);
    const magV1 = V1.magnitude();
    const magV2 = V2.magnitude();
    const mag = magV1 * magV2;
    if (!mag) return 0;

    return Math.acos(V1.dot(V2) / mag);
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

  /** @type {Point3d[3]} */
  get threePoints() {
    return this._threePoints || (this._threePoints = this._findThreePoints());
  }

  _findThreePoints() {
    const { u, v } = this.axisVectors;
    const p0 = this.point;
    return { a: p0, b: p0.add(u), c: p0.add(v) };
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
   * Distance from a point to the plane
   * @param {Point3d} a
   * @returns {number}
   */
  distanceToPoint(a) {
    const { normal, point } = this;
    return normal.dot(a.subtract(point, tmpPt3d0));
  }

  /**
   * Möller-Trumbore intersection algorithm for a triangle.
   * ChatGPT assist
   * This function first calculates the edge vectors of the triangle and the determinant
   * of the triangle using the cross product and dot product. It then uses the Möller–Trumbore
   * intersection algorithm to calculate the intersection point using barycentric coordinates,
   * and checks if the intersection point is within the bounds of the triangle. If it is,
   * the function returns the distance from ray origin to point of intersection.
   * If the ray is parallel to the triangle or the intersection point is outside of the triangle,
   * the function returns null.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {Point3d} v0            First vertex of the triangle
   * @param {Point3d} v1            Second vertex of the triangle, CCW
   * @param {Point3d} v2            Third vertex of the triangle, CCW
   * @returns {number} Distance from ray origin to the point of intersection.
   *
   */
  static rayIntersectionTriangle3d(rayOrigin, rayDirection, v0, v1, v2) {
    // Calculate the edge vectors of the triangle
    const edge1 = v1.subtract(v0, tmpPt3d0);
    const edge2 = v2.subtract(v0, tmpPt3d1);

    // Calculate the determinant of the triangle
    const pvec = rayDirection.cross(edge2, tmpPt3d2);

    // If the determinant is near zero, ray lies in plane of triangle
    const det = edge1.dot(pvec);
    if (det > -Number.EPSILON && det < Number.EPSILON) return null;  // Ray is parallel to triangle
    const invDet = 1 / det;

    // Calculate the intersection point using barycentric coordinates
    const tvec = rayOrigin.subtract(v0, tmpPt3d3);
    const u = invDet * tvec.dot(pvec);
    if (u < 0 || u > 1) return null;  // Intersection point is outside of triangle

    const qvec = tvec.cross(edge1, edge1);
    const v = invDet * rayDirection.dot(qvec);
    if (v < 0 || u + v > 1) return null;  // Intersection point is outside of triangle

    // Calculate the distance to the intersection point
    const t = invDet * edge2.dot(qvec);
    return t > Number.EPSILON ? t : null;
  }

  /**
   * Triangulate polygon
   * This can be done using a variety of algorithms, such as ear clipping or Delaunay triangulation
   * For the sake of simplicity, we will just split the polygon into triangles using a simple fan triangulation
   */
  static polygon3dToTriangles3d(vertices) {
    const ln = vertices.length;
    const triangles = [ln - 2];
    for ( let i = 2, j = 0; i < ln; i += 1, j += 1 ) {
      triangles[j] = [vertices[0], vertices[i - 1], vertices[i]];
    }
    return triangles;
  }

  /**
   * Möller-Trumbore intersection algorithm for a polygon.
   * ChatGPT assist
   * For a set of polygon points in counter-clockwise direction, check for intersection.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {Point3d[]} vertices
   * @returns {number} The distance from the ray origin to the intersection point.
   */
  static rayIntersectionPolygon3d(rayOrigin, rayDirection, vertices) {
    const triangles = Plane.polygon3dToTriangles3d(vertices);

    // Test for intersection with each triangle
    const ln = triangles.length;
    for ( let i = 0; i < ln; i += 1 ) {
      const tri = triangles[i];
      const t = Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri[0], tri[1], tri[2]);
      if ( t ) return t;

      // Alternatively, could store the minimum t value among the various triangles and
      // return it. Should be roughly equivalent to this version, b/c the triangles share a plane
      // and there should be only 1 intersection point on that plane.
    }

    return null;
  }

  /**
   * Intersection of a ray with this plane.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @returns {number|null} Distance to the intersection along the ray, or null if none.
   *   Note: if negative, the intersection lies behind the ray origin (and thus may not be an intersection)
   */
  rayIntersection(rayOrigin, rayDirection) {
    const { normal, point } = this;

    const denom = normal.dot(rayDirection);

    // Check if the ray is parallel to the plane (denom is close to 0)
    if ( Math.abs(denom) < Number.EPSILON ) return null;

    // Calculate the distance along the ray
    return normal.dot(point.subtract(rayOrigin)) / denom;
  }

  /**
   * Möller-Trumbore intersection algorithm for a quad.
   * Test the two triangles of the quad.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {Point3d} v0
   * @param {Point3d} v1
   * @param {Point3d} v2
   * @param {Point3d} v3
   */
  static rayIntersectionQuad3d(rayOrigin, rayDirection, v0, v1, v2, v3) {
    // Triangles are 0 - 1 - 2 and 1-2-3

    return Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, v0, v1, v2)
      ?? Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, v1, v2, v3);
  }

  /**
   * Lagae-Dutré intersection algorithm for a quad
   * https://graphics.cs.kuleuven.be/publications/LD04ERQIT/LD04ERQIT_paper.pdf
   * Appears a bit faster than doing rayIntersectionTriangle3d twice, but depends on setup.
   * Usually does equal or better.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {Point3d} v0
   * @param {Point3d} v1
   * @param {Point3d} v2
   * @param {Point3d} v3
   * @returns {number|null}  Null if no intersection. If negative, the intersection is behind the ray origin.
   */
  static rayIntersectionQuad3dLD(rayOrigin, rayDirection, v0, v1, v2, v3) {
    // Reject rays using the barycentric coordinates of the intersection point with respect to T
    const E01 = v1.subtract(v0, tmpPt3d0);
    const E03 = v3.subtract(v0, tmpPt3d1);
    const P = rayDirection.cross(E03, tmpPt3d2);
    const det = E01.dot(P);
    if ( Math.abs(det) < Number.EPSILON ) return null;

    const T = rayOrigin.subtract(v0, tmpPt3d3);
    const alpha = T.dot(P) / det;
    if ( alpha < 0 ) return null;
    if ( alpha > 1 ) return null;

    const Q = T.cross(E01, E01);
    const beta = rayDirection.dot(Q) / det;
    if ( beta < 0 ) return null;
    if ( beta > 1 ) return null;

    // Done with E01 (tmpPt3d0), P (tmpPt3d2), T (tmpPt3d3).

    // Reject rays using the barycentric coordinates of the intersection point with respect to T'
    if ( (alpha + beta) > 1 ) {
      const E23 = v3.subtract(v2, tmpPt3d0);
      const E21 = v1.subtract(v2, tmpPt3d2);
      const Pprime = rayDirection.cross(E21, E21);
      const detprime = E23.dot(Pprime);
      if ( Math.abs(detprime) < Number.EPSILON ) return null;

      const Tprime = rayOrigin.subtract(v2, tmpPt3d3);
      const alphaprime = Tprime.dot(Pprime) / detprime;
      if ( alphaprime < 0 ) return null;
      const Qprime = Tprime.cross(E23, E23);
      const betaprime = rayDirection.dot(Qprime) / detprime;
      if ( betaprime < 0 ) return null;
    }

    // Compute the ray parameter of the intersection point
    return E03.dot(Q) / det;
    // if ( t < 0 ) return null;

    // If barycentric coordinates of the intersection point are needed, this would be done here.
    // See the original Lagae-Dutré paper.
    // For current purposes, the estimated point using the ray is likely sufficient.
  }

  /**
   * Cache the function used to calculate the numerator for to2d().
   * See this.denom2d
   * @type {Function}
   */
  get numeratorFn2d() {
    if ( typeof this._numeratorFn2d === "undefined" ) { const denom = this.denom2d; } // eslint-disable-line no-unused-vars
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
    const V = p.subtract(this.point, tmpPt3d0);
    return this.normal.dot(V);
  }

  isPointOnPlane(p) {
    // https://math.stackexchange.com/questions/684141/check-if-a-point-is-on-a-plane-minimize-the-use-of-multiplications-and-divisio
    const vs = this.axisVectors;
    const a = this.point;
    const b = this.point.add(vs.v, tmpPt3d0);
    const c = this.point.add(vs.u, tmpPt3d1);

    const m = new CONFIG.GeometryLib.MatrixFlat([
      a.x, b.x, c.x, p.x,
      a.y, b.y, c.y, p.y,
      a.z, b.z, c.z, p.z,
      1,   1,   1,   1,
    ], 4, 4);

    return m.determinant().almostEqual(0);
  }


  /**
   * Calculate axis vectors for the plane.
   * @returns {object} {u: Point3d, v: Point3d} Two vectors on the plane, normalized
   */
  _calculateAxisVectors() {
    // https://math.stackexchange.com/questions/64430/find-extra-arbitrary-two-points-for-a-plane-given-the-normal-and-a-point-that-l
    // Find the minimum index
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const n = this.normal;
    const w = Point3d.tmp;
    n.x === 0 ? w.set(1, 0, 0)
      : n.y === 0 ? w.set(0, 1, 0)
        : n.z === 0 ? w.set(0, 0, 1)
          : (n.x < n.y && n.x < n.z) ? w.set(1, 0, 0)
            : n.y < n.z ? w.set(0, 1, 0)
              : w.set(0, 0, 1);

    const u = new Point3d();
    const v = new Point3d();
    w.cross(n, u).normalize(u);
    n.cross(u, v).normalize(v);
    w.release();
    return { v: u, u: v }; // Swap so the x-axis is first.
  }

  /**
   * Convert a 3d point on the plane to 2d
   * https://math.stackexchange.com/questions/3528493/convert-3d-point-onto-a-2d-coordinate-plane-of-any-angle-and-location-within-the
   * More numerically stable than _calculateConversion2dMatrix
   */
  to2d(pt) {
    const denom = this.denom2d;
    const { numU, numV } = (this.numeratorFn2d).call(this, pt);

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

    return new CONFIG.GeometryLib.threeD.Point3d(
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

    const u = P.add(vs.u, tmpPt3d0);
    const v = P.subtract(vs.v, tmpPt3d1);
    const A = P;
    const n = P.add(N, tmpPt3d2);

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

    const S = new CONFIG.GeometryLib.MatrixFlat([
      A.x, A.y, A.z, 1,
      u.x, u.y, u.z, 1,
      v.x, v.y, v.z, 1,
      n.x, n.y, n.z, 1
    ], 4, 4);

    const D = new CONFIG.GeometryLib.MatrixFlat([
      0, 0, 0, 1,
      1, 0, 0, 1,
      0, 1, 0, 1,
      0, 0, 1, 1
    ], 4, 4);

    const Sinv = S.invert();
    return Sinv.multiply4x4(D);
  }

  /**
   * Intersection point between ray and the plane
   * @param {Point3d} v  Point (or vertex) on the ray, representing 1 unit of movement along the ray
   * @param {Point3d} l  Origin of the ray.
   * @returns {Point3d|null}
   */
  rayIntersectionEisemann(v, l) {
    // Eisemann, Real-Time Shadows, p. 24 (Projection Matrix for Planar Shadows)

    const { normal: N, point: P } = this;

    const dotNV = N.dot(v);
    const dotNL = N.dot(l);
    // Right-handed system: const denom = dotNL - dotNV;
    const denom = dotNV - dotNL;

    if ( denom.almostEqual(0) ) return null;

    const d = N.dot(P);

    const outPoint = new CONFIG.GeometryLib.threeD.Point3d();

    v.multiplyScalar(dotNL + d, outPoint);
    const b = l.multiplyScalar(dotNV + d);

    outPoint.subtract(b, outPoint);
    outPoint.multiplyScalar(1 / denom, outPoint);

    return outPoint;
  }

  /**
   * Line, defined by a point and a vector
   * https://www.wikiwand.com/en/Line%E2%80%93plane_intersection
   * @param {Point3d} l0  point
   * @param {Point3d} l   vector
   * @returns {Point3d|null}
   */
  lineIntersection(l0, l) {
    const N = this.normal;
    const P = this.point;

    const dot = N.dot(l);

    // Test if line and plane are parallel and do not intersect.
    if ( dot.almostEqual(0) ) return null;

    const w = l0.subtract(P, tmpPt3d0);
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

    /* Or
    v0 = p0.subtract(this.point)
    v1 = p1.subtract(p0);

    t = -this.normal.dot(v0) / (this.normal.dot(v1))
    // If this.normal.dot(v1) === 0, line is parallel to the plane.

    */
  }

  /**
   * Test whether a line segment intersects a plane
   * @param {Point3d} a   First point of the segment
   * @param {Point3d} b   Second point of the segment
   * @returns {boolean}
   */
  lineSegmentIntersects(a, b) {
    // Endpoints a and b must be on opposite sides of the plane.
    return this.whichSide(a) * this.whichSide(b) <= 0; // If 0, point is on the plane.
  }

  /**
   * Is this plane parallel to another?
   * @param {Plane} other   Other plane to intersect
   * @returns {boolean} True if parallel
   */
  isParallelToPlane(other) {
    const N1 = this.normal;
    const N2 = other.normal;

    // Cross product of the two normals is the direction of the line.
    const direction = N1.cross(N2);

    // Parallel planes have a cross product with zero magnitude
    return Boolean(!direction.magnitudeSquared())
  }

  /**
   * Intersect this plane with another
   * Algorithm taken from http://geomalgorithms.com/a05-_intersect-1.html. See the
   * section 'Intersection of 2 Planes' and specifically the subsection
   * (A) Direct Linear Equation
   * @param {Plane} other   Other plane to intersect
   * @returns {object|null} { point: Point3d, direction: Point3d } The resulting line or null if planes are parallel.
   *   The line is returned as point, direction
   */
  intersectPlane(other) {
    const N1 = this.normal;
    const N2 = other.normal;

    // Cross product of the two normals is the direction of the line.
    const direction = N1.cross(N2, tmpPt3d3);

    // Parallel planes have a cross product with zero magnitude
    if ( !direction.magnitudeSquared() ) return null;

    // Find shared point on the line of intersection between the two planes.
    // Project the origin (0,0,0) and the normal of the second plane onto the first plane (plane1).
    // This defines a line within plane1.
    const projectedOrigin = this.projectPointOnPlane(originPt3d, tmpPt3d1); // tmpPt3d0 used by projectPointOnPlane
    const projectedN2 = this.projectPointOnPlane(other.normal, tmpPt3d2);

    // The direction vector of the line in plane1.
    const lineDirection = projectedN2.subtract(projectedOrigin, projectedN2);

    // Now we find the intersection of this line with the second plane (plane2).
    // A line is defined by L(t) = startPoint + t * direction
    // A plane is defined by n . (x - p) = 0
    // Substitute x with L(t) to solve for t.
    // n2 . (projectedOrigin + t * lineDirection - p2) = 0
    // n2 . (projectedOrigin - p2) + t * (n2 . lineDirection) = 0
    // t = - (n2 . (projectedOrigin - p2)) / (n2 . lineDirection)
    const denominator = other.normal.dot(lineDirection);

    // If the denominator is close to zero, the line is parallel to the plane.
    // This happens if the planes are parallel.
    // Can skip b/c we checked for parallel planes above.
    /*
    if ( Math.abs(denominator) < 1e-06 ) {
      const dist = this.normal.dot(other.point.subtract(this.point));
      if ( Math.abs(dist) < 1e-06 ) return this.point; // The planes are coincident, any point on plane1 is a shared point.
      return null; // Planes are parallel and distinct.
    }
    */
    const numerator = other.normal.dot(projectedOrigin.subtract(other.point, tmpPt3d0));
    const t = -numerator / denominator;
    const ix = new CONFIG.GeometryLib.threeD.Point3d();
    projectedOrigin.add(lineDirection.multiplyScalar(t, ix), ix);
    return { point: ix, direction };
  }

  /**
   * Projects a point onto the plane.
   * @param {Point3d} pt           Point to project
   * @returns {Point3d} The projected point
   */
  projectPointOnPlane(pt, outPoint) {
    outPoint ??= new CONFIG.GeometryLib.threeD.Point3d();
    const v = pt.subtract(this.point, tmpPt3d0);
    const dist = v.dot(this.normal);
    const vScaled = this.normal.multiplyScalar(dist, tmpPt3d0);
    pt.subtract(vScaled, outPoint);
    return outPoint;
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
    numU: ((pt.x - point.x) * v.y) - ((pt.y - point.y) * v.x),
    numV: ((pt.y - point.y) * u.x) - ((pt.x - point.x) * u.y)
  };
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
    numU: ((pt.x - point.x) * v.z) - ((pt.z - point.z) * v.x),
    numV: ((pt.z - point.z) * u.x) - ((pt.x - point.x) * u.z)
  };
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
    numU: ((pt.y - point.y) * v.z) - ((pt.z - point.z) * v.y),
    numV: ((pt.z - point.z) * u.y) - ((pt.y - point.y) * u.z)
  };
}

GEOMETRY_CONFIG.threeD.Plane = Plane;