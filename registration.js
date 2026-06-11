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

import { WallGeometryTracker } from "./placeable_tracking/WallGeometryTracker.js";
import { TokenGeometryTracker } from "./placeable_tracking/TokenGeometryTracker.js";
import { RegionGeometryTracker } from "./placeable_tracking/RegionGeometryTracker.js";
import { TileGeometryTracker } from "./placeable_tracking/TileGeometryTracker.js";


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
  if ( controllingModule === MODULE_ID ) {
    registerGeometryLibClasses();
  }
});

Hooks.on("setup", function() {
  registerPlaceableGeometry();
  deregisterPlaceableGeometry();
})

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
  };

  const GEOMETRY_TRACKING = {
    Tile: TileGeometryTracker,
    Region: RegionGeometryTracker,
    Wall: WallGeometryTracker,
    Token: TokenGeometryTracker,
  };

  Hooks.on("canvasReady", () => {
    for ( const cl of CONFIG[GEOMETRY_LIB_ID].CONFIG.placeableGeometries ) {
      const geomCl = GEOMETRY_CLASSES[cl];
      geomCl.registerHooks();

      const trackingCl = GEOMETRY_TRACKING[cl];
      trackingCl.registerHooks();
      trackingCl.registerExistingPlaceables();
      trackingCl.activate();
    }
  });
}

function deregisterPlaceableGeometry() {
  if ( !CONFIG[GEOMETRY_LIB_ID].CONFIG.placeableGeometries.size ) return;

  const GEOMETRY_TRACKING = {
    Tile: TileGeometryTracker,
    Region: RegionGeometryTracker,
    Wall: WallGeometryTracker,
    Token: TokenGeometryTracker,
  };

  Hooks.on("canvasTearDown", () => {
    for ( const cl of CONFIG[GEOMETRY_LIB_ID].CONFIG.placeableGeometries ) {
      const trackingCl = GEOMETRY_TRACKING[cl];
      trackingCl.deactivate();
      trackingCl.deRegisterExistingPlaceables();
    }
  });
}



