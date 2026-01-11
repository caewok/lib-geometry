/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { AbstractInstancedVertices } from "./GeometryDesc.js";
import { HorizontalQuadVertices } from "./BasicVertices.js";

export class TileInstancedVertices extends AbstractInstancedVertices {

  static type = "Tile";

  static addUVs = true;

  static calculateVertices() { return HorizontalQuadVertices.getUnitVertices("doubleUp"); }

}
