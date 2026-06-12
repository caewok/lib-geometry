/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// LibGeometry
import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "../const.js";

import { LevelGeometry } from "../placeable_geometry/LevelGeometry.js";
import { RegionGeometry } from "../placeable_geometry/RegionGeometry.js";
import { TileGeometry } from "../placeable_geometry/TileGeometry.js";
import { TokenGeometry } from "../placeable_geometry/TokenGeometry.js";
import { WallGeometry } from "../placeable_geometry/WallGeometry.js";

/* Manage geometry for the scene.

For each document, track its associated 3d geometry.
Manage hooks and trigger updates.

*/

export class CanvasGeometryManager {

  /** @type {enum<string>} */
  static LAYER_KEYS = {
    Level: "levels",
    Region: "regions",
    Tile: "tiles",
    Token: "tokens",
    Wall: "walls",
  };

  /** @type {enum<CanvasDocument>} */
  static DOCUMENT_KEYS = {
    Level: foundry.documents.LevelDocument,
    Region: foundry.documents.RegionDocument,
    Tile: foundry.documents.TileDocument,
    Token: foundry.documents.TokenDocument,
    Wall: foundry.documents.WallDocument,
  }

  /** @type {enum<PlaceableGeometry>} */
  static GEOMETRY_KEYS = {
    Level: LevelGeometry,
    Region: RegionGeometry,
    Tile: TileGeometry,
    Token: TokenGeometry,
    Wall: WallGeometry,
  }

  static get geometryClass() { return this.GEOMETRY_KEYS[this.TYPE]; }

  /** @type {object<Map<UUID, PlaceableGeometry>>} */
  geometryMap = new Map();

  /** @type {object<CanvasQuadtree>} */
  quadtree = new foundry.canvas.geometry.CanvasQuadtree();

  // TODO: Could add vertices as an option on construction.

  /**
   * @param {PlaceableObject} placeable
   * @returns {PlaceableGeometry}
   */
  geomForPlaceable(placeable) {
    if ( !this.geometryMap.has(placeable.document.uuid) ) this.create(placeable.document);
    return this.geometryMap.get(placeable.document.uuid);
  }

  /**
   * @param {CanvasDocument} doc
   * @returns {PlaceableGeometry}
   */
  geomForDocument(doc) {
    if ( !this.geometryMap.has(document.uuid) ) this.create(document);
    return this.geometryMap.get(doc.uuid);
  }

  /**
   * For every relevant document in the scene, initialize the geometry.
   */
  initializeScene() {
    for ( const doc of canvas.scene[this.constructor.TYPE] ) this.create(doc);
  }

  /**
   * Create a new geometry for the document.
   * @param {CanvasDocument} doc        A document instance, e.g., TokenDocument, WallDocument, etc.
   */
  create(doc) {
    if ( doc.documentName !== this.constructor.TYPE ) return;
    if ( this.geometryMap.has(doc.uuid) ) return;

    // Create the correct geometry type for this document.
    const geom = new this.constructor.geometryClass(doc);
    this.geometryMap.set(doc.uuid, geom);

    // Add to the respective quadtree.
    this.quadtree.insert({ t: geom, r: geom.aabb });
  }

  /**
   * Update the geometry for this document.
   * @param {CanvasDocument} doc        A document instance, e.g., TokenDocument, WallDocument, etc.
   * @param {string[]} updateKeys       Flattened string array of properties that changed
   */
  update(doc, updateKeys) {
    const geom = this.geometryMap.get(doc.uuid);
    if ( !geom ) return;
    geom.update(updateKeys);
    this.quadtree.update({ t: geom, r: geom.aabb });
  }

 /**
   * Update the geometry for this document.
   * @param {CanvasDocument|String} docOrId        A document instance or id string
   */
  delete(docOrId) {
    const id = isString(docOrId) ? docOrId : docOrId.id;
    const uuid = `Scene.${canvas.scene.id}.${this.constructor.TYPE}.id`;
    return this._deleteByUUID(uuid);
  }

  _deleteByUUID(uuid) {
    const geom = this.geometryMap.get(uuid);
    if ( !geom ) return;
    this.quadtree.remove(geom);
    this.geometryMap.delete(uuid);
  }

  /**
   * Clear all geometry data
   */
  clear() {
    this.geometryMap.clear();
    this.quadtree.clear();
  }

  /**
   * Bind the relevant hooks to this specific manager.
   */
  #initalized = false;

  registerHooks() {
    if ( this.#initialized ) return;

    const docName = this.constructor.Type;
    Hooks.on("canvasReady", () => this.initializeScene());
    Hooks.on(`create${docName}`, doc => this.create());
    Hooks.on(`update${docName}`, (doc, changeData) => {
      // Flatten the change object to handle nested keys, like flags.
      const updateKeys = Object.keys(foundry.utils.flattenObject(changeData));
      this.update(updateKeys);
    });
    Hooks.on(`delete${docName}`, docId => this.delete(docId));

    this.constructor.geometryClass.registerHooks();

    this.#initialized = true;
  }

}

// ----- NOTE: Subclasses ----- //

export class TileGeometryManager extends CanvasGeometryManager {

  /** @type {string} */
  static TYPE = "Tile";

}

export class WallGeometryManager extends CanvasGeometryManager {

  /** @type {string} */
  static TYPE = "Wall";

}

export class RegionGeometryManager extends CanvasGeometryManager {

  /** @type {string} */
  static TYPE = "Region";

}

export class TokenGeometryManager extends CanvasGeometryManager {

  /** @type {string} */
  static TYPE = "Token";

}

export class LevelGeometryManager extends CanvasGeometryManager {

  /** @type {string} */
  static TYPE = "Level";

}

// ----- NOTE: Helper functions ----- //

function isString(value) { return typeof value === 'string' || value instanceof String; }
