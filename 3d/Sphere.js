/* globals
PIXI,
*/
"use strict";

import { GEOMETRY_CONFIG } from "../const.js";
import { Polygon3d, Circle3d } from "./Polygon3d.js";
import { Point3d } from "./Point3d.js";
import { MatrixFlat } from "../MatrixFlat.js";
import { AABB3d } from "../AABB.js";
import { gridUnitsToPixels, almostGreaterThan, almostLessThan } from "../util.js";

/* Sphere
Represent a 3d sphere, with some functions to manipulate it.
*/

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
  #aabb = new AABB3d();

  get aabb() {
    const { center, radius } = this;
    this.#aabb.min.set(center.x - radius, center.y - radius, center.z - radius);
    this.#aabb.max.set(center.x + radius, center.y + radius, center.z + radius);
    return this.#aabb;
  }

  containsPoint(pt, epsilon = 1e-06) {
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
      const inside = this.containsPoint(pt);
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
   * Intersect this sphere with a planar polygon.
   * @param {Polygon3d} poly3d
   * @returns {Polygon3d|Circle3d|Point3d|null}
   */
  intersectPolygon3d(poly3d) {
    if ( poly3d.overlapsClass("Circle3d") ) return this.intersectCircle3d(poly3d);
    let allInside = true;
    let allOutside = true;
    for ( const pt of poly3d.iteratePoints({ close: false }) ) {
      const inside = this.containsPoint(pt);
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
   * Test if a segment intersects the sphere.
   * Optionally count if the sphere contains the segment.
   * @param {Point3d} a
   * @param {Point3d} b
   * @param {object} [opts]
   * @param {boolean} [opts.inside=false]
   */
  lineSegmentIntersects(a, b, { inside = false } = {}) {
    if ( inside && (this.containsPoint(a) || this.containsPoint(b)) ) return true;
    const d = b.subtract(a);
    const ts = this._segmentIntersections(a, d);
    d.release();
    return ts.length;
  }

  segmentIntersections(a, b) {
    const d = b.subtract(a);
    const ts = this._segmentIntersections(a, d);
    const out = ts.map(t => {
      const pt = a.add(d.multiplyScalar(t));
      pt.t0 = t;
    });
    d.release();
    return out;
  }

  _segmentIntersections(p1, d) {
    const oc = p1.subtract(this.center);

    // Solve the quadratic equation at^2 + bt + c = 0
    // a = d • d
    // b = 2 * (oc • d)
    // c = oc • oc - r^2
    const a = d.dot(d);
    const b = 2 * (oc.dot(d));
    const c = oc.dot(oc) - (this.radiusSquared);

    // if the discriminant is negative, there are no real roots and no intersection.
    const disc = (b * b) - (4 * a * c);
    if ( disc < 0 ) {
      oc.release();
      return [];
    }

    // Calculate the two potential solutions for t
    const ts = [];
    const sqrtDisc = Math.sqrt(disc);
    const t1 = (-b - sqrtDisc) / (2 * a);
    const t2 = (-b + sqrtDisc) / (2 * a);

    // Check if t1 corresponds to a point on the segment [p1, p2]
    if ( almostGreaterThan(t1, 0) && almostLessThan(t1, 1) ) ts.push(t1);

    // Check if t2 corresponds to a point on the segment [p1, p2]
    // Avoid adding the same point twice if the line is tangent (discriminant is 0)
    if ( disc > 0 && almostGreaterThan(t2, 0) && almostLessThan(t2, 1) ) ts.push(t2);
    oc.release();
    return ts;
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
    const newSphere = sphere.containsPoint(p) ? sphere : this._welzlRecursive(P, [...R, p]);
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

  static fromTemplate(t) {
    const sphere = new this();
    sphere.center.set(t.x, t.y, t.elevationZ);
    sphere.radius = gridUnitsToPixels(t.document.distance);
    return sphere;
  }
}

GEOMETRY_CONFIG.threeD.Sphere = Sphere;