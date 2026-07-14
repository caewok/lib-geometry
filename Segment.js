/* globals
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */


// Simple wrapper to make it easy to create and dispose of segment points.
// Treat just like { a, b } but can use the using keyword. E.g., using segment = new Segment(a, b)
export class Segment {

  static [Symbol.hasInstance](instance) {
    return instance && instance.constructor && instance.constructor._geoLibType === this._geoLibType;
  }

  static get _geoLibType() { return this.name; }

  /** @type {PIXI.Point|Point3d} */
  a = null;

  /** @type {PIXI.Point|Point3d} */
  b = null;

  constructor(a, b) {
    this.a = a;
    this.b = b;
  }

  [Symbol.dispose]() {
    if ( this.a ) this.a[Symbol.dispose]();
    if ( this.b ) this.b[Symbol.dispose]();
    this.a = null;
    this.b = null;
  }

  /**
   * Difference between the two points.
   * @type {PIXI.Point|Point3d}
   */
  get delta() { return this.b.subtract(this.a); }

  /**
   * Center point
   * @type {PIXI.Point|Point3d}
   */
  get midpoint() {
    const ctr = this.a.constructor.tmp;
    return this.a.add(this.b, ctr).multiplyScalar(0.5, ctr);
  }

  /**
   * Length of the segment.
   * @type {number}
   */
  get length() {
    using d = this.delta;
    return d.magnitude();
  }

  /**
   * Length squared of the segment.
   * @type {number}
   */
  get lengthSquared() {
    using d = this.delta;
    return d.magnitudeSquared();
  }

  /**
   * Angle of the XY edge on the 2d canvas.
   * @type {number}
   */
  get angleXY() {
    using d = this.delta;
    return Math.atan2(d.y, d.x);
  }
}