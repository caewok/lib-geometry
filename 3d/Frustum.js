/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_LIB_ID } from "../const.js";
import { Point3d } from "./Point3d.js";
import { Triangle3d, Quad3d } from "./Polygon3d.js";
import { AABB3d } from "./AABB3d.js";
import { gridUnitsToPixels, almostLessThan } from "../util.js";

/**
 * The viewable area between viewer and target.
 * Comprised of 4 triangle3ds, forming a pyramid, with a quad3d as the base.
 * Point of the triangle is the viewpoint.
 *
 */
export class Frustum {

  top = new Triangle3d();

  bottom = new Triangle3d();

  right = new Triangle3d();

  left = new Triangle3d();

  floor = new Quad3d();

  aabb = new AABB3d();

  clone() {
    const out = new this();
    out.top.copyFrom(this.top);
    out.bottom.copyFrom(this.bottom);
    out.right.copyFrom(this.right);
    out.left.copyFrom(this.left);
    out.floor.copyFrom(this.floor);
    out.aabb.copyFrom(this.aabb);
    return out;
  }

  /** @type {Point3d} */
  get viewpoint() { return this.top.a; }

  set viewpoint(vp) {
    for ( const side of [this.top, this.bottom, this.right, this.left] ) {
      side.a.copyFrom(vp);
      side.clearCache();
    }
    this.setAABB();
  }

  /**
   * Define the bounding box for this frustum.
   */
  setAABB() { AABB3d.union([this.floor.aabb, this.top.aabb], this.aabb); }


  /**
   * Determine the 3d (volumetric) center of the pyramid.
   * @type {Point3d}
   */
  get centroid() {
    const baseCentroid = this.floor.centroid;

    // Center of pyramid is 1/4 of the way from the base to the viewpoint.
    using tmp = Point3d.tmp;
    return this.viewpoint.add(baseCentroid.multiplyScalar(3, tmp), tmp).multiplyScalar(1/4);
  }

  /**
   * Verify that the frustum faces all face outward; adjust if necessary.
   */
  _verifyOrientation() {
    // Ensure the face normals all point away.
    const centroid = this.centroid;
    for ( const face of this.iterateFaces(true) ) {
      if ( face.orient3d(centroid) > 0 ) {
        if ( face instanceof Quad3d ) {
          // Quad: Swap b and d to invert winding direction.
          using tmp = face.b.clone();
          face.b.copyFrom(face.d);
          face.d.copyFrom(tmp);
        } else {
          // Triangle: Swap b and c
          using tmp = face.b.clone();
          face.b.copyFrom(face.c);
          face.c.copyFrom(tmp);
        }
        face.clearCache();
      }
    }
  }

  /**
   * Build the frustum from four corners of the floor plus the viewpoint.
   * @param {Point3d} viewpoint
   * @param {object}  corners
   * - @prop {Point3d} TL     Point a of the floor
   * - @prop {Point3d} TR     Point b of the floor
   * - @prop {Point3d} BR     Point c of the floor
   * - @prop {Point3d} BL     Point d of the floor
   */
  static fromCorners(viewpoint, corners, frustum) {
    const { TL, TR, BR, BL } = corners;
    frustum ??= new this();

    // Assign the points to the frustum.
    frustum.top.a.copyFrom(viewpoint);
    frustum.top.b.copyFrom(TR);
    frustum.top.c.copyFrom(TL);

    frustum.bottom.a.copyFrom(viewpoint);
    frustum.bottom.b.copyFrom(BL);
    frustum.bottom.c.copyFrom(BR);

    frustum.left.a.copyFrom(viewpoint);
    frustum.left.b.copyFrom(TL);
    frustum.left.c.copyFrom(BL);

    frustum.right.a.copyFrom(viewpoint);
    frustum.right.b.copyFrom(BR);
    frustum.right.c.copyFrom(TR);

    frustum.floor.a.copyFrom(TL);
    frustum.floor.b.copyFrom(TR);
    frustum.floor.c.copyFrom(BR);
    frustum.floor.d.copyFrom(BL);

    // Reset cache.
    for ( const face of frustum.iterateFaces(true) ) face.clearCache();

    // Ensure the face normals all point away.
    frustum._verifyOrientation()

    // Finalize the bounding box.
    frustum.setAABB();

    return frustum;
  }

