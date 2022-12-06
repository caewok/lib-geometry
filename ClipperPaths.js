/* globals
PIXI,
ClipperLib,
canvas
*/
"use strict";

import { Draw } from "./Draw.js";

/**
 * Class to manage ClipperPaths for multiple polygons.
 */
export class ClipperPaths {
  scalingFactor = 1;

 /**
  * @param paths {ClipperLib.Path[]|Set<ClipperLib.Path>|Map<ClipperLib.Path>}
  * @returns {ClipperPaths}
  */
  constructor(paths = [], { scalingFactor = 1 } = {}) {
    this.paths = [...paths]; // Ensure these are arrays
    this.scalingFactor = scalingFactor;
  }

  /**
   * Determine the best way to represent Clipper paths.
   * @param {ClipperLib.Paths}
   * @returns {PIXI.Polygon|PIXI.Rectangle|ClipperPaths} Return a polygon, rectangle,
   *   or ClipperPaths depending on paths.
   */
  static processPaths(paths) {
    if (paths.length > 1) return ClipperPaths(paths);

    return ClipperPaths.polygonToRectangle(paths[0]);
  }

  /**
   * Convert an array of polygons to ClipperPaths
   * @param {PIXI.Polygon[]}
   * @returns {ClipperPaths}
   */
  static fromPolygons(polygons, { scalingFactor = 1 } = {}) {
    const out = new ClipperPaths(polygons.map(p => p.toClipperPoints({scalingFactor})), { scalingFactor });
    return out;
  }

  /**
   * Check if polygon can be converted to a rectangle
   * @param {PIXI.Polygon} polygon
   * @returns {PIXI.Polygon|PIXI.Rectangle}
   */
  static polygonToRectangle(polygon) {
    const pts = polygon.points;
    if ( !(polygon.isClosed && pts.length === 10)
      || !(!polygon.isClosed && pts.length === 8) ) return polygon;

    // Layout must be clockwise.
    // Layout options:
    // - 0, 1           2, 3          4, 5          6, 7
    // - left,top       right,top     right,bottom  left,bottom
    // - right,top      right,bottom  left,bottom   left,top
    // - right,bottom   left,bottom   left,top      right,top
    // - left,bottom    left,top      right,top     right,bottom

    if ( (pts[0] === pts[2] && pts[4] === pts[6] && pts[3] === pts[5] && pts[7] === pts[1])
      || (pts[1] === pts[3] && pts[5] === pts[7] && pts[2] === pts[4] && pts[6] === pts[0]) ) {

      const leftX = Math.min(pts[0], pts[2], pts[4], pts[6]);
      const rightX = Math.max(pts[0], pts[2], pts[4], pts[6]);
      const topY = Math.min(pts[1], pts[3], pts[5], pts[7]);
      const bottomY = Math.max(pts[1], pts[3], pts[5], pts[7]);

      return new PIXI.Rectangle(leftX, topY, rightX - leftX, bottomY - topY);
    }

    return polygon;
  }

  /**
   * Calculate the area for this set of paths.
   * Use getter to correspond with PIXI.Polygon.prototype.area and other polygon types.
   * @returns {number}
   */
  get area() {
    return ClipperLib.JS.AreaOfPolygons(this.paths) / Math.pow(this.scalingFactor, 2);
  }

  /**
   * Area that matches clipper measurements, so it can be compared with Clipper Polygon versions.
   * Used to match what Clipper would measure as area, by scaling the points.
   * @param {object} [options]
   * @param {number} [scalingFactor]  Scale like with PIXI.Polygon.prototype.toClipperPoints.
   * @returns {number}  Positive if clockwise. (b/c y-axis is reversed in Foundry)
   */
  scaledArea({scalingFactor = 1} = {}) {
    if ( scalingFactor !== this.scalingFactor ) console.warn("ClipperPaths|scaledArea requested scalingFactor does not match.");
    return this.area;
  }

  /**
   * If the path is single, convert to polygon (or rectangle if possible)
   * @returns {PIXI.Polygon|PIXI.Rectangle|ClipperPaths}
   */
  simplify() {
    if ( this.paths.length > 1 ) return this;
    return ClipperPaths.polygonToRectangle(this.toPolygons()[0]);
  }

  /**
   * Convert this to an array of PIXI.Polygons.
   * @returns {PIXI.Polygons[]}
   */
  toPolygons() {
    return this.paths.map(pts => {
      const poly = PIXI.Polygon.fromClipperPoints(pts, this.scalingFactor);
      poly.isHole = !ClipperLib.Clipper.Orientation(pts);
      return poly;
    });
  }

  /**
   * Run CleanPolygons on the paths
   * @param {number} cleanDelta   Value, multiplied by scalingFactor, passed to CleanPolygons.
   * @returns {ClipperPaths}  This object.
   */
  clean(cleanDelta = 0.1) {
    ClipperLib.Clipper.CleanPolygons(this.paths, cleanDelta * this.scalingFactor);
    return this;
  }

