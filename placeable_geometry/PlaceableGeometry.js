/* globals
canvas,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Geometry
import { GeometricPrimitive } from "./GeometricPrimitive.js";

// LibGeometry
import { AABB3d } from "../3d/AABB3d.js";
import { NULL_SET } from "../util.js";


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

Update methods:

position2dUpdated
scaleUpdated
rotationUpdated
shapeUpdated
propertiesUpdated
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


Hooks.on("updateLevel", function(_level, _changes, _opts, _id) {
  PlaceableGeometry.calculateLevelSegments();
});

Hooks.on("canvasReady", function(_canvas) {
  PlaceableGeometry.calculateLevelSegments();
});


export class PlaceableGeometry {

  // ----- NOTE: Static values ----- //

  static get PLACEABLE_LABEL_PLURAL() { return this.PLACEABLE_NAME.toLowerCase().concat("s"); }

  // ----- NOTE: Levels ----- //

  /**
   * Reorganize and split level intervals to cover the low to high range with no overlaps.
   * Add gap intervals as necessary.
   * @param {object[]} segments      The intervals
   *    - @prop {number} bottom       Bottom elevation value
   *    - @prop {number} top          Top elevation value
   *    - @prop {string[]} id[]       Id of the levels encountered in this interval
   */
  static levelSegments = [];

  /**
   * Reorganize and split level intervals to cover the low to high range with no overlaps.
   * Add gap intervals as necessary.
   * @returns {object[]} segments       The intervals
   *    - @prop {number} bottom         Bottom elevation value
   *    - @prop {number} top            Top elevation value
   *    - @prop {Set<string>} ids       Ids of the levels encountered in this interval
   */
  static calculateLevelSegments() {
    // Create a distinct "event" for every bottom and top point.
    const events = new Array(canvas.scene.levels.size * 2);
    let i = 0;
    for ( const level of canvas.scene.levels ) {
      const { bottom, top } = level.elevation;
      events[i++] = { value: bottom, type: "start", id: level.id };
      events[i++] = { value: top, type: "end", id: level.id };
    }

    // Sort by value, with end events after start events if equal.
    events.sort((a, b) => (a.value - b.value) || a.type === "start");

    // Sweep through sorted events, identifying boundary changes.
    const segments = [];
    const activeIds = new Set();
    let currentPosition = events[0].value;
    for ( const event of events) {
      // If we have moved forward in space, commit the previous segment.
      if ( event.value > currentPosition ) {
        segments.push({
          bottom: currentPosition,
          top: event.value,
          ids: new Set(activeIds), // May be empty if it is a gap.
        });
      }

      // Update active ids based on event type.
      switch ( event.type ) {
        case "start": activeIds.add(event.id); break;
        case "end": activeIds.delete(event.id); break;
        // Nothing to do for elevation additions.
      }

      // Move forward to the new value on the line.
      currentPosition = event.value;
    }

    this.levelSegments = segments;
    return segments;
  }

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

  initialize() { }

  destroy() {
    this.iterateShapes().forEach(shape => shape.destroy());
    this.shapes.length = 0;
  }

  // ----- NOTE: Updating ----- //

  static UPDATE_KEYS = {
    properties: NULL_SET,
    level: NULL_SET,
    positionXY: new Set(["x", "y"]),
    elevation: new Set(["elevation"]),
    scale: NULL_SET,
    rotation: NULL_SET,
  };

  // Temporary tracking of the updates made for a given update.
  _updateFlags = {
    properties: false,
    level: false,
    positionXY: false,
    elevation: false,
    scale: false,
    rotation: false,
  };

  /**
   * Increment a count of updates, used by things like webGL to know when to update.
   */
  updateCount = 0;

  /**
   * @param {Set<string>} updateKeys      Flattened keys that were updated
   * @returns {boolean} True if an update occurred.
   */
  update(updateKeys, opts) {
    const updateFlags = this._updateFlags;
    Object.keys(updateFlags).forEach(key => updateFlags[key] = false);

    let shapeUpdated = false;
    for ( const [type, s] of Object.entries(this.constructor.UPDATE_KEYS) ) {
      const needsUpdate = s.intersects(updateKeys);
      updateFlags[type] = needsUpdate
      shapeUpdated ||= needsUpdate;
    }
    if ( !shapeUpdated ) return false;
    // console.debug(`\n\n${this.constructor.name}|Updating ${this.placeableDocument.name} with keys`, [...updateKeys.values()]);
    this._update(opts);
    return true;
  }

  forceUpdate() {
    Object.keys(this._updateFlags).forEach(key => this._updateFlags[key] = true);
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
    AABB3d.union([...this.iterateShapes()].map(shape => shape.aabb), this.aabb);
  }

  // ----- NOTE: Geometric shapes and faces ----- //

  shapes = [];

  /**
   * Iterate over the shapes.
   * @param {object} [opts]
   * @param {CONST.WALL_RESTRICTION_TYPES} [opts.senseType]   If provided, will return early if geometry does not block this sense type.
   * @param {string} [opts.levelId]                           If provided, will return early if geometry does not affect this level.
   * @yields {GeometricPrimitive}
   */
  *iterateShapes() { yield *this.shapes; }

  /**
   * Iterate over the shapes' faces.
   * @yields {Polygon3d}
   */
  *iterateFaces() { for ( const shape of this.iterateShapes() ) yield* shape.faces; }

  /**
   * Determine where a ray hits this object in 3d.
   * Stops at the first hit for a triangle facing the correct direction.
   * Ignores intersections behind the ray.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {object} [opts]
   * @param {string} [opts.levelId]       Level to
   * @param {number} [opts.minT=0]        Ignore hits earlier in the segment than this (multiple of rayDirection)
   * @param {number} [opts.maxT=1]        Ignore hits later in the segment than this (multiple of rayDirection)
   * @returns {number|null} The distance along the ray, as a multiple of rayDirection
   */
  rayIntersection(rayOrigin, rayDirection, opts) {
    for ( const shape of this.iterateShapes() ) {
      const t = shape.rayIntersection(rayOrigin, rayDirection, opts);
      if ( t !== null ) return t;
    }
    return null;
  }

  draw2d(opts) {
    this.iterateShapes().forEach(shape => shape.draw2d(opts));
  }

  // ----- NOTE: Face points ----- //

  /**
   * @param {object} [opts]   See iterateShape
   * @yields {Point3d}
   */
  *iterateFacePoints(opts) {
    for ( const shape of this.iterateShapes(opts) ) yield* shape.iterateFacePoints();
  }

  // ----- NOTE: Internal points ----- //

  static POINT_INDICES = GeometricPrimitive.POINT_INDICES;

  *iterateInternalPoints(opts) {
    for ( const shape of this.iterateShapes(opts) ) yield shape.internalPoints;
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
