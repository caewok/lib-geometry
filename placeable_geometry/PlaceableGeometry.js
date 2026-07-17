/* globals
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

let LEVEL_SEGMENTS;

Hooks.on("updateLevel", function(_level, _changes, _opts, _id) {
  LEVEL_SEGMENTS = PlaceableGeometry.segmentLevels();
});

Hooks.on("canvasReady", function(canvas) {
  LEVEL_SEGMENTS = PlaceableGeometry.segmentLevels();
});


export class PlaceableGeometry {

  // ----- NOTE: Static values ----- //

  static get PLACEABLE_LABEL_PLURAL() { return this.PLACEABLE_NAME.toLowerCase().concat("s"); }

  // ----- NOTE: Levels ----- //

  /**
   * Reorganize and split level intervals to cover the low to high range with no overlaps.
   * Add gap intervals as necessary.
   * @param {Level[]} levels
   * @returns {object[]} The intervals
   *  - @prop {number} bottom       Bottom elevation value
   *  - @prop {number} top          Top elevation value
   *  - @prop {string[]} id[]       Id of the levels encountered in this interval
   */
  static get levelSegments() { return LEVEL_SEGMENTS; }

  /**
   * Reorganize and split level intervals to cover the low to high range with no overlaps.
   * Add gap intervals as necessary.
   * @param {number[]} elevations     Elevations to add in addition to the scene levels
   * @returns {object[]}
   * - @prop {number} minElevation    Minimum elevation for the scene levels
   * - @prop {number} maxElevation    Maximum elevation for the scene levels
   * - @prop {object[]} segments      The intervals
   *    - @prop {number} bottom       Bottom elevation value
   *    - @prop {number} top          Top elevation value
   *    - @prop {string[]} id[]       Id of the levels encountered in this interval
   */
  static segmentLevels(elevations = []) {
    // Create a distinct "event" for every bottom and top point.
    const events = new Array(canvas.scene.levels.size * 2 + elevations.length);
    let i = 0;
    for ( const level of canvas.scene.levels ) {
      const { bottom, top } = level.elevation;
      events[i++] = { value: bottom, type: "start", id: level.id };
      events[i++] = { value: top, type: "end", id: level.id };
    }

    for ( const elevation of elevations ) events[i++] = { value: elevation, type: "added", id: null };

    // Sort by value, with end events after start events if equal.
    events.sort((a, b) => (a.value - b.value) || a.type === "start");

    // Store min and max elevations for later use.
    const minElevation = events.at(0).value;
    const maxElevation = events.at(-1).value;

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
    return { segments, minElevation, maxElevation };
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
    this.shapes.forEach(shape => shape.initialize());
  }

  destroy() {
    this.shapes.forEach(shape => shape.destroy());
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
    AABB3d.union(this.shapes.map(shape => shape.aabb), this.aabb);
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
    yield* this.shapes;
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
  rayIntersection(rayOrigin, rayDirection, opts = {}) {
    for ( const shape of this.iterateShapes(opts) ) {
      const t = shape.rayIntersection(rayOrigin, rayDirection, opts);
      if ( t !== null ) return t;
    }
    return null;
  }

  draw2d(opts) {
    for ( const shape of this.shapes ) shape.draw2d(opts);
  }

  // ----- NOTE: Face points ----- //

  get facePoints() { return this.shapes.flatMap(shape => shape.facePoints); }

  // ----- NOTE: Internal points ----- //

  static POINT_INDICES = GeometricPrimitive.POINT_INDICES;

  getInternalPoints() {
    return this.shapes.map(shape => shape.getInternalPoints());
  }
}
