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

  static get DIM2() { return this.DIM * this.DIM; }; // 9

  static get BUFFER_LENGTH() { return this.DIM2 * 3; }; // 9 values * 3 matrices.

  /** @type {DIRTY} */
  #dirty = true;

  get dirty() { return this.#dirty }

  set dirty(value) { this.#dirty ||= value; }

  _clearDirty() { this.#dirty = false; }

  constructor(modelBuffer, offset = 0) {
    /** @type {MatrixFloat32} */
    const byteLength = Float32Array.BYTES_PER_ELEMENT * 16;
    modelBuffer ??= new Array(byteLength);
    if ( !modelBuffer.byteLength === byteLength ) throw Error("ModelMatrix|Buffer byte length is incorrect.");

    this._model = (new MatrixFloat32(
      this.constructor.DIM,
      this.constructor.DIM,
      modelBuffer,
      offset)).identity();
  }

  /** @type {ArrayBuffer} */
  _matrixBuffer = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * this.constructor.BUFFER_LENGTH);

  /** @type {object<MatrixFloat32>} */

  // User must separately set dirty for each if changes are made. Otherwise use the getters/setters below.
  _rotation = (new MatrixFloat32(
    this.constructor.DIM,
    this.constructor.DIM,
    this._matrixBuffer,
    0)).identity();

  _translation = (new MatrixFloat32(
    this.constructor.DIM,
    this.constructor.DIM,
    this._matrixBuffer,
    this.constructor.DIM2)).identity();

  _scale = (new MatrixFloat32(
    this.constructor.DIM,
    this.constructor.DIM,
    this._matrixBuffer,
    this.constructor.DIM2 * 2)).identity();

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
    static BUFFER_IDX = super.BUFFER_LENGTH / this.DIM2;

    static get BUFFER_LENGTH() { return super.BUFFER_LENGTH + this.DIM2; } // 1 additional translation matrix.

    /** @type {MatrixFloat32} */
    _anchor = (new MatrixFloat32(
      this.constructor.DIM,
      this.constructor.DIM,
      this._matrixBuffer,
      this.constructor.DIM2 * this.constructor.BUFFER_IDX)).identity();

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
  };
};

/**
 * NOTE: ModelMultipleCentersMixin
 * Define separate centers for translation, scaling, and rotation.
 * Example: regions define x,y as well as a shape center.
 * To scale a unit shape requires the shape center, but they rotate and translate from x,y.
 */
