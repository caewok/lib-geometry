/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_LIB_ID } from "../const.js";
import { combineTypedArrays } from "../util.js";
import { Point3d } from "../3d/Point3d.js";
import { Sphere } from "../3d/Sphere.js";
import { MatrixFloat32 } from "../MatrixFlat.js";
import { Draw } from "../Draw.js";
import { Triangle3d } from "../3d/Polygon3d.js";
import { ClipperPaths } from "../ClipperPaths.js";
import { Clipper2Paths } from "../Clipper2Paths.js";
import { geoDelaunay } from "./d3-geo-voronoi-bundled.js";

const N = -0.5
const S = 0.5;
const W = -0.5;
const E = 0.5;
const T = 0.5;
const B = -0.5;

/*
All these classes use static methods only.

BasicVertices:
- Assume 3 position, 3 normal, 2 uv.
- Methods to manipulate and trim vertices and associated indices.

ShapeVertices:
- unitShape
- Define buffers to hold different vertex configurations.
- Define specific unit pieces of the shape.
- Store vertices for different shape configurations in the buffers (e.g., single rect facing up versus double rect)
  - Unit vertices can be accessed here.
- calculateVertices method for transforming a shape to vertices.
- transformMatrix method to take a representative shape and build its transform matrix components.

*/

/** Typed array compatibility with normal arrays

1. Array uses slice while TypedArray uses subarray.
2. Array has no set method.

*/

/**
 * Mimics TypedArray#subarray by using slice
 * @param {number} [begin]      Element to begin at. The offset is inclusive. The whole array will be included in the new view if this value is not specified.
 * @param {number} [end]        Element to end at. The offset is exclusive. If not specified, all elements from the one specified by begin to the end of the array are included in the new view.
 * @returns {Array}
 */
if ( !Array.prototype.subarray ) Array.prototype.subarray = Array.prototype.slice;

/**
 * Mimics TypedArray#set by using splice.
 * @param {Array|TypedArray} array    The array from which to copy values. All values from the source array are copied into the target array, unless the length of the source array plus the target offset exceeds the length of the target array, in which case an exception is thrown.
 * @param {number} [targetArray=0]    The offset into the target array at which to begin writing values from the source array. If this value is omitted, 0 is assumed (that is, the source array will overwrite values in the target array starting at index 0).
 */
if ( !Array.prototype.set ) Array.prototype.set = function(array, targetOffset = 0) {
  this.splice(targetOffset, 0, ...array);
}


/**
 * Stores the rotation, translation, and scale matrices along with the model matrix.
 */
export class ModelMatrix {
  /** @type {ArrayBuffer} */
  #matrixBuffer = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 16 * 3);

  /** @type {object<MatrixFloat32>} */
  #rotation = MatrixFloat32.identity(4, 4, new MatrixFloat32(new Float32Array(this.#matrixBuffer, 0, 16), 4, 4));

  #translation = MatrixFloat32.identity(4, 4, new MatrixFloat32(new Float32Array(this.#matrixBuffer, 16 * Float32Array.BYTES_PER_ELEMENT, 16), 4, 4));

  #scale = MatrixFloat32.identity(4, 4, new MatrixFloat32(new Float32Array(this.#matrixBuffer, 32 * Float32Array.BYTES_PER_ELEMENT, 16), 4, 4));

