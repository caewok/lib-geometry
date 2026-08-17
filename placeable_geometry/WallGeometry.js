/* globals
CONST,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Geometry
import { PlaceableGeometry } from "./PlaceableGeometry.js";
import { VerticalQuadPrimitive } from "./InstancedGeometricPrimitive.js";

// LibGeometry
import { Point3d } from "../3d/Point3d.js";
import { Segment } from "../Segment.js";

const TRACKER_TYPES = {
  position2d: [
    "c",
  ],
  elevation: [
    "flags-wall-height.top",
    "flags.wall-height.bottom",
  ],
  direction: [
    "dir",
  ],
  level: [
    "levels",
  ],

  // Currently don't need restriction, door, or threshold; Handled by obstacle occlusion tracking.
  restriction: [
    "light",
    "move",
    "sight",
    "sound",
  ],
  door: [
    "door",
    "ds",
  ],
  threshold: [
    "threshold.attenuation",
    "threshold.light",
    "threshold.sight",
    "threshold.sound",
  ],
};

export class WallGeometry extends PlaceableGeometry {

  /** @type {string} */
  static PLACEABLE_NAME = "Wall";

  /** @type {string} */
  static LAYER = "walls";

  static UPDATE_KEYS = {
    ...super.UPDATE_KEYS,
    properties: new Set(TRACKER_TYPES.direction),
    position2d: new Set(TRACKER_TYPES.position2d),
    elevation: new Set(TRACKER_TYPES.elevation),
    level: new Set(TRACKER_TYPES.level),
  };


  // ----- NOTE: Wall Segments ----- //

  get edge() {
    if ( !this.wall ) {
      // See foundry.js #createEdge
      const wallD = this.placeableDocument;
      let { c, id, light, sight, sound, move, dir: direction, threshold } = wallD;
      if ( wallD.isOpen ) light = sight = sound = move = CONST.WALL_SENSE_TYPES.NONE;
      const dpx = this.scene.dimensions.distancePixels;
      return new foundry.canvas.geometry.edges.Edge({ x: c[0], y: c[1] }, { x: c[2], y: c[3] }, {
        id: `wall.${id}`,
        type: "wall",
        object: null,
        direction,
        light,
        sight,
        sound,
        move,
        threshold: {
          light: threshold.light * dpx,
          sight: threshold.sight * dpx,
          sound: threshold.sound * dpx,
          attenuation: threshold.attenuation
        }
      });
    }
    if ( !this.wall.edge ) this.wall.initializeEdge();
    return this.wall.edge;
  }

  initialize() {
    this.createShapes();
    super.initialize();
  }

  createShapes() {
    // Reset the wall shapes.
    // Walls are made up of multiple vertical quads, spanning the defined wall segments.
    const shapes = this.shapes;
    shapes.forEach(shape => shape.destroy());
    this.shapes.length = 1;
    this.shapes[0] = new VerticalQuadPrimitive(this.placeableId);
  }

  _updateShapePosition() {
    // Wall properties
    const wallD = this.placeableDocument;
    using ctr2d = this.constructor.wallCenter(wallD);
    const rotZ = this.constructor.wallAngle(wallD)
    const lengthXY = this.constructor.wallLength(wallD);
    const { topZ, bottomZ } = this.elevationZ;
    const zHeight = topZ - bottomZ;

    using center3d = Point3d.tmp.set(ctr2d.x, ctr2d.y, 0);
    using angles = Point3d.tmp.set(0, 0, rotZ);
    const shape = this.shapes[0]; // Walls contain only a single shape.
    shape.setPosition(center3d);
    shape.setRotation(angles);
    shape.setDims({ lengthXY, zHeight });
  }

  _updateShapeDirection() {
    const dir = this.placeableDocument.dir;
    this.shapes[0].direction = dir;
  }

  // ----- NOTE: Updating ----- //

  _update() {
    if ( this._updateFlags.positionXY || this._updateFlags.elevation ) this._updateShapePosition();
    if ( this._updateFlags.properties ) this._updateShapeDirection();
    super._update();
  }

  // ----- NOTE: Levels ----- //

  /**
   * Does this geometry currently block a given sense type?
   * @param {CONST.WALL_RESTRICTION_TYPES} [senseType="sight"]
   * @returns {boolean}
   */
  blocksSense(senseType = "sight") {
    return this.placeableDocument[senseType] || this.placeableDocument.threshold[senseType];
  }

  // isPresentAtLevel // Handled by parent class.

  /**
   * Combines sense test with level test with any other tests specific to the placeable document.
   * @param {object} [opts]
   * @prop {CONST.WALL_RESTRICTION_TYPES} [opts.senseType = "sight"]
   * @prop {string} [opts.levelId]
   * @prop {...}                      Other options used by subclasses
   * @returns {boolean}
   */
  static couldBlock(placeableDocument, opts) {
    if ( placeableDocument.isOpen ) return false;
    return super.couldBlock(opts);
  }

  // ----- NOTE: Wall characteristics ----- //

  /**
   * Create 2d segment points from a wall document.
   * @param {WallDocument} wallD
   * @returns {Segment}
   * - @prop {PIXI.Point} a
   * - @prop {PIXI.Point} b
   */
  static wallSegment2d(wallD) {
    const [ax, ay, bx, by] = wallD.c;
    return new Segment(
      PIXI.Point.tmp.set(ax, ay),
      PIXI.Point.tmp.set(bx, by),
    );
  }

  /**
   * Determine the 2d center point of the edge.
   * @param {WallDocument} wallD
   * @returns {PIXI.Point}
   */
  static wallCenter(wallD) {
    using s = this.wallSegment2d(wallD);
    return s.midpoint;
  }

  /**
   * Determine the 2d length of the edge.
   * @param {WallDocument} wallD
   * @returns {number}
   */
  static wallLength(wallD) {
    using s = this.wallSegment2d(wallD);
    return s.length;
  }

  /**
   * Angle of the edge on the 2d canvas.
   * @param {WallDocument} edge
   * @returns {number} Angle in radians
   */
  static wallAngle(wallD) {
    using s = this.wallSegment2d(wallD);
    return s.angleXY;
  }

  /**
   * Is this a terrain (limited) edge?
   * @param {WallDocument} wallD
   * @returns {boolean}
   */
  static isTerrain(wallD, { senseType = "sight" } = {}) {
    return wallD[senseType] === CONST.EDGE_SENSE_TYPES.LIMITED;
  }

  /**
   * Is this a directional edge?
   * @param {WallDocument} wallD
   * @returns {boolean}
   */
  static isDirectional(wallD) { return Boolean(wallD.dir); }

}
