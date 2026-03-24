/* globals
foundry,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


/* Use single hook for placeable creation/update/deletion

Keeps track of multiple callbacks triggered by document or placeable CRUD.
- Call using CONFIG.GeometryLib.placeableTrackers to avoid multiple versions.
- Avoids multiple registrations of the same tracker by using ids.
- Avoids multiple hooks for walking through change values.
- TODO: Could use a priority queue (priority map?) if ordering of updates is necessary.

NOTE: To register, call in CONFIG.GeometryLib once the placeables are loaded.
This prevents multiple versions from running at once.
Example:
CONFIG.GeometryLib.placeableTrackers.TokenPositionTracker.registerPlaceableHooks()
CONFIG.GeometryLib.placeableTrackers.TokenPositionTracker.registerExistingPlaceables()
*/

export class PlaceableUpdateWatcher {

  /** @type {enum<string>} */
  static HOOK_LABELS = {
    create: "create",
    update: "update",
    delete: "delete",
  };

  /** @type {string} */
  documentName = "";

  /**
   * @typedef UpdateCallback
   * @prop {Set<string>} keys     Property strings to watch
   * @prop {function} callback    Function to call
   *  - @param {PlaceableObject} placeable        Placeable being changed
   *  - @param {object} change                    Raw change object
   *  - @param {userId} userId                    Id of user who performed update
   */
  callbacks = {
    create: new Map(), /** @type {Map<id, Callback>} */
    update: new Map(), /** @type {Map<id, Callback>} */
    delete: new Map(), /** @type {Map<id, Callback>} */
  };

  hooks = {
    create: null, /* @type {number|null} */
    update: null, /* @type {number|null} */
    delete: null, /* @type {number|null} */
  };

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
  static getWatcher(documentName) {
    const id = `${this.name}_${documentName}`;
    if ( this.watchers.has(id) ) return this.watchers.get(id);
    const watcher = new this(documentName);
    this.watchers.set(id, watcher);
    return watcher;
  }

  static activateAll() {
    for ( const watcher of this.watchers.values() ) watcher.activate();
  }

  static deactivateAll() {
    for ( const watcher of this.watchers.values() ) watcher.deactivate();
  }

  /**
   * Register a callback to fire
   * @param {"create"|"update"|"delete"} type
   * @param {string} id           Id of the key to register; duplicates are ignored
   * @param {function} callback   Function to call
   * - @param {Document} document     The Foundry document being deleted.
   * - @param {Object} options        Deletion options.
   * - @param {string} userId         The ID of the user who performed the deletion.
   * @param {Set<string>} keys       Array of flattened property strings to watch
   */
  register(type, id, callback, keys) {
    type = this.constructor.HOOK_LABELS[type] || type;
    const cb = this.callbacks[type];
    if ( !cb ) {
      console.warn(`${this.constructor.name}|Type ${type} not recognized.`);
      return;
    }
    if ( cb.has(id) ) return;
    if ( type === "update" ) cb.set(id, { callback, keys });
    else cb.set(id, callback);
  }

  deregister(id) {
    this.callbacks.create.delete(id);
    this.callbacks.update.delete(id);
    this.callbacks.delete.delete(id);
  }

  /**
   * Start listening to the update hook.
   */
  activate() {
    // Avoid multiple hooks by checking against this.hooks.
    const HL = this.constructor.HOOK_LABELS;
    this.hooks.create ||= Hooks.on(`${HL.create}${this.documentName}`, this._handleCreation.bind(this));
    this.hooks.update ||= Hooks.on(`${HL.update}${this.documentName}`, this._handleUpdate.bind(this));
    this.hooks.delete ||= Hooks.on(`${HL.delete}${this.documentName}`, this._handleDeletion.bind(this));
  }

  /**
   * Stop listening to the update hook.
   */
  deactivate() {
    const HL = this.constructor.HOOK_LABELS;
    if ( this.hooks.create ) Hooks.off(`${HL.create}${this.documentName}`, this.hooks.create);
    if ( this.hooks.update ) Hooks.off(`${HL.update}${this.documentName}`, this.hooks.update);
    if ( this.hooks.delete ) Hooks.off(`${HL.delete}${this.documentName}`, this.hooks.delete);
    this.hooks.create = null;
    this.hooks.update = null;
    this.hooks.delete = null;
  }

  /**
   * Internal update hook handler.
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
    for ( const { keys, callback } of this.callbacks.update.values() ) {
      if ( changeKeys.some(key => keys.has(key)) ) callback(placeable, changeKeys, userId);
    }
  }

  /**
   * Internal doc create hook handler.
   * @param {Document} document     The Foundry document being created.
   * @param {Object} options        Create options.
   * @param {string} userId         The ID of the user who performed the creation.
   */
  _handleCreation(placeableD, options, userId) {
    const placeable = placeableD.object;
    if ( !placeable ) return;
    for ( const callback of this.callbacks.create.values() ) callback(placeable, options, userId);
  }

  /**
   * Internal doc delete hook handler.
   * @param {Document} document     The Foundry document being deleted.
   * @param {Object} options        Delete options.
   * @param {string} userId         The ID of the user who performed the deletion.
   */
  _handleDeletion(placeableD, options, userId) {
    for ( const callback of this.callbacks.delete.values() ) callback(placeableD, options, userId);
  }
}


export class PlaceableRefreshWatcher extends PlaceableUpdateWatcher {
  /** @type {enum<string>} */
  static HOOK_LABELS = {
    create: "draw",
    update: "refresh",
    delete: "destroy",
  };



  /**
   * Internal hook handler.
   * @param {PlaceableObject} object    The object instance being refreshed
   * @param {RenderFlags} flags
   */
  _handleUpdate(placeable, flags) {
    // Walk through each callback in turn, triggering it if it matches one or more change keys.
    const changeKeys = Object.keys(flags);
    for ( const { keys, callback } of this.callbacks.update.values() ) {
      if ( changeKeys.some(key => keys.has(key)) ) callback(placeable, changeKeys);
    }
  }

  /**
   * Internal doc create hook handler.
   * @param {Document} document     The Foundry document being created.
   * @param {Object} options        Create options.
   * @param {string} userId         The ID of the user who performed the creation.
   */
  _handleCreation(placeable) {
    for ( const callback of this.callbacks.create.values() ) callback(placeable);
  }

  /**
   * Internal doc delete hook handler.
   * @param {Document} document     The Foundry document being deleted.
   * @param {Object} options        Delete options.
   * @param {string} userId         The ID of the user who performed the deletion.
   */
  _handleDeletion(placeable) {
    for ( const callback of this.callbacks.delete.values() ) callback(placeable);
  }
}
