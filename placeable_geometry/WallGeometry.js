/* globals
CONST,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Geometry
import { PlaceableGeometry, LevelSpanningMixin } from "./PlaceableGeometry.js";
import { VerticalQuadPrimitive } from "./InstancedGeometricPrimitive.js";

// LibGeometry
import { Point3d } from "../3d/Point3d.js";
import { Segment } from "../Segment.js";

import { mix } from "../mixwith.js";

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


/* Walls split by levels.
WallGeometry:
User-facing geometry. Holds 1+ level segment walls split at distinct elevations.

WallLevelSegmentGeometry:
A wall segment representing a piece of a wall, with a given elevation range.
Has numeric id to track which segment it represents.

*/


  /* Foundry v14 levels
    In Foundry v14, walls can have 1+ assigned levels.
    Levels have a top/bottom range. Levels can overlap partially or entirely. Levels can have gaps.

    First, the wall will be defined per usual by its top and bottom elevation.

    Walls will then be split by level. Gaps get their own split, but no wall segment.
    Where levels overlap, each overlap gets its own split. Levels for splits will be stored
    in the faceLevels map.


    All splits are Quad3d, stored in a Polygon3d.

    It is assumed that if a token is on a level where the wall is not, associated wall portions
    will be ignored. Other wall portions remain present.

    E.g.,
    lvl 0        lvl1        lvl 2
    1      8    13       22  26   30
    •------•    •--------•   •----•
       •-----------•   •---•
       5           16  20  23
        lvl 0.5        lvl1.5

    Splits:
    1–5 | 5–8 | 8–13 | 13–16 | 16–20 | 20–22 | 22–23 | 23–26 | 26–30
     0    0,0.5 all    0.5,1    1      1, 1.5   1.5     all      2

    Assume the wall is in 0 and 1 but not elsewhere.
    Level 2 is easy: The wall prototype would not include 26–30.
    But now assume the token is in level 0.5.
    Ideally, the token would not see the wall portions for the level 0.5 span b/c the wall is not included there.
    But because the wall is in level 0 and 1, the prototype would include 1–8 and 13–22.
    Must get the token level in order to further exclude 5–8 and 13–16.

    The splits are the same for every wall in the scene. Only differences:
    - Start and end splits based on wall height if wall height module is present.
      For most scene, the number of distinct wall height elevations is likely limited; treat like level splits.
    - A wall can exclude levels, but this can be handled when defining the token level.
  */


export class WallGeometry extends mix(PlaceableGeometry).with(LevelSpanningMixin) {

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
    this._buildWallShapes();
    super.initialize();
  }

  _buildWallShapes() {
    // Reset the wall shapes.
    // Walls are made up of multiple vertical quads, spanning the defined wall segments.
    const shapes = this.shapes;
    shapes.forEach(shape => shape.destroy());

    const levelSegments = this.constructor.levelSegments;
    const numSegments = levelSegments.length;
    shapes.length = numSegments;

    // Build a primitive shape only for level segments that this wall is present within.
    for ( let i = 0; i < numSegments; i += 1 ) {
      const segment = levelSegments[i];
      if ( !segment.ids.some(id => this.isPresentAtLevel(id)) ) continue;
      shapes[i] = new VerticalQuadPrimitive(this._levelShapeId(i));
    }
  }

  _updateShapePositions() {
    // Wall properties
    const wallD = this.placeableDocument;
    using ctr2d = this.constructor.wallCenter(wallD);
    const rotZ = this.constructor.wallAngle(wallD)
    const lengthXY = this.constructor.wallLength(wallD);
    const { topZ, bottomZ } = this.elevationZ;

    using center3d = Point3d.tmp.set(ctr2d.x, ctr2d.y, 0);
    using angles = Point3d.tmp.set(0, 0, rotZ);

    for ( let i = 0, iMax = this.shapes.length; i < iMax; i += 1 ) {
      const shape = this.shapes[i];
      if ( !shape ) continue;

      // Account for walls that do not span the entire segment.
      const zElevs = this.constructor.elevationZForSegment(i, topZ, bottomZ);
      const { z, zHeight } = this.constructor.zDimensions(zElevs.topZ, zElevs.bottomZ);
      center3d.z = z;

      shape.setPosition(center3d);
      shape.setRotation(angles);
      shape.setDims({ lengthXY, zHeight });
    }
  }

  _updateShapeDirections() {
    const dir = this.placeableDocument.dir;
    this.shapes.forEach(shape => {
      if ( !shape ) return;
      shape.direction = dir;
    });
  }


  // ----- NOTE: Updating ----- //

  _update() {
    // TODO: Only initialize if the segments changed.
    //       Handle level changes separately, by rebuilding as needed without updating class's wall segments.
    if ( this._updateFlags.elevation || this._updateFlags.level ) {
      this.initialize();
      this._updateFlags.positionXY = true;
      this._updateFlags.properties = true;
    }

    if ( this._updateFlags.positionXY ) this._updateShapePositions();
    if ( this._updateFlags.properties ) this._updateShapeDirections();
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
