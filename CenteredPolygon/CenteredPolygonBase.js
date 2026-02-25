/* globals
PIXI,
*/
"use strict";

/**
 * Base class to be extended by others.
 * Follows the approach of Drawing and RegularPolygon class.
 * Polygon has a set of points centered around origin 0, 0.
 * Polygon is treated as closed.
 */
export class CenteredPolygonBase extends PIXI.Polygon {

  static [Symbol.hasInstance](instance) {
    return instance && instance.constructor && instance.constructor._geoLibType === this._geoLibType;
  }

  static get _geoLibType() { return this.name; }

  /** @type {PIXI.Point} */
  origin = new PIXI.Point();

  /** @type {Point[]} */
  _fixedPoints;

  /** @type {number[]} */
  _points;

  /** @type {boolean} */
  _isClosed = true;

  /** @type {boolean} */
  _isClockwise = true;

  /**
   * @param {Point} origin    Center point of the polygon.
   * @param {object} [options] Options that affect the polygon shape
   * @param {number} [options.rotation]  Rotation, in degrees, from a starting point due east
   */
  constructor(origin, { rotation = 0 }) {
    super([]);

    this.origin.copyFrom(origin);
    if ( rotation ) this.rotation = rotation;
  }

  /** @type {number} */
  #rotation = 0;

  #radians = 0;

  get rotation() { return this.#rotation; }

  set rotation(value) {
    this.#rotation = Math.normalizeDegrees(value);
    this.#radians = Math.toRadians(this.#rotation);
  }

  get radians() { return this.#radians; }

  set radians(value) {
    this.#radians = Math.normalizeRadians(value);
    this.#rotation = Math.toDegrees(value);
  }

  // Getters/setters for x and y for backwards compatibility.

  /** @type {number} */
  get x() { return this.origin.x; }

  set x(value) { this.origin.x = value; }

  /** @type {number} */

  get y() { return this.origin.y; }

  set y(value) { this.origin.y = value; }


  get center() { return { x: this.x, y: this.y }; }

  get points() { return this._points || (this._points = this._generatePoints()); }

  set points(value) { }

  get fixedPoints() { return this._fixedPoints || (this._fixedPoints = this._generateFixedPoints()); }

  /**
   * For compatibility with Ellipse.
   * Convert this shape to a PIXI.Polygon
   * @returns {PIXI.Polygon}
   */
  toPolygon() { return this; }

  /**
   * Shift this polygon to a new position.
   * @param {number} dx   Change in x position
   * @param {number} dy   Change in y position
   * @returns {CenteredPolygonBase}    New polygon
   */
  translate(dx, dy) {
    const txOrigin = this.origin.add({x: dx, y: dy});
    return new this.constructor(txOrigin, { rotation: this.rotation });
  }

  /**
   * Placeholder for child classes.
   * @return {Points[]}
   */
  _generateFixedPoints() {
    return this._fixedPoints;
  }

  /**
   * Generate the points that represent this shape as a polygon in Cartesian space.
   * @return {Points[]}
   */
  _generatePoints() {
    return PIXI.Point.flatMapPoints(this.fixedPoints, pt => this.toCartesianCoords(pt));
  }

  /**
   * Generate the bounding box (in Cartesian coordinates)
   * @returns {PIXI.Rectangle}
   */
  getBounds() {
    // Find the min and max x,y points
    const pts = this.points;
    const ln = pts.length;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for ( let i = 0; i < ln; i += 2 ) {
      const x = pts[i];
      const y = pts[i + 1];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    return new PIXI.Rectangle(minX, minY, maxX - minX, maxY - minY);
  }

  /**
   * Shift from cartesian coordinates to the shape space.
   * @param {PIXI.Point} a
   * @param {PIXI.Point} [outPoint] A point-like object to store the result.
   * @returns {PIXI.Point}
   */
  fromCartesianCoords(a, outPoint) {
    outPoint ??= new PIXI.Point;
    a.add(-this.x, -this.y, outPoint)
    PIXI.Point.rotate(outPoint, -this.radians, outPoint);
    return outPoint;
  }

  /**
   * Shift to cartesian coordinates from the shape space.
   * @param {Point} a
   * @param {PIXI.Point} [outPoint] A point-like object to store the result.
   * @returns {Point}
   */
  toCartesianCoords(a, outPoint) {
    outPoint ??= new PIXI.Point;
    PIXI.Point.rotate(pt, this.radians, outPoint);
    outPoint.add(this.x, this.y, outPoint);
    return outPoint;
  }
}
