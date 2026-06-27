/* globals
canvas,
CONST,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Mixing
import { mix } from "../mixwith.js";
import {
  PlaceableGeometry,
  PlaceableAABBMixin,
  PlaceableModelMatrixMixin,
  PlaceableFacesMixin,
  PlaceableVerticesMixin,
  QUADS,
} from "./PlaceableGeometry.js";

// LibGeometry
import { AABB3d } from "../3d/AABB3d.js";
import { MatrixFloat32 } from "../Matrix.js";
import { Polygons3d } from "../3d/Polygon3d.js";
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

  // ----- Model Matrix ----- //

  static get modelMatrixTracker() { return WallLevelSegmentGeometry.modelMatrixTracker; }


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

  static wallLevelSegments;

  /**
   * Define segments for walls in the scene.
   * @returns {LevelSegments}
   */
  static defineWallLevelSegments() {
    // Find all defined elevations for walls.
    const maxE = pixelsToGridUnits(1e06)
    const elevations = new Set([maxE, -maxE]);
    for ( const wallD of canvas.scene.walls ) {
      const { topZ, bottomZ } = wallD;
      if ( isFinite(topZ) ) elevations.add(topZ);
      if ( isFinite(bottomZ) ) elevations.add(bottomZ);
    }
    this.wallLevelSegments = this.segmentLevels([...elevations]);

    // Empty segments (gaps) should contain all levels.
    const allLevels = new Set(canvas.scene.levels.keys())
    for ( const segment of this.wallLevelSegments.segments ) {
      if ( !segment.ids.size ) segment.ids = allLevels;
    }
  }

  constructor(placeableDocument) {
    super(placeableDocument);

    if ( !this.constructor.wallLevelSegments ) this.constructor.defineWallLevelSegments();
    const segmentData = this.constructor.wallLevelSegments;
    const numSegments = this.segmentGeoms.length = segmentData.segments.length;
    for ( let i = 0; i < numSegments; i += 1 ) {
      this.segmentGeoms[i] = new WallLevelSegmentGeometry(this.placeableDocument, i);
    }
  }

  /** @type {WallLevelSegmentGeometry[]} */
  segmentGeoms = [];

  initialize() {
    for ( const geom of this.segmentGeoms ) geom.initialize();
  }

  // ----- NOTE: Updating ----- //

  update(updateKeys) {
    for ( const geom of this.segmentGeoms ) geom.update(updateKeys);
  }

  /*
  propertiesUpdated() { for ( const geom of this.segmentGeoms ) geom.propertiesUpdated(); }

  levelUpdated() { for ( const geom of this.segmentGeoms ) geom.levelUpdated(); }

  position2dUpdated() { for ( const geom of this.segmentGeoms ) geom.position2dUpdated(); }

  elevationUpdated() { for ( const geom of this.segmentGeoms ) geom.elevationUpdated(); }

  scaleUpdated() { for ( const geom of this.segmentGeoms ) geom.scaleUpdated(); }

  rotationUpdated() { for ( const geom of this.segmentGeoms ) geom.rotationUpdated(); }

  shapeUpdated() { for ( const geom of this.segmentGeoms ) geom.shapeUpdated(); }
  */

  destroy() {
    for ( const geom of this.segmentGeoms ) geom.destroy();
    this.segmentGeoms.length = 0;
  }

  // ----- NOTE: AABB ----- //

  get aabb() { return AABB3d.union(this.segmentGeoms.map(geom => geom.aabb)); }

  // ----- NOTE: Matrices ----- //

  /**
   * Iterate over the matrix of each segment geometry.
   * @param {object} [opts]
   * @param {string} [opts.levelId]    Filter faces from point of view of a specific level?
   * @yields {PlaceableModelMatrix}
   */
  *iterateMatrices({ levelId = ""} = {}) {
    for ( const geom of this.segmentGeoms ) {
      if ( !geom.isActiveForLevel(levelId) ) continue;
      yield geom.model;
    }
  }

  // ----- NOTE: Faces ----- //

  /**
   * Iterate over the faces, combining the segments to Polygons3d.
   * @param {object} [opts]
   * @param {string} [opts.levelId]    Filter faces from point of view of a specific level?
   * @yields {Polygons3d}
   */
  *iterateFaces({ levelId = "" } = {}) {
    const geoms = this.segmentGeoms.filter(geom => geom.isActiveForLevel(levelId));
    if ( !geoms.length ) return;

    const top = Polygons3d.from3dPolygons(geoms.map(geom => geom.faces[0]));
    yield top;

    const bottom = Polygons3d.from3dPolygons(geoms.map(geom => geom.faces[1]));
    yield bottom;
  }

  /**
   * Iterate over the individual faces as Quad3d.
   * @param {object} [opts]
   * @param {string} [opts.levelId]    Filter faces from point of view of a specific level?
   * @yields {Quad3d}
   */
  *iterateFaceSegments({ levelId = ""} = {}) {
    for ( const geom of this.segmentGeoms ) {
      if ( !geom.isActiveForLevel(levelId) ) continue;
      yield* geom.iterateFaces();
    }
  }

  _updateFaces() { for ( const geom of this.segmentGeoms ) geom._updateFaces(); }

  _initializePrototypeFaces() { for ( const geom of this.segmentGeoms ) geom._initializePrototypeFaces();}

  /**
   * Determine where a ray hits this object in 3d.
   * Stops at the first hit for a triangle facing the correct direction.
   * Ignores intersections behind the ray.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {object} [opts]
   * @param {string} [opts.levelId]       Filter faces from point of view of a specific level?
   * @param {number} [opts.minT=0]        Ignore hits earlier in the segment than this (multiple of rayDirection)
   * @param {number} [opts.maxT=1]        Ignore hits later in the segment than this (multiple of rayDirection)
   * @returns {number|null} The distance along the ray, as a multiple of rayDirection
   */
  rayIntersection(rayOrigin, rayDirection, { levelId = "", ...opts } = {}) {
    if ( this.placeableDocument.isOpen ) return null; // If door is open, no intersection.
    for ( const geom of this.segmentGeoms ) {
      if ( !geom.isActiveForLevel(levelId) ) continue;
      const t = geom.rayIntersection(rayOrigin, rayDirection, opts);
      if ( t !== null ) return t;
    }
    return null;
  }

  // ----- NOTE: Vertices ----- //

  /**
   * Iterate over the vertex object of each segment geometry.
   * @param {object} [opts]
   * @param {string} [opts.levelId]    Filter faces from point of view of a specific level?
   * @yields {VertexObject}
   */
  *iterateVertices({ levelId = "", type = "model", normals = true } = {}) {
    normals = normals ? "withNormals" : "withoutNormals";
    for ( const geom of this.segmentGeoms ) {
      if ( !geom.isActiveForLevel(levelId) ) continue;
      yield geom.vertexObject[type][normals];
    }
  }

  static get instanceVO() { return WallLevelSegmentGeometry.instanceVO; }

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

  // ----- NOTE: Debug ----- //

  /**
   * Draw face, omitting an axis.
   */
  draw2d(opts) {
    for ( const face of this.iterateFaces(opts) ) face.draw2d(opts);
  }

}

