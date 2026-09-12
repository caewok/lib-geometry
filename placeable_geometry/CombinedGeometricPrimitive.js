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
 * Container to facilitate combining multiple shapes.
 * This does not combine model matrices or vertices/indices.
 * Merely a wrapper for the underlying shapes.
 * Empty shapes are allowed.
 */
export class CombinedGeometricPrimitive extends GeometricPrimitive {

  /**
   * Initialize the values for this geometric primitive.
   */
  initialize() { this.shapes.forEach(shape => shape.initialize()); }

  /**
   * Destroy this geometric primitive, releasing associated memory in buffers.
   */
  destroy() {
    this.shapes.forEach(shape => shape.destroy());
    this.shapes.length = 0;
  }

  // ----- NOTE: Dirty ----- //

  get dirtyShapes() {
    let dirty = 0;
    this.shapes.forEach(shape => dirty |= shape.dirty);
    return dirty;
  }

  set dirtyShapes(flag) { this.shapes.forEach(shape => shape.dirty = flag); }

  isDirtyShapes(flag = this.constructor.DIRTY.ALL) {
    return this.shapes.some(shape => shape.isDirty(flag));
  }

  _clearDirtyShapes(flag) { this.shapes.forEach(shape => shape._clearDirty(flag)) }

  // ----- NOTE: Add/remove shapes ----- //

  /** @type {GeometricPrimitive[]} */
  shapes = [];

  /**
   * Add a primitive shape to this container.
   * @param {GeometricPrimitive} shape
   */
  addShape(shape) {
    this.shapes.push(shape);
    this.dirty = this.constructor.DIRTY.ALL;
  }

  replaceShapeAtIndex(newShape, idx) {
    if ( this.shapes[idx] ) this.shapes[idx].destroy();
    this.shapes[idx] = newShape;
    this.dirty = this.constructor.DIRTY.ALL;
  }

  /**
   * Remove a primitive shape from this container by id.
   * @param {string} id
   * @returns {GeometricPrimitive|null} Null if nothing removed
   */
  removeShapeById(id) {
    const idx = this.shapes.findIndex(shape => shape.id === id);
    if ( !~idx ) return null;
    return this.removeShapeByIndex(idx);
  }

  /**
   * Remove a primitive shape from this container by its index.
   *
   */
  removeShapeByIndex(idx) {
    const shape = this.shapes.splice(idx, 1)[0] || null;
    if ( shape ) this.dirty = this.constructor.DIRTY.ALL;
    return shape;
  }

  // ----- NOTE: AABB ----- //

  /**
   * Trigger update of shape AABB
   */
  updateAABB() {
    this.shapes.forEach(shape => shape.updateAABB());
    super.updateAABB();
  }

  _calculateAABB(aabb) {
    const M = this.modelMatrix.model;
    const aabbs = this.shapes.map(shape => {
      shape.updateAABB();
      return shape.aabb.transform(M);
    });
    AABB3d.union(aabbs, aabb);
  }

  /** @type {Point3d} */
  get center() {
    const centers = this.shapes.map(shape => shape.center);

    const M = this.modelMatrix.model;
    const txCenters = centers.map(center => M.multiplyPoint3d(center));
    const poly3d = Polygon3d.from3dPoints(txCenters);
    return poly3d.centroid;
  }

  // ----- NOTE: Model Matrix ----- //


  /** @type {ModelMatrix} */
  modelMatrix = ModelMatrixAnchor.create();

  /**
   * Mworld = Mlocal x M.container (row-major)
   * @returns {Matrix}
   */
  #worldModel = MatrixFloat32.create(4, 4);

  worldModelForShape(shape) { return shape.modelMatrix.model.multiply4x4(this.modelMatrix.model, this.#worldModel); }

  // ----- NOTE: Faces ----- //

  // Prototype faces and faces are stored as a combined set of faces, modified by the world matrix.
  #prototypeFaces = [];

  get prototypeFaces() { return this.#prototypeFaces; }

  updateFaces() {
    this.shapes.forEach(shape => shape.updateFaces());
    super.updateFaces(); // This will trigger _generateFaces and clear the dirty tag.
  }

  /**
   * Update the faces for this primitive.
   * Default is to use the world matrix on the prototypes.
   */
  _generateFaces(faces) {
    // Release old face points before destroying them.
    faces.forEach(face => face.release());
    const protoFaces = this.prototypeFaces;
    const numSides = faces.length = protoFaces.length;

    let i = 0;
    for ( const shape of this.shapes ) {
      // Calculate each face from the world model.
      const worldM = this.worldModelForShape(shape);
      const invTransposeM = worldM.invert().transpose();
      for ( const protoFace of shape.prototypeFaces ) {
        faces[i++] = protoFace.transform(worldM, invTransposeM)
      }
    }
  }

  // ----- NOTE: Vertices ----- //

  updateInstanceVertices() {
    this.shapes.forEach(shape => shape.updateInstanceVertices()); // Triggers _generateVerticesForFaces for each shape.
    super.updateInstanceVertices();
  }

//   updateModelVertices() {
//     this.shapes.forEach(shape => shape.updateModelVertices());
//     super.updateModelVertices();
//   }

  // ----- NOTE: Face points ----- //

//   updateFacePoints() {
//     this.shapes.forEach(shape => shape.updateFacePoints());
//     super.updateFacePoints();
//   }


  // ----- NOTE: Internal points ----- //

  // Default is a single set of points based on AABB.
  // TODO: More sophisticated version testing for containment.

//   updateInternalPoints() {
//     this.shapes.forEach(shape => shape.updateInternalPoints());
//   }

  validate() { return this.shapes.every(shape => shape.validate()); }

}