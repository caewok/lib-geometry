/* globals
canvas,
*/
"use strict";

import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "./const.js";
import { Draw } from "./Draw.js";

// Testing functions that require a loaded canvas.

/*
canvasTests = CONFIG.GeometryLib.lib.canvasTests


*/

// ----- NOTE: Constrained Tokens ----- //

/**
 * @param {object} [opts]
 * @param {Token[]} [opts.tokens]               Tokens to draw; otherwise test entire canvas
 * @param {*} [opts]                            Other opts passed to drawing
 */
export function drawTokenBorder({ tokens, ...drawingOpts } = {}) {
  tokens ??= canvas.tokens.placeables;
  drawingOpts.color ??= Draw.COLORS.orange;
  for ( const token of tokens ) Draw.shape(token.tokenBorder, drawingOpts);
}

/**
 * @param {object} [opts]
 * @param {Token[]} [opts.tokens]               Tokens to draw; otherwise test entire canvas
 * @param {*} [opts]                            Other opts passed to drawing
 */
export function drawConstrainedTokenBorder({ tokens, ...drawingOpts } = {}) {
  tokens ??= canvas.tokens.placeables;
  drawingOpts.color ??= Draw.COLORS.red;
  for ( const token of tokens ) Draw.shape(token.constrainedTokenBorder, drawingOpts);
}

/**
 * @param {object} [opts]
 * @param {Token[]} [opts.tokens]               Tokens to draw; otherwise test entire canvas
 * @param {*} [opts]                            Other opts passed to drawing
 */
export function drawLitTokenBorderTokenBorder({ tokens, ...drawingOpts } = {}) {
  tokens ??= canvas.tokens.placeables;
  drawingOpts.color ??= Draw.COLORS.yellow;
  for ( const token of tokens ) {
    if ( !token.litTokenBorder ) continue;
    Draw.shape(token.litTokenBorder, drawingOpts);
  }
}

/**
 * @param {object} [opts]
 * @param {Token[]} [opts.tokens]               Tokens to draw; otherwise test entire canvas
 * @param {*} [opts]                            Other opts passed to drawing
 */
export function drawBrightLitTokenBorderTokenBorder({ tokens, ...drawingOpts } = {}) {
  tokens ??= canvas.tokens.placeables;
  drawingOpts.color ??= Draw.COLORS.white;
  for ( const token of tokens ) {
    if ( !token.brightLitTokenBorder ) continue;
    Draw.shape(token.brightLitTokenBorder, drawingOpts);
  }
}

/**
 * @param {object} [opts]
 * @param {Token[]} [opts.tokens]               Tokens to draw; otherwise test entire canvas
 * @param {*} [opts]                            Other opts passed to drawing
 */
export function drawTokenSoundBorder({ tokens, ...drawingOpts } = {}) {
  tokens ??= canvas.tokens.placeables;
  drawingOpts.color ??= Draw.COLORS.blue;
  for ( const token of tokens ) {
    if ( !token.soundTokenBorder ) continue;
    Draw.shape(token.soundTokenBorder, drawingOpts);
  }
}

// ----- NOTE: Placeable Geometry ----- //

/**
 * Draw 2d shapes based on placeable geometry face.
 * @param {PlaceableObject} placeable
 * @param {object} [opts]
 * @param {"top"|"bottom"} [opts.face="top"]    Draw top or bottom face
 * @param {boolean} [opts.aabb=false]           If true, draw the bounding box
 * @param {*} [opts]                            Other opts passed to drawing
 */
function drawPlaceableGeometry(placeable, placeableColor, { face = "top", aabb = false, ...drawingOpts } = {}) {
  const geom = placeable[GEOMETRY_LIB_ID][GEOMETRY_ID];
  if ( !geom ) {
    console.error(`${placeable.constructor.name} ${placeable.id} has no geometry.`);
    return;
  }

  let color = Draw.COLORS[placeableColor];
  geom.faces[face].draw2d({ color, ...drawingOpts });
  if ( aabb ) {
    let color = Draw.COLORS[`light${placeableColor}`];
    Draw.shape(geom.aabb.toRectangle(), { color, ...drawingOpts });
  }
}

/**
 * Draw 2d walls based on geometry face.
 * @param {object} [opts]
 * @param {Wall[]} [opts.walls]                 Walls to draw; otherwise test entire canvas
 * @param {"top"|"bottom"} [opts.face="top"]    Draw top or bottom face
 * @param {boolean} [opts.aabb=false]           If true, draw the bounding box
 * @param {*} [opts]                            Other opts passed to drawing
 */
export function drawWallGeometries({ walls, ...drawingOpts } = {}) {
  walls ??= canvas.walls.placeables;
  for ( const wall of walls ) {
    let color = "blue";
    let face = "top"
    if ( wall.edge.direction ) {
      const geom = wall[GEOMETRY_LIB_ID][GEOMETRY_ID];
      face = geom.faces.top ? "top" : "bottom";
      color = geom.faces.top ? "green": "red";
    }
    drawPlaceableGeometry(wall, color, { face, ...drawingOpts });
  }
}

/**
 * Draw 2d tokens based on geometry face.
 * @param {object} [opts]
 * @param {Token[]} [opts.tokens]               Tokens to draw; otherwise test entire canvas
 * @param {"top"|"bottom"} [opts.face="top"]    Draw top or bottom face
 * @param {boolean} [opts.aabb=false]           If true, draw the bounding box
 * @param {*} [opts]                            Other opts passed to drawing
 */
export function drawTokenGeometries({ tokens, ...drawingOpts } = {}) {
  tokens ??= canvas.tokens.placeables;
  for ( const token of tokens ) drawPlaceableGeometry(token, "orange", drawingOpts);
}

/**
 * Draw 2d tiles based on top geometry face.
 * @param {object} [opts]
 * @param {Tile[]} [opts.tiles]                 Tiles to draw; otherwise test entire canvas
 * @param {"top"|"bottom"} [opts.face="top"]    Draw top or bottom face
 * @param {boolean} [opts.aabb=false]           If true, draw the bounding box
 * @param {*} [opts]                            Other opts passed to drawing
 */
export function drawTileGeometries({ tiles, ...drawingOpts } = {}) {
  tiles ??= canvas.tiles.placeables;
  for ( const tile of tiles ) drawPlaceableGeometry(tile, "yellow", drawingOpts);
}

/**
 * Draw 2d regions based on top geometry face.
 * @param {object} [opts]
 * @param {Region[]} [opts.regions]             Regions to draw; otherwise test entire canvas
 * @param {"top"|"bottom"} [opts.face="top"]    Draw top or bottom face
 * @param {boolean} [opts.aabb=false]           If true, draw the bounding box
 * @param {*} [opts]                            Other opts passed to drawing
 */
export function drawRegionGeometries({ regions, ...drawingOpts } = {}) {
  regions ??= canvas.regions.placeables;
  for ( const region of regions ) drawPlaceableGeometry(region, "green", drawingOpts);
}
