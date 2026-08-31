/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI,
*/
"use strict";

import { Point3d } from "./3d/Point3d.js";
import { Draw } from "./Draw.js";
import { almostLessThan, almostGreaterThan, almostBetween } from "./util.js";
import { GEOMETRY_LIB_ID } from "./const.js";

const axes = {
  x: new Point3d(1, 0, 0),
  y: new Point3d(0, 1, 0),
  z: new Point3d(0, 0, 1),
};
Object.freeze(axes.x);
Object.freeze(axes.y);
Object.freeze(axes.z);

// Temporary points. Need 4 to accommodate the transform method.
const tmpPoints = Point3d.createN(4);

/**
 * Axis-aligned bounding box
 * Represent a bounding box as a minimum and maximum point in 2d or 3d.
 * The maximum row/column/z are considered inclusive. I.e., the range is [min, max], not [min, max).
 */
Symbol.dispose ??= Symbol("Symbol.dispose");

export class AABB2d {

  static [Symbol.hasInstance](instance) {
    return instance && instance.constructor && instance.constructor._geoLibType === this._geoLibType;
  }

  static _geoLibType = "AABB2d";

  static POINT_CLASS = PIXI.Point;

  static axes = ["x", "y"];

  /** @type {PIXI.Point} */
  // min = new this.constructor.POINT_CLASS(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  min = this.constructor.POINT_CLASS.tmp;

  /** @type {PIXI.Point} */
  // max = new this.constructor.POINT_CLASS(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  max = this.constructor.POINT_CLASS.tmp;

  // Getters to mirror expected data in PIXI.Rectangle. Mostly for Quadtree.

  /** @type {PIXI.Point} */
  get x() { return this.min.x; }

  get y() { return this.min.y; }

  /** @type {PIXI.Point} */
  get length() {
    const out = this.constructor.POINT_CLASS.tmp;
    const { min, max } = this;
    for ( const axis of this.constructor.axes ) out[axis] = max[axis] - min[axis];
    return out;
  }

  get width() { return this.max.x - this.min.x; }

  get height() { return this.max.y - this.min.y; }

  get center() {
    const out = Point3d.tmp;
    return this.min.add(this.max.subtract(this.min, out).multiplyScalar(0.5, out), out); // min + ((max - min) * 0.5)
  }

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

  [Symbol.dispose]() { this.release(); }

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
   * Increase or decrease this AABB.
   * @param {object} axes
   * - Ex: { x: 2, y: -2 }
   * @param {AABB} out
   * @returns {AABB}
   */
  pad(axes = {}, out) {
    out ??= new this.constructor();
    this.clone(out);
    for ( const [axis, value] of Object.entries(axes) ) {
      this.min[axis] -= value;
      this.max[axis] += value;
    }
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
    const n = bounds.length;
    const tmpArr = Array(n * 2);
    for ( const axis of this.axes ) {
      let i = 0;
      for ( const b of bounds ) {
        tmpArr[i++] = b.min[axis];
        tmpArr[i++] = b.max[axis];
      }
      const minMaxAxis = Math.minMax(...tmpArr);
      out.min[axis] = minMaxAxis.min;
      out.max[axis] = minMaxAxis.max;
    }
    return out;
  }

  // ----- NOTE: Factory methods ----- //

