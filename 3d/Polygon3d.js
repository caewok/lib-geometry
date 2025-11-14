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
import { Plane } from "./Plane.js";
import { almostLessThan, almostGreaterThan, pointsAreCollinear, NULL_SET } from "../util.js";
import { AABB3d } from "../AABB.js";
import { ClipperPaths } from "../ClipperPaths.js";
import { Clipper2Paths } from "../Clipper2Paths.js";
import { Draw } from "../Draw.js";

/*
3d Polygon representing a flat polygon plane.
Can be transformed in 3d space.
Can be clipped at a specific z value.

Points in a Polygon3d are assumed to not be modified in place after creation.
*/
export class Polygon3d {

  static classTypes = new Set([this.name], "Polygon", "PlanarPolygon"); // Alternative to instanceof

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
      if ( !pointsAreCollinear(a, b, c) ) newPoints.push(b);
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
    if ( this.#plane ) this.plane.normal.multiplyScalar(-1);
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

  _calculateAABB(aabb) { aabb.constructor.fromPolygon3d(this, aabb); }

  // ----- NOTE: Plane ----- //

  /** @type {Plane} */
  #plane;

  get plane() {
    if ( !this.#plane ) this.#plane = this._calculatePlane();
    return this.#plane;
  }

  _calculatePlane() {
    // Assumes without testing that points are not collinear.
    // Construct the plane so the center of the polygon is the origin.
    return Plane.fromMultiplePoints(this.points);
  }

  set plane(value) { this.#plane = value; }

  /** @type {PIXI.Point[]} */
  #planarPoints = [];

  // Points on the 2d plane in the plane's coordinate system.
  get planarPoints() {
    if ( !this.#planarPoints.length ) {
      const points = this.points;
      const nPoints = points.length;
      this.#planarPoints.length = nPoints;
      const to2dM = this.plane.conversion2dMatrix;
      const tmpPt = Point3d.tmp;
      for ( let i = 0; i < nPoints; i += 1 ) {
        this.#planarPoints[i] = to2dM.multiplyPoint3d(points[i], tmpPt).to2d();
      }
      tmpPt.release();
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
      const plane = this.plane;

      // Convert to 2d polygon and calculate centroid.
      const M2d = plane.conversion2dMatrix;
      const tmpPt = Point3d.tmp;
      const pts = this.points.map(pt3d => M2d.multiplyPoint3d(pt3d, tmpPt).to2d());
      const poly2d = new PIXI.Polygon(pts);
      PIXI.Point.release(...pts);
      const ctr = poly2d.center;
      const ctr3d = Point3d.tmp.set(ctr.x, ctr.y, 0);
      this.#centroid = plane.conversion2dMatrixInverse.multiplyPoint3d(ctr3d);
      this.#dirtyCentroid = false;
      ctr3d.release();
    }
    return this.#centroid;
  }

  /**
   * @param {Points3d} points
   * @returns {Points3d}
   */
  static convexHull(points) {
    // Assuming flat points, determine plane and then convert to 2d
    const plane = Plane.fromPoints(points[0], points[1], points[2]);
    const M2d = plane.conversion2dMatrix;
    const points2d = points.map(pt3d => M2d.multiplyPoint3d(pt3d));
    const convex2dPoints = convexHull(points2d);
    return convex2dPoints.map(pt => plane.conversion2dMatrixInverse.multiplyPoint3d(pt))
  }

  // ----- NOTE: Factory methods ----- //

  static from2dPoints(pts, elevation = 0, out) {
    const n = pts.length;
    if ( out ) out.points.length = n;
    else out = new this(n);
    let i = 0;
    for ( const pt of pts ) {
      const outPt = out.points[i++] ??= Point3d.tmp;
      outPt.set(pt.x, pt.y, elevation);
    }
    return out;
  }

  static from3dPoints(pts, out) {
    const n = pts.length;
    if ( out ) out.points.length = n;
    else out = new this(n);
    for ( let i = 0; i < n; i += 1 ) {
      const outPt = out.points[i] ??= new Point3d()
      outPt.copyFrom(pts[i]);
    }
    return out;
  }

  static fromPolygon(poly, elevation = 0, out) {
    const pts = [...poly.iteratePoints({ close: false })];
    out = this.from2dPoints(pts, elevation, out);
    PIXI.Point.release(...pts);
    return out;
  }

  static fromClipperPaths(cpObj, elevation = 0) {
    return cpObj.toPolygons().map(poly => this.fromPolygon(poly, elevation));
  }

  /**
   * Create a polygon from given indices and vertices
   * @param {Number[]} vertices     Array of vertices, 3 coordinates per vertex
   * @param {Number[]} [indices]    Indices to determine order in which polygon points are created from vertices
   * @returns {Triangle[]}
   */
  static fromVertices(vertices, indices, stride = 3, out) {
    const n = indices.length;
    if ( vertices.length % stride !== 0 ) console.error(`${this.name}.fromVertices|Length of vertices is not divisible by stride ${stride}: ${vertices.length}`);
    indices ??= Array.fromRange(Math.floor(vertices.length / 3));
    if ( n % 3 !== 0 ) console.error(`${this.name}.fromVertices|Length of indices is not divisible by 3: ${indices.length}`);
    if ( out ) out.points.length = n;
    else out = new this(n);
    for ( let i = 0, j = 0, jMax = n; j < jMax; j += 1 ) {
      const outPt = out.points[j] ??= new Point3d()
      pointFromVertices(i++, vertices, indices, stride, outPt);
    }
    return out;
  }

  static fromPlanarPolygon(poly2d, plane) {
    const invM2d = plane.conversion2dMatrixInverse;
    const ln = poly2d.points.length;
    const pts3d = new Array(Math.floor(ln / 2));
    for ( let i = 0, j = 0; i < ln; i += 2, j += 1 ) {
      const x = poly2d.points[i];
      const y = poly2d.points[i + 1];
      const pt3d = Point3d.tmp.set(x, y, 0);
      pts3d[j] = invM2d.multiplyPoint3d(pt3d, pt3d);
    }
    const out = this.from3dPoints(pts3d);
    Point3d.release(...pts3d);
    return out;
  }


  /**
   * Make a copy of this polygon.
   * @returns {Polygon3d} A new polygon
   */
  clone(out) {
    out ??= new this.constructor(this.points.length);
    out.isHole = this.isHole;
    if ( out.points.length !== this.points.length ) out.points = this.points.map(_pt => Point3d.tmp);
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
    const clipperVersion = CONFIG.GeometryLib.clipperVersion === 2;
    let points;
    let cl;
    if ( clipperVersion === 2 ) {
      cl = Clipper2Paths;
      const Point64 = Clipper2Paths.Clipper2.Point64;
      switch ( omitAxis ) {
        case "x": points = this.points.map(pt => new Point64(pt.to2d({x: "y", y: "z"}), scalingFactor)); break;
        case "y": points = this.points.map(pt => new Point64(pt.to2d({x: "x", y: "z"}), scalingFactor)); break;
        case "z": points = this.points.map(pt => new Point64(pt.to2d({x: "x", y: "y"}), scalingFactor)); break;
      }

    } else {
      cl = ClipperPaths;
      const IntPoint = ClipperLib.IntPoint;
      switch ( omitAxis ) {
        case "x": points = this.points.map(pt => new IntPoint(pt.y * scalingFactor, pt.z * scalingFactor)); break;
        case "y": points = this.points.map(pt => new IntPoint(pt.x * scalingFactor, pt.z * scalingFactor)); break;
        case "z": points = this.points.map(pt => new IntPoint(pt.x * scalingFactor, pt.y * scalingFactor)); break;
      }
    }
    const out = new cl([points], { scalingFactor });
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
    PIXI.Point.release(...points2d);

    // Convert back to 3d. For speed, do with tmp points instead of using _convert2dPointsTo3d.
    const from2dM = this.plane.conversion2dMatrixInverse;
    const a = Point3d.tmp;
    const b = Point3d.tmp;
    const c = Point3d.tmp;
    const out = tris2d.map(tri2d => {
      const pts = tri2d.points;
      a.set(pts[0], pts[1], 0);
      b.set(pts[2], pts[3], 0);
      c.set(pts[4], pts[5], 0);
      from2dM.multiplyPoint3d(a, a);
      from2dM.multiplyPoint3d(b, b);
      from2dM.multiplyPoint3d(c, c);
      return Triangle3d.from3Points(a, b, c);
    });
    Point3d.release(a, b, c);
    return out;
  }

  /**
   * Convert 3d points on the polygon plane to 2d. Does not confirm the 3d point locations.
   * @param {Point3d[]} pts
   * @returns {PIXI.Point[]}
   */
  _convert3dPointsTo2d(pts) {
    // If the plane is horizontal (parallel to the canvas), can simply drop z.
    // TODO: Make permanent without the test
    if ( this.plane.normal.x === 0
      && this.plane.normal.y === 0
      && this.plane.normal.z > 0 ) {

      const out = pts.map(pt => PIXI.Point.tmp.set(pt.x, pt.y));
      const to2dM = this.plane.conversion2dMatrix;
      const points2d = pts.map(pt => to2dM.multiplyPoint3d(pt));
      for ( let i = 0; i < out.length; i += 1 ) {
        if ( !out[i].almostEqual(points2d[i]) ) {
          console.warn("_convert3dPointsTo2d|Quick conversion failed.");
          break;
        }
      }
      // return out;
    }

    // Convert using plane's matrix.
    const to2dM = this.plane.conversion2dMatrix;
    return pts.map(pt => to2dM.multiplyPoint3d(pt));
  }

  /**
   * Convert 2d points on the polygon plane to 3d. Does not confirm the 2d point locations.
   * @param {PIXI.Point[]} pts
   * @returns {Point3d[]}
   */
  _convert2dPointsTo3d(pts) {
    // If the plane is horizontal (parallel to the canvas), can simply add elevation.
    const tmp3d = Point3d.tmp;
    if ( this.plane.normal.x === 0
      && this.plane.normal.y === 0
      && this.plane.normal.z > 0 ) {

      const z = this.points[0].z;
      const out = pts.map(pt => Point3d.tmp.set(pt.x, pt.y, z));
      const from2dM = this.plane.conversion2dMatrixInverse;
      const points3d = pts.map(pt => from2dM.multiplyPoint3d(tmp3d.set(pt.x, pt.y, 0)));
      for ( let i = 0; i < out.length; i += 1 ) {
        if ( !out[i].almostEqual(points3d[i]) ) {
          console.warn("_convert3dPointsTo2d|Quick conversion failed.");
          break;
        }
      }
      // return out;
    }

    // Convert using plane's matrix.
    const from2dM = this.plane.conversion2dMatrixInverse;
    const points3d = pts.map(pt => from2dM.multiplyPoint3d(tmp3d.set(pt.x, pt.y, 0)));
    tmp3d.release();
    return points3d;
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
    const a = Point3d.tmp;
    const b = Point3d.tmp;

    for ( const edge of this.iterateEdges({ close: true }) ) {
      const { A, B } = edge;
      const z0 = bottomZ ?? A.z - heightZ;
      const z1 = bottomZ ?? B.z - heightZ;
      const side = Quad3d.from4Points(edge.B, edge.A, a.set(A.x, A.y, z0), b.set(B.x, B.y, z1));
      sides[i++] = side;
    }
    Point3d.release(a, b);
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
    poly3d.clearCache();
    return poly3d;
  }

  multiplyScalar(multiplier, poly3d) {
    poly3d ??= this.clone();
    poly3d.points.forEach(pt => pt.multiplyScalar(multiplier, pt));
    poly3d.clearCache();
    return poly3d;
  }

  scale({ x = 1, y = 1, z = 1} = {}, poly3d) {
    poly3d ??= this.clone();
    const scalePt = Point3d.tmp.set(x, y, z);
    poly3d.points.forEach(pt => pt.multiply(scalePt, pt));
    poly3d.clearCache();
    scalePt.release();
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
    poly3d.clearCache();
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
    const plane = this.plane;
    const t = plane.rayIntersection(rayOrigin, rayDirection);
    if ( t === null || !t.almostBetween(minT, maxT) ) return null;
    if ( t.almostEqual(0) ) return rayOrigin;

    const ix = Point3d.tmp;
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
    const tmpPt3d = Point3d.tmp;
    const pts = this.points.map(pt3d => M2d.multiplyPoint3d(pt3d, tmpPt3d).to2d());
    const poly2d = new PIXI.Polygon(pts);
    const ix2d = M2d.multiplyPoint3d(ix, tmpPt3d).to2d();
    const out = poly2d.contains(ix2d.x, ix2d.y) ? ix : null;
    tmpPt3d.release();
    PIXI.Point.release(...pts);
    return out;
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
      const { A, B } = edge;
      if ( cmp(A) ) toKeep.push(A.clone());
      if ( cmp(A) ^ cmp(B) ) {
        const newPt = Point3d.tmp;
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
    const tmpPt3d = Point3d.tmp;
    const a = to2dM.multiplyPoint3d(res.point, tmpPt3d).to2d();
    const b = to2dM.multiplyPoint3d(b3d, tmpPt3d).to2d();

    const poly2d = new PIXI.Polygon(this.planarPoints);
    const ixs = poly2d.lineIntersections(a, b);
    ixs.sort((a, b) => a.t0 - b.t0);
    a.release();
    b.release();

    const from2dM = this.plane.conversion2dMatrixInverse;
    const pts3d = ixs.map(ix => from2dM.multiplyPoint3d(tmpPt3d.set(ix.x, ix.y, 0)));
    tmpPt3d.release();
    if ( pts3d.length === 1 ) return pts3d[0];

    // Intersecting poly with a plane, so the first intersection must be outside --> inside.
    // so ix0 -- ix1, ix1 -- ix2 (hole), ix2 --- ix3, ix3 --- ix4 (hole), ix4 --- ix5, ...
    const nIxs = pts3d.length;
    const segments = Array(Math.floor(nIxs * 0.5));
    for ( let i = 0, j = 0; i < nIxs; i += 2 ) segments[j++] = { a: pts3d[i], b: pts3d[i + 1] };
    return segments;
  }


  /* ----- NOTE: Debug ----- */

  draw2d({ draw, omitAxis = "z", ...opts } = {}) {
    draw ??= new Draw();
    draw.shape(this.toPolygon2d({ omitAxis }), opts);
  }
}

function pointFromVertices(i, vertices, indices, stride = 3, outPoint) {
  outPoint ??= Point3d.tmp;
  const idx = indices[i];
  const v = vertices.slice(idx * stride, (idx * stride) + 3);
  outPoint.set(v[0], v[1], v[2]);
  return outPoint;
}

/**
 * Planar ellipse shape.
 */
export class Ellipse3d extends Polygon3d {

  static classTypes = new Set([this.name], "Ellipse", "PlanarEllipse"); // Alternative to instanceof

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
    super(1); // 1 point representing the center.
  }

  // ----- NOTE: In-place modifiers ----- //

  _calculatePlane() {
    const center = this.centroid;
    const normal = Point3d.tmp;

    // Add 2 points to form a flat plane. Form CCW.
    const b = Point3d.tmp.set(center.x + this.radiusX, center.y, center.z);
    const c = Point3d.tmp.set(center.x, center.y - this.radiusY, center.z);
    Plane.normalFromPoints(center, b, c, normal);
    const out = new Plane(center, normal);
    Point3d.release(normal, b, c);
    return out;
  }

  _setDimensions(center, radiusX, radiusY) {
    this.points[0].copyFrom(center);
    this.radiusX = radiusX;
    this.radiusY = radiusY;
    this.clearCache();
    return this;
  }

  clean() { return; }

  setZ(z = 0) { this.center.z = z; super.setZ(z); }

  reverseOrientation() {
    // No points to reverse.
    this.plane.normal.multiplyScalar(-1);
    return this;
  }

  // ----- NOTE: Plane ----- //

  get ellipse() { return new PIXI.Ellipse(this.center.x, this.center.y, this.radiusX, this.radiusY); }

  // ----- NOTE: Centroid ----- //

  get centroid() { return this.points[0]; }

  // ----- NOTE: Factory methods ----- //

  static fromEllipse(ellipse, elevationZ = 0, out) {
    const centerPt = Point3d.tmp.set(ellipse.x, ellipse.y, elevationZ)
    out = this.fromCenterPoint(centerPt, ellipse.width, ellipse.height, out);
    centerPt.release();
    return out;
  }

  static fromCenterPoint(center, radiusX, radiusY, out) {
    out ??= new this();
    return out._setDimensions(center, radiusX, radiusY);
  }

  static calculateDimensionsFromPoints(pts, { center, radiusX, radiusY } = {}) {
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
    if ( !(radiusX || radiusY) ) {
      // Must find the minimum and maximum distance from the polygon center to determine the two radii.
      let min2 = Number.POSITIVE_INFINITY;
      let max2 = Number.NEGATIVE_INFINITY;
      const cl = center.constructor;
      for ( const pt of pts ) {
        const dist2 = cl.distanceSquaredBetween(center, pt);
        min2 = Math.min(min2, dist2);
        max2 = Math.max(max2, dist2);
      }
      radiusX ||= Math.sqrt(max2);
      radiusY ||= Math.sqrt(min2);
    }
    return { center, radiusX, radiusY };
  }

  /**
   * Construct from a set of points that are on the ellipse edge.
   */
  static from2dPoints(pts, elevation = 0, out, opts) {
    const res = this.calculateDimensionsFromPoints(pts, opts);
    const centerPt = Point3d.tmp.set(res.center.x, res.center.y, elevation)
    out = this.fromCenterPoint(centerPt, res.radiusX, res.radiusY, out);
    centerPt.release();
    return out;
  }

  static from3dPoints(pts, out, opts) {
    const res = this.calculateDimensionsFromPoints(pts, opts);
    out ??= new this();
    out._setDimensions(res.center, res.radiusX, res.radiusY);
    out.points[0] = res.center;
    out.plane = Plane.fromMultiplePoints([res.center, ...pts]);
    return out;
  }

  static fromPlanarPolygon(poly2d, plane, radiusX = null, radiusY = null) {
    const center = poly2d.center;
    if ( !(radiusX || radiusY) ) {
      const res = this.calculateDimensionsFromPoints(poly2d.iteratePoints({ close: false }), { center, radiusX, radiusY });
      radiusX ??= res.radiusX;
      radiusY ??= res.radiusY;
    }
    const out = new this();
    out._setDimensions(center, radiusX, radiusY);
    out.plane = plane;
    return out;
  }

  static fromPolygon(...args) { return Polygon3d.fromPolygon(...args); }

  static fromClipperPaths(...args) { return Polygon3d.fromClipperPaths(...args);  }

  static fromVertices(...args) { return Polygon3d.fromVertices(...args); }

  static fromPlanarEllipse(ellipse2d, plane, out) {
    let center3d;
    if ( ellipse2d.center.x.almostEqual(0) && ellipse2d.center.y.almostEqual(0) ) {
      center3d = plane.point;
    } else {
      const invM2d = plane.conversion2dMatrixInverse;
      center3d = invM2d.multiplyPoint3d(Point3d.tmp.set(ellipse2d.center.x, ellipse2d.center.y, 0));
    }
    out ??= new this();
    out._setDimensions(center3d, ellipse2d.width, ellipse2d.height);
    out.plane = plane;
    center3d.release();
    return out;
  }

  clone(out) {
    out ??= super.clone();
    out.radiusX = this.radiusX; // Rest is already set via points.
    out.radiusY = this.radiusY;
    return out;
  }

  // ----- NOTE: Conversions to ----- //

  toPlanarEllipse() {
    const center = Point3d.tmp;
    const centroid = this.centroid;
    if ( centroid.almostEqual(this.plane.point) ) center.set(0, 0, 0);
    else {
      const to2dM = this.plane.conversion2dMatrix;
      to2dM.multiplyPoint3d(centroid, center);
    }
    const out = new PIXI.Ellipse(center.x, center.y, this.radiusX, this.radiusY);
    center.release();
    return out;
  }

  /**
   * Convert to 2d polygon, dropping z.
   * @returns {PIXI.Polygon}
   */
  toPolygon2d(opts) {  return this.toPolygon3d(opts).toPolygon2d(opts); }

  // opts: { density, includeEndpoints = true }
  toPolygon3d(opts ) {
    const poly2d = this.toPlanarPolygon(opts);
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
    const poly3d = this.toPolygon3d();
    for ( const edge of poly3d.iterateEdges(opts) ) yield edge;
  }

  *iteratePoints(opts) {
    const poly3d = this.toPolygon3d();
    for ( const pt of poly3d.iteratePoints(opts) ) yield pt;
  }
}

/**
 * Planar circle. Not to be confused with a sphere! This is a slice of a sphere in a plane.
 */
export class Circle3d extends Ellipse3d {

  static classTypes = new Set([this.name], "Circle", "PlanarCircle"); // Alternative to instanceof

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

  // ----- NOTE: Plane ----- //

  get circle() { return new PIXI.Circle(this.center.x, this.center.y, this.radius); }

  // ----- NOTE: Factory methods ----- //

  static fromCircle(cir, elevationZ = 0, out) {
    const centerPt = Point3d.tmp.set(cir.x, cir.y, elevationZ);
    out = this.fromCenterPoint(centerPt, cir.radius, out);
    centerPt.release();
    return out;
  }

  static fromCenterPoint(center, radius, out) {
    out ??= new this();
    return out._setDimensions(center, radius, radius);
  }

  static fromPlanarCircle(circle2d, plane, out) {
    let center3d;
    if ( circle2d.center.x.almostEqual(0) && circle2d.center.y.almostEqual(0) ) {
      center3d = plane.point;
    } else {
      const invM2d = plane.conversion2dMatrixInverse;
      center3d = invM2d.multiplyPoint3d(Point3d.tmp.set(circle2d.center.x, circle2d.center.y, 0));
    }
    out ??= new this();
    out._setDimensions(center3d, circle2d.radius, circle2d.radius);
    out.plane = plane;
    center3d.release();
    return out;
  }

  // ----- NOTE: Conversions to ----- //

  toPlanarCircle() {
    const center = Point3d.tmp;
    const centroid = this.centroid;
    if ( centroid.almostEqual(this.plane.point) ) center.set(0, 0, 0);
    else {
      const to2dM = this.plane.conversion2dMatrix;
      to2dM.multiplyPoint3d(centroid, center);
    }
    const out = new PIXI.Circle(center.x, center.y, this.radius);
    center.release();
    return out;
  }

  toPlanarPolygon(opts) {
    const cir = this.toPlanarCircle();
    return cir.toPolygon(opts);
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
}


/**
 * Planar triangle shape.
 */
export class Triangle3d extends Polygon3d {

  static classTypes = new Set([this.name], "Triangle", "PlanarTriangle"); // Alternative to instanceof

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
    if ( vertices.length % stride !== 0 ) console.error(`${this.name}.fromVertices|Length of vertices is not divisible by stride ${stride}: ${vertices.length}`);
    indices ??= Array.fromRange(Math.floor(vertices.length / 3));
    if ( indices.length % 3 !== 0 ) console.error(`${this.name}.fromVertices|Length of indices is not divisible by 3: ${indices.length}`);
    const tris = new Array(Math.floor(indices.length / 3));
    const a = Point3d.tmp;
    const b = Point3d.tmp;
    const c = Point3d.tmp;
    for ( let i = 0, j = 0, jMax = tris.length; j < jMax; j += 1 ) {
      pointFromVertices(i++, vertices, indices, stride, a);
      pointFromVertices(i++, vertices, indices, stride, b);
      pointFromVertices(i++, vertices, indices, stride, c);
      tris[j] = this.from3Points(a, b, c);
    }
    a.release();
    b.release();
    c.release();
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
    return Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, this.a, this.b, this.c);
  }

  intersection(rayOrigin, rayDirection, minT = 0, maxT = Number.POSITIVE_INFINITY) {
    const t = this.intersectionT(rayOrigin, rayDirection);
    if ( t === null || !t.almostBetween(minT, maxT) ) return null;
    if ( t.almostEqual(0) ) return rayOrigin;
    const ix = Point3d.tmp;
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

  static classTypes = new Set([this.name], "Quad", "PlanarQuad"); // Alternative to instanceof

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
    return Plane.rayIntersectionQuad3dLD(rayOrigin, rayDirection, this.a, this.b, this.c, this.d);
  }

  intersection(rayOrigin, rayDirection, minT = 0, maxT = Number.POSITIVE_INFINITY) {
    const t = this.intersectionT(rayOrigin, rayDirection);
    if ( t === null || !t.almostBetween(minT, maxT) ) return null;
    if ( t.almostEqual(0) ) return rayOrigin;
    const ix = Point3d.tmp;
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

  static classTypes = new Set([this.name], "Polygons", "PlanarPolygons"); // Alternative to instanceof

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
  clearCache(clearPolygons = true) {
    if ( clearPolygons ) this.#applyMethodToAll("clearCache");
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

  static fromPlanarPolygons(polys, plane) {
    const out = new this();
    out.polygons = polys.map(poly => Polygon3d.fromPlanarPolygon(poly, plane));
    return out;
  }

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
    const cl = CONFIG.GeometryLib.clipperVersion === 2 ? Clipper2Paths : ClipperPaths;
    return cl.joinPaths(cpObjArr); // TODO: Move to Clipper 2?
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

  transform(M, poly3d) {
    const out = this.#applyMethodToAllWithClone("transform", poly3d, M);
    out.clearCache(false);
    return out;
  }

  multiplyScalar(multiplier, poly3d) {
    const out = this.#applyMethodToAllWithClone("multiplyScalar", poly3d, multiplier);
    out.clearCache(false);
    return out;
  }

  scale(opts, poly3d) {
    const out = this.#applyMethodToAllWithClone("scale", poly3d, opts);
    out.clearCache(false);
    return out;
  }

  divideByZ(poly3d) {
    const out = this.#applyMethodToAllWithClone("divideByZ", poly3d);
    out.clearCache(false);
    return out;
  }

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

  /**
   * Intersect this Polygons3d against a plane, noting holes.
   * @param {Plane} plane
   * @returns {Segment3d[]} May be empty if no intersecting segments.
   */
  intersectPlane(plane, { tangents = true } = {}) {
    const res = this.plane.intersectPlane(plane);
    if ( !res ) return [];

    // Convert the intersecting ray to 2d values on this plane.
    const to2dM = this.plane.conversion2dMatrix
    const b3d = res.point.add(res.direction);
    const tmpPt3d = Point3d.tmp;
    const a = to2dM.multiplyPoint3d(res.point, tmpPt3d).to2d();
    const b = to2dM.multiplyPoint3d(b3d, tmpPt3d).to2d();

    // Locate the 2d intersecting segments for each polygon on the plane.
    const nPolys = this.polygons.length;
    const out = Array();
    for ( let i = 0; i < nPolys; i += 1 ) {
      const poly2d = new PIXI.Polygon(this.polygons[i].planarPoints);
      const ixs = poly2d.lineIntersections(a, b, { tangents });
      out[i] = { ixs, isPositive: poly2d.isPositive };
    }

    // Convert back to 3d.
    const from2dM = this.plane.conversion2dMatrixInverse;
    out.forEach(elem => elem.ixs.pt3d = from2dM.multiplyPoint3d(tmpPt3d.set(elem.ixs.x, elem.ixs.y, 0)));
    tmpPt3d.release();
    return out;
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
