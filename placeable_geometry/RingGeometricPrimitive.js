/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Geometry
import { HoledPrimitive } from "./HoledGeometricPrimitive.js";
import { CircularCylinderPrimitive } from "./InstancedGeometricPrimitive.js";

/**
 * A RingPrimitive can represent a 3d extruded ring: a circle with a possible hole
 * Represents it as 1 or 2 pieces: the solid circle and the hole.
 * Unlike with the typical combined primitive, here the combined primitive matrix is primary.
 */
export class RingPrimitive extends HoledPrimitive {

  // ----- NOTE: Static factory methods ----- //

  /**
   * Ring built from two circles: solid + hole.
   * Rings are, at the moment, always circles.
   * @param {string} id
   * @returns {RingPrimitive}
   */
  static create(id) {
    const solid = new CircularCylinderPrimitive(`${id}_solid`);
    const hole = new CircularCylinderPrimitive(`${id}_hole`);
    solid.initialize();
    hole.initialize();
    hole.prototypeFaces.forEach(f => f.reverseOrientation())
    const out = new this(id, solid, [hole]);
    out.initialize();
    return out;
  }

    /**
   * Get the 2d polygon canvas representation of this shape, usually based on the bottom shape.
   * Assumes no rotation around the x or y axis.
   * @returns {PIXI.Polygon}
   */
  toPIXIShape() { return this.solid.toPIXIShape(); }

    // ----- NOTE: Faces ----- //

  /** @type {Polygon3d[]} */
  get bottomFaces() {
    return this.solid.bottomFaces;
  }

  /** @type {Polygon3d[]} */
  get topFaces() {
    return this.solid.topFaces;
  }

  /** @type {Polygon3d[]} */
  get sideFaces() {
    return this.solid.sideFaces;
  }

}