  /**
   * Vision Polygon for the view point --> target.
   * From the given token location, get the edge-most viewable points of the target.
   * Construct a triangle between the two target points and the token center.
   * If viewing head-on (only two key points), the portion of the target between
   * viewer and target center (typically, a rectangle) is added on to the triangle.
   * @param {PIXI.Point|Point3d} viewpoint
   * @param {PIXI.Polygon|PIXI.Rectangle} border2d
   * @param {number} [topZ=0]
   * @param {number} [bottomZ=topZ]
   * @returns {Frustum}
   */
  static build(opts = {}) {
    const out = new this();
    if ( !(opts.border2d || opts.target) ) {
      console.warn("Frustum|One of border2d or target shold be provided.", opts);
      return out;
    }
    return out.rebuild(opts);
  }

  /**
   * Create a frustum from a target token.
   * @param {Token} target
   * @param {object} [opts={}]        Options passed to from2dBorder; must contain viewpoint
   * @param {PIXI.Polygon|PIXI.Rectangle} [opts.border2d]   A 2d object with a center property and iteratePoints method
   * @param {number} [opts.topZ]                   The top elevation of the target
   * @param {number} [opts.bottomZ]                The bottom elevation of the target
   * @param {Frustum} [opts.frustum]                    Existing frustum to modify
   * @returns {Frustum}
   */
  static fromTarget(target, { border2d, topZ, bottomZ, ...opts } = {}) {
    border2d ??= (CONFIG[GEOMETRY_LIB_ID].CONFIG.constrainTokens ? target.constrainedTokenBorder : target.tokenBorder);
    topZ ??= target.topZ;
    bottomZ ??= target.bottomZ;
    return this.from2dBorder({ border2d, topZ, bottomZ, ...opts });
  }

  /**
   * Create a frustum from a bounding box.
   * @param {AABB3d} aabb
   * @param {Point3d} [opts.viewpoint]      The viewpoint from which the frustum extends
   * @param {boolean} [opts.infiniteDistance=false]     Should the frustum extend indefinitely?
   * @param {Frustum} [opts.frustum]                    Existing frustum to modify
   * @returns {Frustum}
   */
  static fromAABB(aabb, opts) {
    using w = Point3d.tmp.set(aabb.width, 0, 0);
    using h = Point3d.tmp.set(0, aabb.height, 0);
    using wh = Point3d.tmp.set(aabb.width, aabb.height, 0);
    const targetPoints = [
      // Bottom
      aabb.min.clone(), // TL
      aabb.min.add(w), // TR
      aabb.min.add(h), // BL
      aabb.min.add(wh), // BR

      // Top
      aabb.max.clone(), // BR
      aabb.max.subtract(w), // BL
      aabb.max.subtract(h), // TR
      aabb.max.subtract(wh), // TL
    ];
    const out = this.fromBorderPoints(targetPoints, aabb.center, opts);
    targetPoints.forEach(pt => pt.release());
    return out;
  }


