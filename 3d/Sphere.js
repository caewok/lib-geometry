	/* globals
foundry,
PIXI,
*/
"use strict";

import { GEOMETRY_CONFIG } from "../const.js";
import { Polygon3d, Circle3d } from "./Polygon3d.js";
import { Point3d } from "./Point3d.js";
import { MatrixFlat } from "../MatrixFlat.js";
import { almostBetween } from "../util.js";

/* Sphere
Represent a 3d sphere, with some functions to manipulate it.
*/

Math.GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;

export class Sphere {

  /** @type {number} */
  #radius = 0;

  /** @type {number} */
  #radiusSquared = 0;

  get radius() { return this.#radius; }

  set radius(value) {
    this.#radius = value;
    this.#radiusSquared = value * value;
  }

  get radiusSquared() { return this.#radiusSquared; }

  set radiusSquared(value) {
    this.#radiusSquared = value;
    this.#radius = Math.sqrt(value);
  }

  /** @type {Point3d} */
  center = new Point3d();

  /** @type {object<min: Point3d, max: Point3d>} */
  #aabb = {
    min: new Point3d(),
    max: new Point3d(),
  };

  get aabb() {
    const { center, radius } = this;
    this.#aabb.min.set(center.x - radius, center.y - radius, center.z - radius);
    this.#aabb.max.set(center.x + radius, center.y + radius, center.z + radius);
    return this.aabb;
  }

  contains(pt, epsilon = 1e-06) {
    return Point3d.distanceSquaredBetween(pt, this.center) < (this.radiusSquared + epsilon);
  }

  toCircle2d() { return new PIXI.Circle(this.x, this.y, this.radius); }

  /**
   * Does a planar polygon overlap?
   * @param {Polygon3d} poly3d
   * @returns {boolean}
   */
  overlapsPolygon3d(poly3d) {
    if ( poly3d.overlapsClass("Circle3d") ) return this.overlapsCircle3d(poly3d);
    for ( const pt of poly3d.iteratePoints({ close: false }) ) {
      const inside = this.contains(pt);
      if ( inside ) return true;
    }

    // Project onto the polygon polygon plane and test for overlap.
    const sphereCircle = this.#planarCircle(poly3d.plane);
    const poly2d = poly3d.toPlanarPolygon();
    return sphereCircle.overlaps(poly2d);
  }

  overlapsCircle3d(circle3d) {
    if ( this.containsPoint(circle3d.center) ) return true;

    const sphereCircle = this.#planarCircle(circle3d.plane);
    if ( !sphereCircle ) return false;
    if ( sphereCircle.inheritsClassType("Point3d") ) return true;

    // Project onto the circle plane and test for overlap.
    const circle2d = circle3d.toPlanarCircle();
    return sphereCircle.overlaps(circle2d);
  }

  /**
   * Locate the closest point on the line a|b to the sphere.
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {Point3d}
   */
  closestPointToSegment(a, b) {
    const { center } = this;
    const closest2d = foundry.utils.closestPointToSegment(center, a, b);

		// Test endpoints as needed.
		if ( closest2d.x.almostEqual(a.x) && closest2d.y.almostEqual(a.y) ) {
			closest2d.release();
			return a.clone();
		}
		if ( closest2d.x.almostEqual(b.x) && closest2d.y.almostEqual(a.y) ) {
			closest2d.release();
			return b.clone();
		}
		if ( closest2d.x.almostEqual(center.x) && closest2d.y.almostEqual(center.y) ) {
		  closest2d.release();
		  return center.clone();
		}

		// Closest point is somewhere on the a|b line.
		// Given x|y intersection on 3d line, find the z value. Use rate of change along each axis.
		const delta = b.subtract(a);
		const maxAxis = Math.abs(delta.x) > Math.abs(delta.y) ? "x" : "y";
		const t = (closest2d[maxAxis] - a[maxAxis]) / delta[maxAxis];

		const closest3d = Point3d.tmp;
		a.add(delta.multiplyScalar(t, closest3d), closest3d); // From PIXI.Point#projectToward.
    closest2d.release();
    delta.release();
    return closest3d;
  }

  /**
   * Intersect this sphere with a line
   */
  lineIntersections(a, b) {
 		/*
		a--ix0----cl-----ix1--b
				\   |
				 \  |
					\ |
					 \|
						c

		∆abc such that x|c is less than or equal to radius length. May also have an y|c

		If a|b is a line, then closest point forms right triangle with a|ix|cl
		If a|b runs through cl, then intersection is for the circle (sphere maximum extent) at appropriate z values.
		if cl|ix greater than radius, no intersection.

		We know length of c|x, c|ix, c|y. And length of c|x == length of c|y.
		So use Pythagorean to get length from ix to x. (ix to y is same length)
		x|ix ^ 2 + c|ix ^2 = c|x ^ 2
		x|ix = sqrt(c|x ^ 2 - c|ix ^ 2)
	  */

		const { center, radiusSquared } = this;
		const closest3d = this.closestPointToSegment(a, b);
		const distSquared = Point3d.distanceSquaredBetween(closest3d, center);
		if ( radiusSquared.almostEqual(distSquared) ) return [closest3d];
		if ( radiusSquared > distSquared ) return [];
		if ( distSquared.almostEqual(0) ) return center.clone();

		// Determine length from closest point to the first intersection.
		const xDistSquared = distSquared + radiusSquared;

		// Depending on where a and b are located w/r/t ix, move in given direction.
		// Treat segment as line
		const aPrime = a.towardsPointSquared(b, Number.MIN_SAFE_INTEGER);
		const bPrime = b.towardsPointSquared(a, Number.MIN_SAFE_INTEGER);
		const ix0 = closest3d.towardsPointSquared(aPrime, xDistSquared);
		const ix1 = closest3d.towardsPointSquared(bPrime, xDistSquared);

		return [ix0, ix1];
  }

  /**
   * Intersect this sphere with a segment.
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {Point3d[]}
   */
  lineSegmentIntersections(a, b, { inside = false } = {}) {
    const out = [...this.rayIntersectionTo(a, b.subtract(a)).filter(t => almostBetween(t, 0, 1))];
    if ( inside ) {
      if ( this.contains(a) ) out.push(a);
      if ( this.contains(b) ) out.push(b);
    }

    return ;
  }

  /**
   * Intersect this sphere with a ray.
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {number[]}
   */
  rayIntersectionT(a, rayDirection) {
    const b = a.add(rayDirection);
    const ixs = this.lineIntersections(a, b);
    b.release();
    if ( !ixs.length ) return ixs;

		// Determine if ix0 and ix1 are between a and b.
		const delta = rayDirection;
		const maxAxis = (delta.x > delta.y && delta.x > delta.z) ? "x"
		  : (delta.y > delta.x && delta.y) > delta.z ? "y" : "z"
		return ixs.map(ix => (ix[maxAxis] - a[maxAxis]) / delta[maxAxis]);
  }

  /**
   * Does a line segment intersect this sphere?
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {boolean}
   */
  lineSegmentIntersects(a, b) {
    // Closest point on the line segment must be within the sphere; test using the sphere center and radius.
    const { center, radiusSquared } = this;
    const closest3d = this.closestPointToSegment(a, b);
    const out = radiusSquared < Point3d.distanceSquaredBetween(center, closest3d);
    closest3d.release();
    return out;
  }

  /**
   * Intersect this sphere with a planar polygon.
   * @param {Polygon3d} poly3d
   * @returns {Polygon3d|Circle3d|Point3d|null}
   */
  intersectPolygon3d(poly3d) {
    if ( poly3d.overlapsClass("Circle3d") ) return this.intersectCircle3d(poly3d);
    let allInside = true;
    let allOutside = true;
    for ( const pt of poly3d.iteratePoints({ close: false }) ) {
      const inside = this.contains(pt);
      allInside &&= inside;
      allOutside &&= inside;
      if ( !(allInside || allOutside) ) break;
    }
    if ( allInside ) return poly3d;
    if ( allOutside && !poly3d.contains(this.center) ) return null;

    // If poly is outside the sphere and contains sphere center, it contains the entire sphere
    // Otherwise, it is an intersection.
    // Project the sphere to the plane.
    const sphereCircle = this.#planarCircle(poly3d.plane);
    if ( !sphereCircle ) return null;
    if ( sphereCircle.radius.almostEquals(0) ) {
      const circle3d = Circle3d.fromPlanarCircle(sphereCircle, poly3d.plane);
      return circle3d.center;
    }
    if ( allOutside ) return Circle3d.fromPlanarCircle(sphereCircle, poly3d.plane);
    const poly2d = sphereCircle.intersectPolygon(poly3d.toPlanarPolygon());
    return Polygon3d.fromPlanarPolygon(poly2d, poly3d.plane);
  }

  /**
   * Intersect this sphere with a planar circle.
   * @param {Polygon3d} poly3d
   * @returns {Polygon3d|Point3d|null}
   */
  intersectCircle3d(circle3d) {
    // Determine the circle shape on the plane where the sphere intersects the plane.
    const sphereCircle = this.#planarCircle(circle3d.plane);
    if ( !sphereCircle ) return null;
    if ( sphereCircle.radius.almostEqual(0) ) {
      const newCircle = Circle3d.fromPlanarCircle(sphereCircle, circle3d.plane);
      return newCircle.center;
    }

    // Intersect the two circles and return the resulting planar polygon.
    const poly2d = sphereCircle.intersectPolygon(circle3d.toPlanarCircle().toPolygon());
    return Polygon3d.fromPlanarPolygon(poly2d, circle3d.plane);
  }

  /**
   * Assuming the sphere intersects the plane, determine the planar circle
   * @param {Plane} plane
   * @returns {PIXI.Circle|PIXI.Point|null}
   */
  #planarCircle(plane) {
    const center3d = this.center;

    // Sphere must be within radius to touch the plane.
    const dist = plane.distanceToPoint(center3d);
    if ( dist.almostEqual(this.radius) ) return plane.projectPointOntoPlane(center3d);
    /* Tangent point alt calc:
      center ± r * N.normalize()
    */
    if ( dist > this.radius ) return null;

    // Check if plane contains the full diameter circle of the sphere.
    if ( plane.isPointOnPlane(this.center) ) return this.toCircle2d();

    // Determine the circle
    // p is distance from center to plane
    // radius = sqrt(r^2 - p^2)
    // center is sphere's center plus the projection of ρ along the plane's normal vector
    // center + p * N.normalize()
    const radius2d = Math.sqrt(this.radiusSquared - (dist ** 2));
    const center2d = Point3d.tmp;
    center3d.add(plane.normal.multiplyScalar(dist, center2d), center2d);
    return new PIXI.Circle(center2d.x, center2d.y, radius2d);
  }


