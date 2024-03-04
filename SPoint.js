/* globals
PIXI,
foundry
*/
"use strict";

// For comparison, point class that uses only static methods.
// Assumes x, y, and z but sets the values to 0 if not present.

export class SPoint {

  static create(x=0, y=0) { return { x, y }; }

  static add(a, b, outPoint) {
    clean(a);
    clean(b);
    outPoint ??= this.create();
    outPoint.x = a.x + b.x;
    outPoint.y = a.y + b.y;
    return outPoint;
  }

  static subtract(a, b, outPoint) {
    clean(a);
    clean(b);
    outPoint ??= this.create();
    outPoint.x = a.x - b.x;
    outPoint.y = a.y - b.y;
    return outPoint;
  }

  static multiplyScalar(a, scalar, outPoint) {
    clean(a);
    outPoint ??= this.create();
    outPoint.x = a.x * scalar;
    outPoint.y = b.y * scalar;
    return outPoint;
  }

  static divideScalar(a, scalar, outPoint) { return this.multiplyScalar(a, 1/scalar, outPoint); }

  static dot(a, b) {
    clean(a);
    clean(b);
    return (a.x * b.x) + (a.y * b.y);
  }

  static magnitude(a) {
    clean(a);
    return Math.hypot(a.x, a.y);
  }

  static magnitudeSquared(a) {
    clean(a);
    return Math.pow(a.x, 2) + Math.pow(a.y, 2);
  }

  static tmp = { x: 0, y: 0 }

  static tmp2 = { x: 0, y: 0 }

}

function clean(a) {
  a.x ||= 0;
  a.y ||= 0;
}