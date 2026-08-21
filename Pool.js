/* globals

*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

/* Pool
Used to store temporary objects, such as points. Allows for returning objects to the pool.
*/
export class Pool {

  /** @type {number} */
  initialSize = 2048;

  /** @type {object[]} */
  #pool = []; // Faster to use an array with a flag then to use WeakSet to track objects.

  /** @type {class} */
  cl;

  /**
   * @param {class} cl     Class that has a buildNObjects static method that takes a number
   *                       and returns an array with that many new objects
   */
  constructor(cl) {
    this.cl = cl;
  }

  increasePool(n = this.initialSize) {
    const objs = this.cl.buildNObjects(n);
    n = objs.length; // In case this changed in buildNObjects.
    const j = this.#pool.length;
    this.#pool.length += n;
    for ( let i = 0; i < n; i += 1 ) {
      const obj = objs[i];
      this.#pool[i + j] = obj;
      obj._isInPool = true;
    }
  }

  /**
   * Get an object from the pool.
   */
  acquire() {
    // If empty, add objects to the pool.
    if ( !this.#pool.length ) this.increasePool();

    // Pop an object from the pool.
    const obj = this.#pool.pop();
    obj._isInPool = false;
    return obj;
  }

  /**
   * Release an object back to the pool.
   * @param {obj} object        Object to return.
   */
  release(obj) {
    // Basic test that the object belongs.
    const cl = this.cl;
    if ( !(obj instanceof cl) ) {
      console.warn("Pool object does not match other instance in the pool.", { cl, obj });
      return;
    }

    // Important that the object here is only added once.
    if ( obj._isInPool ) return;
    this.#pool.push(obj);
    obj._isInPool = true;
  }

  // Use a WeakMap to store pools keyed by the Class itself.
  // This ensures no memory leaks and separate pools for every class implementing Pool.
  static #poolRegistry = new WeakMap();

  /**
   * Get the pool for a given class.
   * @param {class} cl
   * @returns {Pool}
   */
   static getPool(cl) {
     if ( !this.#poolRegistry.has(cl) ) this.#poolRegistry.set(cl, new this(cl));
     return this.#poolRegistry.get(cl);
   }
}

// Polyfill for environments that don't have it yet
Symbol.dispose ??= Symbol("Symbol.dispose");

export const PoolableMixin = superclass => class extends superclass {

  /**
   * Retrieve the pool for this class.
   * @type {Pool}
   */
  static get pool() { return Pool.getPool(this); }

  /**
   * Get a pooled instance of this class.
   * @type {Poolable}
   */
  static get tmp() { return this.pool.acquire(); }

  /**
   * Eventual replacement for tmp getter.
   */
  static create() { return this.pool.acquire(); }

  /**
   * Release an instance back to the pool and trigger cleanup.
   * @param {Poolable} objs
   */
  static _release(obj) {
    this.onRelease(obj); // Optional cleanup hook.
    this.pool.release(obj);
  }

  static release(...objs) { objs.forEach(obj => this._release(obj)); }

  /**
   * Trigger automatic return to the pool if the point is defined with a "using" declaration.
   * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/using
   * When the 'using' block ends, this is called automatically.
   */
  [Symbol.dispose]() { this.constructor._release(this); }

  release() { this.constructor._release(this); }

  static onRelease(_obj) { }

  /**
   * Required builder to create multiple objects.
   * @param {number} n
   * @returns {Poolable[n]}
   */
  static buildNObjects(n) {
    const arr = new Array(n);
    for ( let i = 0; i < n; i += 1 ) arr[i] = new this();
    return arr;
  }
}

/**
 * Manage a typed array buffer size.
 * Allocate space on a first-fit strategy. (Free List alogrithm.)
 * Tracks contiguous blocks of empty space and allocates accordingly.
 */
export class BufferManager {
  /** @type {Mat<ArrayBuffer, Array<{byteOffset, byteSize}>} */
  freeSegmentsMap = new Map();

  /** @type {TypedArray} */
  typedClass;

  /** @type {number} */
  get bytesPerElement() { return this.typedClass.BYTES_PER_ELEMENT; }

  /** @type {number} */
  maxBufferSize = 0;

  /** @type {ArrayBuffer} */
  currentBuffer;

  constructor(totalSize = 0, { typedClass = Float32Array, maxBufferSize = totalSize } = {}) {
    this.typedClass = typedClass;
    this.maxBufferSize = maxBufferSize;
    this._addNewBuffer(totalSize);
  }

  /**
   * Add a new buffer of a given size.
   * @param {number} size
   * @returns {ArrayBuffer}
   */
  _addNewBuffer(size, maxBufferSize) {
    const byteSize = size * this.bytesPerElement;
    maxBufferSize ??= this.maxBufferSize;
    maxBufferSize = Math.max(size, maxBufferSize);
    const buffer = new ArrayBuffer(byteSize, { maxByteLength: maxBufferSize * this.bytesPerElement });
    this.freeSegmentsMap.set(buffer, [{ byteOffset: 0, byteSize }]);
    this.currentBuffer = buffer;
    return buffer;
  }

  /**
   * Return a new array of the requested size.
   * @param {number} size     Number of elements
   * @returns {TypedArray<size>}
   */
  newArray(size) {
    const { buffer, byteOffset } = this.allocate(size);
    return new this.typedClass(buffer, byteOffset, size);
  }

  /**
   * Reserve a block of space.
   * If out of space, constructs a new buffer.
   * @param {number} size       Number of elements to reserve
   * @returns {object}
   * - @prop {ArrayBuffer} buffer   The buffer to use
   * - @prop {number} bytOffset     The byte offset.
   */
  allocate(size) {
    const byteSize = size * this.bytesPerElement;

    // Search all buffers for a free segment.
    for ( const [buffer, segments] of this.freeSegmentsMap ) {
      const byteOffset = this._findSegmentWithFreeSpace(segments, byteSize);
      if ( byteOffset !== null ) return { buffer, byteOffset };
    }

    // Insufficient memory left in the buffer.
    // Try to grow the most recently added buffer.
    const lastBuffer = this.currentBuffer;
    const totalBytesNeeded = lastBuffer.byteLength + byteSize;
    if ( lastBuffer.maxByteLength >= totalBytesNeeded ) {
      // Grow the buffer and use the resized portion for this allocation.
      const byteOffset = lastBuffer.byteLength;
      lastBuffer.resize(totalBytesNeeded);
      return { buffer: lastBuffer, byteOffset };
    }

    // Last resort: Add a new buffer.
    const buffer = this._addNewBuffer(Math.max(size,  2 ** 10));
    const segments = this.freeSegmentsMap.get(buffer);
    this._findSegmentWithFreeSpace(segments, byteSize); // Must still process the segment.
    return { buffer, byteOffset: 0 }; // By definition, because we just added it, offset is 0.
  }

  /**
   * Identify a segment with sufficient space.
   * @param {Array<{byteOffset, byteSize}>} segments      Memory segments to check
   * @param {number} byteSize                             Target size
   * @returns {object<byteOffset, byteSize>|null} The first segment with sufficient space
   */
  _findSegmentWithFreeSpace(segments, byteSize) {
    for ( let i = 0, n = segments.length; i < n; i += 1 ) {
      const segment = segments[i];
      if ( segment.byteSize >= byteSize ) {
        const byteOffset = segment.byteOffset;
        if ( segment.byteSize === byteSize ) segments.splice(i, 1); // Perfect fit: remove the segment entirely.
        else {
          // Partial fit: shrink the existing free segment.
          segment.byteOffset += byteSize;
          segment.byteSize -= byteSize;
        }
        return byteOffset;
      }
    }
    return null;
  }

  /**
   * Release a block of space and merges it with adjacent free blocks.
   * @param {TypedArray} arr        The array being freed.
   */
  release(arr) {
    arr.fill(0); // Good practice to limit caching errors.
    if ( !this.freeSegmentsMap.has(arr.buffer) ) return;

    const segments = this.freeSegmentsMap.get(arr.buffer);
    const newSegment = { byteSize: arr.byteLength, byteOffset: arr.byteOffset };

    // Insert and maintain sorted order by offset to allow merging.
    const idx = segments.findIndex(s => s.byteOffset > newSegment.byteOffset);
    if ( ~idx ) segments.splice(idx, 0, newSegment);
    else segments.push(newSegment);

    // Combine segments that have empty space at their respective borders.
    this._mergeNeighbors(segments);
  }

  /**
   * Combines adjacent free blocks to limit fragmentation.
   */
  _mergeNeighbors(segments) {
    for ( let i = 0, iMax = segments.length - 1; i < iMax; i += 1 ) {
      const current = segments[i];
      const next = segments[i+1];

      // If current block ends exactly where the next starts, merge.
      if ( current.byteOffset + current.byteSize === next.byteOffset ) {
        current.byteSize += next.byteSize;
        segments.splice(i + 1, 1);
        iMax--;
        i--; // Check again with the newly merged block.
      }
    }
  }
}
