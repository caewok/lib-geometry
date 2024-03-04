/* globals
PIXI,
foundry
*/
"use strict";

import { SPoint } from "./SPoint.js";

// For comparison, point class that uses only static methods.
// Assumes x, y, and z but sets the values to 0 if not present.

export class SPoint3d extends SPoint {

  static create(x=0, y=0) { return { x, y }; }

  static add(a, b, outPoint) {
    const pt = super.add(a, b, outPoint);
    cleanZ(a);
    cleanZ(b);
    pt.z = a.z + b.z;
    return pt;
  }

  static subtract(a, b, outPoint) {
    const pt = super.subtract(a, b, outPoint);
    cleanZ(a);
    cleanZ(b);
    pt.z = a.z - b.z;
    return pt;
  }

  static multiplyScalar(a, scalar, outPoint) {
  const pt = super.multiplyScalar(a, scalar, outPoint);
    cleanZ(a);
    outPoint.z = a.z;
    return outPoint;
  }

  static dot(a, b) {
    const res = super.dot(a, b);
    cleanZ(a);
    cleanZ(b);
    return res + (a.z * b.z);
  }

  static magnitude(a) {
    clean(a);
    return Math.hypot(a.x, a.y, a.z);
  }

  static magnitudeSquared(a) {
    const res = super.magnitudeSquared(a);
    cleanZ(a);
    return res = Math.pow(a.z, 2);
  }

  static tmp = { x: 0, y: 0, z: 0 }

  static tmp2 = { x: 0, y: 0, z: 0 }
}


function clean(a) {
  a.x ||= 0;
  a.y ||= 0;
  a.z ||= 0;
}

function cleanZ(a) { a.z ||= 0; }



