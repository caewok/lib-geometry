/* globals
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_LIB_ID } from "../const.js";
import { BasicVertices } from "./BasicVertices.js";
import { setTypedArray } from "../util.js";

const STATIC_VERTEX_KEY = {
  0: "position",
  1: "positionNormal",
  2: "positionUV",
  3: "positionNormalUV",
};

/* Example usage.

1. Instanced object, e.g. wall.

Define single geom with wall params. geom = new GeometryWall({ ... });
geom.vertices --> points to instanced vertices
geom.indices --> points to instanced indices
geom.updateModel(modelMatrix) --> recalculates the vertices and indices using modelMatrix
geom.calculateTransformMatrix --> determine the model matrix

Set temporarily for given wall
geom.placeable = wall --> triggers update
geom.modelVertices --> calculate the model vertices
geom.modelIndices --> calculate the model indices
geom.updateModel --> recalculate for given placeable
geom.transformMatrix --> switch matrices; force recalc when modelVertices used again.

2. Non-instanced object, e.g., constrained token.
Define single geom per token. geomToken = new GeometryConstrainedToken({ placeable: token, ...});
geom.placeable = token --> change the underlying placeable
geom.vertices --> points to model vertices
geom.indices --> points to model indices

*/

/**
 * Describe a placeable by its vertices, normals, and uvs.
 * Typically 1x1x1 centered at origin 0,0,0.
 * Can be either instanced or not.
 * - instanced: vertices are static
 * - not instanced: vertices based on placeable
 */
export class AbstractGeometry {
  constructor(placeable, { addUVs = false, addNormals = false } = {}) {
    this.#placeable = placeable;
    this.id = placeable.sourceId ?? foundry.utils.randomID();
    this.#addUVs = addUVs;
    this.#addNormals = addNormals;
  }

  static create(placeable, opts) {
    const out = new this(placeable, opts);
    out.initialize(opts);
  }

  /** @type {string} */
  id = foundry.utils.randomID();

  initialize() { }

  // ----- NOTE: Defined at constructor only ----- //

  /** @type {PlaceableObject} */
  #placeable;

