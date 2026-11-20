/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Geometry
import { ExtrudedPolygonPrimitive } from "./ModelGeometricPrimitive.js";

// LibGeometry
import { Segment } from "../Segment.js";
import { GEOMETRY_LIB_ID } from "../const.js";

const origin2d = new PIXI.Point(0, 0);
Object.freeze(origin2d);

/**
 * A ConePrimitive can represent a 3d extruded cone that is either flat, round, or semicircular.
 * Made up of a triangle base and arc shape, if any.
 */
export class ConePrimitive extends ExtrudedPolygonPrimitive {

  /** @type {string} */
  static TYPE = "ConePrimitive";

  /** @type {string[]} */
  static TYPE_HIERARCHY = [this.TYPE, ...super.TYPE_HIERARCHY ];

  /** @type {"flat"|"round"|"semicircle"} */
  curvature = "flat";

  /** @type {number<degrees>} */
  angle = 0; // Angle of the cone at the apex.

  /**
   * Get the 2d polygon canvas representation of this shape, usually based on the bottom shape.
   * Assumes no rotation around the x or y axis.
   * @returns {PIXI.Polygon}
   */
  toPIXIShape() {
    const polys2d = this.children.map(child => child.toPIXIShape());
    if ( polys2d.length === 1 ) return polys2d[0];
    const ClipperPaths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths;
    return ClipperPaths.unionPolygons(polys2d);
  }

  // ----- NOTE: Static factory methods ----- //

  /**
   * Cone built from a single triangle or a triangle + arc or half-circle.
   */
  static create(id, angle, { curvature = "rounded", density } = {}) {
    const rotation = 0;
    const theta = Math.toRadians(angle);
    const radius = 1;
    const conePoly = this.construct2dConeShape(origin2d, radius, theta, rotation, curvature, density);
    const out = this.fromPrototypePolygon(id, conePoly, { density });
    out.curvature = curvature;
    out.angle = angle;
    return out;
  }

  /**
   * Build a 2d cone shape per FoundryVTT rules.
   * @param {Point2d} apex            Origin of the cone
   * @param {number} radius           Distance from apex along center of cone to the curve, in pixel units
   * @param {number} theta            Angle of the cone, in radians
   * @param {number} rotation         Rotation of the cone, in radians
   * @returns {PIXI.Polygon}
   */
  static construct2dConeShape(apex, radius, theta, rotation, curvature = "flat", density = 0) {
    let arcCircle;
    let arcStartAngle;
    let arcEndAngle;
    switch ( curvature ) {
      case "flat": {
        const base = this.flatConeBase(apex, radius, theta, rotation)
        const poly = new PIXI.Polygon(apex, base.a, base.b);
        base.release();
        return poly;
      }

      case "round":
        arcCircle = this.roundConeCircle(apex, radius, theta, rotation);
        arcStartAngle = Math.normalizeRadians(-Math.PI_1_2 + rotation);
        arcEndAngle = Math.normalizeRadians(Math.PI_1_2 + rotation);
        break;

      case "semicircle":
        arcCircle = this.semiCircleConeCircle(apex, radius, theta, rotation);
        arcStartAngle = Math.normalizeRadians(-Math.PI_1_2 + rotation);
        arcEndAngle = Math.normalizeRadians(Math.PI_1_2 + rotation);
        break;

      default: throw new Error("Cone type not recognized.");
    }

    // Construct the arc polygon.
    density ||= PIXI.Circle.approximateVertexDensity(canvas.grid.size * 2);
    const arcPoints = arcCircle.pointsForArc(arcStartAngle, arcEndAngle, { density, includeEndpoints: true });
    const coneShape = new PIXI.Polygon(apex, ...arcPoints);
    return coneShape;
  }

  // ----- NOTE: Math helpers ----- //

  /**
   * Base points for a flat cone.
   * @param {PIXI.Point} apex         Origin (top point) of the cone
   * @param {number} radius           Radius of the cone arc
   * @param {number} theta            Cone angle, in radians
   * @param {number} [rotation=0]     Cone rotation, in radians
   * @returns {Segment}
   */
  static flatConeBase(apex, radius, theta, rotation = 0) {
    // Find the length of a leg.
    const halfAngle = theta / 2;
    const sideLength = radius / Math.cos(halfAngle); // Hypotenuse

    // Project the base points using the side length and angles.
    const b = apex.fromAngle(rotation - halfAngle, sideLength);
    const c = apex.fromAngle(rotation + halfAngle, sideLength);
    return new Segment(b, c);
  }

