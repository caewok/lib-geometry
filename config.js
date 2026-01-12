/* globals
CONFIG,
CONST,
foundry,
*/
"use strict";

import { GEOMETRY_LIB_ID, VERSION } from "./const.js";

// LibGeometry
import { getObjectProperty } from "./util.js";
import { ClipperPaths } from "./ClipperPaths.js";
import { Clipper2Paths } from "./Clipper2Paths.js";

const ELEVATION_CONFIG = {
  /**
   * What status id indicates a prone token.
   * @param {string}
   */
  proneStatusId: "prone",

  /**
   * How much does the prone status decrease token height, as a percentage of total height?
   * Should be between 0 and 1.
   * @param {number}
   */
  proneMultiplier: 0.33,

  /**
   * How high is the token's vision/eye(s), as a percentage of total height?
   * @param {number}
   */
  visionHeightMultiplier: 1,
};

const TILECACHE_CONFIG = {
  /**
   * What resolution to store the tile pixel cache.
   * @type {number}
   */
  pixelCacheResolution: 1,
};

const PLACEABLE_TRACKING_CONFIG = {
  /**
   * When constructing a region geometry, whether to include walls that are interior to the region.
   * E.g., when two shapes that form a region overlap.
   * @type {boolean}
   */
  allowInteriorWalls: true,

  /**
   * Limit the tile alpha pixels by contiguous area.
   * Limits when a portion of the tile is considered an obstacle.
   * For points or geometric algorithm, this will not be considered blocking.
   * @type {number}
   */
  alphaAreaThreshold: 25, // Area in pixels, e.g. 5x5 or ~ 8 x 3


  /**
   * The percent threshold under which a tile should be considered transparent at that pixel.
   * @type {number}
   */
  // alphaThreshold: 0.75, // Now set in tile.document.texture.alphaThreshold.

  /**
   * Which clipper version to use: 1 or 2.
   */
  clipperVersion: 1,

  /**
   * Whether to constrain token shapes that overlap walls.
   * When enabled, reshape the token border to fit within the overlapping walls (based on token center).
   * Performance-intensive for custom token shapes. Used for obstructing tokens and target tokens.
   * @type {boolean}
   */
  constrainTokens: false,

  /**
   * Spacing between points for the per-pixel calculator.
   * The per-pixel calculator tests a point lattice on the token shape to determine visibility.
   * Larger spacing means fewer points and better performance, sacrificing resolution.
   * @type {number} In pixel units
   */
  perPixelSpacing: 10,


  /**
   * Use the alpha polygon threshold when creating tile faces.
   * Otherwise uses a rectangle.
   * @type {boolean}
   */
  useAlphaPolygonBounds: false,

  /**
   * Use a token sphere for the token shape. Overrides all other shape choices.
   * @type {boolean}
   */
  useTokenSphere: false,

  /**
   * Always use the chosen token shape in the token config.
   * If false, will use the grid shape or for gridless, will use either rectangle or ellipse.
   */
  useChosenTokenShape: false,

  version: VERSION,
};

const OBSTACLE_TEST_CONFIG = {
  /**
   * Function to determine if a token is alive.
   * @type {function}
   * @param {Token} token
   * @returns {boolean} True if alive.
   */
  tokenIsAlive,

  /**
   * Function to determine if a token is dead
   * @type {function}
   * @param {Token} token
   * @returns {boolean} True if dead.
   */
  tokenIsDead,

  /**
   * Function to determine if token is enemy in relation to another.
   * @type {function}
   * @param {Token} subjectToken
   * @param {Token} testToken
   * @returns {boolean} True if test token is enemy of subject token, from perspective of subject token.
   */
  tokenIsEnemy,

  /**
   * Function to determine if token is ally in relation to another.
   * @type {function}
   * @param {Token} subjectToken
   * @param {Token} testToken
   * @returns {boolean} True if test token is ally of subject token, from perspective of subject token.
   */
  tokenIsAlly,

}


