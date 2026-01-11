/* globals
CONST,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "../const.js";
import { GeometryInstanced } from "./GeometryDesc.js";
import { VerticalQuadVertices } from "./BasicVertices.js";
import { MatrixFloat32 } from "../MatrixFlat.js";

export class GeometryWall extends GeometryInstanced {

  get wallDirection() { return this.type; }

  constructor(type, opts) {
    opts.type = type === "double" ? "double" : "directional";
    super(type, opts);
  }

  _defineInstanceVertices() {
    // Directional south walls will be rotated 180º to match north.
    return VerticalQuadVertices.calculateVertices(undefined, undefined, { type: this.wallDirection } );
  }

  _modelMatrix(wall) {
    let modelMatrix = wall[GEOMETRY_LIB_ID][GEOMETRY_ID].modelMatrix;
    if ( this.wall.document.dir ===  CONST.WALL_DIRECTIONS.RIGHT ) {
      const rotateM = MatrixFloat32.rotationZ(Math.PI); // 180º
      modelMatrix = modelMatrix.multiply4x4(rotateM);
    }
    return modelMatrix;
  }
}
