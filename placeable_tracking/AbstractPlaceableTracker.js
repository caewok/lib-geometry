/* globals
canvas,
foundry,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_LIB_ID } from "../const.js";

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

/**
 * The abstract tracker handles incrementing a counter for a set
 * of update keys. Keys can be either refresh keys or document property keys.
 */
export class AbstractPlaceableTracker {
  /**
   * The tracker will be saved at placeable[GEOMETRY_LIB_ID][ID] with updateId property.
   * @type {string}
   */
  static ID;

  // ----- NOTE: Tracking Keys ----- //

  /**
   * Change keys in that indicate a relevant change to the placeable document.
   * e.g., "x"
   * @param {Set<string>}
   */
  static DOCUMENT_KEYS = new Set();

  /**
   * Change keys that indicate a relevant change to the placeable refresh flag.
   * e.g., "refreshPosition"
   * @param {Set<string>}
   */
  static REFRESH_FLAGS = new Set();

  // ----- NOTE: Hooks ----- //

  /**
   * On placeable document creation, create the handler and update.
   * A hook event that fires for every embedded Document type after conclusion of a creation workflow.
   * @param {Document} document                       The new Document instance which has been created
   * @param {Partial<DatabaseCreateOperation>} options Additional options which modified the creation request
   * @param {string} userId                           The ID of the User who triggered the creation workflow
   */
  static _onPlaceableDocumentCreation(placeableD, _options, _userId) {
    if ( !placeableD.object ) return;
    const handler = new this(placeableD.object);
    handler.initialize();
  }

  /**
   * Update the object's handler if the changes match 1+ update keys.
   *
   * A hook event that fires for every Document type after conclusion of an update workflow.
   * @param {Document} document                       The existing Document which was updated
   * @param {object} changed                          Differential data that was used to update the document
   * @param {Partial<DatabaseUpdateOperation>} options Additional options which modified the update request
   * @param {string} userId                           The ID of the User who triggered the update workflow
   */
  static _onPlaceableDocumentUpdate(placeableD, changed, _options, _userId) {
    const placeable = placeableD.object;
    if ( !placeable ) return;
    const changeKeys = Object.keys(foundry.utils.flattenObject(changed));
    if ( !placeable[GEOMETRY_LIB_ID][this.ID] ) console.error(`Placeable ID not defined for ${placeable.name}, ${placeable.id}`);
    if ( changeKeys.some(key => this.DOCUMENT_KEYS.has(key)) ) placeable[GEOMETRY_LIB_ID][this.ID].update();
  }

  /**
   * A hook event that fires for every Document type after conclusion of an deletion workflow.
   * @param {Document} document                       The existing Document which was deleted
   * @param {Partial<DatabaseDeleteOperation>} options Additional options which modified the deletion request
   * @param {string} userId                           The ID of the User who triggered the deletion workflow
   */
  // Unused static _onPlaceableDocumentDeletion(_placeableD, _options, _userId) {}

  /**
   * A hook event that fires when a {@link PlaceableObject} is initially drawn.
   * @param {PlaceableObject} object    The object instance being drawn
   */
  static _onPlaceableDraw(placeable) {
    const handler = new this(placeable);
    handler.initialize();
  }

  /**
   * A hook event that fires when a {@link PlaceableObject} is incrementally refreshed.
   * @param {PlaceableObject} object    The object instance being refreshed
   * @param {RenderFlags} flags
   */
  static _onPlaceableRefresh(placeable, flags) {
    // TODO: Can flags be set to false? Need this filter if so.
    // const changeKeys = Object.entries(flags).filter([key, value] => value).map([key, value] => key);
    const changeKeys = Object.keys(flags);
    if ( !placeable[GEOMETRY_LIB_ID][this.ID] ) console.error(`Placeable ID not defined for ${placeable.name}, ${placeable.id}`);
    if ( changeKeys.some(key => this.REFRESH_FLAGS.has(key)) ) placeable[GEOMETRY_LIB_ID][this.ID].update();
  }

  /**
   * A hook event that fires when a {@link PlaceableObject} is destroyed.
   * @param {PlaceableObject} object    The object instance being destroyed
   */
  // Unused static _onPlaceableDestroy(placeable) {}

  // ----- NOTE: Register Hooks ----- //

  /** @type {number[]} */
  static _hooks = new Map();

  /**
   * Register hooks for this placeable type that record updates.
   */
  static registerPlaceableHooks() {
    if ( this._hooks.has(this.name) ) return;
    const hooks = [];
    this._hooks.set(this.name, hooks);

    const HOOKS = {}
    if ( this.DOCUMENT_KEYS.size ) {
      HOOKS[`create${this.PLACEABLE_NAME}`] = "_onPlaceableDocumentCreation";
      HOOKS[`update${this.PLACEABLE_NAME}`] = "_onPlaceableDocumentUpdate";
    }
    if ( this.REFRESH_FLAGS.size ) {
      HOOKS[`draw${this.PLACEABLE_NAME}`] = "_onPlaceableDraw";
      HOOKS[`refresh${this.PLACEABLE_NAME}`] = "_onPlaceableRefresh";
    }

    for ( const [name, methodName] of Object.entries(HOOKS) ) {
      const id = Hooks.on(name, this[methodName].bind(this));
      hooks.push({ name, methodName, id });
    }
  }

  /**
   * Deregister hooks for this placeable type that record updates.
   */
  static deregisterPlaceableHooks() {
    const hooks = this._hooks.get(this.name) ?? [];
    hooks.forEach(hook => Hooks.off(hook.name, hook.id));
    this._hooks.delete(this.name);
  }

  /**
   * Create a handler for all placeables.
   */
  static registerExistingPlaceables(placeables) {
    placeables ??= canvas[this.layer].placeables;
    placeables.forEach(placeable => this.create(placeable));
  }

  // ----- NOTE: Constructor ----- //

  /** @type {Placeable} */
  placeable;

  constructor(placeable) {
    this.placeable = placeable;
  }

  static create(placeable) {
    const obj = placeable[GEOMETRY_LIB_ID] ??= {};

    // Singleton. If this tracker already exists, keep it.
    if ( obj[this.ID] ) return obj[this.ID];

    const out = new this(placeable);
    obj[this.ID] = out;
    out.initialize();
    out.update();
    return out;
  }

  initialize() { this.update(); }

  /**
   * Increment every time there is an update.
   * @type {number}
   */
  #updateId = 0;

  get updateId() { return this.#updateId; }

  update() {
    this.#updateId += 1;
  }
}

/* Testing
tracking = CONFIG.GeometryLib.lib.placeableTracking
tracking.TilePositionTracker.registerPlaceableHooks()
tracking.TilePositionTracker.registerExistingPlaceables()

tile = canvas.tiles.controlled[0]
tile.libGeometry.

*/
