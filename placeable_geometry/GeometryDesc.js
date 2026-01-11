/* globals
canvas,
CONFIG,
CONST,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "../const.js";
import { Triangle3d } from "../3d/Polygon3d.js";
import { setTypedArray } from "../util.js";
import { mix } from "../mixwith.js";
import {
  BasicVertices,
  HorizontalQuadVertices,
  VerticalQuadVertices,
  Rectangle3dVertices,
  Hex3dVertices,
  Ellipse3dVertices,
  SphereVertices,
  Polygon3dVertices,
} from "./BasicVertices.js";

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

  hasUVs = true;

  hasNormals = true;

  vertices = new Float32Array();

  indices = null;

  get stride() { return 3 + (this.hasUVs * 2) + (this.hasNormals * 3); }

  _lightCopy(out) {
    out ??= new this.constructor();
    out.hasUVs = this.hasUVs;
    out.hasNormals = this.hasNormals;
    return out;
  }

  clone(out) {
    out ??= this._lightCopy();
    out.vertices = new Float32Array(this.vertices);
    out.indices = this.indices ? new Uint16Array(this.indices) : null;
    return out;
  }

  transformToModel(modelMatrix, out) {
    out ??= this._lightCopy();
    out.vertices = new Float32Array(this.vertices); // Copy the vertices b/c transformVertexPositions will overwrite them.
    out.indices = this.indices;
    BasicVertices.transformVertexPositions(out.vertices, modelMatrix.model, { stride: this.stride });
    return out;
  }

  dropNormalsAndUVs({ keepNormals = false, keepUVs = false, out } = {}) {
    if ( !(this.hasNormals || this.hasUVs) || (keepNormals && keepUVs) ) return this.clone(out);
    out ??= this._lightCopy();

    const deletionLength = ((!keepNormals && this.hasNormals) * 3) + ((!keepUVs && this.hasUVs) * 2);
    const startingOffset = (keepNormals && this.hasNormals) ? 6 : 3;  // position (3), normals (3), uvs(2)

    out.vertices = BasicVertices.cutVertexData(this.vertices, { startingOffset, deletionLength, stride: this.stride });
    out.hasNormals &&= keepNormals;
    out.hasUVs &&= keepUVs;
    return out;
  }

  condense(out) {
    out ??= this._lightCopy();
    const res = BasicVertices.condenseVertexData(this.vertices, { stride: this.stride });
    out.vertices = res.vertices;
    out.indices = res.indices;
    return out;
  }

  toTriangles() { return Triangle3d.fromVertices(this.vertices, this.indices, { stride: this.stride }); }

  debugDraw(opts = {}) {
    opts.stride = this.stride;
    BasicVertices.debugDraw(this.vertices, this.indices, opts);
  }
}


/**
 * Describe a placeable by its vertices, normals, and uvs as an ideal 0.5 x 0.5 x 0.5 cube.
 * Includes region shapes.
 * Includes variations such as custom tokens and different hex-shapes for tokens.
 * Includes options for UVs, Normals.
 */
export class AbstractInstancedVertices {

  static type = "Abstract"; // Use type instead of this.name so subclasses may share instances.

  static addUVs = false;

  /** @type {Map<string, VertexIndexObject} */
  static instanceMap = new Map();

  /**
   * @param {boolean} [addNormals=false]        Add normal values to each vetex
   * @param {boolean} [addUVs]                  Add uv values to each vertex; default depends on object
   * @returns {VertexIndexObject}
   */
  static getVertexObject({ addNormals = false, addUVs = this.addUVs, ...opts } = {}) {
    const key = this._instanceKey(addNormals, addUVs, opts);
    if ( this.instanceMap.has(key) ) return this.instanceMap.get(key);
    else return this._addInstance(addNormals, addUVs, opts);
  }

  static getVertexObjectForPlaceable(placeable, opts = {}) {
    opts = this._optionsForPlaceable(placeable, opts);
    opts.addNormals ??= false;
    opts.addUVs ??= this.addUVs;
    return this.getVertexObject(opts);
  }

