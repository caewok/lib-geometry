/* globals
PIXI,
*/
"use strict";

import { Point3d } from "./3d/Point3d.js";
import { Draw } from "./Draw.js";
import { almostLessThan, almostGreaterThan, almostBetween } from "./util.js";

const axes = {
  x: new Point3d(1, 0, 0),
  y: new Point3d(0, 1, 0),
  z: new Point3d(0, 0, 1),
};
Object.freeze(axes.x);
Object.freeze(axes.y);
Object.freeze(axes.z);


/* Axis-aligned bounding box
  Represent a bounding box as a minimum and maximum point in 2d or 3d.
*/
export class AABB2d {
  static POINT_CLASS = PIXI.Point;

  static axes = ["x", "y"];

  /** @type {PIXI.Point} */
  // min = new this.constructor.POINT_CLASS(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  min = this.constructor.POINT_CLASS.tmp;

  /** @type {PIXI.Point} */
  // max = new this.constructor.POINT_CLASS(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  max = this.constructor.POINT_CLASS.tmp;

  constructor() { this._clear(); }

  _clear() {
    const { min, max } = this;
    for ( const axis of this.constructor.axes ) {
      min[axis] = Number.POSITIVE_INFINITY;
      max[axis] = Number.NEGATIVE_INFINITY;
    }
    return this;
  }

  release() {
    this.min.release();
    this.max.release();
  }

  /**
   * The width (delta) along each axis.
   * @returns {Point3d}
   */
  getDelta(out) {
    out ??= this.constructor.POINT_CLASS.tmp;
    return this.max.subtract(this.min, out);
  }

  /**
   * The half-width (extents) along each axis.
   */
  getExtents(out) {
    out ??= this.constructor.POINT_CLASS.tmp;
    this.getDelta(out);
    out.multiplyScalar(0.5, out);
    return out;
  }

  getCenter(out) {
    out ??= this.constructor.POINT_CLASS.tmp;
    this.getExtents(out);
    this.min.add(out, out);
    return out;
  }

  /**
   * Union multiple bounds.
   * @param {AABB2d[]} bounds
   * @param {AABB2d} out
   * @returns {AABB2d}
   */
  static union(bounds, out) {
    if ( out ) out._clear();
    else out = new this();
    const { min, max } = out;
    for ( const axis of this.axes ) {
      const boundsMin = bounds.map(b => b.min[axis]);
      const boundsMax = bounds.map(b => b.max[axis]);
      min[axis] = Math.min(...boundsMin, min[axis]);
      max[axis] = Math.max(...boundsMax, max[axis]);
    }
    return out;
  }

  /**
   * @param {PIXI.Point[]} pts    Points to include within the bounds
   * @param {AABB2d} out          The AABB to update; leave undefined to construct a new one
   * @returns {AABB2d}
   */
  static fromPoints(pts = [], out) {
    if ( out ) out._clear();
    else out = new this();
    const { min, max } = out;
    for ( const pt of pts ) {
      for ( const axis of this.axes ) {
        min[axis] = Math.min(pt[axis] ?? 0, min[axis]);
        max[axis] = Math.max(pt[axis] ?? 0, max[axis]);
      }
    }
    return out;
  }

  /**
   * @param {PIXI.Circle} circle
   * @returns {AABB2d}
   */
  static fromCircle(circle, out) {
    out ??= new this();
    const { x, y, radius } = circle;
    out.min.set(x - radius, y - radius);
    out.max.set(x + radius, y + radius);
    return out;
  }

  /**
   * @param {PIXI.Ellipse} ellipse
   * @returns {AABB2d}
   */
  static fromEllipse(ellipse, out) {
    out ??= new this();
    const { x, y, width, height } = ellipse;
    out.min.set(x - width, y - height);
    out.max.set(x + width, y + height);
    return out;
  }

  /**
   * @param {PIXI.Rectangle} rect
   * @returns {AABB2d}
   */
  static fromRectangle(rect, out) {
    out ??= new this();
    out.min.set(rect.left, rect.top);
    out.max.set(rect.right, rect.bottom);
    return out;
  }

  /**
   * @param {PIXI.Polygon} polygon
   * @returns {AABB2d}
   */
  static fromPolygon(poly, out) {
    // Iterating the points will determine the min/max values.
    return this.fromPoints(poly.iteratePoints({ close: false }), out);
  }

