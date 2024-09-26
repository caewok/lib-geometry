/* globals
CanvasQuadtree
*/
"use strict";

import { ConstrainedTokenBorder } from "./ConstrainedTokenBorder.js";

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

PATCHES.CONSTRAINED_TOKEN_BORDER.WRAPS = { initialize, set: edgesSet, delete: edgesDelete, clear, refresh };
