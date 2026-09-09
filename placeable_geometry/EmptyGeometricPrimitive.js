/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometricPrimitive } from "./GeometricPrimitive.js";
import { AABB3d } from "../3d/AABB3d.js";
import { ModelMatrixAnchor } from "../ModelMatrix.js";
import { MatrixFloat32 } from "../Matrix.js";
import { Polygon3d } from "../3d/Polygon3d.js";

/**
 * Container to represent a null or empty geometric primitive.
 * Used primarily by regions as shape placeholders.
 */
export class EmptyGeometricPrimitive extends GeometricPrimitive {

  initialize() { }

  destroy() { }

  get dirty() { return this.constructor.DIRTY.NONE; }

  set dirty(_flag) { }

  isDirty(_flag) { return false; }

  setPosition(_center) { }

  setRotation(_angles) { }

  setScale(_dims) { }

  setAnchor(_anchors) { }

  rayIntersection() { return null; }

  updateAABB() { }

  updateFaces() { }

  updateInstanceVertices() { }

  updateModelVertices() { }

  updateFacePoints() { }

  updateInternalPoints() { }

  validate() {
    // Verify that this shape is empty.
    const aabb = this.aabb;
    for ( const axis of AABB3d.axes ) {
      if ( aabb.min[axis] < aabb.max[axis] ) return false;
    }
    if ( this.prototypeFaces.length ) return false;
    if ( this.faces.length ) return false;
  }
}
