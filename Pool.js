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
  #cl;

  // Map Proxies back to their raw objects for manual release.
  #handleToRaw = new WeakMap();

  #registry = new FinalizationRegistry(rawObject => this.#doRelease(rawObject));

  /**
   * @param {class} cl     Class that has a buildNObjects static method that takes a number
   *                       and returns an array with that many new objects
   */
  constructor(cl) {
    this.#cl = cl;
  }

  increasePool(n = this.initialSize) {
    const objs = this.#cl.buildNObjects(n);
    for ( let i = 0; i < n; i += 1 ) this.#pool.add(objs[i]);
  }

  /**
   * Get an object from the pool.
   */
  acquire() {
    // If empty, add objects to the pool.
    if ( !this.#pool.size ) this.increasePool();

    // Get raw object from pool.
    const rawObject = this.#pool.first();
    this.#pool.delete(rawObject);

    // Create the proxy handle.
    const handle = new Proxy(rawObject, {});

    // Track the handle.
    this.#handleToRaw.set(handle, rawObject);

    // Register for autorelease.
    // Use the raw object as the unregisterToken so it can be canceled later.
    this.#registry.register(handle, rawObject, rawObject);

    return handle;
  }

  /**
   * Release an object back to the pool.
   * @param {obj} object        Object to return.
   */
  release(handle) {
    const rawObject = this.#handleToRaw.get(handle);
    if ( rawObject ) {
      // Stop the registry from auto-releasing this later.
      this.#registry.unregister(rawObject);

      // Clean up tracking.
      this.#handleToRaw.delete(handle);

      // Return to the pool.
      this.#doRelease(rawObject);
    }
  }

  #doRelease(rawObject) {
    // Basic test that the object belongs.
    const cl = this.#cl;
    if ( !(rawObject instanceof cl) || rawObject.constructor.name !== cl.name ) {
      console.warn("Pool object does not match other instance in the pool.", { cl, rawObject });
      return;
    }
    this.#pool.add(rawObject); // Important that the object here is only added once.
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

