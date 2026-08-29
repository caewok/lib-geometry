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
   * Get multiple objects from the pool.
   * @param {number} n Number of objects to acquire.
   * @returns {object[]}
   */
  acquireMultiple(n) {
    // Ensure the pool has enough elements
    if (this.#pool.length < n) this.increasePool(Math.max(n - this.#pool.length, this.initialSize));

    const result = new Array(n);
    for (let i = 0; i < n; i++) {
      const obj = this.#pool.pop();
      obj._isInPool = false;
      result[i] = obj;
    }
    return result;
  }

  /**
   * Release an object back to the pool.
   * @param {obj} object        Object to return.
   */
  release(obj) {
    // Basic test that the object belongs.
    const cl = this.cl;

    /* For debugging
    if ( !(obj instanceof cl) ) {
      console.warn("Pool object does not match other instance in the pool.", { cl, obj });
      return;
    }
    */

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

export const PoolableMixin = superclass => {
  const out = class extends superclass {

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
     * @returns {object}
     */
    static create() { return this.pool.acquire(); }

    /**
     * Method for creating multiple objects, using the pool.
     * @param {number} n
     * @returns {object[]}
     */
    static createN(n) { return this.pool.acquireMultiple(n); }

    /**
     * Release an instance back to the pool and trigger cleanup.
     * @param {Poolable} objs
     */
    static _release(obj) {
      this.onRelease(obj); // Optional cleanup hook.
      this.pool.release(obj);
    }

    static release(...objs) { objs.forEach(obj => this._release(obj)); }

    // Flag to track pool status.
    // Added here so the object class is not later modified.
    /** @type {boolean} */
    // _isInPool = false;

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

  // Force the _isInPool property to show up last, as getting rid of it entirely is too hard.
  Object.defineProperty(out.prototype, "_isInPool", {
    configurable: false,
    enumerable: false,
    value: false,
    writable: true,
  });
  return out;
}


/**
 * Represent a contiguous block of free memory in an ArrayBuffer.
 * Used in BufferManager.
 */
class FreeSegmentNode {
  /** @type {number} */
  byteOffset = 0;

  /** @type {number} */
  byteSize = 0;

  /** @type {FreeSegmentNode} */
  prev = null;

  /** @type {FreeSegmentNode} */
  next = null;

  constructor(byteOffset, byteSize) {
    this.byteOffset = byteOffset;
    this.byteSize = byteSize;
  }
}

/**
 * A doubly-linked list to manage free memory segments.
 * For Buffer Manager, avoids Array.splice overhead.
 */
class FreeList {
  /** @type {FreeSegmentNode} */
  head = null;

  /**
   * Insert a newly freed segment in sorted order (by offset) and merge if possible.
   * @param {number} byteOffset
   * @param {number} byteSize
   */
  addAndMerge(byteOffset, byteSize) {
    const node = new FreeSegmentNode(byteOffset, byteSize);

    // Base case: set the node to the first slot.
    if ( !this.head ) {
      this.head = node;
      return;
    }

    // Find the correct insertion point to maintain sorted order.
    let curr = this.head;
    while ( curr && curr.byteOffset < node.byteOffset ) curr = curr.next;

    // Insert the node.
    if ( curr ) {
      node.prev = curr.prev;
      node.next = curr;
      if ( curr.prev ) curr.prev.next = node;
      else this.head = node;
      curr.prev = node;
    } else {
      // Reached the end, append to tail.
      let tail = this.head;
      while ( tail.next ) tail = tail.next;
      tail.next = node;
      node.prev = tail;
    }

    this._merge(node);
  }

  /**
   * Check adjacent nodes and combine them if their memory is contiguous.
   * @param {FreeSegmentNode}
   */
  _merge(node) {
    // Merge with next node.
    if ( node.next && (node.byteOffset + node.byteSize) === node.next.byteOffset ) {
      node.byteSize += node.next.byteSize;
      this._remove(node.next);
    }

    // Merge with previous node.
    if ( node.prev && (node.prev.byteOffset + node.prev.byteSize) === node.byteOffset ) {
      node.prev.byteSize += node.byteSize;
      this._remove(node);
    }
  }

  /**
   * Find the first segment large enough, adjust or remove it, and return the offset.
   * @param {number} byteSize       Amount of space to allocate
   * @returns {number|null}
   */
  findAndAllocate(byteSize) {
    let curr = this.head;
    while ( curr ) {
      if ( curr.byteSize >= byteSize ) {
        const allocatedOffset = curr.byteOffset;
        if ( curr.byteSize === byteSize ) this._remove(curr); // Perfect fit; O(1) removal instead of Array.splice.
        else {
          // Partial fit; shrink the free segment.
          curr.byteOffset += byteSize;
          curr.byteSize -= byteSize;
        }
        return allocatedOffset;
      }
      curr = curr.next;
    }
    return null;
  }

  /**
   * Internal method to remove a node from the linked list.
   * @param {FreeSegmentNode}
   */
  _remove(node) {
    if ( node.prev ) node.prev.next = node.next;
    else this.head = node.next;
    if ( node.next ) node.next.prev = node.prev;
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

    // Initialize with a linked list instead of array.
    const freeList = new FreeList();
    freeList.addAndMerge(0, byteSize);

    // Track each buffer.
    this.freeSegmentsMap.set(buffer, freeList);
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
    for ( const [buffer, freeList] of this.freeSegmentsMap ) {
      const byteOffset = freeList.findAndAllocate(byteSize);
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
    const freeList = this.freeSegmentsMap.get(buffer);
    freeList.findAndAllocate(byteSize); // Must still process the segment.
    return { buffer, byteOffset: 0 }; // By definition, because we just added it, offset is 0.
  }

  /**
   * Release a block of space and merges it with adjacent free blocks.
   * @param {TypedArray} arr        The array being freed.
   */
  release(arr) {
    // NOTE: Disable once debugging is finished.
    // While good practice to limit caching errors, this fill is non-performant.
    arr.fill(0); // Good practice to limit caching errors.

    const freeList = this.freeSegmentsMap.get(arr.buffer);
    if ( !freeList ) return;
    freeList.addAndMerge(arr.byteOffset, arr.byteLength);
  }

}
