/* globals
canvas,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { FixedLengthTrackingBuffer } from "./TrackingBuffer.js";

// LibGeometry
import { GEOMETRY_LIB_ID } from "../const.js";
import { MatrixFloat32 } from "../MatrixFlat.js";
import { AABB3d } from "../AABB.js";
import { Quad3d } from "../3d/Polygon3d.js";
import { almostBetween } from "../util.js";
import { Point3d } from "../3d/Point3d.js";


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

/**
 * @typedef {Object} TrackerKeys
 * @prop {class<AbstractPlaceableTracker>} <TRACKER_METHOD_NAMES>
 * e.g., { position: TilePositionTracker }
 */

/** Abstract class
- Create object on each placeable
- Use tracking update numbers to lazily update the geometry as needed.
- Mix-ins to track different properties.
*/
export class AbstractPlaceableGeometryTracker {
  /**
   * The tracker will be saved at placeable[GEOMETRY_LIB_ID][ID] with updateId property.
   * @type {string}
   */
  static ID = "geometry";

  // ----- NOTE: Hooks ----- //

  /**
   * A hook event that fires when a {@link PlaceableObject} is initially drawn.
   * @param {PlaceableObject} object    The object instance being drawn
   */
  static _onPlaceableDraw(placeable) {
    const handler = this.create(placeable);
  }

  static _onPlaceableDestroy(placeable) {
    const handler = placeable[GEOMETRY_LIB_ID]?.[this.ID];
    if ( !handler ) return;
    handler.destroy();
  }

  // ----- NOTE: Registration ----- //

  /** @type {number[]} */
  static _hooks = new Map();

  /**
   * Register hooks for this placeable type that record updates.
   */
  static registerPlaceableHooks() {
    if ( this._hooks.has(this.constructor.name) ) return;

    const hooks = [];
    this._hooks.set(this.constructor.name, hooks);

    const HOOKS = {
      draw: "_onPlaceableDraw",
      destroy: "_onPlaceableDestroy",
    };
    for ( const [name, methodName] of Object.entries(HOOKS) ) {
      const id = Hooks.on(name, this[methodName].bind(this));
      hooks.push({ name, methodName, id });
    }
  }

  /**
   * Deregister hooks for this placeable type that record updates.
   */
  static deregisterPlaceableHooks() {
    const hooks = this._hooks.get(this.constructor.name) ?? [];
    hooks.forEach(hook => Hooks.off(hook.name, hook.id));
    this._hooks.delete(this.constructor.name);
  }

  /**
   * Create a handler for all placeables.
   */
  static registerExistingPlaceables(placeables) {
    placeables ??= canvas[this.layer].placeables;

    // Ensure update trackers are in place as needed.
    Object.values(this.TRACKERS).forEach(tracker => {
      tracker.registerPlaceableHooks();
      tracker.registerExistingPlaceables(placeables)
    });

    placeables.forEach(placeable => this.create(placeable));
  }

  // ----- NOTE: Constructor ----- //

  /** @type {Placeable} */
  placeable;

  constructor(placeable) {
    this.placeable = placeable;
  }

  static create(placeable) {
    // Singleton. If this tracker already exists, keep it.
    const obj = placeable[GEOMETRY_LIB_ID] ??= {};
    if ( obj[this.ID] ) return obj[this.ID];

    const out = new this(placeable);
    obj[this.ID] = out;

    // Confirm the trackers we need are present.
    Object.values(this.TRACKERS).forEach(tracker => {
      if ( !obj[tracker.ID] ) tracker.registerExistingPlaceables([placeable]);
    });

    out.initialize();
    out.update();
    return out;
  }

  // ----- NOTE: Updating ----- //

  initialize() { }

