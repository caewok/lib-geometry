/* globals
PIXI,
canvas,
*/
"use strict";

import { Draw } from "./Draw.js";
import { NULL_SET } from "./util.js";


// See https://www.npmjs.com/package/clipper2-js
import * as Clipper2 from "./clipper2_esm2020/clipper2-js.mjs";

const { Path64, Paths64, Point64 } = Clipper2;

/* Example from https://github.com/IRobot1/clipper2-ts
Clipper2Paths = CONFIG.GeometryLib.CONFIG.Clipper2Paths
Clipper2 = Clipper2Paths.Clipper2

a = [ 100, 50, 10, 79, 65, 2, 65, 98, 10, 21 ]
b = [98, 63, 4, 68, 77, 8, 52, 100, 19, 12]
subj = new Clipper2.Paths64();
clip = new Clipper2.Paths64();
subj.push(Clipper2.Clipper.makePath(a))
clip.push(Clipper2.Clipper.makePath(b))
solution = Clipper2.Clipper.Intersect(subj, clip, Clipper2Paths.FillRule.NonZero);
solution = Clipper2.Clipper.Union(subj, clip, Clipper2Paths.FillRule.NonZero);
solution = Clipper2.Clipper.Difference(subj, clip, Clipper2Paths.FillRule.NonZero);

subj2 = Clipper2Paths.fromArray(a)
clip2 = Clipper2Paths.fromArray(b)
subj2.intersectPaths(clip2, Clipper2Paths.FillRule.NonZero)
subj2.unionPaths(clip2, Clipper2Paths.FillRule.NonZero)
subj2.unionPaths(clip2, Clipper2Paths.FillRule.Positive)
subj2.diffPaths(clip2, Clipper2Paths.FillRule.NonZero)

solution = Clipper2.Clipper.Union([...subj, ...clip], undefined, Clipper2Paths.FillRule.NonZero);
subj3 = new Clipper2Paths();
subj3.addPathArray(a)
subj3.addPathArray(b)
subj3.union(Clipper2Paths.FillRule.NonZero)
subj3.combine()
*/

/**
 * Class to manage Clipper2Paths for multiple polygons.
 * Unlike Clipper2Paths, the paths here use lower-case x, y.
 * The points must be Point64.
 * E.g. Clipper2.Clipper.makePath([ 100, 50, 10, 79, 65, 2, 65, 98, 10, 21 ])
 */
export class Clipper2Paths {
  // ----- NOTE: Class inheritance ----- //

  static classTypes = new Set([this.name, "Clipper"]); // Alternative to instanceof

  inheritsClassType(type) {
    let proto = this;
    let classTypes = proto.constructor.classTypes;
    do {
      if ( classTypes.has(type) ) return true;
      proto = Object.getPrototypeOf(proto);
      classTypes = proto?.constructor?.classTypes;

    } while ( classTypes );
    return false;
  }

  matchesClass(cl) {
    return this.constructor.classTypes.equals(cl.classTypes || NULL_SET);
  }

  overlapsClass(cl) {
    return this.constructor.classTypes.intersects(cl.classTypes || NULL_SET);
  }


  // ----- NOTE: Object properties ----- //

  paths = new Paths64();

  // Empty constructor.

  /** @type {number} */
  #scalingFactor = CONST.CLIPPER_SCALING_FACTOR;

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

  // ----- NOTE: Static properties ----- //

  static Clipper2 = Clipper2;

  static ClipType = Clipper2.ClipType;

  static PathType = Clipper2.JoinType;

  static FillRule = Clipper2.FillRule;

  static EndType = Clipper2.EndType;

  static JoinType = Clipper2.JoinType;

  // ----- NOTE: Static factory methods ----- //

   /**
   * Convert a flat array of x,y coordinates to Clipper2Paths.
   * @param {number[]} arr
   * @returns {Clipper2Paths}
   */
  static fromArray(arr, scalingFactor = CONST.CLIPPER_SCALING_FACTOR) {
    const out = new this();
    out.scalingFactor = scalingFactor;
    out.addPathArray(arr);
    return out;
  }

  /**
   * Convert an array of {x,y} objects to Clipper2Paths
   * @param {Point[]} pts
   * @param {number} [scalingFactor=1]
   * @returns {Clipper2Paths}
   */
  static fromPoint2d(pts, scalingFactor = CONST.CLIPPER_SCALING_FACTOR) {
    const out = new this();
    out.scalingFactor = scalingFactor;
    out.addPathPoints(pts);
    return out;
  }

  /**
   * Convert an array of Clipper1 path points {X, Y} to a Path64.
   * @param {Clipper1Path} pts
   * @param {number} [scalingFactor=1]
   * @returns {Clipper2Paths}
   */
  static fromClipper1Points(pts, scalingFactor = CONST.CLIPPER_SCALING_FACTOR) {
    const out = new this();
    out.scalingFactor = scalingFactor;
    out.addPathClipper1Points(pts);
    return out;
  }

  /**
   * Convert an array of polygons to Clipper2Paths
   * @param {PIXI.Polygon[]}
   * @param {number} [scalingFactor=1]
   * @returns {Clipper2Paths}
   */
  static fromPolygons(polygons, scalingFactor = CONST.CLIPPER_SCALING_FACTOR) {
    const out = new this();
    for ( const poly of polygons ) out.addPathArray(poly.points);
    out.scalingFactor = scalingFactor;
    return out;
  }

