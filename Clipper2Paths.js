/* globals
PIXI,
canvas,
CONFIG
*/
"use strict";

import { GEOMETRY_CONFIG } from "./const.js";
import "./Draw.js";

// See https://www.npmjs.com/package/clipper2-js
import * as Clipper2 from "./clipper2_esm2020/clipper2-js.mjs";

const { Path64, Paths64, Point64 } = Clipper2;

/**
 * Class to manage Clipper2Paths for multiple polygons.
 * Unlike Clipper2Paths, the paths here use lower-case x, y.
 * The points must be Point64.
 * E.g. Clipper2.Clipper.makePath([ 100, 50, 10, 79, 65, 2, 65, 98, 10, 21 ])
 */
export class Clipper2Paths {
  static Clipper2 = Clipper2;

  static ClipType = Clipper2.ClipType;

  static PathType = Clipper2.JoinType;

  static FillRule = Clipper2.FillRule;

  static EndType = Clipper2.EndType;

  static JoinType = Clipper2.JoinType;

  /**
   * Convert a flat array of x,y coordinates to a path.
   * @param {number[]} arr
   * @returns {Path64}
   */
  static pathFromArray(arr, scalingFactor = 1) {
    const nPts = arr.length * 0.5;
    const path = new Path64(nPts);
    for ( let i = 0, j = 0; i < nPts; i += 1 ) {
      path[i] = new Point64(arr[j++] * scalingFactor, arr[j++] * scalingFactor);
    }
    return path;
  }

  /**
   * Convert an array of {x,y} objects to a path.
   * @param {Point[]} pts
   * @returns {Path64}
   */
  static pathFromPoint2d(pts, scalingFactor = 1) {
    const nPts = pts.length;
    const path = new Path64(nPts)
    for ( let i = 0; i < nPts; i += 1 ) path[i] = new Point64(pts[i], scalingFactor);
    return path;
  }

  /**
   * Convert an array of Clipper1 path points {X, Y} to a Path64.
   * @param {Clipper1Path} pts
   * @returns {Path64}
   */
  static pathFromClipper1Points(pts, scalingFactor = 1) {
    const nPts = pts.length;
    const path = new Path64(nPts)
    if ( scalingFactor === 1 ) {
      for ( let i = 0; i < nPts; i += 1 ) {
        const pt = pts[i];
        path[i] = new Point64(pt.X, pt.Y);
      }
    } else {
      for ( let i = 0; i < nPts; i += 1 ) {
        const pt = pts[i];
        path[i] = new Point64({ x: pt.X, y: pt.Y }, scalingFactor);
      }
    }
    return path;
  }

  static pathToPoints(path, scalingFactor = 1) {
    const invScale = 1 / scalingFactor;
    return path.map(pt64 => new PIXI.Point(pt64.x * invScale, pt64.y * invScale));
  }

  static pathToFlatArray(path, scalingFactor) {
    const invScale = 1 / scalingFactor;
    const nPts = path.length;
    const arr = new Array(nPts * 2);
    for ( let i = 0, j = 0; i < nPts; i += 1 ) {
      const pt = path[i];
      arr[j++] = pt.x * invScale;
      arr[j++] = pt.y * invScale;
    }
    return arr;
  }

  /**
   * @param paths {}
   * @returns {Clipper2Paths}
   */
  constructor(paths = [], { scalingFactor = 1 } = {}) {
    const nPaths = paths.length;
    this.paths = new Paths64(nPaths);
    for ( let i = 0; i < nPaths; i += 1 ) this.paths[i] = new Path64(...paths[i]);
    this.#scalingFactor = scalingFactor;
  }

  applyToEachPoint(callback) { this.paths.forEach(path => path.forEach(pt => callback(pt))); }

  /** @type {number} */
  #scalingFactor = 1;

