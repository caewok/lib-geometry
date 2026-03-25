/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { FixedLengthTrackingBuffer } from "../placeable_tracking/TrackingBuffer.js";

// LibGeometry
import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "../const.js";
import { MatrixFloat32, ModelMatrix } from "../Matrix.js";
import { AABB3d } from "../3d/AABB3d.js";
import { Quad3d } from "../3d/Polygon3d.js";
import { almostBetween } from "../util.js";
import { Point3d } from "../3d/Point3d.js";
import { Sphere } from "../3d/Sphere.js";


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

positionUpdated
scaleUpdated
rotationUpdated
shapeUpdated
propertiesUpdated


*/

export class PlaceableGeometry {

  // ----- NOTE: Constructor ----- //

  /** @type {Placeable} */
  placeable;

  /**
   * @param {PlaceableObject} placeable
   */
  constructor(placeable) { this.placeable = placeable; }

  /**
   * Create geometry on a given placeable.
   * Enforces uniqueness per placeable.
   * @param {Placeable} placeable
   * @returns {AbstractPlaceableGeometry}
   */
  static create(placeable) {
    const obj = placeable[GEOMETRY_LIB_ID] ??= {};
    obj[GEOMETRY_ID] ??= new this(placeable);
    return obj[GEOMETRY_ID];
  }

  initialize() { }

  update(updateKeys) {
    // Update in order. If any updates, update the shape.
    const KEYS = this.constructor.UPDATE_KEYS;
    const updateProperties = KEYS.properties.size && updateKeys.some(key => KEYS.properties.has(key));
    const updatePosition = KEYS.position.size && updateKeys.some(key => KEYS.position.has(key))
    const updateScale = KEYS.scale.size && updateKeys.some(key => KEYS.scale.has(key))
    const updateRotation = KEYS.rotation.size && updateKeys.some(key => KEYS.rotation.has(key))
    const updateShape = updateProperties || updatePosition || updateScale || updateRotation
      || KEYS.shape.size && updateKeys.some(key => KEYS.shape.has(key))

    if ( updateProperties ) this.propertiesUpdated();
    if ( updatePosition ) this.positionUpdated();
    if ( updateScale ) this.scaleUpdated();
    if ( updateRotation ) this.rotationUpdated();
    if ( updateShape ) this.shapeUpdated();
  }

  positionUpdated() { }

  scaleUpdated() { }

  rotationUpdated() { }

  shapeUpdated() { }

  propertiesUpdated() { }

  destroy() { }
}

// ----- NOTE: Placeable Mixins ----- //

/*
Each mixin has a basic calculation method that may be extended by subclasses.
Each relies on 1+ update methods.

Changes to placeable dimensions:
- position
- scale
- rotation
- shape (called when any of position/scale/rotation) triggered

Changes to other placeable characteristics that result in full reset, such as token shape
- placeableProperties

Other updates may be defined by subclasses but those must


*/

// ----- NOTE: PlaceableAABBMixin ----- //

/**
 * @typedef {function} PlaceableAABBMixin
 *
 * Add a bounding box for this placeable class.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
export const PlaceableAABBMixin = superclass => class extends superclass {
  aabb = new AABB3d(); // Allow non-private access so update can be called separately first.

  initialize() {
    super.initialize();
    this.calculateAABB();
  }

  // AABB is fairly basic, so no need to handle position/rotation/scale separately.
  shapeUpdated() { super.shapeUpdated(); this.calculateAABB(); }

  calculateAABB() { console.error(`${this.constructor.name} must implement calculateAABB method.`); }
}


// ----- NOTE: PlaceableModelMatrixMixin ----- //

/** @type {Matrix<4,4>} */
const identityM = MatrixFloat32.identity(4, 4);
Object.freeze(identityM);

/**
 * Matrix model that uses a provided callback to access the model matrix buffer.
 */
export class PlaceableModelMatrix extends ModelMatrix {

  /** @type {function} */
  #modelMatrixCallback;

  get _model() { return this.#modelMatrixCallback(); }

  get model() { return super.model; }

  constructor(modelMatrixCallback) {
    super();
    if ( !modelMatrixCallback ) this.#modelMatrixCallback = () => super._model;
    else this.#modelMatrixCallback = modelMatrixCallback;
  }
}

/**
 * @typedef {function} PlaceableModelMatrixMixin
 *
 * Adds a model matrix for this placeable.
 * Includes separate rotation, translation, and scale sub-matrices.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
export const PlaceableModelMatrixMixin = superclass => {

  // Must define some objects here so they are not repeated between classes.
  let trackerCounter = 0;

  return class extends superclass {
    /**
     * Store the entire model matrix as a single typed array.
     * Each 16-element matrix (per placeable) is accessed using an id.
     * @type {FixedLengthTrackingBuffer}
     */
    static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

