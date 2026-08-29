/* globals
canvas,
CONST,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { NULL_SET } from "./util.js";
import { OTHER_MODULES } from "./const.js";
import { AABB3d } from "./3d/AABB3d.js";
import { Draw } from "./Draw.js";
import { Point3d } from "./3d/Point3d.js";

const tmpPt1 = new Point3d();

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

  static OBSTACLE_KEYS = new Set([
    "tiles",
    "tokens",
    "regions",
    "walls",
    "terrainWalls",
    "proximateWalls",
    "reverseProximateWalls",
    "foregroundLevels",
    "backgroundLevels",
  ]);

  /**
   * @param {object} [opts]
   * @param {CONST.WALL_RESTRICTION_TYPES} [opts.senseType]   If provided, will return early if geometry does not block this sense type.
   * @param {string} [opts.levelId]                           If provided, will return early if geometry does not affect this level.
   * @yields {GeometricPrimitive}
   */
  *iterateObstacleShapes({ geomSubtype = "full", ...opts } = {}) {
    for ( const geom of this.iterateObstacleGeoms(opts) ) {
      if ( geom.constructor.HAS_SUBTYPES ) yield* geom[geomSubtype].shapes;
      else yield* geom.iterateShapes();
    }
  }

  /**
   * @param {object} [opts]
   * @param {CONST.WALL_RESTRICTION_TYPES} [opts.senseType]   If provided, will return early if geometry does not block this sense type.
   * @param {string} [opts.levelId]                           If provided, will return early if geometry does not affect this level.
   * @yields {Polygon3d}
   */
  *iterateObstacleFaces({ geomSubtype = "full", ...opts } = {}) {
    for ( const geom of this.iterateObstacleGeoms(opts) ) {
      if ( geom.constructor.HAS_SUBTYPES ) yield* geom[geomSubtype].iterateFaces();
      else yield* geom.iterateFaces();
    }
  }

  /**
   * @param {object} [opts]
   * @param {CONST.WALL_RESTRICTION_TYPES} [opts.senseType]   If provided, will return early if geometry does not block this sense type.
   * @param {string} [opts.levelId]                           If provided, will return early if geometry does not affect this level.
   * @yields {PlaceableGeometry}
   */
  *iterateObstacleGeoms({ includeObstacles = this.constructor.OBSTACLE_KEYS } = {}) {
    for ( const key of includeObstacles ) {
      const geoms = this.obstacleGeometries[key] || [];
      yield* geoms;
    }
  }

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
   * @prop {CONST.WALL_RESTRICTION_TYPES} senseType
   * @prop {boolean} walls        True if walls block
   * @prop {boolean} tiles        True if tiles block
   * @prop {boolean} regions      True if regions block
   * @prop {object} levels
   * - @prop {boolean} background   True if level background texture blocks
   * - @prop {boolean} foreground   True if level foreground texture blocks
   * @prop {TokenBlockingConfig} tokens     Token-specific blocking settings
   * @prop {object} filters         Optional filters to further restrict what obstacles block.
   * - @prop {function[]} regions
   * - @prop {function[]} tiles
   * - @prop {function[]} tokens
   * - @prop {function[]} walls
   */

  /** @type {BlockingConfig} */
  config = {
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

    // Optional filters.
    filters: {
      regions: [],
      tiles: [],
      tokens: [],
      walls: [],
      levels: [],
    },
  };

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
    const s = new Set(thisLevel.visibility.levels); // Clone the set so we can modify it.
    s.add(thisLevel.id);
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
  initialize({ subjectToken, tokensToExclude, levelId } = {}) {
    // Set privately and then trigger full update.
    if ( levelId ) this.levelId = levelId;
    if ( subjectToken ) this.#subjectToken = subjectToken.document ? subjectToken.document : subjectToken;
    if ( tokensToExclude ) this.#tokensToExclude = new WeakSet(tokensToExclude.map(t => t.document ? t.document : t));
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

  /**
   * Helper to test if a segment is occluded.
   * @param {Point3d} rayOrigin       Start of the ray
   * @param {Point3d} rayEnd          End of the ray
   * @returns {boolean} True if collision occurs
   */
  #rayDirection = new Point3d();

  segmentIsOccluded(rayOrigin, rayEnd) {
    rayEnd.subtract(rayOrigin, this.#rayDirection);
    return this.rayIsOccluded(rayOrigin, this.#rayDirection);
  }

  update() {
    if ( !canvas.ready ) return;
    if ( this.frustum ) this.frustum.aabb.clone(this.#aabb);
    this._updateObstacles();
    this._constructObstacleTester();
  }

  _updateObstacles() {
    const senseType = this.config.senseType;
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
  #filterDocGeometries(mgr, obstacleKey, collisionOpts = {}) {
    collisionOpts.senseType ??= this.config.senseType;
    collisionOpts.levelId ??= this.levelId;

    // Add in custom filters as appropriate, to the collision test.
    const customFilters = this.config.filters?.[obstacleKey] || [];
    const collisionTest = customFilters.length
      ? o => {
        if ( !o.t.constructor.couldBlock(o.t.placeableDocument, collisionOpts) ) return false;
        return customFilters.every(fn => fn(o.t.placeableDocument));
      }
      : o => o.t.constructor.couldBlock(o.t.placeableDocument, collisionOpts);

    // Get the geometries from the quadtree.
    const geoms = mgr.quadtree.getObjects(this.aabb, { collisionTest });
    if ( this.frustum ) {
      switch ( obstacleKey ) {
        case "levels":
        case "tiles": return geoms.filter(geom => {
          if ( geom.alphaBlockingType === "ignore" ) return false;
          return this.#frustum.overlapsGeometry(geom.boundarySubtype);
        });

        case "tokens": return geoms.filter(geom => this.#frustum.overlapsGeometry(geom.boundarySubtype));

        default: return geoms.filter(geom => this.#frustum.overlapsGeometry(geom));
      }
    }
    return geoms;
  }

  /**
   * @returns {Set<WallDocument>}
   */
  findBlockingWalls() {
    if ( !this.config.walls ) return NULL_SET;
    return this.#filterDocGeometries(CONFIG.GeometryLib.geometryManager.walls, "walls");
  }

  /**
   * @returns {Set<TokenDocument>}
   */
  findBlockingTokens() {
    const tokensCfg = this.config.tokens;
    if ( !(tokensCfg.dead || tokensCfg.live) ) return NULL_SET;

    // Temporarily add filters.
    const tokenFilters = this.config.filters.tokens;
    const RIDEABLE = OTHER_MODULES.RIDEABLE;
    tokenFilters.push(this.#filterExcludedToken.bind(this));
    if ( RIDEABLE ) tokenFilters.push(this.#filterRidingToken.bind(this));

    const blockingCfg = this.config.tokens;
    const subjectToken = this.subjectToken;
    const tokenGeoms = this.#filterDocGeometries(CONFIG.GeometryLib.geometryManager.tokens, "tokens", { subjectToken, ...blockingCfg });

    // Remove the temporary filters.
    if ( RIDEABLE ) tokenFilters.pop();
    tokenFilters.pop();

    return tokenGeoms;
  }

  #filterExcludedToken(tokenD) {
    return !(this.subjectToken === tokenD || this.tokensToExclude.has(tokenD));
  }

  #filterRidingToken(tokenD) {
    // Assumes Rideable module is active, for performance.
    // Drop any token with a riding connection to an excluded token.
    const RIDEABLE = OTHER_MODULES.RIDEABLE;
    const ridingToken = tokenD.object;
    if ( !ridingToken ) return true;
    for ( const token of canvas.tokens.placeables ) {
      const tDoc = token.document;
      if ( this.subjectToken === tDoc
        || this.tokensToExclude.has(tDoc) ) return !(ridingToken && RIDEABLE.API.RidingConnection(ridingToken, token))
    }
    return true;
  }

  /**
   * @returns {Set<TileDocument>}
   */
  findBlockingTiles() {
    if ( !this.config.tiles ) return NULL_SET;
    return this.#filterDocGeometries(CONFIG.GeometryLib.geometryManager.tiles, "tiles");
  }

  /**
   * @returns {Set<RegionDocument>}
   */
  findBlockingRegions() {
    if ( !this.config.regions || !canvas.regions.placeables.length ) return NULL_SET;
    return this.#filterDocGeometries(CONFIG.GeometryLib.geometryManager.regions, "regions");
  }

  /**
   * @param {"foreground"|"background"} [levelType="background"]      For Level docs, foreground or background texture?
   * @returns {Set<Level>}
   */
  findBlockingLevels(levelType = "background") {
    return this.#filterDocGeometries(CONFIG.GeometryLib.geometryManager.levels[levelType], "levels")
      .filter(geom => geom.level[levelType].src); // Must have a defined texture.
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
    const rayEnd = rayOrigin.add(rayDirection, tmpPt1);
    return geoms.some(geom => this.#geomWithinRayBounds(geom, rayOrigin, rayEnd)
      && geom.rayIntersection(rayOrigin, rayDirection));
  }

  #subGeometriesOcclude(geoms, rayOrigin, rayDirection, geomSubtype = "full") {
    const rayEnd = rayOrigin.add(rayDirection, tmpPt1);
    return geoms.some(geom => this.#geomWithinRayBounds(geom, rayOrigin, rayEnd)
      && geom[geomSubtype].rayIntersection(rayOrigin, rayDirection));
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
    const rayEnd = rayOrigin.add(rayDirection, tmpPt1);
    const geoms = geoms.filter(geom => this.#geomWithinRayBounds(geom, rayOrigin, rayEnd));
    for ( const geom of geoms ) {
      if ( !geom.rayIntersection(rayOrigin, rayDirection) ) continue;
      if ( limitedOcclusion++ ) return true;
    }
    return false;
  }

  proximateWallsOcclude(rayOrigin, rayDirection) {
    const rayEnd = rayOrigin.add(rayDirection, tmpPt1);
    const geoms = [
      ...this.obstacleGeometries.proximateWalls,
      ...this.obstacleGeometries.reverseProximateWalls
    ];
    for ( const geom of geoms ) {
      if ( !this.#geomWithinRayBounds(geom, rayOrigin, rayEnd) ) continue;

      // If the proximity threshold is met, this edge excluded from perception calculations.
      if ( geom.edge.applyThreshold(this.config.senseType, rayOrigin) ) continue;

      // If an intersection is found, we can stop.
      if ( geom.rayIntersection(rayOrigin, rayDirection) ) return true;

    }
    return false;
  }

  /**
   * Does a tile occlude this ray?
   * @param {Pointd} rayOrigin
   * @param {Point3d}  rayDirection
   * @param {"full"|"boundingRect"|"boundingPolygon"|"polygons"|"triangles"} [ixType="full"]
   * @returns {boolean}
   */
  tilesOcclude(rayOrigin, rayDirection, geomSubtype = "full") {
    return this.#subGeometriesOcclude(this.obstacleGeometries.tiles, rayOrigin, rayDirection, geomSubtype);
  }

  /**
   * Does a token occlude this ray?
   * @param {Pointd} rayOrigin
   * @param {Point3d}  rayDirection
   * @param {"full"|"constrained"|"lit"|"bright"} [ixType="constrained"]
   * @returns {boolean}
   */
  tokensOcclude(rayOrigin, rayDirection, geomSubtype = "constrained") {
    return this.#subGeometriesOcclude(this.obstacleGeometries.tokens, rayOrigin, rayDirection, geomSubtype);
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
    const drawOpts = { draw, width: 0, fill: Draw.COLORS.yellow, fillAlpha: 0.1 }
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
  _drawDetectedObjects(draw, { tileSubtype = "boundarySubtype", tokenSubtype = "full", levelSubtype = "boundarySubtype" } = {}) {
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
      switch ( key ) {
        case "tiles": obstacleGeoms.forEach(geom => geom[tileSubtype].draw2d(drawOpts)); break;
        case "levels": obstacleGeoms.forEach(geom => geom[levelSubtype].draw2d(drawOpts)); break;
        case "tokens": obstacleGeoms.forEach(geom => geom[tokenSubtype].draw2d(drawOpts)); break;
        default: obstacleGeoms.forEach(geom => geom.draw2d(drawOpts));
      }
    }
  }
}
