/* globals
PIXI,
foundry
*/
"use strict";

import { HPoint3d } from "./HPoint3d.js";

// Homogenous Line class.
// Dual homogenous representation.

export class HPlane extends HPoint3d {

  /**
   * Dual homogenous representation of a plane.
   * @param {HPoint3d|Point3d} normal     Normal vector of the plane
   * @param {number} delta                Distance from origin to the plane
   * @returns {HPlane}
   */
  static create(normal, delta) {
    return super.create(normal.x, normal.y, normal.z, -delta)
  }

  /**
   * Dual homogenous representation of a plane from two lines.
   * @param {HLine} l0
   * @param {HLine} l1
   * @returns {HPlane}
   */
  static createFromLines(l0, l1) {
    const normal = l0.cross(l1);
    const delta = normal.magnitude();
    return this.create(normal, delta);
  }

  /**
   * Plane that intersects a line and a point.
   * @param {HLine} l
   * @param {HPoint3d} pt
   * @returns {HPlane}
   */
  static createFromLineAndPoint(l, pt) {
    return HLine._singleToDualPlucker(l).multiply(pt.toMatrix());
  }

  /**
   * Plane that intersects three points.
   * @param {HPoint3d} a
   * @param {HPoint3d} b
   * @param {HPoint3d} c
   * @returns {HPlane}
   */
  static createFromPoints(a, b, c) {
    const l = HLine3d.fromPoints(a, b);
    return HLine3d._singleToDualPlucker(l).multiply(c.toMatrix());
  }

  /**
   * Test if a point is on the plane.
   * @param {HPoint3d} pt
   * @returns {boolean}
   */
  static pointOnPlane(pt) { return this.dot(pt) === 0; }

  /**
   * Intersect a line with this plane.
   * @param {HLine3d} l
   * @returns {HPoint3d}
   */
  lineIntersection(l) {
    return l.toMatrix().multiply(this);
  }

  /**
   * Orientation of a point to this plane. Nordberg § 5.5.2.
   * @param {HPoint3d} pt
   * @returns {number} Signed distance between the point and the plane.
   *   > 0: Point and origin on opposite sides of the plane
   *     0: Point lies on the plane
   *   < 0: Point and origin on the same side of the plane
   */
  signedDistanceFromPoint(pt) {
    return pt.norm(HPoint3d.tmp).dot(this.norm(HPoint3d.tmp2));
  }

  /**
   * Distance from a point to this plane. Nordberg § 5.5.2.
   * @param {HPoint3d} pt
   * @returns {number}
   */
  distanceFromPoint(pt) { return Math.abs(this.signedDistanceFromPoint(pt)); }

  /**
   * Whether two points lie on the same side of this plane.
   * @param {HPoint3d} a
   * @param {HPoint3d} b
   * @returns {number}
   *   < 0: Different sides of the line
   *     0: One or both points are collinear
   *   > 0: Same sides of the line
   */
  orientPoints(a, b) {
    // See signedDistanceFromPoint.
    const normD = this.norm(HPoint3d.tmp2);
    const oA = a.norm(HPoint3d.tmp).dot(normD);
    const oB = b.norm(HPoint3d.tmp).dot(normD);
    return oA * oB;
  }

  // TODO: Point that intersects three planes

  // TODO: Can return the parametric representation of the plane as a matrix
  // given an origin point and perpendicular vectors. Use that to convert 3d points to
  // 2d plane coordinates.
}