export const ModelMultipleCentersMixin = superclass => {
  return class extends superclass {

    static get BUFFER_LENGTH() { return super.BUFFER_LENGTH + (this.DIM2 * 6); } // 3 additional translation matrices, plus inverses.

    static BUFFER_IDX = super.BUFFER_LENGTH / this.DIM2;

    /** @type {MatrixFloat32} */
    #txTranslationMat = (new MatrixFloat32(
      this.constructor.DIM,
      this.constructor.DIM,
      this._matrixBuffer,
      this.constructor.DIM2 * this.constructor.BUFFER_IDX)).identity();

    /** @type {MatrixFloat32} */
    #txRotationMat = (new MatrixFloat32(
      this.constructor.DIM,
      this.constructor.DIM,
      this._matrixBuffer,
      this.constructor.DIM2 * (this.constructor.BUFFER_IDX + 1))).identity();

    /** @type {MatrixFloat32} */
    #txScaleMat = (new MatrixFloat32(
      this.constructor.DIM,
      this.constructor.DIM,
      this._matrixBuffer,
      this.constructor.DIM2 * (this.constructor.BUFFER_IDX + 2))).identity();

    /** @type {MatrixFloat32} */
    #txInvTranslationMat = (new MatrixFloat32(
      this.constructor.DIM,
      this.constructor.DIM,
      this._matrixBuffer,
      this.constructor.DIM2 * (this.constructor.BUFFER_IDX + 3))).identity();

    /** @type {MatrixFloat32} */
    #txInvRotationMat = (new MatrixFloat32(
      this.constructor.DIM,
      this.constructor.DIM,
      this._matrixBuffer,
      this.constructor.DIM2 * (this.constructor.BUFFER_IDX + 4))).identity();

    /** @type {MatrixFloat32} */
    #txInvScaleMat = (new MatrixFloat32(
      this.constructor.DIM,
      this.constructor.DIM,
      this._matrixBuffer,
      this.constructor.DIM2 * (this.constructor.BUFFER_IDX + 5))).identity();

    /** @type {PIXI.Point|Point3d} */
    get translationCenter() { return this.constructor.extractTranslationValues(this.#txTranslationMat); }

    /** @type {PIXI.Point|Point3d} */
    get scaleCenter() { return this.constructor.extractTranslationValues(this.#txScaleMat); }

    /** @type {PIXI.Point|Point3d} */
    get rotationCenter() { return this.constructor.extractTranslationValues(this.#txRotationMat); }

    set translationCenter(value) {
      this.#setTranslationValues(value, this.#txTranslationMat, this.#txInvTranslationMat);
    }

    set scaleCenter(value) {
      this.#setTranslationValues(value, this.#txScaleMat, this.#txInvScaleMat);
    }

    set rotationCenter(value) {
      this.#setTranslationValues(value, this.#txRotationMat, this.#txInvRotationMat);
    }

    /**
     * Define the translation and inverse translation matrices for a given set of translation coordinates.
     * @param {PIXI.Point|Point3d|object} value
     * @param {MatrixFloat32<3x3|4x4>} txMat
     * @param {MatrixFloat32<3x3|4x4>} txInvMat
     */
    #setTranslationValues(value, txMat, txInvMat) {
      const d3 = this.constructor.DIM === 4;
      MatrixFloat32.translation(value, { d3, outMatrix: txMat });

      using negValue = Point3d.tmp.set(-value.x, -value.y, -(value.z || 0));
      MatrixFloat32.translation(negValue, { d3, outMatrix: txInvMat });
      this.dirty = true;
    }

    update() {
      // Use multiple matrices to translate before applying scale, rotation, translate.
      // Undo each in turn.
      const M = this._model;
      const multName = this.constructor.multiplyName;

      M.identity();
      M[multName](this.#txInvScaleMat, M);
      M[multName](this._scale, M);
      M[multName](this.#txScaleMat, M);

      M[multName](this.#txInvRotationMat, M);
      M[multName](this._rotation, M);
      M[multName](this.#txRotationMat, M);

      M[multName](this.#txInvTranslationMat, M);
      M[multName](this._translation, M);
      M[multName](this.#txTranslationMat, M);

      this._clearDirty();

      super.update(true);
    }

    clone(out) {
      out = super.clone(out);
      out.translationCenter = this.translationCenter;
      out.scaleCenter = this.scaleCenter;
      out.rotationCenter = this.rotationCenter;
      return out;
    }

    print() {
      console.log("txTranslation");
      this.#txTranslationMat.print();
      console.log("txRotation");
      this.#txRotationMat.print();
      console.log("txScale");
      this.#txScaleMat.print();
      super.print();
    }
  };
};



/**
 * Store the model inverse along with the model matrix.
 */
export const ModelInverseMixin = superclass => {

  return class extends superclass {
    /** @type {MatrixFloat32} */
    #inverse = MatrixFloat32.identity(this.constructor.DIM);

    get _modelInverse() { return this.#inverse; }

    get modelInverse() {
      if ( this.dirty ) this.update();
      return this.#inverse;
    }

    update() {
      super.update();
      this._model.invert(this.#inverse);
    }
  };
};

export class ModelMatrix2dInverse extends mix(ModelMatrix2d).with(ModelInverseMixin) {}

export class ModelMatrix2dAnchor extends mix(ModelMatrix2d).with(ModelAnchorMixin) {}

export class ModelMatrix2dAnchorInverse extends mix(ModelMatrix2d).with(ModelAnchorMixin, ModelInverseMixin) {}

export class ModelMatrixInverse extends mix(ModelMatrix).with(ModelInverseMixin) {}

export class ModelMatrixAnchor extends mix(ModelMatrix).with(ModelAnchorMixin) {}

export class ModelMatrixAnchorInverse extends mix(ModelMatrix).with(ModelAnchorMixin, ModelInverseMixin) {}

export class ModelMatrixMultipleCenters extends mix(ModelMatrix).with(ModelMultipleCentersMixin) {}
