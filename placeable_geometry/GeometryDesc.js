/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "../const.js";
import { Triangle3d } from "../3d/Polygon3d.js";
import { BasicVertices } from "./BasicVertices.js";

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

  static getVertexObjectForPlaceable(placeable, opts) {
    const vModel = new this(placeable);
    return vModel.calculateModel(opts);
  }
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

TileInstancedVertices = placeableGeometry.TileInstancedVertices
TileInstancedVertices.getVertexObject({ addNormals: true, addUVs: true })
tile = canvas.tiles.placeables[0]
vo = TileInstancedVertices.calculateModelForPlaceable(tile)
vo.debugDraw({ color: Draw.COLORS.orange })

WallInstancedVertices = placeableGeometry.WallInstancedVertices
wall = canvas.walls.placeables[0]
vo = WallInstancedVertices.calculateModelForPlaceable(wall)
vo.debugDraw({ color: Draw.COLORS.orange })

TokenInstancedVertices = placeableGeometry.TokenInstancedVertices
token = canvas.tokens.placeables[0]
vo = TokenInstancedVertices.calculateModelForPlaceable(token)
vo.debugDraw({ color: Draw.COLORS.orange })


ConstrainedTokenModelVertices = placeableGeometry.ConstrainedTokenModelVertices
token = canvas.tokens.placeables[0]
vModel = new ConstrainedTokenModelVertices(token);
vo = vModel.calculateModel()
vo.debugDraw({ color: Draw.COLORS.orange })


*/
