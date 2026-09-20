/* globals
canvas,
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_CONFIG } from "../const.js";
import { Point3d } from "./Point3d.js";
import { Plane } from "./Plane.js";
import { cleanPolygonPoints } from "../util.js";
import { AABB3d } from "./AABB3d.js";
import { Draw } from "../Draw.js";
import { Matrix, MatrixFloat32 } from "../Matrix.js";
import { Ellipse } from "../Ellipse.js";
import { Segment } from "../Segment.js";

/*
3d Polygon representing a flat polygon plane.
Can be transformed in 3d space.
Can be clipped at a specific z value.

Points in a Polygon3d are assumed to not be modified in place after creation.
*/
Symbol.dispose ??= Symbol("Symbol.dispose");



export class Polygon3d {

  static EPSILON = 1e-08;

  static [Symbol.hasInstance](instance) {
    return instance && instance.constructor && instance.constructor._geoLibType === this._geoLibType;
  }

  static _geoLibType = "Polygon3d";

  /** @type {Point3d} */
  points = [];

  constructor(n = 0) {
    if ( n > 0 ) this.points = Point3d.createN(n);
  }

  release() {
    this.points.forEach(pt => pt.release());
  }

  [Symbol.dispose]() { this.release(); }

  // ----- NOTE: In-place modifiers ----- //

  /**
   * Clear the getter caches.
   */
  clearCache() {
    this.#dirtyAABB = true;
    this.#dirtyPlane = true;
    this.#dirtyCentroid = true;
    this.#cleaned = false;
  }

  /**
   * Test and remove collinear points. Modified in place; assumes no significant change to
   * cached properties from this.
   */
  #cleaned = false;