  /**
   * Track the current placeable updates.
   * If the placeable update number varies from this,
   * @type {number}
   */
  #updateIds = {
    "shape": -1,
    "position": -1,
    "rotation": -1,
    "scale": -1,
  };

  getUpdateId(type) { return this.#updateIds[type]; }

  /** @type {string:callbackName} */
  static TRACKER_METHOD_NAMES = {
    shape: "updateShape",
    position: "updatePosition",
    rotation: "updateRotation",
    scale: "updateScale",
  };

  update() {
    let updated = false;
    for ( const [type, trackerClass] of Object.entries(this.constructor.TRACKERS) ) {
      const placeableUpdateId = this.placeable[GEOMETRY_LIB_ID][trackerClass.ID].updateId;
      if ( this.#updateIds[type] >= placeableUpdateId ) continue;
      const typeMethodName = this.constructor.TRACKER_METHOD_NAMES[type];
      this[typeMethodName]();
      this.#updateIds[type] = placeableUpdateId;
      updated ||= true;
    }
    if ( updated ) this._placeableUpdated();
  }

  updateShape() {}

  updatePosition() {}

  updateRotation() {}

  updateScale() {}

  _placeableUpdated() {}

  destroy() {
    delete this.placeable[GEOMETRY_LIB_ID][this.constructor.ID];
  }
}

// ----- NOTE: PlaceableAABBMixin ----- //

/**
 * @typedef {function} PlaceableAABBMixin
 *
 * Add a bounding box for this placeable class.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
export const PlaceableAABBMixin = superclass => class extends superclass {
  _aabb = new AABB3d(); // Allow non-private access so update can be called separately first.

  get aabb() {
    this.update();
    return this._aabb;
  }

  // AABB is fairly basic, so no need to handle position/rotation/scale separately.
  _placeableUpdated() { super._placeableUpdated(); this.calculateAABB(); }
}

// ----- NOTE: PlaceableModelMatrixMixin ----- //

/** @type {MatrixFlat<4,4>} */
const identityM = MatrixFloat32.identity(4, 4);
Object.freeze(identityM);

/**
 * @typedef {function} PlaceableModelMatrixMixin
 *
 * Adds a model matrix for this placeable.
 * Includes separate rotation, translation, and scale sub-matrices.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
export const PlaceableModelMatrixMixin = superclass => class extends superclass {
  /**
   * Store the entire model matrix as a single typed array.
   * Each 16-element matrix (per placeable) is accessed using an id.
   * @type {FixedLengthTrackingBuffer}
   */
  static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

  /** @type {ArrayBuffer} */
  #matrixBuffer = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 16 * 3);

  /** @type {object<MatrixFloat32>} */
  #matrices = {
    rotation: MatrixFloat32.identity(4, 4, new MatrixFloat32(new Float32Array(this.#matrixBuffer, 0, 16), 4, 4)),
    translation: MatrixFloat32.identity(4, 4, new MatrixFloat32(new Float32Array(this.#matrixBuffer, 16 * Float32Array.BYTES_PER_ELEMENT, 16), 4, 4)),
    scale: MatrixFloat32.identity(4, 4, new MatrixFloat32(new Float32Array(this.#matrixBuffer, 32 * Float32Array.BYTES_PER_ELEMENT, 16), 4, 4)),
  };

  get matrices() {
    this.update();
    return this.#matrices;
  }

  get _modelMatrix() { // Allow access so update can be called separately first.
    const arr = this.constructor.modelMatrixTracker.viewFacetById(this.placeableId);
    return new MatrixFloat32(arr, 4, 4);
  }

  get modelMatrix() {
    this.update();
    return this._modelMatrix;
  }

  /**
   * Create an id used for the model matrix tracking.
   * @type {string}
   */
  get placeableId() { return this.placeable.sourceId; }

  updatePosition() { this.calculateTranslationMatrix(this.#matrices.translation); super.updatePosition(); }

  updateRotation() { this.calculateRotationMatrix(this.#matrices.rotation); super.updateRotation(); }

  updateScale() { this.calculateScaleMatrix(this.#matrices.scale); super.updateScale(); }

  updateShape() {
    this.calculateTranslationMatrix(this.#matrices.translation);
    this.calculateRotationMatrix(this.#matrices.rotation);
    this.calculateScaleMatrix(this.#matrices.scale);
  }

  _placeableUpdated() { super._placeableUpdated(); this.updateModelMatrix();  }

  updateModelMatrix() {
    const { rotation, translation, scale } = this.#matrices;
    const M = this._modelMatrix;
    scale
      .multiply4x4(rotation, M)
      .multiply4x4(translation, M);
  }

  calculateTranslationMatrix() { return this.#matrices.translation; }

  calculateRotationMatrix() { return this.#matrices.rotation; }

  calculateScaleMatrix() { return this.#matrices.scale; }

  initialize() {
    super.initialize();
    this.constructor.modelMatrixTracker.addFacet({ id: this.placeableId, newValues: identityM.arr });
  }

  destroy() {
    this.constructor.modelMatrixTracker.deleteFacet(this.placeableId);
    super.destroy();
  }
}

// ----- NOTE: PlaceableAABBMixin ----- //

/**
 * @typedef {object} Faces
 *
 * Faces of a placeable object.
 * @prop {Polygon3d} top
 * @prop {Polygon3d|null} bottom
 * @prop {Polygon3d[]} sides
 */

const QUADS = {
  up: Quad3d.from4Points( // E.g., tile top.
    Point3d.tmp.set(-0.5, -0.5, 0),
    Point3d.tmp.set(-0.5, 0.5, 0),
    Point3d.tmp.set(0.5, 0.5, 0),
    Point3d.tmp.set(0.5, -0.5, 0),
  ),
  down: null,
  south: Quad3d.from4Points( // E.g., wall facing south.
    Point3d.tmp.set(-0.5, 0, 0.5),
    Point3d.tmp.set(-0.5, 0, -0.5),
    Point3d.tmp.set(0.5, 0, -0.5),
    Point3d.tmp.set(0.5, 0, 0.5),
  ),
  north: null,
  west: Quad3d.from4Points( // E.g., wall facing west.
    Point3d.tmp.set(0, -0.5, 0.5),
    Point3d.tmp.set(0, -0.5, -0.5),
    Point3d.tmp.set(0, 0.5, -0.5),
    Point3d.tmp.set(0, 0.5, 0.5),
  ),
  east: null,
}
QUADS.down = QUADS.up.clone().reverseOrientation();
QUADS.north = QUADS.south.clone().reverseOrientation();
QUADS.east = QUADS.west.clone().reverseOrientation();

/**
 * @typedef {function} PlaceableFacesMixin
 *
 * Add faces for this placeable class.
 * Also adds rayIntersection testing method.
 * Requires matrices.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
export const PlaceableFacesMixin = superclass => class extends superclass {
  /** @type {Faces} */
  _prototypeFaces = { top: null, bottom: null, sides: [] };

  /** @type {Faces} */
  _faces = { top: null, bottom: null, sides: [] };

  get faces() {
    this.update();
    return this._faces;
  }

  /**
   * Iterate over the faces.
   */
  *iterateFaces() {
    this.update();
    if ( this._faces.top ) yield this._faces.top;
    if ( this._faces.bottom ) yield this._faces.bottom;
    for ( const side of this._faces.sides ) yield side;
  }

  /**
   * Construct the prototype faces.
   */
  initialize() {
    super.initialize();
    this._initializePrototypeFaces();
  }

  _initializePrototypeFaces() {
    if ( this._prototypeFaces.top ) this._faces.top = new this._prototypeFaces.top.constructor();
    if ( this._prototypeFaces.bottom ) this._faces.bottom = new this._prototypeFaces.bottom.constructor();
    const numSides = this._prototypeFaces.sides.length;
    this._faces.sides.length = numSides;
    for ( let i = 0; i < numSides; i += 1 ) this._faces.sides[i] ??= new this._prototypeFaces.sides[i].constructor();
  }

  /**
   * Update the faces for this placeable.
   * Always updates using the model matrix.
   */
  _updateFaces() {
    const M = this._modelMatrix; // Avoid triggering infinite update loop. Note this must come after the matrix has been updated.
    if ( this._prototypeFaces.top ) this._prototypeFaces.top.transform(M, this._faces.top)
    if ( this._prototypeFaces.bottom ) this._prototypeFaces.bottom.transform(M, this._faces.bottom)
    for ( let i = 0, iMax = this._prototypeFaces.sides.length; i < iMax; i += 1 ) this._prototypeFaces.sides[i].transform(M, this._faces.sides[i]);
  }

  _placeableUpdated() { super._placeableUpdated(); this._updateFaces(); }

  /**
   * Determine where a ray hits this object in 3d.
   * Stops at the first hit for a triangle facing the correct direction.
   * Ignores intersections behind the ray.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {number} [cutoff=1]   Ignore hits further along the ray from this (treat ray as segment)
   * @returns {number|null} The distance along the ray
   */
  rayIntersection(...opts) { return this.constructor.rayIntersectionForFaces(this.iterateFaces(), ...opts); }

  static rayIntersectionForFaces(iter, rayOrigin, rayDirection, minT = 0, maxT = Number.POSITIVE_INFINITY) {
    for ( const face of iter ) {
      const t = face.intersectionT(rayOrigin, rayDirection);
      if ( t !== null && almostBetween(t, minT, maxT) ) return t;
    }
    return null;
  }

  // ----- NOTE: Polygon3d unit shapes ----- //
  /**
   * 0.5 x 0.5 x 0.5 Quads facing different directions.
   */
  static QUADS = QUADS;

  static RECT_SIDES = {
    north: 0,
    west: 1,
    south: 2,
    east: 3,
  };

  // ----- NOTE: Debug ----- //

  /**
   * Draw face, omitting an axis.
   */
  draw2d(opts) {
    for ( const face of this.iterateFaces() ) face.draw2d(opts);
  }
}


// export const allGeometryMixin = function(Base) {
//   // The order for super will be outside --> inside --> base.
//   // So aabbMixin(matricesMixin(Base)) calls aabb, matrix, base.
//   return aabbMixin(matricesMixin(facesMixin(Base)));
// }
//
// export const noVertexGeometryMixin = function(Base) {
//   return aabbMixin(matricesMixin(facesMixin(Base)));
// }


/* Testing
Draw = CONFIG.GeometryLib.lib.Draw;

tracking = CONFIG.GeometryLib.lib.placeableGeometryTracking
tracking.TileGeometryTracker.registerPlaceableHooks()
tracking.TileGeometryTracker.registerExistingPlaceables()

tracking.WallGeometryTracker.registerPlaceableHooks()
tracking.WallGeometryTracker.registerExistingPlaceables()

tracking.TokenGeometryTracker.registerPlaceableHooks()
tracking.TokenGeometryTracker.registerExistingPlaceables()

tracking.RegionGeometryTracker.registerPlaceableHooks()
tracking.RegionGeometryTracker.registerExistingPlaceables()

tile = canvas.tiles.placeables[0]
for ( const tile of canvas.tiles.placeables ) {
  const geometry = tile.GeometryLib.geometry
  geometry.aabb.draw2d();
  // geometry.iterateFaces().forEach(face => face.draw2d({ color: Draw.COLORS.red }));
  geometry._alphaThresholdPolygons.top.draw2d({ color: Draw.COLORS.orange })
  geometry._alphaThresholdPolygons.bottom.draw2d({ color: Draw.COLORS.orange })
  // geometry._alphaThresholdTriangles.top.draw2d({ color: Draw.COLORS.yellow })
  // geometry._alphaThresholdTriangles.bottom.draw2d({ color: Draw.COLORS.yellow })
}

wall = canvas.walls.placeables[0]
for ( const wall of canvas.walls.placeables ) {
  const geometry = wall.GeometryLib.geometry
  geometry.aabb.draw2d();
  geometry.iterateFaces().forEach(face => face.draw2d({ color: Draw.COLORS.red }))
}

token = canvas.tokens.placeables[0]
for ( const token of canvas.tokens.placeables ) {
  const geometry = token.GeometryLib.geometry
  geometry.aabb.draw2d();
  geometry.iterateFaces().forEach(face => face.draw2d({ color: Draw.COLORS.red }))

  if ( geometry.isLit && geometry.isConstrainedLit ) geometry.iterateConstrainedLitFaces().forEach(face => face.draw2d({ color: Draw.COLORS.orange }))
  if ( geometry.isBrightLit && geometry.isConstrainedBrightLit ) geometry.iterateConstrainedBrightLitFaces().forEach(face => face.draw2d({ color: Draw.COLORS.yellow }))
}

region = canvas.regions.placeables[0]
for ( const region of canvas.regions.placeables ) {
  const geometry = region.GeometryLib.geometry
  geometry.aabb.draw2d();
  geometry.iterateFaces().forEach(face => face.draw2d({ color: Draw.COLORS.red }))

  // geometry.shapes.forEach(shape => shape.aabb.draw2d({ color: Draw.COLORS.blue }))
  // geometry.shapes.forEach(shape => shape.iterateFaces().forEach(face => face.draw2d({ color: Draw.COLORS.blue })))
}



*/