  /**
   * Execute a Clipper.clipType combination using the polygon as the subject.
   * @param {PIXI.Polygon} polygon          Subject for the clip
   * @param {ClipperLib.ClipType} clipType  ctIntersection: 0, ctUnion: 1, ctDifference: 2, ctXor: 3
   * @param {object} [options]              Options passed to ClipperLib.Clipper().Execute
   * @param {number} [subjFillType]         Fill type for the subject. Defaults to pftEvenOdd.
   * @param {number} [clipFillType]         Fill type for the clip. Defaults to pftEvenOdd.
   * @returns {ClipperPaths} New ClipperPaths object
   */
  _clipperClip(polygon, type, {
    subjFillType = ClipperLib.PolyFillType.pftEvenOdd,
    clipFillType = ClipperLib.PolyFillType.pftEvenOdd } = {}) {

    const c = new ClipperLib.Clipper();
    const solution = new ClipperPaths();
    solution.scalingFactor = this.scalingFactor;

    c.AddPath(polygon.toClipperPoints({ scalingFactor: this.scalingFactor }), ClipperLib.PolyType.ptSubject, true);
    c.AddPaths(this.paths, ClipperLib.PolyType.ptClip, true);
    c.Execute(type, solution.paths, subjFillType, clipFillType);

    return solution;
  }

  /**
   * Intersect this set of paths with a polygon as subject.
   * @param {PIXI.Polygon}
   * @returns {ClipperPaths}
   */
  intersectPolygon(polygon) {
    return this._clipperClip(polygon, ClipperLib.ClipType.ctIntersection);
  }

  /**
   * Add a set of paths to this one
   * @param {ClipperPaths} other
   * @returns {ClipperPaths}
   */
  add(other) {
    if ( !other.paths.length ) return this;
    this.paths.push(...other.paths);
    return this;
  }

  /**
   * Intersect this set of paths against another, taking the other as subject.
   * @param {ClipperPaths} other
   * @returns {ClipperPaths}
   */
  intersectPaths(other) {
    const type = ClipperLib.ClipType.ctIntersection;
    const subjFillType = ClipperLib.PolyFillType.pftEvenOdd;
    const clipFillType = ClipperLib.PolyFillType.pftEvenOdd;

    const c = new ClipperLib.Clipper();
    const solution = new ClipperPaths();
    solution.scalingFactor = this.scalingFactor;

    c.AddPaths(other.paths, ClipperLib.PolyType.ptSubject, true);
    c.AddPaths(this.paths, ClipperLib.PolyType.ptClip, true);
    c.Execute(type, solution.paths, subjFillType, clipFillType);

    return solution;
  }

  /**
   * Using other as a subject, take the difference of this ClipperPaths.
   * @param {ClipperPaths} other
   * @returns {ClipperPaths}
   */
  diffPaths(other) {
    const type = ClipperLib.ClipType.ctDifference;
    const subjFillType = ClipperLib.PolyFillType.pftEvenOdd;
    const clipFillType = ClipperLib.PolyFillType.pftEvenOdd;

    const c = new ClipperLib.Clipper();
    const solution = new ClipperPaths();
    solution.scalingFactor = this.scalingFactor;

    c.AddPaths(other.paths, ClipperLib.PolyType.ptSubject, true);
    c.AddPaths(this.paths, ClipperLib.PolyType.ptClip, true);
    c.Execute(type, solution.paths, subjFillType, clipFillType);

    return solution;
 }

  /**
   * Using a polygon as a subject, take the difference of this ClipperPaths.
   * @param {PIXI.Polygon} polygon
   * @returns {ClipperPaths}
   */
  diffPolygon(polygon) {
    return this._clipperClip(polygon, ClipperLib.ClipType.ctDifference);
  }

  /**
   * Union the paths, using a positive fill.
   * This version uses a positive fill type so any overlap is filled.
   * @returns {ClipperPaths}
   */
  combine() {
    if ( this.paths.length === 1 ) return this;

    const c = new ClipperLib.Clipper();
    const combined = new ClipperPaths();
    combined.scalingFactor = this.scalingFactor;

    c.AddPaths(this.paths, ClipperLib.PolyType.ptSubject, true);

    // To avoid the checkerboard issue, use a positive fill type so any overlap is filled.
    c.Execute(ClipperLib.ClipType.ctUnion,
      combined.paths,
      ClipperLib.PolyFillType.pftPositive,
      ClipperLib.PolyFillType.pftPositive);

    return combined;
  }

  /**
   * Combine 2+ ClipperPaths objects using a union with a positive fill.
   * @param {ClipperPaths[]} pathsArr
   * @returns {ClipperPaths}
   */
  static combinePaths(pathsArr) {
    const ln = pathsArr.length;
    if ( !ln ) return undefined;

    const firstPath = pathsArr[0];
    if ( ln === 1 ) return firstPath;

    const cPaths = new ClipperPaths(firstPath.paths);
    cPaths.scalingFactor = firstPath.scalingFactor;

    for ( let i = 1; i < ln; i += 1 ) {
      const obj = pathsArr[i];
      if ( cPaths.scalingFactor !== obj.scalingFactor ) console.warn("ClipperPaths|combinePaths scalingFactor not equal.");

      cPaths.paths.push(...obj.paths);
    }

    return cPaths.combine();
  }

  /**
   * Draw the clipper paths, to the extent possible
   */
  draw({ color = Draw.COLORS.black, width = 1, fill, fillAlpha = 1 } = {}) {
    if ( !fill ) fill = color;
    const polys = this.toPolygons();

    canvas.controls.debug.beginFill(fill, fillAlpha);
    for ( const poly of polys ) {
      if ( poly.isHole ) canvas.controls.debug.beginHole();
      canvas.controls.debug.lineStyle(width, color).drawShape(poly);
      if ( poly.isHole ) canvas.controls.debug.endHole();
    }
    canvas.controls.debug.endFill();
  }
}
