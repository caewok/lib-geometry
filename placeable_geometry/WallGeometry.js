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
} from "./PlaceableGeometry.js";

// LibGeometry
import { AABB3d } from "../3d/AABB3d.js";
import { MatrixFloat32 } from "../Matrix.js";
import { Quad3d, Polygons3d } from "../3d/Polygon3d.js";
import { gridUnitsToPixels, pixelsToGridUnits, NULL_SET } from "../util.js";

const TRACKER_TYPES = {
  position: [
    "c",
    "flags-wall-height.top",
    "flags.wall-height.bottom",
  ],
  direction: [
    "dir",
  ],
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
export class WallGeometry extends mix(PlaceableGeometry).with(PlaceableAABBMixin, PlaceableModelMatrixMixin, PlaceableFacesMixin) {

  /** @type {string} */
  static PLACEABLE_NAME = "Wall";

  /** @type {string} */
  static layer = "walls";

  static TRACKER_TYPES = TRACKER_TYPES;

  static UPDATE_KEYS = {
    position: new Set(TRACKER_TYPES.position),
    scale: new Set(TRACKER_TYPES.position),
    rotation: new Set(TRACKER_TYPES.position),
    shape: NULL_SET,
    properties: new Set(TRACKER_TYPES.direction),
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

  propertiesUpdated() {
    this._initializePrototypeFaces(); // In case wall direction changed.
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

  /**
   * Create the initial face shapes for this wall, using a 0.5 x 0.5 x 0.5 unit cube.
   * Normal walls have front (top) and back (bottom). One-directional walls have only top.
   */
  _initializePrototypeFaces() {
    this.constructor.QUADS.north.clone(this._prototypeFaces[0]);
    this.constructor.QUADS.south.clone(this._prototypeFaces[1]);
    super._initializePrototypeFaces();
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
  */

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
    const M = this.modelMatrix.model;
    const hasTop = this.placeableDocument.dir === 0 || this.placeableDocument.dir === 1;    // 1: Restricts from left (from a --> b).
    const hasBottom = this.placeableDocument.dir === 0 || this.placeableDocument.dir === 2; // 2: Restricts from right (from a --> b).
    const hasLevelSplit = this.placeableDocument.levels.size !== canvas.scene.levels.size;

    const numFaces= hasTop + hasBottom;
    this.faces.length = numFaces;
    for ( let i = 0; i < numFaces; i += 1 ) {
      let face = this.faces[i];
      if ( !face || !(face instanceof Quad3d) ) face = new Quad3d();
      this._prototypeFaces[i].transform(M, face);
      if ( hasLevelSplit ) {
        const quads = this._splitQuadAtLevels(face);
        face = Polygons3d.from3dPolygons(quads);
      }
      this.faces[i] = face;
    }
  }

  /**
   * Split quad face at levels
   * @param {Quad3d} quad       The quad representing the full wall shape.
   * @returns {Polygons3d}
   */
  _splitQuadAtLevels(quad) {
    const aabb = quad.aabb;
    const zMin = aabb.min.z;
    const zMax = aabb.max.z;
    const allLevels = new Set(canvas.scene.levels.keys());
    this.faceLevels.clear();

    // Returns segments in order.
    const { minElevation, maxElevation, segments } = structuredClone(this.constructor.levelSegments);

    // Add in top and bottom segments as needed; trim segments outside the wall bounds.
    const elevMin = pixelsToGridUnits(zMin);
    if ( minElevation > elevMin ) segments.unshift({ bottom: elevMin, top: minElevation, ids: allLevels });
    else {
      while ( segments.length ) {
        const s = segments[0];
        if ( elevMin.between(s.bottom, s.top) ) {
          s.bottom = elevMin;
          if ( s.bottom === s.top ) segments.shift();
          break;
        } else segments.shift();
      }
    }

    const elevMax = pixelsToGridUnits(zMax);
    if ( maxElevation < elevMax ) segments.push({ bottom: maxElevation, top: elevMax, ids: allLevels });
    else {
       while ( segments.length ) {
        const s = segments.at(-1);
        if ( elevMax.between(s.bottom, s.top) ) {
          s.top = elevMax;
          if ( s.bottom === s.top ) segments.pop();
          break;
        } else segments.pop();
      }
    }

    // Create quads accordingly.
    const wallLevels = this.placeableDocument.levels.size ? this.placeableDocument.levels : allLevels;
    const quads = [];
    for ( const segment of segments ) {
      // Drop segments that are exclusively for a level that does not contain this wall.
      if ( !wallLevels.intersects(segment.ids) ) continue;

      const bottomZ = gridUnitsToPixels(segment.bottom);
      const topZ = gridUnitsToPixels(segment.top);
      const newQuad = quad.clone();
      for ( const pt of newQuad.iteratePoints() ) {
        // Points are iterated in place, so can modify in place.
        if ( pt.z === zMax ) pt.z = topZ;
        else if (pt.z === zMin ) pt.z = bottomZ;
      }
      quads.push(newQuad);
      this.faceLevels.set(newQuad, new Set(segment.ids));
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
