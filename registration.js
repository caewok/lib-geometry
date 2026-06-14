/* globals
CONFIG,
foundry,
Hooks,
*/
"use strict";

import * as lib from "./_module.mjs";
import { MODULE_ID, GEOMETRY_LIB_OPTS } from "../const.js";
import { GEOMETRY_LIB_ID, VERSION } from "./const.js";
import { mergeConfigs } from "./config.js";
import { registerGeometryLibPatches } from "./patching.js";

import {
  TilePixelCacheManager,
  LevelForegroundPixelCacheManager,
  LevelBackgroundPixelCacheManager } from "./PixelCacheManager.js";

import {
  WallGeometryManager,
  TileGeometryManager,
  TokenGeometryManager,
  RegionGeometryManager,
  LevelBackgroundGeometryManager,
  LevelForegroundGeometryManager } from "./placeable_tracking/CanvasGeometryManager.js";


// Execute immediately on load to identify modules using lib geometry.
(() => {
  CONFIG[GEOMETRY_LIB_ID] ??= {};
  CONFIG[GEOMETRY_LIB_ID].CONFIG ??= {};

  // Share a map with registered versions to determine which GeometryLib controls.
  CONFIG[GEOMETRY_LIB_ID].CONFIG.registeredVersions ??= new Map();
  CONFIG[GEOMETRY_LIB_ID].CONFIG.registeredVersions.set(VERSION, MODULE_ID);

  // Track geometries need to load.
  CONFIG[GEOMETRY_LIB_ID].CONFIG.placeableGeometries ??= new Set();
  const geometries = GEOMETRY_LIB_OPTS.placeableGeometries;
  if ( geometries ) geometries.forEach(name => CONFIG[GEOMETRY_LIB_ID].CONFIG.placeableGeometries.add(name));
})();

let IS_CONTROLLING_MODULE = false;

/**
 * On init, determine which module has the most recent version of lib geometry.
 */
Hooks.on("init", function() {

  // Determine the maximum version.
  let maxVersion = VERSION;
  CONFIG[GEOMETRY_LIB_ID].CONFIG.registeredVersions.keys().forEach(v => {
    if ( foundry.utils.isNewerVersion(v, maxVersion) ) maxVersion = v;
  });
  mergeConfigs(maxVersion);

  const controllingModule = CONFIG[GEOMETRY_LIB_ID].CONFIG.registeredVersions.get(maxVersion);
  IS_CONTROLLING_MODULE = controllingModule === MODULE_ID
  if ( IS_CONTROLLING_MODULE ) registerGeometryLibClasses();
});

Hooks.on("setup", function() {
  if ( !IS_CONTROLLING_MODULE ) return;

  // Add Pixel cache manager for tiles and levels
  if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.placeableGeometries.has("Tile") ) {
    CONFIG[GEOMETRY_LIB_ID].tilePixelCache = new TilePixelCacheManager();
    CONFIG[GEOMETRY_LIB_ID].tilePixelCache.registerHooks();
  }
  if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.placeableGeometries.has("Level") ) {
    CONFIG[GEOMETRY_LIB_ID].levelBackgroundPixelCache = new LevelBackgroundPixelCacheManager();
    CONFIG[GEOMETRY_LIB_ID].levelForegroundPixelCache = new LevelForegroundPixelCacheManager();
    CONFIG[GEOMETRY_LIB_ID].levelBackgroundPixelCache.registerHooks();
    CONFIG[GEOMETRY_LIB_ID].levelForegroundPixelCache.registerHooks();
  }

  // Register the geometries.
  registerPlaceableGeometry();
  // deregisterPlaceableGeometry();
});

function registerGeometryLibClasses() {
  CONFIG[GEOMETRY_LIB_ID].lib = lib;
  registerGeometryLibPatches();

  /**
   * If quench is present, register tests.
   * Only register for the controlling module, not every module.
   * NOTE: This assumes the geometry library is found at /MODULE_ID/scripts/geometry.
   */
  Hooks.on("quenchReady", async (quench) => {
    try {
      const { registerTests } = await import(`/modules/${MODULE_ID}/scripts/geometry/tests/index.js`);
      registerTests(quench);
    } catch(err) {
      console.error("Failed to load Quench tests:", err);
    }
  });
}

/**
 * Register hooks for placeable geometry.
 */
function registerPlaceableGeometry() {
  if ( !CONFIG[GEOMETRY_LIB_ID].CONFIG.placeableGeometries.size ) return;
  const mgr = CONFIG[GEOMETRY_LIB_ID].geometryManager = new GeometryManager(CONFIG[GEOMETRY_LIB_ID].CONFIG.placeableGeometries);
  mgr.registerHooks();
}

