/* globals

*/
"use strict";

import { Point3d } from "./Point3d.js";
import { Matrix } from "./Matrix.js";
import { lineSegment3dPlaneIntersects } from "../util.js";

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

  isPointOnPlane(p) {
    // https://math.stackexchange.com/questions/684141/check-if-a-point-is-on-a-plane-minimize-the-use-of-multiplications-and-divisio
    const vs = this.getVectorsOnPlane();
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
   * Get vectors on the plane.
   * @param {number} x    X coordinate on the plane.
   * @param {number} y    Y coordinate on the plane.
   * @returns {object} {u: Point3d, v: Point3d} Two vectors on the plane, normalized
   */
  getVectorsOnPlane() {
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
   * Calculate the rotation matrix to shift points on the plane to a 2d version.
   * @returns {Matrix} 4x4 rotation matrix
   */
  calculate2dRotationMatrix() {
    const n = this.normal;
    const p0 = this.point;
    const vs = this.getVectorsOnPlane();
    const u = vs.u;
    const v = vs.v;

    // Translate such that 0,0,0 in world is the pl.point
    return new Matrix([
      [u.x, u.y, u.z, 0], // X-axis
      [v.x, v.y, v.z, 0], // Y-axis
      [n.x, n.y, n.z, 0], // Z-axis
      [p0.x, p0.y, p0.z, 1] // Translation
    ]);
  }

  /**
   * Line, defined by a point and a vector
   * https://www.wikiwand.com/en/Line%E2%80%93plane_intersection
   * @param {Point3d} vector
   * @param {Point3d} l0
   * @returns {Point3d|null}
   */
  lineIntersection(l0, l) {
    const p_no = this.normal;
    const p_co = this.point;

    const dot = p_no.dot(l);

    // Test if line and plane are parallel and do not intersect.
    if ( dot.almostEqual(0) ) return null;

    const w = l0.subtract(p_co);
    const fac = -p_no.dot(w) / dot;
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
    const vs = this.getVectorsOnPlane();
    const p0 = this.point;
    return lineSegment3dPlaneIntersects(a, b, p0, p0.add(vs.u), p0.add(vs.v));
  }

}