  static _optionsForPlaceable(placeable, opts) { return opts; }

  static labelArr(_opts) { return [this.type]; }

  static _instanceKey(addNormals = false, addUVs = this.addUVs, opts) {
    const labelArr = this.labelArr(opts);
    if ( addNormals ) labelArr.push("normals");
    if ( addUVs ) labelArr.push("uvs");
    return labelArr.join(".");
  }

  static _baseKey(opts) {
    const labelArr = this.labelArr(opts);
    labelArr.push("base");
    return labelArr.join(".");
  }

  static _addInstance(addNormals, addUVs, opts) {
    const base = this._getBaseInstance(opts);
    return this._getCondensedInstance(base, addNormals, addUVs, opts);
  }

  /**
   * Retrieve the vertices object before stripping out normals or UVs or condensing to indices.
   * @param {object} [opts]       Options used to create the instance
   * @returns {VertexObject}
   */
  static _getBaseInstance(opts) {
    const labelArr = this.labelArr(opts);
    const baseKey = this._baseKey(labelArr, opts);
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
  static _buildBaseInstance(opts) {
    const base = new VertexObject();
    base.vertices = this.calculateVertices(opts);
    return base;
  }

  /**
   * Convert a base vertices object into one that strips UVs/Normals and condenses to indices.
   * @param {object} [opts]       Options used to create the instance
   * @returns {VertexObject}
   */
  static _getCondensedInstance(base, addNormals, addUVs, opts) {
    const instanceKey = this._instanceKey(addNormals, addUVs, opts);
    if ( this.instanceMap.has(instanceKey) ) return this.instanceMap.get(instanceKey);
    const out = this._buildCondensedInstance(base, addNormals, addUVs);
    this.instanceMap.set(instanceKey, out);
    return out;
  }

  static _buildCondensedInstance(base, addNormals = false, addUVs = this.addUVs) {
    const out = base.dropNormalsAndUVs({ keepNormals: addNormals, keepUVs: addUVs });
    out.condense(out);
    return out;
  }

  static calculateVertices(_opts) { return new Float32Array(); }

  static calculateModelForPlaceable(placeable, opts = {}) {
    opts = this._optionsForPlaceable(placeable, {...opts}); // Shallow copy; avoid modifying the opts directly.
    const vo = this.getVertexObject(opts);
    return vo.transformToModel(placeable[GEOMETRY_LIB_ID][GEOMETRY_ID].modelMatrix);
  }
}


export class GeometryInstancedTile extends AbstractInstancedVertices {

  static type = "Tile";

  static addUVs = true;

  static calculateVertices() { return HorizontalQuadVertices.getUnitVertices("doubleUp"); }
}

export class GeometryInstancedWall extends AbstractInstancedVertices {

  static type = "Wall";

  static labelArr({ direction = "double", ...opts } = {}) {
    const arr = super.labelArr(opts);
    arr.push(VerticalQuadVertices.DIRECTIONS[direction]);
    return arr;
  }

  static _optionsForPlaceable(wall, opts = {}) {
    opts.direction = wall.document.direction ? "directional" : "double";
    return opts;
  }

  static calculateVertices({ direction = "double" } = {}) {
    // Directional south walls will be rotated 180º to match north.
    return VerticalQuadVertices.getUnitVertices(direction);
  }
}

export class GeometryInstancedToken extends AbstractInstancedVertices {

  static type = "Token";

  static shapeForToken(token) {
    if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.useTokenSphere ) return "spherical";
    if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.useChosenTokenShape ) return token.document.shape;

    // Per token#getShape
    // Gridless: ellipses or rectangles.
    const TS = CONST.TOKEN_SHAPES;
    if ( canvas.grid.isGridless ) {
      if ( token.document.shape === TS.TRAPEZOID_1
        || token.document.shape === TS.TRAPEZOID_2 ) return TS.RECTANGLE_1;
      return token.document.shape;
    }