  /**
   * Create a frustum from a set of 3d border points around a target.
   * @param {Point3d[]} targetBorderPoints        The points defining the target 3d border
   * @param {Point3d} targetCenter                The 3d center of the target (focal point)
   * @param {object} [opts]
   * @param {Point3d} [opts.viewpoint]      The viewpoint from which the frustum extends
   * @param {boolean} [opts.infiniteDistance=false]     Should the frustum extend indefinitely?
   * @param {Frustum} [opts.frustum]                    Existing frustum to modify
   * @returns {Frustum}
   */
  static fromBorderPoints(targetBorderPoints, targetCenter, { viewpoint, infiniteDistance = false, frustum } = {}) {
    if ( !frustum && typeof viewpoint === "undefined" ) console.error("Frustum.from2dBorder|Either frustum or viewpoint must be provided.");
    frustum ??= new this();

    // Use existing properties if undefined.
    viewpoint ??= frustum.viewpoint;

    // Derive the camera's local orthonormal basis.
    using dir = targetCenter.subtract(viewpoint);
    const distToCenter = dir.magnitude();
    const N = dir.normalize(dir); // Forward/view vector.

    // Right vector using world's vertical axis
    using upWorld = Point3d.tmp.set(0, 0, 1);
    using right = upWorld.cross(N);
    if ( right.magnitudeSquared().almostEqual(0) ) right.set(1, 0, 0); // Fallback if looking perfectly up/down.
    else right.normalize(right);
    using vUp = N.cross(right);
    vUp.normalize(vUp); // True local vertical up vector.

    // Establish the base plane distance
    const distPlane = infiniteDistance ? canvas.dimensions.maxR : distToCenter;
    using planeCenter = Point3d.tmp;
    viewpoint.add(N.multiplyScalar(distPlane, planeCenter), planeCenter);

    // Project each 3d vertex of the extruded prism onto the base plane.
    let uMin = Number.POSITIVE_INFINITY;
    let uMax = Number.NEGATIVE_INFINITY;
    let vMin = Number.POSITIVE_INFINITY;
    let vMax = Number.NEGATIVE_INFINITY;
    using vToP = Point3d.tmp;
    using pProj = Point3d.tmp;
    using vec = Point3d.tmp;

    for ( const P of targetBorderPoints) {
      P.subtract(viewpoint, vToP);

      const dotPN = vToP.dot(N);
      if ( almostLessThan(dotPN, 0) ) continue; // Ignore vertices behind near-plane truncation.

      const t = distPlane / dotPN;
      viewpoint.add(vToP.multiplyScalar(t, pProj), pProj);

      // Transform projected point to local plane coordinates (u, v).
      pProj.subtract(planeCenter, vec);
      const u = vec.dot(right);
      const v = vec.dot(vUp);

      uMin = Math.min(uMin, u);
      uMax = Math.max(uMax, u);
      vMin = Math.min(vMin, v);
      vMax = Math.max(vMax, v);
    }

    // Map base corners.
    using am = right.multiplyScalar(uMin);
    using bm = right.multiplyScalar(uMax);
    using bv = vUp.multiplyScalar(vMax);
    using sv = vUp.multiplyScalar(vMin);
    using TL = Point3d.tmp;
    using TR = Point3d.tmp;
    using BR = Point3d.tmp;
    using BL = Point3d.tmp;

    planeCenter.add(am, TL).add(bv, TL); // Top-Left
    planeCenter.add(bm, TR).add(bv, TR); // Top-Right
    planeCenter.add(bm, BR).add(sv, BR); // Bottom-Right
    planeCenter.add(am, BL).add(sv, BL); // Bottom-Left

    // Rebuild the converging pyramid side faces.
    return this.fromCorners(viewpoint, { TL, TR, BR, BL }, frustum);
  }

  /**
   * Create a frustum from a 2d border.
   * @param {PIXI.Polygon|...} border2d          A 2d object with a center property and iteratePoints method
   * @param {object} [opts={}]                          Options to define the frustum
   * @param {number} [opts.topZ]                        The top elevation of the target
   * @param {number} [opts.bottomZ]                     The bottom elevation of the target
   * @returns {Frustum}
   */
  static from2dBorder(border2d, { topZ = 1, bottomZ = 0, ...opts } = {}) {
    // Calculate the 3d center of the boundary shape.
    const center2d = border2d.center;
    const targetCenter = Point3d.tmp.set(center2d.x, center2d.y, (topZ + bottomZ) * 0.5);
    const targetPoints = [];
    for ( const p2d of border2d.iteratePoints() ) {
      for ( const z of [topZ, bottomZ] ) {
        targetPoints.push(Point3d.tmp.set(p2d.x, p2d.y, z));
      }
    }
    const out = this.fromBorderPoints(targetPoints, targetCenter, opts);
    targetPoints.forEach(pt => pt.release());
    return out;
  }

  static elevationZMinMax(viewpoint, topZ = 0, bottomZ = topZ) {
    const vBottomZ = viewpoint.z ?? Number.NEGATIVE_INFINITY;
    const vTopZ = viewpoint.z ?? Number.POSITIVE_INFINITY;
    const tBottomZ = bottomZ ?? Number.NEGATIVE_INFINITY;
    const tTopZ = topZ ?? Number.POSITIVE_INFINITY;
    return Math.minMax(vBottomZ, vTopZ, tBottomZ, tTopZ);
  }

