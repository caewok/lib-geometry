/* globals
Region,
Wall
*/
"use strict";

import { MODULE_KEYS } from "./const.js";

// Modify CanvasEdges class to add a quadtree and track adding and removing edges.
// Patches for the CanvasEdges class.
export const PATCHES = {};
PATCHES.CANVAS_EDGES = {};

// ----- Getters ----- //

/**
 * @typedef {object} EdgeElevation
 * @prop {object} a
 *   - @prop {number|null} top      Elevation in grid units
 *   - @prop {number|null} bottom   Elevation in grid units
 * @prop {object} b
 *   - @prop {number|null} top      Elevation in grid units
 *   - @prop {number|null} bottom   Elevation in grid units

/**
 * Get the elevation at the endpoints for this edge.
 * Each edge represents a vertical 2d quadrilateral with potentially different top/bottom for
 * both a and b endpoints. Infinite elevations return null, keeping with Foundry practice for region elevation.
 * If this edge object is a wall, the points will be the Wall Height elevation.
 * If this edge object is a region, the points will be the region top/bottom or plateau / region bottom elevations.
 * @returns {EdgeElevation}
 */
function getElevation() {
  let e = this._elevation ??= { a: { top: null, bottom: null }, b: { top: null, bottom: null }};
  if ( this.object instanceof Wall ) e = _wallElevation(this.object);
  if ( this.object instanceof Region ) e = _regionElevation(this.object, this);

  // Ensure that positive and negative infinities are null.
  if ( !isFinite(e.a.top) ) e.a.top = null;
  if ( !isFinite(e.a.bottom) ) e.a.bottom = null;
  if ( !isFinite(e.b.top) ) e.b.top = null;
  if ( !isFinite(e.b.bottom) ) e.b.bottom = null;
  return e;
}

/**
 * Elevation for a wall
 * @param {Wall} wall
 * @returns {EdgeElevation}
 */
function _wallElevation(wall) {
  const top = wall.topE;
  const bottom = wall.bottomE;
  return {
    a: { top, bottom },
    b: { top, bottom }
  };
}

/**
 * Elevation for a region
 * @param {Region} region
 * @param {Edge} edge       Edge for which the elevation is applied; needed for ramps
 * @returns {EdgeElevation}
 */
function _regionElevation(region, edge) {
  const TM = MODULE_KEYS.TERRAIN_MAPPER;
  let top = region.document.elevation.top;
  if ( TM.ACTIVE && region[TM.ID].isElevated ) {
    if ( region[TM.ID].isRamp ) return _rampElevation(region, edge);
    top = region[TM.ID].plateauElevation;
  }
  const bottom = region.document.elevation.bottom;
  return {
    a: { top, bottom },
    b: { top, bottom }
  };
}

/**
 * Elevation for a ramp
 * @param {Region} region
 * @param {Edge} edge      One edge of the region's polygon(s)
 * @returns {EdgeElevation}
 */
function _rampElevation(region, edge) {
  // Assumes TM is active.
  const TM = MODULE_KEYS.TERRAIN_MAPPER;
  const bottom = region.document.elevation.bottom;
  return {
    a: { top: region[TM.ID].elevationUponEntry(edge.a), bottom },
    b: { top: region[TM.ID].elevationUponEntry(edge.b), bottom }
  };
}

PATCHES.CANVAS_EDGES.GETTERS = { elevationLibGeometry: getElevation };