class WallLevelSegmentGeometry extends mix(PlaceableGeometry).with(PlaceableAABBMixin, PlaceableModelMatrixMixin, PlaceableFacesMixin, PlaceableVerticesMixin) {

  #idx = 0;

  constructor(placeableDocument, idx = 0) {
    super(placeableDocument);
    this.#idx = idx;
  }

  get segmentData() { return WallGeometry.wallLevelSegments.segments[this.#idx]; }

  get segmentElevationZ() {
    const { top, bottom } = this.segmentData;
    return {
      topZ: gridUnitsToPixels(top),
      bottomZ: gridUnitsToPixels(bottom),
    };
  }

  /**
   * Is this wall segment currently part of this overall wall?
   * Depends on the wall levels and door states.
   * @type {boolean}
   */
  get isActive() {
    return !this.placeableDocument.isOpen && this.placeableDocument.levels.intersects(this.segmentData.ids);
  }

  /**
   * Is this wall part of the overall wall, from the view of a specific level?
   * @param {string} levelId
   * @returns {boolean}
   */
  isActiveForLevel(levelId) {
    // If no level id, just use isActive.
    // If level id, then it must be active and the level id must be in the levels for this wall segment.
    return this.isActive && (!levelId || this.segmentData.ids.has(levelId));
  }

  get hasLevelSplit() {
    return this.placeableDocument.levels.size
          || this.placeableDocument.levels.size !== canvas.scene.levels.size;
  }

  get wall() { return this.placeableDocument.object; }

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

  // ----- NOTE: AABB ----- //

  calculateAABB() {
    AABB3d.fromWallDocument(this.placeableDocument, this.aabb)

    // Adjust for segment elevation.
    const { topZ, bottomZ } = this.segmentElevationZ;
    this.aabb.min.z = bottomZ;
    this.aabb.max.z = topZ;
  }

  // ----- NOTE: Matrices ----- //

  /**
   * Create an id used for the model matrix tracking.
   * @type {string}
   */
  get placeableId() { return `${this.placeableDocument.uuid}_${this.#idx}`; }

  calculateTranslationMatrix() {
    const mat = super.calculateTranslationMatrix();
    const pos = WallGeometry.wallCenter(this.placeableDocument);
    const { topZ, bottomZ } = this.segmentElevationZ;
    const zHeight = topZ - bottomZ;
    const z = topZ - (zHeight * 0.5);
    return MatrixFloat32.translation(pos.x, pos.y, z, mat);
  }

  calculateRotationMatrix() {
    const mat = super.calculateRotationMatrix();
    const rot = WallGeometry.wallAngle(this.placeableDocument);
    return MatrixFloat32.rotationZ(rot, true, mat);
  }

  calculateScaleMatrix() {
    const mat = super.calculateScaleMatrix();
    const ln = WallGeometry.wallLength(this.placeableDocument);
    const { topZ, bottomZ } = this.segmentElevationZ;
    const scaleZ = topZ - bottomZ;
    return MatrixFloat32.scale(ln, 1.0, scaleZ, mat);
  }

  // ----- NOTE: Faces ----- //

  /** @type {Faces} */
  static prototypeFaces = [
    QUADS.north.clone(),   // Left
    QUADS.south.clone(),   // Right
  ];

  /**
   * Determine where a ray hits this object in 3d.
   * Stops at the first hit for a triangle facing the correct direction.
   * Ignores intersections behind the ray.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {object} [opts]
   * @param {number} [opts.minT=0]        Ignore hits earlier in the segment than this (multiple of rayDirection)
   * @param {number} [opts.maxT=1]        Ignore hits later in the segment than this (multiple of rayDirection)
   * @returns {number|null} The distance along the ray, as a multiple of rayDirection
   */
  rayIntersection(rayOrigin, rayDirection, opts) {
    if ( !this.isActiveForLevel(opts.levelId) ) return null; // If door is open or not on this level, no intersection.
    return super.rayIntersection(rayOrigin, rayDirection, opts);
  }

  // Vertices should be automatic from the parent PlaceableGeometry.

}
