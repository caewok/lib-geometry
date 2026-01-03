/* globals
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometryInstanced } from "./GeometryDesc.js";
import { HorizontalQuadVertices } from "./BasicVertices.js";

export class GeometryTile extends GeometryInstanced {

  get addUVs() { return true; } // Always add UVs for tiles.

  get tile() { return this.placeable; }

  _defineInstanceVertices() {
    return HorizontalQuadVertices.calculateVertices(undefined, { type: "doubleUp"} );
  }
}
