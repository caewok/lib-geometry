/* globals
canvas,
CONST,
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { NULL_SET } from "./util.js";
import { OTHER_MODULES, GEOMETRY_LIB_ID, GEOMETRY_ID } from "./const.js";
import { AABB2d } from "./AABB.js";

/**
 * An instance that, for a given configuration, tracks potential obstacles.
 * Config handles what is blocking and what sense type is used.
 * The viewing shape can also be set.
 * Store temporary sets of placeable objects within the viewing shape.
 */
export class ObstacleOcclusionTest {
  obstacles = {
    tiles: NULL_SET,
    tokens: NULL_SET,
    regions: NULL_SET,
    walls: NULL_SET,
    terrainWalls: NULL_SET,
    proximateWalls: NULL_SET,
    reverseProximateWalls: NULL_SET,
  };

  /**
   * Shape that restricts the universe of placeables to test.
   * Must have:
   * - aabb or getBounds
   * - Optionally contains placeable.
   * @type {*}
   */
  #frustum = canvas.dimensions.sceneRect;

  #frustum2dBounds = canvas.dimensions.sceneRect; // For Quadtree.

  get frustum() { return this.#frustum; }

  set frustum(value) {
    this.#frustum = value;
    this.#setFrustumRect();
    this.update();
  }

  #setFrustumRect() {
    const f = this.#frustum;
    if ( f instanceof PIXI.Rectangle || f instanceof AABB2d ) this.#frustum2dBounds = f;
    else if ( f.aabb ) this.#frustum2dBounds = f.aabb;
    else if ( f.toRectangle ) this.#frustum2dBounds = f.toRectangle();
    else if ( f.getBounds ) this.#frustum2dBounds = f.getBounds();
    else if ( f.bounds ) this.#frustum2dBounds = f.bounds;
    else this.#frustum2dBounds = f;
  }

  /**
   * @typedef TokenBlockingConfig
   * @prop {boolean} dead                     True if dead tokens block
   * @prop {boolean} live                     True if live tokens block
   * @prop {Set<string>} excludedStatuses     If token has status, it does not block
   *
   * Relevant only if live tokens block:
   * @prop {boolean} prone      If false, only non-prone tokens block, otherwise all block
   * @prop {boolean} enemies    If true, enemies block
   * @prop {boolean} allies     If true, allies block
   * Enemies and allies operate with respect to a subject (move or view) token.
   * Neutrals are always allies; secret are always enemies. Hostile vs Hostile are allies.
   */

  /**
   * @typedef BlockingConfig
   * @prop {string} senseType
   * @prop {boolean} walls        True if walls block
   * @prop {boolean} tiles        True if tiles block
   * @prop {boolean} regions      True if regions block
   * @prop {TokenBlockingConfig} tokens     Token-specific blocking settings
   */

  /** @type {BlockingConfig} */
  _config = {
    senseType: "sight",
    walls: true,
    tiles: true,
    regions: true,
    tokens: {
      dead: false,
      live: false,

      // If live, token may block when:
      prone: false,       // False: only non-prone tokens block.
      enemies: true,      // False: enemies do not block.
      allies: false,      // False: allies do not block.
      excludedStatuses: NULL_SET,  // If token has status, it does not block
    },
  };

  get config() { return structuredClone(this._config); }

  set config(cfg = {}) {
    if ( cfg.blocking ) console.error("ObstacleOcclusionTest no longer has 'blocking' in its config.");
    foundry.utils.mergeObject(this._config, cfg, { inplace: true, insertKeys: false, recursive: true });
    this.update();
  }

  /**
   * Subject token for which obstacles are being tested.
   * A Subject token are excluded from obstacle tests and other tokens may be excluded
   * based on disposition vis-a-vis subject token.
   * @type {Token}
   */
  #subjectToken = null;

