/* globals
CONFIG,
PIXI,
*/
"use strict";

import { GEOMETRY_CONFIG } from "./const.js";

/* Testing
api = game.modules.get('tokenvisibility').api;
drawing = api.drawing

function rotatePoint(point, angle) {
  return {
    x: (point.x * Math.cos(angle)) - (point.y * Math.sin(angle)),
    y: (point.y * Math.cos(angle)) + (point.x * Math.sin(angle))
  };
}

function translatePoint(point, dx, dy) {
  return {
    x: point.x + dx,
    y: point.y + dy
  };
}

[d] = canvas.drawings.placeables

halfWidth = d.document.shape.width / 2;
halfHeight = d.document.shape.height / 2;
x = d.document.x + halfWidth;
y = d.document.y + halfHeight
rotation = d.document.rotation

e = new Ellipse(x, y, halfWidth, halfHeight, { rotation })
drawing.drawShape(e)

pts = [...e.toPolygon().iteratePoints()]
pts.forEach(pt => api.drawing.drawPoint(pt))

bounds = e.getBounds()
drawing.drawShape(bounds)
*/


/**
 * Ellipse class structured similarly to PIXI.Circle
 * - x, y center
 * - major, minor axes
 * - rotation
 */
export class Ellipse extends PIXI.Ellipse {
  /**
   * Default representation has the major axis horizontal (halfWidth), minor axis vertical (halfHeight)
   *
   * @param {Number}  x       Center of ellipse
   * @param {Number}  y       Center of ellipse
   * @param {Number}  halfWidth   Semi-major axis
   * @param {Number}  halfHeight   Semi-minor axis
   * Optional:
   * @param {Number}  rotation  Amount in degrees the ellipse is rotated
   */
  constructor(x, y, halfWidth, halfHeight, { rotation = 0 } = {}) {
    super(x, y, halfWidth, halfHeight);
    this.rotation = rotation;
  }

  clone() {
    const out = super.clone();
    out.rotation = this.rotation;
    return out;
  }

  // Link rotation and radians.
  #rotation = 0;

  #radians = 0;

