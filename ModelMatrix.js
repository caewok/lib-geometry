/* globals
PIXI,
*/
"use strict";

import { MatrixFloat32 } from "./Matrix.js";
import { Point3d } from "./3d/Point3d.js";
import { mix } from "./mixwith.js";

/**
 * Utility class that stores translation/rotation/scale matrices along with a combined model matrix.
 * Useful for modeling transforms of placeables.
 * Can use a model buffer for sharing with GPU.
 */


/**
 * Stores the rotation, translation, and scale matrices along with the model matrix.
 */
export class ModelMatrix2d {
  // Static getters so ModelMatrix can override.
  static get DIM() { return 3; };

  static get multiplyName() { return "multiply3x3"; } // Static getter so ModelMatrix can override.

  /** @type {DIRTY} */
  #dirty = false;

  get dirty() { return this.#dirty }

  set dirty(value) {
    this.#dirty ||= value;
    this.dataVersion += value;
  }

  _clearDirty() { this.#dirty = false; }

  /**
   * Increment whenever any data is written.
   * @type {number}
   */
  dataVersion = 0;

  /**
   * Initialize the matrices that make up the model.
   * @param {number} [additionalMatrices=0] Number of matrices to allocate, in addition to the base 4.
   * @returns {MatrixFloat32[]} The array of unused matrices
   */
  initialize(additionalMatrices = 0) {
    const allocationType = this.constructor.DIM === 4 ? "allocate4x4" : "allocate3x3";
    const n = 4 + additionalMatrices;
    const matrices = MatrixFloat32[allocationType](n);
    this._model = matrices.pop().identity();
    this._translation = matrices.pop().identity();
    this._rotation = matrices.pop().identity();
    this._scale = matrices.pop().identity();
    return matrices;
  }

  /**
   * To avoid weird manipulations of the initialize method, use a create method instead.
   */
  static create() {
    const out = new this();
    out.initialize();
    return out;
  }

  /** @type {object<MatrixFloat32>} */

  // User must separately set dirty for each if changes are made. Otherwise use the getters/setters below.
  _rotation = null;

  _translation = null;

  _scale = null;

  /** @type {Point3d} */
  get rotation() { return this.constructor.extractRotationValues(this._rotation);  }

  /** @type {Point3d} */
  set rotation(angles) {
    const d3 = this.constructor.DIM === 4;
    MatrixFloat32.rotationXYZ(angles, { d3, outMatrix: this._rotation });
    this.dirty = true;
  }

  /** @type {PIXI.Point} */
  get translation() { return this.constructor.extractTranslationValues(this._translation); }

  /** @type {PIXI.Point} */
  set translation(vector) {
    const d3 = this.constructor.DIM === 4;
    MatrixFloat32.translation(vector, { d3, outMatrix: this._translation });
    this.dirty = true;
  }

  /** @type {PIXI.Point} */
  get scale() { return this.constructor.extractScaleValues(this._scale); }

  /** @type {PIXI.Point} */
  set scale(dims) {
    const d3 = this.constructor.DIM === 4;
    MatrixFloat32.scale(dims, { d3, outMatrix: this._scale });
    this.dirty = true;
  }

  /**
   * Extract the values on the last row for the provided translation matrix. Assumes no scaling or rotation.
   * @param {MatrixFloat32<3x3|4x4>} txMat
   * @returns {PIXI.Point|Point3d}
   */
  static extractTranslationValues(txMat) {
    if ( txMat.nrow === 3 ) {
      return PIXI.Point.tmp.set(
        txMat.getIndex(2, 0),
        txMat.getIndex(2, 1),
      )
    } else {
      return Point3d.tmp.set(
        txMat.getIndex(3, 0),
        txMat.getIndex(3, 1),
        txMat.getIndex(3, 2),
      )
    }
  }

  /**
   * Extract the angle values from the provided rotation matrix. Assumes no scaling or rotation.
   * @param {MatrixFloat32<3x3|4x4>} txMat
   * @returns {Point3d}
   */
  static extractRotationValues(rotMat) {
    const thetaY = Math.asin(rotMat.getIndex(2, 0));

    // Handle Gimbal Lock, when thetaY approaches ±90º.
    let thetaX;
    let thetaZ;;
    if ( Math.abs(thetaY).almostEqual(Math.PI_1_2) ) {
      const sign = Math.sign(thetaY);
      thetaX = 0;
      thetaZ = sign * Math.atan2(rotMat.getIndex(0, 1), rotMat.getIndex(1, 1));
    } else {
      thetaX = Math.atan2(rotMat.getIndex(2, 1), rotMat.getIndex(2, 2));
      thetaZ = Math.atan2(rotMat.getIndex(1, 0), rotMat.getIndex(0, 0));
    }
    return Point3d.tmp.set(thetaX, thetaY, thetaZ);
  }

  /**
   * Extract the scale values from the provided rotation matrix. Assumes no translation or rotation.
   * @param {MatrixFloat32<3x3|4x4>} txMat
   * @returns {PIXI.Point|Point3d}
   */
  static extractScaleValues(scaleMat) {
    if ( scaleMat.nrow === 3 ) {
      return PIXI.Point.tmp.set(
        scaleMat.getIndex(0, 0),
        scaleMat.getIndex(1, 1),
      )
    } else {
      return Point3d.tmp.set(
        scaleMat.getIndex(0, 0),
        scaleMat.getIndex(1, 1),
        scaleMat.getIndex(2, 2),
      )
    }
  }

  /** @type {MatrixFloat32} */
  _model;

  get model() {
    if ( this.dirty ) this.update();
    return this._model;
  }

  update() {
    const M = this._model;
    const multName = this.constructor.multiplyName;

    M.identity();
    M[multName](this._scale, M);
    M[multName](this._rotation, M);
    M[multName](this._translation, M);
    this.#dirty = false;
  }

  clone(out) {
    out ??= new this.constructor();
    this._rotation.clone(out._rotation);
    this._scale.clone(out._scale);
    this._translation.clone(out._translation);
    return out;
  }

  print() {
    if ( this.dirty ) this.update();

    console.log("Translation");
    this._translation.print();
    console.log("Rotation");
    this._rotation.print();
    console.log("Scale");
    this._scale.print();
    console.log("Model");
    this._model.print();
  }

  destroy() {
    this._model.release();
    this._translation.release();
    this._rotation.release();
    this._scale.release();

    this._model = null;
    this._translation = null;
    this._rotation = null;
    this._scale = null;
  }
}

/**
 * Stores the rotation, translation, and scale matrices along with the model matrix.
 */
export class ModelMatrix extends ModelMatrix2d {
  static get DIM() { return 4; }

  static get multiplyName() { return "multiply4x4"; }

}

/**
 * NOTE: ModelCenterMixin
 * Transform the model using a separate matrix before applying the rest.
 * Typically used to center an object before applying scale/rotation/translation.
 * Undoes that tranformation after the scale/rotation/translation happens.
 */
export const ModelAnchorMixin = superclass => {
  return class extends superclass {

    initialize(additionalMatrices = 0) {
      const matrices = super.initialize(1 + additionalMatrices);
      this._anchor = matrices.pop().identity();
      return matrices;
    }

    /** @type {MatrixFloat32} */
    _anchor = null;

    get anchor() {
      return this.constructor.extractTranslationValues(this._anchor);
    }

    set anchor(value) {
      const d3 = this.constructor.DIM === 4;
      MatrixFloat32.translation(value, { d3, outMatrix: this._anchor });
      this.dirty = true;
    }

    update() {
      // Create a translation matrix to uncenter after applying the model matrix.
      // Update the model matrix.
      super.update();

      const M = this._model;
      const multName = this.constructor.multiplyName;

      // Center prior to applying the model matrix.
      this._anchor[multName](M, M);
    }

    clone(out) {
      out = super.clone(out);
      out.anchor = this.anchor;
      return out;
    }

    print() {
      console.log("Anchor");
      this._anchor.print();
      super.print();
    }

    destroy() {
      this._anchor.release();
      this._anchor = null;
      super.destroy();
    }
  };
};

/**
 * Store the model inverse along with the model matrix.
 */
export const ModelInverseMixin = superclass => {

  return class extends superclass {
    /** @type {MatrixFloat32} */
    _inverse = null

    get modelInverse() {
      if ( this.dirty ) this.update();
      return this._inverse;
    }

    update() {
      super.update();
      this._model.invert(this._inverse);
    }

    initialize(additionalMatrices = 0) {
      const matrices = super.initialize(1 + additionalMatrices);
      this._inverse = matrices.pop().identity();
      return matrices;
    }

    destroy() {
      this._inverse.release();
      this._inverse = null;
      super.destroy();
    }
  };
};

// --> ModelMatrix


export class ModelMatrix2dInverse extends mix(ModelMatrix2d).with(ModelInverseMixin) {}

export class ModelMatrix2dAnchor extends mix(ModelMatrix2d).with(ModelAnchorMixin) {}

// -->
export class ModelMatrix2dAnchorInverse extends mix(ModelMatrix2d).with(ModelAnchorMixin, ModelInverseMixin) {}

export class ModelMatrixInverse extends mix(ModelMatrix).with(ModelInverseMixin) {}

// -->
export class ModelMatrixAnchor extends mix(ModelMatrix).with(ModelAnchorMixin) {}

// -->
export class ModelMatrixAnchorInverse extends mix(ModelMatrix).with(ModelAnchorMixin, ModelInverseMixin) {}

