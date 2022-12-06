/* globals
PIXI
*/
"use strict";

/**
 * Base class to be extended by others.
 * Follows the approach of Drawing and RegularPolygon class.
 * Polygon has a set of points centered around origin 0, 0.
 * Polygon is treated as closed.
 */
export class CenteredPolygonBase extends PIXI.Polygon {
  /** @type {number} */
  x = 0;

  /** @type {number} */
  y = 0;

  // TODO: Make rotation and radians getters, so they can be modified.
  /** @type {number} */
  rotation = 0;

  /** @type {number} */
  radians = 0;

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

    this.x = origin.x;
    this.y = origin.y;
    this.rotation = Math.normalizeDegrees(rotation);
    this.radians = Math.toRadians(this.rotation);
  }

  get center() { return { x: this.x, y: this.y }; }

  get points() { return this._points || (this._points = this._generatePoints()); }

  set points(value) { }

  get fixedPoints() { return this._fixedPoints || (this._fixedPoints = this._generateFixedPoints()); }

  /**
   * For compatibility with Ellipse.
   * Convert this shape to a Polygon
   */
  toPolygon() {
    return this;
  }

  /**
   * Shift this polygon to a new position.
   * @param {number} dx   Change in x position
   * @param {number} dy   Change in y position
   * @returns {CenteredPolygonBase}    This polygon
   */
  translate(dx, dy) {
    this.x = this.x + dx;
    this.y = this.y + dy;
    this._points = undefined;
    return this;
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

    a.translate(-this.x, -this.y, outPoint).rotate(-this.radians, outPoint);
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

    a.rotate(this.radians, outPoint).translate(this.x, this.y, outPoint);
    return outPoint;
  }
}