  /**
   * Shift the base/floor to a given point.
   * Used, for example, to lengthen or shrink the base in relation to the viewpoint while
   * not modifying the base plane normal.
   * @param {Point3d} pt
   */
  extendBaseToPoint(pt) {
    // Redefine the base plane, keeping the normal.
    const basePlane = this.floor.plane;
    basePlane.point.copyFrom(pt);

    // Intersect each face with the new base plane to determine the corner points.
    using dir = Point3d.tmp;
    for ( const face of this.iterateFaces(false) ) {
      // Point a is always the viewpoint for a face.
      face.b.subtract(face.a, dir);
      using ixAB = basePlane.lineIntersection(face.a, dir);
      face.b.copyFrom(ixAB);

      face.c.subtract(face.a, dir);
      using ixAC = basePlane.lineIntersection(face.a, dir);
      face.c.copyFrom(ixAC);
    }

    // Rebuild the floor points from the newly defined face points.
    this.floor.a.copyFrom(this.top.c);
    this.floor.b.copyFrom(this.top.b);
    this.floor.c.copyFrom(this.bottom.c);
    this.floor.d.copyFrom(this.bottom.b);

    // Don't reset face cache b/c we did not touch their planes.

    // Finalize the bounding box.
    this.setAABB();
  }

  // ----- NOTE: Iteration ----- //

  *iteratePoints() {
    yield this.top.a; // Viewpoint.
    yield this.top.c;
    yield this.top.b;
    yield this.bottom.b;
    yield this.bottom.c;
  }

  *iterateFaces(includeFloor = true) {
    yield this.top;
    yield this.left;
    yield this.bottom;
    yield this.right;
    if ( includeFloor ) yield this.floor;
  }

  // ----- NOTE: Overlap tests ----- //

  /**
   * Test if a point is contained within the frustrum.
   * @param {Point3d} p
   * @returns {boolean}
   */
  containsPoint(p, testBottom = true) {
    if ( !this.aabb.containsPoint(p) ) return false;
    for ( const face of this.iterateFaces(testBottom) ) {
      if ( face.isFacing(p) ) return false;
    }
    return true;
  }

  /**
   * Does the segment cross the frustum or contained within?
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {boolean}
   */
  overlapsSegment(a, b) {
    if ( !this.aabb.overlapsSegment(a, b) ) return false; // TODO: Is it faster without this?

    // Instead of calling containsPoint, test along the way to avoid iterating twice.
    let aInside = true;
    let bInside = true;
    for ( const face of this.iterateFaces() ) {
      if ( face.plane.lineSegmentIntersects(a, b)
        && face.intersectionT(a, b.subtract(a, Point3d.tmp)) !== null ) return true;
      aInside ||= !face.isFacing(a);
      bInside ||= !face.isFacing(b);
    }
    return aInside || bInside;
  }

  /**
   * Test if a sphere is contained within the frustum.
   * @param {Sphere} sphere
   * @returns {boolean}
   */
  overlapsSphere(sphere) {
    if ( this.containsPoint(sphere.center) ) return true;
    if ( !this.aabb.overlapsSphere(sphere) ) return false;
    for ( const face of this.iterateFaces() ) {
      if ( sphere.overlapsPolygon3d(face) ) return true;
    }
    return false;
  }

  /**
   * Test if a given AABB overlaps this frustrum
   * @param {AABB} aabb
   * @returns {boolean}
   */
  overlapsAABB(aabb) {
    aabb.toFinite(aabb);

    // For AABB to overlap, it must be on the "inside" side of all frustum planes.
    // Use n-vertex: corner of the AABB furthest inside the frustum.
    // If even that deepest corner is outside the plane (> 0), then the entire box is outside.
    using positiveVertex = Point3d.tmp;
    for ( const face of this.iterateFaces() ) {
      const plane = face.plane;
      const { normal, constant } = plane;

      // Find the "positive" vertex of the AABB (one most likely to be outside).
      positiveVertex.set(
        normal.x >= 0 ? aabb.min.x : aabb.max.x,
        normal.y >= 0 ? aabb.min.y : aabb.max.y,
        normal.z >= 0 ? aabb.min.z : aabb.max.z,
      );

      // Distance from the plane to the positive vertex.
      // Distance = (n • P) + d.
      const dist = normal.dot(positiveVertex) + constant; // Should equal plane.whichSide(positiveVertex).
      const s = plane.whichSide(positiveVertex);
      // s and dist may be infinity, which almostEqual does not catch.
      if ( s !== dist && !dist.almostEqual(plane.whichSide(positiveVertex)) ) console.error("overlapsAABB|Dist does not equal plane.whichSide", { dist, side: plane.whichSide(positiveVertex) });

      // Check if the positive vertex is outside the frustum for this plane.
      if ( s > 0 ) return false;
    }
    return true;
  }

