/* globals

*/
"use strict";

/* Pool
Used to store temporary objects, such as points. Allows for returning objects to the pool.
*/
export class Pool {

  /** @type {number} */
  initialSize = 10;

  /** @type {Set<object>} */
  #pool = new Set();

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
    const isValid = cl.classTypes ? obj.matchesClass(cl) : obj instanceof cl;
    if ( !isValid) {
      console.warn("Pool object does not match other instance in the pool.", { cl, obj });
      return;
    }
    this.#pool.add(obj);
  }
}