  /**
   * @param {PIXI.Point[]} pts    Points to include within the bounds
   * @param {AABB2d} out          The AABB to update; leave undefined to construct a new one
   * @returns {AABB2d}
   */
  static fromPoints(pts = [], out) {
    out ??= new this();
    const n = pts.length;
    for ( const axis of this.axes ) {
      const values = new Array(n);
      for ( let i = 0; i < n; i += 1 ) values[i] = pts[i][axis] || 0;
      const minMax = Math.minMax(...values);
      out.min[axis] = minMax.min;
      out.max[axis] = minMax.max;
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
   * @param {PIXI.RoundedRectangle} rect
   * @returns {AABB2d}
   */
  static fromRoundedRectangle(rrect, out) {
    // Ignore rounded edges.
    return this.fromRectangle(rrect, out);
  }

  /**
   * @param {PIXI.Polygon} polygon
   * @returns {AABB2d}
   */
  static fromPolygon(poly, out) {
    // Iterating the points will determine the min/max values.
    return this.fromPoints(poly.iteratePoints(), out);
  }

  /**
   * @param {PIXI.Circle|PIXI.Ellipse|PIXI.Rectangle|PIXI.Polygon}
   * @returns {AABB2d}
   */
  static fromShape(shape, out) {
    out ??= new this();
    if ( shape instanceof AABB2d ) shape.clone(out);
    else if ( shape instanceof PIXI.Rectangle ) AABB2d.fromRectangle(shape, out);
    else if ( shape instanceof PIXI.Polygon ) AABB2d.fromPolygon(shape, out);
    else if ( shape instanceof PIXI.Circle ) AABB2d.fromCircle(shape, out);
    else if ( shape instanceof PIXI.Ellipse ) AABB2d.fromEllipse(shape, out);
    else if ( shape instanceof PIXI.RoundedRectangle ) AABB2d.fromRoundedRectangle(shape, out);
    else if ( shape.toPolygon ) AABB2d.fromPolygon(shape.toPolygon(), out);
    else throw Error("AABB2d.fromShape|Shape not recognized", shape);
    return out;
  }

  /**
   * @param {Tile} tile
   * @returns {AABB2d}
   */
  static fromTile(tile, out) {
    return AABB2d.fromRectangle(tile.bounds, out);
  }

  static fromTileDocument(tileD, out) {
    return AABB2d.fromRectangle(tileD.shape.bounds, out);
  }

  static fromLevel(level, { textureWidth, textureHeight, type = "background", out } = {}) {
    const src = level[type].src;
    if ( src && !(textureWidth && textureHeight) ) {
      const tex = PIXI.Assets.get(level[type].src) || {};
      textureWidth ??= tex.width;
      textureHeight ??= tex.height;
    }
    if ( !(textureWidth && textureHeight) ) {
      console.warn(`AABB.fromLevel ${level.name} (${level.id}) ${type} estimated using canvas scene dimensions.`);
      return AABB2d.fromRectangle(canvas.dimensions.sceneRect, out);
    }

    const texData = level.textures || {};
    const { anchorX = 0.5, anchorY = 0.5, scaleX = 1, scaleY = 1, offsetX = 0, offsetY = 0, rotation = 0 } = texData;
    const rotationRadians = Math.toRadians(rotation);

    // Define texture corner coordinates relative to the anchor point.
    using dims = PIXI.Point.tmp.set(textureWidth, textureHeight);
    using scale = PIXI.Point.tmp.set(scaleX, scaleY);
    using offset = PIXI.Point.tmp.set(offsetX, offsetY);
    const corners = tmpPoints; // NOTE: Already defined as 4 points.
    corners[0].set(-anchorX, -anchorY);
    corners[1].set(1 -anchorX, -anchorY);
    corners[2].set(1 -anchorX, 1 -anchorY);
    corners[3].set(-anchorX, 1 -anchorY);
    const cos = Math.cos(rotationRadians);
    const sin = Math.sin(rotationRadians);

    // Scale, rotate, and offset each corner point to scene space.
    // corner * dims * scale
    // res.x = corner.x * cos - corner.y * sin
    // res.y = corner.x * sin - corner.y * cos
    // res + offset
    corners.forEach(corner => {
      corner.multiply(dims, corner).multiply(scale, corner);
      const x = corner.x * cos - corner.y * sin;
      const y = corner.x * cos - corner.y * sin;
      corner.set(x, y);
    });

    // Extract min/max coordinates.
    return this.fromPoints(corners, out);
  }

  /**
   * @param {Wall} wall
   * @returns {AABB2d}
   */
  static fromWall(wall, out) {
    return this.fromEdge(wall.edge, out);
  }

  static fromWallDocument(wallD, out) {
    const a = tmpPoints[0].set(wallD.c[0], wallD.c[1]);
    const b = tmpPoints[1].set(wallD.c[2], wallD.c[3]);
    return this.fromPoints([a, b], out);
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
    return AABB2d.fromShape(border, out);
  }

  /**
   * @param {TokenDocument} tokenD
   * @returns {AABB2d}
   */
  static fromTokenDocument(tokenD, out) {
    const border = tokenBorder(tokenD);
    return AABB2d.fromShape(border, out);
  }

  /**
   * Copy this AABB to another.
   * @param {AABB2d} [other]
   * @returns {AABB2d} other
   */
  clone(out) {
    if ( out === this ) return this;
    out ??= new this.constructor();
    out.min.copyFrom(this.min);
    out.max.copyFrom(this.max);
    return out;
  }

  /**
   * Inverse of clone.
   * @param {AABB} other
   * @returns {this}
   */
  copyFrom(other) {
    if ( other === this ) return this;
    this.min.copyFrom(other.min);
    this.max.copyFrom(other.max);
    return this;
  }

  // ----- NOTE: Containment tests ----- //

  /**
   * For compatibility with PIXI objects approach.
   * @param {number} x
   * @param {number} y;
   */
  contains(x, y) { return this.containsPoint({ x, y }); }

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

  // ----- NOTE: Overlap tests ----- //

  /**
   * Generic overlaps test.
   * @param {*} shape
   * @returns {boolean}
   */
  overlaps(shape) {
    if ( shape instanceof AABB2d ) return this.overlapsAABB(shape);
    if ( shape instanceof PIXI.Rectangle ) return this.overlapsRectangle(shape);
    console.error("AABB2d|overlaps shape not recognized", shape);
    return false;
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
   * Does this AABB overlap a PIXI.Rectangle?
   * @param {PIXI.Rectangle} rect
   * @returns {boolean}
   */
  overlapsRectangle(rect) {
    // See overlapsAABB.
    const xMinMax = Math.minMax(rect.left, rect.right);
    const yMinMax = Math.minMax(rect.top, rect.bottom);
    return !(this.max.x < xMinMax.min || xMinMax.max < this.min.x ||
             this.max.y < yMinMax.min || yMinMax.max < this.min.y);
  }

  /**
   * Does this AABB overlap a wall or edge?
   * @param {Wall|Edge} edge
   * @returns {boolean}
   */
  overlapsEdge(edge) {
    if ( edge instanceof foundry.canvas.placeables.Wall ) edge = edge.edge;
    return this.overlapsSegment(edge.a, edge.b);
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
    const rayDirection = b.subtract(a, tmpPoints[0]);
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
        if ( p0 < min || p0 > max ) return false;
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
      if ( tmin > tmax ) return false;
    }

    // After checking all axes, [tmin, tmax] is the interval where the infinite
    // line intersects the AABB. The final step is to check if this interval
    // overlaps with the segment's own interval, which is [0, 1].
    // Two intervals [a, b] and [c, d] overlap if a <= d and b >= c.
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

  // ----- NOTE: Intersections ----- //

  /**
   * Calculate the first intersection point of a ray with this AABB.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @returns {number[]} Where along the ray the intersection occurs, if any.
   *   Returns values behind the ray as well.
   */
  rayIntersectionsT(rayOrigin, rayDirection, axes) {
    // Uses modified slab method.
    const EPSILON = 1e-06;
    axes ??= this.constructor.axes;
    let tMin = Number.NEGATIVE_INFINITY;
    let tMax = Number.POSITIVE_INFINITY;
    for ( const axis of axes ) {
      const o = rayOrigin[axis];
      const d = rayDirection[axis];
      const bMin = this.min[axis];
      const bMax = this.max[axis];

      if ( Math.abs(d) < EPSILON ) {
        // Ray is parallel to the slab's planes.
        // If origin is outside this slab, it misses entirely.
        if ( o < bMin || o > bMax ) return [];
      } else {
        // Distance to near and far planes of the current slab.
        const invD = 1 / d;
        let t1 = (bMin - o) * invD;
        let t2 = (bMax - o) * invD;

        // Ensure t1 is near and t2 is far.
        if ( t1 > t2 ) [t1, t2] = [t2, t1];

        // Update entry and exit distances for the entire AABB.
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);

        // If entry distance exceeds exit distances, ray misses.
        if ( tMin > tMax ) return [];
      }
    }

    // If tMin and tMax are equal, ray perfectly grazes a corner.
    if ( tMin.almostEqual(tMax) ) return [tMin];
    return [tMin, tMax];
  }

  // ----- NOTE: Conversions ----- //

  toRectangle(out) {
    out ??= new PIXI.Rectangle();
    out.x = this.x;
    out.y = this.y;

    const length = this.length;
    out.width = length.x;
    out.height = length.y;
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
    using center = this.getCenter();
    using extents = this.getExtents();

    // Project the center.
    const centerProj = center.dot(axis);

    // Project the radius (sum of absolute dot products of extents).
    // This works because the AABB axes are (1,0,0), (0,1,0), (0,0,1).
    using absAxis = axis.abs();
    const radius = extents.dot(absAxis);
    return { min: centerProj - radius, max: centerProj + radius };
  }

  /**
   * Transform using a 3x3 matrix.
   * @param {Matrix<3x3>} M
   * @param {AABB2d} out
   * @returns {AABB2d}
   */
  transform(M, out) {
    const { min, max } = this;

    // Generate all 4 points of the current AABB.
    const corners = [
      tmpPoints[0].set(min.x, min.y),
      tmpPoints[1].set(min.x, max.y),
      tmpPoints[2].set(max.x, min.y),
      tmpPoints[3].set(max.x, max.y),
    ];

    // Transform each corner using the matrix.
    corners.forEach(pt => M.multiplyPoint2d(pt, pt));

    // Build the new axis-aligned bounds.
    return this.constructor.fromPoints(corners, out);
  }

  // ----- NOTE: Equality ----- //

  /**
   * Is this bounding box equivalent to another?
   * @param {AABB} other
   * @returns {boolean}
   */
  equals(other) {
    for ( const axis of this.constructor.axes ) {
      if ( !(this.min[axis].equals(other.min[axis])
          && this.max[axis].equals(other.max[axis])) ) return false;
    }
    return true;
  }

  /**
   * Is this bounding box almost equivalent to another?
   * @param {AABB} other
   * @returns {boolean}
   */
  almostEqual(other, epsilon) {
    for ( const axis of this.constructor.axes ) {
      if ( !(this.min[axis].almostEqual(other.min[axis], epsilon)
          && this.max[axis].almostEqual(other.max[axis], epsilon)) ) return false;
    }
    return true;
  }

  // ----- NOTE: Debug ----- //
  draw2d({ draw, ...opts } = {}) {
    draw ??= new Draw();
    draw.point(this.min, opts);
    draw.point(this.max, opts);
  }
}


// From Token:
function tokenCenter(tokenDocument) {
  const { x, y } = tokenDocument;
  const { width, height } = tokenDocument.getSize();
  return PIXI.Point.tmp.set(x + (width * 0.5), y + (height * 0.5));
}

function tokenBounds(tokenDocument) {
  const { x, y } = tokenDocument;
  const { width, height } = tokenDocument.getSize();
  return new PIXI.Rectangle(x, y, width, height);
}

function getShape(tokenDocument) {
  if ( canvas.scene.grid.isGridless ) {
    const { width, height } = tokenDocument.getSize();
    const shape = tokenDocument.shape;
    if ( (shape === CONST.TOKEN_SHAPES.ELLIPSE_1) || (shape === CONST.TOKEN_SHAPES.ELLIPSE_2) ) {
      if ( width === height ) {
        const radius = width / 2;
        return new PIXI.Circle(radius, radius, radius);
      }
      const radiusX = width / 2;
      const radiusY = height / 2;
      return new PIXI.Ellipse(radiusX, radiusY, radiusX, radiusY);
    }
    return new PIXI.Rectangle(0, 0, width, height);
  }
  return new PIXI.Polygon(tokenDocument.getGridSpacePolygon());
}


function tokenBorder(tokenDocument) {
  // TODO: Does rotation count?

  // Treat sphere as circle at largest radii.
  if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.useTokenSphere ) {
    const { width, height } = tokenDocument;
    const center = tokenCenter(tokenDocument);
    const pixelWidth = width * canvas.dimensions.size;
    const pixelHeight = height * canvas.dimensions.size;
    const radius = Math.max(pixelWidth, pixelHeight) * 0.5; // Only care about 2d here.
    return new PIXI.Circle(center.x, center.y, radius);
  }

  /* Shape options
  In dnd5e at least, shapes change based on grid type.
  But the underlying token document shape may be different.
  Further, prototype tokens do not get a shape.
  See Token#getShape.

  Options available in the token config:
  Square grid:
    RECTANGLE_1: PIXI.Polygon.

  Hex grid:
    - All 6 options. Some may not change depending on token. Result is always PIXI.Polygon.

  Gridless:
   - ELLIPSE_1: PIXI.Circle or PIXI.Ellipse
   - RECTANGLE_1: PIXI.Rectangle
  */

  // If square grid, use token bounds, which form a rectangle, instead of token shape (polygon).
  // If canvas not fully loaded, this.shape may be undefined.

  if ( canvas.grid.isSquare ) return tokenBounds(tokenDocument);
  const shape = getShape(tokenDocument);
  return shape.translate(tokenDocument.x, tokenDocument.y); // Return new shape; do not modify original.
}
