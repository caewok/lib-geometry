/* globals
canvas,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// LibGeometry
import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "../const.js";
import { NULL_SET } from "../util.js";

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

  static UPDATE_KEYS;

  static REFRESH_KEYS;

  static registerHooks() {
    const docName = this.DOCUMENT_NAME;
    const docWatcher = this.documentWatcher;
    const refreshWatcher = this.refreshWatcher;
    const id = `${docName}Geometry`;

    // Creation
    refreshWatcher.register("draw", id, this._onPlaceableDraw.bind(this));

    // Deletion
    refreshWatcher.register("destroy", id, this._onPlaceableDestroy);

    // Updates
    if ( this.UPDATE_KEYS ) docWatcher.register("update", id, this._onPlaceableUpdate, this.UPDATE_KEYS);
    if ( this.REFRESH_KEYS ) docWatcher.register("refresh", id, this._onPlaceableUpdate, this.REFRESH_KEYS);
  }

  static get documentWatcher() {
    const PlaceableUpdateWatcher = CONFIG[GEOMETRY_LIB].lib.placeableGeometryTracking.PlaceableUpdateWatcher;
    const docName = this.DOCUMENT_NAME;
    return PlaceableUpdateWatcher.getWatcher(docName);
  }

  static get refreshWatcher() {
    const PlaceableRefreshWatcher = CONFIG[GEOMETRY_LIB].lib.placeableGeometryTracking.PlaceableRefreshWatcher;
    const docName = this.DOCUMENT_NAME;
    return PlaceableRefreshWatcher.getWatcher(docName);
  }

  static registerExistingPlaceables(placeables) {
    placeables ??= canvas[this.LAYER].placeables;
    for ( const placeable of placeables ) this._onPlaceableDrawing(placeable.document);
  }

  static deRegisterExistingPlaceables(placeables) {
    placeables ??= canvas[this.LAYER].placeables;
    for ( const placeable of placeables ) this._onPlaceableDestroy(placeable);
  }

  static activate() {
    this.documentWatcher.activate();
    this.refreshWatcher.activate();
  }

  static deactivate() {
    this.documentWatcher.deactivate();
    this.refreshWatcher.deactivate();
  }

  /**
   * On placeable document creation, create the handler.
   * A hook event that fires for every embedded Document type after conclusion of a creation workflow.
   * @param {Document} document                       The new Document instance which has been created
   * @param {Partial<DatabaseCreateOperation>} options Additional options which modified the creation request
   * @param {string} userId                           The ID of the User who triggered the creation workflow
   */
  static _onPlaceableDraw(placeable) {
    const geom = this.GEOMETRY.create(placeable);
    geom.initialize();
  }

  static _onPlaceableDestroy(placeable) {
    const geom = placeable[GEOMETRY_LIB_ID]?.[GEOMETRY_ID];
    if ( !geom ) return;
    geom.destroy();
  }

  static _onPlaceableUpdate(placeable, changeKeys) {
    const geom = placeable[GEOMETRY_LIB_ID]?.[GEOMETRY_ID];
    if ( !geom ) return;
    geom.update(changeKeys);
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