    /**
     * Indicate that the underlying model matrix tracker may have changed, due to
     * a placeable getting added or removed.
     */
    static _incrementTrackerCounter() { trackerCounter += 1; }

    static get _trackerCounter() { return trackerCounter; }

    /** @type {number} */
    #trackerUpdateCounter = -1;

    /** @type {number} */
    get _trackerUpdateCounter() { return this.#trackerUpdateCounter; }

    /**
     * Placeholder to use as the model matrix. Will be updated by modelMatrixCallback.
     * @type {MatrixFloat32}
     */
    #modelMatrixData = MatrixFloat32.empty(4, 4);

    /** @type {function} */
    #modelMatrixCallback() {
      if ( this.#trackerUpdateCounter < this.constructor._trackerCounter ) {
        this.#modelMatrixData.arr = this.constructor.modelMatrixTracker.viewFacetById(this.placeableId);
        this.#trackerUpdateCounter = this.constructor._trackerCounter;
      }
      return this.#modelMatrixData;
    }

    /** @type {PlaceableModelMatrix} */
    modelMatrix = new PlaceableModelMatrix(this.#modelMatrixCallback.bind(this));

    /**
     * Create an id used for the model matrix tracking.
     * @type {string}
     */
    get placeableId() { return this.placeable.sourceId; }

    positionUpdated() {
      super.positionUpdated();
      this.calculateTranslationMatrix();
    }

    rotationUpdated() {
      super.rotationUpdated();
      this.calculateRotationMatrix();
    }

    scaleUpdated() {
      super.scaleUpdated();
      this.calculateScaleMatrix();
    }

    calculateTranslationMatrix() { return this.modelMatrix.translation; }

    calculateRotationMatrix() { return this.modelMatrix.rotation; }

    calculateScaleMatrix() { return this.modelMatrix.scale; }

    initialize() {
      this.constructor.modelMatrixTracker.addFacet({ id: this.placeableId, newValues: identityM.arr });
      this.constructor._incrementTrackerCounter();
      const mm = this.modelMatrix;
      this.calculateTranslationMatrix(mm.translation);
      this.calculateRotationMatrix(mm.rotation);
      this.calculateScaleMatrix(mm.scale);
      super.initialize();
    }

    destroy() {
      this.constructor.modelMatrixTracker.deleteFacet(this.placeableId);
      this.constructor._incrementTrackerCounter();
      this.modelMatrix = null;
      super.destroy();
    }
  }
}

// ----- NOTE: PlaceableFacesMixin ----- //

/**
 * @typedef {object} Faces
 *
 * Faces of a placeable object.
 * @prop {Polygon3d|null} top
 * @prop {Polygon3d|null} bottom
 * @prop {Polygon3d[]} sides
 */
// All CCW because default GPU test is counter-clockwise

const QUADS = {
  up: Quad3d.from4Points( // E.g., tile top.
    Point3d.tmp.set(-0.5, -0.5, 0),
    Point3d.tmp.set(-0.5, 0.5, 0),
    Point3d.tmp.set(0.5, 0.5, 0),
    Point3d.tmp.set(0.5, -0.5, 0),
  ),
  down: Quad3d.from4Points(
    Point3d.tmp.set(0.5, -0.5, 0),
    Point3d.tmp.set(0.5, 0.5, 0),
    Point3d.tmp.set(-0.5, 0.5, 0),
    Point3d.tmp.set(-0.5, -0.5, 0),
  ),
  south: Quad3d.from4Points( // E.g., wall facing south.
    Point3d.tmp.set(-0.5, 0, 0.5),
    Point3d.tmp.set(-0.5, 0, -0.5),
    Point3d.tmp.set(0.5, 0, -0.5),
    Point3d.tmp.set(0.5, 0, 0.5),
  ),
  north: Quad3d.from4Points(
    Point3d.tmp.set(0.5, 0, 0.5),
    Point3d.tmp.set(0.5, 0, -0.5),
    Point3d.tmp.set(-0.5, 0, -0.5),
    Point3d.tmp.set(-0.5, 0, 0.5),
  ),
  west: Quad3d.from4Points( // E.g., wall facing west.
    Point3d.tmp.set(0, -0.5, 0.5),
    Point3d.tmp.set(0, -0.5, -0.5),
    Point3d.tmp.set(0, 0.5, -0.5),
    Point3d.tmp.set(0, 0.5, 0.5),
  ),
  east: Quad3d.from4Points(
    Point3d.tmp.set(0, 0.5, 0.5),
    Point3d.tmp.set(0, 0.5, -0.5),
    Point3d.tmp.set(0, -0.5, -0.5),
    Point3d.tmp.set(0, -0.5, 0.5),
  ),
}

