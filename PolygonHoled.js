/* globals
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/**
 * Class that holds an array of PIXI shapes (PIXI.Polygon, PIXI.Circle, etc.)
 * If the shape is a hole, it has the "isHole" property added.
 * The class handles certain polygon and other shape methods, such as `contains`.
 * Does not handle "double-donut" holes. In otherwords, holes are assumed to not have
 * any non-holed shape contained within.
 */
export class ShapeHoled {

  /**
   * @typedef {PIXI.Polygon|PIXI.Rectangle|PIXI.Circle|PIXI.Ellipse} Shape
   * @property {boolean} [isHole]     Optional property that if true, indicates it is a hole.
   */

  /** @type {Shape[]} */
  shapes = [];

  /** @type {Shape[]} */
  holes = [];

  /**
   * @param {Shape[]} shapes     Array of PIXI shapes that make up this shape.
   *   Any shape with property `isHole` will be considered a hole.
   * @param {object} [opts]
   * @param {Shape[]} [holes]    Array of shapes that should be holes. Will be marked as `isHole`.
   *   (So duplicate these shapes if you are not using them as holes elsewhere.)
   */
  constructor(shapes = [], { holes } = {}) {
    if ( holes ) holes.forEach(idx => shapes[idx].isHole = true);
    shapes.forEach(s => {
      const arr = s.isHole ? this.holes : this.shapes;
      arr.push(s);
    });
  }

  /**
   * Add a shape. If it has the `isHole` property, add as hole.
   * @param {Shape}
   */
  add(shape) {
    if ( shape.isHole ) return this.addHole(shape);
    this.shapes.push(shape);
  }

  /**
   * Add a hole
   * @param {Shape}
   */
  addHole(shape) {
    shape.isHole = true;
    this.holes.push(shape);
  }

  /**
   * Draw this shape with given graphics.
   * @param {PIXI.Graphics} graphics
   */
  draw(graphics) {
    this.shapes.forEach(s => graphics.drawShape(s));
    graphics.beginHole();
    this.holes.forEach(h => graphics.drawShape(h));
    graphics.endHole();
  }

  /**
   * If any non-holed shape contains this point, and no holed shape
   * contains the point, return true.
   * @param {number} x      X coordinate of the point to test
   * @param {number} y      Y coordinate of the point to test
   * @returns {boolean}
   */
  contains(x, y) {
    if ( !this.shapes.some(s => s.contains(x, y)) ) return false;
    return this.holes.every(h => !h.contains(x, y));
  }

  /**
   * Convert to clipper paths.
   * Any non-polygons will be converted to polygons.
   * @returns {ClipperPaths}
   */
  toClipperPaths() {
    this.holes.forEach(h => {
      if ( h.isClockwise ) h.reverseOrientation();
    });

    const polygons = [...this.shapes, ...this.holes].map(s => s.toPolygon())
    return ClipperPaths.fromPolygons(polygons);
  }

  /**
   * Convert from clipper paths.
   * @param {ClipperPaths} clipperPaths
   * @returns {PolygonHoled}
   */
  fromClipperPaths(clipperPaths) { return new this.constructor(clipperPaths.toPolygons()); }

  /**
   * Clean the shapes, combining where possible.
   * Will force non-polygons to be polygons.
   * @returns {PolygonHoled}  New object, after running the shapes through Clipper.
   */
  clean() {
    const c = this.toClipperPaths();
    c.clean();
    return this.fromClipperPaths(c);
  }

  /**
   * Simplify if possible, returning individual shapes if they do not overlap holes.
   * @param {boolean} [modifySelf=false]  If true, modify this object.
   * @returns {(PolygonHoled|Shape)[]} Array of shapes or PolygonHoled
   */
  simplify(modifySelf) {
    // If any shapes are completely contained in another, remove.
    const { holes, shapes } = this;


    if ( !this.holes.length ) return this.shapes;


  }


}