  clean() {
    if ( this.#cleaned ) return;
    if ( this.points.length < 2 ) return;
    const result = cleanPolygonPoints(this.points);

    // Copy over the points if necessary.
    if ( result.length < this.points.length ) {
      this.points.length = result.length;
      this.points.forEach((pt, idx) => pt.copyFrom(result[idx]));
    }
    this.#cleaned = true;
  }

  /**
   * Sets the z value in place. Update plane, aabb. Clears centroid, cleaned flag.
   */
  setZ(z = 0) {
    this.points.forEach(pt => pt.z = z);
    if ( !this.dirtyPlane ) this.plane.point.z = z;
    if ( !this.dirtyAABB ) {
      this.aabb.min.z = z;
      this.aabb.max.z = z;
    }
    this.#dirtyCentroid = true;
    this.#cleaned = false;
    return this;
  }

  /**
   * Reverse the orientation of this polygon. Done in place.
   */
  reverseOrientation() {
    if ( !this.dirtyPlane ) this.plane.normal.multiplyScalar(-1, this.plane.normal);
    this.points.reverse();
    return this;
  }

  // ----- NOTE: Bounds ----- //

  /** @type {AABB3d} */
  #aabb = new AABB3d()

  #dirtyAABB = true;

  get dirtyAABB() { return this.#dirtyAABB; }

  set dirtyAABB(value) { this.#dirtyAABB ||= value; }

  get aabb() {
    if ( this.#dirtyAABB ) {
      this._calculateAABB(this.#aabb);
      this.#dirtyAABB = false;
    }
    return this.#aabb;
  }

  set aabb(value) {
    this.#aabb.copyFrom(value);
    this.#dirtyAABB = false;
  }

  _calculateAABB(aabb) { aabb.constructor.fromPolygon3d(this, aabb); }

  // ----- NOTE: Plane ----- //

  /** @type {Plane} */
  #plane;

  #dirtyPlane = true;

  get dirtyPlane() { return this.#dirtyPlane; }

  set dirtyPlane(value) { this.#dirtyPlane ||= value; }

  get plane() {
    if ( this.#dirtyPlane ) {
      this.#plane ??= new Plane();
      this._calculatePlane(this.#plane);

      // Set the plane point to the first point of the polygon.
      this.#plane.point.copyFrom(this.points[0] || { x: 0, y: 0, z: 0 });
      this.#dirtyPlane = false;
    }
    return this.#plane;
  }

  set plane(value) {
    this.#plane ??= new Plane();
    this.#plane.copyFrom(value);
    if ( this.points[0] ) this.#plane.point.copyFrom(this.points[0]);
    this.#dirtyPlane = false;
  }

  _calculatePlane(plane) {
    // Construct the plane so the center of the polygon is the origin.
    if ( !this.cleaned ) this.clean(); // Avoid basing the plane on collinear points.
    Plane.fromMultiplePoints(this.points, plane);
  }

  /** @type {PIXI.Point[]} */
  #planarPoints = [];

  // Points on the 2d plane in the plane's coordinate system.
  get planarPoints() {
    if ( !this.#planarPoints.length ) {
      const points = this.points;
      const nPoints = points.length;
      this.#planarPoints.length = nPoints;
      const to2dM = this.plane.conversion2dMatrix;
      using tmpPt = Point3d.tmp;
      for ( let i = 0; i < nPoints; i += 1 ) {
        this.#planarPoints[i] = to2dM.multiplyPoint3d(points[i], tmpPt).to2d();
      }
    }
    return this.#planarPoints;
  }

  // ----- NOTE: Centroid ----- //

  /** @type {Point3d} */
  #centroid = new Point3d();

  #dirtyCentroid = true;

  get dirtyCentroid() { return this.#dirtyCentroid; }

  set dirtyCentroid(value) { this.#dirtyCentroid ||= value; }

  /**
   * Centroid (center point) of this polygon.
   * @type {Point3d}
   */
  get centroid() {
    if ( this.#dirtyCentroid ) {
      using c = this._calculateAreaWeightedCentroid();
      this.#centroid.copyFrom(c);
      this.#dirtyCentroid = false;
    }
    return this.#centroid;
  }

  set centroid(value) {
    this.#centroid.copyFrom(value);
    this.#dirtyCentroid = false;
  }

  /**
   * Compute a point guaranteed to lie inside a simple polygon (convex or concave).
   * Unlike vertex-average or area-weighted centroid, this cannot fall outside the ring.
   * @returns {Point3d}
   */
  interiorPoint() {
    const poly = this.toPlanarPolygon();
    const pt2d = poly.interiorPoint();
    return this._convert2dPointsTo3d([pt2d])[0];
  }

  /**
   * Calculates the centroid (average/center point) of a 3d planar polygon.
   * Geometric center of the vertices.
   * @param {Point3d} [out]
   * @returns {Point3d}
   */
  _calculateAverageVertexCentroid(out) {
    out ??= Point3d.tmp;

    // If less than three points, return but do not mark as clean.
    if ( this.points.length === 0 ) return out.set(0, 0, 0);
    if ( this.points.length === 1 ) return this.points[0].clone(out);
    if ( this.points.length === 2 ) return Point3d.midPoint(this.points[0], this.points[1]).clone(out);

    out.set(0, 0, 0);
    for ( const p of this.points ) out.add(p, out);
    const scale = 1 / this.points.length;
    return out.multiplyScalar(scale, out);
  }

  /**
   * Calculates the area-weighted centroid of a 3d planar polygon.
   * @returns {Point3d}
   */
  _calculateAreaWeightedCentroid(out) {
    out ??= Point3d.tmp;

    // If less than three points, return but do not mark as clean.
    if ( this.points.length === 0 ) return out.set(0, 0, 0);
    if ( this.points.length === 1 ) return this.points[0].clone(out);
    if ( this.points.length === 2 ) return Point3d.midPoint(this.points[0], this.points[1]).clone(out);


    // Translate the polygon to the origin using the first point as a reference.
    // Improves floating point precision.
    const ref = this.points[0];
    using n = Point3d.tmp.set(0, 0, 0);

    // Calculate the total normal vector (proportional to the total vector area).
    const numPoints = this.points.length;
    const txPts = Array(numPoints * 2); // Store repeated calcs.
    const crossProducts = Array(numPoints); // Store repeated calcs.
    let i = 0;
    let j = 0;
    for ( const edge of this.iterateEdges() ) {
      const a = txPts[i++] = edge.a.subtract(ref);
      const b = txPts[i++] = edge.b.subtract(ref);
      const c = crossProducts[j++] = a.cross(b);
      n.add(c, n);
    }

    // Squared magnitude of the total normal vector
    const nMagSq = n.magnitudeSquared();
    if ( nMagSq.almostEqual(0) ) {
      console.warn("Polygon has zero area (points may be collinear).");
      return this.points[0].clone();
    }

    // Calculate the area-weighted centroid.
    out.set(0, 0, 0);
    const denom1_3 = 1/3;
    using tmp = Point3d.tmp;
    for ( let i = 0, j = 0; j < numPoints; ) {
      const a = txPts[i++];
      const b = txPts[i++];
      const c = crossProducts[j++];

      // Dot product of current cross product with the total normal vector.
      const dot = c.dot(n);

      // Weight for this triangle segment.
      const weight = dot / nMagSq;

      // Accumulate the weighted triangle centroids.
      a.add(b, tmp).multiplyScalar(denom1_3 * weight, tmp);
      out.add(tmp, out);
    }
    Point3d.release(...crossProducts, ...txPts);

    // Add the reference point back to return to the original coordinate space.
    return out.add(ref, out);
  }

  /**
   * @param {Points3d} points
   * @returns {Points3d}
   */
  static convexHull(points) {
    // Assuming flat points, determine plane and then convert to 2d
    const plane = Plane.fromMultiplePoints(points);
    const M2d = plane.conversion2dMatrix;
    const points2d = points.map(pt3d => M2d.multiplyPoint3d(pt3d));
    const convex2dPoints = convexHull(points2d);
    return convex2dPoints.map(pt => plane.conversion2dMatrixInverse.multiplyPoint3d(pt))
  }

  // ----- NOTE: Factory methods ----- //

 /**
   * Helper to create a 3d polygon for different polygon shapes.
   * @param {PIXI.Polygon|PIXI.Circle|PIXI.Rectangle|PIXI.Ellipse} poly
       Polygon shape to use for top and bottom faces.
   * @param {object} [opts]                     Options that modify the resulting shape
   * @param {number} [opts.z=0]                 Planar elevation
   * @param {boolean} [opts.isHole]             Whether the shape represents a hole;
   *   for polygons, this overrides `isPositive` property
   * @param {number} [opts.density]             Density to set for Circle3d or Ellipse3d
   * @returns {Polygon3d|Triangle3d|Quad3d|Circle3d|Ellipse3d} A Polygon3d representing this shape.
   */
  static fromPIXIShape(shape, { z = 0, isHole, density = 0 } = {}) {
    let face;
    switch ( shape.type ) {
      case PIXI.SHAPES.ELIP: face ??= Ellipse3d.fromPIXIEllipse(shape, z);
      case PIXI.SHAPES.CIRC:  /* eslint-disable-line no-fallthrough */
        face ??= Circle3d.fromCircle(shape, z);
        if ( density ) face.density = density;
      case PIXI.SHAPES.RECT: face ??= Quad3d.fromRectangle(shape, z);  /* eslint-disable-line no-fallthrough */
      case PIXI.SHAPES.RREC:  /* eslint-disable-line no-fallthrough */
        face ??= Polygon3d.fromPolygon(shape.toPolygon(), z);
        if ( isHole ) face.reverseOrientation(); // This reverses the plane. Rect/circ/ellip 2d polys don't track orientation.
        break;

      case PIXI.SHAPES.POLY: {
        isHole ??= !shape.isPositive;
        if ( isHole && !shape.isPositive ) shape.reverseOrientation();
        if ( shape.points.length === 6 ) face = Triangle3d.fromPolygon(shape, z);
        else if ( shape.points.length === 8 ) face = Quad3d.fromPolygon(shape, z);
        else face = Polygon3d.fromPolygon(shape, z);
        break;
      }

      default: throw new Error("Polygon3d.fromPIXIShape|Shape not recognized", { shape });
    }
    if ( isHole ) face.isHole = true;
    return face;
  }

  static from2dPoints(pts, elevation = 0, out) {
    // While faster to just set the points, use a polygon to test for holes.
    const poly = new PIXI.Polygon(pts);
    return this.fromPolygon(poly, elevation, out);
  }

  static from3dPoints(pts, out) {
    const n = pts.length;
    if ( out ) {
      Point3d.release(...out.points.slice(n));
      out.points.length = n;
    }
    else out = new this(n);
    for ( let i = 0; i < n; i += 1 ) {
      const outPt = out.points[i] ??= Point3d.tmp; // May require adding points.
      outPt.copyFrom(pts[i]);
    }
    out.clean();
    return out;
  }

  static fromPolygon(poly, elevation = 0, out) {
    // Clean the points before adding them to the polygon.
    const points = cleanPolygonPoints([...poly.iteratePoints()]);
    const n = points.length;

    // Release excess points and set the out.points to the correct length.
    out ??= new this(n);
    Point3d.release(...out.points.slice(n));
    out.points.length = points.length;

    // Set the out polygon points, using the provided elevation for the z coordinate.
    let i = 0;
    for ( const pt of points ) out.points[i++].set(pt.x, pt.y, elevation);

    // Release the 2d polygon points.
    PIXI.Point.release(...points);

    // 3d polygon faces up if the poly is not a hole.
    // Confirm orientation manually b/c this always gets screwed up.
    const isHole = poly.isHole ?? !poly.isPositive;
    const ctr = poly.center;
    using ctr3d = Point3d.tmp.set(ctr.x, ctr.y, elevation + 1);
    if ( out.isFacing(ctr3d) ^ !isHole ) out.reverseOrientation();
    out.isHole = isHole;
    return out;
  }

  static fromClipperPaths(cpObj, elevation = 0) {
    return cpObj.toPolygons().map(poly => this.fromPolygon(poly, elevation));
  }

  static fromPlanarPolygon(poly2d, plane, out) {
    // First create a 3d polygon at elevation 0.
    // This will also test for holes.
    out = this.fromPolygon(poly2d, 0, out);

    // Now translate the XY polygon in the z direction.
    return this._matchPolygon3dToPlane(out, plane);
  }

  /**
   * Shift the points of a polygon tha tis parallel to the XY canvas based on a plane.
   * @param {Polygon3d} poly3d        Poly3d set at elevation 0 with a plane normal z value only.
   * @param {Plane} plane
   * @returns {Polygon3d} Same polygon, possibly shifted to match the plane.
   */
  static _matchPolygon3dToPlane(poly3d, plane) {
    if ( poly3d.plane.almostEqual(plane) ) return poly3d;
    if ( poly3d.points[0].z !== 0 ) console.error("_matchPolygon3dToPlane|Should be at 0 elevation.");
    if ( poly3d.plane.normal.x || poly3d.plane.normal.y ) console.error("_matchPolygon3dToPlane|Should be pointing straight up or down.");

    // Now translate the XY polygon in the z direction.
    const invM2d = plane.conversion2dMatrixInverse;
    for ( const pt3d of poly3d.iteratePoints() ) invM2d.multiplyPoint3d(pt3d, pt3d);

    // The plane is not dirty because we checked it for equality at the beginning. So we must reset it.
    poly3d.plane.copyFrom(plane);
    return poly3d;
  }


  /**
   * Make a copy of this polygon.
   * @returns {Polygon3d} A new polygon
   */
  clone(out) {
    const n = this.points.length;
    out ??= new this.constructor(n);

    // Release excess points and confirm the points length for out.
    Point3d.release(...out.points.slice(n));
    if ( out.points.length < n ) {
      const missingIdx = out.points.length;
      out.points.length = n;
      for ( let i = missingIdx; i < n; i += 1 ) out.points[i] = Point3d.tmp;
    } else out.points.length = n;

    // Copy over the points.
    this.points.forEach((pt, idx) => out.points[idx].copyFrom(pt));

    // Copy over key properties.
    out.isHole = this.isHole;
    if ( !this.dirtyPlane ) out.plane = this.plane;  // Uses a setter to copy from, unset dirty value.
    if ( !this.dirtyCentroid ) out.centroid = this.centroid; // Uses a setter to copy from, unset dirty value.
    if ( !this.dirtyAABB ) out.aabb = this.aabb; // Uses a setter to copy from, unset dirty value.

    return out;
  }

  _cloneEmpty() {
    const out = new this.constructor(0);
    out.isHole = this.isHole;
    return out;
  }

  // ----- NOTE: Conversions to ----- //

  /**
   * Drop a single axis and project to the plane.
   * @param {"x"|"y"|"z"} omitAxis    Which of the three axes to omit to drop this to 2d.
   * @param {object} [opts]
   * @param {number} [opts.scalingFactor]   How to scale the clipper points
   * @returns {ClipperPaths}
   */
  toClipperPaths({ omitAxis = "z", scalingFactor = 100 } = {}) {
    let axes;
    switch ( omitAxis ) {
      case "x": axes = { x: "y", y: "z" }; break;
      case "y": axes = { x: "x", y: "z" }; break;
      case "z": axes = { x: "x", y: "y" }; break;
      default: throw new Error(`${this.constructor.name}|toClipperPaths omitAxis not recognized.`);
    }
    const poly = new PIXI.Polygon(this.points.map(pt => pt.to2d(axes)));
    if ( !this.isHole ^ poly.isPositive ) poly.reverseOrientation();
    return CONFIG.GeometryLib.CONFIG.ClipperPaths.fromPolygons([poly], { scalingFactor });
  }

  /**
   * Convert to 2d polygon, dropping z.
   * @returns {PIXI.Polygon}
   */
  toPolygon2d({ omitAxis = "z" } = {}) {
    let poly;
    if ( omitAxis === "z" ) poly = new PIXI.Polygon(this.points); // PIXI.Polygon ignores "z" attribute.
    else {
      const [x, y] = omitAxis === "x" ? ["y", "z"] : ["x", "z"];
      poly = new PIXI.Polygon(this.points.map(pt3d => { return { x: pt3d[x], y: pt3d[y] } }));
    }
    if ( !this.isHole ^ poly.isPositive ) poly.reverseOrientation();
    poly.isHole = this.isHole;
    return poly;
  }

  /**
   * Convert to 2d polygon by perspective transform, dividing each point by z.
   * @returns {PIXI.Polygon}
   */
  toPerspectivePolygon() {
    const poly = new PIXI.Polygon(this.points.flatMap(pt => {
      const invZ = 1 / pt.z;
      return [pt.x * invZ, pt.y * invZ];
    }));
    if ( !this.isHole ^ poly.isPositive ) poly.reverseOrientation();
    return poly;
  }

  toPlanarPolygon() {
    const poly = new PIXI.Polygon(this.planarPoints);
    if ( !this.isHole ^ poly.isPositive ) poly.reverseOrientation();
    return poly;
  }

  /**
   * Triangulate and convert to vertices.
   * @param {object} [opts]
   * @returns {Float32Array[]}
   */
  toVertices(opts) {
    const tris = this.triangulate();
    return Triangle3d.trianglesToVertices(tris, opts);
  }

  /**
   * Triangulate the polygon, converting it to an array of Triangle3d (can be stored as Polygons3d)
   * @param {object} [opts]
   * @param {boolean} [opts.useFan]       If true, force fan (can cause errors); if false, never use; otherwise let algorithm decide
   * @returns {Triangle3d[]} Array of Triangle3d
   */
  triangulate(opts) {
    // Convert the polygon points to 2d and triangulate.
    const points2d = this._convert3dPointsTo2d(this.points);
    const poly = new PIXI.Polygon(points2d);
    const tris2d = poly.triangulate(opts);
    points2d.forEach(pt => pt.release());

    // Convert back to 3d. For speed, do with tmp points instead of using _convert2dPointsTo3d.
    const from2dM = this.plane.conversion2dMatrixInverse;
    using a = Point3d.tmp;
    using b = Point3d.tmp;
    using c = Point3d.tmp;
    const out = tris2d.map(tri2d => {
      const pts = tri2d.points;
      a.set(pts[0], pts[1], 0);
      b.set(pts[2], pts[3], 0);
      c.set(pts[4], pts[5], 0);
      from2dM.multiplyPoint3d(a, a);
      from2dM.multiplyPoint3d(b, b);
      from2dM.multiplyPoint3d(c, c);
      const tri = Triangle3d.from3Points(a, b, c);
      tri.isHole = this.isHole;
    });
    return out;
  }

  /**
   * Convert 3d points on the polygon plane to 2d. Does not confirm the 3d point locations.
   * @param {Point3d[]} pts
   * @returns {PIXI.Point[]}
   */
  _convert3dPointsTo2d(pts) {
    // Convert using plane's matrix.
    const to2dM = this.plane.conversion2dMatrix;
    const pts2d = pts.map(pt => to2dM.multiplyPoint3d(pt));

    const cw = pts2d.length > 2 && foundry.utils.orient2dFast(pts2d[0], pts2d[1], pts2d[2]) < 0;
    if ( !this.isHole ^ cw ) pts2d.reverse();
    // Poly equivalent: if ( !this.isHole ^ poly.isPositive ) poly.reverseOrientation();
    return pts2d;
  }

  /**
   * Convert 2d points on the polygon plane to 3d. Does not confirm the 2d point locations.
   * @param {PIXI.Point[]} pts
   * @returns {Point3d[]}
   */
  _convert2dPointsTo3d(pts) {
    using tmp3d = Point3d.tmp;
    const from2dM = this.plane.conversion2dMatrixInverse;
    return pts.map(pt => from2dM.multiplyPoint3d(tmp3d.set(pt.x, pt.y, 0)));
  }

  /**
   * Build a set of vertical Quad3ds (or occasional Triangle3ds) representing sides of a polygon shape.
   * Built facing outwards from the polygon, with polygon on top.
   * @param {number} bottomZ            Fixed elevation to use for the sides
   * @returns {Quad3d|Triangle3d[]}
   */
  buildTopSides(bottomZ, epsilon = this.constructor.EPSILON) {
    const numSides = this.points.length;
    const sides = new Array(numSides);
    let i = 0;
    using a = Point3d.tmp;
    using b = Point3d.tmp;
    let filterSides = false;
    for ( const edge of this.iterateEdges({ close: true }) ) {
      // Cannot form a quad without 4 distinct points. Quick test here.
      if ( edge.a.z.almostEqual(bottomZ) && edge.b.z.almostEqual(bottomZ) ) {
        filterSides = true
        continue;
      }

      // Build a quad or occassionally a triangle.
      const bottomA = a.set(edge.a.x, edge.a.y, bottomZ);
      const bottomB = b.set(edge.b.x, edge.b.y, bottomZ);

      const pts = cleanPolygonPoints([edge.b, edge.a, bottomA, bottomB], epsilon)
      if ( this.isHole ) pts.reverse();
      let side;
      switch ( pts.length ) {
        case 3: side = Triangle3d.from3Points(...pts); break;
        case 4: side = Quad3d.from4Points(...pts); break;
        default: filterSides = true; continue;
      }
      side.isHole = this.isHole;
      sides[i++] = side;
    }
    if ( filterSides ) return sides.filter(elem => Boolean(elem));
    return sides;
  }

  /**
   * Create a grid of points within this polygon.
   * @param {object} [opts]
   * @param {number} [opts.spacing = 1]              How many pixels between each point?
   * @param {boolean} [opts.startAtEdge = false]     Are points allowed within spacing of the edges? Otherwise will be at least spacing away.
   * @returns {Point3d[]} Points in order from left to right, top to bottom.
   */
  pointsLattice(opts) {
    // Convert to 2d points and get the 2d points lattice.
    const poly = this.toPlanarPolygon();

    // Construct lattice points in 2d.
    const latticePoints = poly.pointsLattice(opts);

    // Convert back to 3d.
    const out = this._convert2dPointsTo3d(latticePoints);
    PIXI.Point.release(...latticePoints);
    return out;
  }


/**
 * Combine polygons (Polygon3d, Quad3d, Triangle3d, Polygons3d, ...) that lie on the
 * same plane into as few objects as possible, by unioning them in that plane's local
 * 2d coordinates. Useful for tidying up geometry that was assembled edge-by-edge (e.g.
 * a run of side-wall quads) into a single, properly-welded shape.
 *
 * Any Polygons3d passed in is first flattened into its constituent polygons. Members
 * are then bucketed by Plane#almostEqual; a polygon whose plane doesn't match any
 * other member's plane is returned unchanged (no union needed). Each bucket of 2+
 * coplanar members is unioned in 2d and returned as a single Polygons3d -- or, if
 * the union collapses to exactly one simple ring, as a plain Polygon3d.
 * @param {(Polygon3d|Polygons3d)[]} polys
 * @param {object} [opts]
 * @param {number} [opts.scalingFactor=100]   Passed through to ClipperPaths.
 * @returns {(Polygon3d|Polygons3d)[]}
 */
static combineCoplanar(polys, { scalingFactor = 100 } = {}) {
  // Flatten any Polygons3d inputs into their individual member polygons.
  const flat = polys.flatMap(poly => poly.polygons ?? [poly]);
  if ( !flat.length ) return [];

  // Bucket by plane. Groups are few in practice, so a linear scan per member is fine.
  const groups = [];
  for ( const poly of flat ) {
    const plane = poly.plane;
    const group = groups.find(g => g.plane.almostEqual(plane));
    if ( group ) group.members.push(poly);
    else groups.push({ plane, members: [poly] });
  }

  const ClipperPaths = CONFIG.GeometryLib.CONFIG.ClipperPaths;
  const out = [];
  for ( const { plane, members } of groups ) {
    // Nothing to combine -- pass the lone polygon through unchanged.
    if ( members.length === 1 ) { out.push(members[0]); continue; }

    // Project every member's ring into the plane's own local 2d coordinates.
    const M2d = plane.conversion2dMatrix;
    const polys2d = members.map(poly3d => {
      const pts2d = poly3d.points.map(pt => {
        using tmp3d = M2d.multiplyPoint3d(pt);
        return tmp3d.to2d();
      });
      const poly2d = new PIXI.Polygon(pts2d);
      PIXI.Point.release(...pts2d);

      if ( poly3d.isHole ^ !poly2d.isPositive ) poly2d.reverseOrientation();
      return poly2d;
    });

    // Weld/union everything that touches or overlaps on this plane.
    // NOTE: assumes ClipperPaths exposes a `unionPaths` boolean op, mirroring the
    // `intersectPaths` used elsewhere in this codebase (e.g. Steps.js#verticalPlanks).
    // Adjust the method name here if this wrapper's actual union method differs.
    const unioned = ClipperPaths.fromPolygons(polys2d, { scalingFactor }).union().toPolygons();

    // Convert the unioned 2d ring(s) back to 3d on the shared plane.
    const polys3d = [];
    for ( const poly of unioned ) {
      const poly3d = Polygon3d.fromPIXIShape(poly);
      Polygon3d._matchPolygon3dToPlane(poly3d, plane);
      polys3d.push(poly3d);
    }

    out.push(polys3d.length === 1 ? polys3d[0] : Polygons3d.from3dPolygons(polys3d));
  }
  return out;
}

  // ----- NOTE: Iterators ----- //

  /**
   * Iterate over the polygon's edges in order.
   * @param {object} [options]
   * @param {boolean} [close]   If true, return last point --> first point as edge.
   * @returns { Segment } for each edge
   * Edges link, such that edge0.b === edge.1.a.
   */
  *iterateEdges({close = true} = {}) {
    const n = this.points.length;
    if ( n < 2 ) return;

    const firstA = this.points[0];
    let a = firstA;
    for ( let i = 1; i < n; i += 1 ) {
      const b = this.points[i];
      yield { a, b };
      a = b;
    }

    if ( close ) {
      const b = firstA;
      yield { a, b };
    }
  }

  /**
   * Iterate over the polygon's edges in reverse order.
   * @param {object} [options]
   * @param {boolean} [close]   If true, return last point --> first point as edge.
   * @returns { A: Point3d, B: Point3d } for each edge
   * Edges link, such that edge0.b === edge.1.a.
   */
  *reverseIterateEdges({close = true} = {}) {
    const n = this.points.length;
    if ( n < 2 ) return;

    const firstA = this.points.at(-1);
    let a = firstA;
    for ( let i = n - 2; i > -1; i -= 1 ) {
      const b = this.points[i];
      yield { a, b };
      a = b;
    }

    if ( close ) {
      const b = firstA;
      yield { a, b };
    }
  }

  /**
   * Iterate over the polygon's {x, y} points in order.
   * @returns {Point3d}
   */
  *iteratePoints() {
    const n = this.points.length;
    for ( let i = 0; i < n; i += 1 ) yield this.points[i];
  }

  /**
   * Iterate over the polygon's {x, y} points in reverse order.
   * @returns {Point3d}
   */
  *reverseIteratePoints() {
    const n = this.points.length;
    for ( let i = n - 1; i > -1; i -= 1 ) yield this.points[i];
  }

  /**
   * Iterator: a, b, c.
   */
  [Symbol.iterator]() {
    const n = this.points.length;
    const data = this;
    let index = 0;
    return {
      next() {
        if ( index < n ) return {
          value: data.points[index++],
          done: false };
        else return { done: true };
      }
    };
  }

//   forEach(callback) {
//     for ( let i = 0, iMax = this.points.length; i < iMax; i += 1 ) callback(this.points[i], i, this);
//   }

  // ----- NOTE: Property tests ----- //


  /** @type {boolean} */
  isHole = false;

  /**
   * Does this polygon face a given point?
   * @param {Point3d} p
   * @returns {boolean}
   */
  isFacing(p) {
    return this.plane.whichSide(p) > 0;
  }

  /**
   * What is the orientation of the first three points of this polygon w/r/t a point?
   * Collinear points will fail here.
   * Use the scalar triple (a • (b x c)) to measure the signed volume of the
   * parallelpiped formed by three vectors.
   * > 0: CCW w/r/t d
   * < 0: CW w/r/t d
   * = 0: Coplanar
   * @param {Point3d} d
   * @returns {number}
   */
  orient3d(d) {
    // Shift points so d is the origin.
    const [a, b, c] = this.points;
    using dA = a.subtract(d);
    using dB = b.subtract(d);
    using dC = c.subtract(d);

    // Compute cross of (b - d) and (c - d).
    using x = dB.cross(dC);

    // Return the scalar triple of (a - p).
    return dA.dot(x);
  }

  // ----- NOTE: Transformations ----- //

  // Valid if it forms a polygon, not a line or a point (or null).
  isValid() {
    this.clean();
    return this.points.length > 2;
  }

  /**
   * Transform the points using a transformation matrix.
   * Passing an out variable is not allowed here; use clone instead.
   * Some transforms, like circles, can result in new shapes (e.g., ellipse).
   * @param {Matrix} M
   * @param {Matrix} [invTransposeM]          The inverse transpose of M, when doing repeated calculations.
   * @returns {Polygon3d} A new object with the modified polygon.
   */
  transform(M, invTransposeM) {
    const out = this.clone();
    out.points.forEach(pt => M.multiplyPoint3d(pt, pt));

    // Use the inverse transpose to calculate the normal
    invTransposeM ??= M.invert().transpose();

    // Transform the normal vector as a direction (w = 0).
    const txN = out.plane.normal;
    invTransposeM.multiplyPoint3d(this.plane.normal, txN, 0); // Set w = 0 to treat as vector.
    txN.normalize(txN);
    out.plane.point.copyFrom(out.points[0]);

    // The AABB and centroid must be recalculated. (Could use the model matrix, but safer to recalculate)
    out.dirtyAABB = true;
    out.dirtyCentroid = true;
    return out;
  }

  multiplyScalar(multiplier, poly3d) {
    poly3d = this.clone(poly3d);
    poly3d.points.forEach(pt => pt.multiplyScalar(multiplier, pt));
    poly3d.clearCache();
    return poly3d;
  }

  translate({ x = 0, y = 0, z = 0} = {}, poly3d) {
    poly3d = this.clone(poly3d);
    using txPt = Point3d.tmp.set(x, y, z);
    poly3d.points.forEach(pt => pt.add(txPt, pt));
    poly3d.clearCache();
    return poly3d;
  }

  scale({ x = 1, y = 1, z = 1} = {}, poly3d) {
    poly3d = this.clone(poly3d);
    using scalePt = Point3d.tmp.set(x, y, z);
    poly3d.points.forEach(pt => pt.multiply(scalePt, pt));
    poly3d.clearCache();
    return poly3d;
  }

  divideByZ(poly3d) {
    poly3d = this.clone(poly3d);
    poly3d.points.forEach(pt => {
      const zInv = 1 / pt.z;
      pt.x *= zInv;
      pt.y *= zInv;
      pt.z = 1;
    });
    poly3d.clearCache();
    return poly3d;
  }

  // ----- NOTE: Intersection ----- //

  /**
   * Test if a ray is within the polygon bounds and intersects the polygon's plane.
   * Does not consider whether this polygon is facing.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {object} [opts]
   * @param {boolean} [opts.ignoreHoles = true]        If true, polygon holes return null
   *   Important for Polygons3d, which deal with multiple polygon intersections.
   * @returns {number|null} The t value of the plane intersection.
   */
  intersectionT(rayOrigin, rayDirection, { holesBlock = false } = {}) {
    if ( !holesBlock && this.isHole ) return null;

    // First get the plane intersection.
    const plane = this.plane;
    const t = plane.rayIntersection(rayOrigin, rayDirection);
    if ( t === null ) return null;
    const ix = Point3d.tmp;
    rayOrigin.add(rayDirection.multiplyScalar(t, ix), ix)

    // Test 3d bounding box.
    if ( !this.aabb.almostContainsPoint(ix) ) return null;
    return this._isIntersectionWithinPolygon(ix) ? t : null;
  }

  /**
   * Is a 3d point that is on the plane within the polygon?
   * Does not check bounding box or if it is in fact on the plane.
   * @param {Point3d} ix
   * @returns {boolean}
   */
  _isIntersectionWithinPolygon(ix) {
    // If the plane is not vertical, can do a simple projection onto the x/y plane as a 2d polygon.
    let poly2d;
    let ix2d;
    if ( this.plane.normal.z ) {
      poly2d = this.toPolygon2d();
      ix2d = ix.to2d();
    } else {
      poly2d = this.toPlanarPolygon()
      ix2d = this._convert3dPointsTo2d([ix])[0];
    }
    const contained = poly2d.contains(ix2d.x, ix2d.y);
    ix2d.release();
    return contained;
  }

  /**
   * Test if a ray intersects the polygon. Does not consider whether this polygon is facing.
   * Ignores holes.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {object} [opts]
   * @param {number} [opts.minT=0]        Ignore hits earlier in the segment than this (multiple of rayDirection)
   * @param {number} [opts.maxT=1]        Ignore hits later in the segment than this (multiple of rayDirection)
   * @param {boolean} [opts.holesBlock = false]        If false, polygon holes return null
   *   Important for Polygons3d, which deal with multiple polygon intersections.
   * @returns {Point3d|null}
   */
  intersection(rayOrigin, rayDirection, { minT = 0, maxT = 1, holesBlock = false } = {}) {
    if ( !holesBlock && this.isHole ) return null;
    const t = this.intersectionT(rayOrigin, rayDirection);
    if ( t === null || !t.almostBetween(minT, maxT) ) return null;
    if ( t.almostEqual(0) ) return rayOrigin;
    const ix = Point3d.tmp;
    rayOrigin.add(rayDirection.multiplyScalar(t, ix), ix)
    return ix;
  }

  /**
   * Truncate a set of points representing a plane shape to keep only the points
   * compared to a given coordinate value. It is assumed that the shape can be closed by
   * getting lastPoint --> firstPoint.
   * @param {PIXI.Point[]|Point3d[]} points   Array of points representing a polygon
   * @param {object} [opts]
   * @param {number} [opts.cutoff=0]          Value to use in the comparator
   * @param {string} [opts.coordinate="z"]    Index to use in the comparator
   * @param {"lessThan"
            |"greaterThan"
            |"lessThanEqual"
            |"greaterThanEqual"} [opts.cmp="lessThan" ]    How to test the cutoff (what to keep)
   * @returns {PIXI.Point[]|Point3d[]} The new set of points as needed, or original points
   *   May return more points than provided (i.e, triangle clipped so it becomes a quad)
   */
  clipPlanePoints({ cutoff = 0, coordinate = "z", cmp = "lessThan" } = {}) {
    switch ( cmp ) {
      case "lessThanEqual": cmp = pt => pt[coordinate] <= cutoff; break;
      case "greaterThan": cmp = pt => pt[coordinate] > cutoff; break;
      case "greaterThanEqual": cmp = pt => pt[coordinate] >= cutoff; break;
      default: cmp = pt => pt[coordinate] < cutoff;
    }

    // Walk along the polygon edges. If the z value of the point passes, keep it.
    // If the edge crosses the z line, add a new point at the crossing point.
    // Discard all points that don't meet it.
    const toKeep = [];
    for ( const edge of this.iterateEdges({ close: true }) ) {
      const { a, b } = edge;
      if ( cmp(a) ) toKeep.push(a.clone());
      if ( cmp(a) ^ cmp(b) ) {
        const newPt = Point3d.tmp;
        const res = a.projectToAxisValue(b, cutoff, coordinate, newPt);
        if ( res && !(newPt.almostEqual(a) || newPt.almostEqual(b)) ) toKeep.push(newPt);
      }
    }
    return toKeep;
  }

  /**
   * Clip this polygon in the z direction.
   * @param {number} z
   * @param {boolean} [keepLessThan=true]
   * @returns {Polygon3d}
   */
  clipZ({ z = -0.1, keepLessThan = true } = {}) {
    const toKeep = this.clipPlanePoints({
      cutoff: z,
      coordinate: "z",
      cmp: keepLessThan ? "lessThan" : "greaterThan"
    });
    const out = this._cloneEmpty();
    out.points = toKeep;
    return out;
  }

  /**
   * @typedef {object} Segment3d
   * @prop {Point3d} a
   * @prop {Point3d} b
   */

  /**
   * Find the intervals of a line (ray) that intersects this polygon.
   * Assumes the line is on this plane.
   * @param {Point3d} origin
   * @param {Point3d} direction
   * @returns {number[]} T-values along the line.
   */
  _planarLineIntersections(origin, direction) {
    const EPSILON = this.constructor.EPSILON;
    const N = this.plane.normal;
    using tmpPt = Point3d.tmp;
    using intersectPt = Point3d.tmp;
    const tValues = [];

    // Calculate the starting point.
    using vA = Point3d.tmp;
    using vB = Point3d.tmp;
    this.points[0].subtract(origin, vA);
    let distA = vA.cross(direction, tmpPt).dot(N);

    for ( const s of this.iterateEdges() ) {
      // Calculate signed distance for the second point.
      // (This will repeat the first point at the very end, but caching it seems like overkill.)
      s.b.subtract(origin, vB);
      const distB = vB.cross(direction, tmpPt).dot(N);

      // Check if the line crosses the edge.
      if ( distA * distB <= 0 ) {
        if ( distA.almostLessThan(0, EPSILON) && distB.almostLessThan(0, EPSILON) ) {
          // Edge is perfectly collinear with intersection line.
          tValues.push(vA.dot(direction));
          tValues.push(vB.dot(direction));
        } else if ( Math.abs(distA - distB) > EPSILON) {
          // Standard crossing.
          const tEdge = distA / (distA - distB);
          s.a.add(s.b.subtract(s.a, tmpPt).multiplyScalar(tEdge, tmpPt), intersectPt);
          const tLine = intersectPt.subtract(origin, tmpPt).dot(direction);
          tValues.push(tLine);
        }
      }

      // Cache first point for the next edge iteration.
      vA.copyFrom(vB);
      distA = distB;
    }

    // Sort raw intersections.
    tValues.sort((a, b) => a - b);

    // Deduplicate t-values.
    let t0 = tValues[0];
    const uniqueT = [t0];
    for ( let i = 1, n = tValues.length; i < n; i += 1 ) {
      const t = tValues[i];
      if ( (t - t0) > EPSILON ) uniqueT.push(t);
      t0 = t;
    }

    // Pair entry and exit points, merging any contiguous intervals.
    const intervals = [];
    if ( uniqueT.length < 2 ) return intervals;

    let currentStart = uniqueT[0];
    let currentEnd = uniqueT[1];
    for ( let i = 2, n = uniqueT.length - 1; i < n; i += 2 ) {
      const t0 = uniqueT[i];
      const t1 = uniqueT[i+1]
      if ( t0 < currentEnd + EPSILON ) currentEnd = Math.max(currentEnd, t1); // Next interval overlaps or is immediately contiguous (within epsilon).
      else {
        // Gap found. push the merged interval and start tracking anew.
        if ( (currentEnd - currentStart) > EPSILON ) intervals.push([currentStart, currentEnd]);
        currentStart = t0;
        currentEnd = t1;
      }
    }

    // Push the final tracked interval.
    if ( (currentEnd - currentStart) > EPSILON ) intervals.push([currentStart, currentEnd]);
    return intervals;
  }


  /**
   * Intersect this Polygon3d against a plane.
   * @param {Plane} plane
   * @returns {Segment3d[]|null} Empty if no intersections or parallel. If coincident, returns null.
   */
  intersectPlane(plane) {
    if ( this.points.length < 3 ) return [];

    if ( this.plane.isParallelToPlane(plane) ) {
      // If polygon lies flat on the cutting plane, handle explicitly.
      // Return the polygon's own edges as segments.
      if ( this.plane.isCoincidentWithPlane(plane, { testParallel: false }) ) return [...this.iterateEdges()];
      return []; // No intersection.
    }

    // Origin and normalized direction of the intersection line of the planes.
    const res = this.plane.intersectPlane(plane);
    using origin = res.point;
    using direction = res.direction;
    direction.normalize(direction);

    // Find the intersection intervals of the planar intersection with this polygon.
    const intervals = this._planarLineIntersections(origin, direction);

    // Convert intervals back to 3d segments.
    const EPSILON = this.constructor.EPSILON;
    const resultSegments = [];
    for ( const [start, end] of intervals ) {
      if ( (end - start) > EPSILON ) {
        const pStart = Point3d.tmp;
        const pEnd = Point3d.tmp;
        origin.add(direction.multiplyScalar(start, pStart), pStart);
        origin.add(direction.multiplyScalar(end, pEnd), pEnd);
        resultSegments.push(new Segment(pStart, pEnd));
      }
    }
    return resultSegments;
  }


  /**
   * Does a line (ray) intersect this polygon?
   * Assumes the line is on this plane.
   * @param {Point3d} origin
   * @param {Point3d} direction
   * @returns {number[]} T-values along the line.
   */
  _hasPlanarLineIntersections(origin, direction) {
    // First half from planarLineIntersections
    const EPSILON = this.constructor.EPSILON;
    const N = this.plane.normal;
    using tmpPt = Point3d.tmp;

    // Calculate the starting point.
    using vA = Point3d.tmp;
    using vB = Point3d.tmp;
    this.points[0].subtract(origin, vA);
    let distA = vA.cross(direction, tmpPt).dot(N);

    for ( const s of this.iterateEdges() ) {
      // Calculate signed distance for the second point.
      // (This will repeat the first point at the very end, but caching it seems like overkill.)
      s.b.subtract(origin, vB);
      const distB = vB.cross(direction, tmpPt).dot(N);

      // Check if the line crosses the edge.
      if ( distA * distB <= 0 ) {
        if ( distA.almostLessThan(0, EPSILON) && distB.almostLessThan(0, EPSILON) ) return true;
        else if ( Math.abs(distA - distB) > EPSILON) return true;
      }

      // Cache first point for the next edge iteration.
      vA.copyFrom(vB);
      distA = distB;
    }

    return false;
  }


  /**
   * Does this 3d polygon intersect a plane?
   * @param {Plane} plane
   * @returns {boolean}
   */
  intersectsPlane(plane) {
    if ( this.points.length < 3 ) return false;
    if ( this.plane.isParallelToPlane(plane) ) {
      return this.plane.isCoincidentWithPlane(plane, { testParallel: false });
    }

    // Origin and normalized direction of the intersection line of the planes.
    const res = this.plane.intersectPlane(plane);
    using origin = res.point;
    using direction = res.direction;
    direction.normalize(direction);

    // Find the intersection intervals of the planar intersection with this polygon.
    return this._hasPlanarLineIntersections(origin, direction);
  }


  /**
   * Intersect this Polygon3d against another.
   * @param {Polygon3d} other
   * @returns {Segment[]|null} Array of 3d segments or null if coplanar.
   * Coplanar objects can be transformed to 2d and intersected or tested for overlap.
   */
  intersectPolygon3d(other) {
    if ( this.points.length < 3 || other.points.length < 3 ) return [];
    if ( this.plane.isParallelToPlane(other.plane) ) {
      if ( this.plane.isCoincidentWithPlane(other.plane, { testParallel: false }) ) return null;
      return []; // No intersection; parallel but not touching.
    }

    // Origin and normalized direction of the intersection line of the planes.
    const res = this.plane.intersectPlane(other.plane);
    using origin = res.point;
    using direction = res.direction;
    direction.normalize(direction);

    // Find the intersection intervals of the planar intersection with each polygon.
    const intervals1 = this._planarLineIntersections(origin, direction);
    const intervals2 = other._planarLineIntersections(origin, direction);

    // Intersect the intervals and convert back to 3d segments.
    const resultSegments = [];
    for ( const [start1, end1] of intervals1 ) {
      for ( const [start2, end2] of intervals2 ) {
        const maxStart = Math.max(start1, start2);
        const minEnd = Math.min(end1, end2);

        if ( maxStart <= minEnd ) {
          // Valid overlap interval.
          const pStart = Point3d.tmp;
          const pEnd = Point3d.tmp;
          origin.add(direction.multiplyScalar(maxStart, pStart), pStart);
          origin.add(direction.multiplyScalar(minEnd, pEnd), pEnd);
          resultSegments.push(new Segment(pStart, pEnd));
        }
      }
    }
    return resultSegments;
  }

  /**
   * Does this 3d polygon intersect a polygon?
   * @param {Polygon3d} other
   * @returns {boolean}
   */
  intersectsPolygon3d(other) {
    if ( this.points.length < 3 || other.points.length < 3 ) return false;
    if ( this.plane.isParallelToPlane(other.plane) ) {
      return this.plane.isCoincidentWithPlane(other.plane, { testParallel: false });
    }

    // Origin and normalized direction of the intersection line of the planes.
    const res = this.plane.intersectPlane(other.plane);
    using origin = res.point;
    using direction = res.direction;
    direction.normalize(direction);

    // Find the intersection intervals of the planar intersection with this polygon.
    return this._hasPlanarLineIntersections(origin, direction)
      || other._hasPlanarLineIntersections(origin, direction);
  }

  /* ----- NOTE: Debug ----- */

  draw2d({ draw, omitAxis = "z", ...opts } = {}) {
    draw ??= new Draw();
    draw.shape(this.toPolygon2d({ omitAxis }), opts);
  }
}

function pointFromVertices(i, vertices, indices, stride = 3, offset = 0, outPoint) {
  outPoint ??= Point3d.tmp;
  const idx = (indices[i]  * stride) + offset;
  const v = vertices.slice(idx , idx + stride);
  outPoint.set(v[0], v[1] || 0, v[2] || 0);
  return outPoint;
}

/**
 * Planar ellipse shape.
 */
export class Ellipse3d extends Polygon3d {

  static _geoLibType = "Ellipse3d";

  // Assumed density for transforms. If zero, will use PIXI.Circle.approximateVertexDensity based on the major radius.
  #density = 0;

  get density() { return this.#density || PIXI.Circle.approximateVertexDensity(Math.max(this.radiusX, this.radiusY, canvas.grid.size)); }

  set density(value) { this.#density = value; }

  /** @type {Point3d} */
  get center() { return this.points[0]; }

  set center(value) {
    this.points[0].copyFrom(value);
    this.plane.point.copyFrom(value);
  }

  // For numerical consistency, store the radius squared to use when possible.
  /** @type {PIXI.Point} */
  #radius = new PIXI.Point();
  get radius() { return this.#radius; }
  set radius(value) {
    this.#radius.copyFrom(value);
    using value2 = value.multiply(value);
    this.#radiusSquared.copyFrom(value2);
  }

  /** @type {PIXI.Point} */
  #radiusSquared = new PIXI.Point();
  get radiusSquared() { return this.#radiusSquared; }
  set radiusSquared(value) {
    this.#radiusSquared.copyFrom(value);
    using valueSqrt = value.sqrt();
    this.#radius.copyFrom(valueSqrt);
  }

  /** @type {number} */
  get radiusX() { return this.#radius.x; }
  set radiusX(value) {
    using tmp = PIXI.Point.tmp.set(value, this.radiusY);
    this.radius = tmp;
  }

  /** @type {number} */
  get radiusY() { return this.#radius.y; }
  set radiusY(value) {
    using tmp = PIXI.Point.tmp.set(this.radiusX, value);
    this.radius = tmp;
  }

  /**
   * Vectors that originate from the center and run along the two axes.
   * Add and subtract from center to get axis endpoints:
   * C + Vx and C - Vx; C + Vy and C - Vy
   * @type {object<vx: Point3d, vy: Point3d>}
   */
  radiusVectors() {
    // Find numerically stable axes.
    const { u, v } = this.plane._calculateAxisVectors();
    const cTheta = Math.cos(this.angle);
    const sTheta = Math.sin(this.angle);
    using tmp1 = Point3d.tmp;
    using tmp2 = Point3d.tmp;
    const vx = Point3d.tmp;
    const vy = Point3d.tmp;
    u.multiplyScalar(cTheta, tmp1).add(v.multiplyScalar(sTheta, tmp2), vx).multiplyScalar(this.radiusX, vx);
    u.multiplyScalar(-sTheta, tmp1).add(v.multiplyScalar(cTheta, tmp2), vy).multiplyScalar(this.radiusY, vy);
    return { vx, vy };
  }

  /** @type {Point3d} */
  get majorRadiusAxis() {
    const { vx, vy } = this.radiusVectors();
    return vx.magnitudeSquared() > vy.magnitudeSquared ? vx : vy;
  }

  /** @type {Point3d} */
  get minorRadiusAxis() {
    const { vx, vy } = this.radiusVectors();
    return vx.magnitudeSquared() < vy.magnitudeSquared ? vx : vy;
  }

  get majorAxisEndpoints() {
    const v = this.majorRadiusAxis;
    return [this.center.add(v), this.center.subtract(v)];
  }

  get minorAxisEndpoints() {
    const v = this.minorRadiusAxis;
    return [this.center.add(v), this.center.subtract(v)];
  }


  /** @type {number<radians>} */
  #angle = 0;

  get angle() { return this.#angle; }

  set angle(value) {
    if ( this.#angle === value ) return;
    this.#angle = value;
    this.dirtyCentroid = true;
    this.dirtyAABB = true;
  }

  /**
   * Compute a point guaranteed to lie inside a simple polygon (convex or concave).
   * Unlike vertex-average or area-weighted centroid, this cannot fall outside the ring.
   * @returns {Point3d}
   */
  interiorPoint() { return this.center; }

  // ----- NOTE: Synonyms/Aliases -----

  /** @type {Point3d} */
  get centroid() { return this.center; }

  /** @type {number} */
  get halfWidth() { return this.radiusX }
  set halfWidth(value) { this.radiusX = value; }

  /** @type {number} */
  get halfHeight() { return this.radiusY; }
  set halfHeight(value) { this.radiusY = value; }

  constructor() {
    super(1); // 1 point representing the center.
  }

  // ----- NOTE: In-place modifiers ----- //

  /**
   * For Ellipse, the plane normal typically must be set, not calculated.
   * By default, the ellipse will face straight up, with normal {0, 0, 1}.
   */
  _calculatePlane(plane) {
    // Default to straight up if not already defined.
    plane.normal.set(0, 0, 1);
    // plane.point.copyFrom(this.points[0]); // Unneeded b/c get plane does this.
  }

  /**
   * Reverse the orientation of this polygon. Done in place.
   */
  reverseOrientation() {
    // Unlike the polygon, the ellipse's orientation is entirely dependent on its plane.
    // With only 1 point, no reason to reverse the points array.
    this.plane.normal.multiplyScalar(-1, this.plane.normal);
    return this;
  }

  _setDimensions({ center, radius, radiusSquared, radiusX, radiusY, angle } = {}) {
    if ( center ) this.center = center;
    if ( radius ) this.radius = radius;
    else if ( radiusSquared ) this.radiusSquared = radiusSquared;
    else if ( radiusX || radiusY ) {
      if ( radiusX ) this.radiusX = radiusX;
      if ( radiusY ) this.radiusY = radiusY;
    }

    if ( Number.isNumeric(angle) ) this.angle = angle;
    this.clearCache();
    return this;
  }

  clean() { return; }

  // ----- NOTE: Plane ----- //

  get ellipse() { return new Ellipse(this.center.x, this.center.y, this.radiusX, this.radiusY, { rotation: Math.toDegrees(this.angle) }); }

  // ----- NOTE: Factory methods ----- //

  static fromPIXIEllipse(ellipse, elevationZ = 0, angle, out) {
    using centerPt = Point3d.tmp.set(ellipse.x, ellipse.y, elevationZ)
    return this.fromCenterPoint(centerPt, { radiusX: ellipse.width, radiusY: ellipse.height, angle, out });
  }

  static fromEllipse2d(ellipse, elevationZ, out) {
    using centerPt = Point3d.tmp.set(ellipse.x, ellipse.y, elevationZ)
    return this.fromCenterPoint(centerPt, { radiusX: ellipse.width, radiusY: ellipse.height, angle: Math.toRadians(ellipse.rotation || 0), out });
  }

  static fromCenterPoint(center, { out, ...opts } = {}) {
    out ??= new this();
    opts.center = center;
    return out._setDimensions(opts);
  }

  static calculateDimensionsFromPoints(pts, { center, radius, radiusSquared, angle } = {}) {
    if ( radius && !radiusSquared ) radiusSquared = radius.multiply(radius);

    if ( !center ) {
      // Find two opposite points to locate the center.
      let max2 = Number.NEGATIVE_INFINITY;
      const iter = Iterator.from(pts);
      const a = iter.next().value;
      let lastB;
      const cl = a.constructor;
      for ( const b of iter ) {
        // Walk around the ellipse until finding the furthest point from a.
        // That point is on the opposite side from a.
        const dist2 = cl.distanceSquaredBetween(a, b);
        if ( dist2 < max2 ) {
          center = new cl();
          a.projectToward(lastB, 0.5, center);
          break;
        }
        max2 = dist2;
        lastB = b;
      }
    }
    if ( !radiusSquared || angle === undefined ) {
      // Must find the minimum and maximum distance from the polygon center to determine the two radii.
      let min2 = Number.POSITIVE_INFINITY;
      let max2 = Number.NEGATIVE_INFINITY;
      let majorAxisPt = pts[0];
      const cl = center.constructor;
      for ( const pt of pts ) {
        const dist2 = cl.distanceSquaredBetween(center, pt);
        min2 = Math.min(min2, dist2);

        // Track the point that gives us the max distance.
        if ( dist2 > max2 ) {
          max2 = dist2;
          majorAxisPt = pt;
        }
      }

      radiusSquared = PIXI.Point.tmp.set(max2, min2);

      // Determine the angle using the vector from the center to the major axis point.
      if ( angle === undefined ) angle = Math.atan2(majorAxisPt.y - center.y, majorAxisPt.x - center.x);
    }
    return { center, radiusSquared, radius, angle };
  }

  /**
   * Construct from a set of points that are on the ellipse edge.
   */
  static from2dPoints(pts, elevation = 0, opts, out) {
    const res = this.calculateDimensionsFromPoints(pts, opts);
    res.out = out;
    using centerPt = Point3d.tmp.set(res.center.x, res.center.y, elevation)
    return this.fromCenterPoint(centerPt, res);
  }

  static from3dPoints(pts, opts, out) {
    out ??= new this();
    const res = this.calculateDimensionsFromPoints(pts, opts);
    Plane.fromMultiplePoints([res.center, ...pts], out.plane);
    out._setDimensions(res);
    return out;
  }

  static fromPlanarPolygon(poly2d, plane, opts, out) {
    out ??= new this();
    out.plane.copyFrom(plane);
    const res = this.calculateDimensionsFromPoints(poly2d.iteratePoints(), opts);
    out._setDimensions(res);
    return out;
  }

  static fromPolygon(...args) { return Polygon3d.fromPolygon(...args); }

  static fromClipperPaths(...args) { return Polygon3d.fromClipperPaths(...args);  }

  static fromVertices(...args) { return Polygon3d.fromVertices(...args); }

  static fromPlanarEllipse(ellipse2d, plane, out) {
    using center = Point3d.tmp;
    const invM2d = plane.conversion2dMatrixInverse;
    invM2d.multiplyPoint3d(Point3d.tmp.set(ellipse2d.center.x, ellipse2d.center.y, 0), center);

    using radius = PIXI.Point.tmp.set(ellipse2d.width, ellipse2d.height);
    const opts = { center, radius, angle: ellipse2d.radians || 0 };

    out ??= new this();
    out.plane.copyFrom(plane);
    out._setDimensions(opts);
    return out;
  }

  clone(out) {
    out = super.clone(out);
    out.radiusX = this.radiusX;
    out.radiusY = this.radiusY;
    out.angle = this.angle;
    return out;
  }

  _cloneEmpty() {
    const out = super._cloneEmpty();
    out.radiusX = this.radiusX;
    out.radiusY = this.radiusY;
    out.angle = this.angle;
    return out;
  }

  // ----- NOTE: Conversions to ----- //

  toPlanarEllipse() {
    using center = Point3d.tmp;
    const centroid = this.centroid;
    if ( centroid.almostEqual(this.plane.point) ) center.set(0, 0, 0);
    else {
      const to2dM = this.plane.conversion2dMatrix;
      to2dM.multiplyPoint3d(centroid, center);
    }
    return new Ellipse(center.x, center.y, this.radiusX, this.radiusY, { rotation: Math.toDegrees(this.angle) });
  }

  /**
   * Convert to 2d polygon, dropping z.
   * @returns {PIXI.Polygon}
   */
  toPolygon2d() {  return this.toPolygon3d().toPolygon2d(); }

  toPolygon3d() {
    const poly2d = this.toPlanarPolygon();
    return Polygon3d.fromPlanarPolygon(poly2d, this.plane);
  }

  /**
   * @param {"x"|"y"|"z"} omitAxis    Which of the three axes to omit to drop this to 2d.
   * @param {object} [opts]
   * @param {number} [opts.scalingFactor]   How to scale the clipper points
   * @returns {ClipperPaths}
   */
  toClipperPaths(opts) { return this.toPolygon3d(opts).toClipperPaths(opts); }

  /**
   * Convert to 2d polygon by perspective transform, dividing each point by z.
   * @returns {PIXI.Polygon}
   */
  toPerspectivePolygon() { return this.toPolygon3d().toPerspectivePolygon(); }

  /**
   * @returns {Polygon3d}
   */
  toPlanarPolygon() {
    const ellipse = this.toPlanarEllipse();
    const poly = ellipse.toPolygon({ density: this.density });
    if ( this.isHole ^ !poly.isPositive ) poly.reverseOrientation();
    return poly;
  }

  toVertices(opts) { return this.toPolygon3d().toVertices(opts); }

  triangulate(opts = {}) {
    opts.useFan ??= true;
    return this.toPolygon3d().triangulate(opts);
  }

  // ----- NOTE: Iterators ----- //

  *iterateEdges() {
    const poly3d = this.toPolygon3d();
    for ( const edge of poly3d.iterateEdges() ) yield edge;
  }

  *iteratePoints() {
    const poly3d = this.toPolygon3d();
    for ( const pt of poly3d.iteratePoints() ) yield pt;
  }

  *reverseIterateEdges() {
    const poly3d = this.toPolygon3d();
    for ( const edge of poly3d.reverseIterateEdges() ) yield edge;
  }

  *reverseIteratePoints() {
    const poly3d = this.toPolygon3d();
    for ( const pt of poly3d.reverseIteratePoints() ) yield pt;
  }

  // ----- NOTE: Intersection ----- //

  /**
   * Is a 3d point that is on the plane within the polygon?
   * Does not check bounding box or if it is in fact on the plane.
   * @param {Point3d} pt
   * @returns {boolean}
   */
  _isIntersectionWithinPolygon(ix) {
    // If the plane is not vertical, can do a simple projection onto the x/y plane as a 2d polygon.
    let ix2d;
    let shape2d;
    if ( this.plane.normal.z ) {
      ix2d = ix.to2d();
      shape2d = this.ellipse;
    } else {
      ix2d = this._convert3dPointsTo2d([ix])[0];
      shape2d = this.toPlanarEllipse();
    }
    const contained = shape2d.contains(ix2d.x, ix2d.y);
    ix2d.release();
    return contained;
  }

  /**
   * Find the intervals of a line (ray) that intersects this polygon.
   * Assumes the line is on this plane.
   * @param {Point3d} origin
   * @param {Point3d} direction
   * @returns {number[]} T-values along the line.
   */
  _planarLineIntersections(origin, direction) {
    const r2 = this.radiusSquared;
    const { vx: uAxis, vy: vAxis } = this.radiusVectors();

    // Project 3d origin relative to center onto local 2d axes.
    using delta = origin.subtract(this.center);
    const ox = delta.dot(uAxis);
    const oy = delta.dot(vAxis);

    // Project 3d direction onto local 2d axes.
    const dx = direction.dot(uAxis);
    const dy = direction.dot(vAxis);

    // Quadratic coefficients.
    const a2 = r2.x;
    const b2 = r2.y;
    const A = ((dx ** 2) / a2) + ((dy ** 2) / b2);
    const B = 2 * ((ox * dx) / a2) + ((oy * dy) / b2);
    const C = ((ox ** 2) / a2) + ((oy ** 2) / b2) - 1;
    const discriminant = (B ** 2) - (4 * A * C);

    // If the discriminant is zero or negative, the line misses or just grazes the edge.
    if ( discriminant.almostLessThan(0) ) return [];

    // Calculate the two intersection t-values.
    const sqrtD = Math.sqrt(discriminant);
    const t1 = (-B - sqrtD) / (2 * A);
    const t2 = (-B + sqrtD) / (2 * A);

    // Return sorted interval.
    return [[t1, t2]];
  }


  // ----- NOTE: Transformations ----- //
  isValid() {
    this.clean();
    return this.points.length === 1;
  }

  /**
   * Transform this ellipse using a transformation matrix.
   * @param {Matrix} M
   * @param {Matrix} [invTransposeM]          The inverse transpose of M, when doing repeated calculations.
   * @returns {Ellipse3d|Circle3d} The modified ellipse or circle if the radii are equal.
   */
  transform(M, invTransposeM) {
    const out = super.transform(M, invTransposeM);

    // Calculate the ellipse-specific parameters.
    const { angle, radiusX, radiusY } = this;
    using tmp = Point3d.tmp;

    // Find the original major and minor axes as 2d vectors.
    const cosA = Math.cos(angle || 0);
    const sinA = Math.sin(angle || 0);
    using uLocal = Point3d.tmp.set(radiusX * cosA, radiusX * sinA, 0);
    using vLocal = Point3d.tmp.set(radiusY * -sinA, radiusY * cosA, 0);

    // Convert local 2d axes to 3d world vectors (ignore translation).
    const invM2d = this.plane.conversion2dMatrixInverse;
    using origin3d = invM2d.multiplyPoint3d(Point3d.tmp.set(0, 0, 0));
    using U = invM2d.multiplyPoint3d(uLocal, tmp).subtract(origin3d);
    using V = invM2d.multiplyPoint3d(vLocal, tmp).subtract(origin3d);

    // Apply the 3x3 transformation matrix to the vectors.
    using transformedU = MatrixFloat32.fromPoint3d(U, { homogenous: false });
    using transformedV = MatrixFloat32.fromPoint3d(V, { homogenous: false });
    const mat3 = M.subset({ rowEnd: 2, colEnd: 2 });
    transformedU.multiply1x3(mat3, transformedU);
    transformedV.multiply1x3(mat3, transformedV);

    using Uprime = transformedU.toPoint3d({ homogenous: false });
    using Vprime = transformedV.toPoint3d({ homogenous: false });

    // Resolve conjugate diameters into true major/minor axes.
    const dotUV = Uprime.dot(Vprime);
    const magU2 = Uprime.magnitudeSquared();
    const magV2 = Vprime.magnitudeSquared();

    // Find the parameter t that aligns with the major/minor axes.
    let t = 0;
    const delta = magU2 - magV2;
    if ( !(delta.almostEqual(0) && dotUV.almostEqual(0)) ) t = 0.5 * Math.atan2(2 * dotUV, delta);
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);

    // Reconstruct the orthogonal axes.
    using A = Point3d.tmp;
    using B = Point3d.tmp;
    Uprime.multiplyScalar(cosT, A).add(Vprime.multiplyScalar(sinT, tmp), A); // A = U' * cos(t) + V' * cos(t)
    Uprime.multiplyScalar(-sinT, B).add(Vprime.multiplyScalar(cosT, tmp), B); // B = U' * -sin(t) + V' * cos(t)

    // Ensure A is the longest (major) axis.
    let majorAxis = A;
    let minorAxis = B;
    if ( B.magnitudeSquared() > A.magnitudeSquared() ) [majorAxis, minorAxis] = [minorAxis, majorAxis];

    // Calculate the new radii.
    out.radiusX = majorAxis.magnitude();
    out.radiusY = minorAxis.magnitude();

    // If the radii are equal, return a circle. (Angle doesn't matter here.)
    if ( out.radiusX.almostEqual(out.radiusY) ) return Circle3d.fromEllipse3d(out);

    // Calculate the new angle in the new plane's 2d coordinate system.
    const newTo2dM = out.plane.conversion2dMatrix;
    using newOrigin2d = newTo2dM.multiplyPoint3d(Point3d.tmp.set(0, 0, 0));
    using majorAxis2d = newTo2dM.multiplyPoint3d(majorAxis, tmp).subtract(newOrigin2d);
    out.angle = Math.atan2(majorAxis2d.y, majorAxis2d.x);
    return out;
  }

 multiplyScalar(multiplier, out) {
    out ??= this._cloneEmpty();
    this.clone(out);

    // Store temporary in case ellipse3d is circle to avoid multiplying radius twice.
    const newRX = out.radiusX * multiplier;
    const newRY = out.radiusY * multiplier;
    out.radiusX = newRX;
    out.radiusY = newRY;
    return out;
  }

  scale({ x = 1, y = 1, z = 1 } = {}) {
    using scaleM = Matrix.scale({ x, y, z }, { d3: true });
    return this.transform(scaleM);
  }

  // divideByZ: same for ellipse.

  /**
   * Clip this ellipse in the z direction.
   * @param {number} z
   * @param {boolean} [keepLessThan=true]
   * @returns {Polygon3d}
   */
  clipZ({ z = -0.1, keepLessThan = true } = {}) {
    // If the plane is along the z axis, every point has the same z. Reject or keep.
    if ( this.plane.normal.x.almostEqual(0) && this.plane.normal.y.almostEqual(0) ) {
      const out = this._cloneEmpty();
      const toKeep = this.clipPlanePoints({
        cutoff: z,
        coordinate: "z",
        cmp: keepLessThan ? "lessThan" : "greaterThan"
      });
      out.points = toKeep; // Either keep or reject the center point.
      return out;
    }

    // Otherwise, convert to polygon and keep or reject
    const poly = this.toPolygon3d();
    return poly.clipZ({ z, keepLessThan });
  }

}

/**
 * Planar circle. Not to be confused with a sphere! This is a slice of a sphere in a plane.
 */
export class Circle3d extends Ellipse3d {

  static _geoLibType = "Circle3d";

  // For numerical consistency, store the radius squared to use when possible.
  get radius() { return this.radiusX; }

  get radiusSquared() { return this.radius * this.radius; }

  set radius(value) {
    if ( Number.isNumeric(value) ) {
      using v = PIXI.Point.tmp.set(value, value);
      super.radius = v;
    } else super.radius = value;
  }

  set radiusSquared(value) {
    if ( Number.isNumeric(value) ) {
      using v = PIXI.Point.tmp.set(value, value);
      super.radiusSquared = v;
    } else super.radiusSquared = value;
  }

  _setDimensions(opts = {}) {
    if ( Number.isNumeric(opts.radius) ) opts.radius = PIXI.Point.tmp.set(opts.radius, opts.radius);
    if ( Number.isNumeric(opts.radiusSquared) ) opts.radiusSquared = PIXI.Point.tmp.set(opts.radiusSquared, opts.radiusSquared);
    return super._setDimensions(opts);
  }

  // ----- NOTE: Plane ----- //

  get circle() { return new PIXI.Circle(this.center.x, this.center.y, this.radius); }

  // ----- NOTE: Factory methods ----- //

  static fromCircle(cir, elevationZ = 0, out) {
    using centerPt = Point3d.tmp.set(cir.x, cir.y, elevationZ);
    return this.fromCenterPoint(centerPt, cir.radius, out);
  }

  static fromCenterPoint(center, radius, out) {
    out ??= new this();
    out._setDimensions({ center, radius });
    return out;
  }

  static fromPlanarCircle(circle2d, plane, out) {
    using center = Point3d.tmp;
    const invM2d = plane.conversion2dMatrixInverse;
    invM2d.multiplyPoint3d(Point3d.tmp.set(circle2d.center.x, circle2d.center.y, 0), center);

    out ??= new this();
    out.plane = plane;
    out._setDimensions({ center, radius: circle2d.radius });
    return out;
  }

  /**
   * Create a circle from the ellipse, using either the maximum or minimum radii
   */
  static fromEllipse3d(ellipse3d, useMaximumRadius = true) {
    const fn = useMaximumRadius ? Math.max : Math.min;
    const radius = fn(ellipse3d.radiusX, ellipse3d.radiusY);
    const out = ellipse3d.clone(new this());
    out.radius = radius;
    return out;
  }

  // ----- NOTE: Conversions to ----- //

  toPlanarCircle() {
    using center = Point3d.tmp;
    const centroid = this.centroid;
    if ( centroid.almostEqual(this.plane.point) ) center.set(0, 0, 0);
    else {
      const to2dM = this.plane.conversion2dMatrix;
      to2dM.multiplyPoint3d(centroid, center);
    }
    return new PIXI.Circle(center.x, center.y, this.radius);
  }

  toPlanarPolygon() {
    const cir = this.toPlanarCircle();
    const poly = cir.toPolygon({ density: this.density });
    if ( this.isHole ^ !poly.isPositive ) poly.reverseOrientation();
    return poly;
  }

  /**
   * Create a grid of points within this 3d circle.
   * @param {object} [opts]
   * @param {number} [opts.spacing = 1]              How many pixels between each point?
   * @param {boolean} [opts.startAtEdge = false]     Are points allowed within spacing of the edges? Otherwise will be at least spacing away.
   * @returns {Point3d[]} Points in order from left to right, top to bottom.
   */
  pointsLattice(opts) {
    // Convert to 2d points and get the 2d points lattice.
    const cir = this.toPlanarCircle();

    // Construct lattice points in 2d.
    const latticePoints = cir.pointsLattice(opts);

    // Convert back to 3d.
    const out = this._convert2dPointsTo3d(latticePoints);
    PIXI.Point.release(...latticePoints);
    return out;
  }

  // ----- NOTE: Intersection ----- //

  /**
   * Is a 3d point that is on the plane within the polygon?
   * Does not check bounding box or if it is in fact on the plane.
   * @param {Point3d} pt
   * @returns {boolean}
   */
  _isIntersectionWithinPolygon(ix) {
    // If the plane is not vertical, can do a simple projection onto the x/y plane as a 2d polygon.
    let ix2d;
    let shape2d;
    if ( this.plane.normal.z ) {
      ix2d = ix.to2d();
      shape2d = this.circle;
    } else {
      ix2d = this._convert3dPointsTo2d([ix])[0];
      shape2d = this.toPlanarCircle();
    }
    const contained = shape2d.contains(ix2d.x, ix2d.y);
    ix2d.release();
    return contained;
  }

  // ----- NOTE: Transformations ----- //
  isValid() {
    this.clean();
    return this.points.length === 1;
  }

  multiplyScalar(multiplier, circle3d) {
    circle3d ??= this._cloneEmpty();
    this.clone(circle3d);
    circle3d.radius *= multiplier;
    return circle3d;
  }

  scale(axes, circle3d) {
    circle3d ??= this._cloneEmpty();
    return super.scale(axes, circle3d);
  }
}


/**
 * Planar triangle shape.
 */
export class Triangle3d extends Polygon3d {

  static _geoLibType = "Triangle3d";

  constructor() {
    super(3);
  }

  /** @type {Point3d} */
  get a() { return this.points[0]; }

  /** @type {Point3d} */
  get b() { return this.points[1]; }

  /** @type {Point3d} */
  get c() { return this.points[2]; }

  /**
   * Compute a point guaranteed to lie inside a simple polygon (convex or concave).
   * Unlike vertex-average or area-weighted centroid, this cannot fall outside the ring.
   * @returns {Point3d}
   */
  interiorPoint() { return this.centroid; }

  // ----- NOTE: Factory methods ----- //

  static from3Points(a, b, c, out) {
    out ??= new this();
    out.a.copyFrom(a);
    out.b.copyFrom(b);
    out.c.copyFrom(c);
    return out;
  }

  static fromPartial3Points(a, b, c, out) {
    out ??= new this();
    out.a.copyPartial(a);
    out.b.copyPartial(b);
    out.c.copyPartial(c);
    return out;
  }

  /**
   * Create an array of triangles from given indices and vertices.
   * @param {Number[]} vertices     Array of vertices, 3 coordinates per vertex, 3 vertices per triangle
   * @param {Number[]} [indices]    Indices to determine order in which triangles are created from vertices
   * @returns {Triangle[]}
   */
  static fromVertices(vertices, indices, { positionOffset = 0, stride = 3 } = {}) {
    if ( vertices.length % stride !== 0 ) console.error(`${this.name}.fromVertices|Length of vertices is not divisible by stride ${stride}: ${vertices.length}`);
    indices ??= Array.fromRange(Math.floor(vertices.length / stride));
    if ( indices.length % 3 !== 0 ) console.error(`${this.name}.fromVertices|Length of indices is not divisible by 3: ${indices.length}`);
    const tris = new Array(Math.floor(indices.length / 3));
    using a = Point3d.tmp;
    using b = Point3d.tmp;
    using c = Point3d.tmp;
    for ( let i = 0, j = 0, jMax = tris.length; j < jMax; ) {
      pointFromVertices(i++, vertices, indices, stride, positionOffset, a);
      pointFromVertices(i++, vertices, indices, stride, positionOffset, b);
      pointFromVertices(i++, vertices, indices, stride, positionOffset, c);
      tris[j++] = this.from3Points(a, b, c);
    }
    return tris;
  }


  /**
   * Create an array of triangles from given array of point 3ds and indices.
   * @param {Number[]} points       Point3ds
   * @param {Number[]} [indices]    Indices to determine order in which triangles are created from vertices
   */
  static fromPoints3dArray(points, indices) {
    const vertices = new Array(points.length * 3);
    for ( let i = 0, j = 0, iMax = points.length; i < iMax; i += 1 ) {
      const pt = points[i];
      vertices[j++] = pt.x;
      vertices[j++] = pt.y;
      vertices[j++] = pt.z;
    }
    return this.fromVertices(vertices, indices);
  }

  // ----- NOTE: Conversions to ----- //

  /**
   * Convert an array of triangles to a single Float32 array of vertices
   * @param {object} [opts]
   * @param {boolean} [opts.useNormal=false]      Add triangle normal to each vertex?
   * @param {Float32Array[]} [opts.outArr]        Array large enough to hold the triangles
   * @param {number} [opts.outIdx=0]              Copy triangle vertices to array starting here
   * @returns {Float32Array}
   */
  static trianglesToVertices(tris, { addNormals = false, outArr, outIdx = 0 } = {}) {
    const { NUM_POSITION_COORDS, NUM_NORMAL_COORDS, NUM_POINTS } = this;
    const stride = NUM_POSITION_COORDS + (addNormals * NUM_NORMAL_COORDS);
    outArr ||= new Float32Array(stride * NUM_POINTS * tris.length);
    const opts = { addNormals, outArr, outIdx };
    const adder = stride * NUM_POINTS;
    tris.forEach(tri => {
      tri.toVertices(opts);
      opts.outIdx += adder;
    });
    return outArr;
  }

  /**
   * Triangulate and convert to vertices.
   * @param {object} [opts]
   * @param {boolean} [opts.addNormals=false]         If true, add the normal to this polygon, facing CCW.
   * @param {Float32Array} [opts.outArr]              Where to store the vertices
   * @param {number} [opts.outIdx=0]                  What index to start setting each vertex
   * @returns {Float32Array[]}
   */
  toVertices({ addNormals = false, outArr, outIdx = 0 } = {}) {
    const { NUM_POSITION_COORDS, NUM_NORMAL_COORDS, NUM_POINTS } = this.constructor;
    const stride = NUM_POSITION_COORDS + (addNormals * NUM_NORMAL_COORDS);
    outArr ??= new Float32Array(stride * NUM_POINTS);
    // TODO: How can we be sure the normal points the correct way?
    // Should be set when constructing the triangle to point up when triangle is CCW.
    if ( addNormals ) {
      const normal = [...this.plane.normal];
      outArr.set([...this.a, ...normal, ...this.b, ...normal, ...this.c, ...normal], outIdx);
    } else outArr.set([...this.a, ...this.b, ...this.c], outIdx);
    return outArr;
  }

  // Trivially, a Triangle3d is already triangulated.
  triangulate() { return this; }

  static NUM_POSITION_COORDS = 3;

  static NUM_NORMAL_COORDS = 3;

  static NUM_POINTS = 3;

  // ----- NOTE: Intersection ----- //

  /**
   * Möller-Trumbore intersection algorithm for a triangle.
   * This function first calculates the edge vectors of the triangle and the determinant
   * of the triangle using the cross product and dot product. It then uses the Möller–Trumbore
   * intersection algorithm to calculate the intersection point using barycentric coordinates,
   * and checks if the intersection point is within the bounds of the triangle. If it is,
   * the function returns the distance from ray origin to point of intersection.
   * If the ray is parallel to the triangle or the intersection point is outside of the triangle,
   * the function returns null.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @returns {number} Distance from ray origin to the point of intersection.
   *
   */
  rayIntersectionMT(rayOrigin, rayDirection) {
    const [v0, v1, v2] = this.points;
    const EPSILON = this.constructor.EPSILON;

    // Calculate the edge vectors of the triangle
    using edge1 = v1.subtract(v0);
    using edge2 = v2.subtract(v0);

    // Calculate the determinant of the triangle
    using pvec = rayDirection.cross(edge2);

    // If the determinant is near zero, ray lies in plane of triangle
    const det = edge1.dot(pvec);
    if ( det.almostEqual(0, EPSILON) ) return null; // Ray is parallel to triangle
    const invDet = 1 / det;

    // Calculate the intersection point using barycentric coordinates
    using tvec = rayOrigin.subtract(v0);
    const u = invDet * tvec.dot(pvec);
    if ( u.strictlyLessThan(0, EPSILON) || u.strictlyGreaterThan(1, EPSILON) ) return null; // Intersection point is outside of triangle


    using qvec = tvec.cross(edge1, edge1);
    const v = invDet * rayDirection.dot(qvec);
    if ( v.strictlyLessThan(0, EPSILON) || (u + v).strictlyGreaterThan(1, EPSILON) ) return null; // Intersection point is outside of triangle

    // Calculate the distance to the intersection point
    const t = invDet * edge2.dot(qvec);
    return t.strictlyGreaterThan(0, EPSILON) ? t : null;
  }

  /**
   * Test if a ray intersects the triangle. Does not consider whether this triangle is facing.
   * Möller-Trumbore intersection algorithm for a triangle.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @returns {t|null} Returns null if not within the triangle
   */
  intersectionT(rayOrigin, rayDirection) {
    return this.rayIntersectionMT(rayOrigin, rayDirection);
  }

  /**
   * Clip this polygon in the z direction.
   * @param {number} z
   * @param {boolean} [keepLessThan=true]
   * @returns {Polygon3d}
   */
  clipZ({ z = -0.1, keepLessThan = true } = {}) {
    const toKeep = this.clipPlanePoints({
      cutoff: z,
      coordinate: "z",
      cmp: keepLessThan ? "lessThan" : "greaterThan"
    });
    const nPoints = toKeep.length;
    const out = nPoints === 3 ? (new this.constructor()) : (new Polygon3d());
    out.isHole = this.isHole;
    Point3d.release(...out.points); // May be empty array if Polygon3d.
    out.points = toKeep;
    return out;
  }

  // ----- NOTE: Property tests ----- //
  isValid() {
    this.clean();
    return this.points.length === 3;
  }
}


/**
 * A quad shape in 3d. Primarily for its fast intersection test and ease of splitting into triangles.
 */
export class Quad3d extends Polygon3d {

  static _geoLibType = "Quad3d";

  constructor() {
    super(4);
  }

  /** @type {Point3d} */
  get a() { return this.points[0]; }

  /** @type {Point3d} */
  get b() { return this.points[1]; }

  /** @type {Point3d} */
  get c() { return this.points[2]; }

  /** @type {Point3d} */
  get d() { return this.points[3]; }

  /**
   * Compute a point guaranteed to lie inside a simple polygon (convex or concave).
   * Unlike vertex-average or area-weighted centroid, this cannot fall outside the ring.
   * @returns {Point3d}
   */
  interiorPoint() { return this.centroid; }

// ----- NOTE: Factory methods ----- //

  static from4Points(a, b, c, d, out) {
    out ??= new this();
    out.a.copyFrom(a);
    out.b.copyFrom(b);
    out.c.copyFrom(c);
    out.d.copyFrom(d);
    return out;
  }

  static fromPartial4Points(a, b, c, d, out) {
    out ??= new this();
    out.a.copyPartial(a);
    out.b.copyPartial(b);
    out.c.copyPartial(c);
    out.d.copyPartial(d);
    return out;
  }

  static fromRectangle(rect, elevZ = 0, out) {
    out ??= new this();
    out.points[0].set(rect.left, rect.top, elevZ);
    out.points[1].set(rect.right, rect.top, elevZ);
    out.points[2].set(rect.right, rect.bottom, elevZ);
    out.points[3].set(rect.left, rect.bottom, elevZ);
    return out;
  }

  triangulate() {
    const t1 = Triangle3d.from3Points(this.a, this.b, this.c);
    const t2 = Triangle3d.from3Points(this.a, this.c, this.d);
    t1.isHole = this.isHole;
    t2.isHole = this.isHole;
    return [t1, t2];
  }

  // ----- NOTE: Intersection ----- //

  /**
   * Test if a ray intersects the quad. Does not consider whether this triangle is facing.
   * Lagae-Dutré intersection algorithm for a quad.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @returns {t|null} Returns null if not within the quad
   */
  intersectionT(rayOrigin, rayDirection) {
    return this.rayIntersectionMT(rayOrigin, rayDirection);
  }


  /**
   * Test the two triangles of the quad. Inefficient compared to rayIntersection below but simple.
   * Kept for debugging comparisons.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {Point3d} v0
   * @param {Point3d} v1
   * @param {Point3d} v2
   * @param {Point3d} v3
   */
  _rayIntersectionDual(rayOrigin, rayDirection) {
    const [v0, v1, v2, v3] = this.points;

    // First triangle.
    using tri0 = Triangle3d.from3Points(v0, v1, v2);
    const t0 = tri0.rayIntersectionMT(rayOrigin, rayDirection);
    if ( t0 ) return t0;

    // Second triangle.
    using tri1 = Triangle3d.from3Points(v1, v2, v3);
    return tri1.rayIntersectionMT(rayOrigin, rayDirection);
  }

  /**
   * Intersection test, splitting the quad into two Müller-Trumbore triangles.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @returns {number|null}  Null if no intersection. If negative, the intersection is behind the ray origin.
   */
  rayIntersectionMT(rayOrigin, rayDirection) {
    const [v0, v1, v2, v3] = this.points;
    const tmpPoints = Point3d.createN(10);
    // rayDirection = rayDirection.normalize();

    /*
    v0 --- v1
     |     |
     |     |
    v3 --- v2
    */

    // --- Triangle 1: V0, V1, V3 ---

    // Edge vectors.
    const edge1 = v1.subtract(v0, tmpPoints[0]);
    const edge2 = v3.subtract(v0, tmpPoints[1]);

    // Cross product rayDirection × e03.
    const p = rayDirection.cross(edge2, tmpPoints[2]);

    // Determinant. If close to 0, ray is parallel to plane.
    const det = edge1.dot(p);

    // If determinant is near zero, ray lies in plane of triangle.
    if ( det.almostEqual(0) ) { Point3d.release(...tmpPoints); return null; }

    // Vector to ray origin.
    const tVec = rayOrigin.subtract(v0, tmpPoints[3]);

    // Calculate Barycentric u (alpha) parameter.
    const invDet = 1.0 / det;
    const u = tVec.dot(p) * invDet;

    // Calculate Barycentric v (beta) parameter.
    const q = tVec.cross(edge1, tmpPoints[4]);
    const v = rayDirection.dot(q) * invDet;

    // Check Triangle 1 Intersection:
    // Condition: alpha (u) >= 0, beta (v) >= 0, alpha + beta <= 1
    const EPSILON = this.constructor.EPSILON;
    if ( u.almostGreaterThan(0.0, EPSILON)
      && v.almostGreaterThan(0.0, EPSILON)
      && (u + v).almostLessThan(1.0, EPSILON) ) {

      const t = edge2.dot(q) * invDet;
      if ( t.strictlyGreaterThan(0.0, EPSILON) ) { Point3d.release(...tmpPoints); return t; } // Could return { u, v, triangle: 1 }
    }

    // --- Triangle 2: V1, V2, V3 ---
    const edge1Prime = v1.subtract(v2, tmpPoints[5]);
    const edge2Prime = v3.subtract(v2, tmpPoints[6]);
    const pPrime = rayDirection.cross(edge2Prime, tmpPoints[7]);
    const detPrime = edge1Prime.dot(pPrime);

    if ( detPrime.almostEqual(0) ) { Point3d.release(...tmpPoints); return null; }

    const invDetPrime = 1.0 / detPrime;
    const tVecPrime = rayOrigin.subtract(v2, tmpPoints[8]); // Vector to ray origin.

    const uPrime = tVecPrime.dot(pPrime) * invDetPrime; // Aka alphaPrime.
    if ( uPrime.strictlyLessThan(0.0, EPSILON)
      || uPrime.strictlyGreaterThan(1.0, EPSILON) ) { Point3d.release(...tmpPoints);  return null; }

    const qPrime = tVecPrime.cross(edge1Prime, tmpPoints[9]);
    const vPrime = rayDirection.dot(qPrime) * invDetPrime;
    if ( vPrime.strictlyLessThan(0.0, EPSILON)
      || (uPrime + vPrime).strictlyGreaterThan(1.0, EPSILON) ) { Point3d.release(...tmpPoints); return null; }

    // Hit Triangle 2
    // Note: Mapping barycentric to bilinear for T2 is complex.
    // Simple approximation: u = 1-beta', v = 1-alpha' (valid for parallelograms)
    const tPrime = edge2Prime.dot(qPrime) * invDetPrime;
    if ( tPrime.strictlyGreaterThan(0.0, EPSILON) ) { Point3d.release(...tmpPoints); return tPrime; }
    Point3d.release(...tmpPoints);
    return null;
  }

  /**
   * True Lagae–Dutré ray / bilinear-quad intersection.
   * A. Lagae & P. Dutré, "An Efficient Ray-Quadrilateral Intersection Test", JGT 2005.
   * https://graphics.cs.kuleuven.be/publications/LD04ERQIT/LD04ERQIT_paper.pdf
   *
   * Unlike splitting the quad into two Möller–Trumbore triangles, this treats the
   * quad's four corners as a single bilinear patch
   *   Q(u,v) = (1-u)(1-v)Q00 + u(1-v)Q10 + uv Q11 + (1-u)v Q01
   * and solves directly for (u, v, t). That makes it correct even when the four
   * points are *not* coplanar, where a two-triangle split would introduce a crease
   * along whichever diagonal you happened to pick.
   *
   * Vertex correspondence with this class's existing v0..v3 layout
   *   v0 --- v1        Q00 --- Q10
   *    |     |    ==>   |       |
   *   v3 --- v2        Q01 --- Q11
   * i.e. Q00 = v0, Q10 = v1, Q11 = v2, Q01 = v3 (perimeter order).
   *
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @returns {number|null} Distance from ray origin to the intersection point, or null if none.
   */
  _rayIntersectionLD(rayOrigin, rayDirection) {
    // If using for a quad whose points do not change, alpha11 and beta11 could be cached.

    const [Q00, Q10, Q11, Q01] = this.points;
    const EPSILON = this.constructor.EPSILON;

    using E01 = Q10.subtract(Q00);
    using E03 = Q01.subtract(Q00);

    // ----- First test: reject rays that miss the wedge at corner Q00 ----- //
    using P = rayDirection.cross(E03);
    const det = E01.dot(P);
    if ( det.almostEqual(0, EPSILON) ) return null; // Ray parallel to the patch here.
    const invDet = 1 / det;

    using T = rayOrigin.subtract(Q00);
    const alpha = T.dot(P) * invDet;
    if ( alpha.strictlyLessThan(0, EPSILON) ) return null;

    using Q = T.cross(E01);
    const beta = rayDirection.dot(Q) * invDet;
    if ( beta.strictlyLessThan(0, EPSILON) ) return null;

    // ----- Second test: only needed when the first test alone is ambiguous. -----
    // (alpha + beta > 1 can still be a valid hit on a non-parallelogram patch; this
    // mirrors the same wedge test from the opposite corner, Q11, to confirm it.)
    if ( (alpha + beta).strictlyGreaterThan(1, EPSILON) ) {
      using E23 = Q01.subtract(Q11);
      using E21 = Q10.subtract(Q11);
      using Pp = rayDirection.cross(E21);
      const detP = E23.dot(Pp);
      if ( detP.almostEqual(0, EPSILON) ) return null;
      const invDetP = 1 / detP;

      using Tp = rayOrigin.subtract(Q11);
      const alphaP = Tp.dot(Pp) * invDetP;
      if ( alphaP.strictlyLessThan(0, EPSILON) ) return null;

      using Qp = Tp.cross(E23);
      const betaP = rayDirection.dot(Qp) * invDetP;
      if ( betaP.strictlyLessThan(0, EPSILON) ) return null;
    }

    // ----- Distance along the ray. ----- //
    const t = E03.dot(Q) * invDet;
    if ( t.strictlyLessThan(0, EPSILON) ) return null;

    // ----- Bilinear (u, v) of the hit point. ----- //
    // alpha11/beta11 describe how far Q11 deviates from lying at bilinear (1,1) —
    // i.e. how non-parallelogram the patch is. These depend only on the quad's
    // shape, not on the ray, so a caller doing many ray tests against the same
    // quad could hoist/cache this block (much like `plane` is cached elsewhere
    // in this file) instead of recomputing it on every call.
    using E02 = Q11.subtract(Q00);
    using n = E01.cross(E03);
    const { x: nx, y: ny, z: nz } = n;
    const absNx = Math.abs(nx);
    const absNy = Math.abs(ny);
    const absNz = Math.abs(nz);

    let alpha11;
    let beta11;
    if ( absNx >= absNy && absNx >= absNz ) {
      alpha11 = ((E02.y * E03.z) - (E02.z * E03.y)) / nx;
      beta11  = ((E01.y * E02.z) - (E01.z * E02.y)) / nx;
    } else if ( absNy >= absNx && absNy >= absNz ) {
      alpha11 = ((E02.z * E03.x) - (E02.x * E03.z)) / ny;
      beta11  = ((E01.z * E02.x) - (E01.x * E02.z)) / ny;
    } else {
      alpha11 = ((E02.x * E03.y) - (E02.y * E03.x)) / nz;
      beta11  = ((E01.x * E02.y) - (E01.y * E02.x)) / nz;
    }

    let u;
    let v;
    if ( (alpha11 - 1).almostEqual(0, EPSILON) ) {
      // Patch is a trapezoid along the E01 direction.
      u = alpha;
      v = (beta11 - 1).almostEqual(0, EPSILON) ? beta : beta / ((u * (beta11 - 1)) + 1);
    } else if ( (beta11 - 1).almostEqual(0, EPSILON) ) {
      // Patch is a trapezoid along the E03 direction.
      v = beta;
      u = alpha / ((v * (alpha11 - 1)) + 1);
    } else {
      // General (non-planar-friendly) case: solve a quadratic for u.
      const A = -(beta11 - 1);
      const B = (alpha * (beta11 - 1)) - (beta * (alpha11 - 1)) - 1;
      const C = alpha;
      const discriminant = Math.max((B * B) - (4 * A * C), 0); // Clamp against fp noise.
      const sqrtDisc = Math.sqrt(discriminant);
      const root = -0.5 * (B + ((B < 0 ? -1 : 1) * sqrtDisc));
      u = root / A;
      if ( u < 0 || u > 1 ) u = C / root;
      v = beta / ((u * (beta11 - 1)) + 1);
    }

    // u, v are available here for texture/barycentric lookups if ever needed —
    // return { t, u, v } instead of `t` alone if a caller wants them.
    return t;
  }

  /**
   * Clip this polygon in the z direction.
   * @param {number} z
   * @param {boolean} [keepLessThan=true]
   * @returns {Polygon3d}
   */
  clipZ({ z = -0.1, keepLessThan = true } = {}) {
    const toKeep = this.clipPlanePoints({
      cutoff: z,
      coordinate: "z",
      cmp: keepLessThan ? "lessThan" : "greaterThan"
    });
    const nPoints = toKeep.length;
    const out = nPoints === 4 ? (new this.constructor()) : (new Polygon3d());
    out.isHole = this.isHole;
    Point3d.release(...out.points); // May be empty array if Polygon3d.
    out.points = toKeep;
    return out;
  }

  isValid() {
    this.clean();
    return this.points.length === 4;
  }

  /**
   * Create a grid of points within this polygon.
   * @param {object} [opts]
   * @param {number} [opts.spacing = 1]              How many pixels between each point?
   * @param {boolean} [opts.startAtEdge = false]     Are points allowed within spacing of the edges? Otherwise will be at least spacing away.
   * @returns {Point3d[]} Points in order from left to right, top to bottom.
   */
  pointsLattice(opts) {
    // Convert to 2d points and get the 2d points lattice.
    let poly = this.toPlanarPolygon();

    // If the quad creates an AABB rectangle, use rectangle instead b/c much faster lattice creation
    const xMinMax = Math.minMax(poly.points[0], poly.points[2], poly.points[4], poly.points[6]);
    const yMinMax = Math.minMax(poly.points[1], poly.points[3], poly.points[5], poly.points[7]);
    if ( (poly.points[0] === xMinMax.min || poly.points[0] === xMinMax.max)
      && (poly.points[2] === xMinMax.min || poly.points[2] === xMinMax.max)
      && (poly.points[4] === xMinMax.min || poly.points[4] === xMinMax.max)
      && (poly.points[6] === xMinMax.min || poly.points[6] === xMinMax.max)
      && (poly.points[1] === yMinMax.min || poly.points[1] === yMinMax.max)
      && (poly.points[3] === yMinMax.min || poly.points[3] === yMinMax.max)
      && (poly.points[5] === yMinMax.min || poly.points[5] === yMinMax.max)
      && (poly.points[7] === yMinMax.min || poly.points[7] === yMinMax.max) ) {

      poly = new PIXI.Rectangle(
        xMinMax.min,
        yMinMax.min,
        xMinMax.max - xMinMax.min,
        yMinMax.max - yMinMax.min)
    }

    // Construct lattice points in 2d.
    const latticePoints = poly.pointsLattice(opts);

    // Convert back to 3d.
    const out = this._convert2dPointsTo3d(latticePoints);
    PIXI.Point.release(...latticePoints);
    return out;
  }

}

/**
 * Represent 1+ polygons that represent a shape.
 * Each can be a Polygon3d that is either a hole or outer (not hole). See Clipper Paths.
 * An outer polygon may be contained within a hole. Parent-child structure not maintained.
 */
export class Polygons3d extends Polygon3d {

  static _geoLibType = "Polygons3d";

  /** @type {boolean|null} */
  get isHole() {
    let hasHoles = false;
    let hasSolids = false;
    for ( const poly of this.polygons ) {
      hasHoles ||= poly.isHole;
      hasSolids ||= !poly.isHole;
    }
    if ( hasHoles && hasSolids ) {
      console.debug(`${this.constructor.name}|isHole called on object with holes and solids.`, this);
      return null;
    }
    return hasHoles;
  }

  /** @type {Polygon3d[]} */
  polygons = [];

  // TODO: Determine the convex hull of the polygons to determine the points of this polygon?
  constructor(n = 0) {
    super(0);
    this.polygons.length = n;
  }

  release() {
    this.#applyMethodToAll("release");
  }

  #applyMethodToAll(method, ...args) { this.polygons.forEach(poly => poly[method](...args)); }

  #applyMethodToAllWithReturn(method, ...args) { return this.polygons.map(poly => poly[method](...args)); }

  #applyMethodToAllWithClone(method, poly3d, ...args) {
    poly3d = this.clone(poly3d);
    poly3d.polygons.forEach(poly => poly[method](...args, poly));
    return poly3d;
  }

  static #createSingleUsingMethod(method, out, ...args) {
    out ??= new this(1);
    out.polygons.length = 1;
    out.polygons[0] = Polygon3d[method](...args);
    return out;
  }

  /**
   * Compute a point guaranteed to lie inside a simple polygon (convex or concave).
   * Unlike vertex-average or area-weighted centroid, this cannot fall outside the ring.
   * @returns {Point3d}
   */
  interiorPoint() {
    if ( this.polygons.every(poly => poly.isHole) ) throw Error("Polygons3d#interiorPoint|All polygons are holes!");

    // Use the same conversion matrix for all the polygons, based on the shared plane.
    const from2dM = this.plane.conversion2dMatrixInverse;
    const poly2ds = this.toPlanarPolygon();

    const n = this.polygons.length;
    const isInside = pt => {
      if ( poly2ds.length === 1 ) return poly2ds[0].contains(pt.x, pt.y) ^ !poly2ds[0].isPositive;

      let count = 0;
      for ( let i = 0; i < n; i += 1 ) {
        const poly2d = poly2ds[i]
        count += poly2d.contains(pt.x, pt.y) * (poly2d.isPositive ? 1 : -1);
      }
      return count > 0;
    }

    // Start with interior points of each solid polygon.
    using tmp3d = Point3d.tmp;
    for ( const poly2d of poly2ds ) {
      if ( !poly2d.isPositive ) continue;
      const testPt = poly2d.interiorPoint();
      if ( isInside(testPt) ) return from2dM.multiplyPoint3d(tmp3d.set(testPt.x, testPt.y, 0));
    }

    // Triangulate the multi-polygon shape into non-overlapping interior
    const triSet = this.triangulate();
    if ( !triSet.polygons.length ) throw Error("Polygons3d#interiorPoint|Triangulation produced no valid geometry.");

    // Find the triangle with the largest area to ensure a stable interior point away from narrow edges.
    let maxAreaSq = -1;
    let bestTri = triSet.polygons[0];
    using edge1 = Point3d.tmp;
    using edge2 = Point3d.tmp;
    using cross = Point3d.tmp;
    for ( const tri of triSet.polygons ) {
      tri.b.subtract(tri.a, edge1);
      tri.c.subtract(tri.a, edge2);
      edge1.cross(edge2, cross);

      const areaSq = cross.magnitudeSquared();
      if ( areaSq > maxAreaSq ) {
        maxAreaSq = areaSq;
        bestTri = tri;
      }
    }

    // Return the centroid of the largest triangle (guaranteed to be inside the polygon and away from holes).
    const out = bestTri.centroid;
    triSet.forEach(tri => tri.release());
    return out;
  }

  // ----- NOTE: In-place modifiers ----- //

  /**
   * Clear the getter caches.
   */
  clearCache(clearPolygons = true) {
    if ( clearPolygons ) this.#applyMethodToAll("clearCache");
    super.clearCache();
  }

  clean() {
    this.#applyMethodToAll("clean");
    this.polygons = this.polygons.filter(poly => poly.isValid()); // Trim polygons that may have just been collinear lines.
  }

  setZ(z) {
    this.#applyMethodToAll("setZ", z);
    super.setZ(z);
    return this;
  }

  reverseOrientation() { this.#applyMethodToAll("reverseOrientation"); return this; }

  // ----- NOTE: Bounds ----- //

  /** @type {object<minMax>} */
  _calculateAABB(aabb) {
    const combinedBounds = AABB3d.union(this.polygons.map(poly3d => poly3d.aabb));
    aabb.min.copyFrom(combinedBounds.min);
    aabb.max.copyFrom(combinedBounds.max);
  }

  // ----- NOTE: Plane ----- //

  /** @type {Plane} */
  get plane() { return this.polygons[0].plane; }

  set plane(value) { this.polygons.forEach(poly => poly.plane = value); }

  // ----- NOTE: Centroid ----- //

  _calculateAreaWeightedCentroid() {
    // Assuming flat points, determine plane and then convert to 2d
    const plane = this.plane;
    const points = this.polygons.flatMap(poly => poly.points);
    const M2d = plane.conversion2dMatrix;
    const points2d = points.map(pt3d => M2d.multiplyPoint3d(pt3d));

    // Find the convex hull for all 2d points.
    const convex2dPoints = convexHull(points2d);

    // Determine the centroid of the 2d convex polygon.
    const convexPoly2d = new PIXI.Polygon(convex2dPoints);
    const center2d = convexPoly2d.center;
    const centroid = Point3d.tmp.set(center2d.x, center2d.y, 0);

    // Convert back to 3d, and determine the z value.
    const invM2d = plane.conversion2dMatrixInverse;
    invM2d.multiplyPoint3d(centroid, centroid);
    return centroid;
  }

  // ----- NOTE: Factory methods ----- //

  static from3dPolygons(polys, out) {
    const n = polys.length;
    out ??= new this(n);

    // Copy over the plane, which must be shared among the polygons.
    // Polygons3d defaults to making the first polygon the plane.
    out.polygons[0] = polys[0];
    for ( let i = 1; i < n; i += 1 ) {
      if ( !polys[i].plane.almostEqual(out.plane) ) console.warn("Polygon3d.from3dPolygons|Planes are not equivalent.", polys);
      out.polygons[i] = polys[i];
    }
    return out;
  }

  static from2dPoints(pts, elevation, out) { return this.#createSingleUsingMethod("from2dPoints", out, pts, elevation); }

  static from3dPoints(pts, out) { return this.#createSingleUsingMethod("from3dPoints", out, pts); }

  static fromPolygon(poly, elevation, out) { return this.#createSingleUsingMethod("fromPolygon", out, poly, elevation); }

  static fromPolygons(polys, elevation, out) {
    out ??= new this();
    out.polygons = polys.map(poly => Polygon3d.fromPolygon(poly, elevation));
    return out;
  }

  static fromClipperPaths(cpObj, elevation, out) {
    out ??= new this();
    out.polygons = Polygon3d.fromClipperPaths(cpObj, elevation);
    return out;
  }

  static fromVertices(vertices, indices, out) { return this.#createSingleUsingMethod("fromVertices", out, vertices, indices); }

  static fromPlanarPolygons(polys, plane, out) {
    out ??= new this();
    out.polygons = polys.map(poly => Polygon3d.fromPlanarPolygon(poly, plane));
    return out;
  }

  clone(out) {
    const n = this.polygons.length;
    out ??= new this.constructor(n);

    // If out was supplied, it may be the wrong polygon length.
    const outPolys = out.polygons;
    const thisPolys = this.polygons;
    if ( outPolys.length !== n ) outPolys.length = n;

    // Clone each polygon. If the polygon is the same, use it. Otherwise, clone anew.
    for ( let i = 0; i < n; i += 1 ) {
      const outPoly = outPolys[i];
      const thisPoly = thisPolys[i];
      if ( outPoly instanceof thisPoly.constructor
        && thisPoly instanceof outPoly.constructor ) thisPoly.clone(outPoly);
      else outPolys[i] = thisPoly.clone();
    }
    return out;
  }

  // ----- NOTE: Conversions to ----- //

  /**
   * @param {"x"|"y"|"z"} omitAxis    Which of the three axes to omit to drop this to 2d.
   * @param {object} [opts]
   * @param {number} [opts.scalingFactor]   How to scale the clipper points
   * @returns {ClipperPaths}
   */
  toClipperPaths({ omitAxis = "z", scalingFactor = 100 } = {}) {
    // Convert all to Polygons3d
    const polys3d = this.polygons.map(poly => {
      if ( poly instanceof Ellipse3d ) return poly.toPolygon3d({ scalingFactor });
      return poly;
    });

    // Convert to PIXI.Polygons. See Polygon3d#toClipperPaths.
    let axes;
    switch ( omitAxis ) {
      case "x": axes = { x: "y", y: "z" }; break;
      case "y": axes = { x: "x", y: "z" }; break;
      case "z": axes = { x: "x", y: "y" }; break;
      default: throw new Error(`${this.constructor.name}|toClipperPaths omitAxis not recognized.`);
    }
    const polys2d = polys3d.map(poly3d => {
      const poly = new PIXI.Polygon(poly3d.points.map(pt => pt.to2d(axes)));
      if ( !poly3d.isHole ^ poly.isPositive ) poly.reverseOrientation();
      poly.clean();
      return poly;
    });

    return CONFIG.GeometryLib.CONFIG.ClipperPaths.fromPolygons(polys2d, { scalingFactor });
  }

  toPolygon2d(opts) { return this.#applyMethodToAllWithReturn("toPolygon2d", opts); }

  toPerspectivePolygon() { return this.#applyMethodToAllWithReturn("toPerspectivePolygon"); }

  /**
   * Convert all the polygons to a 2d space, sharing the same axes.
   * @returns {PIXI.Polygon[]}
   */
  toPlanarPolygon() {
    // Use the same conversion matrix for all the polygons, based on the shared plane.
    const to2dM = this.plane.conversion2dMatrix;

    // Convert all polygons to a shared 2d space.
    // See Polygon3d.toPlanarPoints and Polygon3d.toPlanarPolygon
    const toPlanar = (poly3d, to2dM) => {
      using tmpPt = Point3d.tmp;
      const pt2ds = [];
      for ( const pt of poly3d.iteratePoints() ) pt2ds.push(to2dM.multiplyPoint3d(pt, tmpPt).to2d());
      const poly = new PIXI.Polygon(...pt2ds);
      if ( !poly3d.isHole ^ poly.isPositive ) poly.reverseOrientation();
      return poly;
    };
    return this.polygons.map(poly3d => toPlanar(poly3d, to2dM));
  }

  /**
   * Convert these polygons to vertices.
   * @param {object} [opts]     Passed to Triangle3d.trianglesToVertices
   * @returns {Float32Array}
   */
  toVertices(opts) {
    const tris = this.triangulate();
    return Triangle3d.trianglesToVertices(tris.polygons, opts);
  }

  /**
   * Triangulate the polygons, converting to array of Triangle3d.
   * Currently handles either all solid polygons or a single solid polygon plus 1+ holes.
   * @returns {Polygons3d} A new polygons3d that is solely triangles
   */
  triangulate(opts) {
    const solids = [];
    const holes = [];
    for ( const poly of this.polygons ) {
      const arr = poly.isHole ? holes : solids;
      arr.push(poly);
    }
    if ( !solids.length ) return new this.constructor();
    if ( solids.length > 1 && !holes.length ) {
      const out = new this.constructor();
      this.polygons.forEach(poly => out.polygons.push(...poly.triangulate(opts)));
      return out;
    } else if ( solids.length > 1 ) console.warn("Polygons3d#triangulate|Expects one solid per instance if holes are present.");

    const outer = solids[0];
    const plane = this.plane;
    const to2dM = plane.conversion2dMatrix;

    // Flat [x, y, x, y, ...] coordinate list + starting index of each hole, per earcut's format.
    const vertsFlat = [];
    const holeIndices = [];
    const allPts3d = [];
    const addRing = ring => {
      for ( const pt of ring.iteratePoints() ) {
        const pt2d = to2dM.multiplyPoint3d(pt);
        vertsFlat.push(pt2d.x, pt2d.y);
        allPts3d.push(pt);
      }
    }
    addRing(outer);
    for ( const ring of holes ) {
      holeIndices.push(vertsFlat.length / 2);
      addRing(ring);
    }

    // One triangulation pass, holes subtracted.
    const triIndices = PIXI.utils.earcut(vertsFlat, holeIndices, 2);

    // Build the triangles.
    const n = Math.floor(triIndices.length / 3);
    const out = new this.constructor(n);
    for ( let i = 0, j = 0; j < n; ) {
      const tri = Triangle3d.from3Points(
        allPts3d[triIndices[i++]],
        allPts3d[triIndices[i++]],
        allPts3d[triIndices[i++]],
      );
      out.polygons[j++] = tri;
    }
    return out;
  }

  buildTopSides(bottomZ, epsilon) {
    const sides = [];
    for ( const poly3d of this.polygons ) sides.push(...poly3d.buildTopSides(bottomZ, epsilon));
    return sides;
  }

  // ----- NOTE: Iterators ----- //

  /**
   * Iterator: a, b, c.
   */
  [Symbol.iterator]() {
    const n = this.polygons.length;
    const data = this;
    let index = 0;
    return {
      next() {
        if ( index < n ) return {
          value: data.polygons[index++],
          done: false };
        else return { done: true };
      }
    };
  }

  forEach(callback, thisArg) {
    this.polygons.forEach(callback, thisArg);
  }

  // ----- NOTE: Property tests ----- //

  isFacing(p) {
    // All polygons should face the same way for purposes of Polygons3d.
    // But to be sure, find a solid, not a hole.
    for ( const poly of this.polygons ) {
      if ( poly.isHole ) continue;
      return poly.isFacing(p);
    }
    return null;
  }

  // Valid if it forms at least one polygon.
  isValid() {
    return this.polygons.length
      && this.polygons.every(poly => poly.isValid())
      && this.polygons.some(poly => !poly.isHole);
  }

  // ----- NOTE: Transformations ----- //

  transform(M, invTransposeM) {
    const out = new this.constructor();
    this.polygons.forEach(poly => out.polygons.push(poly.transform(M, invTransposeM)));
    return out;
  }

  multiplyScalar(multiplier, poly3d) {
    const out = this.#applyMethodToAllWithClone("multiplyScalar", poly3d, multiplier);
    out.clearCache(false);
    return out;
  }

  scale(pt) {
    const out = new this.constructor();
    this.polygons.forEach(poly => out.polygons.push(poly.scale(pt)));
    return out;
  }

  divideByZ(poly3d) {
    const out = this.#applyMethodToAllWithClone("divideByZ", poly3d);
    out.clearCache(false);
    return out;
  }

  // ----- NOTE: Intersection ----- //

  /**
   * Test if a ray is within the polygon bounds and intersects the polygon's plane.
   * Does not consider whether this polygon is facing.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {object} [opts]
   * @param {boolean} [holesBlock = false]        If false, polygon holes return null
   * @returns {number|null} The t value of the plane intersection.
   */
  intersectionT(rayOrigin, rayDirection, { holesBlock = false } = {}) {
    // First get the plane intersection.
    const plane = this.plane;
    const t = plane.rayIntersection(rayOrigin, rayDirection);
    if ( t === null ) return null;
    using ix = Point3d.tmp;
    rayOrigin.add(rayDirection.multiplyScalar(t, ix), ix)

    // Test 3d bounding box.
    if ( !this.aabb.almostContainsPoint(ix) ) return null;
    return this._isIntersectionWithinPolygon(ix, holesBlock) ? t : null;
  }

  /**
   * Test if a ray intersects the polygon. Does not consider whether this polygon is facing.
   * Ignores holes. If 2+ polygons overlap, it will count as an intersection if it intersects
   * more outer than holes.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {number} [opts.minT=0]        Ignore hits earlier in the segment than this (multiple of rayDirection)
   * @param {number} [opts.maxT=1]        Ignore hits later in the segment than this (multiple of rayDirection)
   * @param {boolean} [opts.holesBlock = false]        If false, polygon holes return null
   * @returns {Point3d|null}
   */
  intersection(rayOrigin, rayDirection, opts = {}) {
    // Polygons with holes may have intersections on the solid polygon + the hole.
    // Need more solid than hole to count.
    let holeCount = 0;
    let ix;
    opts.holesBlock ??= false;
    for ( const poly of this.polygons ) {
      const polyIx = poly.intersection(rayOrigin, rayDirection, opts);
      if ( !polyIx ) continue;
      ix ??= polyIx;
      if ( opts.holesBlock ) return ix;
      holeCount += poly.isHole ? -1 : 1;
    }
    return holeCount > 0 ? ix : null;
  }


  /**
   * Is a 3d point that is on the plane within the polygon?
   * Does not check bounding box or if it is in fact on the plane.
   * @param {Point3d} ix
   * @param {boolean} [holesBlock = false]        If false, polygon holes return null
   * @returns {boolean}
   */
  _isIntersectionWithinPolygon(ix, holesBlock = false) {
    // Polygons with holes may have intersections on the solid polygon + the hole.
    // Need more solid than hole to count.
    let holeCount = 0;
    for ( const poly of this.polygons ) {
      if ( !poly.aabb.almostContainsPoint(ix) ) continue;
      const hasIx = poly._isIntersectionWithinPolygon(ix);
      if ( !hasIx ) continue;
      if ( holesBlock ) return true;
      holeCount += poly.isHole ? -1 : 1;
    }
    return holeCount > 0;
  }

  /**
   * Intersect this Polygons3d against a plane, noting holes.
   * @param {Plane} plane
   * @returns {Segment3d[]} May be empty if no intersecting segments.
   */
  intersectPlane(plane) {
    if ( this.plane.isParallelToPlane(plane) ) {
      if ( this.plane.isCoincidentWithPlane(plane, { testParallel: false }) ) return null;
      return []; // No intersection; parallel but not touching.
    }
    const out = this.#applyMethodToAllWithReturn("intersectPlane", plane);
    return out.flatMap(arr => arr);
  }

  /**
   * Intersect this Polygons3d against another, noting holes.
   * @param {Plane} plane
   * @returns {Segment3d[]} May be empty if no intersecting segments.
   */
  intersectPolygon3d(other) {
    if ( this.plane.isParallelToPlane(other.plane) ) {
      if ( this.plane.isCoincidentWithPlane(other.plane, { testParallel: false }) ) return [];
      return []; // No intersection; parallel but not touching.
    }

    if ( other instanceof Polygons3d ) {
      console.warn("Polygons3d|Intersecting two Polygons3d may be resource intensive.");
      const out = [];
      for ( const poly1 of this.polygons ) {
        for ( const poly2 of other.polygons ) out.push(...poly1.intersectPolygon3d(poly2));
      }
      return out;

    } else {
      const out = this.#applyMethodToAllWithReturn("intersectPolygon3d", other);
      return out.flatMap(arr => arr);
    }
  }

  clipPlanePoints(...args) { this.#applyMethodToAllWithReturn("clipPlanePoints", ...args); }

  clipZ(...args) {
    const out = this._cloneEmpty();
    out.polygons = this.#applyMethodToAllWithReturn("clipZ", ...args);
    return out;
  }

  /* ----- NOTE: Debug ----- */

  draw2d(opts = {}) {
    const color = opts.color;
    const fill = opts.fill;
    const draw = opts.draw?.g || canvas.controls.debug;

    // Sort so holes are last.
    this.polygons.sort((a, b) => a.isHole - b.isHole);
    for ( const poly of this.polygons ) {
      if ( poly.isHole ) {
        if ( !opts.holeColor ) draw.beginHole(); // If holeColor, don't treat as hole
        opts.color = opts.holeColor || opts.color;
        opts.fill = opts.holeFill || opts.fill;
      }
      poly.draw2d(opts);
      if ( poly.isHole ) {
        if ( !opts.holeColor ) draw.endHole();
        opts.color = color;
        opts.fill = fill;
      }
    }
  }
}


/*
(a.y - c.y) * (b.x - c.x) -  (a.x - c.x) * (b.y - c.y)
(p.y - r.y) * (q.x - r.x) >= (p.x - r.x) * (q.y - r.y)

orient2dFast(a, b, c) > 0 === (a.y - c.y) * (b.x - c.x) >=  (a.x - c.x) * (b.y - c.y)
orient2dFast(p, q, r) > 0
*/

/**
 * Comparison function used by convex hull function.
 * @param {Point} a
 * @param {Point} b
 * @returns {boolean}
 */
function convexHullCmpFn(a, b) {
  const dx = a.x - b.x;
  return dx ? dx : a.y - b.y;
}

/**
 * Test the point against existing hull points.
 * @parma {PIXI.Point[]} hull
 * @param {PIXI.Point} point
*/
function testHullPoint(hull, p) {
  const orient2d = foundry.utils.orient2dFast;
  while ( hull.length >= 2 ) {
    const q = hull[hull.length - 1];
    const r = hull[hull.length - 2];
    if ( orient2d(p, q, r) >= 0 ) hull.pop();
    else break;
  }
  hull.push(p);
}

function convexHull(points) {
  const ln = points.length;
  if ( ln <= 1 ) return points;

  const newPoints = [...points];
  newPoints.sort(convexHullCmpFn);

  // Andrew's monotone chain algorithm.
  const upperHull = [];
  for ( let i = 0; i < ln; i += 1 ) testHullPoint(upperHull, newPoints[i]);
  upperHull.pop();

  const lowerHull = [];
  for ( let i = ln - 1; i >= 0; i -= 1 ) testHullPoint(lowerHull, newPoints[i]);
  lowerHull.pop();

  if ( upperHull.length === 1
    && lowerHull.length === 1
    && upperHull[0].x === lowerHull[0].x
    && upperHull[0].y === lowerHull[0].y ) return upperHull;

  return upperHull.concat(lowerHull);
}



GEOMETRY_CONFIG.threeD.Polygon3d = Polygon3d;
GEOMETRY_CONFIG.threeD.Ellipse3d = Ellipse3d;
GEOMETRY_CONFIG.threeD.Circle3d = Circle3d;
GEOMETRY_CONFIG.threeD.Triangle3d = Triangle3d;
GEOMETRY_CONFIG.threeD.Quad3d = Quad3d;
GEOMETRY_CONFIG.threeD.Polygons3d = Polygons3d;

// Synonym for Circle3d.
export const Cylinder = GEOMETRY_CONFIG.threeD.Circle3d;
GEOMETRY_CONFIG.threeD.Cylinder = Circle3d;


/* Testing
Draw = CONFIG.GeometryLib.Draw
Polygon3d = game.modules.get("tokenvisibility").api.triangles.Polygon3d
Point3d = CONFIG.GeometryLib.threeD.Point3d

poly = new PIXI.Polygon(
  100, 100,
  100, 500,
  500, 500,
)

poly3d = Polygon3d.fromPolygon(poly, 20)
poly3d.forEach((pt, idx) => console.log(`${idx} ${pt}`))

Polygon3d.convexHull(poly3d.points)
Polygon3d.convexHull2(poly3d.points)

rayOrigin = new Point3d(200, 300, 50)
rayDirection = new Point3d(0, 0, -1)
ix = poly3d.intersection(rayOrigin, rayDirection)

rayDirection = new Point3d(0, 0, 1)
poly3d.intersection(rayOrigin, rayDirection)

poly3d = Polygon3d.from3dPoints([
  new Point3d(0, 100, -100),
  new Point3d(0, 100, 500),
  new Point3d(0, 500, 500)
])

clipped = poly3d.clipZ()
clipped2 = poly3d.clipZ({ keepLessThan: false })

poly3d.draw2d({ omitAxis: "x" })
clipped.draw2d({ omitAxis: "x", color: Draw.COLORS.red })
clipped2.draw2d({ omitAxis: "x", color: Draw.COLORS.blue })


Polygons3d = game.modules.get("tokenvisibility").api.triangles.Polygons3d

poly = new PIXI.Polygon(
  100, 100,
  100, 500,
  500, 500,
)

hole = new PIXI.Polygon(
  150, 200,
  200, 400,
  300, 400,
)
hole.isHole = true;

polys3d = Polygons3d.fromPolygons([poly, hole])
polys3d.draw2d({ color: Draw.COLORS.blue, holeColor: Draw.COLORS.red })
polys3d.draw2d({ color: Draw.COLORS.blue, fill: Draw.COLORS.blue, fillAlpha: 0.5 })

rayOrigin = new Point3d(200, 300, 50)
rayDirection = new Point3d(0, 0, -1)
ix = polys3d.intersection(rayOrigin, rayDirection)

rayOrigin = new Point3d(150, 450, 50)
rayDirection = new Point3d(0, 0, -1)
ix = polys3d.intersection(rayOrigin, rayDirection)


points = [
  new Point3d(0, 0, 0),
  new Point3d(100, 0, 100),
  new Point3d(0, 100, 0),
  new Point3d(50, 50, 50),
  new Point3d(200, 20, 200),
  new Point3d(300, 50, 300),
  new Point3d(300, 300, 300),
  new Point3d(250, 75, 250),
  new Point3d(0, 75, 0),
  new Point3d(50, 250, 50),
  new Point3d(25, 210, 25),
  new Point3d(150, 150, 150),
  new Point3d(150, 200, 150),
]
points.forEach(pt => Draw.point(pt))

ptsC = Polygon3d.convexHull(points)
ptsC2 = Polygon3d.convexHull2(points)

polyC = Polygon3d.from3dPoints(ptsC)
polyC2 = Polygon3d.from3dPoints(ptsC2)
polyC.draw2d({ color: Draw.COLORS.blue })
polyC2.draw2d({ color: Draw.COLORS.green })

b = polyC2.bounds
boundsRect = new PIXI.Rectangle(b.x.min, b.y.min, b.x.max - b.x.min, b.y.max - b.y.min)



*/