/* TODO: Any deconstruction needed?
function deregisterPlaceableGeometry() {
  if ( !CONFIG[GEOMETRY_LIB_ID].CONFIG.placeableGeometries.size ) return;

  const GEOMETRY_MANAGERS = {
    Tile: TileGeometryManager,
    Region: RegionGeometryManager,
    Wall: WallGeometryManager,
    Token: TokenGeometryManager,
    Level: LevelGeometryManager,
  }

  Hooks.on("canvasTearDown", () => {

  });
}
*/

/**
 * Helper to manage the different placeable document geometries.
 */
class GeometryManager {

  static GEOMETRY_MANAGERS = {
    tile: TileGeometryManager,
    region: RegionGeometryManager,
    wall: WallGeometryManager,
    token: TokenGeometryManager,
    level: {
      background: LevelBackgroundGeometryManager,
      foreground: LevelForegroundGeometryManager,
    },
  };

  /**
   * @typedef {string} GeometryType
   * Wall|Tile|Region|Token|Level
   */

  /** @type {GeometryType[]} */
  types = [];

  /** @type {TileGeometryManager} */
  tile = null;

  /** @type {RegionGeometryManager} */
  region = null;

  /** @type {WallGeometryManager} */
  wall = null;

  /** @type {object<LevelGeometryManager>} */
  level = {
    background: null,
    foreground: null,
  }

  constructor(types) {
    this.types.push(...types.map(t => t.toLowerCase())); // For consistency.
    this.#createManagers();
  }

  #createManagers() {
    const GEOMETRY_MANAGERS = this.constructor.GEOMETRY_MANAGERS;
    for ( const type of this.types ) {
      // Create a manager for each type.
      if ( type === "level" ) {
        this.level.background = new GEOMETRY_MANAGERS.level.background();
        this.level.foreground = new GEOMETRY_MANAGERS.level.foreground();
      } else this[type] = new GEOMETRY_MANAGERS[type]();
    }
  }

  /**
   * Iterate through the valid managers.
   * @yield {GeometryManager}
   */
  *iterateManagers() {
     for ( const type of this.types ) {
       if ( type === "level" ) {
         yield this.level.background;
         yield this.level.foreground;
       } else yield this[type];
     }
  }

  /**
   * For every relevant document in the scene, initialize the geometry.
   */
  initializeScene() { for ( const mgr of this.iterateManagers() ) mgr.initializeScene(); }

  /**
   * Register hooks to track the geometries as documents change.
   */
  registerHooks() {
    for ( const mgr of this.iterateManagers() ) mgr.registerHooks();
  }

  /**
   * Retrieve the manager for a specific document.
   * @param {CanvasDocument|GeometryType} typeOrDoc
   * @param {"foreground"|"background"} [levelType="background"]      For Level docs, foreground or background texture?
   * @returns {GeometryManager}
   */
  _managerForDocument(typeOrDoc, levelType = "background") {
    const type = (typeOrDoc.documentName || typeOrDoc).toLowerCase();
    if ( type === "level" ) return this.level[levelType];
    return this[type];
  }

  /**
   * Find objects using quadtree for a specific type.
   * @param {CanvasDocument|GeometryType} typeOrDoc
   * @param {AABB} bounds             2d bounds
   * @param {object} [opts]
   * @param {"foreground"|"background"} [opts.levelType="background"]      For Level docs, foreground or background texture?
   * @param {object} ...opts          Passed to quadtree
   * @returns {Set<PlaceableGeometry>}
   */
  getGeometries(typeOrDoc, bounds, { levelType = "background", ...opts } = {}) {
    const mgr = this._managerForDocument(typeOrDoc, levelType);
    return mgr.quadtree.getObjects(bounds, opts);
  }

  /**
   * @param {CanvasDocument} typeOrDoc
   * @param {"foreground"|"background"} [levelType="background"]      For Level docs, foreground or background texture?
   * @returns {PlaceableGeometry}
   */
  geomForDocument(typeOrDoc, levelType = "background") {
    const mgr = this._managerForDocument(typeOrDoc, levelType);
    return mgr.geomForDocument(typeOrDoc);
  }

  /**
   * @param {PlaceableObject} placeable
   * @param {"foreground"|"background"} [levelType="background"]      For Level docs, foreground or background texture?
   * @returns {PlaceableGeometry}
   */
  geomForPlaceable(placeable, levelType = "background") {
    return this.geomForDocument(placeable.document, levelType);
  }

  /**
   * Clear all geometry data.
   */
  clear() { for ( const mgr of this.iterateManagers() ) mgr.clear(); }
}