  /**
   * Uses Welzl's algorithm to find the smallest enclosing sphere.
   */
  static encompassPoints(pts) {
    // Shuffle points to ensure average case O(n) performance.
    // Clone to avoid modifying pts.
    const shuffledPoints = [...pts];
    shuffledPoints.sort(() => Math.random - 0.5);
    return this._welzlRecursive(shuffledPoints, []);
  }

  /**
   * @param {Point3d[]} P   Set of points yet to be considered
   * @param {Point3d[]} R   Set of points on the boundary of the sphere
   * @returns {Sphere}
   */
  static _welzlRecursive(P, R) {
    if ( P.length === 0 || R.length === 4 ) {
      switch ( R.length ) {
        case 0: return new this();
        case 1: {
          const out = new this();
          out.center.copyFrom(R[0]);
          return out;
        }
        case 2: return this.sphereFromTwoPoints(...R);
        case 3: return this.sphereFromThreePoints(...R);
        case 4: return this.sphereFromFourPoints(...R);
      }
    }

    // Pick a point p from P.
    const p = P.pop();

    // Recursively find the sphere for the remaining points.
    const sphere = this._welzlRecursive(P, R);

    // If p is already in the sphere, finished this step.
    // Otherwise, p must be on the boundary of a new (larger) sphere.
    const newSphere = sphere.contains(p) ? sphere : this._welzlRecursive(P, [...R, p]);
    P.push(p); // Add p back for subsequent
    return newSphere;
  }

