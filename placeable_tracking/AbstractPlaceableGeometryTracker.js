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
    const handler = new this(placeable);
    handler.initialize();
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

    placeables.forEach(placeable => {
      const handler = new this(placeable);
      handler.initialize();
    });
  }

  // ----- NOTE: Constructor ----- //

  /** @type {Placeable} */
  placeable;

  constructor(placeable) {
    this.placeable = placeable;
    placeable[GEOMETRY_LIB_ID] ??= {};

    // Singleton. If this tracker already exists, keep it.
    if ( placeable[GEOMETRY_LIB_ID][this.constructor.ID] ) return placeable[GEOMETRY_LIB_ID][this.constructor.ID];
    placeable[GEOMETRY_LIB_ID][this.constructor.ID] = this;

    // Confirm the trackers we need are present.
    Object.values(this.constructor.TRACKERS).forEach(tracker => {
      if ( !placeable[GEOMETRY_LIB_ID][tracker.ID] ) tracker.registerExistingPlaceables([placeable]);
    });
  }

  initialize() {
    this.update();
  }

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
    shape: "placeableUpdated",
    position: "placeablePositionUpdated",
    rotation: "placeableRotationUpdated",
    scale: "placeableScaleUpdated",
  };

  update() {
    for ( const [type, trackerClass] of Object.entries(this.constructor.TRACKERS) ) {
      const placeableUpdateId = this.placeable[GEOMETRY_LIB_ID][trackerClass.ID].updateId;
      if ( this.#updateIds[type] >= placeableUpdateId ) continue;
      const typeMethodName = this.constructor.TRACKER_METHOD_NAMES[type];
      this[typeMethodName]();
      this.#updateIds[type] = placeableUpdateId;
    }
  }

  placeablePositionUpdated() { }

  placeableRotationUpdated() { }

  placeableScaleUpdated() { }

  placeableShapeUpdated() { }

  destroy() {
    delete this.placeable[GEOMETRY_LIB_ID][this.constructor.ID];
  }
}

/**
 * Add a bounding box for this placeable class.
 */
export const aabbMixin = function(Base) {
  class PlaceableAABB extends Base {
    _aabb = new AABB3d(); // Allow access so update can be called separately first.

    get aabb() {
      this.update();
      return this._aabb;
    }

    calculateAABB() { return super.calculateAABB(this._aabb); }

    // AABB is fairly basic, so no need to handle position/rotation/scale separately.
    placeablePositionUpdated() { this.calculateAABB(); super.placeablePositionUpdated(); }

    placeableRotationUpdated() { this.calculateAABB(); super.placeableRotationUpdated(); }

    placeableScaleUpdated() { this.calculateAABB(); super.placeableScaleUpdated(); }

    placeableShapeUpdated() { this.calculateAABB(); super.placeableShapeUpdated(); }
  }
  return PlaceableAABB;
}


/** @type {MatrixFlat<4,4>} */
const identityM = MatrixFloat32.identity(4, 4);
Object.freeze(identityM);

/**
 * Adds a model matrix for this placeable.
 * Includes separate rotation, translation, and scale sub-matrices.
 */
export const matricesMixin = function(Base) {
  class PlaceableMatrices extends Base {
    /**
     * Store the entire model matrix as a single typed array.
     * Each 16-element matrix (per placeable) is accessed using an id.
     * @type {FixedLengthTrackingBuffer}
     */
    static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

    /**
     * Create an id used for the model matrix tracking.
     * @param {PlaceableDocument}
     * @returns {string}
     */
    static _sourceIdForPlaceableDocument(placeableD) { return placeableD.id; }

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

    get placeableId() { return this.placeable.sourceId; }

    placeablePositionUpdated() {
      this.calculateTranslationMatrix(this.#matrices.translation);
      this.updateModelMatrix();
      super.placeablePositionUpdated();
    }

    placeableRotationUpdated() {
      this.calculateRotationMatrix(this.#matrices.rotation);
      this.updateModelMatrix();
      super.placeableRotationUpdated();
    }

    placeableScaleUpdated() {
      this.calculateScaleMatrix(this.#matrices.scale);
      this.updateModelMatrix();
      super.placeableScaleUpdated();
    }

    placeableShapeUpdated() {
      this.calculateTranslationMatrix(this.#matrices.translation);
      this.calculateRotationMatrix(this.#matrices.rotation);
      this.calculateScaleMatrix(this.#matrices.scale);
      this.updateModelMatrix();
      super.placeableShapeUpdated();
    }

    updateModelMatrix() {
      const { rotation, translation, scale } = this.#matrices;
      const M = this._modelMatrix;
      scale
        .multiply4x4(rotation, M)
        .multiply4x4(translation, M);
    }

    calculateTranslationMatrix() { return super.calculateTranslationMatrix(this.#matrices.translation); }

    calculateRotationMatrix() { return super.calculateRotationMatrix(this.#matrices.rotation); }

    calculateScaleMatrix() { return super.calculateScaleMatrix(this.#matrices.scale); }

    initialize() {
      this.constructor.modelMatrixTracker.addFacet({ id: this.placeableId, newValues: identityM.arr });
      super.initialize();
    }

    destroy() {
      this.constructor.modelMatrixTracker.deleteFacet(this._sourceIdForPlaceableDocument(this.placeable.document));
      super.destroy();
    }
  }
  return PlaceableMatrices;
}


/**
 * Faces of a placeable object.
 * @typedef {object} Faces
 * @prop {Polygon3d} top
 * @prop {Polygon3d|null} bottom
 * @prop {Polygon3d[]} sides
 */

/**
 * Add faces for this placeable class. Also adds rayIntersection testing method.
 * Requires matrices.
 */
export const facesMixin = function(Base) {
  class PlaceableFaces extends Base {
    /** @type {Faces} */
    _prototypeFaces = { top: null, bottom: null, sides: [] };

    /** @type {Faces} */
    faces = { top: null, bottom: null, sides: [] };


    /**
     * Iterate over the faces.
     */
    *iterateFaces() {
      if ( this.faces.top ) yield this.faces.top;
      if ( this.faces.bottom ) yield this.faces.bottom;
      for ( const side of this.faces.sides ) yield side;
    }

    /**
     * Update the faces for this placeable.
     */
    _updateFaces() { }



    /**
     * Determine where a ray hits this object in 3d.
     * Stops at the first hit for a triangle facing the correct direction.
     * Ignores intersections behind the ray.
     * @param {Point3d} rayOrigin
     * @param {Point3d} rayDirection
     * @param {number} [cutoff=1]   Ignore hits further along the ray from this (treat ray as segment)
     * @returns {number|null} The distance along the ray
     */
    rayIntersection(_rayOrigin, _rayDirection, _minT = 0, _maxT = Number.POSITIVE_INFINITY) { }
  }
  return PlaceableFaces;
}

export const allGeometryMixin = function(Base) {
  return aabbMixin(matricesMixin(Base));
}

export const noVertexGeometryMixin = function(Base) {
  return aabbMixin(matricesMixin(Base));
}


/* Testing
tracking = CONFIG.GeometryLib.lib.placeableGeometryTracking
tracking.TileGeometryTracker.registerPlaceableHooks()
tracking.TileGeometryTracker.registerExistingPlaceables()

tile = canvas.tiles.placeables[0]
geometry = tile.GeometryLib.geometry

*/