  /**
   * @param {PIXI.Circle|PIXI.Ellipse|PIXI.Rectangle|PIXI.Polygon}
   * @returns {AABB2d}
   */
  static fromShape(shape, out) {
    out ??= new this();
    if ( shape instanceof PIXI.Rectangle ) this.fromRectangle(shape, out);
    else if ( shape instanceof PIXI.Polygon ) this.fromPolygon(shape, out);
    else if ( shape instanceof PIXI.Circle ) this.fromCircle(shape, out);
    else if ( shape instanceof PIXI.Ellipse ) this.fromEllipse(shape, out);
    else if ( shape.toPolygon ) this.fromPolygon(shape.toPolygon(), out);
    else throw Error("AABB2d.fromShape|Shape not recognized", shape);
    return out;
  }

  /**
   * @param {Tile} tile
   * @returns {AABB2d}
   */
  static fromTile(tile, out) {
    return this.fromRectangle(tile.bounds, out);
  }

  static fromTileAlpha(tile, alphaThreshold, out) {
    alphaThreshold ??= tile.document.texture.alphaThreshold || 0;
    if ( !(alphaThreshold && tile.texture && tile.evPixelCache) ) return this.fromTile(tile, out);
    const bbox = tile.evPixelCache.getThresholdCanvasBoundingBox(alphaThreshold);
    return bbox instanceof PIXI.Polygon ? this.fromPolygon(bbox, out) : this.fromRectangle(bbox, out);
  }

  /**
   * @param {Wall} wall
   * @returns {AABB2d}
   */
  static fromWall(wall, out) {
    return this.fromEdge(wall.edge, out);
  }

  /**
   * @param {Edge} edge
   * @returns {AABB2d}
   */
  static fromEdge(edge, out) {
    return this.fromPoints([edge.a, edge.b], out);
  }

  /**
   * @param {Token} token
   * @returns {AABB2d}
   */
  static fromToken(token, out) {
    const border = token.tokenBorder;
    return this.fromShape(border, out);
  }

  /**
   * Copy this AABB to another.
   * @param {AABB2d} [other]
   * @returns {AABB2d} other
   */
  clone(out) {
    out ??= new this.constructor();
    out.min.copyFrom(this.min);
    out.max.copyFrom(this.max);
    return out;
  }

  /**
   * Does this bounding box almost contain the point?
   * @param {PIXI.Point} p
   * @param {number} [epsilon=1e-06]        How close to min/max for the point to count as contained
   * @returns {AABB2d}
   */
  almostContainsPoint(p, epsilon = 1e-06) {
    const { min, max } = this;
    for ( const axis of this.constructor.axes ) {
      if ( !almostBetween(p[axis], min[axis], max[axis], epsilon) ) return false
    }
    return true;
  }

  /**
   * Does this bounding box contain the point?
   * @param {PIXI.Point} p
   */
  containsPoint(p, axes) {
    axes ??= this.constructor.axes;
    const { min, max } = this;
    for ( const axis of axes ) {
      if ( !p[axis].between(min[axis], max[axis]) ) return false
    }
    return true;
  }

  /**
   * @param {PIXI.Point} [outPoint]
   * @returns {outPoint}
   */
  *iterateVertices(outPoint) {
    outPoint ??= new this.constructor.POINT_CLASS();
    const pts = [this.min, this.max];
    for ( const xType of pts ) {
      for ( const yType of pts ) {
        yield outPoint.set(xType.x, yType.y);
      }
    }
  }

  /**
   * Does this AABB overlap another?
   * @param {AABB2d} other
   * @returns {boolean}
   */
  overlapsAABB(other) {
    // Separating Axis Theorem: Must overlap on every axis.
    // A.minX <= B.maxX && A.maxX >= B.minX && ...same for y, z
    for ( const axis of this.constructor.axes ) {
      // If not overlapping on an axis, return false.
      if ( this.max[axis] < other.min[axis] || other.max[axis] < this.min[axis] ) return false;
    }
    return true;
  }