    // Hex grids: only hexes.
    if ( canvas.grid.isHexagonal ) return token.document.shape === TS.TRAPEZOID_2
      ? TS.TRAPEZOID_2 : TS.TRAPEZOID_1;

    // Square grids: only rectangles.
    return token.document.shape === TS.RECTANGLE_2 ? TS.RECTANGLE_2 : TS.RECTANGLE_1;
  }

  static _optionsForPlaceable(token, opts = {}) {
    const TS = CONST.TOKEN_SHAPES;
    opts.shape = this.shapeForToken(token);
    switch ( opts.shape ) {
      case "spherical":
        opts.density = SphereVertices.defaultDensityForDimensions(opts.width, opts.height, token.topZ - token.bottomZ);
        break;

      case TS.ELLIPSE_1:
      case TS.ELLIPSE_2:
        opts.density = Ellipse3dVertices.defaultDensityForDimensions(opts.width, opts.height, token.topZ - token.bottomZ);
        break;

      case TS.TRAPEZOID_1:
      case TS.TRAPEZOID_2:
        opts.width = token.document.width;
        opts.height = token.document.height;
        break;

      /* Nothing to add for basic rectangles.
      case TS.RECTANGLE_1:
      case TS.RECTANGLE_2:
      */
    }
    return opts;
  }

  static labelArr({ shape, width = 1, height = 1, density, ...opts } = {}) {
    const arr = super.labelArr(opts);

    const TS = CONST.TOKEN_SHAPES;
    shape ??= TS.RECTANGLE_1;

    // Allow spherical to overide other settings.
    if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.useTokenSphere ) shape = "spherical";

    arr.push(`shape_${shape}`);
    switch ( shape ) {
      case "spherical": density ??= SphereVertices.defaultDensityForDimensions(width, height, Math.max(width, height));
      case TS.ELLIPSE_1: /* eslint-disable-line no-fallthrough */
      case TS.ELLIPSE_2: {
        density ??= Ellipse3dVertices.defaultDensityForDimensions(width, height);
        arr.push(`density_${density}`);
        break;
      }

      case TS.TRAPEZOID_1:
      case TS.TRAPEZOID_2: {
        arr.push(`width_${width.toPrecision(2)}`, `height_${height.toPrecision(2)}`)
        break;
      }

      /* Nothing to add for basic rectangles.
      case TS.RECTANGLE_1:
      case TS.RECTANGLE_2:
      */
    }
    return arr;
  }

  static calculateVertices({ shape, width = 1, height = 1, density } = {}) {
    const TS = CONST.TOKEN_SHAPES;
    shape ??= TS.RECTANGLE_1;
    switch ( shape ) {
      case TS.RECTANGLE_1:
      case TS.RECTANGLE_2: return Rectangle3dVertices._getUnitVertices();

      case "spherical": return SphereVertices._getUnitVertices(density);

      case TS.ELLIPSE_1:
      case TS.ELLIPSE_2: return Ellipse3dVertices._getUnitVertices(density);

      case TS.TRAPEZOID_1:
      case TS.TRAPEZOID_2: return Hex3dVertices.calculateVertices(shape, { width, height });
    }
  }
}

/**
 * Instantiated object that tracks vertices and indices for one-off shapes, like constrained tokens.
 */
export const AbstractModelVerticesMixin = superclass => class extends superclass {
  /** @type {PlaceableObject} */
  placeable;

  constructor(placeable) {
    super();
    this.placeable = placeable;
  }

  calculateModel(opts) {
    // Default to the instance vertices.
    return this.constructor.calculateModelForPlaceable(this.placeable, opts);
  }
}

export class ConstrainedTokenModelVertices extends mix(GeometryInstancedToken).with(AbstractModelVerticesMixin) {

  get token() { return this.placeable; }

  get instanced() { return !this.token.isConstrainedTokenBorder; }

