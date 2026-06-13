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

import { WallGeometry } from "./placeable_geometry/WallGeometry.js";
import { TokenGeometry } from "./placeable_geometry/TokenGeometry.js";
import { RegionGeometry } from "./placeable_geometry/RegionGeometry.js";
import { TileGeometry } from "./placeable_geometry/TileGeometry.js";
import { LevelBackgroundGeometry, LevelForegroundGeometry } from "./placeable_geometry/LevelGeometry.js";

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

  const GEOMETRY_CLASSES = {
    Tile: TileGeometry,
    Region: RegionGeometry,
    Wall: WallGeometry,
    Token: TokenGeometry,
    Level: {
      background: LevelBackgroundGeometry,
      foreground: LevelForegroundGeometry,
    },
  };

  const GEOMETRY_MANAGERS = {
    Tile: TileGeometryManager,
    Region: RegionGeometryManager,
    Wall: WallGeometryManager,
    Token: TokenGeometryManager,
    Level: {
      background: LevelBackgroundGeometryManager,
      foreground: LevelForegroundGeometryManager,
    },
  };

  CONFIG[GEOMETRY_LIB_ID].geometryManagers ??= {};
  for ( const name of CONFIG[GEOMETRY_LIB_ID].CONFIG.placeableGeometries ) {
    if ( name === "Level" ) {
      CONFIG[GEOMETRY_LIB_ID].geometryManagers.Level = {};
      CONFIG[GEOMETRY_LIB_ID].geometryManagers.Level.background = new GEOMETRY_MANAGERS.Level.background();
      CONFIG[GEOMETRY_LIB_ID].geometryManagers.Level.foreground = new GEOMETRY_MANAGERS.Level.foreground();

    } else CONFIG[GEOMETRY_LIB_ID].geometryManagers[name] = new GEOMETRY_MANAGERS[name]()
  }

  Hooks.on("canvasReady", () => {
    for ( const name of CONFIG[GEOMETRY_LIB_ID].CONFIG.placeableGeometries ) {
      if ( name === "Level" ) {
        GEOMETRY_CLASSES.Level.background.registerHooks();
        GEOMETRY_CLASSES.Level.foreground.registerHooks();
        CONFIG[GEOMETRY_LIB_ID].geometryManagers.Level.background.initializeScene();
        CONFIG[GEOMETRY_LIB_ID].geometryManagers.Level.foreground.initializeScene();
      } else {
        const geomCl = GEOMETRY_CLASSES[name];
        geomCl.registerHooks();
        CONFIG[GEOMETRY_LIB_ID].geometryManagers[name].initializeScene();
      }
    }
  });
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



