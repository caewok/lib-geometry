/* globals
canvas,
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
import { pixelsToGridUnits, gridUnitsToPixels } from "../util.js";

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

    Walls will then be split by level. Gaps get their own split. Where levels overlap, each overlap
    gets its own split. Levels for splits will be stored in the faceLevels map.

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
    -∞ to 1 | 1–5 | 5–8 | 8–13 | 13–16 | 16–20 | 20–22 | 22–23 | 23–26 | 26–30 | 30 to ∞
       all     0    0,0.5 all    0.5,1    1      1, 1.5   1.5     all      2      all

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


export class WallGeometry extends PlaceableGeometry {

  /** @type {string} */
  static PLACEABLE_NAME = "Wall";

  /** @type {string} */
  static LAYER = "walls";

  static TRACKER_TYPES = TRACKER_TYPES;

  static UPDATE_KEYS = {
    ...super.UPDATE_KEYS,
    properties: new Set(TRACKER_TYPES.direction),
    position2d: new Set(TRACKER_TYPES.position2d),
    elevation: new Set(TRACKER_TYPES.elevation),
    level: new Set(TRACKER_TYPES.level),
  };


  // ----- NOTE: Wall Segments ----- //

  static wallLevelSegments;

  /**
   * Define segments for walls in the scene.
   * @returns {LevelSegments}
   */
  static defineWallLevelSegments() {
    // Find all defined elevations for walls.
    const maxE = pixelsToGridUnits(1e06);
    const elevations = new Set([maxE, -maxE]);
    for ( const wallD of canvas.scene.walls ) {
      const { topZ, bottomZ } = this.wallElevation(wallD);
      elevations.add(pixelsToGridUnits(topZ));
      elevations.add(pixelsToGridUnits(bottomZ));
    }
    this.wallLevelSegments = this.segmentLevels([...elevations]);

    // Empty segments (gaps) should contain all levels.
    const allLevels = new Set(canvas.scene.levels.keys())
    for ( const segment of this.wallLevelSegments.segments ) {
      if ( !segment.ids.size ) segment.ids = allLevels;
    }
  }

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

  /** @type {LevelSegments} */
  wallSegments = [];

  initialize() {
    this._buildWallShapes();
    super.initialize();

    // After initializing, the shapes are initialized and their positions/directions can be updated.
    this._updateShapePositions();
    this._updateShapeDirections();
  }

  _buildWallShapes() {
    // Reset the wall shapes.
    // Walls are made up of multiple vertical quads, spanning the defined wall segments.
    this.shapes.forEach(shape => shape.destroy());
    this.wallSegments ??= [];
    this.wallSegments.length = 0;

    // Determine how many wall segments to construct.
    this.constructor.defineWallLevelSegments();
    this.wallSegments.push(...this.constructor.wallLevelSegments.segments) ;
    const numSegments = this.wallSegments.length;
    this.shapes.length = numSegments;
    for ( let i = 0; i < numSegments; i += 1 ) this.shapes[i] = new VerticalQuadPrimitive(`${this.placeableId}_${i}`);
  }

  _updateShapePositions() {
    // Wall properties
    const wallD = this.placeableDocument;
    using ctr2d = this.constructor.wallCenter(wallD);
    const rotZ = this.constructor.wallAngle(wallD)
    const lengthXY = this.constructor.wallLength(wallD);

    using center3d = Point3d.tmp.set(ctr2d.x, ctr2d.y, 0);
    using angles = Point3d.tmp.set(0, 0, rotZ);

    for ( let i = 0, iMax = this.shapes.length; i < iMax; i += 1 ) {
      const shape = this.shapes[i];
      const segmentData = this.wallSegments[i];
      const zHeight = gridUnitsToPixels(segmentData.top - segmentData.bottom);

      center3d.z = gridUnitsToPixels(segmentData.bottom) + (zHeight / 2);

      shape.setPosition(center3d);
      shape.setRotation(angles);
      shape.setDims({ lengthXY, zHeight });
    }
  }

  _updateShapeDirections() {
    const dir = this.placeableDocument.dir;
    this.shapes.forEach(shape => shape.direction = dir);
  }


  // ----- NOTE: Updating ----- //

  _update() {
    // TODO: Only initialize if the segments changed.
    //       Handle level changes separately, by rebuilding as needed without updating class's wall segments.
    if ( this._updateFlags.elevation || this._updateFlags.level ) {
      this.constructor.defineWallLevelSegments();
      this.initialize();
      return;
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

  /**
   * Does this geometry currently block, from the view of a given level?
   * Must all check if it blocks the given sense type.
   * For walls, it is usually necessary to check each of the segments.
   * @param {string} levelId
   * @returns {boolean}
   */
  blocksFromLevel(levelId) {
    return !this.wallSegments.some(segment => segment.ids.has(levelId));
  }


  // ----- NOTE: Faces ----- //

  /**
   * Iterate over the shapes.
   * @param {object} [opts]
   * @param {CONST.WALL_RESTRICTION_TYPES} [opts.senseType]   If provided, will return early if geometry does not block this sense type.
   * @param {string} [opts.levelId]                           If provided, will return early if geometry does not affect this level.
   * @yields {GeometricPrimitive}
   */
  *iterateShapes({ senseType, levelId } = {}) {
    if ( !levelId ) return super.iterateShapes({ senseType, levelId });

    if ( senseType && !this.blocksSense(senseType) ) return;
    if ( !this.blocksFromLevel(levelId) ) return;
    for ( let i = 0, iMax = this.shapes.length; i < iMax; i += 1 ) {
      if ( !this.wallSegments[i].ids.has(levelId) ) continue;
      yield this.shapes[i];
    }
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

  /**
   * Finite elevation of the wall
   * @param {WallDocument} wallD
   * @returns {object}
   * - @prop {number} topZ
   * - @prop {number} bottomZ
   */
  static wallElevation(wallD) {
    const MAX_ELEV = 1e06;
    let { topZ, bottomZ } = wallD;
    if ( !isFinite(topZ) ) topZ = MAX_ELEV;
    if ( !isFinite(bottomZ) ) bottomZ = -MAX_ELEV;
    return { topZ, bottomZ };
  }
}