  /**
   * Base points for a semicircle cone.
   * @param {PIXI.Point} apex         Origin (top point) of the cone
   * @param {number} radius           Radius of the cone arc
   * @param {number} theta            Cone angle, in radians
   * @param {number} [rotation=0]     Cone rotation, in radians
   * @returns {Segment}
   */
  static semiCircleConeBase(apex, totalLength, theta, rotation = 0) {
    // Find the length of a leg.
    // l = h / cos(theta / 2)
    const halfAngle = theta / 2;
    const h = totalLength / (1 + Math.tan(halfAngle));
    const sideLength = h / ( Math.cos(halfAngle));

    // Project the base points using the side length and angles.
    const a = apex.fromAngle(rotation - halfAngle, sideLength);
    const b = apex.fromAngle(rotation + halfAngle, sideLength);
    return new Segment(a, b);
  }

  /**
   * Base points for a round cone.
   * @param {PIXI.Point} apex         Origin (top point) of the cone
   * @param {number} radius           Radius of the cone arc
   * @param {number} theta            Cone angle, in radians
   * @param {number} [rotation=0]     Cone rotation, in radians
   * @returns {Segment}
   */
  static roundConeBase(apex, radius, theta, rotation) {
    const halfAngle = theta / 2;

    // Project a and b by the radius along the half angle.
    const a = apex.fromAngle(rotation - halfAngle, radius);
    const b = apex.fromAngle(rotation + halfAngle, radius);
    return new Segment(a, b);
  }


  /**
   * Get the circle shape the forms the round cone arc.
   * @param {PIXI.Point} apex         Origin (top point) of the cone
   * @param {number} radius           Radius of the cone arc
   * @returns {PIXI.Circle}
   */
  static roundConeCircle(apex, radius) { return new PIXI.Circle(apex.x, apex.y, radius); }

/* Round cone

                   ...---...
               .•'     |d    '•.  <-- Arc
              |------- C -------| <-- Base line
               \       |       /
                \      | h    /
                a\     |     /b
                  \    |    /
                   \   |   /  Total length t = h + d = a = b
                    \  |  /   Side length = l
                     \ | /    Cone Angle = φ
                       P (Apex)


*/


  /**
   * Get the circle shape the forms the semicircle cone arc.
   * @param {PIXI.Point} apex         Origin (top point) of the cone
   * @param {number} totalLength      Length from apex to the arc along the middle line of the cone
   * @param {number} theta            Cone angle, in radians
   * @param {number} [rotation=0]     Cone rotation, in radians
   * @returns {PIXI.Circle}
   */
  static semiCircleConeCircle(apex, totalLength, theta, rotation = 0 ) {
/*
                     .---.
                 . '       ' .
               /               \  <-- Half-circle arc
              |------- C -------| <-- Base line (Diameter = 2 * l * sin(φ/2))
               \       |       /
                \      | h    /
                 \     |     /
                  \    |    /
                   \   |   /  Total length t = h + r
                    \  |  /   Side length = l
                     \ | /    Cone Angle = φ
                       P (Apex)
*/
    // Base of cone is flat line segment that forms the diameter of the circle.
    // arc radius = h / 2 = l * sin(theta / 2)
    // Two straight sides of cone form isoceles triangle.
    // base length (h) = 2 * l * sin(theta / 2)
    // totalLength = h + radius
    // h = totalLength / (1 + tan(theta / 2))
    // cx = apex.x + h * cos(rotation)
    // cy = apex.y + h * sin(rotation)

    // tan = opp / adj
    // Math.tan(theta/2) = r / h
    // r = h * Math.tan(theta/2)
    // t = h + r
    // t = h + h *  Math.tan(theta/2) = h * (1 + Math.tan(theta/2))
    // h = t / (1 + Math.tan(theta/2))

    // Altitude of the triangle (distance from P to C).
    const halfAngle = theta / 2;
    const h = totalLength / (1 + Math.tan(halfAngle));

    // Radius of the half-circle arc
    const arcRadius = h * Math.tan(halfAngle);

    // Construct circle that creates the arc.
    const x = apex.x + (h * Math.cos(rotation));
    const y = apex.y + (h * Math.sin(rotation));
    return new PIXI.Circle(x, y, arcRadius)
  }
}