  poly3dWithinFrustum(poly3d) {
    if ( !this.overlapsAABB(poly3d.aabb) ) return false;
    if ( !this.aabb.overlapsConvexPolygon3d(poly3d) ) return false;

    // Polygon edge intersects 1+ planes and the segment created is within bounds.
    for ( const face of this.iterateFaces() ) {
      if ( face.intersectsPolygon3d(poly3d) ) return true;
    }
    return false;
  }

  overlapsGeometry(geom) {
    if ( !this.overlapsAABB(geom.aabb) ) return false;
    for ( const face of geom.iterateFaces() ) {
      if ( this.poly3dWithinFrustum(face) ) return true;
    }
    return false;
  }

  overlapsDocument(doc, foregroundType = "background") {
    if ( doc.documentName === "Region" ) return this.overlapsRegionDocument(doc);
    const geom = CONFIG.GeometryLib.geometryManager.geomForDocument(doc, foregroundType);
    return this.overlapsGeometry(geom);
  }

  overlapsRegionDocument(regionD) {
    // Ignore regions not within the vision rectangle elevation.
    const topZ = gridUnitsToPixels(regionD.elevation.top);
    const bottomZ = gridUnitsToPixels(regionD.elevation.bottom);
    if ( this.outsideElevation(topZ, bottomZ) ) return false;

    // For each region shape, use the ideal version to test b/c circles and ellipses can be tested faster than polys.
    // Ignore holes (some shape with holes may get included but rather be over-inclusive here)
    const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.region.geomForDocument(regionD);
    return geom.shapeGeometries.some(shapeGeom => this._overlapsRegionShapeGeom(shapeGeom));
  }

  _overlapsRegionShapeGeom(geom) {
    if ( geom.isHole ) return false;
    return this.aabb.overlapsAABB(geom.aabb);
  }

  /**
   * Test if an elevation range might be within the frustum, as determined by the AABB.
   * @param {number} [topZ=0]
   * @param {number} [bottomZ=topZ]
   * @returns {boolean}
   */
  outsideElevation(topZ = 0, bottomZ = topZ) {
    return topZ < this.aabb.min.z && bottomZ > this.aabb.max.z;
  }

  draw2d(opts) {
    for ( const face of this.iterateFaces() ) face.draw2d(opts);
  }
}

/* Testing

pt3d_0 = new Point3d();
pt3d_1 = new Point3d();
pt3d_2 = new Point3d();
pt3d_3 = new Point3d();
ptOnes = Object.freeze(new Point3d(1, 1, 1));

function segmentIntersectsBounds(a, b, aabb) {
    // See https://jacco.ompf2.com/2022/04/13/how-to-build-a-bvh-part-1-basics/
    const { min, max } = aabb;
    const rayOrigin = a;
    const rayDirection = b.subtract(a, pt3d_0);
    const invDirection = ptOnes.divide(rayDirection, pt3d_3);
    const t1 = pt3d_1;
    const t2 = pt3d_2;

    min.subtract(rayOrigin, t1).multiply(invDirection, t1);
    max.subtract(rayOrigin, t2).multiply(invDirection, t2);
    const xMinMax = Math.minMax(t1.x, t2.x);
    const yMinMax = Math.minMax(t1.y, t2.y);
    const zMinMax = Math.minMax(t1.z, t2.z);
    const tmax = Math.min(xMinMax.max, yMinMax.max, zMinMax.max);
    if ( tmax <= 0 ) return false;

    const tmin = Math.max(xMinMax.min, yMinMax.min, zMinMax.min);
    return tmax >= tmin && (tmin * tmin) < rayDirection.dot(rayDirection);
    // return tmax > 0 && tmax >= tmin && (tmin * tmin) < rayT2;
  }

aabb = { min: new Point3d(0, 0, 0), max: new Point3d(100, 200, 300) }

a = new Point3d(-10, -10, 10)
b = new Point3d(10, 10, 20)

a = new Point3d(10, 10, 20)
b = new Point3d(20, 30, 30)

a = new Point3d(-10, -20, -30)
b = new Point3d(-20, -20, -20)

segmentIntersectsBounds(a, b, aabb)

*/