  /**
   * From a center point and a radius
   * @param {Point3d} center
   * @param {number} radius
   * @returns {Sphere}
   */
  static fromCenterPoint(center, radius = 0) {
    const out = new this();
    out.radius = radius;
    out.center.copyFrom(center);
    return out;
  }

  static fromCenter2dPoint(center, radius = 0, elevationZ = 0) {
    const out = new this();
    out.radius = radius;
    out.center.set(center.x, center.y, elevationZ);
    return out;
  }

  /**
   * Minimal enclosing sphere for two points.
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {Sphere}
   */
  static fromTwoPoints(a, b) {
    const out = new this();
    out.radius = Point3d.distanceBetween(a, b) * 0.5;
    a.add(b, out.center).multiplyScalar(0.5, out.center); // Midpoint between a and b.
    return out;
  }

  /**
   * Calculates the minimal enclosing sphere for 3 points.
   * This handles acute, obtuse, and collinear cases.
   * @param {Point3d} a
   * @param {Point3d} b
   * @param {Point3d} c
   * @returns {Sphere}
   */
  static fromThreePoints(a, b, c) {
    // Check if an angle is obtuse.
    const cb = c.subtract(a);
    const ab = a.subtract(b);
    if (ab.dot(cb) <= 0 ) {
      Point3d.release(ab, cb);
      return this.fromTwoPoints(a, c); // Angle b is obtuse.
    }

    const ac = a.subtract(c);
    if ( ac.dot(cb) <= 0 ) {
      Point3d.release(cb, ab, ac);
      return this.fromTwoPoints(a, b); // Angle c is obtuse.
    }

    const ca = c.subtract(a);
    const ba = b.subtract(a);
    if ( ba.dot(ca) <= 0 ) {
      Point3d.release(cb, ab, ac, ca, ba);
      return this.sphereFromTwoPoints(b, c); // Angle a is obtuse or collinear.
    }

    // If triangle is acute, the circumsphere is the minimal sphere.
    const cross_ba_bc = ba.cross(ca);
    const denominator = 2 * cross_ba_bc.magnitudeSquared();

    // If points are collinear, denominator is 0, but this case is handled by the obtuse checks above.
    if (Math.abs(denominator) < 1e-9) {
      // Fallback for safety, although should not be reached.
      console.error("fromThreePoints|Collinear points found", { a, b, c });
      Point3d.release(cb, ab, ac, ca, ba, cross_ba_bc);

      // Find the two points that are furthest apart.
      const distAB = Point3d.distanceSquaredBetween(a, b);
      const distAC = Point3d.distanceSquaredBetween(a, c);
      const distBC = Point3d.distanceSquaredBetween(b, c);
      if ( distAB >= distAC && distAB >= distBC ) return this.sphereFromTwoPoints(a, b);
      if ( distAC >= distAB && distAC >= distBC ) return this.sphereFromTwoPoints(a, c);

      return this.sphereFromTwoPoints(b, c);
    }

    const term1 = Point3d.tmp;
    const term2 = Point3d.tmp;
    cross_ba_bc.cross(ba, term1).multiplyScalar(ca.magnitudeSquared(), term1);
    ca.cross(cross_ba_bc, term2).multiplyScalar(ba.magnitudeSquared(), term2);

    const out = new this();
    out.radiusSquared = Point3d.distanceSquaredBetween(this.center, a);
    term1.add(term2, out.center).multiplyScalar(1/denominator, out.center).add(a, out.center);
    Point3d.release(cb, ab, ac, ca, ba, cross_ba_bc, term1, term2);
    return out;
  }