  /**
   * Does the segment cross the aabb bounds or is contained within?
   * @param {PIXI.Point|Point3d} a
   * @param {PIXI.Point|Point3d} b
   * @param {boolean} [axes]            Which axes to test? Usually used to limit to "x" and "y"
   * @returns {boolean}
   */
  overlapsSegment(a, b, axes) {
    axes ??= this.constructor.axes;
    const rayDirection = b.subtract(a);
    const epsilon = 1e-06;

    // Initialize t-interval for the infinite line's intersection with the AABB.
    let tmin = -Infinity;
    let tmax = Infinity;

    for ( const axis of axes ) {
      const min = this.min[axis];
      const max = this.max[axis];
      const p0 = a[axis];

      if ( Math.abs(rayDirection[axis]) < epsilon ) {
        // Segment is parallel to the slab for this axis.
        // If segment origin is outside the slab, it can never intersect.
        if ( p0 < min || p0 > max ) {
          rayDirection.release();
          return false;
        }
        // Otherwise, the infinite line is always within this slab. Proceed to next axis.
      }

      // Segment is not parallel.
      const invD = 1.0 / rayDirection[axis];
      let t1 = (min - p0) * invD;
      let t2 = (max - p0) * invD;

      // Ensure t1 is the intersection with the "near" plane and t2 with the "far" plane.
      if ( t1 > t2 ) [t1, t2] = [t2, t1]; // Swap.

      // Update the overall intersection interval [tmin, tmax].
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);

      // If the intersection interval becomes invalid, the line misses the box.
      if ( tmin > tmax ) {
        rayDirection.release();
        return false;
      }
    }

    // After checking all axes, [tmin, tmax] is the interval where the infinite
    // line intersects the AABB. The final step is to check if this interval
    // overlaps with the segment's own interval, which is [0, 1].
    // Two intervals [a, b] and [c, d] overlap if a <= d and b >= c.
    rayDirection.release();
    return almostGreaterThan(1.0, tmin) && almostLessThan(0.0, tmax);
    // return tmin <= 1.0 && tmax >= 0.0;
  }


  /**
   * Does a sphere overlap the bounds?
   * @param {Sphere} sphere
   * @returns {boolean}
   */
  overlapsSphere(sphere) {
    if ( this.containsPoint(sphere.center) ) return true;

    // https://stackoverflow.com/questions/28343716/sphere-intersection-test-of-aabb
    const { min, max } = this;
    let dmin = 0;
    for ( const axis of this.constructor.axes ) {
      const c = sphere.center[axis];
      if ( c < min[axis] ) dmin += Math.pow(c - min[axis], 2);
      else if ( c > max[axis] ) dmin += Math.pow(c - max[axis], 2);
    }
    return dmin <= sphere.radiusSquared;
  }

  toPIXIRectangle(out) {
    out ??= new PIXI.Rectangle();
    out.x = this.min.x;
    out.y = this.min.y;
    out.width = this.min.y, this.max.x - this.min.x;
    out.height = this.max.y - this.min.y;
    return out;
  }

  toFinite(out) {
    out = this.clone(out);
    for ( const axis of this.constructor.axes ) {
      if ( !Number.isFinite(out.max[axis]) ) out.max[axis] = 1e06;
      if ( !Number.isFinite(out.min[axis]) ) out.min[axis] = -1e06;
    }
    return out;
  }

  /**
   * Project this AABB onto an axis and return the min/max interval measurement.
   * @param {Point3d|PIXI.Point} axis
   * @returns {object}
   *   - @prop {number} min
   *   - @prop {number} max
   */
  projectOntoAxis(axis) {
    // Use "extents" optimization for speed.
    // Get center and extents (half-width).
    const center = this.getCenter();
    const extents = this.getExtents();

    // Project the center.
    const centerProj = center.dot(axis);

    // Project the radius (sum of absolute dot products of extents).
    // This works because the AABB axes are (1,0,0), (0,1,0), (0,0,1).
    const absAxis = axis.abs();
    const radius = extents.dot(absAxis);

    // Release unused vars.
    center.release();
    extents.release();
    absAxis.release();

    return { min: centerProj - radius, max: centerProj + radius };
  }

  // ----- NOTE: Debug ----- //
  draw2d({ draw, ...opts } = {}) {
    draw ??= new Draw();
    draw.point(this.min, opts);
    draw.point(this.max, opts);
  }
}
