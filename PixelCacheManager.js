/* globals
CONFIG,
foundry,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// LibGeometry
import { LevelPixelCache, TilePixelCache } from "./PixelCache.js";

export class PixelCacheManager {

  /** @type {Set<string>} */
  static CHANGE_PARAMS = new Set([
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "texture.scaleX",
    "texture.scaleY",
    "texture.src",
    "texture.fit",
    "texture.anchorX",
    "texture.anchorY",
  ]);

  /** @type {Set<string>} */
  static RESET_PARAMS = new Set([
    "texture.src",
  ]);

  /** @type {Map<string, PixelCache>} */
  caches = new Map();

  /**
   * Register hooks used to update this document.
   */
  registerHooks() {
    Hooks.on(`update${this.constructor.TYPE}`, (placeableD, changeData, _options, _userId) => {
      const cache = this.cacheForDocument(placeableD);
      const updateKeys = Object.keys(foundry.utils.flattenObject(changeData));
      if ( !cache ) return;
      if ( updateKeys.some(key => this.constructor.RESET_PARAMS.has(key)) ) {
        this.caches.delete(placeableD.uuid);
        return;
      }
      if ( updateKeys.some(key => this.constructor.CHANGE_PARAMS.has(key)) ) cache.updateTransforms();
    });
  }

  /**
   * Retrieve the pixel cache for a given document.
   * @param {CanvasDocument}
   * @returns {TextureDocumentPixelCache}
   */
  cacheForDocument(doc) {
    if ( !this.caches.has(doc.uuid) ) this.caches.set(doc.uuid, this._getCache(doc));
    return this.caches.get(doc.uuid);
  }

  /**
   * Create a PixelCache for a given document.
   * @param {TileDocument} doc
   * @returns {TilePixelCache}
   */
  _getCache(_doc) { throw Error("PixelCacheManager|_getCache must be implemented by child class."); }
}

export class TilePixelCacheManager extends PixelCacheManager {

  /** @type {string} */
  static TYPE = "Tile";

  /**
   * Get the cache for a specific tile.
   * @param {Tile} tile
   * @returns {PixelCache}
   */
  cacheForTile(tile) { return this.cacheForDocument(tile.document); }

  /**
   * Create a PixelCache for a given document.
   * @param {TileDocument} doc
   * @returns {TilePixelCache}
   */
  _getCache(doc) {
    const tile = doc.object;
    if ( !tile ) throw Error("TilePixelCacheManager|Tile not found.");
    return TilePixelCache.fromTileAlpha(doc, { resolution: CONFIG.GeometryLib.CONFIG.pixelCacheResolution ?? 1 })
  }
}

export class LevelBackgroundPixelCacheManager extends PixelCacheManager {

  /** @type {string} */
  static TYPE = "Level";

  /**
   * Get the cache for the background of a specific level.
   * @param {Level} level
   * @returns {PixelCache}
   */
  cacheForLevel = this.cacheForDocument;

  /**
   * Create a PixelCache for a given document.
   * @param {TileDocument} doc
   * @returns {TilePixelCache}
   */
  _getCache(doc) {
    if ( !doc.background.src ) return null;
    return LevelPixelCache.fromTileAlpha(doc, { resolution: CONFIG.GeometryLib.CONFIG.pixelCacheResolution ?? 1, foreground: false })
  }
}

export class LevelForegroundPixelCacheManager extends LevelBackgroundPixelCacheManager  {

  /**
   * Create a PixelCache for a given document.
   * @param {TileDocument} doc
   * @returns {TilePixelCache}
   */
  _getCache(doc) {
    if ( !doc.foreground.src ) return null;
    return LevelPixelCache.fromTileAlpha(doc, { resolution: CONFIG.GeometryLib.CONFIG.pixelCacheResolution ?? 1, foreground: true })
  }
}