  get rotation() { return this.#rotation; }

  set rotation(value) {
    this.#rotation = Math.normalizeDegrees(value);
    this.#radians = Math.toRadians(value);
  }

  get radians() { return this.#radians; }

  set radians(value) {
    this.#radians = Math.normalizeRadians(value);
    this.#rotation = Math.toDegrees(this.#radians);
  }

  /**
   * Construct an ellipse that mirrors that of a Drawing ellipse
   * @param {Drawing} drawing
   * @returns {Ellipse}
   */
  static fromDrawing(drawing) {
    const { x, y, rotation, shape } = drawing;
    const { width, height } = shape;

    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const centeredX = x + halfWidth;
    const centeredY = y + halfHeight;

    const out = new this(centeredX, centeredY, halfWidth, halfHeight, { rotation });
    return out;
  }

  /**
   * Shift from cartesian coordinates to the shape space.
   * @param {PIXI.Point} a
   * @param {PIXI.Point} [outPoint] A point-like object to store the result.
   * @returns {PIXI.Point}
   */
  _fromCartesianCoords(a, outPoint) {
    outPoint ??= new PIXI.Point();
    a = PIXI.Point.fromObject(a);
    a.translate(-this.x, -this.y, outPoint).rotate(-this.radians, outPoint);
    return outPoint;
  }

  /**
   * Shift to cartesian coordinates from the shape space.
   * @param {Point} a
   * @param {PIXI.Point} [outPoint] A point-like object to store the result.
   * @returns {Point}
   */
  _toCartesianCoords(a, outPoint) {
    outPoint ??= new PIXI.Point();
    a = PIXI.Point.fromObject(a);
    a.rotate(this.radians, outPoint).translate(this.x, this.y, outPoint);
    return outPoint;
  }

  /**
   * Bounding box of the ellipse
   * @return {PIXI.Rectangle}
   */
  getBounds() {
    if ( !this.rotation ) return super.getBounds();

    // Bounds rectangle measured from top left corner. x, y, width, height
    switch ( this.rotation ) {
      case 0:
      case 180:
        return new PIXI.Rectangle(this.x - this.width, this.y - this.height, this.width * 2, this.height * 2);

      case 90:
      case 270:
        return new PIXI.Rectangle(this.x - this.height, this.y - this.width, this.height * 2, this.width * 2);
    }

    // Default to bounding box of the radius circle
    const major = this.majorRadius;
    return new PIXI.Rectangle(this.x - major, this.y - major, major * 2, major * 2);
  }

  /**
   * Does this ellipse overlap something else?
   * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon|PIXI.Ellipse} other
   * @returns {boolean}
   */
  overlaps(other) {
    if ( other instanceof Ellipse ) return this._overlapsEllipse(other);
    if ( other instanceof PIXI.Circle ) return this._overlapsCircle(other);

    // Conversion to circle space may rotate the rectangle, so use polygon.
    if ( other instanceof PIXI.Rectangle ) return this._overlapsPolygon(other.toPolygon());
    if ( other instanceof PIXI.Polygon ) return this._overlapsPolygon(other);
    if ( other.toPolygon ) return this._overlapsPolygon(other.toPolygon());
    console.warn("overlaps|shape not recognized.", other);
    return false;
  }

  _overlapsEllipse(other) {
    // Simple test based on centers and shortest radius.
    const r2 = Math.pow(this.minorRadius + other.minorRadius, 2); // Sum the two minor axis radii.
    const d2 = PIXI.Point.distanceSquaredBetween(this.center, other.center);
    if ( d2 < r2 ) return true;

    // If aligned to an axis, use the quick test.
    // Check if the distance between the centers of the two ellipses
    // is less than the sum of their effective radii along the line
    // connecting their centers.
    const otherRot = other.rotation || 0; // In case other is a PIXI.Ellipse.
    if ( this.rotation % 90 === 0 && otherRot % 90 === 0 ) {
      // (x2 - x1)² / (a1 + a2)² + (y2 - y1)² / (b1 + b2)² <= 1
      const thisIsVertical = this.rotation === 90 || this.rotation === 270;
      const otherIsVertical = otherRot === 90 || otherRot === 270;
      const [thisWidth, thisHeight] = thisIsVertical ? [this.height, this.width] : [this.width, this.height];
      const [otherWidth, otherHeight] = otherIsVertical ? [other.height, other.width] : [other.width, other.height];
      return this.constructor.quickEllipsesOverlapTest(
        this.x, this.y, thisWidth, thisHeight,
        other.x, other.y, otherWidth, otherHeight
      );
    }

    // Convert to this ellipse's circle space and test circle-ellipse overlap.
    // Move to ellipse coordinates and then to circle coordinates.
    // Use the major-minor points to determine height and width of the converted ellipse.
    const otherCtr = PIXI.Point._tmp1.set(other.x, other.y);
    const otherV = otherCtr.fromAngle(other.radians, other.width, PIXI.Point._tmp2);
    const otherCV = otherCtr.fromAngle(other.radians + Math.PI_1_2, other.height, PIXI.Point._tmp3);

    const c = this._toCircleCoords(this._fromCartesianCoords(otherCtr));
    const v = this._toCircleCoords(this._fromCartesianCoords(otherV));
    const cv = this._toCircleCoords(this._fromCartesianCoords(otherCV));
    const w = PIXI.Point.distanceBetween(c, v);
    const h = PIXI.Point.distanceBetween(c, cv);
    const ellipse = new Ellipse(c.x, c.y, w, h, { rotation: otherRot });
    return ellipse._overlapsCircle(this._toCircle());
  }

  _overlapsCircle(circle) {
    if ( circle.contains(this.x, this.y) ) return true;

    // Simple test based on radius.
    const r2 = Math.pow(circle.radius + this.minorRadius, 2);
    const d2 = PIXI.Point.distanceSquaredBetween(this.center, circle.center);
    if ( d2 < r2 ) return true;

    // Align this ellipse to the axis at 0,0 and rotate to 0º.
    // I.e, move the circle and then rotate it.
    const cirCtr = PIXI.Point._tmp1;
    circle.center.translate(-this.x, -this.y, cirCtr).rotate(-this.radians, cirCtr);
    return this.constructor.quickEllipsesOverlapTest(
      0, 0, this.majorRadius, this.minorRadius,
      cirCtr.x, cirCtr.y, circle.radius, circle.radius
    );
  }

  draw(drawTool, opts = {}) {
    drawTool ??= CONFIG.GeometryLib.Draw;
    const shape = this.rotation ? this.toPolygon() : this;
    drawTool.shape(shape, opts);
  }
}

GEOMETRY_CONFIG.Ellipse ??= Ellipse;
