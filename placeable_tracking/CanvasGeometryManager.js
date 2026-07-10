/* globals
canvas,
foundry,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// LibGeometry
import { LevelBackgroundGeometry, LevelForegroundGeometry } from "../placeable_geometry/LevelGeometry.js";
import { RegionGeometry } from "../placeable_geometry/RegionGeometry.js";
import { TileGeometry } from "../placeable_geometry/TileGeometry.js";
import { TokenGeometry } from "../placeable_geometry/TokenGeometry.js";
import { WallGeometry } from "../placeable_geometry/WallGeometry.js";

/* Manage geometry for the scene.

For each document, track its associated 3d geometry.
Manage hooks and trigger updates.

*/

export class CanvasGeometryManager {

  /** @type { PlaceableGeometry } */
  static geometryClass = null;

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
   * @param {string} id
   * @returns {PlaceableGeometry}
   */
  geomForPlaceableId(id) {
    const uuid = id.split("_")[0];
    if ( !uuid ) return null;
    return this.geometryMap.get(uuid);
  }

  /**
   * For every relevant document in the scene, initialize the geometry.
   */
  initializeScene() {
    const layer = this.constructor.geometryClass.LAYER;
    const docs = canvas.scene[layer];
    docs.forEach(doc => this.create(doc));
  }

  /**
   * Create a new geometry for the document.
   * @param {CanvasDocument} doc        A document instance, e.g., TokenDocument, WallDocument, etc.
   */
  create(doc) {
    if ( doc.documentName !== this.constructor.geometryClass.PLACEABLE_NAME ) return;
    if ( this.geometryMap.has(doc.uuid) ) return;

    // Create the correct geometry type for this document.
    const geom = new this.constructor.geometryClass(doc);
    geom.initialize();
    this.geometryMap.set(doc.uuid, geom);

    // Add to the respective quadtree.
    this.quadtree.insert({ t: geom, r: geom.aabb });
  }

  /**
   * Update the geometry for this document.
   * @param {CanvasDocument} doc        A document instance, e.g., TokenDocument, WallDocument, etc.
   * @param {Set<string>} updateKeys       Flattened set of properties that changed
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
    const uuid = `Scene.${canvas.scene.id}.${this.constructor.geometryClass.PLACEABLE_NAME}.${id}`;
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
  #initialized = false;

  /**
   * Register hooks to track the geometries as documents change.
   */
  registerHooks() {
    if ( this.#initialized ) return;

    const docName = this.constructor.geometryClass.PLACEABLE_NAME;
    Hooks.on("canvasReady", () => this.initializeScene());
    Hooks.on(`create${docName}`, doc => this.create(doc));
    Hooks.on(`update${docName}`, (doc, changeData) => {
      // Flatten the change object to handle nested keys, like flags.
      const updateKeys = Object.keys(foundry.utils.flattenObject(changeData));
      this.update(doc, new Set(updateKeys));
    });
    Hooks.on(`delete${docName}`, docId => this.delete(docId));

    this.constructor.geometryClass.registerHooks();

    this.#initialized = true;
  }

}

// ----- NOTE: Subclasses ----- //

export class TileGeometryManager extends CanvasGeometryManager {

  /** @type {PlaceableGeometry} */
  static geometryClass = TileGeometry;

}

export class WallGeometryManager extends CanvasGeometryManager {

  /** @type {PlaceableGeometry} */
  static geometryClass = WallGeometry;

  /**
   * @param {string} id
   * @returns {PlaceableGeometry}
   */
  geomForPlaceableId(id) {
    const [uuid, subId] = id.split("_");
    if ( !uuid ) return null;
    const geom = this.geometryMap.get(uuid);
    if ( !subId ) return geom;
    return geom.segmentGeoms[subId];
  }
}

export class RegionGeometryManager extends CanvasGeometryManager {

  /** @type {PlaceableGeometry} */
  static geometryClass = RegionGeometry;

}

export class TokenGeometryManager extends CanvasGeometryManager {

  /** @type {PlaceableGeometry} */
  static geometryClass = TokenGeometry;
}

export class LevelBackgroundGeometryManager extends CanvasGeometryManager {

  /** @type {PlaceableGeometry} */
  static geometryClass = LevelBackgroundGeometry;
}

export class LevelForegroundGeometryManager extends CanvasGeometryManager {

  /** @type {PlaceableGeometry} */
  static geometryClass = LevelForegroundGeometry;

}

// ----- NOTE: Helper functions ----- //

function isString(value) { return typeof value === 'string' || value instanceof String; }
