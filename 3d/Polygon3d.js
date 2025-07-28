/* globals
canvas,
ClipperLib,
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_CONFIG } from "../const.js";
import { Point3d } from "./Point3d.js";
import { almostLessThan, almostGreaterThan } from "../util.js";
import { AABB3d } from "../AABB.js";

function isNearCollinear3d(a, b, c) {
  const Point3d = CONFIG.GeometryLib.threeD.Point3d;
  // Collinear if the normal is 0,0,0.
  const vAB = b.subtract(a, Point3d._tmp1);
  const vAC = c.subtract(a, Point3d._tmp2);
  const normal = vAB.cross(vAC, Point3d._tmp3);
  return normal.almostEqual({ x: 0, y: 0, z: 0 });
}

// Temporary points
const pt3d_0 = new Point3d();
const pt3d_1 = new Point3d();
const pt3d_2 = new Point3d();

/*
3d Polygon representing a flat polygon plane.
Can be transformed in 3d space.
Can be clipped at a specific z value.

Points in a Polygon3d are assumed to not be modified in place after creation.
*/
export class Polygon3d {

  // TODO: Cache bounds and plane. Use setter to modify points to reset cache?
  //       Or just only allow points set once?
  //       Could have set points(pts) and set them all at once.
  //       Difficult b/c of transform and scale, along with the fact that each point can be
  //       modified in place.

  /** @type {Point3d} */
  points = [];

  constructor(n = 0) {
    this.points.length = n;
    for ( let i = 0; i < n; i += 1 ) this.points[i] = new Point3d();
  }

  // ----- NOTE: In-place modifiers ----- //

  /**
   * Clear the getter caches.
   */
  clearCache() {
    this.#dirtyAABB = true;
    this.#plane = undefined;
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

    // Drop collinear points.
    const iter = this.iteratePoints({ close: true });
    let a = iter.next().value;
    let b = iter.next().value;
    const newPoints = [a];
    for ( let c of iter ) {
      if ( !isNearCollinear3d(a, b, c) ) newPoints.push(b);
      a = b;
      b = c;
    }
    if ( newPoints.length < this.points.length ) {
      this.points.length = newPoints.length;
      this.points.forEach((pt, idx) => pt.copyFrom(newPoints[idx]));
    }
    this.#cleaned = true;
  }

  /**
   * Sets the z value in place. Clears the cached properties.
   */
  setZ(z = 0) { this.points.forEach(pt => pt.z = z); this.clearCache(); }

  /**
   * Reverse the orientation of this polygon. Done in place.
   */
  reverseOrientation() {
    this.points.reverse();
    const { a, c } = this.plane.threePoints;
    this.plane._threePoints.c = a;
    this.plane._threePoints.a = c;
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
      this.calculateAABB(this.#aabb);
      this.#dirtyAABB = false;
    }
    return this.#aabb;
  }

  _calculateAABB(aabb) { aabb.constructor.fromPolygon3d(this.points, aabb); }

  // ----- NOTE: Plane ----- //

  /** @type {Plane} */
  #plane;

  get plane() {
    if ( !this.#plane ) {
      // Assumes without testing that points are not collinear.
      const Plane = CONFIG.GeometryLib.threeD.Plane;
      this.#plane = Plane.fromPoints(this.points[0], this.points[1], this.points[2]);
    }
    return this.#plane;
  }

  /** @type {PIXI.Point[]} */
  #planarPoints = [];

  // Points on the 2d plane in the plane's coordinate system.
  get planarPoints() {
    if ( !this.#planarPoints.length ) {
      const nPoints = this.points.length;
      this.#planarPoints.length === nPoints;
      const to2dM = this.plane.conversion2dMatrix;
      for ( let i = 0; i < nPoints; i += 1 ) {
        this.#planarPoints[i] = to2dM.multiplyPoint3d(this.points[i]).to2d();
      }
    }
    return this.#planarPoints;
  }

  // ----- NOTE: Centroid ----- //

  /** @type {Point3d} */
  #centroid = new Point3d();

  #dirtyCentroid = true;

  /**
   * Centroid (center point) of this polygon.
   * @type {Point3d}
   */
  get centroid() {
    if ( this.#dirtyCentroid ) {
      const Point3d = CONFIG.GeometryLib.threeD.Point3d;
      const plane = this.plane;

      // Convert to 2d polygon and calculate centroid.
      const M2d = plane.conversion2dMatrix;
      const poly2d = new PIXI.Polygon(this.points.map(pt3d => M2d.multiplyPoint3d(pt3d).to2d()));
      const ctr = poly2d.center;
      this.#centroid = plane.conversion2dMatrixInverse.multiplyPoint3d(Point3d._tmp.set(ctr.x, ctr.y, 0));
      this.#dirtyCentroid = false;
    }
    return this.#centroid;
  }

  /**
   * @param {Points3d} points
   * @returns {Points3d}
   */
  static convexHull(points) {
    // Assuming flat points, determine plane and then convert to 2d
    const Plane = CONFIG.GeometryLib.threeD.Plane;
    const plane = Plane.fromPoints(points[0], points[1], points[2]);
    const M2d = plane.conversion2dMatrix;
    const points2d = points.map(pt3d => M2d.multiplyPoint3d(pt3d));
    const convex2dPoints = convexHull(points2d);
    return convex2dPoints.map(pt => plane.conversion2dMatrixInverse.multiplyPoint3d(pt))
  }

  // ----- NOTE: Factory methods ----- //

  static fromPoints(pts, out) {
    const n = pts.length;
    if ( out ) out.points.length = n;
    else out = new this(n);
    for ( let i = 0; i < n; i += 1 ) {
      const outPt = out.points[i] ??= new CONFIG.GeometryLib.threeD.Point3d();
      outPt.copyPartial(pts[i]);
    }
    return out;
  }