  /**
   * Calculates the minimal enclosing sphere for 3 points.
   * This handles acute, obtuse, and collinear cases.
   * @param {Point3d} a
   * @param {Point3d} b
   * @param {Point3d} c
   * @param {Point3d} d
   * @returns {Sphere}
   */
  static fromFourPoints(a, b, c, d) {
    // This involves solving a system of linear equations derived from the
    // equation of a sphere: (x-x0)^2 + (y-y0)^2 + (z-z0)^2 = r^2
    // The determinant of a matrix formed by the points' coordinates gives the center.
    const A = new MatrixFlat([
      a.x, a.y, a.z, 1,
      b.x, b.y, b.z, 1,
      c.x, c.y, c.z, 1,
      d.x, d.y, d.z, 1,
    ], 4, 4);

    const aSq = a.magnitudeSquared();
    const bSq = b.magnitudeSquared();
    const cSq = c.magnitudeSquared();
    const dSq = d.magnitudeSquared();

    const Dx = (new MatrixFlat([
      aSq, a.y, a.z, 1,
      bSq, b.y, b.z, 1,
      cSq, c.y, c.z, 1,
      dSq, d.y, d.z, 1,
    ])).determinant();

    const Dy = (new MatrixFlat([
      aSq, a.x, a.z, 1,
      bSq, b.x, b.z, 1,
      cSq, c.x, c.z, 1,
      dSq, d.x, d.z, 1,
    ])).determinant();

    const Dz = (new MatrixFlat([
      aSq, a.x, a.y, 1,
      bSq, b.x, b.y, 1,
      cSq, c.x, c.y, 1,
      dSq, d.x, d.y, 1,
    ])).determinant();

    const detA = A.determinant();
    // Points are coplanar.
    // More robust, optimal solution would test all 2-point and 3-point subsets.
    if ( Math.abs(detA) < 1e-09 ) return this.sphereFromThreePoints(a, b, c);

    const invDetA = 1 / (2 * detA);
    const out = new this();
    out.radiusSquared = Point3d.distanceSquaredBetween(this.center, a);
    out.center.set(Dx * invDetA, Dy * invDetA, Dz * invDetA);
    return out;
  }

