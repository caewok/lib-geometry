/* globals
canvas,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Geometry
import { GeometricPrimitive } from "./GeometricPrimitive.js";

// LibGeometry
import { AABB3d } from "../3d/AABB3d.js";


/* Store key geometry information for each placeable, in 3d.
- AABB
- rotation, scaling, and translation matrices from an ideal shape.
- Polygon3ds for faces
- Triangle3ds for faces
- vertices

Regions store information per-shape.
Matrices are stored in a single buffer in the static class property
Tracks only changes to the physical representation of the placeable in the scene
Stored on each placeable.

Once registered, will create tracking objects for each placeable created.

*/

/* Levels visibility

Tokens are at a specific level but can be at any elevation, including ones outside the level parameters.
Same is true of everything else—their elevation does not dictate their level.

Tokens have a defined elevation and a user vieweable elevation.
When you move a token to a different level, its defined elevation stays the same but its
viewable elevation changes. (This may change if a Level or Stairs behavior is used.)

E.g.
- Basement: -20–0
- Ground: 0–20
- First Floor: 20–40

Token at 0 on Ground is -20 at First Floor (0 - 20) but 0 in its document.
Token at 50 on Ground is 30 at First Floor (50 - 20) but 50 in its document.

Tiles have a defined elevation, and are either present or not in a level regardless of elevation.

For base Foundry then, a given level has, in effect, infinite ± elevation. Objects are either
there or not based on their levels set.

Regions, then, do not get split between levels but instead are either present/not present in the scene
from any given token viewpoint.

Infinite walls are either present or not. Same with non-infinite walls. No splitting.

E.g., from First Floor, a token looks down at Ground. It sees a Ground region from 10–30 and
a wall from 0–10. The region is defined as in both Ground and First. The wall is defined as
in only Ground. A second wall from 0–10 is defined in both Ground and First. Then the token will
see the region and the second wall only. This is annoying for infinite walls in base Foundry but
fine for finite walls using Wall Height.

This avoids splitting objects. While walls can conceivably overlap, usually it will be either
a shorter wall viewed from a balcony or a wall to block view of a room, not both at once.

Note: The visibleLevels selection for a given level really controls:
1. Can the other level's background/foreground be seen?
2. Can the other level's tokens be seen?

- Tiles, walls, regions all display only if they are marked as being on the level.

*/

export class PlaceableGeometry {

  // ----- NOTE: Static values ----- //

  static get PLACEABLE_LABEL_PLURAL() { return this.PLACEABLE_NAME.toLowerCase().concat("s"); }


  // ----- NOTE: Constructor ----- //

  /** @type {Placeable|null} */
  get placeable() { return this.placeableDocument.object; };

  /** @type {CanvasDocument} */
  placeableDocument;

  /**
   * Create an id used for the model matrix tracking.
   * @type {string}
   */
  get placeableId() { return `${this.placeableDocument.uuid}`; }

  /**
   * @param {CanvasDocument} placeable
   */
  constructor(placeableDocument) {
    this.placeableDocument = placeableDocument;
  }

  initialize() {
  }

  destroy() {
    this.shapes.forEach(shape => shape.destroy());
    this.shapes.length = 0;
  }

  // ----- NOTE: Updating ----- //

  /**
   * Map defined by child class(es) linking a changed property with the update category:
   * E.g.:
   * UPDATE_KEY_MAP = new Map(["x", "positionXY"]);
   * Child class: UPDATE_KEY_MAP = new Map([...super.UPDATE_KEY_MAP, ["y", "positionXY"]]);
   * @type {Map<string, string}

   */
  static UPDATE_KEY_MAP = new Map();

  /**
   * Set of active flags that signify properties being updated.
   * @param {Set<string>}
   */
  activeUpdates = new Set();

  /**
   * Increment a count of updates, used by things like webGL to know when to update.
   */
  updateCount = 0;

  /**
   * @param {Set<string>} updateKeys      Flattened keys that were updated
   * @returns {boolean} True if an update occurred.
   */
  update(updateKeys, opts) {
    this.activeUpdates.clear();

    for ( const key of updateKeys ) {
      const flag = this.constructor.UPDATE_KEY_MAP.get(key);
      if ( flag ) this.activeUpdates.add(flag);
    }
    if ( !this.activeUpdates.size ) return false;
    this._update(opts);
    return true;
  }

