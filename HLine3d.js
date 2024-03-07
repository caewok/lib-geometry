/* globals
PIXI,
foundry
*/
"use strict";

// See Nordberg, Introduction to Representations and Estimation in Geometry
// https://www.diva-portal.org/smash/get/diva2:1136229/FULLTEXT03.pdf

import { HPoint3d } from "./HPoint3d.js";
import { Matrix } from "./Matrix.js";

// Homogenous 3d Line class.
// Represented using Plucker coordinates.

export class HLine3d extends Matrix {
  /** @type {HPoint3d} */
  A;

  /** @type {HPoint3d} */
  B;

  /**
   * Construct the line from two homogenous 3d points.
   * Points A and B are stored for convenience.
   * @param {HPoint3d} A
   * @param {HPoint3d} B
   * @returns {HLine3d}
   */
  static fromPoints(A, B) {
    const matA = A.toMatrix();
    const matAt = matA.transpose();
    const matB = B.toMatrix();
    const matBt = matB.transpose();
    const res1 = matBt.multiply(matA);
    const res2 = matAt.multiply(matB);
    const out = new this(res1.subtract(res2).arr);
    out.A = A;
    out.B = B;
    return out;
  }

  /**
   * Construct the line from homogenous coordinates of the intersection of two planes.
   * Technically this creates dual Plücker coordinates that are converted to Plücker coordinates here.
   * @param {HPlane} P0
   * @param {HPlane} P1
   * @returns {HLine3d}
   */
  static fromPlanes(P0, P1) {
    const matP0 = P0.toMatrix();
    const matP0t = matP0.transpose();
    const matP1 = P1.toMatrix();
    const matP1t = matP1.transpose()
    const res1 = matP1t.multiply(matP0);
    const res2 = matP0t.multiply(matP1);
    const Ldual = res1.subtract(res2);
    return new this(this._dualToSinglePlucker(Ldual).arr);
  }

  /**
   * Convert dual Plücker coordinates to Plücker coordinates.
   * @param {Matrix} mat
   * @returns {Matrix}
   */
  static _dualToSinglePlucker(mat) {
    // See Nordberg §§ 5.26, 5.27
    const m0 = mat[0];
    const a = mat[2][3];
    const b = mat[3][1];
    const c = -mat[2][1];
    const d = m0[3];
    const e = -m0[2];
    const f = m0[1];

    return new Matrix([
      [ 0,  a,  b,  c],
      [-a,  0,  d,  e],
      [-b, -d,  0,  f],
      [-c, -e, -f,  0]
    ]);
  }

  /**
   * Convert single Plücker coordinates to dual
   * @param {Matrix} mat
   * @returns {Matrix}
   */
  static _singleToDualPlucker(mat) {
    // See Nordberg §§ 5.26, 5.27
    const m0 = mat[0];
    const a = m0[1];
    const b = m0[2];
    const c = m0[3];
    const d = mat[1][2];
    const e = mat[1][3];
    const f = mat[2][3];
    return new Matrix([
      [ 0,  f, -e,  d],
      [-f,  0,  c, -b],
      [ e, -c,  0,  a],
      [-d,  b, -a,  0]
    ]);
  }

  /**
   * Line normalization.
   * See Nordberg § 5.3.3
   * @returns {Matrix}
   */
  norm() {
    const d = Math.hypot(this.arr[3][0], this.arr[3][1], this.arr[3][2]);
    return this.multiplyScalar(1/d);
  }

  /**
   * Calculate the point on the line closest to the origin.
   * @returns {HPoint3d}
   */
  closestPointToOrigin() {
    const norm = this.norm();
    const t = new Matrix([norm.arr[0][3], norm.arr[1][3], norm.arr[2][3]]);
    //const t = new Matrix([[norm.arr[0][3], norm.arr[1][3], norm.arr[2][3]]])

    // Pull the 3x3 top left.
    const A = new Matrix([
      norm.arr[0].slice(0,3),
      norm.arr[1].slice(0,3),
      norm.arr[2].slice(0,3)
    ]);

    const ptArr = t.multiply(A);
    return HPoint3d.create(ptArr[0], ptArr[1], ptArr[2]);
  }

  /**
   * Vector that shows how the line changes in the x, y, and z directions.
   * @returns {HPoint3d}
   */
  tangentVector() {
    const ptArr = this.arr[3];
    const d = Math.hypot(ptArr[0], ptArr[1], ptArr[2]);
    const dInv = -1/d;
    return HPoint3d.create(ptArr[0] * dInv, ptArr[1] * dInv , ptArr[2] * dInv);
  }

  /**
   * Intersection of a homogenous line with this plane.
   * @param {HPlane} plane
   * @returns {HPoint3d
   */
  planeIntersection(plane) {
    return this.toMatrix().multiply(plane);
  }

  /**
   * Distance from a point to this line.
   * @param {HPoint3d} pt
   * @returns {number}
   */
  distanceToPoint(pt) {
    const normDL = HLine3d._singleToDualPlucker(this);
    const normP = pt.norm();
    const vec = normDL.multiply(normP);
    return Math.hypot(vec[0], vec[1], vec[2]);
  }
}

/*
w1 = canvas.walls.controlled[0];

A = HPoint3d.create(w1.A.x, w1.A.y, 200)
B = HPoint3d.create(w1.B.x, w1.B.y, 200)
l3d = HLine3d.fromPoints(A, B)

l3d.norm()

l3d.tangentVector()
l3d.closestPointToOrigin()
*/