/* globals
CanvasQuadtree
*/
"use strict";

import { ConstrainedTokenBorder } from "./ConstrainedTokenBorder.js";

// Modify CanvasEdges class to add a quadtree and track adding and removing edges.
// Patches for the CanvasEdges class.
export const PATCHES = {};
PATCHES.CANVAS_EDGES = {};
PATCHES.CANVAS_EDGES_V13 = {};

// ----- Wraps ----- //

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

/**
 * Wrap Edges.refresh to update the constrained token border id.
 * Foundry v13.
 */
function refreshV13(wrapped) {
  ConstrainedTokenBorder._wallsID++;
  wrapped();
}

PATCHES.CANVAS_EDGES.WRAPS = { refresh };