  forceUpdate() {
    // Mark everything as updated.
    this.constructor.UPDATE_KEY_MAP.values().forEach(flag => this.activeUpdates.add(flag));
    this._update();
    return true;
  }

  // Triggered second.
  _update(_opts) {
    this.calculateAABB();
    this.updateCount += 1;
  }


  // ----- NOTE: Levels ----- //

  /**
   * Does this geometry currently block a given sense type?
   * @param {CONST.WALL_RESTRICTION_TYPES} [senseType="sight"]
   * @returns {boolean}
   */
  static blocksSense(placeableDocument, _senseType = "sight") { return true; }

  /**
   * Does this placeable exist on this level?
   * @param {string} levelId
   * @returns {boolean} True if seen from this level or the levelId is null or "".
   */
  static isPresentAtLevel(placeableDocument, levelId) {
    if ( !canvas.scene.levels.has(levelId) ) return !levelId;
    return placeableDocument.levels.has(levelId);
  }

  /**
   * Combines sense test with level test with any other tests specific to the placeable document.
   * @param {object} [opts]
   * @prop {CONST.WALL_RESTRICTION_TYPES} [opts.senseType = "sight"]
   * @prop {string} [opts.levelId]
   * @prop {...}                      Other options used by subclasses
   * @returns {boolean}
   */
  static couldBlock(placeableDocument, { levelId, senseType } = {}) {
    return this.blocksSense(placeableDocument, senseType) && this.isPresentAtLevel(placeableDocument, levelId);
  }

  // ----- NOTE: AABB ----- //

  /** @type {AABB3d} */
  aabb = new AABB3d();

  calculateAABB() {
    AABB3d.union(this.shapes.map(shape => shape.aabb), this.aabb);
  }

  // ----- NOTE: Geometric shapes and faces ----- //

  shapes = [];

  /**
   * Iterate over the shapes' faces.
   * @yields {Polygon3d}
   */
  *iterateFaces() { for ( const shape of this.shapes ) yield* shape.faces; }

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
    for ( const shape of this.shapes ) {
      const t = shape.rayIntersection(rayOrigin, rayDirection, opts);
      if ( t !== null ) return t;
    }
    return null;
  }

  draw2d(opts) {
    this.shapes.forEach(shape => shape.draw2d(opts));
  }

  // ----- NOTE: Face points ----- //

  /**
   * @param {object} [opts]   See iterateShape
   * @yields {Point3d}
   */
  *iterateFacePoints() {
    for ( const shape of this.shapes ) yield* shape.iterateFacePoints();
  }

  // ----- NOTE: Internal points ----- //

  static POINT_INDICES = GeometricPrimitive.POINT_INDICES;

  *iterateInternalPoints() {
    for ( const shape of this.shapes ) yield shape.internalPoints;
  }

  // ----- NOTE: Static helpers ----- //

  /**
   * Height and elevation along the z axis.
   * @param {number} topZ
   * @param {number} bottomZ
   * @returns {object}
   * - @prop {number} zHeight
   * - @prop {number} z
   */
  static zDimensions(topZ, bottomZ) {
    const zHeight = topZ - bottomZ;
    const z = bottomZ + (zHeight * 0.5);
    return { zHeight, z };
  }

  /**
   * Finite elevation.
   * If positive infinity, will be set to a maximum value.
   * If negative infinity, will be set to a minimum value.
   * If undefined, will be set to 0.
   * @param {number|null|undefined} elev
   * @returns {number}
   */
  static finiteElevation(elev) {
    if ( !Number.isNumeric(elev) ) return 0;
    if ( isFinite(elev) ) return elev;
    const MAX_ELEV = 1e06;
    return elev === Number.POSITIVE_INFINITY ? MAX_ELEV : -MAX_ELEV;
  }

  /**
   * Finite elevation of the placeable document
   * @type {number|object} Either a single elevation or an object.
   * - @prop {number} topZ
   * - @prop {number} bottomZ
   */
  get elevationZ() {
    return {
      topZ: this.constructor.finiteElevation(this.placeableDocument.topZ),
      bottomZ: this.constructor.finiteElevation(this.placeableDocument.bottomZ),
    };
  }
}
