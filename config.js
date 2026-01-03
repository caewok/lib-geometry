/* globals
CONFIG,
foundry,
*/
"use strict";

import { GEOMETRY_LIB_ID, VERSION } from "./const.js";

// LibGeometry
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
   * Use a token sphere for the face test.
   * @type {boolean}
   */
  useTokenSphere: false,

  version: VERSION,
};


export function mergeConfigs(maxVersion = VERSION) {
  const thisConfig = { ...ELEVATION_CONFIG, ...TILECACHE_CONFIG, ...PLACEABLE_TRACKING_CONFIG };
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