  static from2dPoints(pts, elevation = 0, out) {
    const n = pts.length;
    if ( out ) out.points.length = n;
    else out = new this(n);
    for ( let i = 0; i < n; i += 1 ) {
      const outPt = out.points[i] ??= new CONFIG.GeometryLib.threeD.Point3d()
      const { x, y } = pts[i];
      outPt.set(x, y, elevation);
    }
    return out;
  }

  static from3dPoints(pts, out) {
    const n = pts.length;
    if ( out ) out.points.length = n;
    else out = new this(n);
    for ( let i = 0; i < n; i += 1 ) {
      const outPt = out.points[i] ??= new CONFIG.GeometryLib.threeD.Point3d()
      outPt.copyFrom(pts[i]);
    }
    return out;
  }

  static fromPolygon(poly, elevation = 0, out) {
    const n = poly.points.length * 0.5;
    if ( out ) out.points.length = n;
    else out = new this(n);
    if ( poly.isHole ) out.isHole = true;
    poly.iteratePoints({ close: false }).forEach((pt, idx) => {
      const outPt = out.points[idx] ??= new CONFIG.GeometryLib.threeD.Point3d()
      outPt.set(pt.x, pt.y, elevation)
    });
    return out;
  }

  static fromClipperPaths(cpObj, elevation = 0, out) {
    return cpObj.toPolygons().map(poly => this.fromPolygon(poly, elevation, out));
  }

