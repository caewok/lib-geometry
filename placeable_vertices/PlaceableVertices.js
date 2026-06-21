/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "../const.js";
import { combineTypedArrays } from "../util.js";
import { Triangle3d } from "../3d/Polygon3d.js";
import { BasicVertices } from "./BasicVertices.js";

/**
 * Describe a placeable by its vertices, normals, and uvs as an ideal 0.5 x 0.5 x 0.5 cube.
 * Includes region shapes.
 * Includes variations such as custom tokens and different hex-shapes for tokens.
 * Includes options for UVs, Normals.
 * Placeable is described by its top, then sides, then bottom. So that top vertices can be extracted.
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
    const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.geomForPlaceable(placeable);
    return vo.transformToModel(geom.modelMatrix);
  }

  // Instantiation, for model-based vertices.

  /** @type {PlaceableObject} */
  placeable;

  constructor(placeable) {
    this.placeable = placeable;
  }

  calculateModel(opts) {
    return this.constructor.calculateModelForPlaceable(this.placeable, opts);
  }

  getVertexObject(opts) {
    return this.constructor.getVertexObjectForPlaceable(this.placeable, opts);
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

placeableVertices = CONFIG.GeometryLib.lib.placeableVertices;

TileInstancedVertices = placeableVertices.TileInstancedVertices
TileInstancedVertices.getVertexObject({ addNormals: true, addUVs: true })
tile = canvas.tiles.placeables[0]
vo = TileInstancedVertices.calculateModelForPlaceable(tile)
vo.debugDraw({ color: Draw.COLORS.orange })

WallInstancedVertices = placeableVertices.WallInstancedVertices
wall = canvas.walls.placeables[0]
vo = WallInstancedVertices.calculateModelForPlaceable(wall)
vo.debugDraw({ color: Draw.COLORS.orange })

TokenInstancedVertices = placeableVertices.TokenInstancedVertices
token = canvas.tokens.placeables[0]
vo = TokenInstancedVertices.calculateModelForPlaceable(token)
vo.debugDraw({ color: Draw.COLORS.orange })


ConstrainedTokenModelVertices = placeableVertices.ConstrainedTokenModelVertices
token = canvas.tokens.placeables[0]
vModel = new ConstrainedTokenModelVertices(token);
vo = vModel.calculateModel()
vo.debugDraw({ color: Draw.COLORS.orange })


*/
