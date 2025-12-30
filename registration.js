/* globals
CONFIG,
foundry,
Hooks,
*/
"use strict";

import * as lib from "./_module.mjs";
import { MODULE_ID } from "../const.js";
import { GEOMETRY_LIB_ID, VERSION } from "./const.js";
import { mergeConfigs } from "./config.js";
import { registerGeometryLibPatches } from "./patching.js";

// Execute immediately on load to identify modules using lib geometry.
(() => {
  CONFIG[GEOMETRY_LIB_ID] ??= {};
  CONFIG[GEOMETRY_LIB_ID].CONFIG ??= {};

  // Share a map with registered versions to determine which GeometryLib controls.
  CONFIG[GEOMETRY_LIB_ID].registeredVersions ??= new Map();
  CONFIG[GEOMETRY_LIB_ID].registeredVersions.set(VERSION, MODULE_ID);
})();

/**
 * On init, determine which module has the most recent version of lib geometry.
 */
Hooks.on("init", function() {
  let maxVersion = VERSION;
  CONFIG[GEOMETRY_LIB_ID].registeredVersions.keys().forEach(v => {
    if ( foundry.utils.isNewerVersion(v, maxVersion) ) maxVersion = v;
  });
  mergeConfigs(maxVersion);

  const controllingModule = CONFIG[GEOMETRY_LIB_ID].registeredVersions.get(maxVersion);
  if ( controllingModule === MODULE_ID ) registerGeometryLibClasses();
});

function registerGeometryLibClasses() {
  CONFIG[GEOMETRY_LIB_ID].lib = lib;
  registerGeometryLibPatches();
}
