/* globals

PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Geometry
import { CombinedGeometricPrimitive } from "./CombinedGeometricPrimitive.js";
import { ExtrudedPolygonPrimitive } from "./ModelGeometricPrimitive.js";

// LibGeometry
import { Segment } from "../Segment.js";

/**
 * A ConePrimitive can represent a 3d extruded cone that is either flat, round, or semicircular.
 * Represents it as 1 or 2 pieces: the triangle base and arc shape, if any.
 */
export class ConePrimitive extends CombinedGeometricPrimitive {

  /** @type {"flat"|"round"|"semicircle"} */
  type = "flat";

  /** @type {number<radians>} */
  theta = 0; // Angle of the cone at the apex.

  /** @type {number} */
  radius = 0;

  // ----- NOTE: Static factory methods ----- //

  /**
   * Cone is built from extruded triangle + extruded arc.
   */
  static fromRegionShape(id, regionShape, { density, ...opts } = {}) {
    if ( regionShape.type !== "cone" ) throw Error("ConePrimitive|Only cone types may be used.", { regionShape });

    using apex = PIXI.Point.tmp.copyFrom(regionShape);
    const rotation = Math.toRadians(regionShape.rotation);
    const theta = Math.toRadians(regionShape.angle);
    const radius = regionShape.radius;
    density ??= PIXI.Circle.approximateVertexDensity(regionShape.radius);

    // Track shape parameters, primarily for debugging.
    const out = new this(id);
    out.type = regionShape.curvature;
    out.radius = radius;
    out.theta = theta;

    let baseSegment;
    let arcCircle;
    let arcStartAngle;
    let arcEndAngle;
    switch ( regionShape.curvature ) {
      case "flat":
        baseSegment = this.flatConeBase(apex, radius, theta, rotation);
        break;
      case "semicircle": {
        baseSegment = this.semiCircleConeBase(apex, radius, theta, rotation);
        arcCircle = this.semiCircleConeCircle(regionShape, regionShape.radius, theta, rotation);
        arcStartAngle = Math.normalizeRadians(-Math.PI_1_2 + rotation);
        arcEndAngle = Math.normalizeRadians(Math.PI_1_2 + rotation);
        break;
      }
      case "round": {
        baseSegment = this.roundConeBase(apex, radius, theta, rotation);
        arcCircle = this.roundConeCircle(regionShape, regionShape.radius);
        arcStartAngle = Math.normalizeRadians(-(theta / 2) + rotation);
        arcEndAngle = Math.normalizeRadians((theta / 2) + rotation)
      }
    }

    const triShape = ExtrudedPolygonPrimitive.fromPolygon(`baseTri_${id}`, new PIXI.Polygon(apex, baseSegment.a, baseSegment.b), opts);
    out.addShape(triShape);
    if ( regionShape.curvature === "flat" ) return out;

    // Build the extruded polygon arc piece.
    const arcPoints = arcCircle.pointsForArc(arcStartAngle, arcEndAngle, { density, includeEndpoints: false });
    const poly = new PIXI.Polygon(baseSegment.a, ...arcPoints, baseSegment.b);
    const arcShape = ExtrudedPolygonPrimitive.fromPolygon(`${regionShape.curvature}_${id}`, poly, opts);
    out.addShape(arcShape);
    return out;
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