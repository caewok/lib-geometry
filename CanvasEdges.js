/* globals
CanvasQuadtree,
Region,
Wall
*/
"use strict";

import { ConstrainedTokenBorder } from "./ConstrainedTokenBorder.js";
import { MODULE_KEYS } from "./const.js";

// Modify CanvasEdges class to add a quadtree and track adding and removing edges.
// Patches for the CanvasEdges class.
export const PATCHES = {};
PATCHES.CONSTRAINED_TOKEN_BORDER = {};

// ----- NOTE: Hooks ----- //

function canvasInit() { ConstrainedTokenBorder._wallsID++; }

PATCHES.CONSTRAINED_TOKEN_BORDER.HOOKS = { canvasInit };

// ----- Wraps ----- //

/**
 * Wrap CanvasEdges.initialize to set up the quadtree.
 */
function initialize(wrapped) {
  this.quadtree ??= new CanvasQuadtree();
  return wrapped();
}

/**
 * Wrap CanvasEdges.set to add the edge to the quadtree.
 */
function edgesSet(wrapped, key, value) {
  const res = wrapped(key, value);
  this.quadtree.update({ r: value.bounds, t: value });
  return res;
}

/**
 * Wrap CanvasEdges.delete to remove the edge from the quadtree.
 */
function edgesDelete(wrapped, key) {
  const edge = this.get(key);
  if ( edge ) this.quadtree.remove(edge);
  return wrapped(key);
}

/**
 * Wrap CanvasEdges.clear to clear the quadtree.
 */
function clear(wrapped) {
  this.quadtree?.clear();
  return wrapped();
}

/**
 * Wrap Edges.refresh to update the quadtree.
 * Requires updating every edge.
 */
function refresh(wrapped) {
  ConstrainedTokenBorder._wallsID++;
  wrapped();
  if ( !this.quadtree ) return;
  for ( const edge of this.values() ) this.quadtree.update({ r: edge.bounds, t: edge });
}

PATCHES.CANVAS_EDGES.WRAPS = { initialize, set: edgesSet, delete: edgesDelete, clear, refresh };

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
  const TM = MODULE_KEYS.TERRAINMAPPER;
  let top = region.elevation.top;
  if ( TM.ACTIVE && region[TM.ID].isElevated ) {
    if ( region[TM.ID].isRamp ) return _rampElevation(region, edge);
    top = region[TM.ID].plateauElevation;
  }
  const bottom = region.elevation.bottom;
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
  const TM = MODULE_KEYS.TERRAINMAPPER;
  const bottom = region.elevation.bottom;
  return {
    a: { top: region[TM.ID].elevationUponEntry(edge.a), bottom },
    b: { top: region[TM.ID].elevationUponEntry(edge.b), bottom }
  };
}

PATCHES.CANVAS_EDGES.GETTERS = { elevationLibGeometry: getElevation };
