/* globals
canvas,
CONFIG,
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
} from "./PlaceableGeometry.js";

// LibGeometry
import { GEOMETRY_LIB_ID } from "../const.js";
import { AABB3d } from "../3d/AABB3d.js";
import { MatrixFloat32 } from "../Matrix.js";
import { Quad3d, Polygons3d } from "../3d/Polygon3d.js";
import { pixelsToGridUnits, NULL_SET } from "../util.js";

const TRACKER_TYPES = {
  position: [
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

/**
 * Prototype order:
 * WallGeometryTracker -> PlaceableFacesMixin -> PlaceableMatricesMixin -> PlaceableAABBMixin -> PlaceableGeometry
 */
export class WallGeometry extends mix(PlaceableGeometry).with(PlaceableAABBMixin, PlaceableModelMatrixMixin, PlaceableFacesMixin, PlaceableVerticesMixin) {

  /** @type {string} */
  static PLACEABLE_NAME = "Wall";

  /** @type {string} */
  static layer = "walls";

  static TRACKER_TYPES = TRACKER_TYPES;

  static UPDATE_KEYS = {
    ...super.UPDATE_KEYS,
    properties: new Set(TRACKER_TYPES.direction),
    position2d: new Set(TRACKER_TYPES.position),
    elevation: new Set(TRACKER_TYPES.elevation),
    level: new Set(TRACKER_TYPES.level),

  };

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

  // ----- NOTE: Updating ----- //

  initialize() {
    this.wallLevelSegments = this.constructor.defineWallLevelSegments();
    super.initialize();
  }

  propertiesUpdated() {
    this._initializePrototypeFaces(); // In case wall direction changed.
    super.propertiesUpdated();
  }

  levelUpdated() {
    if ( !this._updateFlags.properties ) this._initializePrototypeFaces();
    super.levelUpdated();
  }

  elevationUpdated() {
    // Update the wall level segments for the scene.
    this.constructor.defineWallLevelSegments();

    // this.constructor.updateWallLevels(); // TODO: Necessary or can we update each wall later?
    super.elevationUpdated();
  }

  static updateWallLevels() {
    // TODO: Can we easily determine if this can be skipped b/c the scene segments remain the same?

    // Update the wall level segments for the scene.
    this.constructor.defineWallLevelSegments();

    // Update all walls in the scene.
    const mgr = CONFIG[GEOMETRY_LIB_ID].geometryManager.wall;
    for ( const wallD of canvas.scene.walls ) {
      const geom = mgr.geomForDocument(wallD);
      geom._initializePrototypeFaces();
      geom._updateFaces();
    }
  }

  // ----- NOTE: AABB ----- //
  calculateAABB() { return AABB3d.fromWallDocument(this.placeableDocument, this.aabb); }

  // ----- NOTE: Matrices ---- //

  calculateTranslationMatrix() {
    const mat = super.calculateTranslationMatrix();
    const pos = this.constructor.wallCenter(this.placeableDocument);
    const { topZ, bottomZ } = this.constructor.wallElevation(this.placeableDocument);
    const zHeight = topZ - bottomZ;
    const z = topZ - (zHeight * 0.5);
    return MatrixFloat32.translation(pos.x, pos.y, z, mat);
  }

  calculateRotationMatrix() {
    const mat = super.calculateRotationMatrix();
    const rot = this.constructor.wallAngle(this.placeableDocument);
    return MatrixFloat32.rotationZ(rot, true, mat);
  }

  calculateScaleMatrix() {
    const mat = super.calculateScaleMatrix();
    const ln = this.constructor.wallLength(this.placeableDocument);
    const { topZ, bottomZ } = this.constructor.wallElevation(this.placeableDocument);
    const scaleZ = topZ - bottomZ;
    return MatrixFloat32.scale(ln, 1.0, scaleZ, mat);
  }

  // ----- NOTE: Faces ---- //

  /** @type {Faces} */
  _prototypeFaces = [
    new Quad3d(),      // Left
    new Quad3d(),   // Right
  ];

  get hasLevelSplit() {
    return this.placeableDocument.levels.size
          || this.placeableDocument.levels.size !== canvas.scene.levels.size;
  }

  /**
   * Create the initial face shapes for this wall, using a 0.5 x 0.5 x 0.5 unit cube.
   * Normal walls have front (top) and back (bottom). One-directional walls have only top.
   */
  _initializePrototypeFaces() {
    // If walls are Polygons3d, recreate the original quads.
    if ( !(this._prototypeFaces[0] instanceof Quad3d) ) this._prototypeFaces[0] = new Quad3d();
    if ( !(this._prototypeFaces[1] instanceof Quad3d) ) this._prototypeFaces[1] = new Quad3d();

    // Define two sides for each wall.
    this.constructor.QUADS.north.clone(this._prototypeFaces[0]);
    this.constructor.QUADS.south.clone(this._prototypeFaces[1]);
    super._initializePrototypeFaces();

    // Use the wall segment elevations to break the prototype faces into pieces.
    if ( this.hasLevelSplit ) {
      for ( let i = 0; i < 2; i += 1 ) {
        const quads = this._splitPrototypeQuadAtLevels(this.faces[i]);
        this._prototypeFaces[i] = Polygons3d.from3dPolygons(quads);
      }
    }
  }

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

