/* globals
canvas,
CONFIG,
CONST,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_LIB_ID } from "../const.js";
import { ModelMatrix, BasicVertices, HorizontalQuadVertices, VerticalQuadVertices, Hex3dVertices, SphereVertices } from "./BasicVertices.js";
import { setTypedArray } from "../util.js";


const STATIC_VERTEX_KEY = {
  0: "position",
  1: "positionNormal",
  2: "positionUV",
  3: "positionNormalUV",
};

/**
 * @typedef {object} VertexIndexObject
 *
 * Vertices and indices that represent an object.
 * @param {string} key            Key used in the AbstractInstancedVertices.instanceMap
 * @param {boolean} hasUVs        If true, includes UVs as part of the vertices
 * @param {boolean} hasNormals    If true, includes normals as part of the vertices
 * @param {TypedArray} vertices   Vertices for the object. Representation is [p.x, p.y, p.z|n.x, n.y, n.z|u, v]
 * @param {TypedArray} indices    Indices describing the shape for the given vertices
 *
 * Calculated
 * @type {number} stride          Stride for the vertices
 */
export class VertexObject {
  type = "";

  hasUVs = true;

  hasNormals = true;

  vertices = new Float32Array();

  indices = new Uint16Array();

  get key() { return `${this.type}${this.hasNormals ? ".normals" : ""}${this.hasUVs ? ".uvs" : ""}`; }

  get stride() { return 3 + (this.hasUVs * 3) + (this.hasNormals * 2); }

  _lightCopy(out) {
    out ??= new this();
    out.type = this.type;
    out.hasUVs = this.hasUVs;
    out.hasNormals = this.hasNormals;
    return out;
  }

  clone(out) {
    out ??= this._lightCopy();
    out.vertices = new Float32Array(this.vertices);
    out.indices = new Uint16Array(this.indices);
    return out;
  }

  transformToModel(modelMatrix, out) {
    out ??= this.clone();
    BasicVertices.transformVertexPositions(out.vertices, modelMatrix.model, this.stride);
    return out;
  }

  dropNormalsAndUVs({ keepNormals = false, keepUVs = false, out } = {}) {
    if ( !(this.hasNormals || this.hasUVs) ) return out ?? this.clone();
    if ( keepNormals && keepUVs ) return out ?? this.clone();
    out.vertices = BasicVertices.trimUVs(this.vertices, { stride: this.stride, keepNormals, keepUVs } = {});
    out.hasNormals = false;
    out.hasUVs = false;
    return out;
  }

  condense(out) {
    out ??= this._lightCopy();
    const res = BasicVertices.condenseVertexData(this.vertices, { stride: this.stride });
    out.vertices = res.vertices;
    out.indices = res.indices;
    return out;
  }
}


/**
 * Describe a placeable by its vertices, normals, and uvs as an ideal 0.5 x 0.5 x 0.5 cube.
 * Includes region shapes.
 * Includes variations such as custom tokens and different hex-shapes for tokens.
 * Includes options for UVs, Normals.
 */
export class AbstractInstancedVertices {

  static addUVs = false;

  /** @type {Map<string, VertexIndexObject} */
  static instanceMap = new Map();

  get vertexObject() { return this._getInstanceVertexObject({ addNormals: false, addUVs: this.addUVs }); }

  get vertexObjectWithNormals() { return this._getInstanceVertexObject({ addNormals: true, addUVs: this.addUVs }); }

  static _getInstanceVertexObject(opts) {
    const key = this.instanceKey(opts);
    if ( this.instanceMap.has(key) ) return this.instanceMap.get(key);
    else return this._addInstance(opts);
  }

  static _instanceKey(opts = {}) {
    return `${this._baseKey}${opts.addNormals ? ".normals" : ""}${opts.addUVs ? ".uvs" : ""}`;
  }

  static _baseKey(opts) { return `${this.name}_${opts.type}`}

  static _addInstance(opts = {}) {
    const base = this._getBaseInstance(opts);
    const out = this._getCondensedInstance(base, opts);
    return out;
  }