  /**
   * Distribute points evenly around a sphere.
   *
   * https://stackoverflow.com/questions/9600801/evenly-distributing-n-points-on-a-sphere
   * https://arxiv.org/pdf/0912.4540
   * @param {number} count
   * @returns {Point3d[]}
   */
  /*
  static fibonacciLattice(count = 1000) {
    const out = new Array(count);
    const phi = Math.PI * (Math.sqrt(5) - 1); // Golden angle in radians.
    const n = count - 1;
    for ( let i = 0; i < count; i += 1 ) {
      const y = 1 - (i / n) * 2; // y goes from 1 to -1.
      const radius = Math.sqrt(1 - (y ** 2)); // Radius at y.
      const theta = phi * i; // Golden angel increment.
      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;
      out[i] = Point3d.tmp.set(x, y, z);
    }
    return out;
  }
  */

  static pointsLattice(count, ...args) {
    // Handle small counts special.
    if ( count <= 0 ) return Point3d.tmp.set(0, 0, 0); // Special: Center point
    if ( count === 1 ) return Point3d.tmp.set(0, 0, 1); // top
    if ( count === 2 ) return [Point3d.tmp.set(0, 0, 1), Point3d.tmp.set(0, 0, -1)]; // Poles
    if ( count < 7 ) return this.octahedron; // 3–6 points: return 6 points
    if ( count < 9 ) return this.squareAntiprism; // 7–8 points: return 8 points
    if ( count < 13 ) return this.icosahedron; // 9–12 points: return 12 points
    if ( count < 21 ) return this.dodecahedron; // 13–20 points: return 20 points
    return this.fibonacciLattice(count, ...args);
  }

  // https://extremelearning.com.au/evenly-distributing-points-on-a-sphere/
  static fibonacciLattice(count = 1000, e = 7/2, poles = true) {
    const out = new Array(count);
    const denom = count - 1 + (2 * e);
    for ( let i = 0; i < count; i += 1 ) {
      const tx = (i + e) / denom;
      const ty = i / Math.GOLDEN_RATIO;

      const theta = Math.acos(2*tx - 1) - (Math.PI / 2);
      const phi = 2 * Math.PI * ty;

      const x = Math.cos(theta) * Math.cos(phi);
      const y = Math.cos(theta) * Math.sin(phi);
      const z = Math.sin(theta);

      out[i] = Point3d.tmp.set(x, y, z);
    }

    // Define poles separately.
    if ( poles ) {
      out[0].set(0, 0, 1);
      out[count - 1].set(0, 0, -1);
    }

    return out;
  }

