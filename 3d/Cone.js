/* globals
CONST,
PIXI,
*/
"use strict";

import { GEOMETRY_CONFIG } from "../const.js";
import { Circle3d } from "./Polygon3d.js";
import { Point3d } from "./Point3d.js";
import { AABB3d } from "../AABB.js";
import { Plane } from "./Plane.js";
import { almostLessThan } from "../util.js";
import { gridUnitsToPixels } from "../util.js";

/* Cone
Represent a 3d cone, with some functions to manipulate it.
*/

export class Cone {

  /** @type {Point3d} */
  origin = new Point3d(); // The "tip" of the cone.

  /** @type {Point3d} */
  direction = new Point3d(); // Normal of the cone from the origin perpendicular to the base

  /** @type {number} */
  height = 0; // Distance from the tip to the base.

  /** @type {number} */
  radius = 0; // Radius of the circular base.



  /* ----- Static factory methods ----- */

  static fromTemplate(t) {
    if ( t.document.t !== CONST.MEASURED_TEMPLATE_TYPES.CONE ) console.warn(`Template ${t.document.t} is not a cone.`);
    const cone = new this();
    cone.origin.set(t.document.x, t.document.y, t.elevationZ);
    cone.height = gridUnitsToPixels(t.document.distance);
    const rad = Math.toRadians(t.document.angle);
    cone.radius = Math.tan(rad) * cone.height; // tan ø = opp / adj

    // Normal of the cone from the origin perpendicular to the base
    const baseCenter = Point3d.fromAngle(cone.origin, rad, cone.height);
    baseCenter.subtract(cone.origin, cone.direction);
    cone.direction.normalize(cone.direction);
  }


  /** @type {object<min: Point3d, max: Point3d>} */
  #aabb = new AABB3d();

  get aabb() {
    const baseCenter = Point3d.tmp;
    this.origin.add(this.direction.multiplyScalar(this.height, baseCenter), baseCenter);

    this.#aabb = AABB3d.fromPoints([this.origin, baseCenter]);

    // Determine the bounding box of the circular base.
    const plane = this.basePlane;
    const circle3d = Circle3d.fromPlanarCircle(new PIXI.Circle(plane.point, this.radius), plane);
    const cirAABB = AABB3d.fromCircle3d(circle3d);
    this.#aabb.union([cirAABB], this.#aabb);
    baseCenter.release();
    return this.#aabb;
  }

  /** @type {Plane} */
  get basePlane() {
    const baseCenter = Point3d.tmp;
    this.origin.add(this.direction.multiplyScalar(this.height, baseCenter), baseCenter);
    return new Plane(baseCenter, this.direction);
  }

  /**
   * Test if the point is contained in the cone.
   * Does not check bounding box, although one might to check that separately.
   * @param {Point3d} pt
   * @returns {boolean}
   */
  containsPoint(pt) {
    const vecToPoint = pt.subtract(this.origin);
    const axisProj = vecToPoint.dot(this.direction);

    // Check if the point is between the tip and the base plane
    if (axisProj < 0 || axisProj > this.height) {
      vecToPoint.release();
      return false;
    }

    const radiusAtProjection = (axisProj / this.height) * this.radius;
    const distSqFromAxis = vecToPoint.magnitudeSquared() - (axisProj ** 2);
    vecToPoint.release();
    return distSqFromAxis <= (radiusAtProjection ** 2);
  }

  get _cosThetaSquared() { return (this.height ** 2) / ((this.height ** 2) + (this.radius ** 2)); }

  /**
   * Solves the quadratic equation for a line-cone intersection.
   *
   */
  _segmentIntersections(p0, p1, cosThetaSq) {
    cosThetaSq ??= this.cosThetaSquared;
    const out = [];
    const d = p1.subtract(p0);
    const s0 = p0.subtract(this.tip);
    const A = this.direction;

    const dotDA = d.dot(A);
    const dotS0A = s0.dot(A);
    const dotS0D = s0.dot(d);
    const dotDD = d.magnitudeSquared();
    const dotS0S0 = s0.magnitudeSquared();
    s0.release();

    const a = (dotDA ** 2) - (dotDD * cosThetaSq);
    const b = 2 * ((dotDA * dotS0A) - (dotS0D * cosThetaSq));
    const c = (dotS0A ** 2) - (dotS0S0 * cosThetaSq);

    // Solve quadratic equation a*t^2 + b*t + c = 0
    const discriminant = (b ** 2) - (4 * a * c);
    if ( almostLessThan(discriminant, 0) ) {
      d.release();
      return out; // No real intersection with infinite cone
    }

    const sqrtDiscriminant = Math.sqrt(discriminant);
    const t1 = (-b + sqrtDiscriminant) / (2 * a);
    const t2 = (-b - sqrtDiscriminant) / (2 * a);

    // Check if either intersection point 't' is on the segment [0, 1]
    // and within the finite height of the cone.
    const checkT = t => {
      if (t >= 0 && t <= 1) {
        const intersectionPoint = p0.add(d.multiplyScalar(t));
        const vecToIntersection = intersectionPoint.subtract(this.tip);
        const heightProj = vecToIntersection.dot(A);
        intersectionPoint.release();
        vecToIntersection.release();
        return heightProj >= 0 && heightProj <= this.height;
      }
      return false;
    };

    if ( checkT(t1) ) out.push(t1);
    if ( checkT(t2) ) out.push(t2);
    d.release();
    return out;
  }

  segmentIntersects(p0, p1, cosThetaSq) {
    return this._segmentIntersects(p0, p1, cosThetaSq).length;
  }

  segmentIntersections(p0, p1, cosThetaSq) {
    const dir = p1.subtract(p0);
    const out = this._segmentIntersects(p0, p1, cosThetaSq).map(t => {
      const ix = Point3d.tmp;
      p0.add(dir.multiplyScalar(t, ix), ix);
      ix.t0 = t;
      return ix;
    });
    dir.release();
    return out;
  }
}

GEOMETRY_CONFIG.threeD.Cone = Cone;
