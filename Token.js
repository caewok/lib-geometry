/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { GEOMETRY_LIB_ID } from "./const.js";
import { ConstrainedTokenBorder } from "./ConstrainedTokenBorder.js";
import { Hex3dVertices } from "./placeable_geometry/BasicVertices.js";
import { Ellipse } from "./Ellipse.js";

// Patches for the Token class
export const PATCHES = {};
PATCHES.CONSTRAINED_TOKEN_BORDER = {};

// ----- NOTE: Getters ----- //

/**
 * New getter: Token.prototype.constrainedTokenBorder
 * Determine the constrained border shape for this token.
 * @returns {ConstrainedTokenShape|PIXI.Rectangle}
 */
function constrainedTokenBorder() { return ConstrainedTokenBorder.get(this).constrainedBorder(); }

/**
 * New getter: Token.prototype.isConstrainedTokenBorder
 * Determine whether the border is currently constrained for this token.
 * I.e., the token overlaps a wall.
 * @returns {boolean}
 */
function isConstrainedTokenBorder() { return !ConstrainedTokenBorder.get(this)._unrestricted; }

/**
 * New getter: Token.prototype.tokenBorder
 * Determine the correct border shape for this token. Utilize the cached token shape.
 * Allow for different token shapes.
 * @returns {PIXI.Polygon|PIXI.Rectangle}
 */
function tokenBorder() {
  const { x, y, width, height } = this.document;
  const center = this.center;
  const pixelWidth = width * canvas.dimensions.size;
  const pixelHeight = height * canvas.dimensions.size;

  // TODO: Does rotation count?

  // Treat sphere as circle at largest radii.
  if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.useTokenSphere ) {
    const radius = Math.max(pixelWidth, pixelHeight) * 0.5; // Only care about 2d here.
    return new PIXI.Circle(center.x, center.y, radius);
  }

  /* Shape options
  In dnd5e at least, shapes change based on grid type.
  But the underlying token document shape may be different.
  Further, prototype tokens do not get a shape.
  Square grid: only RECTANGLE_1. getShape: PIXI.Rectangle
  Gridless: ELLIPSE_1 or RECTANGLE_1. getShape: PIXI.Ellipse or PIXI.Rectangle, respectively.
  Hex grid: All 6 options, which are all variations on hexes. Some may not change
  depending on token. getShape: PIXI.Polygon
  */
  return this.getShape().translate(this.document.x, this.document.y);
}

/**
 * New getter Token.prototype.litTargetShape
 * Take the constrained target shape and intersect it with canvas lights.
 * @returns {PIXI.Polygon|PIXI.Rectangle|ClipperPaths}
 */
function litTokenBorder() { return ConstrainedTokenBorder.get(this).litShape(); }

function brightLitTokenBorder() { return ConstrainedTokenBorder.get(this).brightLitShape(); }

function soundTokenBorder() { return ConstrainedTokenBorder.get(this).soundShape(); }

/**
 * New getter: Token.prototype.tokenShape
 * Cache the token shape.
 * @type {PIXI.Polygon|PIXI.Rectangle}
 */
function tokenShape() {
  const msg = "libGeometry|Token#tokenShape is deprecated. "
    + "If you need the shape of a Token, use Token#shape/getShape instead.";
  foundry.utils.logCompatibilityWarning(msg, {since: 12, until: 14, once: true});
  return this.shape;
}

PATCHES.CONSTRAINED_TOKEN_BORDER.GETTERS = {
  constrainedTokenBorder,
  tokenBorder,
  tokenShape,
  isConstrainedTokenBorder,
  litTokenBorder,
  brightLitTokenBorder,
  soundTokenBorder,
};