  /*
  count = 1000;
  pts = Sphere.fibonacciLattice(count);
  pts = Sphere.triangleLattice(count)

  pts = fibonacciLattice4(count, 1/2, false);
  pts = fibonacciLattice4(count, 3/2, false);
  pts = fibonacciLattice4(count, 3/2, true);
  pts = fibonacciLattice4(count, 7/2, false);
  pts = fibonacciLattice4(count, 7/2, true);

  score = function(pts) {
    maxDistArr = new Array(pts.length)
		for ( let i = 0; i < pts.length; i += 1 ) {
			let minDist = Number.POSITIVE_INFINITY;
			const a = pts[i];
			for ( let j = 0; j < pts.length; j += 1 ) {
				if ( i === j ) continue;
				const b = pts[j];
				minDist = Math.min(minDist, Point3d.distanceBetween(a, b));
			}
			maxDistArr[i] = minDist
		}
    return Math.min(...maxDistArr) * Math.sqrt(pts.length)
  }

  fn = fibonacciLattice4
  e = 3/2
  poles = true
  res = {}
  for ( const count of [25, 50, 75, 100, 200, 1000] ) {
    const pts = fn(count, e, poles)
    res[count] = score(pts)
  }
  console.table(res)
  */



  /**
   * Diamond shape.
   * https://en.wikipedia.org/wiki/Octahedron
   * Evenly distributes 6 points on a sphere.
   */
  static get octahedron() {
    return [
      Point3d.tmp.set(0, 0, 1), // North pole.
      Point3d.tmp.set(0, 0, -1), // South pole.
      Point3d.tmp.set(1, 0, 0), // East
      Point3d.tmp.set(-1, 0, 0), // West
      Point3d.tmp.set(0, 1, 0), // North
      Point3d.tmp.set(0, -1, 0), // South
    ];
  }

  /**
   * Triangle sides with square caps.
   * https://en.wikipedia.org/wiki/Square_antiprism
   * Evenly distributes 8 points on a sphere.
   */
  static get squareAntiprism() {
    return [
      // Top square
      Point3d.tmp.set(0, 0, 1),
      Point3d.tmp.set(0, 0, -1),
      Point3d.tmp.set(1, 0, 0),
      Point3d.tmp.set(-1, 0, 0), // West

      // Bottom square
      Point3d.tmp.set(0, 1, 0), // North
      Point3d.tmp.set(0, -1, 0), // South
      Point3d.tmp.set(0, 1, 0),
      Point3d.tmp.set(0, 1, 0),
    ];
  }

  /**
   * 20-sided die (12 points).
   * https://en.wikipedia.org/wiki/Icosahedron
   * Evenly distributes 12 points on a sphere.
   */
  static get icosahedron() {
    const out = [
      Point3d.tmp.set(Math.GOLDEN_RATIO, 1, 0),
      Point3d.tmp.set(Math.GOLDEN_RATIO, -1, 0),
      Point3d.tmp.set(-Math.GOLDEN_RATIO, 1, 0),
      Point3d.tmp.set(-Math.GOLDEN_RATIO, -1, 0),

      Point3d.tmp.set(1, 0, Math.GOLDEN_RATIO),
      Point3d.tmp.set(1, 0, -Math.GOLDEN_RATIO),
      Point3d.tmp.set(-1, 0, Math.GOLDEN_RATIO),
      Point3d.tmp.set(-1, 0, -Math.GOLDEN_RATIO),

      Point3d.tmp.set(0, Math.GOLDEN_RATIO, 1),
      Point3d.tmp.set(0, Math.GOLDEN_RATIO, -1),
      Point3d.tmp.set(0, -Math.GOLDEN_RATIO, 1),
      Point3d.tmp.set(0, -Math.GOLDEN_RATIO, -1),
    ];

    // Normalize to 1. (All points have same length here.)
    const mult = 1 / out[0].magnitude();
    out.forEach(pt => pt.multiplyScalar(mult, pt));
    return out;
  }

