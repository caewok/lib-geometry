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
import { gridUnitsToPixels } from "../util.js";


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

  initialize() {
    this.iterateShapes().forEach(shape => shape.initialize());
  }

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
   */
  update(updateKeys, opts) {
    const updateFlags = this._updateFlags;
    Object.keys(updateFlags).forEach(key => updateFlags[key] = false);

    let shapeUpdated = false;
    for ( const [type, s] of Object.entries(this.constructor.UPDATE_KEYS) ) {
      updateFlags[type] = s.intersects(updateKeys);
      shapeUpdated ||= true;
    }
    if ( !shapeUpdated ) return;
    this._update(opts);
  }

  forceUpdate() {
    Object.keys(this._updateFlags).forEach(key => this._updateFlags[key] = true);
    this._update();
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
  blocksSense(_senseType = "sight") { return true; }

  /**
   * Does this geometry currently block, from the view of a given level?
   * Must all check if it blocks the given sense type.
   * @param {string} levelId
   * @returns {boolean}
   */
  blocksFromLevel(_levelId) { return true; }

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
  *iterateShapes({ senseType, levelId } = {}) {
    if ( senseType && !this.blocksSense(senseType) ) return;
    if ( levelId && !this.blocksFromLevel(levelId) ) return;
    for ( const shape of this.shapes ) {
      if ( shape ) yield shape;
    }
  }

  /**
   * Iterate over the shapes' faces.
   * @yields {Polygon3d}
   */
  *iterateFaces(opts = {}) {
    for ( const shape of this.iterateShapes(opts) ) yield* shape.faces;
  }

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
    for ( const shape of this.iterateShapes(opts) ) {
      const t = shape.rayIntersection(rayOrigin, rayDirection, opts);
      if ( t !== null ) return t;
    }
    return null;
  }

  draw2d(opts) {
    this.iterateShapes().forEach(shape => shape.draw2d(opts));
  }

  // ----- NOTE: Face points ----- //

  getFacePoints(opts) {
    return this.iterateShapes(opts).flatMap(shape => shape.facePoints());
  }

  // ----- NOTE: Internal points ----- //

  static POINT_INDICES = GeometricPrimitive.POINT_INDICES;

  getInternalPoints(opts) {
    return this.iterateShapes(opts).map(shape => shape.getInternalPoints());
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
   * Top and bottom z values for a given segment index.
   * @param {number} segmentIdx
   * @param {number} topZ
   * @param {number} bottomZ
   * @returns {object}
   * - @prop {number} topZ
   * - @prop {number} bottomZ
   */
  static elevationZForSegment(segmentIdx, topZ, bottomZ) {
    const segmentData = this.levelSegments[segmentIdx];
    topZ = Math.min(gridUnitsToPixels(segmentData.top), topZ);
    bottomZ = Math.max(gridUnitsToPixels(segmentData.bottom), bottomZ);
    return { topZ, bottomZ };
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

/**
 * Additional methods required for placeables—walls and regions—that span different levels.
 * (Tiles show up in differrent levels but trivially so.)
 */
export const LevelSpanningMixin = superclass => {
  return class extends superclass {

    // ----- NOTE: Geometric shapes and faces ----- //

    /**
     * Iterate over the shapes.
     * @param {object} [opts]
     * @param {CONST.WALL_RESTRICTION_TYPES} [opts.senseType]   If provided, will return early if geometry does not block this sense type.
     * @param {string} [opts.levelId]                           If provided, will return early if geometry does not affect this level.
     * @yields {GeometricPrimitive}
     */
    *iterateShapes({ senseType, levelId } = {}) {
      if ( senseType && !this.blocksSense(senseType) ) return;
      if ( levelId && !this.blocksFromLevel(levelId) ) return;
      for ( let i = 0, iMax = this.shapes.length; i < iMax; i += 1 ) {
        const shape = this.shapes[i];
        if ( !shape ) continue;
        if ( levelId && !this.constructor.levelSegments[i].ids.has(levelId) ) continue;
        yield shape;
      }
    }

    // ----- NOTE: Levels ----- //

    /**
     * Id, taking into account the level segment.
     * Combines the level segment ids so each segment is unique.
     * @param {number} levelSegmentIdx
     * @returns {string}
     */
    _levelShapeId(levelSegmentIdx) {
      const segment = this.constructor.levelSegments[levelSegmentIdx];
      const levelIds = [...segment.ids].join("_");
      return `${this.placeableId}_${levelIds}`;
    }

    /**
     * Does this geometry currently block a given sense type?
     * @param {CONST.WALL_RESTRICTION_TYPES} [senseType="sight"]
     * @returns {boolean}
     */
    blocksSense(_senseType = "sight") { return true; }

    /**
     * Does this geometry currently block, from the view of a given level?
     * Must all check if it blocks at the given level.
     * For walls, it is usually necessary to check each of the segments.
     * @param {string} levelId
     * @returns {boolean}
     */
    blocksFromLevel(levelId) {
      return !this.constructor.levelSegments.some(segment => segment.ids.has(levelId));
    }

    /**
     * Does this wall exist on this level?
     * Must be at this level and within the level elevation range.
     * @param {string} levelId
     * @returns {boolean}
     */
    isPresentAtLevel(levelId) {
      // Confirm this wall has the level id.
      if ( !canvas.scene.levels.has(levelId) ) return false;
      if ( !this.placeableDocument.levels.has(levelId) ) return false;

      // Confirm this wall's top and bottom elevation place it within the level.
      const { topZ, bottomZ } = this.elevationZ;
      const level = canvas.scene.levels.get(levelId);
      if ( !level ) return false;
      const levelBottomZ = gridUnitsToPixels(level.elevation.bottom);
      const levelTopZ = gridUnitsToPixels(level.elevation.top);
      return (bottomZ < levelBottomZ && topZ > levelTopZ )
        || bottomZ.between(levelBottomZ, levelTopZ)
        || topZ.between(levelBottomZ, levelTopZ);
    }
  };
}


