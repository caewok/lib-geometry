/* globals
PIXI,
*/
"use strict";

import { Point3d } from "./Point3d.js";
import { almostLessThan } from "../util.js";
import { AABB2d } from "../AABB.js";

const axes = {
  x: new Point3d(1, 0, 0),
  y: new Point3d(0, 1, 0),
  z: new Point3d(0, 0, 1),
};
Object.freeze(axes.x);
Object.freeze(axes.y);
Object.freeze(axes.z);


export class AABB3d extends AABB2d {

  static POINT_CLASS = Point3d;

  static axes = ["x", "y", "z"];

  /** @type {Point3d} */
  min = new this.constructor.POINT_CLASS(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);

  /** @type {Point3d} */
  max = new this.constructor.POINT_CLASS(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

  /**
   * Convert a 2d AABB to a 3d AABB, by adding min and max z.
   * @param {AABB2d} aabb2d
   * @param {number} [maxZ=0]
   * @param {number} [minZ=maxZ]
   * @returns {AABB3d}
   */
  static fromAABB2d(aabb2d, out, { maxZ = 0, minZ = maxZ } = {}) {
    out ??= new this();
    out.min.set(aabb2d.min.x, aabb2d.min.y, minZ);
    out.max.set(aabb2d.max.z, aabb2d.max.y, maxZ);
    return out;
  }

  /**
   * @param {PIXI.Circle} circle            2d circle, assumed to be flat on the plane
   * @param {number} [elevationZ=0]         Intended elevation in the z axis
   * @returns {AABB3d}
   */
  static fromCircle(circle, out, { maxZ = 0, minZ = maxZ } = {}) {
    out ??= new this();
    super.fromCircle(circle, out);
    out.min.z = minZ;
    out.max.z = maxZ;
    return out;
  }

  /**
   * @param {PIXI.Ellipse} ellipse          2d ellipse, assumed to be flat on the plane
   * @param {number} [elevationZ=0]         Intended elevation in the z axis
   * @returns {AABB3d}
   */
  static fromEllipse(ellipse, out, { maxZ = 0, minZ = maxZ } = {}) {
    out ??= new this();
    super.fromEllipse(ellipse, out);
    out.min.z = minZ;
    out.max.z = maxZ;
    return out;
  }

  /**
   * @param {PIXI.Rectangle} rect           2d rectangle, assumed to be flat on the plane
   * @param {number} [elevationZ=0]         Intended elevation in the z axis
   * @returns {AABB3d}
   */
  static fromRectangle(rect, out, { maxZ = 0, minZ = maxZ } = {}) {
    out ??= new this();
    super.fromRectangle(rect, out);
    out.min.z = minZ;
    out.max.z = maxZ;
    return out;
  }

  /**
   * @param {PIXI.Polygon} poly             2d polygon, assumed to be flat on the plane
   * @param {number} [elevationZ=0]         Intended elevation in the z axis
   * @returns {AABB3d}
   */
  static fromPolygon(poly, out, { maxZ = 0, minZ = maxZ } = {}) {
    out ??= new this();
    super.fromPolygon(poly, out);
    out.min.z = minZ;
    out.max.z = maxZ;
    return out;
  }

  static fromShape(shape, out, { maxZ = 0, minZ = maxZ } = {}) {
    out ??= new this();
    super.fromShape(shape, out);
    out.min.z = minZ;
    out.max.z = maxZ;
    return out;
  }

  /**
   * @param {Tile} tile
   * @returns {AABB3d}
   */
  static fromTile(tile, out) {
    out = super.fromTile(tile, out);
    const elevZ = tile.elevationZ;
    out.max.z = elevZ;
    out.min.z = elevZ;
    return out;
  }

  /**
   * @param {Tile} tile
   * @returns {AABB3d}
   */
  static fromTileAlpha(tile, alphaThreshold, out) {
    out = super.fromTileAlpha(tile, alphaThreshold, out);
    const elevZ = tile.elevationZ;
    out.max.z = elevZ;
    out.min.z = elevZ;
    return out;
  }

  /**
   * @param {Edge} edge
   * @returns {AABB3d}
   */
  static fromWall(wall, out) {
    const { topZ, bottomZ } = wall;
    out = super.fromWall(wall, out);
    out.min.z = bottomZ
    out.max.z = topZ;
    return out;
  }

  /**
   * @param {Edge} edge
   * @returns {AABB3d}
   */
  static fromEdge(edge, out) {
    out = super.fromEdge(edge, out);
    const { a, b } = edge.elevationLibGeometry;
    out.min.z = Math.min(a.bottom ?? Number.NEGATIVE_INFINITY, b.bottom ?? Number.NEGATIVE_INFINITY);
    out.max.z = Math.max(a.top ?? Number.POSITIVE_INFINITY, b.top ?? Number.POSITIVE_INFINITY);
    return out;
  }

  /**
   * @param {Token} token
   * @returns {AABB3d}
   */
  static fromToken(token, out) {
    out = super.fromToken(token, out);
    out.min.z = token.bottomZ;
    out.max.z = token.topZ;
    return out;
  }

  /**
   * @param {Sphere} sphere
   * @returns {AABB3d}
   */
  static fromSphere(sphere, out) {
    out ??= new this();
    const { center, radius } = sphere;
    out.min.set(center.x - radius, center.y - radius, center.z - radius);
    out.max.set(center.x + radius, center.y + radius, center.z + radius);
    return out;
  }



  /**
   * @param {Polygon3d} poly3d
   * @returns {AABB3d}
   */
  static fromPolygon3d(poly3d, out) {
    if ( poly3d.overlapsClass("Circle3d") ) return this.fromCircle3d(poly3d, out);
    return this.fromPoints(poly3d.points, out);
  }

  /**
   * @param {Circle3d} circle3d
   * @returns {AABB3d}
   */
  static fromCircle3d(circle3d, out) {
    out ??= new this();

    // Project the radius onto each axis: sqrt(1 - normal[axis]**2)
    // Normal must be normalized.
    const rX = Math.sqrt(1 - (circle3d.plane.normal.x ** 2));
    const rY = Math.sqrt(1 - (circle3d.plane.normal.y ** 2));
    const rZ = Math.sqrt(1 - (circle3d.plane.normal.z ** 2));

    const { center, radius } = circle3d;
    out.min.set(
      center.x - (radius * rX),
      center.y - (radius * rY),
      center.z - (radius * rZ),
    );
    out.max.set(
      center.x + (radius * rX),
      center.y + (radius * rY),
      center.z + (radius * rZ),
    );
    return out;
  }

  static fromCircle3d_2(circle3d, out) {
    out ??= new this();

    // See https://stackoverflow.com/questions/2592011/bounding-boxes-for-circle-and-arcs-in-3d
    const angle = (A , B) => {
      const dot = A.dot(B);
      return dot <= -1.0 ? Math.PI
        : dot >= 1.0 ? 0.0
        : Math.acos(dot);
    }
    const N = circle3d.plane.normal;
    const ax = angle(N, axes.x);
    const ay = angle(N, axes.y);
    const az = angle(N, axes.z);
    const R = Point3d.tmp.set(Math.sin(ax), Math.sin(ay), Math.sin(az)) * circle3d.radius;
    const { x, y, z } = this.center;
    out.min.set(x - R.x, y - R.y, z - R.z);
    out.max.set(x + R.x, y + R.y, z + R.z);
    R.release();
    return out;
  }

  /**
   * Does this AABB overlap a wall or edge?
   * @param {Wall|Edge} edge
   * @returns {boolean}
   */
  overlapsEdge(edge) {
    if ( edge instanceof foundry.canvas.placeables.Wall ) edge = edge.edge;
    const a = Point3d.tmp.copyFrom(edge.a);
    const b = Point3d.tmp.copyFrom(edge.a);
    const c = Point3d.tmp.copyFrom(edge.b);
    const d = Point3d.tmp.coypFrom(edge.b);
    const elev = edge.elevationLibGeometry;
    a.z = elev.a.top ?? Number.MAX_SAFE_INTEGER;
    b.z = elev.a.bottom ?? Number.MIN_SAFE_INTEGER;
    c.z = elev.b.bottom ?? Number.MIN_SAFE_INTEGER;
    d.z = elev.b.top ?? Number.MAX_SAFE_INTEGER;
    const quad = Quad3d.from4Points(a, b, c, d);
    return this.overlapsConvexPolygon3d(quad);
  }

  /**
   * Test if a convex planar shape overlaps the bounds.
   * @param {Polygon3d} poly3d
   * @return {boolean}
   */
  overlapsConvexPolygon3d(poly3d) {
    if ( poly3d.overlapsClass("Circle3d") ) return this.overlapsCircle3d(poly3d);

    // Early exit if polygon is empty
    if ( !poly3d.points || poly3d.points.length === 0 ) return false;

    // Check if any point is inside the AABB for early exit
    for ( const point of poly3d.iteratePoints({ close: false }) ) {
      if ( this.containsPoint(point) ) return true;
    }

    // Test 1: AABB axes. (Polygon bounding box.)
    if ( !poly3d.aabb.overlapsAABB(this) ) return false;

    // Test 2: Polygon normal.
    if ( checkGap(this, poly3d, poly3d.plane.normal) ) return false;

    // Test 3: Edge cross products.
    // Test axis = Cross(PolygonEdge, BoxAxis) for all combinations.
    // BoxAxes are X(1,0,0), Y(0,1,0), Z(0,0,1).
    const axis = Point3d.tmp;
    const edgeDir = Point3d.tmp;
    for ( const edge of poly3d.iterateEdges() ) {
      edge.B.subtract(edge.A, edgeDir);

      // Cross with X axis (1, 0, 0) -> result is (0, edge.z, -edge.y)
      if ( checkGap(this, poly3d, axis.set(0, -edgeDir.z, edgeDir.y)) ) return false;

      // Cross with Y axis (0, 1, 0) -> result is (-edge.z, 0, edge.x)
      if ( checkGap(this, poly3d, axis.set(edgeDir.z, 0, -edgeDir.x)) ) return false;

      // Cross with Z axis (0, 0, 1) -> result is (edge.y, -edge.x, 0)
      if ( checkGap(this, poly3d, axis.set(-edgeDir.y, edgeDir.x, 0)) ) return false;
    }
    axis.release();
    edgeDir.release();

    // If no separating axis found, they overlap.
    return true;
  }

  // Helper method to project both shapes onto an axis and check for overlap
  overlapsOnAxis(poly3d, axis) {
    let minA = Number.POSITIVE_INFINITY;
    let maxA = Number.NEGATIVE_INFINITY;
    let minB = Number.POSITIVE_INFINITY;
    let maxB = Number.NEGATIVE_INFINITY;

    // Project AABB onto the axis
    // Implementation depends on how you want to handle the AABB projection
    // This is a simplified version
    const aabbVertices = this.iterateVertices();
    for (const v of aabbVertices) {
        const proj = v.dot(axis);
        minA = Math.min(minA, proj);
        maxA = Math.max(maxA, proj);
    }

    // Project polygon onto the axis
    for (const point of poly3d.points) {
        const proj = point.dot(axis);
        minB = Math.min(minB, proj);
        maxB = Math.max(maxB, proj);
    }

    // Check for overlap
    return !(maxA < minB || maxB < minA);
  }

  overlapsCircle3d(circle3d) {
    const { min, max } = this;
    const { center, radiusSquared, plane } = circle3d;

    // Early exit if center is inside AABB
    if ( this.containsPoint(center) ) return true;

    // Find the point on the AABB closest to the circle's center.
    const closestPoint = Point3d.tmp.set(
      Math.max(min.x, Math.min(center.x, max.x)),
      Math.max(min.y, Math.min(center.y, max.y)),
      Math.max(min.z, Math.min(center.z, max.z)),
    );

    // Project this closest point onto the circle's plane.
    const planePoint = plane.projectPointOnPlane(closestPoint);
    const centerPoint = plane.projectPointOnPlane(center);

    // Check if the projected point is inside the circle.
    const dist2 = PIXI.Point.distanceSquaredBetween(planePoint, centerPoint);
    Point3d.release(closestPoint, planePoint, centerPoint);
    return almostLessThan(dist2, radiusSquared);
  }

  /**
   * @param {Point3d} [outPoint]
   * @returns {outPoint}
   */
  *iterateVertices(outPoint) {
    outPoint ??= new this.constructor.POINT_CLASS();
    const pts = [this.min, this.max];
    for ( const xType of pts ) {
      for ( const yType of pts ) {
        for ( const zType of pts) {
          yield outPoint.set(xType.x, yType.y, zType.z);
        }
      }
    }
  }

  // ----- NOTE: Projection and Separating Axis Theorem ----- //

}

// Helper functions.

/**
 * Tests if two intervals overlap.
 * @param {AABB3d|AABB2d} aabb
 * @param {Polygon3d|PIXI.Polygon} polygon
 * @param {Point3d|PIXI.Point} axis
 * @returns {boolean} True if there is a gap (separating axis).
 */
function checkGap(aabb, polygon, axis) {
  // Ignore zero-length axes (can happen with parallel cross products)
  if ( axis.dot(axis).almostEqual(0) ) return false;

  const aabbInt = aabb.projectOntoAxis(axis);
  const polyInt = projectPolygon(polygon, axis);

  // If there is a gap, return true (found a separating axis)
  return (aabbInt.min > polyInt.max || polyInt.min > aabbInt.max);
}

/**
 * Projects a Polygon3d onto an axis and returns the [min, max] interval.
 * @param {Polygon3d|PIXI.Polygon} polygon
 * @param {Point3d|PIXI.Point} axis
 * @returns {object}
 *   - @prop {number} min
 *   - @prop {number} max
 */
function projectPolygon(polygon, axis) {
  let min = Infinity;
  let max = -Infinity;
  polygon.iteratePoints({ close: false }).forEach(pt => {
    const val = pt.dot(axis);
    min = Math.min(min, val);
    max = Math.max(max, val);
  });
  return { min, max };
}