  get subjectToken() { return this.#subjectToken; }

  set subjectToken(value) {
    this.#subjectToken = value;
    this.obstacles.tokens = this.findBlockingTokens();
  }

  /**
   * Tokens to exclude from the tests. Typically viewer (subject) and target.
   * @type {Set<Token>}
   */
  #tokensToExclude = new WeakSet();

  get tokensToExclude() { return this.#tokensToExclude; }

  set tokensToExclude(tokens) {
    if ( !tokens ) this.#tokensToExclude = new WeakSet();
    else {
      if ( !tokens[Symbol.iterator] ) tokens = [tokens];
      this.#tokensToExclude = new WeakSet(tokens);
    }
    this.obstacles.tokens = this.findBlockingTokens();
  }

  /**
   * Update the obstacles in preparation for ray collision testing.
   * Optionally store the viewpoint (ray origin) and tokens to exclude.
   * @param {object} [opts]
   * @param {Token[]} [opts.tokensToExclude]  Tokens to exclude; must be an array of Tokens or empty array.
   * @param {Point3d} [viewpoint]             Used for _rayIsOccluded as the starting viewpoint
   * @param {Token[]} [tokensToExclude=[]]    Exclude these tokens from collision testing
   */
  initialize({ subjectToken, tokensToExclude, ...cfg } = {}) {
    // Set privately and then trigger full update.
    if ( subjectToken ) this.#subjectToken = subjectToken;
    if ( tokensToExclude ) this.#tokensToExclude = new WeakSet(tokensToExclude);
    this.config = cfg; // Even if empty, trigger this.constructObstacleTester() via config setter;
  }

  /**
   * Test if a ray is occluded.
   * @param {Point3d} rayOrigin       Start of the ray
   * @param {Point3d} rayDirection    Direction of the ray
   * @returns {boolean} True if collision occurs
   */
  rayIsOccluded(rayOrigin, rayDirection) {
    return this.obstacleTester.call(this, rayOrigin, rayDirection);
  }

  update() {
    this._updateObstacles();
    this._constructObstacleTester();
  }

  _updateObstacles() {
    const senseType = this._config.senseType;
    this.obstacles.tiles = this.findBlockingTiles();
    this.obstacles.tokens = this.findBlockingTokens();
    this.obstacles.regions = this.findBlockingRegions();
    this.obstacles.walls = this.findBlockingWalls();
    this.obstacles.terrainWalls = this.constructor.subsetWallsByType(this.obstacles.walls, CONST.WALL_SENSE_TYPES.LIMITED, senseType);
    this.obstacles.proximateWalls = this.constructor.subsetWallsByType(this.obstacles.walls, CONST.WALL_SENSE_TYPES.PROXIMITY, senseType);
    this.obstacles.reverseProximateWalls = this.constructor.subsetWallsByType(this.obstacles.walls, CONST.WALL_SENSE_TYPES.DISTANCE, senseType);
  }

  // ----- NOTE: Filter potential obstacles ----- //

  findBlockingWalls() {
    if ( !this._config.walls ) return NULL_SET;
    let walls = canvas.walls.quadtree.getObjects(this.#frustum2dBounds);

    // Drop non-blocking walls for this sense type.
    walls = walls.filter(wall => wall.document[this._config.senseType]); // CONST.WALL_SENSE_TYPES.NONE === 0.

    // Specialized exclusion tests
    if ( this.#frustum.aabb ) walls = walls.filter(wall => this.#frustum.aabb.overlapsAABB(placeableAABB(wall)));
    if ( this.#frustum.overlapsEdge ) walls = walls.filter(wall => this.#frustum.overlapsEdge(wall));
    return walls;
  }

  findBlockingTokens() {
    const tokensCfg = this._config.tokens;
    if ( !(tokensCfg.dead || tokensCfg.live) ) return NULL_SET;
    let tokens = canvas.tokens.quadtree.getObjects(this.#frustum2dBounds, {
      collisionTest: o => this.includeToken(o.t)
    });

    // Specialized exclusion tests
    if ( this.#frustum.aabb ) tokens = tokens.filter(token => this.#frustum.aabb.overlapsAABB(placeableAABB(token)));
    if ( this.#frustum.overlapsToken ) tokens = tokens.filter(token => this.#frustum.overlapsToken(token));

    // Module-specific
    const RIDEABLE = OTHER_MODULES.RIDEABLE;
    if ( RIDEABLE ) {
      // Cannot iterate the weak set.
      // This is slower but preserves the weak set.
      // Drop any token with a riding connection to an excluded token.
      for ( const t of canvas.tokens.placeable ) {
        if ( this.subjectToken === t || this.tokensToExclude.has(t) ) {
          tokens.filter(token => !RIDEABLE.API.RidingConnection(token, t));
        }
      }
    }
    return tokens;
  }

  findBlockingTiles() {
    if ( !this._config.tiles ) return NULL_SET;
    let tiles = canvas.tiles.quadtree.getObjects(this.#frustum2dBounds);

    // Specialized exclusion tests
    if ( this.#frustum.aabb ) tiles = tiles.filter(tile => this.#frustum.aabb.overlapsAABB(placeableAABB(tile)));
    if ( this.#frustum.overlapsTile ) tiles = tiles.filter(tile => this.#frustum.overlapsTile(tile));
    return tiles;
  }

  findBlockingRegions() {
    if ( !this._config.regions ) return NULL_SET;
    let regions = canvas.regions.placeables; // No quadtree for regions.

    // Specialized exclusion tests
    if ( this.#frustum.aabb ) regions = regions.filter(region => this.#frustum.aabb.overlapsAABB(placeableAABB(region)));
    if ( this.#frustum.overlapsToken ) regions = regions.filter(region => this.#frustum.overlapsRegion(region));
    return regions;
  }

  /**
   * Does the token block with respect to a movement token?
   * @param {Token} token           Token to test for whether it could block
   * @param {Token} [subjectToken]       Token doing the movement or viewing
   * @param {TokenBlockingConfig} blockingCfg
   * @returns {boolean}
   */
  static tokenBlocks(token, subjectToken, blockingCfg = {}) {
    // Hidden tokens don't block.
    if ( token.document.hidden ) return false;

    // Don't block self. Note this is ignored if no subject token.
    if ( subjectToken === token ) return false;

    // Exclude certain token statuses.
    blockingCfg.excludedStatuses ??= NULL_SET;
    if ( token.actor?.statuses
      && token.actor.statuses.intersects(blockingCfg.excludedStatuses) ) return false;

    // Tests for dead tokens.
    if ( !blockingCfg.dead && CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsDead(token) ) return false;

    // Tests for live tokens.
    if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsAlive(token) ) {
      if ( !blockingCfg.live ) return false;
      if ( !blockingCfg.prone && token.isProne ) return false;

      // Compare disposition to subject token.
      if ( subjectToken ) {
        if ( !blockingCfg.enemies && CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsEnemy(subjectToken, token) ) return false;
        if ( !blockingCfg.allies && CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsAlly(subjectToken, token) ) return false;
      }
    }
    return true;
  }

  static includeToken(token, { blockingCfg = {}, subjectToken, tokensToExclude = NULL_SET }) {
    if ( token === subjectToken || tokensToExclude.has(token) ) return false;
    return this.tokenBlocks(token, subjectToken, blockingCfg);
  }

  includeToken(token) {
    return this.constructor.includeToken(token, {
      blockingCfg: this._config.tokens,
      subjectToken: this.subjectToken,
      tokensToExclude: this.tokensToExclude
    });
  }

  // ---- NOTE: Test ray intersection with obstacles ----- //
  obstacleTester;

  _constructObstacleTester() {
    // Obstacle found should follow the blocking config.
    // Note that obstacles will have NULL_SET if config is not set to block.
    const blocking = this._config;
    const fnNames = [];
    if ( this.obstacles.walls.size ) fnNames.push("wallsOcclude");
    if ( this.obstacles.terrainWalls.size ) fnNames.push("terrainWallsOcclude");
    if ( this.obstacles.proximateWalls.size || this.obstacles.reverseProximateWalls.size ) fnNames.push("proximateWallsOcclude");
    if ( this.obstacles.tiles.size ) fnNames.push("tilesOcclude");
    if ( this.obstacles.tokens.size ) fnNames.push("tokensOcclude");
    if ( this.obstacles.regions.size ) fnNames.push("regionsOcclude");
    this.obstacleTester = this.#occlusionTester(fnNames);
  }

  // see https://nikoheikkila.fi/blog/layman-s-guide-to-higher-order-functions/
  #occlusionTester(fnNames) {
    return function(rayOrigin, rayDirection) {
      return fnNames.some(name => this[name](rayOrigin, rayDirection));
    }
  }

  /** @type {PIXI.Rectangle} */
  #tmpBounds = new AABB2d();

  /**
   * Return canvas placeables that are within a ray.
   * @param {"walls"|"tokens"|"regions"|"tiles"} placeable
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   */
  #placeablesWithinRay(placeable, rayOrigin, rayDirection) {
    using rayEnd = rayOrigin.add(rayDirection);
    const bounds = this.#tmpBounds;
    AABB2d.fromPoints([rayOrigin, rayEnd], bounds);
    return canvas[placeable].quadtree.getObjects(bounds);
  }

  wallsOcclude(rayOrigin, rayDirection) {
    const walls = this.obstacles.walls.intersection(this.#placeablesWithinRay("walls", rayOrigin, rayDirection));
    return walls.some(wall => placeableIntersection(wall, rayOrigin, rayDirection));
  }

  terrainWallsOcclude(rayOrigin, rayDirection) {
    let limitedOcclusion = 0;
    const terrainWalls = this.obstacles.terrainWalls.intersection(this.#placeablesWithinRay("walls", rayOrigin, rayDirection));
    for ( const wall of terrainWalls ) {
      if ( placeableIntersection(wall, rayOrigin, rayDirection) ) continue;
      if ( limitedOcclusion++ ) return true;
    }
    return false;
  }

  proximateWallsOcclude(rayOrigin, rayDirection) {
    const walls = this.#placeablesWithinRay("walls", rayOrigin, rayDirection);
    const proximateWalls = this.obstacles.proximateWalls.intersection(walls);
    const reverseProximateWalls = this.obstacles.reverseProximateWalls.intersection(walls);
    for ( const wall of [...proximateWalls, ...reverseProximateWalls] ) {
      // If the proximity threshold is met, this edge excluded from perception calculations.
      if ( wall.edge.applyThreshold(this._config.senseType, rayOrigin) ) continue;
      if ( placeableIntersection(wall, rayOrigin, rayDirection) ) return true;
    }
    return false;
  }

  tilesOcclude(rayOrigin, rayDirection) {
    const tiles = this.obstacles.tiles.intersection(this.#placeablesWithinRay("tiles", rayOrigin, rayDirection));
    return tiles.some(tile => placeableIntersection(tile, rayOrigin, rayDirection));
  }

  tokensOcclude(rayOrigin, rayDirection) {
    const tokens = this.obstacles.tokens.intersection(this.#placeablesWithinRay("tokens", rayOrigin, rayDirection));
    return tokens.some(token => placeableIntersection(token, rayOrigin, rayDirection));
  }

  regionsOcclude(rayOrigin, rayDirection) {
    const regions = this.obstacles.regions.intersection(this.#placeablesWithinRay("regions", rayOrigin, rayDirection));
    return regions.some(region => placeableIntersection(region, rayOrigin, rayDirection));
  }

  // ----- NOTE: Static methods ----- //

  /**
   * Pull out terrain walls or other wall types from a set of walls.
   * @param {Set<Wall>} walls               Set of walls to divide
   * @param {CONST.WALL_SENSE_TYPES}        What type of wall to pull out
   * @param {string} [senseType="sight"]    Restriction type to test
   * @returns {Set<Wall>}  Modifies walls set *in place* and returns terrain walls.
   */
  static subsetWallsByType(walls, wallType = CONST.WALL_SENSE_TYPES.LIMITED, senseType = "sight") {
    if ( !walls.size ) return NULL_SET;
    const wallSubset = new Set();
    walls
      .filter(w => w.document[senseType] === wallType)
      .forEach(w => {
        walls.delete(w);
        wallSubset.add(w);
      });
    return wallSubset;
  }
}

function placeableIntersection(placeable, rayOrigin, rayDirection) {
  const geom = placeable[GEOMETRY_LIB_ID][GEOMETRY_ID];
  return geom.rayIntersection(rayOrigin, rayDirection);
}

function placeableAABB(placeable) {
  const geom = placeable[GEOMETRY_LIB_ID][GEOMETRY_ID];
  return geom.aabb;
}
