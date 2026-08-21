/* globals

*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

/* Pool
Used to store temporary objects, such as points. Allows for returning objects to the pool.
*/
export class Pool {

  /** @type {number} */
  initialSize = 10;

  /** @type {Set<object>} */
  #pool = new Set(); // Probably don't want a weak set b/c we want to reuse the object. Smaller memory if WeakSet used.

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
    for ( let i = 0; i < n; i += 1 ) this.#pool.add(objs[i]);
  }

  /**
   * Get an object from the pool.
   */
  acquire() {
    // If empty, add objects to the pool.
    if ( !this.#pool.size ) this.increasePool();

    // Pop an object from the pool.
    const obj = this.#pool.first();
    this.#pool.delete(obj);
    return obj;
  }

  /**
   * Release an object back to the pool.
   * @param {obj} object        Object to return.
   */
  release(obj) {
    // Basic test that the object belongs.
    const cl = this.cl;
    if ( !(obj instanceof cl) || obj.constructor.name !== cl.name ) {
      console.warn("Pool object does not match other instance in the pool.", { cl, obj });
      return;
    }
    this.#pool.add(obj); // Important that the object here is only added once.
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
     if ( !this.#poolRegistry.has(cl) ) {
       this.#poolRegistry.set(cl, new this(cl));
     }
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
    return Array.from({ length: n}, () => new this());
  }
}

/**
 * Manage a typed array buffer size.
 * Allocate space on a first-fit strategy. (Free List alogrithm.)
 * Tracks contiguous blocks of empty space and allocates accordingly.
 */
export class BufferManager {
  /** @type {ArrayBuffer} */
  buffer;

  /** @type {object[]} */
  freeSegments = [];

  /** @type {TypedArray} */
  typedClass;

  /** @type {number} */
  get bytesPerElement() { return this.typedClass.BYTES_PER_ELEMENT; }

  constructor(totalSize = 0, { typedClass = Float32Array, maxSize = totalSize } = {}) {
    this.typedClass = typedClass;
    const byteSize = totalSize * this.bytesPerElement;
    this.buffer = new ArrayBuffer(byteSize, { maxByteLength: maxSize * this.bytesPerElement });
    this.freeSegments.push({ byteOffset: 0, byteSize });
  }

  /**
   * Return a new array of the requested size.
   * @param {number} size     Number of elements
   * @returns {TypedArray<size>}
   */
  newArray(size) {
    const byteOffset = this.allocate(size);
    return new this.typedClass(this.buffer, byteOffset, size);
  }

  /**
   * Reserve a block of space.
   * If out of space, constructs a new buffer.
   * @param {number} size       Number of elements to reserve
   * @returns {number} The byte offset.
   */
  allocate(size) {
    const byteSize = size * this.bytesPerElement;
    for ( let i = 0, iMax = this.freeSegments.length; i < iMax; i += 1 ) {
      const segment = this.freeSegments[i];
      if ( segment.byteSize >= byteSize ) {
        const byteOffset = segment.byteOffset;
        if ( segment.byteSize === byteSize ) this.freeSegments.splice(i, 1); // Perfect fit: remove the segment entirely.
        else {
          // Partial fit: shrink the existing fre segment.
          segment.byteOffset += byteSize;
          segment.byteSize -= byteSize;
        }
        return byteOffset;
      }
    }

    // Insufficient memory left in the buffer.
    // Expand buffer if possible.
    const totalBytesNeeded = this.buffer.byteLength + byteSize;
    if ( this.buffer.maxByteLength > totalBytesNeeded ) {
      // Grow the buffer and use the resized portion for this allocation.
      const byteOffset = this.buffer.byteLength;
      this.buffer.resize(totalBytesNeeded);
      return byteOffset;
    } else {
      // Trash the buffer and start anew.
      this.freeSegments.length = 1;
      this.freeSegments[0] = { byteOffset: 0, byteSize: this.buffer.byteLength };
      this.buffer = new ArrayBuffer(Math.max(this.buffer.byteLength, byteSize), { maxByteLength: Math.max(this.buffer.maxByteLength, byteSize) });
      return this.allocate(size);
    }
  }

  /**
   * Release a block of space and merges it with adjacent free blocks.
   * @param {TypedArray} arr        The array being freed.
   */
  release(arr) {
    arr.fill(0); // Good practice to limit caching errors.
    if ( arr.buffer !== this.buffer ) return;
    const byteSize = arr.byteLength;
    const byteOffset = arr.byteOffset;
    const newSegment = { byteSize, byteOffset };

    // Insert and maintain sorted order by offset to allow merging.
    const idx = this.freeSegments.findIndex(s => s.byteOffset > byteOffset);
    if ( ~idx ) this.freeSegments.splice(idx, 0, newSegment);
    else this.freeSegments.push(newSegment);
    this._mergeNeighbors();
  }

  /**
   * Combines adjacent free blocks to limit fragmentation.
   */
  _mergeNeighbors() {
    for ( let i = 0, iMax = this.freeSegments.length - 1; i < iMax; i += 1 ) {
      const current = this.freeSegments[i];
      const next = this.freeSegments[i+1];

      // If current block ends exactly where the next starts, merge.
      if ( current.byteOffset + current.byteSize === next.byteOffset ) {
        current.byteSize += next.byteSize;
        this.freeSegments.splice(i + 1, 1);
        iMax--;
        i--; // Check again with the newly merged block.
      }
    }
  }
}
