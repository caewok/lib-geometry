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
import { GEOMETRY_LIB_ID } from "../const.js";

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

  // ----- NOTE: Faces ----- //

  /** @type {Polygon3d[]} */
  get bottomFaces() {
    const bottoms = [];
    for ( const child of this.children ) bottoms.push(...child.bottomFaces);
    return bottoms;
  }

  /** @type {Polygon3d[]} */
  get topFaces() {
    const tops = [];
    for ( const child of this.children ) tops.push(...child.topFaces);
    return tops;
  }

  /** @type {Polygon3d[]} */
  get sideFaces() {
    const sides = [];
    for ( const child of this.children ) sides.push(...child.topFaces);
    return sides;
  }


  // ----- NOTE: Static factory methods ----- //

  /**
   * Cone built from a single triangle or a triangle + arc or half-circle.
   * The default position is centered, with the apex at x = -0.5, y = 0 and the base vertical along x = 0.5
   */
  static create(id, angle, { type = "rounded", density = 0 } = {}) {
    let baseSegment;
    let arcCircle;
    let arcStartAngle;
    let arcEndAngle;
    const rotation = 0;
    const theta = Math.toRadians(angle);
    const radius = 1;
    using apex = PIXI.Point.tmp.set(-0.5, 0);
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

    const out = new this()

    const triShape = this._createTrianglePrimitive(`${id}_tri`, apex, baseSegment);
    out.addChild(triShape);
    if ( type === "flat" ) {
      triShape.initialize();
      out.initialize();
      return out;
    }

    // Build the extruded polygon arc piece.
    density ||= PIXI.Circle.approximateVertexDensity(canvas.grid.size * 2);
    const arcPoints = arcCircle.pointsForArc(arcStartAngle, arcEndAngle, { density, includeEndpoints: false });
    const poly = new PIXI.Polygon(baseSegment.a, ...arcPoints, baseSegment.b);
    const arcShape = ExtrudedPolygonPrimitive.fromPrototypePolygon(`${id}`, poly, { density });
    out.addChild(arcShape);

    // Drop the shared wall between the triangle and the arc.
    // First quad of the triangle shape is the base side.
    triShape.prototypeFaces.splice(2, 1); // Top and bottom polygon are indices 0 and 1, respectively.

    // Last side of the arc shape is the base side.
    arcShape.prototypeFaces.pop();

    triShape.initialize();
    arcShape.initialize();
    out.initialize();

    return out;
  }

  /**
   * Create a primitive for a flat cone.
   * Can call this directly to avoid unnecessary combination.
   * @param {number} angle      Angle of the apex of the triangle, in degrees.
   * @returns {ConePrimitive}
   */
  static createFlatPrimitive(id, angle) {
    using apex = PIXI.Point.tmp.set(-0.5, 0);
    const theta = Math.toRadians(angle);
    using baseSegment = this.flatConeBase(apex, 1, theta, 0);
    return this._createTrianglePrimitive(`${id}_tri`, apex, baseSegment, 0.5, -0.5);
  }

  static _createTrianglePrimitive(id, apex, baseSegment, topZ = 0.5, bottomZ = -0.5) {
    using a = Point3d.tmp.set(apex.x, apex.y, topZ);
    using b = Point3d.tmp.set(baseSegment.a.x, baseSegment.a.y, topZ);
    using c = Point3d.tmp.set(baseSegment.b.x, baseSegment.b.y, topZ);
    const top = Triangle3d.from3Points(a, b, c);
    const bottom = top.clone().setZ(bottomZ).reverseOrientation();
    const protoFaces = [bottom, top, top.buildTopSides(bottomZ)];
    return new ExtrudedPolygonPrimitive(`${id}_tri`, protoFaces);
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