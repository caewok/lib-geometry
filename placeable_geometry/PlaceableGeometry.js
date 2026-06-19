/* globals
canvas,
CONFIG,
CONST,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { FixedLengthTrackingBuffer } from "../placeable_tracking/TrackingBuffer.js";

// LibGeometry
import { GEOMETRY_LIB_ID } from "../const.js";
import { MatrixFloat32, ModelMatrix } from "../Matrix.js";
import { AABB3d } from "../3d/AABB3d.js";
import { Quad3d, Ellipse3d, Polygon3d } from "../3d/Polygon3d.js";
import { almostBetween } from "../util.js";
import { Point3d } from "../3d/Point3d.js";
import { VertexObject } from "../placeable_vertices/VertexObject.js";
import { combineTypedArrays, NULL_SET } from "../util.js";
import { getHexagonalShape } from "../placeable_vertices/BasicVertices.js";

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


export class PlaceableGeometry {

  // ----- NOTE: Static values ----- //

  static get PLACEABLE_LABEL_PLURAL() { return this.PLACEABLE_NAME.toLowerCase().concat("s"); }

  static hooksInitialized = false;

  static registerHooks() {
    if ( this.hooksInitialized ) return;
    this._registerHooks();
    this.hooksInitialized = true;
  }

  static _registerHooks() { }

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
   * @param {CanvasDocument} placeable
   */
  constructor(placeableDocument) { this.placeableDocument = placeableDocument; }

  initialize() { }

  static UPDATE_KEYS = {
    properties: NULL_SET,
    level: NULL_SET,
    position2d: NULL_SET,
    elevation: NULL_SET,
    scale: NULL_SET,
    rotation: NULL_SET,
  };

  // Temporary tracking of the updates made for a given update.
  _updateFlags = {
    properties: false,
    level: false,
    position2d: false,
    elevation: false,
    scale: false,
    rotation: false,
  };

  /**
   * @param {Set<string>} updateKeys      Flattened keys that were updated
   */
  update(updateKeys) {
    const updateFlags = this._updateFlags;
    Object.keys(updateFlags).forEach(key => updateFlags[key] = false);

    // Update in order. If any updates, update the shape.
    let shapeUpdated = false;
    for ( const [type, s] of Object.entries(this.constructor.UPDATE_KEYS) ) {
      if ( !s.intersects(updateKeys) ) continue;
      this[`${type}Updated`]();
      updateFlags[type] = true;
    }
    if ( shapeUpdated ) this.shapeUpdate();
  }

  // Triggered first for defined properties.
  propertiesUpdated() { }

  // Triggered second.
  levelUpdated() { }

  position2dUpdated() { }

  elevationUpdated() { }

  scaleUpdated() { }

  rotationUpdated() { }

  // Triggered last, if any properties are updated.
  shapeUpdated() { }

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
    delete this._model;
    this.#modelMatrixCallback = modelMatrixCallback;
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
    get placeableId() { return this.placeableDocument.uuid; }

    position2dUpdated() {
      super.position2dUpdated();
      this.calculateTranslationMatrix();
    }

    elevationUpdated() {
      if ( !this._updateFlags.position2d ) this.calculateTranslationMatrix();
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

export const QUADS = {
  up: Quad3d.from4Points(
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
};

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
   * @typedef {Polygon3d} Face
   *
   * Face of a placeable object, meaning a 3d planar object.
   */

  /** @type {Face[]} */
  static prototypeFaces = [];

  /** @type {Face[]} */
  faces = [];

  /**
   * Iterate over the faces.
   * @param {object} [_opts]        Used by child classes, like WallGeometry
   * @yields {Face}
   */
  *iterateFaces(_opts) { yield* this.faces.values(); }

  /**
   * Construct the prototype faces.
   */
  initialize() {
    LEVEL_SEGMENTS ??= PlaceableGeometry.segmentLevels();
    this.constructor.prototypeFaces.forEach(f => this.faces.push(f.clone()));
    super.initialize();
    this._updateFaces();
  }

  /**
   * Update the faces for this placeable.
   * Always updates using the model matrix.
   */
  _updateFaces() {
    const M = this.modelMatrix.model;
    const numSides = this.constructor.prototypeFaces.length;
    for ( let i = 0; i < numSides; i += 1 ) this.constructor.prototypeFaces[i].transform(M, this.faces[i]);
  }

  shapeUpdated() {
    super.shapeUpdated();
    this._updateFaces();
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
    for ( const face of this.iterateFaces(opts) ) {
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
    for ( const face of this.iterateFaces(opts) ) face.draw2d(opts);
  }
}

/**
 * @typedef {function} PlaceableFacePointsMixin
 *
 * Add face points for this placeable class.
 * Requires matrices, PlaceableFacesMixin..
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
  facePoints = [];

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
    const numSides = this.faces.length;
    for ( let i = 0; i < numSides; i += 1 ) this.facePoints[i] = this.faces[i].pointsLattice(opts);
  }
}

/**
 * @typedef {function} PlaceableVerticesMixin
 *
 * Create vertices for the placeable faces.
 * Requires PlaceableFacesMixin.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
export const PlaceableVerticesMixin = superclass => class extends superclass {

  /**
   * Vertices with normals and indices.
   * @type {object<VertexObject>}
   */
  static instanceVO = new VertexObject();

  /**
   * Vertices with normals and indices.
   * @type {object<VertexObject>}
   */
  modelVO = new VertexObject();

  /**
   * Update instance vertices.
   * Default approach uses the prototype faces.
   */
  static updateInstanceVertices() {
    // Add vertices from faces.
    const vertices = this.constructor.verticesFromFaces(this.constructor.prototypeFaces, true);
    this.constructor.updateVertexObject(this.constructor.instanceVO, vertices);
    this.constructor.instanceVO.hasNormals = true;
    this.constructor.instanceVO.hasUVs = false;
  }

  /**
   * Update the model vertices for this placeable.
   * Default approach transforms them using the model matrix.
   * Alternatively, could use the faces.
   */
  _updateModelVertices() {
    // Uses the existing instance vertices and the model matrix.
    // Just like transforming prototype faces to model faces.
    this.constructor.instanceVO.transformToModel(this.modelMatrix.model, this.modelVO);
  }

  /**
   * Create vertices for this placeable using its faces.
   * @param {Polygon3d[]} faces
   * @param {boolean} [addNormals=false]
   * @returns {Float32Array} The vertices
   */
  static verticesFromFaces(faces, addNormals = true) {
    // Store each Float32 array for each face separately.
    const vertices = [];
    for ( const face of faces ) vertices.push(face.toVertices({ addNormals }));

    // Combine.
    return combineTypedArrays(vertices);
  }

  /**
   * Update a vertex object in place with vertices.
   * @param {VertexObject} vo
   * @param {Float32Array} vertices
   * @returns {VertexObject} The object, for convenience
   */
  static updateVertexObject(vo, vertices) {
    vo.indices = null;
    vo.vertices = vertices;
    vo.condense(vo);
    return vo;
  }
}

/**
 * Create the instance face shapes for a unit cube.
 * 1 x 1 x 1 centered at 0,0,0.
 * @returns {Face[]}
 */
export function createUnitCube() {
  const faces = [
    QUADS.up.clone(),
    QUADS.down.clone(),
    QUADS.north.clone(),
    QUADS.west.clone(),
    QUADS.south.clone(),
    QUADS.east.clone(),
  ];

  faces[0].setZ(0.5);
  faces[1].setZ(-0.5);

  // Adjust the sides so that they are at the region edge.
  for ( let i = 0; i < 4; i += 1 ) {
    faces[2].points[i].y = -0.5; // North.
    faces[3].points[i].x = -0.5; // West.
    faces[4].points[i].y = 0.5; // South.
    faces[5].points[i].x = 0.5; // East.
  }
  return faces;
}

/**
 * Create the instance face shapes for an unit ellipse cylinder.
 * Uses 1 x 1 x 0.5 b/c the scale matrix is set using the half-radii.
 * Have to guess at the likely radius for the vertex density.
 * @param {number} densityRadius      How dense to make the ellipse polygon edges.
 * @returns {Face[]}
 */
export function createUnitEllipseCylinder(densityRadius = 100) {
  const top = new Ellipse3d();
  const bottom = new Ellipse3d();

  top.radiusX = 1;
  top.radiusY = 1;
  top.clone(bottom);
  bottom.reverseOrientation();
  top.setZ(0.5);
  bottom.setZ(-0.5);

  const density = PIXI.Circle.approximateVertexDensity(densityRadius);
  return [top, bottom, ...top.buildTopSides(-0.5, { density })];
}

/**
 * Create the instance face shapes for an unit hexagon cylinder.
 * @returns {Face[]}
 */
export function createUnitHexagonalCylinder() {
  const res = getHexagonalShape(1, 1, CONST.TOKEN_SHAPES.TRAPEZOID_1, canvas.scene.grid.columns || false);
  let poly = new PIXI.Polygon(res.points);
  poly = poly.translate(-res.center.x, -res.center.y);
  const bounds = poly.getBounds();
  poly = poly.scale(1/bounds.width, 1/bounds.height);
  if ( poly.isPositive ) poly.reverseOrientation();
  const top = Polygon3d.fromPolygon(poly, 0.5);
  const bottom = top.clone();
  bottom.reverseOrientation();
  top.setZ(0.5);
  bottom.setZ(-0.5);
  return [top, bottom, ...top.buildTopSides(-0.5)];
}
