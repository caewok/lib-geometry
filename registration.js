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

  // Track geometry manager classes, so modules like Terrain Mapper can sub in their own.
  CONFIG[GEOMETRY_LIB_ID].CONFIG.managerClasses = {
    walls: WallGeometryManager,
    tiles: TileGeometryManager,
    regions: RegionGeometryManager,
    tokens: TokenGeometryManager,
    backgroundLevels: LevelBackgroundGeometryManager,
    foregroundLevels: LevelForegroundGeometryManager,
  };
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
  // Change the geometry classes to match CONFIG.
  for ( const [key, cl] of Object.entries(CONFIG[GEOMETRY_LIB_ID].CONFIG.managerClasses) ) {
    GeometryManager.GEOMETRY_MANAGERS[key] = cl;
  }
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
  const cfg = CONFIG[GEOMETRY_LIB_ID];

  if ( !cfg.CONFIG.placeableGeometries.size ) return;
  const mgr = cfg.geometryManager = new GeometryManager();
  for ( const type of cfg.CONFIG.placeableGeometries ) mgr.addManager(type);
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
    tiles: TileGeometryManager,
    regions: RegionGeometryManager,
    walls: WallGeometryManager,
    tokens: TokenGeometryManager,
    backgroundLevels: LevelBackgroundGeometryManager,
    foregroundLevels: LevelForegroundGeometryManager,
  };

  /**
   * @typedef {string} GeometryType
   * wall|tile|region|token|backgroundLevel|foregroundLevel
   */

  /** @type {Set<GeometryType>} */
  types = new Set();

  /** @type {TileGeometryManager} */
  tiles = null;

  /** @type {RegionGeometryManager} */
  regions = null;

  /** @type {WallGeometryManager} */
  walls = null;

  /** @type {TokenGeometryManager} */
  tokens = null;

  /** @type {object<LevelBackgroundGeometry>} */
  backgroundLevels = null;

  /** @type {object<LevelForegroundGeometry>} */
  foregroundLevels = null;

  /** @type {object} */
  get levels() {
    // So levels are accessible at levels.background and levels.foreground.
    return {
      background: this.backgroundLevels,
      foreground: this.foregroundLevels,
    };
  }

  addManager(type) {
    type = pluralize(lowercaseFirstLetter(type));  // For consistency. Tile --> tiles
    if ( type === "levels" ) {
      return {
        background: this.addManager("backgroundLevels"),
        foreground: this.addManager("foregroundLevels"),
      };
    }

    // Create the new manager.
    const mgr = this.#createManager(type);
    mgr.registerHooks();
    if ( canvas.ready ) mgr.initializeScene();
    return mgr;
  }

  destroy() {
    for ( const type of this.types ) this.destroyManager(type);
  }

  destroyManager(type) {
    type = pluralize(lowercaseFirstLetter(type));  // For consistency. Tile --> tiles
    if ( type === "levels" ) {
      this.destroyManager("backgroundLevels"),
      this.destroyManager("foregroundLevels");
      return;
    }

    // Destroy the manager.
    const mgr = this[type];
    if ( !mgr ) return;
    mgr.destroy();
    this[type] = null;
    this.types.delete(type);
  }

  /**
   * Create a new manager. Does nothing if manager already exists for that type.
   * @param {GeometryType} type     Must be exactly named
   * returns {GeometryManager} For convenience
   */
  #createManager(type) {
    if ( !this.types.has(type) ) {
      const GEOMETRY_MANAGERS = this.constructor.GEOMETRY_MANAGERS;
      this[type] = new GEOMETRY_MANAGERS[type]();
    }
    return this[type];
  }

  /**
   * Iterate through the valid managers.
   * @yield {GeometryManager}
   */
  *iterateManagers() { for ( const type of this.types ) yield this[type]; }

  _typeFromDocument(typeOrDoc) { return pluralize((typeOrDoc.documentName || typeOrDoc).lowercaseFirstLetter()); }

  /**
   * Retrieve the manager for a specific document.
   * @param {CanvasDocument|GeometryType} typeOrDoc
   * @param {"foreground"|"background"} [levelType="background"]      For Level docs, foreground or background texture?
   * @returns {GeometryManager}
   */
  _managerForDocument(typeOrDoc, levelType = "background") {
    const type = this._typeFromDocument(typeOrDoc);
    if ( type === "levels" ) return this.levels[levelType];
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

function pluralize(str) {
  if ( str.endsWith("s") ) return str;
  return `${str}s`;
}

function lowercaseFirstLetter(str) {
  if (!str) return str; // Handle empty strings safely
  return str.charAt(0).toLowerCase() + str.slice(1);
}