  /**
   * Retrieve the vertices object before stripping out normals or UVs or condensing to indices.
   * @param {object} [opts]       Options used to create the instance
   * @returns {VertexObject}
   */
  _getBaseInstance(opts = {}) {
    const baseKey = this._baseKey(opts);
    if ( this.instanceMap.has(baseKey) ) return this.instanceMap.get(baseKey);
    const base = this._buildBaseInstance(opts);
    this.instanceMap.set(baseKey, base);
    return base;
  }

  /**
   * Build the vertices object before stripping out normals or UVs or condensing to indices.
   * @param {object} [opts]       Options used to create the instance
   * @returns {VertexObject}
   */
  _buildBaseInstance(opts = {}) {
    const base = new VertexObject();
    base.type = opts.type;
    base.vertices = this.calculateVertices(opts);
    return base;
  }

  /**
   * Convert a base vertices object into one that strips UVs/Normals and condenses to indices.
   * @param {object} [opts]       Options used to create the instance
   * @returns {VertexObject}
   */
  _getCondensedInstance(base, opts = {}) {
    const instanceKey = this._instanceKey(opts);
    if ( this.instanceMap.has(instanceKey) ) return this.instanceMap.get(instanceKey);
    const out = this._buildCondensedInstance(base, opts);
    this.instanceMap.set(baseKey, out);
    return out;
  }

  _buildCondensedInstance(base, opts = {}) {
    const out = base.dropNormalsAndUVs({ keepNormals: opts.addNormals, keepUVs: opts.addUVs });
    out.condense(out);
    return out;
  }


  static calculateVertices(_opts) { return new Float32Array(); }
}

export class AbstractModelVertices extends AbstractInstancedVertices {

}




export class GeometryInstancedTile extends AbstractInstancedVertices {

  static addUVs = true;

  static _baseKey(opts = {}) { return `${this.name}`; }

  static calculateVertices() { return HorizontalQuadVertices.getUnitVertices("doubleUp"); }

}

export class GeometryInstancedWall extends AbstractInstancedVertices {

  static instanceKey({ direction, ...opts } = {}) {


    direction ??= "double"; // double or directional.
    opts.type = `Wall_${direction}`;
    return super.instanceKey(opts);
  }

  static instanceKeyForPlaceable(wall, opts) {
    opts.direction = wall.document.direction ? "directional" : "double";
    return this.instanceKey(opts);
  }

  static calculateVertices({ direction = "double" } = {}) {
    // Directional south walls will be rotated 180º to match north.
    return VerticalQuadVertices[VerticalQuadVertices.DIRECTIONS[direction]];
  }
}

export class GeometryInstancedToken extends AbstractInstancedVertices {
  static instanceKey({ direction, ...opts } = {}) {
    direction ??= "double"; // double or directional.
    opts.type = `Wall_${direction}`;
    return super.instanceKey(opts);
  }

  static instanceKeyForPlaceable(token, opts) {
    // Allow spherical to overide other settings.
    if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.useTokenSphere ) opts.shapeType = "spherical";

    // Allow config to always use the chosen token shape.
    else if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.useChosenTokenShape ) opts.shapeType = token.document.shape;

    // Otherwise, follow token.getShape approach.
    // Gridless: ellipse or rectangle.
    // Square or Hex: use grid shape.
    // Allow either ellipse or rectangle, but not hexes (higher numbers).
    else if ( canvas.grid.isGridless ) opts.shapeType = Math.min(token.shape.document, CONST.TOKEN_SHAPES.RECTANGLE_2);
    else if ( canvas.grid.isHex ) opts.shapeType = CONST.TOKEN_SHAPES.TRAPEZOID_1;
    else opts.shapeType = CONST.TOKEN_SHAPES.RECTANGLE_1;

    // opts.width =

    return super.instanceKey(opts);
  }

  static calculateVertices({ shapeType, hexagonalShape = 0, width = 1, height = 1 } = {}) {
    const TS = CONST.TOKEN_SHAPES;
    switch ( shapeType ) {
      case TS.RECTANGLE_1:
      case TS.RECTANGLE_2: return this.Rectangle3dVertices.calculateVertices();

      case "spherical":
      case TS.ELLIPSE_1:
      case TS.ELLIPSE_2: return SphereVertices.calculateSphericalVertices();

      case TS.TRAPEZOID_1:
      case TS.TRAPEZOID_2: return Hex3dVertices.calculateVertices(hexagonalShape, { width, height });
    }
  }

}













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