  /** @type {Map<Quad3d, Set(string)>} */
  prototypeFaceLevels = new Map();

  /** @type {Map<Quad3d, Set(string)>} */
  faceLevels = new Map();

  /**
   * Iterate over the faces.
   */
  *iterateFaces({ ignoreLevelIds = NULL_SET } = {}) {
    if ( !ignoreLevelIds.size || !this.faceLevels.size ) {
      yield* super.iterateFaces();
      return;
    }

    // For each face, trim polygons that are on the level to ignore.
    // To avoid messing up the original, clone the Polygons3d.
    for ( const face of super.iterateFaces() ) {
      const polys3d = new Polygons3d(0);
      polys3d.polygons = face.polygons.filter(poly3d => {
        const polyLevels = this.faceLevels.get(poly3d);
        return polyLevels.difference(ignoreLevelIds).size;
      });
      yield polys3d;
    }
  }

  _updateFaces() {
    if ( this.hasLevelSplit ) {
      if ( !(this.faces[0] instanceof Polygons3d) ) this.faces[0] = new Polygons3d();
      if ( !(this.faces[1] instanceof Polygons3d) ) this.faces[1] = new Polygons3d();
    } else {
      if ( !(this.faces[0] instanceof Quad3d) ) this.faces[0] = new Quad3d();
      if ( !(this.faces[1] instanceof Quad3d) ) this.faces[1] = new Quad3d();
    }
    super._updateFaces();

    // Copy over the face levels from the prototypes so we know which model shape goes with which level segments.
    this.faceLevels.clear();
    if ( this.hasLevelSplit ) {
      for ( let i = 0; i < 2; i += 1 ) {
        const pf = this._prototypeFaces[i];
        const f = this.faces[i];
        for ( let i = 0, iMax = pf.polygons.length; i < iMax; i += 1 ) {
          const value = this.prototypeFaceLevels.get(pf.polygons[i]);
          this.faceLevels.set(f.polygons[i], value);
        }
      }
    }
  }

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

  /**
   * Split prototype quad face at segment levels.
   * @param {Quad3d} quad                 The quad representing the full wall shape.
   * @param {LevelSegments} segments      All the segments for this level.
   * @returns {Polygons3d}
   */
  _splitPrototypeQuadAtLevels(quad) {
    const allLevels = new Set(canvas.scene.levels.keys());
    this.prototypeFaceLevels.clear();

    // Use the wall segment elevations to break the prototype faces into pieces.
    // Prototype wall goes from -0.5 to 0.5 (spans 1 unit).
    const { minElevation, maxElevation, segments } = this.constructor.wallLevelSegments;
    const totalElevation = maxElevation - minElevation;
    const toPrototypeZ = elev => {
      const percent = (elev - minElevation) / totalElevation;
      return percent - 0.5;
    };

    const wallLevels = this.placeableDocument.levels.size ? this.placeableDocument.levels : allLevels;
    const quads = [];
    for ( const segment of segments ) {
      // Drop segments that are exclusively for a level that does not contain this wall.
      if ( !wallLevels.intersects(segment.ids) ) continue;

      const bottomElev = toPrototypeZ(segment.bottom);
      const topElev = toPrototypeZ(segment.top);
      const newQuad = quad.clone();
      for ( const pt of newQuad.iteratePoints() ) {
        // Points are iterated in place, so can modify in place.
        if ( pt.z === 0.5 ) pt.z = topElev;
        else if (pt.z === -0.5 ) pt.z = bottomElev;
      }
      quads.push(newQuad);
      this.prototypeFaceLevels.set(newQuad, new Set(segment.ids));
    }

    return quads;
  }


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
    if ( this.placeableDocument.isOpen ) return null; // If door is open, no intersection.
    return super.rayIntersection(rayOrigin, rayDirection, opts);
  }

  // ----- NOTE: Vertices ----- //

  // TODO: Do we need to track vertices with the level segments?
  // Could we use elevation to get at that after the fact?

  // ----- NOTE: Wall characteristics ----- //

  /**
   * Determine the 2d center point of the edge.
   * @param {WallDocument} wallD
   * @returns {PIXI.Point}
   */
  static wallCenter(wallD) {
    using a = PIXI.Point.tmp.set(wallD.c[0], wallD.c[1]);
    using b = PIXI.Point.tmp.set(wallD.c[2], wallD.c[3]);
    const ctr = PIXI.Point.tmp;
    return a.add(b, ctr).multiplyScalar(0.5, ctr);
  }

  /**
   * Determine the 2d length of the edge.
   * @param {WallDocument} wallD
   * @returns {number}
   */
  static wallLength(wallD) {
    using a = PIXI.Point.tmp.set(wallD.c[0], wallD.c[1]);
    using b = PIXI.Point.tmp.set(wallD.c[2], wallD.c[3]);
    return PIXI.Point.distanceBetween(a, b);
  }

  /**
   * Angle of the edge on the 2d canvas.
   * @param {WallDocument} edge
   * @returns {number} Angle in radians
   */
  static wallAngle(wallD) {
    using a = PIXI.Point.tmp.set(wallD.c[0], wallD.c[1]);
    using b = PIXI.Point.tmp.set(wallD.c[2], wallD.c[3]);
    using delta = b.subtract(a);
    return Math.atan2(delta.y, delta.x);
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
