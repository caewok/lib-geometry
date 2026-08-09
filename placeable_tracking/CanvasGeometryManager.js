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
    geom.forceUpdate();
    this.geometryMap.set(doc.uuid, geom);

    // Add to the respective quadtree.
    this.quadtree.insert({ t: geom, r: geom.aabb });
  }

  /**
   * Update the geometry for this document.
   * @param {CanvasDocument} doc        A document instance, e.g., TokenDocument, WallDocument, etc.
   * @param {Set<string>} updateKeys       Flattened set of properties that changed
   * @param {object} opts               Options passed from update hook; currently used for tracking region shape changes
   */
  update(doc, updateKeys, opts) {
    const geom = this.geometryMap.get(doc.uuid);
    if ( !geom ) return;
    const updated = geom.update(updateKeys, opts);
    if ( updated ) this.quadtree.update({ t: geom, r: geom.aabb });
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
    geom.destroy();
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

  hooks = {};

  /**
   * Register hooks to track the geometries as documents change.
   */
  registerHooks() {
    if ( this.#initialized ) return false;

    const docName = this.constructor.geometryClass.PLACEABLE_NAME;
    const hooks = this.hooks;
    hooks.canvasReady = Hooks.on("canvasReady", () => this.initializeScene());
    hooks[`create${docName}`] = Hooks.on(`create${docName}`, doc => this.create(doc));
    hooks[`update${docName}`] = Hooks.on(`update${docName}`, (doc, changeData, opts, _userId) => {
      // Flatten the change object to handle nested keys, like flags.
      const updateKeys = Object.keys(foundry.utils.flattenObject(changeData));
      this.update(doc, new Set(updateKeys), opts);
    });
    hooks[`delete${docName}`] = Hooks.on(`delete${docName}`, docId => this.delete(docId));

    this.#initialized = true;
    return true;
  }

  deactivateHooks() {
    for ( const [name, id] of Object.entries(this.hooks) ) Hooks.off(name, id);
    this.hooks = {};
  }

  destroy() {
    this.deactivateHooks();
    for ( const geom of this.geometryMap.values() ) geom.destroy();
    this.clear();
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

  registerHooks() {
    if ( !super.registerHooks() ) return;

    // When tokens are dragged, the update hook provides the correct changes, which correspond
    // to the token.document._source but not necessarily to the token.document.x, .y, etc.
    // Tokens refresh along their move and the document is updated.
    // To keep the shape aligned with current token position (may be important for visibility),
    // need to update on the refresh hook.
    Hooks.on("refreshToken", (token, flags) => {
      /* Potential flags are at Token.RENDER_FLAGS. Key flags:
      refreshPosition
      refreshSize
      refreshElevation
      refreshShape
      */
      if ( token.isPreview ) return;

      // Flags have boolean values, but always seem to be set to true.
      if ( Object.values(flags).some(flag => !Boolean(flag)) ) console.warn("Some flags set to false.", { ...flags });
      this.update(token.document, new Set(Object.keys(flags)));
    });
  }
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
