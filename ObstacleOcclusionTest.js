/* globals
canvas,
CONST,
CONFIG,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { NULL_SET } from "./util.js";
import { OTHER_MODULES, GEOMETRY_LIB_ID } from "./const.js";
import { AABB3d } from "./3d/AABB3d.js";
import { Draw } from "./Draw.js";

/**
 * An instance that, for a given configuration, tracks potential obstacles.
 * Config handles what is blocking and what sense type is used.
 * The viewing shape can also be set.
 * Store temporary sets of placeable objects within the viewing shape.
 */
export class ObstacleOcclusionTest {
  obstacleGeometries = {
    tiles: NULL_SET,
    tokens: NULL_SET,
    regions: NULL_SET,
    walls: NULL_SET,
    terrainWalls: NULL_SET,
    proximateWalls: NULL_SET,
    reverseProximateWalls: NULL_SET,
    foregroundLevels: NULL_SET,
    backgroundLevels: NULL_SET,
  };

  /**
   * Further restrict the universe of placeables to test.
   * @type {Frustum}
   */
  #frustum;

  #aabb = new AABB3d();

  get aabb() { return this.#frustum?.aabb || this.#aabb; }

  // Note that this removes the frustum.
  setBoundsFromShape(shape, z) {
    AABB3d.fromShape(shape, z, this.#aabb);
    this.#frustum = null;
    this.update();
  }

  get frustum() { return this.#frustum; }

  set frustum(value) {
    this.#frustum = value;
    this.update();
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
   * @prop {object} levels
   * - @prop {boolean} background   True if level background texture blocks
   * - @prop {boolean} foreground   True if level foreground texture blocks
   * @prop {TokenBlockingConfig} tokens     Token-specific blocking settings
   */

  /** @type {BlockingConfig} */
  _config = {
    senseType: "sight",
    walls: true,
    tiles: true,
    regions: true,
    levels: {
      background: true,
      foreground: true,
    },
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
    if ( value.document ) value = value.document;
    this.#subjectToken = value;
    this.obstacleGeometries.tokens = this.findBlockingTokens();
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
      this.#tokensToExclude = new WeakSet(tokens.map(t => t.document ? t.document : t));
    }
    this.obstacleGeometries.tokens = this.findBlockingTokens();
  }

  /**
   * Level of the ray origin.
   * Used to exclude objects that cannot be viewed from this level.
   * @type {string}
   */
  levelId = "";

  /**
   * Set of level ids that can be seen from this level, including this one.
   * @type {Set<string>}
   */
  get validLevels() {
    const thisLevel = canvas.scene.levels.get(this.levelId);
    if ( !thisLevel ) return new Set(canvas.scene.levels.keys()); // Default to all levels.
    const s = Set(thisLevel.visibility.levels); // Clone the set so we can modify it.
    s.add(thisLevel);
    return s;
  }

  /**
   * Inverse of validLevels: level ids that cannot be seen from this level.
   * @type {Set<string>}
   */
  get invalidLevels() {
    const validLevels = this.validLevels;
    const allLevels = new Set(canvas.scene.levels.keys());
    return allLevels.difference(validLevels);
  }

  /**
   * Update the obstacles in preparation for ray collision testing.
   * Optionally store the viewpoint (ray origin) and tokens to exclude.
   * @param {object} [opts]
   * @param {Token[]} [opts.tokensToExclude]  Tokens to exclude; must be an array of Tokens or empty array.
   * @param {Point3d} [viewpoint]             Used for _rayIsOccluded as the starting viewpoint
   * @param {Token[]} [tokensToExclude=[]]    Exclude these tokens from collision testing
   */
  initialize({ subjectToken, tokensToExclude, levelId, ...cfg } = {}) {
    // Set privately and then trigger full update.
    if ( levelId ) this.levelId = levelId;
    if ( subjectToken ) this.#subjectToken = subjectToken.document ? subjectToken.document : subjectToken;
    if ( tokensToExclude ) this.#tokensToExclude = new WeakSet(tokensToExclude.map(t => t.document ? t.document : t));
    this.config = cfg; // Even if empty, trigger this.constructObstacleTester() via config setter;
  }

  /**
   * Test if a ray is occluded.
   * @param {Point3d} rayOrigin       Start of the ray
   * @param {Point3d} rayDirection    Direction of the ray
   * @returns {boolean} True if collision occurs
   */
  rayIsOccluded(rayOrigin, rayDirection, levelId) {
    if ( levelId ) this.levelId = levelId;
    return this.obstacleTester.call(this, rayOrigin, rayDirection, { });
  }

  update() {
    if ( !canvas.ready ) return;
    if ( this.frustum ) this.frustum.aabb.clone(this.#aabb);
    this._updateObstacles();
    this._constructObstacleTester();
  }

  _updateObstacles() {
    const senseType = this._config.senseType;
    this.obstacleGeometries.tiles = this.findBlockingTiles();
    this.obstacleGeometries.tokens = this.findBlockingTokens();
    this.obstacleGeometries.regions = this.findBlockingRegions();
    this.obstacleGeometries.walls = this.findBlockingWalls();
    this.obstacleGeometries.terrainWalls = this.constructor.subsetWallsByType(this.obstacleGeometries.walls, CONST.EDGE_SENSE_TYPES.LIMITED, senseType);
    this.obstacleGeometries.proximateWalls = this.constructor.subsetWallsByType(this.obstacleGeometries.walls, CONST.EDGE_SENSE_TYPES.PROXIMITY, senseType);
    this.obstacleGeometries.reverseProximateWalls = this.constructor.subsetWallsByType(this.obstacleGeometries.walls, CONST.EDGE_SENSE_TYPES.DISTANCE, senseType);
    this.obstacleGeometries.foregroundLevels = this.findBlockingLevels("foreground");
    this.obstacleGeometries.backgroundLevels = this.findBlockingLevels("background");
  }

  // ----- NOTE: Filter potential obstacles ----- //

  /*
    FindBlocking filters placeable documents by AABB, frustum (if present), and any document-specific tests.
    Does not filter based on level; that is left to the occlusion tests.
    (Particularly relevant for regions and walls, which have more nuanced level tests based on geometry.)
  */

  /**
   * Helper to get placeable docs within bounds, filter by the 3d aabb, and filter by frustum.
   */
  #filterDocGeometries(mgr, opts) {
    const geoms = mgr.quadtree.getObjects(this.aabb, opts);
    if ( this.frustum ) return geoms.filter(geom => this.#frustum.overlapsGeometry(geom));
    return geoms;
  }

  /**
   * @returns {Set<WallDocument>}
   */
  findBlockingWalls() {
    if ( !this._config.walls ) return NULL_SET;

    // Drop non-blocking walls for this sense type.
    const collisionTest = o => o.t.placeableDocument[this._config.senseType];
    return this.#filterDocGeometries(CONFIG.GeometryLib.geometryManager.walls, { collisionTest });
  }

  /**
   * @returns {Set<TokenDocument>}
   */
  findBlockingTokens() {
    const tokensCfg = this._config.tokens;
    if ( !(tokensCfg.dead || tokensCfg.live) ) return NULL_SET;

    const validLevels = this.validLevels;
    const collisionTest = o => validLevels.has(o.t.placeableDocument.level) && this.includeToken(o.t.placeableDocument);
    let tokenGeoms = this.#filterDocGeometries(CONFIG.GeometryLib.geometryManager.tokens, { collisionTest });

    // Filter out the subject token and other tokens to exclude (such as the target).
    tokenGeoms = tokenGeoms.filter(geom => !(this.subjectToken === geom.placeableDocument || this.tokensToExclude.has(geom.placeableDocument)));

    // Module-specific
    const RIDEABLE = OTHER_MODULES.RIDEABLE;
    if ( RIDEABLE ) {
      // Cannot iterate the weak set.
      // This is slower but preserves the weak set.
      // Drop any token with a riding connection to an excluded token.
      for ( const tDoc of canvas.scene.tokens ) {
        if ( !tDoc.object ) continue;
        if ( this.subjectToken === tDoc || this.tokensToExclude.has(tDoc) ) {
          tokenGeoms = tokenGeoms.filter(tokenGeom => !(tokenGeom.token && RIDEABLE.API.RidingConnection(tokenGeom.token, tDoc.object)));
        }
      }
    }
    return tokenGeoms;
  }

  /**
   * @returns {Set<TileDocument>}
   */
  findBlockingTiles() {
    if ( !this._config.tiles ) return NULL_SET;
    const validLevels = this.validLevels;
    const collisionTest = o => o.t.placeableDocument.levels.intersects(validLevels);
    return this.#filterDocGeometries(CONFIG.GeometryLib.geometryManager.tiles, { collisionTest });
  }

  /**
   * @returns {Set<RegionDocument>}
   */
  findBlockingRegions() {
    if ( !this._config.regions || !canvas.regions.placeables.length ) return NULL_SET;
    return this.#filterDocGeometries(CONFIG.GeometryLib.geometryManager.regions);
  }

  /**
   * @param {"foreground"|"background"} [levelType="background"]      For Level docs, foreground or background texture?
   * @returns {Set<Level>}
   */
  findBlockingLevels(levelType = "background") {
    const validLevels = this.validLevels;
    const collisionTest = o => validLevels.has(o.t.placeableDocument.id);
    return this.#filterDocGeometries(CONFIG.GeometryLib.geometryManager.levels[levelType], { collisionTest })
      .filter(geom => geom.level[levelType].src); // Must have a defined texture.
  }

  /**
   * Does the token block with respect to a movement token?
   * @param {TokenDocument} tokenD           Token to test for whether it could block
   * @param {TokenDocument} [subjectTokenD]       Token doing the movement or viewing
   * @param {TokenBlockingConfig} blockingCfg
   * @returns {boolean}
   */
  static tokenBlocks(tokenD, subjectTokenD, blockingCfg = {}) {
    if ( tokenD.document ) tokenD = tokenD.document;
    if ( subjectTokenD.document ) subjectTokenD = subjectTokenD.document;

    // Hidden tokens don't block.
    if ( tokenD.hidden ) return false;

    // Don't block self. Note this is ignored if no subject token.
    if ( subjectTokenD === tokenD ) return false;

    // Exclude certain token statuses.
    blockingCfg.excludedStatuses ??= NULL_SET;
    if ( tokenD.actor
      && tokenD.actor.statuses.intersects(blockingCfg.excludedStatuses) ) return false;

    // Tests for dead tokens.
    if ( !blockingCfg.dead && CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsDead(tokenD) ) return false;

    // Tests for live tokens.
    if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsAlive(tokenD) ) {
      if ( !blockingCfg.live ) return false;
      if ( !blockingCfg.prone && tokenD.isProne ) return false;

      // Compare disposition to subject token.
      if ( subjectTokenD ) {
        if ( !blockingCfg.enemies && CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsEnemy(subjectTokenD, tokenD) ) return false;
        if ( !blockingCfg.allies && CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsAlly(subjectTokenD, tokenD) ) return false;
      }
    }
    return true;
  }

  static includeToken(tokenD, { blockingCfg = {}, subjectToken, tokensToExclude = NULL_SET }) {
    if ( subjectToken && subjectToken.document ) subjectToken = subjectToken.document;
    if ( tokenD === subjectToken || tokensToExclude.has(tokenD) ) return false;
    return this.tokenBlocks(tokenD, subjectToken, blockingCfg);
  }

  includeToken(tokenD) {
    return this.constructor.includeToken(tokenD, {
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
    const fnNames = [];
    if ( this.obstacleGeometries.walls.size ) fnNames.push("wallsOcclude");
    if ( this.obstacleGeometries.terrainWalls.size ) fnNames.push("terrainWallsOcclude");
    if ( this.obstacleGeometries.proximateWalls.size
      || this.obstacleGeometries.reverseProximateWalls.size ) fnNames.push("proximateWallsOcclude");
    if ( this.obstacleGeometries.tiles.size ) fnNames.push("tilesOcclude");
    if ( this.obstacleGeometries.tokens.size ) fnNames.push("tokensOcclude");
    if ( this.obstacleGeometries.regions.size ) fnNames.push("regionsOcclude");
    if ( this.obstacleGeometries.foregroundLevels.size ) fnNames.push("foregroundLevelsOcclude");
    if ( this.obstacleGeometries.backgroundLevels.size ) fnNames.push("backgroundLevelsOcclude");
    this.obstacleTester = this.#occlusionTester(fnNames);
  }

  // see https://nikoheikkila.fi/blog/layman-s-guide-to-higher-order-functions/
  #occlusionTester(fnNames) {
    return function(rayOrigin, rayDirection, collisionTest) {
      return fnNames.some(name => this[name](rayOrigin, rayDirection, collisionTest));
    }
  }

  /** @type {PIXI.Rectangle} */
  #tmpBounds = new AABB3d();

  /**
   * Determine if a geometry is within a ray
   * @param {PlaceableGeometry} geom
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayEnd
   * @returns {boolean}
   */
  #geomWithinRayBounds(geom, rayOrigin, rayEnd) {
    const bounds = this.#tmpBounds;
    AABB3d.fromPoints([rayOrigin, rayEnd], bounds);
    return geom.aabb.overlapsAABB(bounds) && bounds.overlapsAABB(geom.aabb);
  }

  /**
   * Determine if a set of geometries occlude a given ray.
   * @param {Set<PlaceableGeometry>} geoms
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @returns {boolean}
   */
  #geometriesOcclude(geoms, rayOrigin, rayDirection) {
    using rayEnd = rayOrigin.add(rayDirection);
    const opts = { levelId: this.levelId };
    return geoms.some(geom => this.#geomWithinRayBounds(geom, rayOrigin, rayEnd)
      && geom.rayIntersection(rayOrigin, rayDirection, opts));
  }

  /**
   * Do the wall geometry obstacles occlude this ray?
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @returns {boolean}
   */
  wallsOcclude(rayOrigin, rayDirection) {
    return this.#geometriesOcclude(this.obstacleGeometries.walls, rayOrigin, rayDirection);
  }

  terrainWallsOcclude(rayOrigin, rayDirection) {
    let limitedOcclusion = 0;
    using rayEnd = rayOrigin.add(rayDirection);
    const geoms = geoms.filter(geom => this.#geomWithinRayBounds(geom, rayOrigin, rayEnd));
    const opts = { ignoreLevelIds: this.invalidLevels };
    for ( const geom of geoms ) {
      if ( !geom.rayIntersection(rayOrigin, rayDirection, opts) ) continue;
      if ( limitedOcclusion++ ) return true;
    }
    return false;
  }

  proximateWallsOcclude(rayOrigin, rayDirection) {
    using rayEnd = rayOrigin.add(rayDirection);
    const geoms = [
      ...this.obstacleGeometries.proximateWalls,
      ...this.obstacleGeometries.reverseProximateWalls
    ];
    const opts = { ignoreLevelIds: this.invalidLevels };
    for ( const geom of geoms ) {
      if ( !this.#geomWithinRayBounds(geom, rayOrigin, rayEnd) ) continue;

      // If the proximity threshold is met, this edge excluded from perception calculations.
      if ( geom.edge.applyThreshold(this._config.senseType, rayOrigin) ) continue;

      // If an intersection is found, we can stop.
      if ( geom.rayIntersection(rayOrigin, rayDirection, opts) ) return true;

    }
    return false;
  }

  tilesOcclude(rayOrigin, rayDirection) {
    return this.#geometriesOcclude(this.obstacleGeometries.tiles, rayOrigin, rayDirection);
  }

  tokensOcclude(rayOrigin, rayDirection) {
    return this.#geometriesOcclude(this.obstacleGeometries.tokens, rayOrigin, rayDirection);
  }

  regionsOcclude(rayOrigin, rayDirection) {
    return this.#geometriesOcclude(this.obstacleGeometries.regions, rayOrigin, rayDirection);
  }

  foregroundLevelsOcclude(rayOrigin, rayDirection) {
    return this.#geometriesOcclude(this.obstacleGeometries.foregroundLevels, rayOrigin, rayDirection);
  }

  backgroundLevelsOcclude(rayOrigin, rayDirection) {
    return this.#geometriesOcclude(this.obstacleGeometries.backgroundLevels, rayOrigin, rayDirection);
  }

  // ----- NOTE: Static methods ----- //

  /**
   * Pull out terrain walls or other wall types from a set of walls.
   * @param {Set<WallGeometry>} wallGeoms               Set of wall geomeries to divide
   * @param {CONST.EDGE_SENSE_TYPES}        What type of wall to pull out
   * @param {string} [senseType="sight"]    Restriction type to test
   * @returns {Set<Wall>}  Modifies walls set *in place* and returns terrain walls.
   */
  static subsetWallsByType(wallGeoms, wallType = CONST.EDGE_SENSE_TYPES.LIMITED, senseType = "sight") {
    if ( !wallGeoms.size ) return NULL_SET;
    const wallSubset = new Set();
    wallGeoms
      .filter(geom => geom.placeableDocument[senseType] === wallType)
      .forEach(geom => {
        wallGeoms.delete(geom);
        wallSubset.add(geom);
      });
    return wallSubset;
  }

  // ----- NOTE: Debug ----- //

  _drawFrustum(draw) {
    if ( !this.frustum ) return;
    const drawOpts = { draw, width: 0, fill: Draw.COLORS.gray, fillAlpha: 0.1 }
    if ( this.frustum.draw2d ) this.frustum.draw2d(drawOpts);
    else {
      draw ??= Draw;
      draw.shape(this.frustum, drawOpts);
    }
  }

/**
   * For debugging.
   * Draw outlines for the various objects that can be detected on the canvas.
   */
  _drawDetectedObjects(draw) {
    const colors = Draw.COLORS;
    const OBSTACLE_COLORS = {
      walls: colors.lightred,
      terrainWalls: colors.lightgreen,
      proximateWalls: colors.lightblue,
      tiles: colors.yellow,
      tokens: colors.orange,
      regions: colors.red,
      foregroundLevels: colors.LIGHT.orange,
      backgroundLevels: colors.DARK.orange,
    }
    for ( const [key, obstacleGeoms] of Object.entries(this.obstacleGeometries) ) {
      const color = OBSTACLE_COLORS[key];
      const drawOpts = { draw, color, fillAlpha: 0.1, fill: color };
      obstacleGeoms.forEach(geom => geom.draw2d(drawOpts));
    }
  }
}
