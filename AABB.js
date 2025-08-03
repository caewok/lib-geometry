/* globals
PIXI,
*/
"use strict";

import { GEOMETRY_CONFIG } from "./const.js";
import { Point3d } from "./3d/Point3d.js";
import { Draw } from "./Draw.js";
import { almostLessThan } from "./util.js";

const ptOnes = new Point3d(1, 1, 1);
Object.freeze(ptOnes);

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

  static axes = ["x", "y", "z"];

  /** @type {PIXI.Point} */
  min = new this.constructor.POINT_CLASS(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);

  /** @type {PIXI.Point} */
  max = new this.constructor.POINT_CLASS(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

  /**
   * The width (delta) along each axis.
   * @returns {Point3d}
   */
  getDelta(out) {
    out ??= Point3d.tmp;
    return this.max.subtract(this.min, out);
  }

  getCenter(out) {
    const delta = this.getDelta();
    this.min.add(delta.multiplyScalar(0.5, out), out);
    delta.release();
    return out;
  }

  /**
   * Union multiple bounds.
   * @param {AABB2d} ....bounds
   * @returns {AABB2d}
   */
  static union(...bounds) {
    const out = new this();
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
    out ??= new this();
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
   * @param {Tile} tile
   * @returns {AABB2d}
   */
  static fromTile(tile, out) {
    return this.fromRectangle(tile.bounds, out);
  }

  static fromTileAlpha(tile, alphaThreshold = 0, out) {
    if ( !(alphaThreshold && tile.evPixelCache) ) return this.fromTile(tile, out);
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
    return border instanceof PIXI.Rectangle ? this.fromRectangle(border, out) : this.fromPolygon(border, out);
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
      if ( !p[axis].almostBetween(min[axis], max[axis], epsilon) ) return false
    }
    return true;
  }

  /**
   * Does this bounding box contain the point?
   * @param {PIXI.Point} p
   */
  containsPoint(p) {
    const { min, max } = this;
    for ( const axis of this.constructor.axes ) {
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
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {boolean}
   */
  overlapsSegment(a, b) {
    // See https://jacco.ompf2.com/2022/04/13/how-to-build-a-bvh-part-1-basics/
    const { min, max } = this.aabb;
    const rayOrigin = a;
    const rayDirection = b.subtract(a);
    const invDirection = ptOnes.divide(rayDirection);
    const t1 = Point3d.tmp;
    const t2 = Point3d.tmp;

    min.subtract(rayOrigin, t1).multiply(invDirection, t1);
    max.subtract(rayOrigin, t2).multiply(invDirection, t2);
    const xMinMax = Math.minMax(t1.x, t2.x);
    const yMinMax = Math.minMax(t1.y, t2.y);
    const zMinMax = Math.minMax(t1.z, t2.z);
    Point3d.release(t1, t2);
    const tmax = Math.min(xMinMax.max, yMinMax.max, zMinMax.max);

    let out = false;
    if ( tmax > 0 ) {
      const tmin = Math.max(xMinMax.min, yMinMax.min, zMinMax.min);
      out = tmax >= tmin && (tmin * tmin) < rayDirection.dot(rayDirection);
    }
    rayDirection.release();
    invDirection.release();
    return out;
  }

  /**
   * Does a sphere overlap the bounds?
   * @param {Sphere} sphere
   * @returns {boolean}
   */
  overlapsSphere(sphere) {
    if ( this.containsPoint(sphere.center) ) return true;

    // https://stackoverflow.com/questions/28343716/sphere-intersection-test-of-aabb
    const { min, max } = this.aabb;
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

  // ----- NOTE: Debug ----- //
  draw2d({ draw, ...opts } = {}) {
    draw ??= new Draw();
    draw.point(this.min, opts);
    draw.point(this.max, opts);
  }
}

export class AABB3d extends AABB2d {

  static POINT_CLASS = Point3d;

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
  static fromAABB2d(aabb2d, maxZ = 0, minZ = maxZ, out) {
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
    out = super.fromCircle(circle, out);
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
    out = super.fromEllipse(ellipse, out);
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
    out = super.fromRectangle(rect, out);
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
    out = super.fromPolygon(poly, out);
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
    if ( poly3d.objectOverlapsClassType("Circle3d") ) return this.fromCircle3d(poly3d, out);
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
   * Test if a convex planar shape overlaps the bounds.
   * @param {Polygon3d} poly3d
   * @return {boolean}
   */
  overlapsConvexPolygon3d(poly3d) {
    if ( poly3d.objectOverlapsClassType("Circle3d") ) return this.overlapsCircle3d(poly3d);

    // Early exit if polygon is empty
    if ( !poly3d.points || poly3d.points.length === 0 ) return false;

    // Check if any point is inside the AABB for early exit
    for ( const point of poly3d.points ) {
      if ( this.containsPoint(point) ) return true;
    }

    const testAxes = [
       axes.x, axes.y, axes.z, // AABB face normals.
       poly3d.plane.normal, // Plane N; already normalized.
    ];

    // Test AABB face normals
    for (const axis of testAxes) {
      if ( !this.overlapsOnAxis(poly3d, axis) ) return false;
    }

    // Test cross products of polygon edges with AABB edges
    const iter = poly3d.iteratePoints({ close: true });
    let a = iter.next().value;
    const edge = Point3d.tmp;
    for ( const b of iter ) {
      b.subtract(a, edge);
      if (edge.magnitudeSquared() < 1e-10) continue; // Skip degenerate edges

      // Test cross products with AABB edges
      for ( const axis of [axes.x, axes.y, axes.z] ) {
          const testAxis = edge.cross(axis).normalize();
          if ( testAxis.magnitudeSquared() < 1e-10 ) continue; // Skip parallel edges
          if ( !this.overlapsOnAxis(poly3d, testAxis) ) { edge.release(); return false; }
      }
      a = b;
    }
    edge.release();
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
}

GEOMETRY_CONFIG.AABB2d = AABB2d;
GEOMETRY_CONFIG.threeD.AABB3d = AABB3d;