  /**
   * Create a polygon from given indices and vertices
   * @param {Number[]} vertices     Array of vertices, 3 coordinates per vertex
   * @param {Number[]} [indices]    Indices to determine order in which polygon points are created from vertices
   * @returns {Triangle[]}
   */
  static fromVertices(vertices, indices, stride = 3, out) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const n = indices.length;
    if ( vertices.length % stride !== 0 ) console.error(`${this.name}.fromVertices|Length of vertices is not divisible by stride ${stride}: ${vertices.length}`);
    indices ??= Array.fromRange(Math.floor(vertices.length / 3));
    if ( n % 3 !== 0 ) console.error(`${this.name}.fromVertices|Length of indices is not divisible by 3: ${indices.length}`);
    if ( out ) out.points.length = n;
    else out = new this(n);
    for ( let i = 0, j = 0, jMax = n; j < jMax; j += 1 ) {
      const outPt = out.points[j] ??= new CONFIG.GeometryLib.threeD.Point3d()
      outPt.copyFrom(pointFromVertices(i++, vertices, indices, stride, Point3d._tmp1));
    }
    return out;
  }

  /**
   * Make a copy of this polygon.
   * @returns {Polygon3d} A new polygon
   */
  clone(out) {
    out ??= new this.constructor(this.points.length);
    out.isHole = this.isHole;
    this.points.forEach((pt, idx) => out.points[idx].copyFrom(pt));
    return out;
  }

  _cloneEmpty() {
    const out = new this.constructor(0);
    out.isHole = this.isHole;
    return out;
  }

  // ----- NOTE: Conversions to ----- //

  /**
   * @param {"x"|"y"|"z"} omitAxis    Which of the three axes to omit to drop this to 2d.
   * @param {object} [opts]
   * @param {number} [opts.scalingFactor]   How to scale the clipper points
   * @returns {ClipperPaths}
   */
  toClipperPaths({ omitAxis = "z", scalingFactor = 1 } = {}) {
    const ClipperPaths = CONFIG.GeometryLib.ClipperPaths; // TODO: Move to Clipper2?

    let points;
    if ( ClipperPaths === CONFIG.GeometryLib.Clipper2Paths ) {
      const Point64 = CONFIG.GeometryLib.Clipper2Paths.Clipper2.Point64;
      switch ( omitAxis ) {
        case "x": points = this.points.map(pt => new Point64(pt.to2d({x: "y", y: "z"}), scalingFactor)); break;
        case "y": points = this.points.map(pt => new Point64(pt.to2d({x: "x", y: "z"}), scalingFactor)); break;
        case "z": points = this.points.map(pt => new Point64(pt.to2d({x: "x", y: "y"}), scalingFactor)); break;
      }
    } else {
      const IntPoint = ClipperLib.IntPoint;
      switch ( omitAxis ) {
        case "x": points = this.points.map(pt => new IntPoint(pt.y * scalingFactor, pt.z * scalingFactor)); break;
        case "y": points = this.points.map(pt => new IntPoint(pt.x * scalingFactor, pt.z * scalingFactor)); break;
        case "z": points = this.points.map(pt => new IntPoint(pt.x * scalingFactor, pt.y * scalingFactor)); break;
      }
    }
    const out = new CONFIG.GeometryLib.ClipperPaths([points], { scalingFactor }); // TODO: Move to Clipper2?
    return out;
  }

  /**
   * Convert to 2d polygon, dropping z.
   * @returns {PIXI.Polygon}
   */
  toPolygon2d({ omitAxis = "z" } = {}) {
    if ( omitAxis === "z" ) return new PIXI.Polygon(this.points); // PIXI.Polygon ignores "z" attribute.

    const [x, y] = omitAxis === "x" ? ["y", "z"] : ["x", "z"];
    return new PIXI.Polygon(this.points.map(pt3d => { return { x: pt3d[x], y: pt3d[y] } }));
    /*
    const n = this.points.length;
    const points = Array(n * 2);

    for ( let i = 0; i < n; i += 1 ) {
      const pt = this.points[i];
      points[i * 2] = pt[x];
      points[i * 2 + 1] = pt[y];
    }
    return new PIXI.Polygon(points);
    */
  }

  /**
   * Convert to 2d polygon by perspective transform, dividing each point by z.
   * @returns {PIXI.Polygon}
   */
  toPerspectivePolygon() {
    return new PIXI.Polygon(this.points.flatMap(pt => {
      const invZ = 1 / pt.z;
      return [pt.x * invZ, pt.y * invZ];
    }));
  }

  toPlanarPolygon() {
    return new PIXI.Polygon(this.planarPoints);
  }

  static fromPlanarPolygon(poly2d, plane) {
    const invM2d = plane.conversion2dMatrixInverse;
    const ln = poly2d.points.length;
    const pts3d = new Array(Math.floor(ln / 2));
    for ( let i = 0, j = 0; i < ln; i += 2, j += 1 ) {
      const x = poly2d.points[i];
      const y = poly2d.points[i + 1];
      const pt3d = invM2d.multiplyPoint3d(CONFIG.GeometryLib.threeD.Point3d._tmp.set(x, y, 0));
      pts3d[j] = pt3d;
    }
    return this.from3dPoints(pts3d);
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
    const to2dM = this.plane.conversion2dMatrix;
    const points2d = this.points.map(pt => to2dM.multiplyPoint3d(pt));
    const poly = new PIXI.Polygon(points2d); // PIXI.Polygon ignores z values.
    const tris2d = poly.triangulate(opts);

    // Convert back to 3d.
    const from2dM = this.plane.conversion2dMatrixInverse;
    return tris2d.map(tri2d => {
      const pts = tri2d.points;
      pt3d_0.set(pts[0], pts[1], 0);
      pt3d_1.set(pts[2], pts[3], 0);
      pt3d_2.set(pts[4], pts[5], 0);
      from2dM.multiplyPoint3d(pt3d_0, pt3d_0);
      from2dM.multiplyPoint3d(pt3d_1, pt3d_1);
      from2dM.multiplyPoint3d(pt3d_2, pt3d_2);
      return Triangle3d.from3Points(pt3d_0, pt3d_1, pt3d_2);
    });
  }

  /**
   * Build a set of vertical Quad3ds representing sides of a polygon shape.
   * Built facing outwards from the polygon, with polygon on top.
   * @param {number} elevZ        Fixed elevation to use for the sides
   * @param {number} heightZ      Relative elevation to the top; subtracted from topZ
   */
  buildTopSides(bottomZ, heightZ = 0) {
    let numSides = 0;
    switch ( this.constructor.name ) {
      case "Circle3d": numSides = PIXI.Circle.approximateVertexDensity(this.radius); break;
      case "Ellipse3d": numSides = PIXI.Circle.approximateVertexDensity(Math.max(this.radiusX, this.radiusY)); break;
      default: numSides = this.points.length;
    }
    const sides = new Array(numSides);
    let i = 0;
    for ( const edge of this.iterateEdges({ close: true }) ) {
      const { A, B } = edge;
      const z0 = bottomZ ?? A.z - heightZ;
      const z1 = bottomZ ?? B.z - heightZ;
      const side = Quad3d.from4Points(edge.B, edge.A, pt3d_0.set(A.x, A.y, z0), pt3d_1.set(B.x, B.y, z1));
      sides[i++] = side;
    }
    return sides;
  }

  // ----- NOTE: Iterators ----- //

  /**
   * Iterate over the polygon's edges in order.
   * If the polygon is closed, the last two points will be ignored.
   * (Use close = true to return the last --> first edge.)
   * @param {object} [options]
   * @param {boolean} [close]   If true, return last point --> first point as edge.
   * @returns { A: Point3d, B: Point3d } for each edge
   * Edges link, such that edge0.B === edge.1.A.
   */
  *iterateEdges({close = true} = {}) {
    const n = this.points.length;
    if ( n < 2 ) return;

    const firstA = this.points[0];
    let A = firstA;
    for ( let i = 1; i < n; i += 1 ) {
      const B = this.points[i];
      yield { A, B };
      A = B;
    }

    if ( close ) {
      const B = firstA;
      yield { A, B };
    }
  }

  /**
   * Iterate over the polygon's {x, y} points in order.
   * @param {object} [options]
   * @param {boolean} [options.close]   If close, include the first point again.
   * @returns {Point3d}
   */
  *iteratePoints({ close = true } = {}) {
    const n = this.points.length;
    for ( let i = 0; i < n; i += 1 ) yield this.points[i];
    if ( close ) yield this.points[0];
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
   * Defined as counter-clockwise.
   * @param {Point3d} p
   * @returns {boolean}
   */
  isFacing(p) { return this.plane.whichSide(p) > 0; }

  // ----- NOTE: Transformations ----- //

  // Valid if it forms a polygon, not a line or a point (or null).
  isValid() {
    this.clean();
    return this.points.length > 2;
  }

  /**
   * Transform the points using a transformation matrix.
   * @param {Matrix} M
   * @param {Polygon3d} [poly]    The triangle to modify
   * @returns {Polygon3d} The modified tri.
   */
  transform(M, poly3d) {
    poly3d ??= this.clone();
    poly3d.points.forEach((pt, idx) => M.multiplyPoint3d(this.points[idx], pt));
    return poly3d;
  }

  multiplyScalar(multiplier, poly3d) {
    poly3d ??= this.clone();
    poly3d.points.forEach(pt => pt.multiplyScalar(multiplier, pt));
    return poly3d;
  }

  scale({ x = 1, y = 1, z = 1} = {}, poly3d) {
    poly3d ??= this.clone();
    const scalePt = CONFIG.GeometryLib.threeD.Point3d._tmp1.set(x, y, z);
    poly3d.points.forEach(pt => pt.multiply(scalePt, pt));
    return poly3d;
  }

  divideByZ(poly3d) {
    poly3d ??= this.clone();
    poly3d.points.forEach(pt => {
      const zInv = 1 / pt.z;
      pt.x *= zInv;
      pt.y *= zInv;
      pt.z = 1;
    });
    return poly3d;
  }

  // ----- NOTE: Intersection ----- //

  /**
   * Test if a ray intersects the polygon's plane. Does not consider whether this polygon is facing.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @returns {number|null} The t value of the plane intersection.
   *  Does not test if the intersection is within bounds of the polygon.
   *  For polygons, use intersection to test bounds.
   */
  intersectionT(rayOrigin, rayDirection) {
    return this.plane.rayIntersection(rayOrigin, rayDirection);
  }

  /**
   * Test if a ray intersects the polygon. Does not consider whether this polygon is facing.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @returns {Point3d|null}
   */
  intersection(rayOrigin, rayDirection, minT = 0, maxT = Number.POSITIVE_INFINITY) {
    // First get the plane intersection.
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const plane = this.plane;
    const t = plane.rayIntersection(rayOrigin, rayDirection);
    if ( t === null || !t.almostBetween(minT, maxT) ) return null;
    if ( t.almostEqual(0) ) return rayOrigin;

    const ix = new Point3d();
    rayOrigin.add(rayDirection.multiplyScalar(t, ix), ix)

    // If the plane is not vertical, can do a simple projection onto the x/y plane as a 2d polygon.
    if ( plane.normal.z ) {
      const poly2d = this.toPolygon2d();
      return poly2d.contains(ix.x, ix.y) ? ix : null;
    }

    // Otherwise, test 3d bounds by full conversion.
    const { min, max } = this.aabb;
    if ( !almostLessThan(ix.x, max.x)
      || !almostGreaterThan(ix.x, min.x)
      || !almostLessThan(ix.y, max.y)
      || !almostGreaterThan(ix.y, min.y)
      || !almostLessThan(ix.z, max.z)
      || !almostGreaterThan(ix.z, min.z) ) return null;

    // Then convert to 2d polygon and test if contained.
    const M2d = plane.conversion2dMatrix;
    const poly2d = new PIXI.Polygon(this.points.map(pt3d => M2d.multiplyPoint3d(pt3d).to2d()));
    const ix2d = M2d.multiplyPoint3d(ix).to2d();
    return poly2d.contains(ix2d.x, ix2d.y) ? ix : null;
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
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
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
      const { A, B } = edge;
      if ( cmp(A) ) toKeep.push(A.clone());
      if ( cmp(A) ^ cmp(B) ) {
        const newPt = new Point3d();
        const res = A.projectToAxisValue(B, cutoff, coordinate, newPt);
        if ( res && !(newPt.almostEqual(A) || newPt.almostEqual(B)) ) toKeep.push(newPt);
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
   * Intersect this Polygon3d against a plane.
   * @param {Plane} plane
   * @returns {null|Point3d[]|Segment3d[]}
   */
  intersectPlane(plane) {
    const res = this.plane.intersectPlane(plane);
    if ( !res ) return null;

    // Convert the intersecting ray to 2d values on this plane.
    const to2dM = this.plane.conversion2dMatrix
    const b3d = res.point.add(res.direction);
    const a = to2dM.multiplyPoint3d(res.point).to2d();
    const b = to2dM.multiplyPoint3d(b3d).to2d();

    // Find the portion of the ray that is inside this polygon.
    // Cannot assume convex polygon, so may be multiple segments or points.
    /*
    api = game.modules.get("tokenvisibility").api
    Polygon3d = api.geometry.Polygon3d
    let { Point3d, Plane } = CONFIG.GeometryLib.threeD
    Draw = CONFIG.GeometryLib.Draw
    poly3d = Polygon3d.from2dPoints([{ x: -50, y: -50 }, { x: -50, y: 50 }, { x: 50, y: 50 }, { x: 50, y: -50 }], 100)
    plane = Plane.fromPoints(new Point3d(-25, -50, 100), new Point3d(-50, -25, 100), new Point3d(-25, -50, 0))
    poly3d.draw2d()
    Draw.segment({ a: plane.threePoints.a, b: plane.threePoints.b })
    Draw.point(res.point, { radius: 2 })
    Draw.point(b3d, { radius: 2 })
    */

    const poly2d = new PIXI.Polygon(this.planarPoints);
    const ixs = poly2d.lineIntersections(a, b);
    ixs.sort((a, b) => a.t0 - b.t0);
    const from2dM = this.plane.conversion2dMatrixInverse;
    const pts3d = ixs.map(ix => from2dM.multiplyPoint3d(CONFIG.GeometryLib.threeD.Point3d._tmp.set(ix.x, ix.y, 0)));
    if ( pts3d.length === 1 ) return ixs[0];
    const segments = [];
    let currSegment = { a: null, b: null };
    pts3d.forEach(ix => {
      if ( !currSegment.a ) { currSegment.a = ix; return; }
      currSegment.b = ix;
      segments.push(currSegment);
      currSegment = { a: null, b: null };
    });
    return segments;
  }


  /* ----- NOTE: Debug ----- */

  draw2d({ draw, omitAxis = "z", ...opts } = {}) {
    draw ??= new CONFIG.GeometryLib.Draw;
    draw.shape(this.toPolygon2d({ omitAxis }), opts);
  }
}

function pointFromVertices(i, vertices, indices, stride = 3, outPoint) {
  outPoint ??= new CONFIG.GeometryLib.threeD.Point3d;
  const idx = indices[i];
  const v = vertices.slice(idx * stride, (idx * stride) + 3);
  outPoint.set(v[0], v[1], v[2]);
  return outPoint;
}

/**
 * Planar ellipse shape.
 */
export class Ellipse3d extends Polygon3d {

  /** @type {Point3d} */
  get center() { return this.points[0]; }

  /** @type {number} */
  #radiusX = 0;

  get radiusX() { return this.#radiusX; }

  set radiusX(value) { this.#radiusX = value; }

  #radiusY = 0;

  get radiusY() { return this.#radiusY; }

  set radiusY(value) { this.#radiusY = value; }

  constructor() {
    super(3); // 3 points to define the plane. The first is the center.
  }

  // ----- NOTE: In-place modifiers ----- //

  setDimensions(center, radiusX, radiusY, b, c) {
    this.points[0].copyFrom(center);
    this.radiusX = radiusX;
    this.radiusY = radiusY;

    if ( b && c ) {
      // Use the provided points to set up the circle plane.
      this.points[1].set(b);
      this.points[2].set(c);
    } else {
      // Add 2 points to form a flat plane. May be later modified by a constructor.
      this.points[1].set(center.x + radiusX, center.y, center.z);
      this.points[2].set(center.x, center.y + radiusY, center.z);
    }
    this.clearCache();
    return this;
  }

  clean() { return; }

  setZ(z = 0) { this.center.z = z; super.setZ(z); }

  reverseOrientation() {
    // Don't touch the center point.
    const tmp = this.points[1];
    this.points.copyWithin(1, 2)
    this.points[2] = tmp;

    const { b, c } = this.plane.threePoints;
    this.plane._threePoints.c = b;
    this.plane._threePoints.b = c;
  }

  // ----- NOTE: Plane ----- //

  get ellipse() { return new PIXI.Ellipse(this.center.x, this.center.y, this.radiusX, this.radiusY); }

  // ----- NOTE: Centroid ----- //

  get centroid() { return this.points[0]; }

  // ----- NOTE: Factory methods ----- //

  static fromEllipse(ellipse, elevationZ = 0, out) {
    return this.fromCenterPoint(pt3d_0.set(ellipse.x, ellipse.y, elevationZ), ellipse.width, ellipse.height, out);
  }

  static fromCenterPoint(center, radiusX, radiusY, out) {
    out ??= new this();
    return out.setDimensions(center, radiusX, radiusY);
  }

  static fromPoints(_pts, _radiusX, _radiusY, _out) {
    console.error("fromPlane|Not yet implemented.");
  }

  static from2dPoints(_pts, _radiusX, _radiusY, _elevation = 0, _out) {
    console.error("fromPlane|Not yet implemented.");
  }

  static from3dPoints(pts, radiusX, radiusY, out) {
    out ??= new this();
    return out.setDimensions(pts[0], radiusX, radiusY, pts[1], pts[2]);
  }

  static fromPlane(center, radiusX, radiusY, plane, out) {
    const pts = plane.threePoints;

    // Add two additional points to form the plane.
    let b;
    let c;
    for ( const pt of pts ) {
      if ( center.almostEqual(pt) ) continue;
      if ( !b ) b = pt;
      else if ( !c ) c = pt;
      else break;
    }
    out ??= new this();
    return out.setDimensions(center, radiusX, radiusY, b, c);
  }

  static fromPolygon(...args) { return Polygon3d.fromPolygon(...args); }

  static fromClipperPaths(...args) { return Polygon3d.fromClipperPaths(...args);  }

  static fromVertices(...args) { return Polygon3d.fromVertices(...args); }

  static fromPlanarEllipse(ellipse2d, plane, out) {
    const invM2d = plane.conversion2dMatrixInverse;
    const center3d = invM2d.multiplyPoint3d(CONFIG.GeometryLib.threeD.Point3d._tmp.set(ellipse2d.center.x, ellipse2d.center.y, 0));
    out ??= new this();
    return out.setDimensions(center3d, ellipse2d.radiusX, ellipse2d.radiusY);
  }

  clone(out) {
    out ??= super.clone();
    out.radiusX = this.radiusX; // Rest is already set via points.
    out.radiusY = this.radiusY;
    return out;
  }

  // ----- NOTE: Conversions to ----- //

  toPlanarEllipse() {
    const to2dM = this.plane.conversion2dMatrix;
    const center = to2dM.multiplyPoint3d(this.center);
    return new PIXI.Elllipse(center.x, center.y, this.radiusX, this.radiusY);
  }


  // opts: { density, includeEndpoints = true }
  toPolygon3d(opts ) {
    const poly2d = this.toPlanarPolygon(opts);
    return this.constructor.fromPlanarPolygon(poly2d, this.plane);
  }

  /**
   * @param {"x"|"y"|"z"} omitAxis    Which of the three axes to omit to drop this to 2d.
   * @param {object} [opts]
   * @param {number} [opts.scalingFactor]   How to scale the clipper points
   * @returns {ClipperPaths}
   */
  toClipperPaths(opts) { return this.toPolygon3d(opts).toClipperPaths(opts); }

  /**
   * Convert to 2d polygon, dropping z.
   * @returns {PIXI.Polygon}
   */
  toPolygon2d(opts) {  return this.toPolygon3d(opts).toPolygon2d(opts); }

  /**
   * Convert to 2d polygon by perspective transform, dividing each point by z.
   * @returns {PIXI.Polygon}
   */
  toPerspectivePolygon(opts) { return this.toPolygon3d(opts).toPerspectivePolygon(); }

  toPlanarPolygon(opts) {
    const ellipse = this.toPlanarEllipse();
    return ellipse.toPolygon(opts);
  }

  toVertices(opts) { return this.toPolygon3d(opts).toVertices(opts); }

  triangulate(opts) {
    opts.useFan ??= true;
    return this.toPolygon3d(opts).triangulate(opts);
  }

  // ----- NOTE: Iterators ----- //

  *iterateEdges(opts) {
    for ( const edge of this.toPolygon3d().iterateEdges(opts) ) yield edge;
  }

  *iteratePoints(opts) {
    for ( const pt of this.toPolygon3d().iteratePoints(opts) ) yield pt;
  }
}

/**
 * Planar circle. Not to be confused with a sphere! This is a slice of a sphere in a plane.
 */
export class Circle3d extends Ellipse3d {

  /** @type {number} */
  #radius = 0;

  /** @type {number} */
  #radiusSquared = 0;

  get radius() { return this.#radius; }

  get radiusSquared() { return this.#radiusSquared; }

  set radius(value) {
    this.#radius = value;
    this.#radiusSquared = value ** 2;
  }

  set radiusSquared(value) {
    this.#radiusSquared = value;
    this.#radius = Math.sqrt(value);
  }

  get radiusX() { return this.#radius; }

  get radiusY() { return this.#radius; }

  set radiusX(value) { this.radius = value; }

  set radiusY(value) { this.radius = value; }

  setDimensions(center, radius, b, c) { return super.setDimensions(center, radius, radius, b, c); }

  // ----- NOTE: Plane ----- //

  get circle() { return new PIXI.Circle(this.center.x, this.center.y, this.radius); }

  // ----- NOTE: Factory methods ----- //

  static fromCircle(cir, elevationZ = 0, out) {
    return this.fromCenterPoint(pt3d_0.set(cir.x, cir.y, elevationZ), cir.radius, out);
  }

  static fromCenterPoint(center, radius, out) {
    out ??= new this();
    return out.setDimensions(center, radius, radius);
  }

  static fromPlanarCircle(circle2d, plane, out) {
    const invM2d = plane.conversion2dMatrixInverse;
    const center3d = invM2d.multiplyPoint3d(CONFIG.GeometryLib.threeD.Point3d._tmp.set(circle2d.center.x, circle2d.center.y, 0));
    out ??= new this();
    return out.setDimensions(center3d, circle2d.radius);
  }

  // ----- NOTE: Conversions to ----- //

  toPlanarCircle() {
    const to2dM = this.plane.conversion2dMatrix;
    const center = to2dM.multiplyPoint3d(this.center);
    return new PIXI.Circle(center.x, center.y, this.radius);
  }

  toPlanarPolygon(opts) {
    const cir = this.toPlanarCircle();
    return cir.toPolygon(opts);
  }
}


/**
 * Planar triangle shape.
 */
export class Triangle3d extends Polygon3d {

  constructor() {
    super(3);
  }

  /** @type {Point3d} */
  get a() { return this.points[0]; }

  /** @type {Point3d} */
  get b() { return this.points[1]; }

  /** @type {Point3d} */
  get c() { return this.points[2]; }

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
  static fromVertices(vertices, indices, stride = 3) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    if ( vertices.length % stride !== 0 ) console.error(`${this.name}.fromVertices|Length of vertices is not divisible by stride ${stride}: ${vertices.length}`);
    indices ??= Array.fromRange(Math.floor(vertices.length / 3));
    if ( indices.length % 3 !== 0 ) console.error(`${this.name}.fromVertices|Length of indices is not divisible by 3: ${indices.length}`);
    const tris = new Array(Math.floor(indices.length / 3));
    for ( let i = 0, j = 0, jMax = tris.length; j < jMax; j += 1 ) {
      const a = pointFromVertices(i++, vertices, indices, stride, Point3d._tmp1);
      const b = pointFromVertices(i++, vertices, indices, stride, Point3d._tmp2);
      const c = pointFromVertices(i++, vertices, indices, stride, Point3d._tmp3);
      tris[j] = this.from3Points(a, b, c);
    }
    return tris;
  }


  /**
   * Create an array of triangles from given array of point 3ds and indices.
   * @param {Number[]} points       Point3ds
   * @param {Number[]} [indices]    Indices to determine order in which triangles are created from vertices
   */
  static fromPoint3d(points, indices) {
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
   * Triangulate and convert to vertices.
   * @param {object} [opts]
   * @param {boolean} [opts.addNormal]        If true, add the normal to this polygon, facing CCW.
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
      outArr.set([...this.a, ...normal, ...this.b, ...normal, ...this.c, ...normal]);
    } else outArr.set([...this.a, ...this.b, ...this.c], outIdx);
    return outArr;
  }

  // Trivially, a Triangle3d is already triangulated.
  triangulate() { return this; }

  static NUM_POSITION_COORDS = 3;

  static NUM_NORMAL_COORDS = 3;

  static NUM_POINTS = 3;

  /**
   * Convert an array of triangles to a single Float32 array of vertices
   * @param {object} [opts]
   * @param {boolean} [opts.useNormal=false]      Add triangle normal to each vertex?
   * @param {Float32Array[]} [opts.outArr]        Array large enough to hold the triangles
   * @param {number} [opts.outIdx=0]              Copy triangle vertices to array starting here
   */
  static trianglesToVertices(tris, { addNormals = false, outArr, outIdx = 0 } = {}) {
    const { NUM_POSITION_COORDS, NUM_NORMAL_COORDS, NUM_POINTS } = this;
    const stride = NUM_POSITION_COORDS + (addNormals * NUM_NORMAL_COORDS);
    outArr ??= new Float32Array(stride * NUM_POINTS * tris.length);
    const opts = { addNormals, outArr, outIdx };
    tris.forEach((tri, idx) => {
      opts.outIdx += idx * stride * NUM_POINTS;
      tri.toVertices(opts);
    });
    return outArr;
  }

  // ----- NOTE: Intersection ----- //



  /**
   * Test if a ray intersects the triangle. Does not consider whether this triangle is facing.
   * Möller-Trumbore intersection algorithm for a triangle.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @returns {t|null} Returns null if not within the triangle
   */
  intersectionT(rayOrigin, rayDirection) {
    return CONFIG.GeometryLib.threeD.Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, this.a, this.b, this.c);
  }

  intersection(rayOrigin, rayDirection, minT = 0, maxT = Number.POSITIVE_INFINITY) {
    const t = this.intersectionT(rayOrigin, rayDirection);
    if ( t === null || !t.almostBetween(minT, maxT) ) return null;
    if ( t.almostEqual(0) ) return rayOrigin;
    const ix = new CONFIG.GeometryLib.threeD.Point3d();
    return rayOrigin.add(rayDirection.multiplyScalar(t, ix), ix);
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
    const out = nPoints === 3 ? (new this.constructor()) : (new Polygon3d(nPoints));
    out.isHole = this.isHole;
    out.points.forEach((pt, idx) => pt.copyFrom(toKeep[idx]));
    return out;
  }

  /**
   * Intersect this Triangle3d against a plane.
   * @param {Plane} plane
   * @returns {null|Point3d|Segment3d}
   */
  intersectPlane(plane) {
    // Check for parallel planes.
    if ( this.plane.isParallelToPlane(plane) ) return null;

    // Instead of intersecting the planes, intersect the triangle segments with the plane directly.
    const ixAB = plane.lineSegmentIntersection(this.a, this.b);
    const ixBC = plane.lineSegmentIntersection(this.b, this.c);
    const ixCA = plane.lineSegmentIntersection(this.c, this.a);
    if ( ixAB && ixBC && ixCA ) console.error(`${this.constructor.name}|intersectPlane|Has three intersections with non-parallel plane.`, plane);
    if ( !(ixAB || ixBC || ixCA) ) return null; // Triangle does not touch plane.

    // Most of the time, a triangle that touches a plane should create a 3d segment on that plane.
    if ( ixAB && ixBC ) return { a: ixAB, b: ixBC };
    if ( ixAB && ixCA ) return { a: ixCA, b: ixAB };
    if ( ixBC && ixCA ) return { a: ixBC, b: ixCA };

    // No segment intersects but perhaps a point touches the plane.
    if ( ixAB ) return { a: ixAB, b: null };
    if ( ixBC ) return { a: ixBC, b: null };
    if ( ixCA ) return { a: ixCA, b: null };

    console.error(`${this.constructor.name}|intersectPlane|Reached end of tests.`, plane);
    return null; // Should not happen.

    /*
    api = game.modules.get("tokenvisibility").api
    Triangle3d = api.geometry.Triangle3d
    let { Point3d, Plane } = CONFIG.GeometryLib.threeD
    Draw = CONFIG.GeometryLib.Draw
    tri3d = Triangle3d.from2dPoints([{ x: -50, y: -50 }, { x: -50, y: 50 }, { x: 50, y: 50 }], 100)
    plane = Plane.fromPoints(new Point3d(-25, -50, 100), new Point3d(-50, -25, 100), new Point3d(-25, -50, 0))
    tri3d.draw2d()
    Draw.point(ixAB, { radius: 2 })
    Draw.point(ixBC, { radius: 2 })
    Draw.point(ixCA, { radius: 2 })
    */
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
    out.c.copyPartial(d);
    return out;
  }

  static fromRectangle(rect, elevZ = 0, out) {
    out ??= new this();
    out.points[0].set(rect.left, rect.top, elevZ);
    out.points[1].set(rect.left, rect.bottom, elevZ);
    out.points[2].set(rect.right, rect.bottom, elevZ);
    out.points[3].set(rect.right, rect.top, elevZ);
    return out;
  }

  triangulate() {
    return [
      Triangle3d.from3Points(this.a, this.b, this.c),
      Triangle3d.from3Points(this.a, this.c, this.d),
    ];
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
    return CONFIG.GeometryLib.threeD.Plane.rayIntersectionQuad3dLD(rayOrigin, rayDirection, this.a, this.b, this.c, this.d);
  }

  intersection(rayOrigin, rayDirection, minT = 0, maxT = Number.POSITIVE_INFINITY) {
    const t = this.intersectionT(rayOrigin, rayDirection);
    if ( t === null || !t.almostBetween(minT, maxT) ) return null;
    if ( t.almostEqual(0) ) return rayOrigin;
    const ix = new CONFIG.GeometryLib.threeD.Point3d();
    return rayOrigin.add(rayDirection.multiplyScalar(t, ix), ix);
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
    const out = nPoints === 4 ? (new this.constructor()) : (new Polygon3d(nPoints));
    out.isHole = this.isHole;
    out.points.forEach((pt, idx) => pt.copyFrom(toKeep[idx]));
    return out;
  }

  /**
   * Intersect this quad against a plane.
   * @param {Plane} plane
   * @returns {null|Point3d|Segment3d}
   */
  intersectPlane(plane) {
    // Check for parallel planes.
    if ( this.plane.isParallelToPlane(plane) ) return null;

    // Instead of intersecting the planes, intersect the quad segments with the plane directly.
    const ixAB = plane.lineSegmentIntersection(this.a, this.b);
    const ixBC = plane.lineSegmentIntersection(this.b, this.c);
    const ixCD = plane.lineSegmentIntersection(this.c, this.d);
    const ixDA = plane.lineSegmentIntersection(this.d, this.a);
    if ( ixAB && ixBC && ixCD && ixDA ) console.error(`${this.constructor.name}|intersectPlane|Has four intersections with non-parallel plane.`, plane);
    if ( !(ixAB || ixBC || ixCD || ixDA) ) return null; // quad does not touch plane.

    // Most of the time, a quad that touches a plane should create a 3d segment on that plane.
    for ( const a of [ixAB, ixBC, ixCD, ixDA] ) {
      for ( const b of [ixAB, ixBC, ixCD, ixDA] ) {
        if ( a === b ) continue;
        if ( a && b ) return { a, b };
      }
    }

    // No segment intersects but perhaps a point touches the plane.
    if ( ixAB ) return { a: ixAB, b: null };
    if ( ixBC ) return { a: ixBC, b: null };
    if ( ixCD ) return { a: ixCD, b: null };
    if ( ixDA ) return { a: ixDA, b: null };

    console.error(`${this.constructor.name}|intersectPlane|Reached end of tests.`, plane);
    return null; // Should not happen.
  }

  isValid() {
    this.clean();
    return this.points.length === 4;
  }

}

/**
 * Represent 1+ polygons that represent a shape.
 * Each can be a Polygon3d that is either a hole or outer (not hole). See Clipper Paths.
 * An outer polygon may be contained within a hole. Parent-child structure not maintained.
 */
export class Polygons3d extends Polygon3d {
  /** @type {Polygon3d[]} */
  polygons = [];

  // TODO: Determine the convex hull of the polygons to determine the points of this polygon?
  constructor(n = 0) {
    super(0);
    this.polygons.length = n;
  }

  #applyMethodToAll(method, ...args) { this.polygons.forEach(poly => poly[method](...args)); }

  #applyMethodToAllWithReturn(method, ...args) { return this.polygons.map(poly => poly[method](...args)); }

  #applyMethodToAllWithClone(method, poly3d, ...args) {
    poly3d ??= this.clone();
    poly3d.polygons.forEach(poly => poly[method](...args, poly));
    return poly3d;
  }

  static #createSingleUsingMethod(method, ...args) {
    const out = new this(1);
    out.polygons[0] = Polygon3d[method](...args);
    return out;
  }

  // ----- NOTE: In-place modifiers ----- //

  /**
   * Clear the getter caches.
   */
  clearCache() {
    this.#applyMethodToAll("clearCache");
    super.clearCache();
  }

  clean() { this.#applyMethodToAll("clean"); }

  setZ(z) {
    this.#applyMethodToAll("setZ", z);
    this.clearCache();
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

  // ----- NOTE: Centroid ----- //

  /** @type {Point3d} */
  #centroid;

  centroid() {
    if ( !this.centroid ) {
      // Assuming flat points, determine plane and then convert to 2d
      const plane = this.plane;
      const points = this.polygons.flatMap(poly => poly.points);
      const M2d = plane.conversion2dMatrix;
      const points2d = points.map(pt3d => M2d.multiplyPoint3d(pt3d));
      const convex2dPoints = convexHull(points2d);

      // Determine the centroid of the 2d convex polygon.
      const convexPoly2d = new PIXI.Polygon(convex2dPoints);
      this.#centroid = convexPoly2d.center;
    }
    return this.#centroid;
  }

  // ----- NOTE: Factory methods ----- //

  static from3dPolygons(polys) {
    const n = polys.length;
    const polys3d = new this(n);
    for ( let i = 0; i < n; i += 1 ) polys3d.polygons[i] = polys[i];
    return polys3d;
  }

  static fromPoints(pts) { return this.#createSingleUsingMethod("fromPoints", pts); }

  static from2dPoints(pts, elevation) { return this.#createSingleUsingMethod("from2dPoints", pts, elevation); }

  static from3dPoints(pts) { return this.#createSingleUsingMethod("from3dPoints", pts); }

  static fromPolygon(poly, elevation) { return this.#createSingleUsingMethod("fromPolygon", poly, elevation); }

  static fromPolygons(polys, elevation) {
    const out = new this();
    out.polygons = polys.map(poly => Polygon3d.fromPolygon(poly, elevation));
    return out;
  }

  static fromClipperPaths(cpObj, elevation) {
    const out = new this();
    out.polygons = Polygon3d.fromClipperPaths(cpObj, elevation);
    return out;
  }

  static fromVertices(vertices, indices) { this.#createSingleUsingMethod("fromVertices", vertices, indices); }

  clone(out) {
    out ??= new this.constructor(0);
    out.polygons = this.polygons.map(poly => poly.clone());
    return out;
  }

  // ----- NOTE: Conversions to ----- //

  /**
   * @param {"x"|"y"|"z"} omitAxis    Which of the three axes to omit to drop this to 2d.
   * @param {object} [opts]
   * @param {number} [opts.scalingFactor]   How to scale the clipper points
   * @returns {ClipperPaths}
   */
  toClipperPaths(opts) {
    const cpObjArr = this.#applyMethodToAllWithReturn("toClipperPaths", opts);
    return CONFIG.GeometryLib.ClipperPaths.joinPaths(cpObjArr); // TODO: Move to Clipper 2?
  }

  toPolygon2d(opts) { return this.#applyMethodToAllWithReturn("toPolygon2d", opts); }

  toPerspectivePolygon() { return this.#applyMethodToAllWithReturn("toPerspectivePolygon"); }

  toVertices(opts) {
    const tris = [];
    this.polygons.forEach(poly => tris.push(...poly.triangulate()));
    return Triangle3d.trianglesToVertices(tris, opts);
  }

  triangulate(opts) {
    const out = new this();
    this.polygons.forEach(poly => out.polygons.push(...poly.triangulate(opts)));
    return out;
  }

  buildTopSides(bottomZ, heightZ = 0) {
    const sides = [];
    for ( const poly3d of this.polygons ) sides.push(...poly3d.buildTopSides(bottomZ, heightZ));
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
    const poly = this.polygons[0];
    return poly.isFacing(p) ^ poly.isHole; // Holes have reverse orientation.
  }

  // Valid if it forms at least one polygon.
  isValid() {
    return this.polygons.length
      && this.polygons.every(poly => poly.isValid())
      && this.polygons.some(poly => !poly.isHole);
  }

  // ----- NOTE: Transformations ----- //

  transform(M, poly3d) { return this.#applyMethodToAllWithClone("transform", poly3d, M); }

  multiplyScalar(multiplier, poly3d) { return this.#applyMethodToAllWithClone("multiplyScalar", poly3d, multiplier); }

  scale(opts, poly3d) { return this.#applyMethodToAllWithClone("scale", poly3d, opts); }

  divideByZ(poly3d) { return this.#applyMethodToAllWithClone("divideByZ", poly3d); }

  // ----- NOTE: Intersection ----- //

  /**
   * Test if a ray intersects the polygon. Does not consider whether this polygon is facing.
   * Ignores holes. If 2+ polygons overlap, it will count as an intersection if it intersects
   * more outer than holes.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @returns {Point3d|null}
   */
  intersection(rayOrigin, rayDirection, minT) {
    let ixNum = 0;
    let ix;
    for ( const poly of this.polygons ) {
      const polyIx = poly.intersection(rayOrigin, rayDirection, minT);
      if ( polyIx ) {
        ix = polyIx;
        ixNum += (poly.isHole ? -1 : 1);
      }
    }
    return ixNum > 0 ? ix : null;
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