  get placeable() { return this.#placeable}

  // ----- NOTE: Properties that trigger a recalculation ---- //

  /** @type {boolean} */
  #addNormals = false;

  get addNormals() { return this.#addNormals; }

  set addNormals(value ) {
    if ( this.#addNormals !== value ) this.initialize();
    this.#addNormals = value;
  }

  /** @type {boolean} */
  #addUVs = false;

  get addUVs() { return this.#addUVs; }

  set addUVs(value ) {
    if ( this.#addUVs !== value ) this.initialize();
    this.#addUVs = value;
  }

  // ----- NOTE: Derived properties ----- //
  get instanced() { return false; }

  get stride() { return 3 + (this.addNormals * 3) + (this.addUVs * 2); }

  // ----- NOTE: Instance vertices and indices ----- //

  instanceIndices;

  instanceVertices;

  // ----- NOTE: Model vertices and indices ----- //

  modelIndices;

  modelVertices;

  // Either model or instance vertices, depending on subclass.
  indices;

  vertices;

  /**
   * Trigger the calculation of the model using current settings and current placeable position.
   */
  calculateModel(placeable = this.placeable) {
    const res = this._calculateModel(this.modelVertices, this.modelIndices, placeable);
    if ( res.vertices ) this.modelVertices = res.vertices ? setTypedArray(this.modelVertices, res.vertices) : new Float32Array();
    if ( res.indices ) this.modelIndices = res.indices ? setTypedArray(this.modelIndices, res.indices) : new Uint16Array();
  }

  _calculateModel(_vertices, _indices, _placeable) { console.error(`${this.constructor.name}|_calculateModel must be defined by subclass.`); }

  // ----- NOTE: Other static methods ----- //

  /**
   * Determine the buffer offsets to store vertex data for a given group of geometries.
   * @param {number} idx            Which vertexData index to use.
   * @param {GeometryDesc[]}  geoms The geometries used in the buffer
   * @returns {object}
   * - @prop {array} offsets        In byteLength; sum of the sizes iteratively
   * - @prop {array} sizes          In byteLength
   * - @prop {array} numVertices      Number of vertices in each
   * - @prop {number} totalVertices Sum of the numVertices
   * - @prop {number} totalSize     Sum of the sizes
   */
  static computeBufferOffsets(geoms) {
    const ln = geoms.length;
    const out = {
      vertex: {
        offsets: new Uint16Array(ln), // Byte size of vertices consecutively summed.
        sizes: new Uint16Array(ln),   // Byte size of vertices.
        lengths: new Uint16Array(ln), // Length of vertices (number components * number of vertices).
        num: new Uint16Array(ln),     // Number of vertices.
        cumulativeNum: new Uint16Array(ln), // Cumulative sum of number of vertices.
        totalLength: 0,
        totalSize: 0,
      },
      index: {
        offsets: new Uint16Array(ln),
        sizes: new Uint16Array(ln),
        lengths: new Uint16Array(ln),
        totalLength: 0,
        totalSize: 0,
      }
    };
    if ( !ln ) return out;

    // Set the initial vertex values.
    const geom = geoms[0];
    const vs = geom.vertices;
    out.vertex.totalSize += out.vertex.sizes[0] = vs.byteLength;
    out.vertex.totalLength += out.vertex.lengths[0] = vs.length;
    out.vertex.num[0] = geom.numVertices;

    // Set the optional initial index values.
    const is = geom.indices
    out.index.totalSize += out.index.sizes[0] = is?.byteLength ?? 0;
    out.index.totalLength += out.index.lengths[0] = is?.length ?? 0;

    // Process the remaining geoms and iteratively sum values.
    for ( let i = 1; i < ln; i += 1 ) {
      const geom = geoms[i];
      const vs = geom.vertices;

      out.vertex.totalSize += out.vertex.sizes[i] = vs.byteLength;
      out.vertex.totalLength += out.vertex.lengths[i] = vs.length;
      out.vertex.num[i] = geom.numVertices;

      // Optional indices
      const is = geom.indices
      out.index.totalSize += out.index.sizes[i] = is?.byteLength ?? 0;
      out.index.totalLength += out.index.lengths[i] = is?.length ?? 0;

      // Iterative sum of sizes for the offsets and cumulative number.
      out.vertex.offsets[i] += out.vertex.offsets[i - 1] + out.vertex.sizes[i - 1];
      out.vertex.cumulativeNum[i] += out.vertex.cumulativeNum[i - 1] + out.vertex.num[i - 1];
      out.index.offsets[i] += out.index.offsets[i - 1] + out.index.sizes[i - 1];
    }
    return out;
  }

  // ----- NOTE: Debug ----- //

  debugDrawInstance(opts = {}) {
    const { vertices, indices } = this.instanceVerticesIndices;
    opts.addNormal ??= this.addNormals;
    opts.addUVs ??= this.addUVs;
    BasicVertices.debugDraw(vertices, indices, opts);
  }

  debugDrawModel(opts = {}) {
    const { vertices, indices } = this;
    opts.addNormal ??= this.addNormals;
    opts.addUVs ??= this.addUVs;
    BasicVertices.debugDraw(vertices, indices, opts);
  }
}


export class GeometryNonInstanced extends AbstractGeometry {

  _update() { this.calculateModel(); }

  // ----- NOTE: Instance properties ----- //

  get instanceIndices() { return null; }

  get instanceVertices() { return null; }

  // ----- NOTE: Model properties ----- //

  modelVertices = new Float32Array();

  modelIndices = new Uint16Array();

  get vertices() { return this.modelVertices; }

  get indices() { return this.modelIndices; }

  // ----- NOTE: Model methods ----- //

  _calculateModel(vertices, _indices, _placeable) {
     const { addNormals, addUVs } = this;
     const vs = this._calculateModelVertices(vertices);
     return BasicVertices.trimVertexData(vs, { addNormals, addUVs });
  }

  _calculateModelVertices(_vertices) {
    console.error(`${this.constructor.name}|_calculateModelVertices must be defined by subclass.`);
  }
}

export class GeometryInstanced extends AbstractGeometry {

  constructor(type, opts) {
    opts.type ??= type;
    super(undefined, opts);
  }

  initialize(opts) {
    this.#type = opts.type;
    this.defineInstance(opts);
  }

  // ----- NOTE: Defined at constructor only ----- //

  /** @type {string} */
  #type = "";

  get type() { return this.#type; }

  // ----- NOTE: Derived properties ----- //

  get instanceType() { return `${this.constructor.name}_${this.#type}`; }

  get instanced() { return true; }

  // ----- NOTE: Instance vertices and indices ---- //

  /**
   * Map of the different instance vertices/indices for different types.
   * e.g. addNormals vs not addNormals
   */
  static instanceMap = new Map();

  instanceIndices = new Uint16Array();

  instanceVertices = new Float32Array();

  get vertices() { return this.instanceVertices; }

  get indices() { return this.instanceIndices; }

  defineInstance() {
    const map = this.constructor.instanceMap;
    const key = this.instanceKey;
    let trimmed;
    if ( map.has(key) ) trimmed = map.get(key);
    else {
      const vs = this._defineInstanceVertices();
      const { addNormals, addUVs } = this;
      trimmed = BasicVertices.trimVertexData(vs, { addNormals, addUVs });
      map.set(key, trimmed);
    }
    this.instanceIndices = trimmed.indices;
    this.instanceVertices = trimmed.vertices;
  }

  _defineInstanceVertices() {
    console.error(`${this.constructor.name}|_defineInstanceVertices must be defined by subclass.`);
  }

  get instanceKey() {
    const i = this.addNormals + (this.addUVs * 2);
    return `${STATIC_VERTEX_KEY[i]}_${this.instanceType}`;
  }

  // ----- NOTE: Model vertices and indices ----- //

  modelVertices = new Float32Array();

  modelIndices = new Uint16Array();

  _calculateModel(vertices, _indices, placeable) {
    vertices = setTypedArray(vertices, this.instanceVertices);
    return {
      vertices: BasicVertices.transformVertexPositions(vertices, this._modelMatrix(placeable), this.stride),
      indices: this.instanceIndices,
    }
  }

  _modelMatrix(placeable) { return placeable[GEOMETRY_LIB_ID].geometry.modelMatrix; }
}


