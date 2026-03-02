/* globals
canvas,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// LibGeometry
import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "../const.js";
import { PlaceableUpdateWatcher } from "./PlaceableUpdateWatcher.js";

/* Store key geometry information for each placeable, in 3d.
- AABB
- rotation, scaling, and translation matrices from an ideal shape.
- Polygon3ds for faces
- Triangle3ds for faces
- vertices

Regions store information per-shape.
Matrices are stored in a single buffer in the static class property
Tracks only changes to the physical representation of the placeable in the scene
Stored on each placeable.

Once registered, will create tracking objects for each placeable created.
*/



/**
 * Class that handles creation and updating of a geometry object on a given placeable.
 * Mixins define properties like aabb, faces, modelMatrix.
 * A given placeable will only have one of each even if registered repeatedly.
 * Similar to PlaceableUpdateWatcher.
 */
export class PlaceableGeometryTracker {

  // ----- NOTE: Constructor ----- //

  /** @type {string} */
  documentName = "";

  /** @type {string} */
  layer = "";

  /**
   * @typedef TrackerTypes
   * @prop {string} : {string[]}  Type of callback to track and array of keys that trigger it
   */

  /** @type {TrackerTypes} */
  trackers;

  /* @type {number} */
  _createHookId = null;

  /* @type {number} */
  _deleteHookId = null;

  /**
   * @param {string} documentName   Name of document to watch.
   */
  constructor(documentName, trackers = {}, layer = `${documentName.toLowerCase()}s`) {
    this.layer = layer; // E.g. Wall -> walls
    this.documentName = documentName;
    this.trackers = trackers;
  }

  // ----- NOTE: Tracking ----- //

  /** @type {PlaceableGeometryTracker} */
  static watcher;

  /**
   * Creation function that enforces singular function.
   * @returns {PlaceableGeometryTracker}
   */
  // TODO: Might need to resolve when two modules use geometry subsets, like
  // one only needs AABB while another only needs ModelMatrix.
  static create() {
    if ( !(this.DOCUMENT_NAME || this.TRACKERS ) ) throw Error(`${this.constructor.name} missing static properties`);

    this.watcher ??= new this(this.DOCUMENT_NAME, this.TRACKERS, this.LAYER);
    return this.watcher;
  }

  registerExistingPlaceables(placeables) {
    placeables ??= canvas[this.layer].placeables;
    for ( const placeable of placeables ) this.constructor._onPlaceableDocumentCreation(placeable.document);
  }

  deRegisterExistingPlaceables(placeables) {
    placeables ??= canvas[this.layer].placeables;
    for ( const placeable of placeables ) this.constructor._onPlaceableDestroy(placeable);
  }

  activate() {
    if ( !this._createHookId ) { // Avoid duplicate hooks.
      this._createHookId = Hooks.on(`create${this.documentName}`, this.constructor._onPlaceableDocumentCreation.bind(this.constructor));
    }
    if ( !this._deleteHookId ) {
      this._deleteHookId = Hooks.on(`destroy${this.documentName}`, this.constructor._onPlaceableDestroy.bind(this.constructor));
    }

    // Register tracking of placeable updates.
    const watcher = PlaceableUpdateWatcher.create(this.documentName);
    for ( const [updateType, keys] of Object.entries(this.trackers) ) {
      const updateFn = (placeable, _change, _userId) => {
        const geom = placeable[GEOMETRY_LIB_ID]?.[GEOMETRY_ID];
        if ( !geom ) return;
        geom[`${updateType}Updated`]();
      }
      watcher.register(keys, updateFn);
    }
    watcher.activate();
  }

  deactivate() {
    if (this._createHookId) {
      Hooks.off(`create${this.documentName}`, this._createHookId);
      this._createHookId = null;
    }
    if (this._deleteHookId) {
      Hooks.off(`destroy${this.documentName}`, this._deleteHookId);
      this._deleteHookId = null;
    }
    const watcher = PlaceableUpdateWatcher.create(this.documentName);
    watcher.deactivate();
  }

  /**
   * On placeable document creation, create the handler.
   * A hook event that fires for every embedded Document type after conclusion of a creation workflow.
   * @param {Document} document                       The new Document instance which has been created
   * @param {Partial<DatabaseCreateOperation>} options Additional options which modified the creation request
   * @param {string} userId                           The ID of the User who triggered the creation workflow
   */
  static _onPlaceableDocumentCreation(placeableD, _options, _userId) {
    const placeable = placeableD.object;
    if ( !placeable ) return;
    this.GEOMETRY.create(placeable);
  }

  static _onPlaceableDestroy(placeable) {
    const geom = placeable[GEOMETRY_LIB_ID]?.[GEOMETRY_ID];
    if ( !geom ) return;
    geom.destroy();
  }
}

/* Testing

PlaceableUpdateWatcher = CONFIG.GeometryLib.lib.placeableGeometryTracking.PlaceableUpdateWatcher
WallGeometryTracker = CONFIG.GeometryLib.lib.placeableGeometryTracking.WallGeometryTracker

Draw = CONFIG.GeometryLib.lib.Draw;
canvasTests = CONFIG.GeometryLib.lib.canvasTests
canvasTests.drawWallGeometries()
canvasTests.drawTileGeometries()
canvasTests.drawRegionGeometries()
canvasTests.drawTokenGeometries()

canvasTests.drawTokenBorder()
canvasTests.drawConstrainedTokenBorder()
canvasTests.drawLitTokenBorderTokenBorder()
canvasTests.drawBrightLitTokenBorderTokenBorder()
canvasTests.drawTokenSoundBorder()


*/
