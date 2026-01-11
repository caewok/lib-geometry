/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { AbstractInstancedVertices } from "./GeometryDesc.js";
import { VerticalQuadVertices } from "./BasicVertices.js";

export class WallInstancedVertices extends AbstractInstancedVertices {

  static type = "Wall";

  static labelArr({ direction = "double", ...opts } = {}) {
    const arr = super.labelArr(opts);
    arr.push(VerticalQuadVertices.DIRECTIONS[direction]);
    return arr;
  }

  static _optionsForPlaceable(wall, opts = {}) {
    opts.direction = wall.document.direction ? "directional" : "double";
    return opts;
  }

  static calculateVertices({ direction = "double" } = {}) {
    // Directional south walls will be rotated 180º to match north.
    return VerticalQuadVertices.getUnitVertices(direction);
  }
}