  calculateModel(opts = {}) {
    if ( this.instanced ) return super.calculateModel(opts);

    // Get vertices for the constrained token polygon.
    const { topZ, bottomZ, constrainedTokenBorder } = this.token;
    const vo = new VertexObject();
    vo.vertices = Polygon3dVertices.calculateVertices(constrainedTokenBorder.toPolygon(), { topZ, bottomZ });
    vo.dropNormalsAndUVs({ keepNormals: opts.hasNormals, keepUVs: opts.hasUVs, out: vo });
    vo.condense(vo);
    return vo;
  }
}

export class LitTokenModelVertices extends mix(GeometryInstancedToken).with(AbstractModelVerticesMixin) {

  get token() { return this.placeable; }

  get instanced() {
    const { litTokenBorder, tokenBorder } = this.token;
    return litTokenBorder && litTokenBorder.equals(tokenBorder);
  }

  calculateModel(opts = {}) {
    if ( this.instanced ) return this.constructor.calculateModelForPlaceable(this.token, opts);

    // Get vertices for the constrained token polygon.
    const { litTokenBorder, topZ, bottomZ } = this.token;
    const border = litTokenBorder || this.placeable.constrainedTokenBorder;
    const vo = new VertexObject();
    vo.vertices = Polygon3dVertices.calculateVertices(border.toPolygon(), { topZ, bottomZ });
    vo.dropNormalsAndUVs({ keepNormals: opts.hasNormals, keepUVs: opts.hasUVs, out: vo });
    vo.condense(vo);
    return vo;
  }
}

export class BrightLitTokenModelVertices extends mix(GeometryInstancedToken).with(AbstractModelVerticesMixin) {

  get token() { return this.placeable; }

  get instanced() {
    const { litTokenBorder, tokenBorder } = this.token;
    return litTokenBorder && litTokenBorder.equals(tokenBorder);
  }

  calculateModel(opts = {}) {
    if ( this.instanced ) return this.constructor.calculateModelForPlaceable(this.token, opts);

    // Get vertices for the constrained token polygon.
    const { litTokenBorder, topZ, bottomZ } = this.token;
    const border = litTokenBorder || this.placeable.constrainedTokenBorder;
    const vo = new VertexObject();
    vo.vertices = Polygon3dVertices.calculateVertices(border.toPolygon(), { topZ, bottomZ });
    vo.dropNormalsAndUVs({ keepNormals: opts.hasNormals, keepUVs: opts.hasUVs, out: vo });
    vo.condense(vo);
    return vo;
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
      vertices: BasicVertices.transformVertexPositions(vertices, this._modelMatrix(placeable), { stride: this.stride }),
      indices: this.instanceIndices,
    }
  }

  _modelMatrix(placeable) { return placeable[GEOMETRY_LIB_ID][GEOMETRY_ID].modelMatrix; }
}

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

placeableGeometry = CONFIG.GeometryLib.lib.placeableGeometry;

GeometryInstancedTile = placeableGeometry.GeometryInstancedTile
GeometryInstancedTile.getVertexObject({ addNormals: true, addUVs: true })
tile = canvas.tiles.placeables[0]
vo = GeometryInstancedTile.calculateModelForPlaceable(tile)
vo.debugDraw({ color: Draw.COLORS.orange })

GeometryInstancedWall = placeableGeometry.GeometryInstancedWall
wall = canvas.walls.placeables[0]
vo = GeometryInstancedWall.calculateModelForPlaceable(wall)
vo.debugDraw({ color: Draw.COLORS.orange })

GeometryInstancedToken = placeableGeometry.GeometryInstancedToken
token = canvas.tokens.placeables[0]
vo = GeometryInstancedToken.calculateModelForPlaceable(token)
vo.debugDraw({ color: Draw.COLORS.orange })


ConstrainedTokenModelVertices = placeableGeometry.ConstrainedTokenModelVertices
token = canvas.tokens.placeables[0]
vModel = new ConstrainedTokenModelVertices(token);
vo = vModel.calculateModel()
vo.debugDraw({ color: Draw.COLORS.orange })


*/