  get scalingFactor() { return this.#scalingFactor; }

  /**
   * Multiplies each value by the scaling factor, accounting for any previous scaling factor set.
   * So if value is 5 and #scalingFactor is 1, each point is multiplied by 5.
   * If value is 5 and #scalingFactor is 2, each points is divided by 2 and then multiplied by 5.
   */
  set scalingFactor(value) {
    if ( !value || value < 0 ) throw("Clipper2Paths|Scaling factor cannot be 0 or negative.");
    if ( value === this.#scalingFactor ) return;

    const mult = value / this.#scalingFactor;
    this.applyToEachPoint(pt => {
      pt.x *= mult;
      pt.y *= mult;
    });
    this.#scalingFactor = value;
  }

  /**
   * Determine the best way to represent Clipper paths.
   * @param {Clipper2.Paths}
   * @returns {PIXI.Polygon|PIXI.Rectangle|Clipper2Paths} Return a polygon, rectangle,
   *   or Clipper2Paths depending on paths.
   */
  static processPaths(paths) {
    if (paths.length > 1) return Clipper2Paths(paths);
    return Clipper2Paths.polygonToRectangle(paths[0]);
  }

  /**
   * Convert an array of polygons to Clipper2Paths
   * @param {PIXI.Polygon[]}
   * @returns {Clipper2Paths}
   */
  static fromPolygons(polygons, { scalingFactor = 1 } = {}) {
    const out = new this(polygons.map(poly => this.pathFromArray(poly.points)));
    out.scalingFactor = scalingFactor; // Force the points to be scaled.
    return out;
  }

  static polygonToPath(polygon, { scalingFactor = 1 } = {}) {
    return this.pathFromArray(polygon.points, scalingFactor);
  }

  /**
   * Check if polygon can be converted to a rectangle
   * @param {PIXI.Polygon} polygon
   * @returns {PIXI.Polygon|PIXI.Rectangle}
   */
  static polygonToRectangle(polygon) {
    const pts = polygon.points;
    if ( (polygon.isClosed && pts.length !== 10)
      || (!polygon.isClosed && pts.length !== 8) ) return polygon;

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
   * Convert this to an array of PIXI.Polygons.
   * @returns {PIXI.Polygons[]}
   */
  toPolygons() {
    return this.paths.map(path => {
      const pts = this.constructor.pathToFlatArray(path, this.scalingFactor);
      const poly = new PIXI.Polygon(...pts);
      poly.isHole = !Clipper2.Clipper.isPositive(path);

      // Could use reverseSolution but not guaranteed control over that parameter.
      if ( poly.isHole ^ poly.isClockwise ) poly.reverseOrientation();
      return poly;
    });
  }

  /**
   * Convert paths to earcut coordinates.
   * See https://github.com/mapbox/earcut
   * @returns {object} Object with vertices, holes, dimensions = 2.
   */
  toEarcutCoordinates() {
    const out = {
      vertices: [],
      holes: [],
      dimensions: 2
    };
    const paths = this.paths;
    const nPaths = paths.length;
    if ( !nPaths ) return out;

    let numBasePolys = 0;
    this.toPolygons().forEach(poly => {
      if ( poly.isHole ) out.holes.push(poly.points);
      else {
        out.vertices.push(...poly.points);
        numBasePolys += 1;
      }
    });
    // If poly -- hole -- poly, could be fine if second poly encompassed by hole.
    // But multiple independent polys could be an issue.
    if ( numBasePolys > 1 ) console.warn("Earcut may fail with multiple outer polygons.");

    // Concatenate holes and add indices
    const nHoles = out.holes.length;
    if ( nHoles > 0 ) {
      const indices = [];
      let nVertices = out.vertices.length * 0.5;
      for ( let i = 0; i < nHoles; i += 1 ) {
        const hole = out.holes[i];
        const nPts = hole.length * 0.5;
        out.vertices.push(...hole);
        indices.push(nVertices); // Vertices index starts at 0.
        nVertices += nPts;
      }
      out.holes = indices;
    }
    return out;
  }

  /**
   * Convert a flat array with indices of triangles, as in earcut, to Clipper2Paths.
   * Each 3 numbers in the indices array correspond to a triangle
   * @param {number[]} vertices
   * @param {number[]} indices
   * @param {number} dimensions     Number of dimensions for the vertices. Z, etc. will be ignored.
   * @returns {Clipper2Paths}
   */
  static fromEarcutCoordinates(vertices, indices, dimensions = 2) {
    const cPaths = new this();
    const nIndices = indices.length;
    for ( let i = 0; i < nIndices; ) { // Increment i in the loop
      const path = new Path64(3);
      for ( let j = 0; j < 3; j += 1 ) {
        const idx = indices[i] * dimensions;
        path[j] = new Point64(vertices[idx], vertices[idx + 1]);
        i += 1;
      }
      cPaths.paths.push(path);
    }
    return cPaths;
  }

  /**
   * Use earcut to triangulate these paths.
   * See https://github.com/mapbox/earcut.
   * @returns {Clipper2Paths} Paths constructed from the resulting triangles
   */
  earcut() {
    const coords = this.toEarcutCoordinates();
    const res = PIXI.utils.earcut(coords.vertices, coords.holes, coords.dimensions);
    return Clipper2Paths.fromEarcutCoordinates(coords.vertices, res, coords.dimensions);
  }

  /**
   * Remove paths that have a small area.
   * @param {number} area     Area in pixels^2.
   * @returns {Clipper2Paths} New paths object
   */
  trimByArea(area = 1) {
    const scalingFactor = this.scalingFactor;
    const trimmedPaths = this.paths.filter(path => Math.abs(Clipper2.Clipper.area(path)) / Math.pow(scalingFactor, 2) >= area);
    return new this.constructor(trimmedPaths, { scalingFactor });
  }

  /**
   * Calculate the area for this set of paths.
   * Use getter to correspond with PIXI.Polygon.prototype.area and other polygon types.
   * @returns {number}
   */
  get area() {
    return Clipper2.Clipper.areaPaths(this.paths) / Math.pow(this.scalingFactor, 2);
  }

  /**
   * If the path is single, convert to polygon (or rectangle if possible)
   * @returns {PIXI.Polygon|PIXI.Rectangle|Clipper2Paths}
   */
  simplify() {
    if ( this.paths.length > 1 ) return this;
    if ( this.paths.length === 0 ) return new PIXI.Polygon();
    return this.constructor.polygonToRectangle(this.toPolygons()[0]);
  }

  /**
   * Run CleanPolygons on the paths
   * @param {number} cleanDelta   Value, multiplied by scalingFactor, passed to CleanPolygons.
   * @returns {Clipper2Paths}  A new object.
   */
  clean(cleanDelta = 0.1) {
    const scalingFactor = this.scalingFactor;
    const cleanedPaths = Clipper2.Clipper.simplifyPath(this.paths, scalingFactor * cleanDelta);
    return new this.constructor(cleanedPaths, { scalingFactor });
  }

  /**
   * Execute a Clipper.clipType combination using the polygon as the subject.
   * @param {PIXI.Polygon} polygon          Subject for the clip
   * @param {Clipper2.ClipType} clipType    Intersection, union, difference, xor
   * @param {object} [options]              Options passed to Clipper2.Clipper().execute
   * @param {number} [fillRule]             Fill rule. Defaults to EvenOdd.
   * @returns {Clipper2Paths} New Clipper2Paths object
   */
  _clipperClip(polygon, clipType, {
    fillRule = Clipper2.FillRule.EvenOdd,

    // Backward compatibility.
    subjFillType,
    clipFillType } = {}) {

    // Backward compatibility.
    if ( typeof subjFillType !== "undefined" ) fillRule = subjFillType;
    else if ( typeof clipFillType !== "undefined" ) fillRule = clipFillType;

    const scalingFactor = this.scalingFactor;
    const c = new Clipper2.Clipper64();
    const solution = new this.constructor(undefined, { scalingFactor });
    const isOpen = !polygon.isClosed;
    c.addPath(this.constructor.polygonToPath(polygon, { scalingFactor }), Clipper2.PathType.Subject, isOpen);
    c.addPaths(this.paths, Clipper2.PathType.Clip, false);
    c.execute(clipType, fillRule, solution.paths);
    return solution;
  }

  /**
   * Intersect this set of paths with a polygon as subject.
   * @param {PIXI.Polygon}
   * @returns {Clipper2Paths}
   */
  intersectPolygon(polygon) {
    return this._clipperClip(polygon, Clipper2.ClipType.Intersection);
  }

  /**
   * Add a set of paths to this one
   * @param {Clipper2Paths} other
   * @returns {Clipper2Paths}
   */
  add(other) {
    if ( !other.paths.length ) return this;
    this.paths.push(...other.paths);
    return this;
  }

  /**
   * Intersect this set of paths against another, taking the other as subject.
   * @param {Clipper2Paths} other
   * @returns {Clipper2Paths}
   */
  intersectPaths(other) {
    const type = Clipper2.ClipType.Intersection;
    const fillRule = Clipper2.FillRule.EvenOdd

    const scalingFactor = this.scalingFactor;
    const c = new Clipper2.Clipper64();
    const solution = new this.constructor(undefined, { scalingFactor });

    c.addPaths(other.paths, Clipper2.PathType.Subject, true);
    c.addPaths(this.paths, Clipper2.PathType.Clip, true);
    c.execute(type, fillRule, solution.paths);
    return solution;
  }

  /**
   * Using other as a subject, take the difference of this Clipper2Paths.
   * @param {Clipper2Paths} other
   * @returns {Clipper2Paths}
   */
  diffPaths(other) {
    const type = Clipper2.ClipType.Difference;
    const fillRule = Clipper2.FillRule.EvenOdd
    const scalingFactor = this.scalingFactor;
    const c = new Clipper2.Clipper64();
    const solution = new this.constructor(undefined, { scalingFactor });
    const isOpen = false;
    c.addPaths(other.paths, Clipper2.PathType.Subject, isOpen);
    c.addPaths(this.paths, Clipper2.PathType.Clip, isOpen);
    c.execute(type, fillRule, solution.paths);
    return solution;
  }

  /**
   * Using a polygon as a subject, take the difference of this Clipper2Paths.
   * @param {PIXI.Polygon} polygon
   * @returns {Clipper2Paths}
   */
  diffPolygon(polygon) {
    return this._clipperClip(polygon, Clipper2.ClipType.Difference);
  }

  /**
   * Union the paths.
   * @returns {Clipper2Paths}
   */
  union() {
    if ( this.paths.length === 1 ) return this;
    const c = new Clipper2.Clipper64();
    const scalingFactor = this.scalingFactor;
    const union = new this.constructor(undefined, { scalingFactor });
    c.addPaths(this.paths, Clipper2.PathType.Subject, true);
    c.execute(Clipper2.ClipType.Union, Clipper2.FillRule.NonZero, union.paths);
    return union;
  }

  /**
   * Union the paths, using a positive fill.
   * This version uses a positive fill type so any overlap is filled.
   * @returns {Clipper2Paths}
   */
  combine() {
    if ( this.paths.length === 1 ) return this;

    const scalingFactor = this.scalingFactor;
    const c = new Clipper2.Clipper64();
    const combined = new this.constructor(undefined, { scalingFactor });
    c.addPaths(this.paths, Clipper2.PathType.Subject, true);

    // To avoid the checkerboard issue, use a positive fill type so any overlap is filled.
    c.execute(Clipper2.ClipType.Union, Clipper2.FillRule.Positive, combined.paths);
    return combined;
  }

  /**
   * Join paths into a single Clipper2Paths object
   * @param {Clipper2Paths[]} pathsArr
   * @returns {Clipper2Paths}
   */
  static joinPaths(pathsArr) {
    const ln = pathsArr.length;
    if ( !ln ) return undefined;

    const firstPath = pathsArr[0];
    if ( ln === 1 ) return firstPath;

    const scalingFactor = firstPath.scalingFactor;
    const cPaths = new this(firstPath.paths, { scalingFactor });

    for ( let i = 1; i < ln; i += 1 ) {
      const obj = pathsArr[i];
      if ( cPaths.scalingFactor !== obj.scalingFactor ) console.warn("Clipper2Paths|combinePaths scalingFactor not equal.");

      cPaths.paths.push(...obj.paths);
    }
    return cPaths;
  }

  /**
   * Combine 2+ Clipper2Paths objects using a union with a positive fill.
   * @param {Clipper2Paths[]} pathsArr
   * @returns {Clipper2Paths}
   */
  static combinePaths(pathsArr) {
    const cPaths = this.joinPaths(pathsArr);
    if ( !cPaths ) return undefined;
    return cPaths.combine();
  }



  /**
   * Execute a Clipper.clipType combination.
   * @param {Clipper2Paths} subject          Subject for the clip
   * @param {Clipper2Paths} clip             What to clip
   * @param {Clipper2.ClipType} clipType    Intersection, union, difference, xor
   * @param {object} [options]              Options passed to Clipper2.Clipper().execute
   * @param {number} [fillRule]             Fill rule. Defaults to pftEvenOdd.
   * @returns {Clipper2Paths} New Clipper2Paths object
   */
  static clip(subject, clip, {
    clipType = Clipper2.ClipType.Union,
    fillRule = Clipper2.FillRule.EvenOdd,

    // Backward compatibility.
    subjFillType,
    clipFillType } = {}) {

    // Backward compatibility.
    if ( typeof subjFillType !== "undefined" ) fillRule = subjFillType;
    else if ( typeof clipFillType !== "undefined" ) fillRule = clipFillType;

    const scalingFactor = subject.scalingFactor;
    const c = new Clipper2.Clipper64();
    const solution = new this(undefined, { scalingFactor });
    const isOpen = false;
    c.addPaths(subject.paths, Clipper2.PathType.Subject, isOpen);
    c.addPaths(clip.paths, Clipper2.PathType.Clip, isOpen);
    c.execute(clipType, fillRule, solution.paths);
    return solution;
  }

  /**
   * Draw the clipper paths, to the extent possible
   */
  draw({ graphics = canvas.controls.debug, color = CONFIG.GeometryLib.Draw.COLORS.black, width = 1, fill, fillAlpha = 1 } = {}) {
    if ( !fill ) fill = color;
    const polys = this.toPolygons();

    // Sort so holes are last.
    polys.sort((a, b) => a.isHole - b.isHole);
    if ( !polys.length || polys[0].isHole ) return; // All the polys are holes.

    graphics.beginFill(fill, fillAlpha);
    for ( const poly of polys ) {
      if ( poly.isHole ) graphics.beginHole();
      graphics.lineStyle(width, color).drawShape(poly);
      if ( poly.isHole ) graphics.endHole();
    }
    graphics.endFill();
  }
}

GEOMETRY_CONFIG.Clipper2Paths ??= Clipper2Paths;
