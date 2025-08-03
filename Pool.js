/* globals

*/
"use strict";

/* Pool
Used to store temporary objects, such as points. Allows for returning objects to the pool.
*/
export class Pool {

  initialSize = 10;

  pool = new Set();

  objConstructor;

  /**
   * @param {function} objConstructor     Function that can construct a blank object.
   *   Given this pool when constructed. Should return a blank, initialized object.
   */
  constructor(objConstructor) {
    this.objConstructor = objConstructor;
    this.increasePool();
  }

  increasePool(n = this.initialSize) {
    for ( let i = 0; i < n; i += 1 ) this.pool.add(this.objConstructor(this));
  }

  /**
   * Get an object from the pool.
   */
  acquire() {
    // If empty, add objects to the pool.
    if ( !this.pool.size ) this.increasePool();

    // Retrieve an object from the pool and remove it from the pool.
    const obj = this.pool.first();
    this.pool.delete(obj);
    return obj;
  }

  /**
   * Release an object back to the pool.
   * @param {obj} object        Object to return.
   */
  release(obj) {
    // Basic test that the object belongs.
    if ( !this.pool.size ) this.increasePool();

    const testObj = this.pool.first();
    const isValid = testObj.constructor.classTypes
      ? testObj.objectMatchesClassType(obj)
      : obj instanceof testObj.constructor;
    if ( !isValid) {
      console.warn("Pool object does not match other instance in the pool.", { testObj, obj });
      return;
    }
    this.pool.add(obj);
  }
}