export function mergeConfigs(maxVersion = VERSION) {
  const thisConfig = { ...ELEVATION_CONFIG, ...TILECACHE_CONFIG, ...PLACEABLE_TRACKING_CONFIG, ...OBSTACLE_TEST_CONFIG };
  if ( foundry.utils.isNewerVersion(VERSION, maxVersion) ) {
    // This config is newer.
    CONFIG[GEOMETRY_LIB_ID].CONFIG = { ...CONFIG[GEOMETRY_LIB_ID].CONFIG, ...thisConfig };
  } else {
    // Existing config is newer or not yet defined.
    CONFIG[GEOMETRY_LIB_ID].CONFIG = { ...thisConfig, ...CONFIG[GEOMETRY_LIB_ID].CONFIG };
  }

  // Helper to retrieve the correct ClipperPaths class.
  if ( !CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths ) {
    Object.defineProperty(CONFIG[GEOMETRY_LIB_ID].CONFIG, "ClipperPaths", {
      get: () => CONFIG[GEOMETRY_LIB_ID].CONFIG.clipperVersion === 1 ? ClipperPaths : Clipper2Paths
    });
  }
}

/**
 * Test if a token is dead. Usually, but not necessarily, the opposite of tokenIsDead.
 * @param {Token} token
 * @returns {boolean} True if dead.
 */
function tokenIsAlive(token) { return !tokenIsDead(token); }

/**
 * Test if a token is dead. Usually, but not necessarily, the opposite of tokenIsAlive.
 * @param {Token} token
 * @returns {boolean} True if dead.
 */
function tokenIsDead(token) {
  const deadStatus = CONFIG.statusEffects.find(status => status.id === "dead");
  if ( deadStatus && token.actor.statuses.has(deadStatus.id) ) return true;

  const tokenHPAttribute = "system.attributes.hp.value";
  const hp = getObjectProperty(token.actor, tokenHPAttribute);
  if ( typeof hp !== "number" ) return false;
  return hp <= 0;
}

/**
 * Test if a token is an enemy with respect to another.
 * @param {Token} subjectToken
 * @param {Token} testToken
 * @returns {boolean} True if:
 *  subject           |  test
 *  friendly/neutral  |  hostile/secret
 *  hostile           |  friendly/neutral/secret
 *  secret            |  friendly/neutral/hostile/secret
 */
function tokenIsEnemy(subjectToken, testToken) {
  const sD = subjectToken.document.disposition;

  // All secret tokens presumed enemies.
  if ( sD === CONST.TOKEN_DISPOSITIONS.SECRET ) return true;
  const tD = testToken.document.disposition;
  if ( tD === CONST.TOKEN_DISPOSITIONS.SECRET ) return true;

  // Hostiles are enemies to non-hostiles and vice-versa.
  if ( tD === CONST.TOKEN_DISPOSITIONS.HOSTILE && sD >= 0 ) return true;
  if ( sD === CONST.TOKEN_DISPOSITIONS.HOSTILE && tD >= 0 ) return true;

  // Everyone else are not enemies.
  return false;
}

/**
 * Test if a token is an ally with respect to another.
 * Two hostiles are assumed allies.
 * @param {Token} subjectToken
 * @param {Token} testToken
 * @returns {boolean} True if:
 *  subject           |  test
 *  friendly/neutral  |  friendly/neutral
 *  hostile           |  hostile
 */
function tokenIsAlly(subjectToken, testToken) {
  const sD = subjectToken.document.disposition;
  const tD = testToken.document.disposition;

  // Friendly/neutrals are allies
  if ( sD >= 0 && tD >= 0 ) return true;

  // Hostiles are allies
  if ( sD === CONST.TOKEN_DISPOSITIONS.HOSTILE && tD === CONST.TOKEN_DISPOSITIONS.HOSTILE ) return true;

  // By default, no one is an ally.
  // All secret tokens have no allies.
  return false;
}