// Set the normals.
(function() {
  // QUADS.up is set correctly.
  // Multiply by -1 by hand to avoid "super" issues b/c PIXI.Point not yet extended.
  let n = QUADS.down.plane.normal;
  n.x = -n.x;
  n.y = -n.y;
  n.z = -n.z;

  n = QUADS.down.plane.normal;
  n.x = -n.x;
  n.y = -n.y;
  n.z = -n.z;
}());

/* Cannot use reverseOrientation b/c methods not fully defined on initial load.
QUADS.down = QUADS.up.clone().reverseOrientation();
QUADS.north = QUADS.south.clone().reverseOrientation();
QUADS.east = QUADS.west.clone().reverseOrientation();
*/

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
   * Construct the prototype faces.
   */
  initialize() {
    super.initialize();
    this._initializePrototypeFaces();
    this._updateFaces();
  }

  _initializePrototypeFaces() {
    if ( this._prototypeFaces.top instanceof Sphere ) {
      if ( !(this.faces.top instanceof Sphere) ) this.faces.top = this._prototypeFaces.top.clone();
      this.faces.bottom = null;
      this.faces.sides.length = 0;
      return;
    }
    if ( this._prototypeFaces.top ) this.faces.top = this._prototypeFaces.top._cloneEmpty(); // Preserves hole status.
    if ( this._prototypeFaces.bottom ) this.faces.bottom = this._prototypeFaces.bottom._cloneEmpty();
    const numSides = this._prototypeFaces.sides.length;
    this.faces.sides.length = numSides;
    for ( let i = 0; i < numSides; i += 1 ) this.faces.sides[i] ??= this._prototypeFaces.sides[i]._cloneEmpty();
  }

  /**
   * Update the faces for this placeable.
   * Always updates using the model matrix.
   */
  _updateFaces() {
    const M = this.modelMatrix.model;
    if ( this._prototypeFaces.top ) this._prototypeFaces.top.transform(M, this.faces.top)
    if ( this._prototypeFaces.bottom ) this._prototypeFaces.bottom.transform(M, this.faces.bottom)
    for ( let i = 0, iMax = this._prototypeFaces.sides.length; i < iMax; i += 1 ) this._prototypeFaces.sides[i].transform(M, this.faces.sides[i]);
  }

  shapeUpdated() {
    super.shapeUpdated();
    this._updateFaces();
  }

  propertiesUpdated() {
    super.propertiesUpdated();
    this._initializePrototypeFaces();
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
    for ( const face of this.iterateFaces() ) {
      const t = this.constructor.rayIntersectionForFace(face, rayOrigin, rayDirection, opts);
      if ( t !== null ) return t;
    }
    return null;
  }

  static rayIntersectionForFace(face, rayOrigin, rayDirection, { minT = 0, maxT = 1 } = {}) {
    if ( !face.isFacing(rayOrigin) ) return null;
    const t = face.intersectionT(rayOrigin, rayDirection);
    if ( t !== null && almostBetween(t, minT, maxT) ) return t;
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

/**
 * @typedef {function} PlaceableFacePointsMixin
 *
 * Add face points for this placeable class.
 * Requires matrices.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */

/**
 * @typedef FacePoints
 *
 * Faces of a placeable object.
 * @prop {Point3d[]|null} top
 * @prop {Point3d[]|null} bottom
 * @prop {Point3d[][]} sides
 */

export const PlaceableFacePointsMixin = superclass => class extends superclass {

  /** @typedef {FacePoints} */
  facePoints = {
    top: null,
    bottom: null,
    sides: [],
  };

  _updateFaces() {
    super._updateFaces();
    this._generateFacePoints();
  }

  /**
   * For each face, generate points encompassed by its surface.
   */
  _generateFacePoints() {
    if ( !this.faces ) return; // Requires the FacesMixin.

    const opts = { spacing: CONFIG[GEOMETRY_LIB_ID].CONFIG.perPixelSpacing || 10, startAtEdge: false };
    if ( this.faces.top ) this.facePoints.top = this.faces.top.pointsLattice(opts);
    if ( this.faces.bottom ) this.facePoints.bottom = this.faces.bottom.pointsLattice(opts);

    // Process each side; store in equivalent structure to face.sides array.
    const numSides = this.faces.sides.length;
    this.facePoints.sides = new Array(numSides);
    for ( let i = 0; i < numSides; i += 1 ) this.facePoints.sides[i] = this.faces.sides[i].pointsLattice(opts);
  }
}