  /**
   * Convert a polygon to Clipper2Paths
   * @param {PIXI.Polygon}
   * @param {number} [scalingFactor=1]
   * @returns {Clipper2Paths}
   */
  static fromPolygon(polygon, scalingFactor = CONST.CLIPPER_SCALING_FACTOR) {
    const out = new this();
    out.addPathArray(polygon.points);
    out.scalingFactor = scalingFactor;
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


  // ----- NOTE: Static conversion helpers ----- //

  static pathToPoints(path, scalingFactor = CONST.CLIPPER_SCALING_FACTOR) {
    const invScale = 1 / scalingFactor;
    return path.map(pt64 => PIXI.Point.tmp.set(pt64.x * invScale, pt64.y * invScale));
  }

  static pointsToPath(pts, scalingFactor = CONST.CLIPPER_SCALING_FACTOR) {
    const nPts = pts.length;
    const path = new Path64(nPts)
    for ( let i = 0; i < nPts; i += 1 ) path[i] = new Point64(pts[i], scalingFactor);
    return path;
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

  // ----- NOTE: Factory helpers; add paths ----- //

  /**
   * Add a flat array of numbers, representing [x0, y0, x1, y1, ...] as a path to this object.
   * @param {number[]} arr
   */
  addPathArray(arr) {
    const path = Clipper2.Clipper.makePath(arr);
    this.#scalePath(path);
    this.paths.push(path);
  }

  /**
   * Add an array of point objects as a path to this object.
   * @param {Point[]} pts
   */
  addPathPoints(pts) {
    this.paths.push(this.constructor.pointsToPath(pts, this.scalingFactor));
  }

  /**
   * Add an array of Clipper1 path points {X, Y} to this object.
   * @param {Clipper1Path} pts
   * @returns {Path64}
   */
  addPathClipper1Points(pts) {
    const nPts = pts.length;
    const path = new Path64(nPts)
    const scalingFactor = this.scalingFactor;
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
    this.paths.push(path);
  }

  /**
   * Scale the (presumably unscaled) path by the current scaling factor.
   * @param {Clipper2.Paths64} path       Modified in place
   * @returns {Clipper2.Paths64} The path, for convenience
   */
  #scalePath(path) {
    if ( this.scalingFactor !== 1 ) {
      const mult = 1 / this.scalingFactor;
      path.forEach(pt => {
        pt.x *= mult;
        pt.y *= mult;
      });
    }
    return path;
  }

  applyToEachPoint(callback) { this.paths.forEach(path => path.forEach(pt => callback(pt))); }


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

  /* ----- NOTE: Methods to convert from ClipperPaths to something else ----- */

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

  /* ----- NOTE: Methods ----- */

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
   * Transform these paths with a 3x3 matrix.
   * @param {Matrix} M        3x3 transform matrix
   * @returns {ClipperPaths} New paths
   */
  transform(M) {
    const out = new this.constructor();
    out.scalingFactor = this.scalingFactor;
    this.paths.forEach(path => {
      const pts = this.constructor.pathToPoints(path, this.scalingFactor);
      pts.forEach(pt => M.multiplyPoint2d(pt, pt));
      out.addPathPoints(pts);
    });
    return out;
  }

  /**
   * Remove paths that have a small area.
   * @param {number} area     Area in pixels^2.
   * @returns {Clipper2Paths} New paths object
   */
  trimByArea(area = 1) {
    const scalingFactor = this.scalingFactor;
    const trimmedPaths = this.paths.filter(path => Math.abs(Clipper2.Clipper.area(path)) / Math.pow(scalingFactor, 2) >= area);
    const out = new this.constructor();
    out.scalingFactor = scalingFactor;
    out.paths = trimmedPaths;
    return out;
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
    const out = new this.constructor();
    out.scalingFactor = scalingFactor;
    out.paths = cleanedPaths;
    return out;
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
    const solution = new this();
    solution.scalingFactor = scalingFactor;

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
  intersectPaths(other, fillRule) {
    fillRule ??= Clipper2.FillRule.EvenOdd;
    const out = new this.constructor();
    out.scalingFactor = this.scalingFactor;
    out.paths = Clipper2.Clipper.Intersect(this.paths, other.paths, fillRule);
    return out;
  }

  /**
   * Using other as a subject, take the difference of this Clipper2Paths.
   * @param {Clipper2Paths} other
   * @returns {Clipper2Paths}
   */
  diffPaths(other, fillRule) {
    fillRule ??= Clipper2.FillRule.EvenOdd;
    const out = new this.constructor();
    out.scalingFactor = this.scalingFactor;
    out.paths = Clipper2.Clipper.Difference(this.paths, other.paths, fillRule);
    return out;
  }

  unionPaths(other, fillRule) {
    fillRule ??= Clipper2.FillRule.EvenOdd;
    const out = new this.constructor();
    out.scalingFactor = this.scalingFactor;
    out.paths = Clipper2.Clipper.Union(this.paths, other.paths, fillRule);
    return out;
  }

  /**
   * Union all the paths of this object.
   * @returns {Clipper2Paths}
   */
  union(fillRule) {
    if ( this.paths.length === 1 ) return this;
    fillRule ??= Clipper2.FillRule.NonZero;
    const out = new this.constructor();
    out.scalingFactor = this.scalingFactor;
    out.paths = Clipper2.Clipper.Union(this.paths, undefined, fillRule);
    return out;
  }

  /**
   * Union the paths, using a positive fill.
   * This version uses a positive fill type so any overlap is filled.
   * @returns {Clipper2Paths}
   */
  combine() { return this.union(Clipper2.FillRule.Positive); }


  /**
   * Draw the clipper paths, to the extent possible
   */
  draw({ graphics = canvas.controls.debug, color = Draw.COLORS.black, width = 1, fill, fillAlpha = 1 } = {}) {
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

