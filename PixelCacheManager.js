/* globals
CONFIG,
foundry,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// LibGeometry
import {
  LevelBackgroundPixelCache,
  LevelForegroundPixelCache,
  TileDocumentPixelCache,
} from "./PixelCache.js";
import { NULL_SET } from "./util.js";

export class AbstractPixelCacheManager {

  /** @type {Set<string>} */
  static CHANGE_PARAMS = NULL_SET;

  /** @type {Set<string>} */
  static RESET_PARAMS = NULL_SET;

  /** @type {PixelCache} */
  static PIXELCACHE_CLASS;

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
    const texture = await this.constructor.PIXELCACHE_CLASS.getTexture(doc);
    if ( !texture ) return;
    const cache = this.constructor.createPixelCache(doc, texture);
    if ( cache ) this.caches.set(doc.uuid, cache);
  }

  /**
   * Adds this document to the cache if the texture is already loaded.
   * @param {CanvasDocument} doc
   */
  cacheDocumentSync(doc) {
    const texture = this.constructor.PIXELCACHE_CLASS.getTextureSync(doc);
    if ( !texture ) return;
    const cache = this.constructor.createPixelCache(doc, texture);
    if ( cache ) this.caches.set(doc.uuid, cache);
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
   * @returns {TextureDocumentPixelCache|null}
   */
  pixelCacheForDocument(doc) {
    if ( !this.caches.has(doc.uuid)) {
      const texture = this.constructor.PIXELCACHE_CLASS.getTextureSync(doc);
      if ( !texture ) return null;
      const cache = this.constructor.createPixelCache(doc);
      if ( cache ) this.caches.set(doc.uuid, cache);
    }
    return this.caches.get(doc.uuid);
  }

  /**
   * Retrieves the texture for a tile document.
   * @param {CanvasDocument} doc
   * @returns {PIXI.Texture|undefined}
   */
  getTextureForDocumentSync(doc) {
    const cache = this.pixelCacheForDocument(doc);
    return cache.getTextureSync(doc);
  }

  /**
   * Retrieves the texture for a tile document asynchronously.
   * Will load texture if needed.
   * @param {CanvasDocument} doc
   * @returns {PIXI.Texture|undefined}
   */
  async getTextureForDocumentAsync(doc) {
    const cache = this.pixelCacheForDocument(doc);
    return cache.getTexture(doc); // Async.
  }

  /**
   * Create a PixelCache for a given document.
   * @param {CanvasDocument} textureDocument
   * @param {PIXI.Texture} texture
   * @returns {PixelCache}
   */
  static createPixelCache(textureDocument, texture) {
    const resolution = CONFIG.GeometryLib.CONFIG.pixelCacheResolution ?? 1;
    return this.PIXELCACHE_CLASS.fromTextureAlpha({ textureDocument, texture, resolution });
  }

  /**
   * Retrieves the url to load a texture for the document.
   * @param {CanvasDocument} doc
   * @returns {string}
   */
  textureURL(doc) { return this.pixelCacheForDocument(doc).textureSource; }

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
    "texture.anchorX",
    "texture.anchorY",
  ]);

  /** @type {Set<string>} */
  static RESET_PARAMS = new Set([
    "texture.src",
  ]);

  /** @type {string} */
  static TYPE = "Tile";

  /** @type {PixelCache} */
  static PIXELCACHE_CLASS = TileDocumentPixelCache;

  /**
   * Get the cache for a specific tile.
   * @param {Tile} tile
   * @returns {PixelCache}
   */
  pixelCacheForTile(tile) { return this.pixelCacheForDocument(tile.document); }
}

export class LevelBackgroundPixelCacheManager extends AbstractPixelCacheManager {

  /** @type {Set<string>} */
  static CHANGE_PARAMS = new Set([
    "textures.scaleX",
    "textures.scaleY",
    "textures.rotation",
    "textures.fit",
    "textures.anchorX",
    "textures.anchorY",
    "textures.offsetX",
    "textures.offsetY",
  ]);

  /** @type {Set<string>} */
  static RESET_PARAMS = new Set([
    "background.src",
  ]);

  /** @type {Set<string>} */
  static SCENE_PARAMS = new Set([
    "dimensions.sceneWidth",
    "dimensions.sceneHeight",
    "dimensions.sceneX",
    "dimensions.sceneY",
  ]);

  /** @type {string} */
  static TYPE = "Level";

  /** @type {PixelCache} */
  static PIXELCACHE_CLASS = LevelBackgroundPixelCache

  /**
   * Register hooks used to update this document.
   */
  registerHooks() {
    super.registerHooks();
    Hooks.on(`updateScene`, (placeableD, changeData, _options, _userId) => {
      if ( !this.documentIsCached(placeableD) ) return;
      const updateKeys = Object.keys(foundry.utils.flattenObject(changeData));
      if ( updateKeys.some(key => this.constructor.SCENE_PARAMS.has(key)) ) {
        const cache = this.pixelCacheForDocument(placeableD);
        cache.updateTransforms();
      }
    });
  }

}

export class LevelForegroundPixelCacheManager extends LevelBackgroundPixelCacheManager  {

  /** @type {Set<string>} */
  static RESET_PARAMS = new Set([
    "foreground.src",
  ]);


  /** @type {PixelCache} */
  static PIXELCACHE_CLASS = LevelForegroundPixelCache;

}
