/* globals
foundry,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


/* Track geometry changes to placeable.

Each tracker simply increments a counter for the placeable.

1. Track whether position changed.
2. Track whether scale changed.
3. Track whether geometry characteristics otherwise changed.

NOTE: To register, call in CONFIG.GeometryLib once the placeables are loaded.
This prevents multiple versions from running at once.
Example:
CONFIG.GeometryLib.placeableTrackers.TokenPositionTracker.registerPlaceableHooks()
CONFIG.GeometryLib.placeableTrackers.TokenPositionTracker.registerExistingPlaceables()
*/

export class PlaceableUpdateWatcher {

  /** @type {string} */
  documentName = "";

  /**
   * @typedef Callback
   * @prop {Set<string>} keys     Property strings to watch
   * @prop {function} callback    Function to call
   *  - @param {PlaceableObject} placeable        Placeable being changed
   *  - @param {object} change                    Raw change object
   *  - @param {userId} userId                    Id of user who performed update
   */

  /** @type {Callback[]} */
  callbacks = [];

  /* @type {number} */
  _hookId = null;

  /**
   * @param {string} documentName   Name of document to watch.
   */
  constructor(documentName) {
    this.documentName = documentName;
  }

  /** @type {Map<PlaceableUpdateWatcher>} */
  static watchers = new Map();

  /**
   * Creation function that enforces singular function.
   * @param {string} documentName   Name of document to watch.
   * @returns {PlaceableUpdateWatcher}
   */
  static create(documentName) {
    if ( this.watchers.has(documentName) ) return this.watchers.get(documentName);
    const watcher = new this(documentName);
    this.watchers.set(documentName, watcher);
    return watcher;
  }

  static activateAll() {
    for ( const watcher of this.watchers.values() ) watcher.activate();
  }

  static deactivateAll() {
    for ( const watcher of this.watchers.values() ) watcher.deactivate();
  }

  /**
   * Register a callback to fire when specific keys are updated.
   * @param {string[]} keys       Array of flattened property strings to watch
   * @param {function} callback   Function to call
   *  - @param {PlaceableObject} placeable        Placeable being changed
   *  - @param {object} change                    Raw change object
   *  - @param {userId} userId                    Id of user who performed update
   */
  register(keys, callback) {
    this.callbacks.push({
      keys: new Set(keys),
      callback,
    });
  }

  /**
   * Start listening to the update hook.
   */
  activate() {
    if (this._hookId) return; // Avoid duplicate hooks.
    this._hookId = Hooks.on(`update${this.documentName}`, this._handleUpdate.bind(this));
  }

  /**
   * Stop listening to the update hook.
   */
  deactivate() {
    if (this._hookId) {
      Hooks.off(`update${this.documentName}`, this._hookId);
      this._hookId = null;
    }
  }

  /**
   * Internal hook handler.
   * @param {Document} document     The Foundry document being updated.
   * @param {Object} change         The differential data containing the updates.
   * @param {Object} options        Update options.
   * @param {string} userId         The ID of the user who performed the update.
   */
  _handleUpdate(placeableD, change, options, userId) {
    const placeable = placeableD.object;
    if ( !placeable ) return;

    // Flatten the change object to handle nested keys, like flags.
    const changeKeys = Object.keys(foundry.utils.flattenObject(change));

    // Walk through each callback in turn, triggering it if it matches one or more change keys.
    for ( const { keys, callback } of this.callbacks ) {
      if ( changeKeys.some(key => keys.has(key)) ) callback(placeable, change, userId);
    }
  }
}


export class PlaceableRefreshWatcher extends PlaceableUpdateWatcher {
  /**
   * Start listening to the update hook.
   */
  activate() {
    if (this._hookId) return; // Avoid duplicate hooks.
    this._hookId = Hooks.on(`refresh${this.documentName}`, this._handleUpdate);
  }

  /**
   * Stop listening to the update hook.
   */
  deactivate() {
    if (this._hookId) {
      Hooks.off(`refresh${this.documentName}`, this._hookId);
      this._hookId = null;
    }
  }

  /**
   * Internal hook handler.
   * @param {PlaceableObject} object    The object instance being refreshed
   * @param {RenderFlags} flags
   */
  _handleUpdate(placeable, flags) {
    // Walk through each callback in turn, triggering it if it matches one or more change keys.
    const changeKeys = Object.keys(flags);
    for ( const { keys, callback } of this.callbacks ) {
      if ( changeKeys.some(key => keys.has(key)) ) callback(placeable, flags);
    }
  }
}
