/* globals
CONFIG,
foundry,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// LibGeometry
import { LevelPixelCache, TileDocumentPixelCache } from "./PixelCache.js";

export class AbstractPixelCacheManager {

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
      if ( !this.documentIsCached(placeableD) ) return;
      const updateKeys = Object.keys(foundry.utils.flattenObject(changeData));
      if ( updateKeys.some(key => this.constructor.RESET_PARAMS.has(key)) ) {
        this.caches.delete(placeableD.uuid);
        this.cacheDocument(placeableD); // Async.
        return;
      }
      if ( updateKeys.some(key => this.constructor.CHANGE_PARAMS.has(key)) ) {
        const cache = this.pixelCacheForDocument(placeableD);
        cache.updateTransforms();
      }
    });
  }

  /**
   * Cache a document, asynchronously.
   * @param {CanvasDocument} doc
   */
  async cacheDocument(doc) {
    let texture = this.getTextureForDocument(doc);
    let tmpTexture = !texture;
    texture ??= await this.loadTexture(this.textureURL(doc));
    if ( !texture ) return;
    const cache = this._getCache(doc, texture);
    if ( cache ) this.caches.set(doc.uuid);
    if ( tmpTexture ) texture.destroy();
  }

  /**
   * Adds this document to the cache if the texture is already loaded.
   * @param {CanvasDocument} doc
   */
  cacheDocumentSync(doc) {
    const texture = this.getTextureForDocument(doc);
    if ( !texture ) return;
    const cache = this._getCache(doc, texture);
    if ( cache ) this.caches.set(doc.uuid);
  }

  /**
   * Is this document already cached?
   * @param {CanvasDocument} doc
   * @returns {boolean}
   */
  documentIsCached(doc) { return this.caches.has(doc.uuid); }

  /**
   * Retrieve the pixel cache for a given document.
   * @param {CanvasDocument}
   * @returns {TextureDocumentPixelCache}
   */
  pixelCacheForDocument(doc) {
    if ( !this.caches.has(doc.uuid) ) this.cacheDocumentSync(doc);
    return this.caches.get(doc.uuid);
  }

  /**
   * Retrieves the texture for a tile document.
   * @param {CanvasDocument} doc
   * @returns {PIXI.Texture|undefined}
   */
  getTextureForDocument(_doc) { throw Error("PixelCacheManager|_getCache must be implemented by child class."); }

  /**
   * Create a PixelCache for a given document.
   * @param {CanvasDocument} doc
   * @returns {PIXI.Texture|undefined}
   */
  _getCache(_doc, _texture) { throw Error("PixelCacheManager|_getCache must be implemented by child class."); }

  /**
   * Retrieves the url to load a texture for the document.
   * @param {CanvasDocument} doc
   * @returns {string}
   */
  textureURL(_doc) { throw Error("PixelCacheManager|_getCache must be implemented by child class."); }

  /**
   * Loads the texture from a url.
   * @param {string} [url]
   * @returns {PIXI.Texture|undefined}
   */
  async loadTexture(url) {
    if ( !url ) return undefined;
    const texture = await PIXI.Assets.load(url);
    if ( !texture ) throw Error(`Texture at ${url} did not load.`);
    return texture;
  }
}

export class TilePixelCacheManager extends AbstractPixelCacheManager {

  /** @type {string} */
  static TYPE = "Tile";

  /**
   * Get the cache for a specific tile.
   * @param {Tile} tile
   * @returns {PixelCache}
   */
  pixelCacheForTile(tile) { return this.pixelCacheForDocument(tile.document); }

  /**
   * Retrieves the texture for a tile document.
   * @param {CanvasDocument} tileD
   * @returns {PIXI.Texture|undefined}
   */
  getTextureForDocument(doc) { return TileDocumentPixelCache.textureForTileDocument(doc); }

  /**
   * Create a PixelCache for a given document.
   * @param {TileDocument} doc
   * @returns {TilePixelCache|null}
   */
  _getCache(doc, texture) {
    const resolution = CONFIG.GeometryLib.CONFIG.pixelCacheResolution ?? 1;
    return TileDocumentPixelCache.fromTileAlpha(doc, { texture, resolution });
  }

  /**
   * Retrieves the url to load a texture for the document.
   * @param {CanvasDocument} doc
   * @returns {string}
   */
  textureURL(doc) { return doc.texture.src; }
}

export class LevelBackgroundPixelCacheManager extends AbstractPixelCacheManager {

  /** @type {string} */
  static TYPE = "Level";

  static foreground = false;

  /**
   * Get the cache for the background of a specific level.
   * @param {Level} level
   * @returns {PixelCache}
   */
  pixelCacheForLevel = this.cacheForDocument;

  /**
   * Retrieves the texture for a tile document.
   * @param {CanvasDocument} tileD
   * @returns {PIXI.Texture|undefined}
   */
  getTextureForDocument(doc) { return LevelPixelCache.textureForLevel(doc, this.constructor.foreground); }

  /**
   * Create a PixelCache for a given document.
   * @param {TileDocument} doc
   * @returns {TilePixelCache}
   */
  _getCache(doc, texture) {
    const resolution = CONFIG.GeometryLib.CONFIG.pixelCacheResolution ?? 1;
    const foreground = this.constructor.foreground;
    return LevelPixelCache.fromLevelAlpha(doc, { texture, resolution, foreground })
  }

  /**
   * Retrieves the url to load a texture for the document.
   * @param {CanvasDocument} doc
   * @returns {string}
   */
  textureURL(doc) { return doc[this.constructor.foreground ? "foreground" : "background"].src; }
}

export class LevelForegroundPixelCacheManager extends LevelBackgroundPixelCacheManager  {

  static foreground = true;

}
