/* globals
*/
"use strict";

import { ConstrainedTokenBorder } from "./ConstrainedTokenBorder.js";

// Modify CanvasEdges class to add a quadtree and track adding and removing edges.
// Patches for the CanvasEdges class.
export const PATCHES = {};
PATCHES.CANVAS_EDGES = {};

// ----- Wraps ----- //

/**
 * Wrap Edges.refresh to update the constrained token border id.
 * Foundry v13.
 */
function refresh(wrapped) {
  ConstrainedTokenBorder._wallsID++;
  wrapped();
}

PATCHES.CANVAS_EDGES.WRAPS = { refresh };