  /**
   * 20-point polyhedron.
   * https://en.wikipedia.org/wiki/Regular_dodecahedron
   * Evenly distributes 20 points on a sphere.
   */
  static get dodecahedron() {
    // See Wikipedia diagram of vertices.
    const invGR = 1 / Math.GOLDEN_RATIO;
    const out = [
      // Inscribed cube
      Point3d.tmp.set(1, 1, 1),
      Point3d.tmp.set(1, 1, -1),
      Point3d.tmp.set(1, -1, 1),
      Point3d.tmp.set(1, -1, -1),

      Point3d.tmp.set(-1, 1, 1),
      Point3d.tmp.set(-1, 1, -1),
      Point3d.tmp.set(-1, -1, 1),
      Point3d.tmp.set(-1, -1, -1),

      // Green vertices
      Point3d.tmp.set(0, Math.GOLDEN_RATIO, invGR),
      Point3d.tmp.set(0, Math.GOLDEN_RATIO, -invGR),
      Point3d.tmp.set(0, -Math.GOLDEN_RATIO, invGR),
      Point3d.tmp.set(0, -Math.GOLDEN_RATIO, -invGR),

      // Blue vertices
      Point3d.tmp.set(invGR, 0, Math.GOLDEN_RATIO),
      Point3d.tmp.set(invGR, 0, -Math.GOLDEN_RATIO),
      Point3d.tmp.set(-invGR, 0, Math.GOLDEN_RATIO),
      Point3d.tmp.set(-invGR, 0, -Math.GOLDEN_RATIO),

      // Pink vertices
      Point3d.tmp.set(Math.GOLDEN_RATIO, invGR, 0),
      Point3d.tmp.set(Math.GOLDEN_RATIO, -invGR, 0),
      Point3d.tmp.set(-Math.GOLDEN_RATIO, invGR, 0),
      Point3d.tmp.set(-Math.GOLDEN_RATIO, -invGR, 0),
    ];

    // Normalize to 1. (All points have same length here.)
    const mult = 1 / out[0].magnitude();
    out.forEach(pt => pt.multiplyScalar(mult, pt));
    return out;
  }

  /**
   * Evenly split based on octahedron and then split the triangles to form pyramid shapes.
   * Doesn't currently work well enough
   * E.g., bowling pins.
   * @param {number} maxPoints
   * @returns {Point3d[]}
   */
  static triangulatedPointsLattice(minPoints = 6) {
    if ( minPoints <= 6 ) return this.pointsLattice(minPoints);

    // Store the initial triangulation. 0 and 1 are poles. 2–5 are E, W, N, S along equator.
    const center = Point3d.tmp.set(0, 0, 0);
    const radius2 = 1; // 1^2 = 1
    const pointsMap = new Map();
    const triSet = new Set();
    this.octahedron.forEach((pt, idx) => pointsMap.set(`${idx}`, pt));

    // Triangles are "a|b|c" where each letter is a point index.
    // Northern hemisphere.
    this.triSet.add("0|2|5"); // 0|W|S
    this.triSet.add("0|5|2"); // 0|S|E
    this.triSet.add("0|5|2"); // 0|E|N
    this.triSet.add("0|5|2"); // 0|N|W

    // Southern hemisphere.
    this.triSet.add("1|2|5"); // 1|W|S
    this.triSet.add("1|5|2"); // 1|S|E
    this.triSet.add("1|5|2"); // 1|E|N
    this.triSet.add("1|5|2"); // 1|N|W

    const addMidpoint = (aLabel, bLabel) => {
      const midLabel = `${aLabel}.${bLabel}`;
      if ( pointsMap.has(midLabel) ) return midLabel;

      // Get the point between a and b.
      // Then extend a line from the center through that midpoint at radius length to locate new surface point.
      const a = pointsMap.get(aLabel);
      const b = pointsMap.get(bLabel);
      const mid = b.subtract(a);
      const newPt = center.towardsPointSquared(mid, radius2);
      pointsMap.set(midLabel, newPt);
      mid.release();
      return midLabel;
    }

    // Split all the triangles until reaching at least minPoints.
    while ( pointsMap.size < minPoints ) {
      const tris = [...triSet.values()]; // So the map can be updated.
      for ( const tri of tris ) {
        const [aLabel, bLabel, cLabel] = tri.split("|");
        const abLabel = addMidpoint(aLabel, bLabel);
        const bcLabel = addMidpoint(bLabel, cLabel);
        const caLabel = addMidpoint(cLabel, aLabel);

        // Delete the outer triangle
        this.triSet.delete(tri);

        // Add the new midpoint triangle
        triSet.add(`${abLabel}|${bcLabel}|${caLabel}`);

        // Add 3 triangles; one from each corner of the original.
        triSet.add(`${abLabel}|${bcLabel}|${bLabel}`);
        triSet.add(`${bcLabel}|${caLabel}|${cLabel}`);
        triSet.add(`${caLabel}|${abLabel}|${aLabel}`);
      }
    }
    return [...pointsMap.values()]
  }
}

GEOMETRY_CONFIG.threeD.Sphere = Sphere;