  get rotation() { this.#updated ||= true; return this.#rotation; }

  get translation() { this.#updated ||= true; return this.#translation; }

  get scale() { this.#updated ||= true; return this.#scale; }

  /** @type {MatrixFloat32} */
  #model = MatrixFloat32.empty(4, 4);

  get _model() { return this.#model; }

  get model() {
    if ( this.#updated ) this.update();
    return this._model;
  }

  /** @type {boolean} */
  #updated = true;

  get updated() { return this.#updated; }

  set updated(value) { this.#updated ||= value; }

  update() {
    const { rotation, translation, scale } = this;
    const M = this._model;
    scale
      .multiply4x4(rotation, M)
      .multiply4x4(translation, M);
    this.#updated = false;
  }
}


export class BasicVertices {
  /** @type {number} */
  static NUM_VERTEX_ELEMENTS = 8; // 3 position, 3 normal, 2 uv.

  static NUM_TRIANGLE_ELEMENTS = 3 * this.NUM_VERTEX_ELEMENTS;

  static vertexCache = new Map();

  // static getBuffer(type) { return new ArrayBuffer(); }

  static _cacheType(type) { return `${this.name}_${type}`; }

  static getUnitVertices(type) {
    const cacheType = this._cacheType(type);
    if ( this.vertexCache.has(cacheType) ) return this.vertexCache.get(cacheType);
    const out = this._getUnitVertices(type);
    this.vertexCache.set(cacheType, out);
    return out;
  }

  /**
   * Given an array of vertex information, flip orientation. I.e., ccw --> cw. Flips in place.
   * E.g., if the bottom has vertices 0, 1, 2, switch to 2, 1, 0.
   * @param {Float32Array} vertices
   * @param {number} [stride=8]       The number of elements representing each vertex
   * @returns {Float32Array} The same array, modified
   */
  static flipVertexArrayOrientation(vertices, stride = this.NUM_VERTEX_ELEMENTS) {
    const v1_offset = stride;     // 8
    const v2_offset = stride * 2; // 16
    const v3_offset = stride * 3; // 24
    for ( let i = 0, iMax = vertices.length; i < iMax; i += v3_offset ) {
      // v0: k, v1: k + 8, v2: k + 16, v3: k + 24.
      const tmp = vertices.slice(i, i + v1_offset); // Must be slice to avoid modifying in place.
      vertices.set(vertices.subarray(i + v2_offset, i + v3_offset), i);
      vertices.set(tmp, i + v2_offset);
    }
    return vertices;
  }

  /**
   * Convert a set of vertices to a specific world position using a 4x4 matrix.
   * It is assumed that the vertex position is first in the array: x, y, z, ...
   * @param {Float32Array} vertices
   * @param {MatrixFloat32} M
   * @param {number} [stride=8]       The number of elements representing each vertex
   * @returns {Float32Array} The vertices, modified in place
   */
  static transformVertexPositions(vertices, M, stride = this.NUM_VERTEX_ELEMENTS) {
    const pt = Point3d.tmp;
    for ( let i = 0, iMax = vertices.length; i < iMax; i += stride ) {
      pt.set(vertices[i], vertices[i+1], vertices[i+2]);
      M.multiplyPoint3d(pt, pt);
      vertices.set([...pt], i);
    }
    pt.release();
    return vertices;
  }

  /**
   * Create a transform matrix for a given object.
   * Must be defined by the child class for specific object, such as PIXI.Rectangle.
   * Used in calculateVertices.
   * @param {*} shape                       The shape to use, typically a PIXI shape
   * @param {object} [opts]                 Parameters to change the elevation and pass through matrix objects
   * @param {number} [opts.topZ=T]          Top elevation
   * @param {number} [opts.bottomZ=B]       Bottom elevation
   * @param {number} [opts.rotateZ=0]        Amount to rotate the resulting vertices around the z axis, in degrees
   * @param {ModelMatrix} [opts.modelMatrix]    Where to store the results
   * @returns {ModelMatrix}
  */
  // static transformMatrixFromShape(shape, { topZ = T, bottomZ = B, rotateZ = 0, modelMatrix } = {}) {}

  /**
   * Calculate the vertices for a given shape.
   * @param {*} shape                       The shape to use, typically a PIXI shape
   * @param {object} [opts]                 Options passed to transformMatrixFromShape
   * @param {string} [opts.type]            The type of vertices, passed to getUnitVertices
   * @returns {Float32Array} Vertices transformed by the model matrix
   */
  static calculateVerticesForShape(shape, opts = {}) {
    // Convert unit edge to match this edge.
    const modelMatrix = this.modelMatrixFromShape(shape, opts);
    const vertices = new Float32Array(this.getUnitVertices(opts.type)); // Clone vertices before transform.
    return this.transformVertexPositions(vertices, modelMatrix.model);
  }
  /**
   * Trim an array of vertices, removing duplicates and defining indices to match.
   * @param {number[]|Float32Array} arr      1D array of vertices
   * @param {object} [opts]
   * @param {}
   * @returns {object}
   * - @prop {Float32Array} vertices
   * - @prop {Uint16Array} indices
   */
  static trimVertexData(arr, { addNormals = false, addUVs = false } = {}) {
    const stride = 3 + (3 * addNormals) + (2 * addUVs);
    const vertices = this.trimNormalsAndUVs(arr, { keepNormals: addNormals, keepUVs: addUVs });
    return this.condenseVertexData(vertices, { stride });
  }

  static condenseVertexData(vertices, { stride = 3 } = {}) {
    // For given array of vertices, create indices and remove duplicate vertices.
    const vLen = vertices.length;
    const nVertices = Math.floor(vertices.length / stride);
    const indices = new Uint16Array(nVertices);

    // Cannot use resizable buffer with WebGL2 bufferData.
    // Instead, construct a maximum-length array buffer and copy it over later once we know how
    // many vertices were copied over.
    // (Could use resizable and transfer later but little point here)
    const maxByteLength = vertices.byteLength || (Float32Array.BYTES_PER_ELEMENT * vertices.length);
    const buffer = new ArrayBuffer(maxByteLength);
    const newVertices = new Float32Array(buffer, 0, vLen);

    // For each vertex, determine if it has been seen before.
    // If seen, get the original index, otherwise add this one to the tracking set.
    // Set the index accordingly and copy over the vertex data if necessary.
    const uniqueV = new Map();
    for ( let v = 0, i = 0; v < vLen; v += stride, i += 1 ) {
      const dat = vertices.subarray(v, v + stride);
      const key = dat.join("_");
      if ( !uniqueV.has(key) ) {
        const offset = uniqueV.size;
        newVertices.set(dat, offset * stride);
        uniqueV.set(key, offset);
      }
      indices[i] = uniqueV.get(key);
    }

    // Copy the vertices to a new buffer.
    const byteLength = uniqueV.size * stride * Float32Array.BYTES_PER_ELEMENT;
    const newBuffer = buffer.transferToFixedLength(byteLength);

    return {
      indices,
      vertices: new Float32Array(newBuffer),
      numVertices: uniqueV.size,
      stride,
    };
  }

  /**
   * For given vertices and indices arrays, expand the vertices array so that the index is not required.
   *
   * @param {Uint16Array} indices
   * @param {Float32Array} vertices
   * @returns {Float32Array} Array containing one vertex for each index.
   */
  static expandVertexData(indices, vertices, { stride = 3, outArr } = {}) {
    const nVertices = indices.length
    outArr ??= new Float32Array(nVertices * stride);

    for ( let i = 0, j = 0; i < nVertices; i += 1, j += stride ) {
      const idx = indices[i] * stride;
      outArr.set(vertices.subarray(idx, idx + stride), j)
    }
    return outArr;
  }

  /**
   * For a vertex of [position (3), normal (3), uv (2), ...],
   * drop the normals, uvs, or both.
   * @param {Float32Array} arr
   * @param {object} [opts]
   * @param {boolean} [opts.keepNormals=false]
   * @param {boolean} [opts.keepUVs=false]
   * @returns {Float32Array} Same array if both are kept; new array otherwise
   */
  static trimNormalsAndUVs(arr, { keepNormals = false, keepUVs = false, outArr } = {}) {
    if ( keepNormals && keepUVs ) {
      if ( !outArr ) return arr;
      outArr.set(arr);
      return outArr;
    }

    const stride = 8;
    const newStride = 3 + (3 * keepNormals) + (2 * keepUVs);
    const oldLn = arr.length;
    const nVertices = Math.floor(oldLn / stride);
    outArr ??= new Float32Array(nVertices * newStride);

    let pullFn;
    switch ( newStride ) {
      case 3: pullFn = (oldOffset, newOffset) => outArr.set(arr.subarray(oldOffset, oldOffset + 3), newOffset); break; // Position
      case 5: pullFn = (oldOffset, newOffset) => {
        outArr.set(arr.subarray(oldOffset, oldOffset + 3), newOffset); // Position
        outArr.set(arr.subarray(oldOffset + 6, oldOffset + 8), newOffset + 3); // UV
      }; break;
      case 6: pullFn = (oldOffset, newOffset) => outArr.set(arr.subarray(oldOffset, oldOffset + 6), newOffset); break; // Position + normal
      // case 8 handled by early return.
      default: console.error("trimNormalsAndUVs|stride length not recognized", { arr, newStride });
    }
    for ( let i = 0, j = 0; i < oldLn; i += stride, j += newStride ) pullFn(i, j);
    return outArr;
  }

  static trimVertices(arr, { stride = 8, offset = 3, trimWidth = 3 } = {}) {
    const newStride = stride - trimWidth;
    const oldLn = arr.length;
    const nVertices = Math.floor(oldLn / stride);
    const outArr = new Float32Array(nVertices * newStride);

    // Options
    // trimWidth, ...        offset === 0
    // ..., trimWidth, ...   stride - offset >= trimWidth
    // ..., trimWidth        stride - offset === trimWidth

    let pullFn;
    // trimWidth, ...
    if ( !offset ) pullFn = (oldStartIndex, newStartIndex) => outArr.set(arr.subarray(oldStartIndex + trimWidth, oldStartIndex + stride), newStartIndex);

    // ..., trimWidth
    else if ( (stride - offset) === trimWidth ) pullFn = (oldStartIndex, newStartIndex) => outArr.set(arr.subarray(oldStartIndex, oldStartIndex + stride - trimWidth), newStartIndex);

    // ..., Normal, ...
    else pullFn = (oldStartIndex, newStartIndex) => {
      outArr.set(arr.subarray(oldStartIndex, oldStartIndex + trimWidth), newStartIndex); // Everything before the cut.
      outArr.set(arr.subarray(oldStartIndex + offset + trimWidth, oldStartIndex + stride), newStartIndex + offset); // Everything after the cut.
    };
    for ( let i = 0, j = 0; i < oldLn; i += stride, j += newStride ) pullFn(i, j);
    return outArr;
  }

  static trimNormals(arr, { stride = 8 } = {}) { return this.trimVertices(arr, { stride, offset: 3, trimWidth: 3 }); }

  static trimUVs(arr, { stride = 8 } = {}) {
    switch ( stride ) {
      case 5: return this.trimVertices(arr, { stride, offset: 3, trimWidth: 2 });
      case 8: return this.trimVertices(arr, { stride, offset: 6, trimWidth: 2 });
      default: return new arr.constructor(arr);
    }
  }

  /**
   * For an array of vertices, calculate and add normals to each vertex.
   * @param {Float32Array|number[]} vertices          An array of vertices to which to append normals
   * @param {number} [stride=3]                       The stride of the vertices array
   * @param {number} [positionOffset=0]               Where the position x,y,z data starts in the array
   * @param {number} [normalsOffset=3]                Where to place the normals in the array
   * @param {number|Float32Array} [outArr]            The array to use to store the result
   *  - Length of the out array must be numVertices * (stride + 3)
   * @returns {Float32Array} Array of vertices with normal appended to each
   */
  static appendNormals(vertices, { stride = 3, positionOffset = 0, normalsOffset = 3, overwrite = false, outArr } = {}) {
    const normals = this.calculateNormals(vertices, { stride, positionOffset });
    return this._zipInsert(vertices, normals, { stride, offset: normalsOffset, dataStride: 3, overwrite, outArr });
  }

   /**
   * For an array of vertices, calculate and add UVs to each vertex.
   * @param {Float32Array|number[]} vertices          An array of vertices to which to append UVs
   * @param {number} [stride=3]                       The stride of the vertices array
   * @param {number} [positionOffset=0]               Where the position x,y,z data starts in the array
   * @param {number} [normalsOffset=3]                Where to place the UVs in the array
   * @param {number|Float32Array} [outArr]            The array to use to store the result
   *  - Length of the out array must be numVertices * (stride + 3)
   * @returns {Float32Array} Array of vertices with UVs appended to each
   */
  static appendUVs(vertices, { stride = 3, positionOffset = 0, uvsOffset = 3, overwrite = false, outArr } = {}) {
    const uvs = this.calculateUVs(vertices, { stride, positionOffset });
    return this._zipInsert(vertices, uvs, { stride, offset: uvsOffset, dataStride: 2, overwrite, outArr });
  }

  /**
   * Calculate an array of normals for given vertices.
   * @param {Float32Array|number[]} vertices          An array of vertices from which to pull data
   * @param {number} [stride=3]                       The stride of the vertices array
   * @param {number|Float32Array} outArr              The stride of the new array or a new array
   * @returns {Float32Array|number[]} Array of normal values
   */
  static calculateNormals(vertices, { stride = 3, positionOffset = 0 } = {} ) {
    const numVertices = Math.floor(vertices.length / stride);
    const normals = new vertices.constructor(numVertices);
    for ( let i = 0, j = 0, iMax = vertices.length; i < iMax; i += (stride * 3) ) {
      const v0 = this._getSinglePosition(vertices, i, positionOffset);
      const v1 = this._getSinglePosition(vertices, i + stride, positionOffset);
      const v2 = this._getSinglePosition(vertices, i + (stride * 2), positionOffset);
      const n = this._calculateNormalForTriangle3d(v0, v1, v2);
      normals[j++] = n.x;
      normals[j++] = n.y;
      normals[j++] = n.z;
      Point3d.release(v0, v1, v2, n);
    }
    return normals;
  }

  static _getSinglePosition(vertices, startIndex = 0, offset = 0) {
    const pt = Point3d.tmp;
    const xIdx = startIndex + offset;
    pt.x = vertices[xIdx];
    pt.y = vertices[xIdx + 1];
    pt.z = vertices[xIdx + 2];
    return pt;
  }

  static _calculateNormalForTriangle3d(v0, v1, v2) {
    const dir0 = v1.subtract(v0);
    const dir1 = v2.subtract(v0);
    const n = dir0.cross(dir1);

    // If collinear, return the n without normalizing to avoid NaN.
    if ( n.magnitude() ) n.normalize(n);
    Point3d.release(dir0, dir1);
    return n;
  }

  /**
   * Calculate an array of UVs for given vertices.
   * This really only works when the vertices are flat w/r/t a 2d plane.
   * Use the vertices' normal vector to map them to a plane.
   * @param {Float32Array|number[]} vertices          An array of vertices from which to pull data
   * @param {number} [stride=3]                       The stride of the vertices array
   * @param {number|Float32Array} outArr              The stride of the new array or a new array
   * @returns {Float32Array|number[]} Array of normal values
   */
  static calculateUVs(vertices, { stride = 3, positionOffset = 0 } = {} ) {
    const numVertices = Math.floor(vertices.length / stride);
    if ( numVertices < 3 ) return new vertices.constructor();

    // Determine the normal for the vertices, using the first three.
    const v0 = this._getSinglePosition(vertices, 0, positionOffset);
    const v1 = this._getSinglePosition(vertices, stride, positionOffset);
    const v2 = this._getSinglePosition(vertices, stride * 2, positionOffset);
    const n = this._calculateNormalForTriangle3d(v0, v1, v2);
    Point3d.release(v0, v1, v2);

    // Project onto an axis.
    const abs = n.abs();
    const [uAxis, vAxis] = (abs.x >= abs.y && abs.x >= abs.z) ? ["y", "z"] // Facing X.
      : (abs.y >= abs.x && abs.y >= abs.z) ? ["x", "z"] // Facing Y.
      : ["x", "y"]; // Facing Z.

    // Calculate uvs and determine min/max.
    let uMin = Number.POSITIVE_INFINITY;
    let uMax = Number.NEGATIVE_INFINITY;
    let vMin = Number.POSITIVE_INFINITY;
    let vMax = Number.POSITIVE_INFINITY;
    const rawUVs = new vertices.constructor(numVertices * 2);
    for ( let i = 0, j = 0; i < numVertices; i += 1 ) {
      const vertex = this._getSinglePosition(vertices, i, positionOffset);
      const u = vertex[uAxis];
      const v = vertex[vAxis];
      uMin = Math.min(uMin, u);
      uMax = Math.max(uMax, u);
      vMin = Math.min(vMin, v);
      vMax = Math.max(vMax, v);
      rawUVs[j++] = u;
      rawUVs[j++] = v;
    }

    // Normalize to between 0.0 and 1.0
    const uRange = (uMax - uMin) || 1;
    const vRange = (vMax - vMin) || 1;
    for ( let i = 0, iMax = rawUVs.length; i < iMax; i += 2 ) {
      rawUVs[i] = (rawUVs[i] - uMin) / uRange;
      rawUVs[i+1] = (rawUVs[i+1] - vMin) / vRange;
    }
    return rawUVs;
  }

  // ----- Vertex array modifications ---- //

  /**
   * For an array of vertices, copy to a new array and increase the stride of the new array.
   * I.e., copy each vertex in turn, expanding space available for it.
   * @param {Float32Array|number[]} vertices          An array of vertices to copy
   * @param {number} [stride=3]                       The stride of the original vertices array
   * @param {number|Float32Array} outArr              The stride of the new array or a new array
   * @returns {Float32Array} The out array
   */
  static expandArrayStride(arr, { stride = 3, outArr } = {}) {
    const vLength = arr.length;
    const nVertices = Math.floor(vLength / stride);

    // Build the new array.
    outArr ||= stride + 3; // Default to arbitrary +3 expansion.
    if ( Number.isNumeric(outArr) ) outArr = new Float32Array(nVertices * outArr);
    const newStride = Math.floor(outArr.length / nVertices);
    if ( newStride < stride ) console.error("expandArrayStride|New array stride not large enough", { arr, stride, outArr });

    // Copy each vertex to the new array.
    for ( let i = 0, j = 0; i < vLength; i += stride, j += newStride ) outArr.set(arr.subarray(i, i + stride), j);
    return outArr;
  }

  /**
   * Straight copy an array to another.
   * @param {Array|TypedArray} src        Array to copy from
   * @param {Array|TypedArray} [dest]     Array to copy into; will create a new array if omitted
   * @returns {Array|TypedArray} The destination array
   */
  static shallowCopyArray(src, dest) {
    dest ??= new src.constructor(src.length);
    if ( Array.isArray(src) ) dest.push(...src);
    else dest.set(src, 0);
    return dest;
  }

  /**
   *

  /**
   * Overwrite data at each vertex (per stride) at a given offset, returning a new array.
   * @param {Array|TypedArray} src              Source array
   * @param {Array|TypedArray} newData          Data to add at each stride; will be same for each stride
   * @param {object} [opts]
   * @param {number} [opts.stride=3]                  Stride of the source array
   * @param {number} [opts.offset=0]                  Offset at which to start to overwrite
   * @param {Array|TypedArray|number} [opts.outArr]   The array to use as a destination or a number indicating the stride for the new array
   * @returns {Array|TypedArray} The outArr
   */
  static overwriteAtOffset(vertices, newData, { stride = 3, offset = 0, outArr } = {}) {
    offset ??= stride;
    const nVertices = Math.floor(vertices.length / stride);

    // Build the new array if needed.
    outArr ||= stride + newData.length;
    if ( Number.isNumeric(outArr) ) outArr = this.expandArrayStride(vertices, { stride, outArr });
    const newStride = Math.floor(outArr.length / nVertices);

    // Add in the data.
    for ( let i = offset, iMax = outArr.length; i < iMax; i += newStride ) outArr.set(newData, i)
    return outArr;
  }

  /**
   * Zip insert set number of elements from newData into specific points at array.
   * Overwrites in place; does not expand the size of the new array.
   * E.g., arr = [0,1,2,3,4,5], offset = 1, stride = 3
   * newData = [a, b, c, d, e, f], numElements = 2
   * outArr = [0,1,a,b,2,3,c,d,4,5,e,f]
   *
   * @param {[]|TypedArray} src
   * @param {[]|TypedArray} newData     Data to add
   *  - If data is not long enough, it cycles around; if too long it omits the end.
   *  - If data is not provided, empty values (or 0 for typed arrays) will be added.
   * @param {number} [stride]           Stride of the original array
   * @param {number} [offset=0]         Where to start overwriting the new data relative to the array elements
   * @param {number} [dataStride=1]     Stride of the data array
   * @param {[]|TypedArray} outArr      Array to store the result; must be length required
   * @returns {[]|TypedArray} The out array.
   */
  static zipOverwrite(src, newData, opts = {}) {
    opts.overwrite = true;
    return this._zipInsert(src, newData, opts);
  }

  /**
   * Zip insert set number of elements from newData into specific points at array.
   * E.g., arr = [0,1,2,3,4,5], offset = 1, stride = 3
   * newData = [a, b, c, d, e, f], numElements = 2
   * outArr = [0,1,a,b,2,3,c,d,4,5,e,f]
   *
   * @param {[]|TypedArray} src
   * @param {[]|TypedArray} newData     Data to add
   *  - If data is not long enough, it cycles around; if too long it omits the end.
   *  - If data is not provided, empty values (or 0 for typed arrays) will be added.
   * @param {number} [stride]           Stride of the original array
   * @param {number} [offset=0]         Where to put the new data relative to the array elements
   * @param {number} [dataStride=1]     Stride of the data array
   * @param {[]|TypedArray} outArr      Array to store the result; must be length required
   * @returns {[]|TypedArray} The out array.
   */
  static zipInsert(src, newData, opts = {}) {
    opts.overwrite = false;
    return this._zipInsert(src, newData, opts);
  }

  static _zipInsert(src, newData, { stride, offset = 0, dataStride = 1, overwrite = false, outArr } = {}) {
    if ( !stride ) { console.error(`zipInsert|stride must be defined.`); return src; }

    // The new array length is a function of the original stride + data stride.
    const nVertices = Math.floor(src.length / stride);
    const requiredDataLength = dataStride * nVertices;
    const newLength = overwrite ? src.length : src.length + requiredDataLength;
    newData ??= new src.constructor();
    if ( newData.length < requiredDataLength ) newData = duplicateArray(newData, Math.ceil(requiredDataLength / newData.length));

    // Create a new array if necessary.
    if ( outArr && outArr.length !== newLength) { console.error(`zipInsert|Requires an array of length ${newLength}`); return src }
    outArr ||= new src.constructor(newLength);

    // Pull and set function depends on where the newData is going.
    let pullFn;
    const overwriteShift = overwrite ? dataStride : 0;
    const newArrStride = overwrite ? stride : dataStride + stride;

    // newData, ...
    if ( !offset ) pullFn = (oldStartIndex, newStartIndex, newElem) => {
      const oldElem = src.subarray(oldStartIndex + overwriteShift, oldStartIndex + stride);
      outArr.set(newElem, newStartIndex);
      outArr.set(oldElem, newStartIndex + newElem.length);
    };

    // Offset is at the end of the original stride:
    // ..., newData
    else if ( offset === stride) pullFn = (oldStartIndex, newStartIndex, newElem) => {
      const oldElem = src.subarray(oldStartIndex, oldStartIndex + stride - overwriteShift)
      outArr.set(oldElem, newStartIndex);
      outArr.set(newElem, newStartIndex + oldElem.length);
    };

    // Offset in middle of original stride:
    // ..., newData, ...
    else pullFn = (oldStartIndex, newStartIndex, newElem) => {
      const oldElem0 = src.subarray(oldStartIndex, oldStartIndex + offset); // All prior to the data offset
      const oldElem1 = src.subarray(oldStartIndex + offset + overwriteShift, oldStartIndex + stride); // All after the data offset, not including data
      outArr.set(oldElem0, newStartIndex);
      outArr.set(newElem, newStartIndex + oldElem0.length);
      outArr.set(oldElem1, newStartIndex + oldElem0.length + newElem.length);
    };

    // Step through the new array, assigning from the original and the new data in turn.
    for ( let oldI = 0, dataI = 0, newI = 0; newI < newLength; oldI += stride, dataI += dataStride, newI += newArrStride ) {
      const newElem = newData.subarray(dataI, dataI + dataStride);
      pullFn(oldI, newI, newElem);
    }
    return outArr;
  }

  static debugDraw(vertices, indices, { draw, omitAxis = "z", addNormals = false, addUVs = false, ...opts} = {}) {
    draw ??= new Draw();
    const triangles = this.toTriangles(vertices, indices, { addNormals, addUVs });
    triangles.forEach(tri => tri.draw2d({ draw, omitAxis, ...opts }));
    return triangles;
  }

  static toTriangles(vertices, indices, { addNormals = false, addUVs = false } = {}) {
    indices ??= Array.fromRange(vertices.length);
    const offset = 3 + (addNormals * 3) + (addUVs * 2);

    const triangles = Array(indices.length / 3 );
    const a = Point3d.tmp;
    const b = Point3d.tmp;
    const c = Point3d.tmp;
    for ( let i = 0, j = 0, iMax = indices.length; i < iMax;) {
      const idx1 = indices[i++] * offset;
      const idx2 = indices[i++] * offset;
      const idx3 = indices[i++] * offset;

      a.set(vertices[idx1], vertices[idx1+1], vertices[idx1+2]);
      b.set(vertices[idx2], vertices[idx2+1], vertices[idx2+2]);
      c.set(vertices[idx3], vertices[idx3+1], vertices[idx3+2]);
      triangles[j++] = Triangle3d.from3Points(a, b, c);
    }
    Point3d.release(a, b, c);
    return triangles;
  }
}

export class HorizontalQuadVertices extends BasicVertices {

  static NUM_FACE_ELEMENTS = 2 * this.NUM_TRIANGLE_ELEMENTS;

  static get top() { return new Float32Array([
      // Position     Normal      UV
      W, N, T,        0, 0, 1,    0, 0,
      W, S, T,        0, 0, 1,    0, 1,
      E, S, T,        0, 0, 1,    1, 1,

      E, N, T,        0, 0, 1,    1, 0,
      W, N, T,        0, 0, 1,    0, 0,
      E, S, T,        0, 0, 1,    1, 1,
    ]);
  }

  static get bottom() { return new Float32Array([
      // Position     Normal      UV
      E, S, B,        0, 0, -1,   1, 0,
      W, S, B,        0, 0, -1,   0, 0,
      W, N, B,        0, 0, -1,   0, 1,

      E, S, B,        0, 0, -1,   1, 0,
      W, N, B,        0, 0, -1,   0, 1,
      E, N, B,        0, 0, -1,   1, 1,
    ]);
  }

  // For tiles, face the texture up, not down as normally expected.
  static get bottomUp() { return new Float32Array([
      // Position     Normal      UV
      E, S, B,        0, 0, -1,   1, 1,
      W, S, B,        0, 0, -1,   0, 1,
      W, N, B,        0, 0, -1,   0, 0,

      E, S, B,        0, 0, -1,   1, 1,
      W, N, B,        0, 0, -1,   0, 0,
      E, N, B,        0, 0, -1,   1, 0,
    ]);
  }

  static _cacheType(type = "up") { return super._cacheType(type); }

  static _getUnitVertices(type = "up") {
    switch ( type ) {
      case "up": return this.top;
      case "down": return this.bottom;
      case "double": return new Float32Array([...this.top, ...this.bottom]);
      case "doubleUp": return new Float32Array([...this.top, ...this.bottomUp]);
    }
  }

  static modelMatrixFromShape(rect, { elevationZ = 0, rotateZ = 0, modelMatrix } = {}) {
    modelMatrix ??= new ModelMatrix();

    // Scale by absolute z-length (vertical height).
    // If the topZ and bottomZ are unbalanced, translate in the z direction to reset topZ to correct elevation.
    // (scale - topZ)
    // e.g. elev 20, -100. zHeight = 120. Untranslated topZ would be 120/2 = 60. Move 20 - 60 = -40.
    const radians = Math.toRadians(rotateZ);
    const center = rect.center;

    // Build transform matrix.
    MatrixFloat32.scale(rect.width, rect.height, 0, modelMatrix.scale);
    MatrixFloat32.translation(center.x, center.y, elevationZ, modelMatrix.translation);
    MatrixFloat32.rotationZ(radians, true, modelMatrix.rotation);
    modelMatrix.needsUpdate = true;
    return modelMatrix;
  }
}

export class VerticalQuadVertices extends BasicVertices {

  static DIRECTIONS = {
    double: "double",
    south: "south",
    north: "north",
    directional: "north",
    left: "north",
    right: "south",

    // CONST.WALL_DIRECTIONS
    0: "double", // NONE
    1: "north",  // LEFT
    2: "south",  // RIGHT

    BOTH: "double",
    LEFT: "north",
    RIGHT: "south",
  };

  // On the y = 0 line.
  // When a --> b is on the y line from -x to +x:
  //   - left: light from left (north) is blocked
  //   - right: light from right (south) is blocked
  static get south() { return new Float32Array([
      // Position     Normal      UV
      E, 0, T,        0, 1, 0,    1, 0,
      W, 0, T,        0, 1, 0,    0, 0,
      W, 0, B,        0, 1, 0,    0, 1,

      E, 0, B,        0, 1, 0,    1, 1,
      E, 0, T,        0, 1, 0,    1, 0,
      W, 0, B,        0, 1, 0,    0, 1,
    ]);
  }

  static north = new Float32Array([
    // Position     Normal      UV
    W, 0, B,        0, -1, 0,    1, 1,
    W, 0, T,        0, -1, 0,    1, 0,
    E, 0, T,        0, -1, 0,    0, 0,

    W, 0, B,        0, -1, 0,    1, 1,
    E, 0, T,        0, -1, 0,    0, 0,
    E, 0, B,        0, -1, 0,    0, 1,
  ]);

  static _cacheType(type = "double") { return super._cacheType(this.DIRECTIONS[type]); }

  static _getUnitVertices(type = "double") {
    type = this.DIRECTIONS[type];
    switch ( type ) {
      case "north": return this.north;
      case "south": return this.south;
      case "double": return new Float32Array([...this.north, ...this.south]);
    }
  }

  static modelMatrixFromShape(segment, { topZ = T, bottomZ = B, rotateZ = 0, modelMatrix } = {}) {
    const { a, b } = segment;
    modelMatrix ??= new ModelMatrix();

    // Scale by absolute z-length (vertical height).
    // If the topZ and bottomZ are unbalanced, translate in the z direction to reset topZ to correct elevation.
    // (scale - topZ)
    // e.g. elev 20, -100. zHeight = 120. Untranslated topZ would be 120/2 = 60. Move 20 - 60 = -40.
    const zHeight = topZ - bottomZ;
    const z = topZ - (zHeight * 0.5);

    const dy = b.y - a.y;
    const dx = b.x - a.x;
    const radians = Math.atan2(dy, dx) + Math.toRadians(rotateZ);
    const center = new PIXI.Point(a.x + (dx / 2), a.y + (dy / 2));
    const length = PIXI.Point.distanceBetween(a, b);

    // Build transform matrix.
    MatrixFloat32.scale(length, 1, zHeight, modelMatrix.scale);
    MatrixFloat32.translation(center.x, center.y, z, modelMatrix.translation);
    MatrixFloat32.rotationZ(radians, true, modelMatrix.rotation);
    return modelMatrix;
  }
}

export class Rectangle3dVertices extends BasicVertices {
  static NUM_FACES = 6; // 6 faces to a cube.

  static NUM_FACE_ELEMENTS = 2 * this.NUM_TRIANGLE_ELEMENTS; // 2 triangles per face.

//   static top = setFloatView([
//     // Position     Normal      UV
//     W, N, T,        0, 0, 1,    0, 0,
//     W, S, T,        0, 0, 1,    0, 1,
//     E, S, T,        0, 0, 1,    1, 1,
//
//     E, N, T,        0, 0, 1,    1, 0,
//     W, N, T,        0, 0, 1,    0, 0,
//     E, S, T,        0, 0, 1,    1, 1,
//   ], this.verticesBuffer, this.NUM_FACE_ELEMENTS * 0);

//   static bottom = setFloatView([
//     // Position     Normal      UV
//     E, S, B,        0, 0, -1,   1, 0,
//     W, S, B,        0, 0, -1,   0, 0,
//     W, N, B,        0, 0, -1,   0, 1,
//
//     E, S, B,        0, 0, -1,   1, 0,
//     W, N, B,        0, 0, -1,   0, 1,
//     E, N, B,        0, 0, -1,   1, 1,
//   ], this.verticesBuffer, this.NUM_FACE_ELEMENTS * 1);

  static get top() { return HorizontalQuadVertices.getUnitVertices("up"); }

  static get bottom() { return HorizontalQuadVertices.getUnitVertices("down"); }

  static get north() { return new Float32Array([
      // Position     Normal      UV
      W, N, B,        0, -1, 0,   1, 1,
      W, N, T,        0, -1, 0,   1, 0,
      E, N, T,        0, -1, 0,   0, 0,

      W, N, B,        0, -1, 0,   1, 1,
      E, N, T,        0, -1, 0,   0, 0,
      E, N, B,        0, -1, 0,   0, 1,
    ]);
  }

  static get south() { return new Float32Array([
      // Position     Normal      UV
      E, S, T,        0, 1, 0,   1, 0,
      W, S, T,        0, 1, 0,   0, 0,
      W, S, B,        0, 1, 0,   0, 1,

      E, S, B,        0, 1, 0,   1, 1,
      E, S, T,        0, 1, 0,   1, 0,
      W, S, B,        0, 1, 0,   0, 1,
    ]);
  }

  static get east() { return new Float32Array([
      // Position     Normal      UV
      E, N, B,        1, 0, 0,   1, 1,
      E, N, T,        1, 0, 0,   1, 0,
      E, S, T,        1, 0, 0,   0, 0,

      E, N, B,        1, 0, 0,   1, 1,
      E, S, T,        1, 0, 0,   0, 0,
      E, S, B,        1, 0, 0,   0, 1,
    ]);
  }

  static get west() { return new Float32Array([
      // Position     Normal      UV
      W, S, T,        -1, 0, 0,   1, 0,
      W, N, T,        -1, 0, 0,   0, 0,
      W, N, B,        -1, 0, 0,   0, 1,

      W, S, B,        -1, 0, 0,   1, 1,
      W, S, T,        -1, 0, 0,   1, 0,
      W, N, B,        -1, 0, 0,   0, 1,
    ]);
  }

  static _cacheType(type = "all") { return super._cacheType(type); }

  static _getUnitVertices(type = "all") {
    const allCacheType = this._cacheType("all");
    let verticesBuffer;
    if ( this.vertexCache.has(allCacheType) ) verticesBuffer = this.vertexCache.get(allCacheType).buffer;
    else {
      // Set all vertices at once in a single buffer.
     verticesBuffer = new ArrayBuffer(this.NUM_FACES * this.NUM_FACE_ELEMENTS * Float32Array.BYTES_PER_ELEMENT);
     setFloatView(this.top, verticesBuffer, this.NUM_FACE_ELEMENTS * 0);
     setFloatView(this.bottom, verticesBuffer, this.NUM_FACE_ELEMENTS * 1);
     setFloatView(this.north, verticesBuffer, this.NUM_FACE_ELEMENTS * 2);
     setFloatView(this.south, verticesBuffer, this.NUM_FACE_ELEMENTS * 3);
     setFloatView(this.east, verticesBuffer, this.NUM_FACE_ELEMENTS * 4);
     setFloatView(this.west, verticesBuffer, this.NUM_FACE_ELEMENTS * 5);
     const all = new Float32Array(verticesBuffer, 0, this.NUM_FACES * this.NUM_FACE_ELEMENTS);
     if ( type === "all" ) return all; // Will be saved in the parent.
     this.vertexCache.set(allCacheType, all);
    }
    switch ( type ) {
      // Case "all" handled above.
      case "top": return setFloatView(this.top, verticesBuffer, this.NUM_FACE_ELEMENTS * 0);
      case "bottom": return setFloatView(this.bottom, verticesBuffer, this.NUM_FACE_ELEMENTS * 1);
      case "north": return setFloatView(this.north, verticesBuffer, this.NUM_FACE_ELEMENTS * 2);
      case "south": return setFloatView(this.south, verticesBuffer, this.NUM_FACE_ELEMENTS * 3);
      case "east": return setFloatView(this.east, verticesBuffer, this.NUM_FACE_ELEMENTS * 4);
      case "west": return setFloatView(this.west, verticesBuffer, this.NUM_FACE_ELEMENTS * 5);
    }
  }

  static modelMatrixFromShape(rect, { topZ = T, bottomZ = B, rotateZ = 0, modelMatrix } = {}) {
    modelMatrix ??= new ModelMatrix();

    const zHeight = topZ - bottomZ;
    const z = bottomZ + (zHeight * 0.5);
    const center = rect.center;
    const radians = Math.toRadians(rotateZ);

    MatrixFloat32.scale(rect.width, rect.height, zHeight, modelMatrix.scale);
    MatrixFloat32.translation(center.x, center.y, z, modelMatrix.translation);
    MatrixFloat32.rotationZ(radians, true, modelMatrix.rotation);
    return modelMatrix;
  }
}

export class Polygon3dVertices extends BasicVertices {

  static isClipper(poly) {
    return poly.matchesClass && (poly.matchesClass(ClipperPaths) || poly.matchesClass(Clipper2Paths));
  }

  static NUM_TRIANGLE_ELEMENTS = 3 * this.NUM_VERTEX_ELEMENTS;

/*
  •--•
 /    \
 • •  •
 |    |
 •----•

Ex: 6 points, 6 outer edges.
    Fan creates 6 triangles, 1 per outer edge.
    So poly.points * 1/2 * triangle length is total length.
*/

  static topLength(poly) {
    if ( this.isClipper(poly) ) console.error("topLength cannot take a clipper path")
    return Math.floor(this.NUM_TRIANGLE_ELEMENTS * poly.points.length * 0.5);
  } // For fan only. Earcut should be this or less.

  static sidesLength(poly) {
    // Each polygon or polygon hole will need corresponding rectangular sides.
    if ( this.isClipper(poly) ) return poly.toPolygons().reduce((acc, curr) =>
      acc + this.sidesLength(curr), 0);
    return Math.floor(this.NUM_TRIANGLE_ELEMENTS * poly.points.length);
  } // Number of points (x,y) * 2

  /**
   * Determine the 3d vertices for a given ClipperPaths or polygon.
   * The polygon represents the top and bottom of the shape, using rectangular side faces.
   * @param {PIXI.Polygon|ClipperPaths|ClipperPaths2} poly
   * @param {object} [opts]
   * @param {number} [opts.topZ=T]        Top elevation
   * @param {number} [opts.bottomZ=B]     Botom elevation
   * @param {boolean} [opts.useFan]       Force fan or force no fan
   * @param {PIXI.Point} [opts.centroid]  The center of the polygon
   * @returns {Float32Array} The vertices, untrimmed
   */
  static calculateVertices(poly, { topZ = T, bottomZ = B, useFan, centroid } = {}) {
    let bounds;
    let center;

    // Attempt to convert various shapes to a polygon.
    if ( this.isClipper(poly) ) poly = poly.simplify();
    if ( poly instanceof PIXI.Rectangle
      || poly instanceof PIXI.Ellipse
      || poly instanceof PIXI.Circle ) {
      bounds = poly.getBounds();
      center = poly.center;
      poly = poly.toPolygon();
   }

    useFan ??= this.canUseFan(poly, centroid);
    if ( useFan ) {
      // At this point, the shape should be a polygon.
      if ( !(poly instanceof PIXI.Polygon) ) console.error("calculateVertices|Polygon is not a PIXI.Polygon", poly);
      const { vertices, top, bottom, sides } = this.buildVertexBufferViews(this.topLength(poly), this.sidesLength(poly));
      bounds ??= poly.getBounds();
      center ??= poly.center;
      const opts = { top, bottom, sides, bounds, center, topZ, bottomZ }
      this.polygonTopBottomFacesFan(poly, opts);
      this.polygonSideFaces(poly, opts);
      return vertices;
    }

    // Shape could be a more complex polygon or ClipperPaths.

    // The top/bottom face lengths may vary due to earcut. Calculate first.
    const { top, bottom } = this.polygonTopBottomFaces(poly, { topZ, bottomZ });
    const res = this.buildVertexBufferViews(top.length, this.sidesLength(poly));
    res.top.set(top);
    res.bottom.set(bottom);
    this.polygonSideFaces(poly, { topZ, bottomZ, sides: res.sides });
    return res.vertices;
  }

  static buildVertexBufferViews(topLength, sidesLength) {
    const totalLength = topLength + topLength + sidesLength;
    const buffer = new ArrayBuffer(totalLength * Float32Array.BYTES_PER_ELEMENT);
    const vertices = new Float32Array(buffer, 0, totalLength);
    const top = new Float32Array(buffer, 0, topLength);
    const bottom = new Float32Array(buffer, topLength * Float32Array.BYTES_PER_ELEMENT, topLength);
    const sides = new Float32Array(buffer, topLength * 2 * Float32Array.BYTES_PER_ELEMENT, sidesLength);
    return { vertices, top, bottom, sides };
  }

  /**
   * Test if an arbitrary polygon can use a fan instead of earcut to triangulate.
   * Fan creates triangles in a fan shape where two vertices are on the edge and the third is the centroid.
   * Works for all convex polygons and some concave polygons.
   * @param {PIXI.Polygon} poly
   * @returns {boolean}
   */
  static canUseFan(poly, centroid) {
    if ( poly instanceof PIXI.Rectangle
      || poly instanceof PIXI.Ellipse
      || poly instanceof PIXI.Circle ) return true;

    // Test Clipper shapes, as could be a regular polygon.
    if ( this.isClipper(poly) ) {
      poly = poly.simplify();
      if ( poly instanceof PIXI.Rectangle ) return true;
    }
    if ( !(poly instanceof PIXI.Polygon) ) return false;

    // Test that the segment between centroid and polygon point does not intersect another edge.
    centroid ??= poly.center;
    if ( !poly.contains(centroid.x, centroid.y) ) return false;
    const lines = [...poly.iteratePoints({ close: false })].map(B => {
      return { A: centroid, B };
    });
    return !poly.linesCross(lines); // Lines cross ignores lines that only share endpoints.
  }

  static polygonTopBottomFacesFan(poly, { bounds, center, top, bottom, topZ = T, bottomZ = B } = {}) {
    if ( this.isClipper(poly) ) poly = poly.simplify();
    if ( poly.isHole ^ poly.isClockwise ) poly.reverseOrientation();

    top ??= new Float32Array(this.topLength(poly));
    bottom ??= new Float32Array(top.length);
    bounds ??= poly.getBounds();
    center ??= poly.center;

    // Start by copy the x,y from the polygon to an array with 8 vertex "slots" per vertex.
    // Copy the center and two points of the polygon to the array.
    // Triangles should match poly orientation (typically ccw). If poly is ccw, triangles will be ccw.
    center = [center.x, center.y];
    const ln = poly.points.length;
    let a = poly.points.slice(ln - 2, ln); // i, i + 2 for the very last point; cycle through to beginning.
    for ( let i = 0, j = 0; i < ln; ) {
      top.set(center, j);
      bottom.set(center, j);
      j += 8;

      top.set(a, j);
      bottom.set(a, j);
      j += 8;

      const b = poly.points.slice(i, i + 2);
      top.set(b, j);
      bottom.set(b, j);
      i += 2; j += 8; // Only increment i once; next triangle shares one point (and center) with this one.
      a = b;
    }

    // Add in elevation in place.
    // Note that after expandArrayStride, the stride is now 8.
    this.overwriteAtOffset(top, [topZ], { stride: 8, offset: 2, outArr: top });
    this.overwriteAtOffset(bottom, [bottomZ], { stride: 8, offset: 2, outArr: bottom });

    // Add in Normals in place.
    this.overwriteAtOffset(top, [0, 0, 1], { stride: 8, offset: 3, dataStride: 3, outArr: top});
    this.overwriteAtOffset(bottom, [0, 0, -1], { stride: 8, offset: 3, dataStride: 3, outArr: top});

    // Add in UVs in place.
    this.appendUVs(top, { stride: 8, uvsOffset: 6, overwrite: true, outArr: top });
    this.appendUVs(bottom, { stride: 8, uvsOffset: 6, overwrite: true, outArr: bottom });

    // Flip the bottom.
    this.flipVertexArrayOrientation(bottom)
    return { top, bottom };
  }

  /**
   * Return vertices for the top or bottom of the polygon.
   * Requires that the polygon be sufficiently convex that it can be described by a fan of
   * polygons joined at its centroid.
   * @param {PIXI.Polygon} poly
   * @param {object} [opts]
   * @param {number} [opts.elevation]     Elevation of the face
   * @param {boolean} [opts.flip]         If true, treat as bottom face
   * @returns {object}
   * - @prop {Float32Array} vertices
   * - @prop {Uint16Array} indices
   */
  static polygonTopBottomFaces(poly, { topZ = T, bottomZ = B } = {}) {
    /* Testing
    poly = _token.constrainedTokenBorder
    vs = PIXI.utils.earcut(poly.points)
    pts = [...poly.iteratePoints({ close: false })]
    tris = [];
    for ( let i = 0; i < vs.length; i += 3 ) {
     const a = pts[vs[i]];
     const b = pts[vs[i+1]];
     const c = pts[vs[i+2]];
     Draw.connectPoints([a, b, c], { color: Draw.COLORS.red })
     tris.push({a, b, c})
    }
    // Earcut appears to keep the counterclockwise order.
    tris.map(tri => foundry.utils.orient2dFast(tri.a, tri.b, tri.c))
    */

    let vertices2d;
    let holes = [];

    // Earcut to determine indices. Then construct the vertices.
    if ( this.isClipper(poly) ) {
      // Assume a more complex shape, possibly with holes. See ClipperPaths.prototype.earcut.
      const coords = poly.toEarcutCoordinates();
      vertices2d = coords.vertices;
      holes = coords.holes;
    } else {
      if ( !(poly instanceof PIXI.Polygon) ) poly = poly.toPolygon();
      if ( poly.isHole ^ poly.isClockwise ) poly.reverseOrientation();
      vertices2d = poly.points;
    }

    // Earcut the polygon to determine the indices and construct empty arrays to hold top and bottom vertex information.
    const indices = new Uint16Array(PIXI.utils.earcut(vertices2d, holes)); // Note: dimensions = 2.

    /* Testing
    // Draw the vertex points.
    const numIndices = indices.length;
    for ( let i = 0; i < vertices2d.length; i += 2 ) {
      const x = vertices2d[i];
      const y = vertices2d[i + 1];
      Draw.point({ x, y }, { radius: 3 })
    }

    // Draw the points.
    stride = 2;
    for ( let i = 0; i < numIndices; i += 1 ) {
      const idx = indices[i] * stride; // Number of the vertex.
      const x = vertices2d[idx];
      const y = vertices2d[idx + 1];
      Draw.point({ x, y }, { radius: 3 })
    }

    // Draw the triangles.
    stride = 2;
    for ( let i = 0; i < numIndices; ) {
      const idx0 = indices[i++] * stride; // Number of the vertex.
      const x0 = vertices2d[idx0];
      const y0 = vertices2d[idx0 + 1];
      const pt0 = new PIXI.Point(x0, y0);
      Draw.point(pt0, { radius: 3 })

      const idx1 = indices[i++] * stride; // Number of the vertex.
      const x1 = vertices2d[idx1];
      const y1 = vertices2d[idx1 + 1];
      const pt1 = new PIXI.Point(x1, y1);
      Draw.point(pt1, { radius: 3 })

      const idx2 = indices[i++] * stride; // Number of the vertex.
      const x2 = vertices2d[idx2];
      const y2 = vertices2d[idx2 + 1];
      const pt2 = new PIXI.Point(x2, y2);
      Draw.point(pt2, { radius: 3 })

      Draw.connectPoints([pt0, pt1, pt2])
    }

    */

    // Construct a full vertex array with 8 vertex "slots" per vertex.
    const top = this.expandArrayStride(vertices2d, { stride: 2, outArr: 8 });
    const bottom = this.expandArrayStride(vertices2d, { stride: 2, outArr: 8 });

    // Add in elevation in place.
    // Note that after expandArrayStride, the stride is now 8.
    this.overwriteAtOffset(top, [topZ], { stride: 8, offset: 2, outArr: top });
    this.overwriteAtOffset(bottom, [bottomZ], { stride: 8, offset: 2, outArr: bottom });

    // Add in Normals in place.
    this.overwriteAtOffset(top, [0, 0, 1], { stride: 8, offset: 3, dataStride: 3, outArr: top});
    this.overwriteAtOffset(bottom, [0, 0, -1], { stride: 8, offset: 3, dataStride: 3, outArr: top});

    // Add in UVs in place.
    this.appendUVs(top, { stride: 8, uvsOffset: 6, overwrite: true, outArr: top });
    this.appendUVs(bottom, { stride: 8, uvsOffset: 6, overwrite: true, outArr: bottom });

    // Expand the vertex array based on earcut indices.
    const topExpanded = this.expandVertexData(indices, top, { stride: 8 });
    const bottomExpanded = this.expandVertexData(indices, bottom, { stride: 8 });

    // Flip the bottom to be counterclockwise.
    this.flipVertexArrayOrientation(bottomExpanded)
    return { top: topExpanded, bottom: bottomExpanded };
  }

  static polygonSideFaces(poly, { topZ = T, bottomZ = B, sides } = {}) {

    sides ??= new Float32Array(this.sidesLength(poly));
    if ( this.isClipper(poly) ) poly = poly.toPolygons();
    if ( Array.isArray(poly) ) {
      const multipleSides = poly.map(p => this.polygonSideFaces(p, { topZ, bottomZ }));
      sides.set(combineTypedArrays(multipleSides));
      return sides;
    }

    // TODO: Do we need to test poly orientation?
    if ( poly.isHole ^ poly.isClockwise ) poly.reverseOrientation();

    const vertexOffset = this.NUM_VERTEX_ELEMENTS;
    if ( !(poly instanceof PIXI.Polygon) ) poly = poly.toPolygon();

    // Some temporary points.
    const a = Point3d.tmp;
    const b = Point3d.tmp;
    const c = Point3d.tmp;
    const d = Point3d.tmp;
    const triPts = [a, b, c, d];
    const n = Point3d.tmp;
    const deltaAB = Point3d.tmp;
    const deltaAC = Point3d.tmp;

    /* Looking at a side face
    a  b     uv: 0,0    1,0
    c  d         0,1    1,1

     CCW edge A -> B, so...
     a and c are taken from A
     b and d are taken from B

     // Indices go b, a, c, d, b, c.
    */

    // UVs match a, b, c, d
    const uvs = [
      { u: 0, v: 0 },
      { u: 0, v: 1 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
    ];

    let j = 0;
    for ( const { A, B } of poly.iterateEdges({ close: true }) ) {
      // Position                   Normal          UV
      // B.x, B.y, topZ     nx, ny, nz      0, 0
      // A.x, A.y, topZ     nx, ny, nz      0, 0
      // A.x, A.y, bottomZ  nx, ny, nz      0, 0
      // B.x, B.y, bottomZ  nx, ny, nz      0, 0
      // B.x, B.y, topZ     nx, ny, nz      0, 0
      // A.x, A.y, bottomZ  nx, ny, nz      0, 0

      a.set(A.x, A.y, topZ);
      b.set(B.x, B.y, topZ);
      c.set(A.x, A.y, bottomZ);
      d.set(B.x, B.y, bottomZ);

      // Calculate the normal
      b.subtract(a, deltaAB);
      c.subtract(a, deltaAC);
      deltaAB.cross(deltaAC, n).normalize(n);

      // Define each vertex.
      // Position     Normal          UV
      // x, y, z      n.x, n.y, n.z   u, v
      const vs = Array(4);
      for ( let i = 0; i < 4; i += 1 ) {
        const pt = triPts[i];
        const uv = uvs[i];
        vs[i] = [pt.x, pt.y, pt.z, n.x, n.y, n.z, uv.u, uv.v];
      }

      // Set the 6 vertices. Indices go b, a, c, d, b, c; or [1, 0, 2, 3, 1, 2]
      sides.set(vs[1], j); j += vertexOffset;
      sides.set(vs[0], j); j += vertexOffset;
      sides.set(vs[2], j); j += vertexOffset;
      sides.set(vs[3], j); j += vertexOffset;
      sides.set(vs[1], j); j += vertexOffset;
      sides.set(vs[2], j); j += vertexOffset;
    }
    Point3d.release(a, b, c, d, n, deltaAB, deltaAC);
    return sides;
  }
}

export class Hex3dVertices extends Polygon3dVertices {

  static canUseFan(_hex) { return true; }

  static _getUnitVertices(hexKey) {
    const { shape, width, height, hexColumns } = this.hexPropertiesForKey(hexKey);
    return this.calculateVertices(shape, { width, height, hexColumns })
  }

  /**
   * Determine the 3d vertices for a given hex shape.
   * The hex polygon represents the top and bottom of the shape, using rectangular side faces.
   * @param {CONST.TOKEN_HEXAGONAL_SHAPES} hexagonalShape
   * @param {object} [opts]
   * @param {number} [opts.topZ=T]        Top elevation
   * @param {number} [opts.bottomZ=B]     Botom elevation
   * @param {boolean} [opts.useFan]       Force fan or force no fan
   * @returns {Float32Array} The vertices, untrimmed
   */
  static calculateVertices(shape, { width = 1, height = 1, hexColumns = false, ...opts } = {}) {
    const hexRes = getHexagonalShape(width, height, shape, hexColumns);
    let poly;
    if ( hexRes ) {
      // getHexagonalShape returns {points, center, snapping}
      // Translate to 0,0.
      poly = new PIXI.Polygon(hexRes.points);
      poly = poly.translate(-hexRes.center.x, -hexRes.center.y);
      if ( poly.isClockwise ) poly.reverseOrientation();

    } else poly = (new PIXI.Rectangle(-width * 0.5, -height * 0.5, width * 0.5, height * 0.5)).toPolygon(); // Fallback.

    // Convert to 3d polygon vertices.
    opts.useFan = true;
    opts.centroid = new PIXI.Point(0, 0); // Centered at 0, 0.
    return super.calculateVertices(poly, opts);
  }

  static hexagonalShapeForToken(token) {
    return getHexagonalShape(token.document.width, token.document.height, token.document.shape, canvas.scene.grid.columns ?? false);
  }

  static calculateVerticesForToken(token) {
    // Center the token at 0,0,0, with unit size 1.
    const { width, height, shape } = token.document;
    return this.calculateVertices(shape, { width, height });
  }

  static hexKeyForToken(token) {
    const { width, height, shape } = token.document;
    const hexColumns = canvas.scene.grid.columns;
    return `${shape}_${width}_${height}_${hexColumns}`;
  }

  static hexPropertiesForKey(hexKey) {
    const values = hexKey.split("_").map(elem => Number(elem));
    return { shape: values[0], width: values[1], height: values[2], hexColumns: values[3] }
  }

  static hexKeyForProperties({ shape = 0, width = 1, height = 1, hexColumns } = {}) {
    return `${shape}_${width}_${height}_${hexColumns}`;
  }
}

export class Ellipse3dVertices extends Polygon3dVertices {
  static unitEllipse = new PIXI.Ellipse(0, 0, 1, 1);

  static topLength(density = this.defaultDensity) { return Math.floor(this.NUM_TRIANGLE_ELEMENTS * density); }

  static sidesLength(density = this.defaultDensity) { return Math.floor(this.NUM_TRIANGLE_ELEMENTS * density * 2); }

  static calculateVertices(ellipse = this.unitEllipse, { density = this.defaultDensity, topZ = T, bottomZ = B } = {}) {
    const poly = ellipse.toPolygon({ density });
    return Polygon3dVertices.calculateVertices(poly, { topZ, bottomZ, centroid: ellipse.center }); // Cannot use super here b/c we want to pretend it is a polygon class.
  }

  static canUseFan(_ellipse) { return true; }

  static polygonTopBottomFacesFan(ellipse = this.unitEllipse, opts = {}) {
    const density = opts.density ?? this.defaultDensity;
    const poly = ellipse.toPolygon({ density });
    opts.center ??= ellipse.center;
    return Polygon3dVertices.polygonTopBottomFacesFan(poly, opts); // Cannot use super here b/c we want to pretend it is a polygon class.
  }

  static polygonTopBottomFaces(ellipse, opts) { return this.polygonTopBottomFacesFan(ellipse, opts); }

  static polygonSideFaces(ellipse, opts = {}) {
    const density = opts.density ?? this.defaultDensity;
    const poly = ellipse.toPolygon({ density });
    return Polygon3dVertices.polygonSideFaces(poly, opts); // Cannot use super here b/c we want to pretend it is a polygon class.
  }

  static get defaultDensity() { return PIXI.Circle.approximateVertexDensity(canvas.grid?.size || 100); }

  static _cacheType(type = this.defaultDensity) { return super._cacheType(type); }

  static _getUnitVertices(density = this.defaultDensity) { return this.calculateVertices(undefined, { density }); }

  static modelMatrixFromShape(ellipse, { topZ = T, bottomZ = B, rotateZ = 0, modelMatrix } = {}) {
    modelMatrix ??= new ModelMatrix();

    const zHeight = topZ - bottomZ;
    const z = bottomZ + (zHeight * 0.5);
    const { width, height } = ellipse;
    const radians = Math.toRadians(rotateZ ?? ellipse.rotation ?? 0);
    const center = ellipse.center;

    // Build transform matrix.
    MatrixFloat32.scale(width, height, zHeight, modelMatrix.scale);
    MatrixFloat32.translation(center.x, center.y, z, modelMatrix.translation);
    MatrixFloat32.rotationZ(radians, true, modelMatrix.rotation);
    modelMatrix.needsUpdate = true;
    return modelMatrix;
  }
}

export class Circle3dVertices extends Ellipse3dVertices {

  static get defaultDensity() { return PIXI.Circle.approximateVertexDensity(canvas.grid?.size || 100); }

  static unitCircle = new PIXI.Circle(0, 0, 1); // Radius of 1; scales upwards by provided radius.

  static polygonTopBottomFacesFan(circle = this.unitCircle, opts) {
    return super.polygonTopBottomFacesFan(circle, opts);
  }

  static calculateVertices(circle = this.unitCircle, { density = this.defaultDensity, topZ = T, bottomZ = B } = {}) {
    const poly = circle.toPolygon({ density });
    return Polygon3dVertices.calculateVertices(poly, { topZ, bottomZ, centroid: circle.center }); // Cannot use super here b/c we want to pretend it is a polygon class.
  }

  static _cacheType(type = this.defaultDensity) { return super._cacheType(type); }

  static _getUnitVertices(density = this.defaultDensity) { return this.calculateVertices(undefined, { density }); }

  static modelMatrixFromShape(circle, { topZ = T, bottomZ = B, modelMatrix } = {}) {
    modelMatrix ??= new ModelMatrix();

    const zHeight = topZ - bottomZ;
    const z = bottomZ + (zHeight * 0.5);
    const { center, radius } = circle;

    // Build transform matrix.
    MatrixFloat32.scale(radius, radius, zHeight, modelMatrix.scale);
    MatrixFloat32.translation(center.x, center.y, z, modelMatrix.translation);
    MatrixFloat32.identity(4, 4, modelMatrix.rotation);
    modelMatrix.needsUpdate = true;
    return modelMatrix;
  }
}

export class SphereVertices extends BasicVertices {

  static get defaultDensity() {
    /*
    // Assume a 1x1 token is sufficient resolution for a decent sphere.
    // The following is approximately 87 from center to far 3d corner for a 100x100x100 token.
    // Point3d.distanceBetween(Point3d.tmp.set(0,0,0), Point3d.tmp.set(50, 50 ,50))
    */
    const w = canvas.grid.sizeX;
    const h = canvas.grid.sizeY;
    const z = canvas.grid.size;
    const r = Point3d.distanceBetween(Point3d.tmp.set(0,0,0), Point3d.tmp.set(w * 0.5, h * 0.5, z * 0.5)); // Want the radius, not the diameter.
    return this.numberOfSphericalPointsForSpacing(r);
  }

  /**
   * How many spherical points are necessary to achieve a given spacing for a given sphere radius?
   * @param {number} [radius=1]
   * @param {number} [spacing]        Defaults to the module spacing default for per-pixel calculator.
   * @returns {number}
   */
  static numberOfSphericalPointsForSpacing(r = 1, l = CONFIG[GEOMETRY_LIB_ID].perPixelSpacing || 10) {
    /*
    Surface area of a sphere is 4πr^2.
    With N points, divide by N to get average area per point.
    Assuming perfectly equidistant points, consider side length of a square with average area.
    l = sqrt(4πr^2/N) = 2r*sqrt(π/N)
    To get N, square both sides and simplify.
    N = (4πr^2) / l^2
    l = 2 * r * Math.sqrt(Math.PI / N);
    */
    return Math.floor((4 * Math.PI * (r ** 2)) / (l ** 2)) || 1;
  }

  static calculateSphericalVertices({ density, r } = {}) {
    // Assume a 1x1 token is sufficient resolution for a decent sphere.
    /*
    // The following is approximately 87. From center to far 3d corner.
    // Point3d.distanceBetween(Point3d.tmp.set(0,0,0), Point3d.tmp.set(50, 50 ,50))
    */
    density ??= r ? Math.floor(this.numberOfSphericalPointsForSpacing(r)) : this.defaultDensity;
    const sphericalPoints = Sphere.pointsLattice(density);

    // Scale the points by 1/2, so instead of -1 to 1 they go from -.5 to .5.
    sphericalPoints.forEach(pt => pt.multiplyScalar(0.5, pt));

    const lonLatPoints = sphericalPoints.map(pt => cartesianToLonLat(pt));
    const lonLatArr = lonLatPoints.map(pt => [pt.x, pt.y])

    const delauney = geoDelaunay(lonLatArr);
    const tris3d = delauney.triangles.map(triIndices => {
      const a = sphericalPoints[triIndices[0]];
      const b = sphericalPoints[triIndices[1]];
      const c = sphericalPoints[triIndices[2]];
      return Triangle3d.from3Points(a, b, c);
    });

    // Test by scaling.
    // scaledTris3d = tris3d.map(tri => tri.scale({ x: 1000, y: 1000, z: 1000 }))
    // scaledTris3d.forEach(tri => tri.draw2d())

    Point3d.release(...sphericalPoints);
    PIXI.Point.release(...lonLatPoints);
    const vertices = Triangle3d.trianglesToVertices(tris3d, { addNormals: true })
    tris3d.forEach(tri => Point3d.release(...tri.points));
    return vertices;
  }

  static _cacheType(type = this.defaultDensity) { return super._cacheType(type); }

  static _getUnitVertices(density = this.defaultDensity) {
    const vertices = this.calculateSphericalVertices({ density })
    const verticesNormalUVs = this.expandArrayStride(vertices, { stride: 8, outArr: 8 });
    this.appendNormals(verticesNormalUVs, { stride: 8, positionOffset: 0, normalsOffset: 3, overwrite: true, outArr: verticesNormalUVs });
    this.appendUVs(verticesNormalUVs, { stride: 8, positionOffset: 0, uvsOffset: 6, overwrite: true, outArr: verticesNormalUVs });
    return verticesNormalUVs;
  }

  static modelMatrixFromShape(circle, { elevationZ = 0, modelMatrix } = {}) {
    if ( circle instanceof Sphere ) return this._modelMatrixFromSphere(circle, { modelMatrix });
    modelMatrix ??= new ModelMatrix();

    // Build transform matrix.
    MatrixFloat32.scale(circle.radius, circle.radius, circle.radius, modelMatrix.scale);
    MatrixFloat32.translation(circle.x, circle.y, elevationZ, modelMatrix.translation);
    MatrixFloat32.identity(4, 4, modelMatrix.rotation);
    modelMatrix.needsUpdate = true;
    return modelMatrix;
  }

  static _modelMatrixFromSphere(sphere, { modelMatrix } = {}) {
    modelMatrix ??= new ModelMatrix();

    // Build transform matrix.
    MatrixFloat32.scale(sphere.radius, sphere.radius, sphere.radius, modelMatrix.scale);
    MatrixFloat32.translation(sphere.x, sphere.y, sphere.z, modelMatrix.translation);
    MatrixFloat32.identity(4, 4, modelMatrix.rotation);
    modelMatrix.needsUpdate = true;
    return modelMatrix;
  }

}

// ----- NOTE: Helper functions ----- //
function setFloatView(arr, buffer, offset = 0) {
  const out = new Float32Array(buffer, offset * Float32Array.BYTES_PER_ELEMENT, arr.length);
  out.set(arr);
  return out;
};

/**
 * From foundry's BaseToken.#getHexagonalShape.
 * Get the hexagonal shape given the type, width, and height.
 * @param {boolean} columns    Column-based instead of row-based hexagonal grid?
 * @param {number} type        The hexagonal shape (one of {@link CONST.TOKEN_HEXAGONAL_SHAPES})
 * @param {number} width       The width of the Token (positive)
 * @param {number} height      The height of the Token (positive)
 * @returns {DeepReadonly<TokenHexagonalShape>|null}    The hexagonal shape or null if there is no shape
 *                                                      for the given combination of arguments
 */
const hexagonalShapes = new Map();

/**
 * Get the hexagonal shape given the type, width, and height.
 * @param {number} width                                    The width of the Token (positive)
 * @param {number} height                                   The height of the Token (positive)
 * @param {TokenShapeType} shape                            The shape (one of {@link CONST.TOKEN_SHAPES})
 * @param {boolean} columns                                 Column-based instead of row-based hexagonal grid?
 * @returns {DeepReadonly<TokenHexagonalShapeData>|null}    The hexagonal shape or null if there is no shape
 *                                                          for the given combination of arguments
 */
function getHexagonalShape(width, height, shape, columns) {
  if ( !Number.isInteger(width * 2) || !Number.isInteger(height * 2) ) return null;

  const TOKEN_SHAPES = CONST.TOKEN_SHAPES;

  // TODO: can we set a max of 2^13 on width and height so that we may use an integer key?
  const key = `${width},${height},${shape}${columns ? "C" : "R"}`;
  let data = hexagonalShapes.get(key); // BaseToken.#hexagonalShapes.get(key);
  if ( data ) return data;

  // Hexagon symmetry
  if ( columns ) {
    const rowData = getHexagonalShape(height, width, shape, false); // BaseToken.#getHexagonalShape(height, width, shape, false);
    if ( !rowData ) return null;

    // Transpose the offsets/points of the shape in row orientation
    const offsets = {even: [], odd: []};
    for ( const {i, j} of rowData.offsets.even ) offsets.even.push({i: j, j: i});
    for ( const {i, j} of rowData.offsets.odd ) offsets.odd.push({i: j, j: i});
    offsets.even.sort(({i: i0, j: j0}, {i: i1, j: j1}) => (j0 - j1) || (i0 - i1));
    offsets.odd.sort(({i: i0, j: j0}, {i: i1, j: j1}) => (j0 - j1) || (i0 - i1));
    const points = [];
    for ( let i = rowData.points.length; i > 0; i -= 2 ) {
      points.push(rowData.points[i - 1], rowData.points[i - 2]);
    }
    data = {
      offsets,
      points,
      center: {x: rowData.center.y, y: rowData.center.x},
      anchor: {x: rowData.anchor.y, y: rowData.anchor.x}
    };
  }

  // Small hexagon
  else if ( (width === 0.5) && (height === 0.5) ) {
    data = {
      offsets: {even: [{i: 0, j: 0}], odd: [{i: 0, j: 0}]},
      points: [0.25, 0.0, 0.5, 0.125, 0.5, 0.375, 0.25, 0.5, 0.0, 0.375, 0.0, 0.125],
      center: {x: 0.25, y: 0.25},
      anchor: {x: 0.25, y: 0.25}
    };
  }

  // Normal hexagon
  else if ( (width === 1) && (height === 1) ) {
    data = {
      offsets: {even: [{i: 0, j: 0}], odd: [{i: 0, j: 0}]},
      points: [0.5, 0.0, 1.0, 0.25, 1, 0.75, 0.5, 1.0, 0.0, 0.75, 0.0, 0.25],
      center: {x: 0.5, y: 0.5},
      anchor: {x: 0.5, y: 0.5}
    };
  }

  // Hexagonal ellipse or trapezoid
  else if ( shape <= TOKEN_SHAPES.TRAPEZOID_2 ) {
    data = createHexagonalEllipseOrTrapezoid(width, height, shape); // BaseToken.#createHexagonalEllipseOrTrapezoid(width, height, shape);
  }

  // Hexagonal rectangle
  else if ( shape <= TOKEN_SHAPES.RECTANGLE_2 ) {
    data = createHexagonalRectangle(width, height, shape); // BaseToken.#createHexagonalRectangle(width, height, shape);
  }

  // Cache the shape
  if ( data ) {
    foundry.utils.deepFreeze(data);
    hexagonalShapes.set(key,data); // BaseToken.#hexagonalShapes.set(key, data);
  }
  return data;
}

/**
 * From foundry's BaseToken.#createHexagonalEllipseOrTrapezoid
 *
 * Create the row-based hexagonal ellipse/trapezoid given the type, width, and height.
 * @param {number} width                   The width of the Token (positive)
 * @param {number} height                  The height of the Token (positive)
 * @param {number} shape                   The shape type (must be ELLIPSE_1, ELLIPSE_1, TRAPEZOID_1, or TRAPEZOID_2)
 * @returns {TokenHexagonalShapeData|null} The hexagonal shape or null if there is no shape for the given combination
 *                                         of arguments
 */
function createHexagonalEllipseOrTrapezoid(width, height, shape) {
  if ( !Number.isInteger(width) || !Number.isInteger(height) ) return null;
  const TOKEN_SHAPES = CONST.TOKEN_SHAPES;
  const points = [];
  let top;
  let bottom;
  switch ( shape ) {
    case TOKEN_SHAPES.ELLIPSE_1:
      if ( height >= 2 * width ) return null;
      top = Math.floor(height / 2);
      bottom = Math.floor((height - 1) / 2);
      break;
    case TOKEN_SHAPES.ELLIPSE_2:
      if ( height >= 2 * width ) return null;
      top = Math.floor((height - 1) / 2);
      bottom = Math.floor(height / 2);
      break;
    case TOKEN_SHAPES.TRAPEZOID_1:
      if ( height > width ) return null;
      top = height - 1;
      bottom = 0;
      break;
    case TOKEN_SHAPES.TRAPEZOID_2:
      if ( height > width ) return null;
      top = 0;
      bottom = height - 1;
      break;
  }
  const offsets = {even: [], odd: []};
  for ( let i = bottom; i > 0; i-- ) {
    for ( let j = 0; j < width - i; j++ ) {
      offsets.even.push({i: bottom - i, j: j + (((bottom & 1) + i + 1) >> 1)});
      offsets.odd.push({i: bottom - i, j: j + (((bottom & 1) + i) >> 1)});
    }
  }
  for ( let i = 0; i <= top; i++ ) {
    for ( let j = 0; j < width - i; j++ ) {
      offsets.even.push({i: bottom + i, j: j + (((bottom & 1) + i + 1) >> 1)});
      offsets.odd.push({i: bottom + i, j: j + (((bottom & 1) + i) >> 1)});
    }
  }
  let x = 0.5 * bottom;
  let y = 0.25;
  for ( let k = width - bottom; k--; ) {
    points.push(x, y);
    x += 0.5;
    y -= 0.25;
    points.push(x, y);
    x += 0.5;
    y += 0.25;
  }
  points.push(x, y);
  for ( let k = bottom; k--; ) {
    y += 0.5;
    points.push(x, y);
    x += 0.5;
    y += 0.25;
    points.push(x, y);
  }
  y += 0.5;
  for ( let k = top; k--; ) {
    points.push(x, y);
    x -= 0.5;
    y += 0.25;
    points.push(x, y);
    y += 0.5;
  }
  for ( let k = width - top; k--; ) {
    points.push(x, y);
    x -= 0.5;
    y += 0.25;
    points.push(x, y);
    x -= 0.5;
    y -= 0.25;
  }
  points.push(x, y);
  for ( let k = top; k--; ) {
    y -= 0.5;
    points.push(x, y);
    x -= 0.5;
    y -= 0.25;
    points.push(x, y);
  }
  y -= 0.5;
  for ( let k = bottom; k--; ) {
    points.push(x, y);
    x += 0.5;
    y -= 0.25;
    points.push(x, y);
    y -= 0.5;
  }
  return {
    offsets,
    points,
    // We use the centroid of the polygon for ellipse and trapzoid shapes
    center: foundry.utils.polygonCentroid(points),
    anchor: bottom % 2 ? {x: 0.0, y: 0.5} : {x: 0.5, y: 0.5}
  };
}

/**
 * From foundry's BaseToken.#createHexagonalRectangle
 *
 * Create the row-based hexagonal rectangle given the type, width, and height.
 * @param {number} width                      The width of the Token (positive)
 * @param {number} height                     The height of the Token (positive)
 * @param {TokenShapeType} shape              The shape type (must be RECTANGLE_1 or RECTANGLE_2)
 * @returns {TokenHexagonalShapeData|null}    The hexagonal shape or null if there is no shape
 *                                            for the given combination of arguments
 */
function createHexagonalRectangle(width, height, shape) {
  if ( (width < 1) || !Number.isInteger(height) ) return null;
  if ( (width === 1) && (height > 1) ) return null;
  if ( !Number.isInteger(width) && (height === 1) ) return null;
  const even = (shape === CONST.TOKEN_SHAPES.RECTANGLE_1) || (height === 1);
  const offsets = {even: [], odd: []};
  for ( let i = 0; i < height; i++) {
    const j0 = even ? 0 : (i + 1) & 1;
    const j1 = ((width + ((i & 1) * 0.5)) | 0) - (even ? (i & 1) : 0);
    for ( let j = j0; j < j1; j++ ) {
      offsets.even.push({i, j: j + (i & 1)});
      offsets.odd.push({i, j});
    }
  }
  let x = even ? 0.0 : 0.5;
  let y = 0.25;
  const points = [x, y];
  while ( x + 1 <= width ) {
    x += 0.5;
    y -= 0.25;
    points.push(x, y);
    x += 0.5;
    y += 0.25;
    points.push(x, y);
  }
  if ( x !== width ) {
    y += 0.5;
    points.push(x, y);
    x += 0.5;
    y += 0.25;
    points.push(x, y);
  }
  while ( y + 1.5 <= 0.75 * height ) {
    y += 0.5;
    points.push(x, y);
    x -= 0.5;
    y += 0.25;
    points.push(x, y);
    y += 0.5;
    points.push(x, y);
    x += 0.5;
    y += 0.25;
    points.push(x, y);
  }
  if ( y + 0.75 < 0.75 * height ) {
    y += 0.5;
    points.push(x, y);
    x -= 0.5;
    y += 0.25;
    points.push(x, y);
  }
  y += 0.5;
  points.push(x, y);
  while ( x - 1 >= 0 ) {
    x -= 0.5;
    y += 0.25;
    points.push(x, y);
    x -= 0.5;
    y -= 0.25;
    points.push(x, y);
  }
  if ( x !== 0 ) {
    y -= 0.5;
    points.push(x, y);
    x -= 0.5;
    y -= 0.25;
    points.push(x, y);
  }
  while ( y - 1.5 > 0 ) {
    y -= 0.5;
    points.push(x, y);
    x += 0.5;
    y -= 0.25;
    points.push(x, y);
    y -= 0.5;
    points.push(x, y);
    x -= 0.5;
    y -= 0.25;
    points.push(x, y);
  }
  if ( y - 0.75 > 0 ) {
    y -= 0.5;
    points.push(x, y);
    x += 0.5;
    y -= 0.25;
    points.push(x, y);
  }
  return {
    offsets,
    points,
    // We use center of the rectangle (and not the centroid of the polygon) for the rectangle shapes
    center: {
      x: width / 2,
      y: ((0.75 * Math.floor(height)) + (0.5 * (height % 1)) + 0.25) / 2
    },
    anchor: even ? {x: 0.5, y: 0.5} : {x: 0.0, y: 0.5}
  };
}

function duplicateArray(arr, times) {
  if ( !arr.length ) return new arr.constructor(times);

  if ( Array.isArray(arr) ) return Array(times)
    .fill(arr)
    .reduce((accumulator, currentArray) => accumulator.concat(currentArray), []);

  // Typed array
  const n = arr.length;
  const out = new arr.constructor(n * times);
  for ( let i = 0; i < times; i += 1 ) out.set(arr, i * n);
  return out;
}

/**
 * Converts 3D Cartesian coordinates (x, y, z) on a sphere
 * to geographic latitude and longitude in degrees.
 * @param {Point3d} pt
 * @returns {PIXI.Point} Object with latitude and longitude in degrees.
 * @returns {{lon: number, lat: number}}
 */
function cartesianToLonLat(pt) {
  // Calculate the radius 'r' from the center (0,0,0) to the point (x,y,z).
  // This ensures the function works even if the points aren't on a unit sphere (r=1).
  const r = pt.magnitude();

  // If r is 0, the point is at the origin. We'll default to (0, 0).
  if ( r === 0 ) PIXI.Point.tmp.set(0, 0);

  // --- Calculate Latitude ---
  // Latitude (lat) is the angle from the equatorial (XY) plane.
  // We can find it using arcsin(z / r).
  // Math.asin() returns values in radians from -PI/2 to PI/2.
  const latRadians = Math.asin(pt.z / r);

  // --- Calculate Longitude ---
  // Longitude (lon) is the angle in the XY-plane from the +X axis.
  // Math.atan2(y, x) correctly calculates the angle in all four quadrants.
  // It returns values in radians from -PI to PI.
  const lonRadians = Math.atan2(-pt.y, pt.x);

  // Convert radians to degrees
  const lat = latRadians * (180 / Math.PI);
  const lon = lonRadians * (180 / Math.PI);

  return PIXI.Point.tmp.set(lon, lat);
}

/* Testing
Draw = CONFIG.GeometryLib.lib.Draw;
vertices = CONFIG.GeometryLib.lib.placeableGeometry.vertices;

vertices.HorizontalQuadVertices.getUnitVertices()
vertices.HorizontalQuadVertices.getUnitVertices("down")

vertices.VerticalQuadVertices.getUnitVertices()
vertices.VerticalQuadVertices.getUnitVertices("directional")

vertices.Rectangle3dVertices.getUnitVertices("south")
vertices.Rectangle3dVertices.getUnitVertices()
vertices.Rectangle3dVertices.getUnitVertices("top")

hexKey = vertices.Hex3dVertices.hexKeyForToken(_token)
vertices.Hex3dVertices.getUnitVertices(hexKey)

vertices.Ellipse3dVertices.getUnitVertices();
vertices.Circle3dVertices.getUnitVertices();
vertices.SphereVertices.getUnitVertices()

// Tile
rect = new PIXI.Rectangle(100, 100, 200, 300)
v = vertices.HorizontalQuadVertices.calculateVerticesForShape(rect, { })
Draw.shape(rect, { color: Draw.COLORS.blue, width: 5, alpha: 0.25 })
vertices.BasicVertices.debugDraw(v, undefined, { color: Draw.COLORS.orange, addNormals: true, addUVs: true })

v = vertices.HorizontalQuadVertices.calculateVerticesForShape(rect, { rotateZ: 45 })
vertices.BasicVertices.debugDraw(v, undefined, { color: Draw.COLORS.orange, addNormals: true, addUVs: true })

// Wall
a = new PIXI.Point(10, 20)
b = new PIXI.Point(100, 200)
v = vertices.VerticalQuadVertices.calculateVerticesForShape({ a, b }, { topZ: 100, bottomZ: -100 })
Draw.segment({ a, b }, { color: Draw.COLORS.blue, width: 5, alpha: 0.25 })
vertices.BasicVertices.debugDraw(v, undefined, { color: Draw.COLORS.orange, addNormals: true, addUVs: true })

// Token
rect = new PIXI.Rectangle(100, 100, 200, 300)
v = vertices.Rectangle3dVertices.calculateVerticesForShape(rect, { })
Draw.shape(rect, { color: Draw.COLORS.blue, width: 5, alpha: 0.25 })
vertices.BasicVertices.debugDraw(v, undefined, { color: Draw.COLORS.orange, addNormals: true, addUVs: true })

v = vertices.HorizontalQuadVertices.calculateVerticesForShape(rect, { rotateZ: 45 })
vertices.BasicVertices.debugDraw(v, undefined, { color: Draw.COLORS.orange, addNormals: true, addUVs: true })




rect = _token.getBounds();
let { topZ, bottomZ } = _token


// Hex Token

// Circle Token
cir = new PIXI.Circle(100, 200, 200)
v = vertices.Circle3dVertices.calculateVerticesForShape(cir)
Draw.shape(cir, { color: Draw.COLORS.blue, width: 5, alpha: 0.25 })
vertices.BasicVertices.debugDraw(v, undefined, { color: Draw.COLORS.orange, addNormals: true, addUVs: true })



// Ellipse Token
ell = new PIXI.Ellipse(100, 100, 100, 200)
v = vertices.Ellipse3dVertices.calculateVerticesForShape(ell)
Draw.shape(ell, { color: Draw.COLORS.blue, width: 5, alpha: 0.25 })
vertices.BasicVertices.debugDraw(v, undefined, { color: Draw.COLORS.orange, addNormals: true, addUVs: true })

v = vertices.Ellipse3dVertices.calculateVerticesForShape(ell, { rotateZ: 45 })
vertices.BasicVertices.debugDraw(v, undefined, { color: Draw.COLORS.orange, addNormals: true, addUVs: true })

// Token sphere
Point3d = CONFIG.GeometryLib.lib.threeD.Point3d
Sphere = CONFIG.GeometryLib.lib.threeD.Sphere
sphere = Sphere.fromCenterPoint(new Point3d(100, 200, 300), 200)
const cir = sphere.toCircle2d()

v = vertices.SphereVertices.calculateVerticesForShape(cir)
Draw.shape(cir, { color: Draw.COLORS.blue, width: 5, alpha: 0.25 })
vertices.BasicVertices.debugDraw(v, undefined, { color: Draw.COLORS.orange, addNormals: true, addUVs: true })




*/

