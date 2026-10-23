/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { combineTypedArrays } from "../util.js";
import { Triangle3d } from "../3d/Polygon3d.js";
import { BasicVertices } from "./BasicVertices.js";

/**
 * @typedef {object} VertexIndexObject
 *
 * Vertices and indices that represent an object.
 * @param {string} key            Key used in the AbstractInstancedVertices.instanceMap
 * @param {boolean} hasUVs        If true, includes UVs as part of the vertices
 * @param {boolean} hasNormals    If true, includes normals as part of the vertices
 * @param {TypedArray} vertices   Vertices for the object. Representation is [p.x, p.y, p.z|n.x, n.y, n.z|u, v]
 * @param {TypedArray} indices    Indices describing the shape for the given vertices
 *
 * Calculated
 * @type {number} stride          Stride for the vertices
 */
export class VertexObject {

  hasUVs = true;

  hasNormals = true;

  vertices = new Float32Array();

  indices = null;

  #positionStride = 3;

  get positionStride() { return this.#positionStride; }

  get stride() { return this.#positionStride + (this.hasUVs * 2) + (this.hasNormals * 3); }

  _lightCopy(out) {
    out ??= new this.constructor();
    out.hasUVs = this.hasUVs;
    out.hasNormals = this.hasNormals;
    return out;
  }

  clone(out) {
    out ??= this._lightCopy();
    out.vertices = new Float32Array(this.vertices);
    out.indices = this.indices ? new Uint16Array(this.indices) : null;
    return out;
  }

  transformToModel(M, out) {
    out ??= this.clone();
    if ( !(this.stride == out.stride
        && this.positionStride === out.positionStride) ) console.warn("VertexObject|transformToModel strides don't match.");

    // Indices also need to be equivalent, but testing every one would be performance-intensive. Just confirm the lengths.
    if ( out.indices.length !== this.indices.length ) console.warn("VertexObject|transformToModel indices don't match.");

    BasicVertices.transformVertexPositions(this.vertices, M, { stride: this.stride, outVertices: out.vertices });
    return out;
  }

  dropNormalsAndUVs({ keepNormals = false, keepUVs = false, out } = {}) {
    if ( !(this.hasNormals || this.hasUVs) || (keepNormals && keepUVs) ) return this.clone(out);
    out ??= this._lightCopy();

    const deletionLength = ((!keepNormals && this.hasNormals) * 3) + ((!keepUVs && this.hasUVs) * 2);
    const startingOffset = (keepNormals && this.hasNormals) ? 6 : 3;  // position (3), normals (3), uvs(2)

    out.vertices = BasicVertices.cutVertexData(this.vertices, { startingOffset, deletionLength, stride: this.stride });
    out.hasNormals &&= keepNormals;
    out.hasUVs &&= keepUVs;
    return out;
  }

  condense(out) {
    out ??= this._lightCopy();
    if ( this.indices ) {
      console.warn("VertexObject#condense|Object already has indices.");
      if ( out === this ) return this;
      out.vertices = this.vertices.slice();
      out.indices = this.indices.slice();
      return out;
    }

    const res = BasicVertices.condenseVertexData(this.vertices, { stride: this.stride });
    out.vertices = res.vertices;
    out.indices = res.indices;
    return out;
  }

  expand(out) {
    out ??= this._lightCopy();
    if ( !this.indices ) {
      console.warn("VertexObject#expand|Object does not have indices.");
      if ( out === this ) return this;
      out.vertices = this.vertices.slice();
      out.indices = null;
      return out;
    }
    out.vertices = BasicVertices.expandVertexData(this.indices, this.vertices, { stride: this.stride });
    out.indices = null;
    return out;
  }

  /**
   * Drop the z position component in place.
   */
  dropZ() {
    // Must be in place to set the private positionStride property.
    if ( this.#positionStride === 2 ) return;
    this.vertices = BasicVertices.cutVertexData(this.vertices, { startingOffset: 2, deletionLength: 1, stride: this.stride });
    this.#positionStride = 2;
  }

  toTriangles() { return Triangle3d.fromVertices(this.vertices, this.indices, { stride: this.stride }); }

  combine(...others) {
    let curr = this;
    if ( curr.indices ) curr = curr.expand();
    const vertices = [curr.vertices];
    for ( const other of others ) {
      if ( this.stride !== other.stride ) return console.error(`${this.constructor.name}|Cannot combine different strides.`, this, other);
      const vs = other.indices ? other.expand().vertices : other.vertices;
      vertices.push(vs);
    }

    const out = this._lightCopy();
    out.vertices = combineTypedArrays(vertices)
    return out;
  }

  debugDraw(opts = {}) {
    opts.stride = this.stride;
    BasicVertices.debugDraw(this.vertices, this.indices, opts);
  }
}