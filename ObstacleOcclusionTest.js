/* globals
canvas,
CONST,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { NULL_SET } from "./util.js";
import { Point3d } from "./3d/Point3d.js";
import { OTHER_MODULES, GEOMETRY_LIB_ID, GEOMETRY_ID } from "./const.js";


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

  #frustumRect = new PIXI.Rectangle();

  get frustum() { return this.#frustum; }

  set frustum(value) {
    this.#frustum = value;
    this.#setFrustumRect();
  }

  #setFrustumRect() {
    const f = this.#frustum;
    if ( f.aabb ) f.aabb.toRectangle(this.#frustumRect);
    else if ( f.getBounds ) this.#frustumRect = f.getBounds();
    else this.#frustumRect = f;
  }

  /** @type {CalculatorConfig} */
  _config = {
    senseType: "sight",
    blocking: {
      walls: true,
      tiles: true,
      regions: true,
      tokens: {
        dead: false,
        live: false,
        prone: false,
      }
    },
  };

  get config() { return structuredClone(this._config); }

  /**
   * Tokens to exclude from the tests. Typically viewer and target.
   * @type {Set<Token>}
   */
  tokensToExclude = new WeakSet();

  /**
   * For multiple tests, the ray origin or viewpoint can be set.
   */
  viewpoint = new Point3d();

  /**
   * Update the obstacles in preparation for ray collision testing.
   * Optionally store the viewpoint (ray origin) and tokens to exclude.
   * @param {object} [opts]
   * @param {Point3d} [viewpoint]             Used for _rayIsOccluded as the starting viewpoint
   * @param {Token[]} [tokensToExclude=[]]    Exclude these tokens from collision testing
   */
  _initialize({ viewpoint, tokensToExclude = [] } = {}) {
    this.tokensToExclude = new WeakSet(tokensToExclude);
    if ( viewpoint ) this.viewpoint.copyFrom(viewpoint);
    this.updateObstacles();
    this.constructObstacleTester();
  }

  /**
   * Test if a ray is occluded.
   * @param {Point3d} start       Start of the segment
   * @param {Point3d} end         End of the segment
   * @param {object} [opts]       Passed to _initialize
   * @returns {boolean} True if collision occurs
   */
  rayIsOccluded(rayOrigin, rayDirection, opts = {}) {
    this._initialize({ viewpoint: rayOrigin, ...opts });
    return this._rayIsOccluded(rayDirection);
  }

  _rayIsOccluded(rayDirection) {
    return this.obstacleTester.call(this, this.rayOrigin, rayDirection);
  }


  updateObstacles() {
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
    if ( !this._config.blocking.walls ) return NULL_SET;
    let walls = canvas.walls.quadtree.getObjects(this.#frustumRect);

    // Specialized exclusion tests
    if ( this.#frustum.aabb ) walls = walls.filter(wall => this.#frustum.aabb.overlapsAABB(wall.GeometryLib.geometry.aabb));
    if ( this.#frustum.overlapsEdge ) walls = walls.filter(wall => this.#frustum.overlapsEdge(wall));
    return walls;
  }

  findBlockingTokens() {
    const tokensCfg = this._config.blocking.tokens;
    if ( !(tokensCfg.dead || tokensCfg.live) ) return NULL_SET;
    let tokens = canvas.tokens.quadtree.getObjects(this.#frustumRect, {
      collisionTest: o => this.includeToken(o.t)
    });

    // Specialized exclusion tests
    if ( this.#frustum.aabb ) tokens = tokens.filter(token => this.#frustum.aabb.overlapsAABB(token.GeometryLib.geometry.aabb));
    if ( this.#frustum.overlapsToken ) tokens = tokens.filter(token => this.#frustum.overlapsToken(token));

    // Module-specific
    const RIDEABLE = OTHER_MODULES.RIDEABLE;
    if ( RIDEABLE ) {
      // Cannot iterate the weak set.
      // This is slower but preserves the weak set.
      // Drop any token with a riding connection to an excluded token.
      for ( const t of canvas.tokens.placeable ) {
        if ( this.tokensToExclude.has(t) ) {
          tokens.filter(token => !RIDEABLE.API.RidingConnection(token, t));
        }
      }
    }
    return tokens;
  }

  findBlockingTiles() {
    if ( !this._config.blocking.tiles ) return NULL_SET;
    let tiles = canvas.tiles.quadtree.getObjects(this.#frustumRect);

    // Specialized exclusion tests
    if ( this.#frustum.aabb ) tiles = tiles.filter(tile => this.#frustum.aabb.overlapsAABB(tile.GeometryLib.geometry.aabb));
    if ( this.#frustum.overlapsTile ) tiles = tiles.filter(tile => this.#frustum.overlapsTile(tile));
    return tiles;
  }

  findBlockingRegions() {
    if ( !this._config.blocking.regions ) return NULL_SET;
    let regions = canvas.regions.placeables; // No quadtree for regions.

    // Specialized exclusion tests
    if ( this.#frustum.aabb ) regions = regions.filter(region => this.#frustum.aabb.overlapsAABB(region.GeometryLib.geometry.aabb));
    if ( this.#frustum.overlapsToken ) regions = regions.filter(region => this.#frustum.overlapsRegion(region));
    return regions;
  }

  includeToken(token) {
    if ( this.tokensToExclude.has(token) ) return false;
    if ( this._config.blocking.tokens.dead && CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsDead(token) ) return true;
    if ( this._config.blocking.tokens.live && CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsAlive(token) ) return true;
    if ( this._config.blocking.tokens.prone && token.isProne ) return true;
    return false;
  }

  // ---- NOTE: Test ray intersection with obstacles ----- //
  obstacleTester;

  constructObstacleTester() {
    // Obstacle found should follow the blocking config.
    const blocking = this._config.blocking;
    const fnNames = [];
    if ( blocking.walls ) fnNames.push("wallsOcclude", "terrainWallsOcclude", "proximateWallsOcclude");
    if ( blocking.tiles ) fnNames.push("tilesOcclude");
    if ( blocking.tokens.dead || blocking.tokens.live ) fnNames.push("tokensOcclude");
    if ( blocking.regions ) fnNames.push("regionsOcclude");
    this.obstacleTester = this.#occlusionTester(fnNames);
  }

  // see https://nikoheikkila.fi/blog/layman-s-guide-to-higher-order-functions/
  #occlusionTester(fnNames) {
    return function(rayOrigin, rayDirection) {
      return fnNames.some(name => this[name](rayOrigin, rayDirection))
    }
  }

  wallsOcclude(rayOrigin, rayDirection) {
    return this.obstacles.walls.some(wall => wall[GEOMETRY_LIB_ID][GEOMETRY_ID].rayIntersection(rayOrigin, rayDirection, 0, 1) !== null);
  }

  terrainWallsOcclude(rayOrigin, rayDirection) {
    // console.debug(`rayOrigin ${rayOrigin}, rayDirection ${rayDirection} for ${this.obstacles.terrainWalls.size} terrain walls.`);
    let limitedOcclusion = 0;
    for ( const wall of this.obstacles.terrainWalls ) {
      if ( wall[GEOMETRY_LIB_ID][GEOMETRY_ID].rayIntersection(rayOrigin, rayDirection, 0, 1) === null ) continue;
      if ( limitedOcclusion++ ) return true;
    }
    return false;
  }

  proximateWallsOcclude(rayOrigin, rayDirection) {
    for ( const wall of [...this.obstacles.proximateWalls, ...this.obstacles.reverseProximateWalls] ) {
      // If the proximity threshold is met, this edge excluded from perception calculations.
      if ( wall.edge.applyThreshold(this._config.senseType, rayOrigin) ) continue;
      if ( wall[GEOMETRY_LIB_ID][GEOMETRY_ID].rayIntersection(rayOrigin, rayDirection, 0, 1) !== null ) return true;
    }
    return false;
  }

  tilesOcclude(rayOrigin, rayDirection) {
    return this.obstacles.tiles.some(tile => tile[GEOMETRY_LIB_ID][GEOMETRY_ID].rayIntersection(rayOrigin, rayDirection, 0, 1));
  }

  tokensOcclude(rayOrigin, rayDirection) {
    return this.obstacles.tokens.some(token => token[GEOMETRY_LIB_ID][GEOMETRY_ID].rayIntersection(rayOrigin, rayDirection, 0, 1));
  }

  regionsOcclude(rayOrigin, rayDirection) {
    return this.obstacles.regions.some(region => region[GEOMETRY_LIB_ID][GEOMETRY_ID].rayIntersection(rayOrigin, rayDirection, 0, 1));
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
