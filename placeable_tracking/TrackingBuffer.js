/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/**
 * Map to link arbitrary ids to index integers.
 * Allows reverse lookup and tracking of used indices.
 */
export class IndexMap extends Map {
  // Each arbitrary id is stored in an element of the array corresponding to its index.
  // Index may have null or undefined values.
  /** @type {*[]} */
  #index = [];

  set(key, value) {
    if ( !Number.isInteger(value) || value < 0 ) throw new TypeError("IndexedMap|Value must be positive integer", value);
    this.#index[value] = key;
    super.set(key, value);
  }

  hasIndex(value) { return Boolean(this.#index[value]); }

  getKeyAtIndex(value) { return this.#index[value]; }

  get maxIndex() { return this.#index.length - 1; }

  clear() {
    this.#index.length = 0;
    super.clear();
  }

  delete(key) {
    const value = this.get(key);
    if ( typeof value !== "undefined" ) {
      this.#index[value] = null;

      // Trim trailing nulls so maxIndex stays perfectly accurate.
      while ( this.#index.length > 0
        && this.#index[this.#index.length - 1] == null ) this.#index.pop();
    }
    return super.delete(key);
  }

  /**
   * The next empty index or a new index if the index array is full.
   */
  get nextIndex() {
    const i = this.#index.findIndex(elem => elem == null);
    if ( ~i ) return i;
    return this.#index.length;
  }

  *iterateEmptyIndices() {
    const index = this.#index;
    for ( let i = 0, iMax = index.length; i < iMax; i += 1 ) {
      const elem = index[i];
      if ( elem == null ) yield i;
    }
    yield index.length;
  }
}

export class IndexWeakMap extends WeakMap {
  #index = [];

  set(key, value) {
    if ( !Number.isInteger(value) || value < 0 ) throw new TypeError("IndexedMap|Value must be positive integer", value);
    this.#index[value] = new WeakRef(key);
    super.set(key, value);
  }

  mayHaveIndex(value) { return Boolean(this.#index[value]); }

  hasIndex(value) { return Boolean(this.getKeyAtIndex(value)); }

  getKeyAtIndex(value) { return this.#index[value]?.deref(); }

  clear() {
    this.#index.length = 0;
    // No WeakMap#clear.
  }

  delete(key) {
    const value = this.get(key);
    if ( typeof value !== "undefined" ) this.#index[value] = null;
    return super.delete(key);
  }

  /**
   * The next empty index or a new index if the index array is full.
   * @type {number}
   */
  get nextIndex() {
    const index = this.#index;
    for ( let i = 0, iMax = index.length; i < iMax; i += 1 ) {
      const elem = index[i];
      if ( !elem ) return i;
      if ( typeof elem.deref() === "undefined" ) return i;
    }
    return index.length;
  }

  *iterateEmptyIndices() {
    const index = this.#index;
    for ( let i = 0, iMax = index.length; i < iMax; i += 1 ) {
      const elem = index[i];
      if ( elem == null ) yield i;
      else if ( typeof elem.deref() === "undefined") return i;
    }
    yield index.length;
  }

  clean() {
    const index = this.#index;
    for ( let i = 0, iMax = index.length; i < iMax; i += 1 ) {
      const elem = index[i];
      if ( elem == null ) continue;
      if ( typeof elem.deref() === "undefined") index[i] = null;
    }
  }
}


/**
 * Helper class that tracks the offsets of a variable length buffer,
 * but does not actually create the buffer or its components (facets).
 * Tracks total buffer size and associates arbitrary ids with indexes along the buffer.
 */
export class VariableLengthAbstractBuffer {
  /** @type {number} */
  static RESIZE_MULTIPLIER = 2; // Must be an integer.

  /**
   * @param {object} [opts]
   * @param {number} [numFacets=0]                  Number of components / facets to represent
   * @param {class} [opts.type=Float32Array]        Class of the typed array; may be modified at any time
   * @param {number|number[]} [opts.facetLengths]   Array identifying the length of each facet or a number if each facet has the same length
   * @param {number} [opts.initialMaxFacets]               If set, the buffer will be at least this large; useful if numFacets is 0
   * @param {*[]} [opts.ids]                        Label for each facet; extra labels will be ignored; defaults to index number
   */
  constructor({ numFacets = 0, facetLengths = [], type, initialMaxFacets = 1, ids } = {}) {
    if ( type ) this.#type = type;

    let arrayLength;
    if ( Number.isNumeric(facetLengths) ) {
      numFacets ||= 0;
      arrayLength = facetLengths * numFacets;
      facetLengths = (new Array(numFacets)).fill(facetLengths);
    } else arrayLength = facetLengths.reduce((acc, curr) => acc + curr, 0);
    this.#facetLengths = facetLengths;
    this.#maxLength = Math.max(arrayLength, initialMaxFacets * (arrayLength / (numFacets || 1))); // Take average facet length to use with initialMaxFacets.

    // Set the index ids for each facet created thus far.
    numFacets = this.#facetLengths.length;
    ids ??= Array.fromRange(numFacets);
    for ( let i = 0; i < numFacets; i += 1 ) this.facetIdMap.set(ids[i], i);
  }

  calculateOffsets() {
    const n = this.numFacets + 1;
    this.#cumulativeFacetLengths.length = n;
    this.#cumulativeFacetLengths[0] = 0;
    for ( let i = 1; i < n; i += 1 ) {
      this.#cumulativeFacetLengths[i] = this.#cumulativeFacetLengths[i - 1] + this.#facetLengths[i - 1];
    }
  }

  // ----- NOTE: Properties ----- //
  #type = Float32Array;

  get type() { return this.#type; }

  set type(value) { this.#type = value; }

  #maxLength = 0;

  get maxLength() { return this.#maxLength; }

  #facetLengths = [];

  get facetLengths() { return [...this.#facetLengths]; }

  #cumulativeFacetLengths = [];

  get cumulativeFacetLengths() { return [...this.#cumulativeFacetLengths]; }

  // ----- NOTE: Calculated properties ----- //

  get maxByteLength() { return this.#maxLength * this.#type.BYTES_PER_ELEMENT; }

  get numFacets() { return this.#facetLengths.length; }

  get arrayLength() { return this.#cumulativeFacetLengths.at(-1) || 0; }

  get arraySize() { return this.arrayLength * this.#type.BYTES_PER_ELEMENT; }

  get byteOffsets() { return this.#cumulativeFacetLengths.map(elem => elem * this.#type.BYTES_PER_ELEMENT); }

  facetLengthAtIndex(idx) { return this.#facetLengths[idx]; }

  facetOffsetAtIndex(idx) { return this.#cumulativeFacetLengths[idx]; }

  facetOffsetAtId(id) { return this.facetOffsetAtIndex(this.facetIdMap.get(id)); }

  // ----- NOTE: Facet tracking ----- //

  /** @type {Map<string, number>} */
  facetIdMap = new IndexMap();

  /** @type {Map<string, number>} */
  facetChangeTracker = new Map();

  setFacetId(id, idx) {
    if ( idx < 0 || idx > (this.numFacets - 1) ) console.warn(`idx ${idx} is out of bounds.`);
    this.facetIdMap.set(id, idx);
  }

  /**
   * Add a facet to any spot in the array that has sufficient space.
   * @param {*} id                  Any value that can be a key in a map
   * @param {number} facetLength    Length of the facet / component
   * @param {number[]|TypedArray}   The values to set for this facet
   * @returns {boolean} True if the buffer had to be expanded to add the new facet
   */
  addFacet({ id, facetLength, newValues } = {}) {
    if ( id != null && this.facetIdMap.has(id) ) return this.updateFacet(id, { facetLength, newValues });
    id ??= this.facetIdMap.nextIndex;

    facetLength ??= newValues.length;
    if ( !facetLength || facetLength < 0 ) throw new TypeError(`updateFacet|Valid facetLength or newValues must be provided.`, { facetLength, newValues });

    let idx;
    for ( idx of this.facetIdMap.iterateEmptyIndices() ) {
      const existingLength = this.facetLengthAtIndex[idx];
      if ( facetLength === existingLength || !existingLength ) break;
    }

    this.facetIdMap.set(id, idx);
    return this._addFacetAtIndex(idx, newValues, facetLength);
  }

  /**
   * Update the facet at the given id.
   * Moves it elsewhere if necessary to keep the array.
   * @param {*} id                  Any value that can be a key in a map
   * @param {number} facetLength    Length of the facet / component
   * @param {number[]|TypedArray}   The values to set for this facet
   * @returns {boolean} True if the buffer had to be expanded (because facet length changed).
   */
  updateFacet(id, { facetLength, newValues } = {}) {
    if ( !this.facetIdMap.has(id) ) return this.addFacet({ id, facetLength, newValues });
    facetLength ??= newValues.length;
    if ( !facetLength || facetLength < 0 ) throw new TypeError(`updateFacet|Valid facetLength or newValues must be provided.`, { facetLength, newValues });

    const idx = this.facetIdMap.get(id);
    if ( this.facetLengthAtIndex(idx) !== facetLength ) {
      this.deleteFacet(id);
      return this.addFacet({ id, facetLength, newValues });
    }
    this._updateFacetAtIndex(idx, newValues);
    return false;
  }

  /**
   * Delete the facet at the given id.
   * Does not otherwise modify the buffer length.
   * @param {*} id                  Any value that can be a key in a map
   * @returns {boolean} True if id existed and was deleted.
   */
  deleteFacet(id) {
    if ( !this.facetIdMap.has(id) ) return false;
    const idx = this.facetIdMap.get(id);
    this.facetIdMap.delete(id);
    return this._deleteFacetAtIndex(idx);
  }

  // ----- NOTE: Facet creation/update/deletion ----- //

  /**
   * Add a facet at the provided index in the array.
   * @param {number} idx              The index being added
   * @param {number[]|TypedArray}     The values to set for this facet
   * @param {number} [facetLength]    Length of the facet / component
   * @returns {boolean} True if the buffer expanded.
   */
  _addFacetAtIndex(idx, newValues, facetLength) {
    facetLength ??= newValues.length;
    this.#facetLengths[idx] = facetLength;
    this.calculateOffsets();

    // Check if the array length exceeds capacity, and attempt to defrag.
    if ( this.arrayLength > this.maxLength ) this.makeContiguous();

    // If still over capacity, trigger expansion.
    const expanded = this.arrayLength > this.maxLength;
    if ( expanded ) this.expand();

    // Write new data.
    this._updateFacetAtIndex(idx, newValues);

    return expanded;
  }

  /**
   * Update a facet at the provided index.
   * Assumption: The facet length has not changed. Strictly an in-place update.
   * @param {number} idx              The index being added
   * @param {number[]|TypedArray}     The values to set for this facet
   */
  _updateFacetAtIndex(idx, newValues) {
    this.viewFacetAtIndex(idx).set(newValues);
    this._facetIndexUpdated(idx);
  }

  _facetIdUpdated(id) {
    if ( !this.facetIdMap.has(id) ) return;
    const idx = this.facetIdMap.get(id);
    this._facetIndexUpdated(idx);
  }

  _facetIndexUpdated(idx) {
    const curr = this.facetChangeTracker.get(idx) || 0;
    this.facetChangeTracker.set(idx, curr + 1);
  }

  /**
   * Delete a facet at the provided index.
   * @param {number} idx      The index being deleted.
   * @returns {boolean} True if actually deleted.
   */
  _deleteFacetAtIndex(idx) {
    if ( !this.viewFacetAtIndex.has(idx) ) return false;
    this.viewFacetAtIndex.delete(idx);
    this.facetChangeTracker.delete(idx);
    this.calculateOffsets();
    return true;
  }

  // ----- NOTE: Expansion ----- //

  /**
   * Drop all empty facet slots in the array and make the array contiguous.
   * @returns {boolean} True if the buffer would have to be modified, false otherwise.
   */
  makeContiguous() {
    let writeIdx = 0;
    let bufferModified = false;
    const maxIdx = this.facetIdMap.maxIndex;

    for ( let readIdx = 0; readIdx <= maxIdx; readIdx += 1 ) {
      if ( this.facetIdMap.hasIndex(readIdx) ) {
        bufferModified = true; // Found a gap, so a shift will be required.
        continue;
      }

      if ( writeIdx !== readIdx ) {
        const id = this.facetIdMap.getKeyAtIndex(readIdx);
        const hangingLength = this.facetLengthAtIndex(readIdx);
        const hangingOffset = this.facetOffsetAtIndex(readIdx);

        // Because writeIdx < readIdx, cumulative offsets up to writeIdx are already correct.
        const targetOffset = this.facetOffsetAtIndex(writeIdx);

        // Shift memory.
        this._shift(hangingOffset, hangingLength, targetOffset);

        // Update tracking maps.
        this.facetIdMap.delete(id); // Deletes from readIdx.
        this.facetIdMap.set(id, writeIdx); // Maps to writeIdx.

        // Update lengths.
        this.#facetLengths[writeIdx] = hangingLength;
        this.#facetLengths[readIdx] = 0;
      }
      writeIdx += 1;
    }

    if ( bufferModified ) {
      this.#facetLengths.length = writeIdx; // Truncate the array of lengths.
      this.calculateOffsets(); // Recalculate all cumulative offsets cleanly.
    }
    return bufferModified;
  }

  // Meant to be used like this:
  // blockToShift = new type(buffer, byteOffset, length);
  // viewBuffer.set(blockToShift, targetOffset)
  _shift(_byteOffset, _length, _targetOffset) { return; }

  expand(minLength) {
    this.#maxLength ||= 1; // So we are not multiplying by 0.
    minLength ||= this.arrayLength;
    while ( this.#maxLength < minLength ) this.#maxLength *= this.constructor.RESIZE_MULTIPLIER;
  }

  // ----- NOTE: Views ----- //

  viewBuffer(buffer) { return new this.type(buffer, 0, this.arrayLength); }

  viewWholeBuffer(buffer) { return new this.type(buffer, 0, this.maxLength); }

  viewFacetById(id, buffer) {
    if ( !this.facetIdMap.has(id) ) return null;
    return this.viewFacetAtIndex(this.facetIdMap.get(id), buffer);
  }

  viewFacetAtIndex(idx, buffer) {
    if ( idx < 0 || idx > (this.numFacets - 1) ) return null;
    return new this.type(
      buffer,
      this.facetOffsetAtIndex(idx) * this.type.BYTES_PER_ELEMENT, // Byte offset to get to this element.
      this.facetLengthAtIndex(idx) // Length of this element.
    );
  }

  copyToBufferById(id, buffer, newValues) {
    const arr = this.viewFacetById(id, buffer);
    arr.set(newValues);
  }
}

/** Tracking buffer

Helper class that creates a typed array buffer:
- Tracks X elements each of N length.
- Access each object in the buffer.
- Delete object and (optionally) shrink the buffer.
- Add objects and expand the buffer.
- Get view of any given object or the entire buffer.
*/
export class VariableLengthTrackingBuffer extends VariableLengthAbstractBuffer {

  /** @type {ArrayBuffer} */
  buffer;

  /**
   * @param {number} [numFacets=0]    Number of components / facets to represent
   * @param {object} [opts]
   * @param {class} [opts.type=Float32Array]        Class of the typed array
   * @param {number|number[]} [opts.facetLengths]   Array identifying the length of each facet or a number if each facet has the same length
   * @param {number} [opts.maxByteLength]           If set, the buffer will be at least this large; useful if numFacets is 0
   */
  constructor(opts) {
    super(opts);

    // Construct a new array bufffer.
    this.buffer = new ArrayBuffer(this.maxByteLength);
  }

  get type() { return super.type; }

  // ----- NOTE: Views ----- //

  /** @type {TypedArray} */
  viewBuffer(buffer) { return super.viewBuffer(buffer || this.buffer); }

  viewWholeBuffer(buffer) { return super.viewWholeBuffer(buffer || this.buffer); }

  viewFacetAtIndex(idx, buffer) { return super.viewFacetAtIndex(idx, buffer || this.buffer); }

  viewFacetById(id, buffer) { return super.viewFacetById(id, buffer || this.buffer); }

  // ----- NOTE: Facet handling ----- //

  _shift(byteOffset, length, targetOffset) {
    const blockToShift = new this.type(this.buffer, byteOffset, length);
    this.viewBuffer().set(blockToShift, targetOffset);
  }

  /**
   * Double the size of the array buffer.
   */
  expand(minLength) {
    super.expand(minLength);
    this.buffer = this.buffer.transferToFixedLength(this.maxByteLength);
  }
}

export class FixedLengthTrackingBuffer extends VariableLengthTrackingBuffer {

  /**
   * @param {object} [opts]
   * @param {number} [numFacets=0]                  Number of components / facets to represent
   * @param {number|number[]} [opts.facetLengths]   Array identifying the length of each facet or a number if each facet has the same length
   * @param {number} [opts.initialMaxFacets]               If set, the buffer will be at least this large; useful if numFacets is 0
   */
  constructor({ facetLengths, numFacets = 0, initialMaxFacets = 1, ...opts } = {}) {
    const facetLength = (Number.isNumeric(facetLengths) ? facetLengths : facetLengths[0]) || 1;
    const origNumFacets = numFacets || (Array.isArray(facetLengths) ? facetLengths.length : 0);

    // Build parent as an empty container, letting this child control layout.
    super({
      numFacets: 0,
      facetLengths: [],
      initialMaxFacets: Math.max(origNumFacets, initialMaxFacets),
      ...opts
    });

    this.#facetLength = facetLength;

    // Allocate initial IDs up to the requested facet count.
    const ids = opts.ids ?? Array.fromRange(origNumFacets);
    for ( let i = 0; i < origNumFacets; i += 1 ) this.facetIdMap.set(ids[i], i);
  }

  // Unneeded b/c each offset is the same.
  calculateOffsets() { return; }

  // ----- NOTE: Properties fixed at construction ----- //

  /** @type {number} */
  #facetLength = 16;

  get facetLength() { return this.#facetLength; }

  get facetLengths() { return (new Array(this.numFacets).fill(this.facetLength)); }

  get numFacets() { return this.facetIdMap.size === 0 ? 0 : this.facetIdMap.maxIndex + 1; }

  // ----- NOTE: Calculated properties ----- //

  get arrayLength() { return this.numFacets * this.facetLength; }

  get cumulativeFacetLengths() { return this.facetLength * this.numFacets; }

  facetLengthAtIndex(_idx) { return this.facetLength; }

  facetOffsetAtIndex(idx) { return this.facetLength * idx; }

  // ----- NOTE: Facet tracking ----- //

  /**
   * Update a facet at the provided index.
   * Assumption: The facet length has not changed. Strictly an in-place update.
   * @param {number} idx              The index being added
   * @param {number[]|TypedArray}     The values to set for this facet
   */
  _updateFacetAtIndex(idx, newValues) {
    // Force all newValues to be the same length.
    if ( newValues && newValues.length !== this.facetLength ) throw new TypeError(`New values length must equal ${this.facetLength}`, newValues);
    super._updateFacetAtIndex(idx, newValues);
  }
}

/**
 * Track vertices and indices together.
 * Calculate offset for indices.
 * Assumes indices do not reference vertices across facets.
 * (More compressed version could use a single large set of vertices, but then it would require more frequent rebuilds.)
 * Example:
 *   stride = 3 (3 coordinates make up one vertex referenced by a single index)
 *   facetLengths = [9, 12]
 *   facetOffsets = [0, 9]
 *   vertices = [10, 11, 12,  20, 21, 22,  30, 31, 32, | 40, 41, 42,  50, 51, 52,  60, 61, 62,  70, 71, 72]
 *   indices = [0, 1, 2, |  3, 2, 1, 0 ] <-- Add 3 to the second set of vertices, 6 to the third.
 *     --> indices become [0, 1, 2 | 6, 5, 4, 3]
 */
export class VerticesIndicesAbstractTrackingBuffer {
  static vBufferClass = VariableLengthAbstractBuffer;

  static iBufferClass = VariableLengthAbstractBuffer;

  vertices;

  indices;

  get numFacets() { return this.vertices.numFacets; }

  stride = 3;

  indicesOffsetAtId(id) { return Math.floor(this.vertices.facetOffsetAtId(id) / this.stride); }

  indicesOffsetAtIdx(idx) { return Math.floor(this.vertices.facetOffsetAtIdx(idx) / this.stride); }

  constructor({ verticesType = Float32Array, indicesType = Uint16Array, verticesFacetLengths, indicesFacetLengths, stride = 3, ...opts } = {}) {
    this.vertices = new this.constructor.vBufferClass({ type: verticesType, facetLengths: verticesFacetLengths, ...opts });
    this.indices = new this.constructor.iBufferClass({ type: indicesType, facetLengths: indicesFacetLengths, ...opts });
    this.stride = stride;
  }

  addFacet({ id, verticesLength, newVertices, indicesLength, newIndices } = {}) {
    if ( !(indicesLength || newIndices) ) {
      verticesLength ??= newVertices.length;
      newIndices = Array.fromRange(verticesLength / this.stride);
    }
    this.vertices.addFacet({ id, newValues: newVertices, facetLength: verticesLength });
    return this.indices.addFacet({ id, newValues: newIndices, facetLength: indicesLength });
  }

  updateFacet(id, { verticesLength, newVertices, indicesLength, newIndices }) {
    if ( !(indicesLength || newIndices) ) {
      verticesLength ??= newVertices.length;
      newIndices = Array.fromRange(verticesLength / this.stride);
    }
    this.vertices.updateFacet(id, { newValues: newVertices, facetLength: verticesLength });
    return this.indices.updateFacet(id, { newValues: newIndices, facetLength: indicesLength });
  }

  deleteFacet(id) {
    this.vertices.deleteFacet(id);
    this.indices.deleteFacet(id);
  }

  viewBuffer(verticesBuffer, indicesBuffer) {
    return {
      indices: this.indices.viewBuffer(indicesBuffer),
      vertices: this.vertices.viewBuffer(verticesBuffer)
    }
  }

  viewWholeBuffer(verticesBuffer, indicesBuffer) {
    return {
      indices: this.indices.viewBuffer(indicesBuffer),
      vertices: this.vertices.viewBuffer(verticesBuffer)
    }
  }

  viewFacetById(id, verticesBuffer, indicesBuffer) {
   return {
      indices: this.indices.viewFacetById(id, indicesBuffer),
      vertices: this.vertices.viewFacetById(id, verticesBuffer)
    }
  }

  // Copy the index, adjusting by offset.
  copyToIndicesBuffer(buffer) {
    for ( const id of this.indices.facetIdMap.keys() ) {
      this.copyToIndicesBufferById(id, buffer, this.indices.viewFacetById(id, buffer));
    }
  }

  // Copy the index, adjusting by offset.
  copyToIndicesBufferById(id, buffer, newValues) {
    newValues = newValues.map(elem => elem + this.indicesOffsetAtId(id));
    this.indices.copyToBufferById(id, buffer, newValues);
  }
}

export class VerticesIndicesTrackingBuffer extends VerticesIndicesAbstractTrackingBuffer {
  static vBufferClass = VariableLengthTrackingBuffer;

  static iBufferClass = VariableLengthTrackingBuffer;

  indicesAdjBuffer; // With offset applied.

  constructor(opts = {}) {
    super(opts);
    this.indicesAdjBuffer = new ArrayBuffer(this.indices.maxByteLength);
  }

  addFacet(opts = {}) {
    opts.id ??= this.indices.facetIdMap.nextIndex;
    const expanded = super.addFacet(opts);
    if ( expanded ) this.expand();
    this.copyToIndicesBufferById(opts.id, this.indicesAdjBuffer, this.indices.viewFacetById(opts.id));
    return expanded;
    // No change to other facet indices b/c vertices are added at the end or replace vertex facet of equal length.
  }

  updateFacet(id, opts = {}) {
    const expanded = super.updateFacet(id, opts);
    if ( expanded ) this.expand();
    this.copyToIndicesBufferById(id, this.indicesAdjBuffer, this.indices.viewFacetById(id));
    return expanded;
    // No change to other facet indices b/c vertices are added at the end or replace vertex facet of equal length.
  }

  expand() {
    this.indicesAdjBuffer = this.indicesAdjBuffer.transferToFixedLength(this.indices.maxByteLength);
  }

  viewBuffer(_buffer) {
    return {
      indices: this.indices.viewBuffer(),
      vertices: this.vertices.viewBuffer(),
      indicesAdj: this.indices.viewBuffer(this.indicesAdjBuffer),
    };
  }

  viewWholeBuffer(_buffer) {
    return {
      indices: this.indices.viewWholeBuffer(),
      vertices: this.vertices.viewWholeBuffer(),
      indicesAdj: this.indices.viewWholeBuffer(this.indicesAdjBuffer),
    }
  }

  viewFacetById(id, _buffer) {
    return {
      indices: this.indices.viewFacetById(id),
      vertices: this.vertices.viewFacetById(id),
      indicesAdj: this.indices.viewFacetById(id, this.indicesAdjBuffer),
    }
  }

  viewFacetAtIndex(idx, _buffer) {
    return {
      indices: this.indices.viewFacetAtIndex(idx),
      vertices: this.vertices.viewFacetAtIndex(idx),
      indicesAdj: this.indices.viewFacetAtIndex(idx, this.indicesAdjBuffer),
    }
  }

  /**
   * Drop all empty facet slots in the array and make the array contiguous.
   * @returns {boolean} True if the buffer would have to be modified, false otherwise.
   */
  makeContiguous() {
    // Compact both underlying buffers.
    const verticesModified = this.vertices.makeContiguous();
    const indicesModified = this.indices.makeContiguous();

    // If either buffer shifted, adjusted indices are now completely out of sync.
    if ( verticesModified || indicesModified ) {
      // Rebuild the indices buffer from scratch using freshly compacted data.
      for ( const id of this.indices.facetIdMap.keys() ) {
        const baseIndices = this.indices.viewFacetById(id);
        this.copyToIndicesBufferById(id, this.indicesAdjBuffer, baseIndices);
      }
      return true;
    }
    return false;
  }

  // Not yet implemented: makeContiguous.
  // Requires resetting the indicesAdjBuffer and ensuring indices and vertices stay in sync.

}

export class VerticesIndicesFixedLengthTrackingBuffer extends VerticesIndicesTrackingBuffer {
  static vBufferClass = FixedLengthTrackingBuffer;

  static iBufferClass = FixedLengthTrackingBuffer;

}





/* Testing
MODULE_ID = "tokenvisibility"
api = game.modules.get("tokenvisibility").api
VariableLengthAbstractBuffer = api.placeableTracker.VariableLengthAbstractBuffer
FixedLengthTrackingBuffer = api.placeableTracker.FixedLengthTrackingBuffer
VariableLengthTrackingBuffer = api.placeableTracker.VariableLengthTrackingBuffer
VerticesIndicesAbstractTrackingBuffer = api.placeableTracker.VerticesIndicesAbstractTrackingBuffer
VerticesIndicesTrackingBuffer = api.placeableTracker.VerticesIndicesTrackingBuffer

tb = new VariableLengthTrackingBuffer({ facetLengths: [3,4,5,5,5] })
tb.viewFacetAtIndex(0).set([1,2,3])
tb.viewFacetAtIndex(1).set([1,2,3,4])
tb.viewFacetAtIndex(2).set([1,2,3,4,5])
tb.calculateOffsets()

tb.deleteFacet(1)
tb.addFacet({ newValues: [10,11,12,13]})



tb = new FixedLengthTrackingBuffer({ facetLengths: 4, numFacets: 5 })
tb.viewFacetAtIndex(0).set([0,1,2,3])
tb.viewFacetAtIndex(1).set([4,5,6,7])
tb.viewFacetAtIndex(2).set([8,9,10,11])
tb.viewFacetAtIndex(3).set([12,13,14,15])
tb.viewFacetAtIndex(4).set([16,17,18,19])

tb = new VariableLengthTrackingBuffer()
tb = new VariableLengthAbstractBuffer()
tb.addFacet({ id: "A", facetLength: 5 })
tb.addFacet({ id: "B", facetLength: 10 })
tb.addFacet({ id: "C", facetLength: 5 })
tb.addFacet({ id: "D", facetLength: 7 })
tb.addFacet({ id: "E", facetLength: 9 })

tb.deleteFacet("B")
tb.deleteFacet("D")

tb.makeContiguous()

5 10 5 7 9
5 5 9

ph = new api.placeableTracker.TokenInstanceHandler(

opts = {
      addNormals: false,
      addUVs: false,
      placeable: null,
    };
geoms = []
opts.token = canvas.tokens.placeables[0]
geoms.push(new api.geometry.GeometryConstrainedToken(opts))
opts.token = canvas.tokens.placeables[1]
geoms.push(new api.geometry.GeometryConstrainedToken(opts))

viTracker = new VerticesIndicesTrackingBuffer({ stride: 3})
viTracker.addFacet({ newVertices: [10, 11, 12, 20, 21, 22, 30, 31, 32], newIndices: [0, 1, 2]})
viTracker.addFacet({ newVertices: [40, 41, 42,  50, 51, 52,  60, 61, 62,  70, 71, 72], newIndices: [3, 2, 1, 0]})
*/
