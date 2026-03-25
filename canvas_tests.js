/* globals
canvas,
*/
"use strict";

import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "./const.js";
import { Draw } from "./Draw.js";
import { Point3d } from "./3d/Point3d.js";

// Testing functions that require a loaded canvas.

/*
Draw = CONFIG.GeometryLib.lib.Draw
Draw.clearDrawings()
canvasTests = CONFIG.GeometryLib.lib.canvasTests
canvasTests.drawTokenBorder()
canvasTests.drawConstrainedTokenBorder()
canvasTests.drawWallGeometries()
canvasTests.drawTokenGeometries()
canvasTests.drawTileGeometries()
canvasTests.drawRegionGeometries()

incorrectProtoTokens = canvasTests.testTokenPrototypeGeometryContainment()
incorrectTokens = canvasTests.testTokenGeometryContainment();
incorrectWalls = canvasTests.testWallGeometryContainment();
incorrectTiles = canvasTests.testTileGeometryContainment();
incorrectRegions = canvasTests.testRegionGeometryContainment();

tracking = CONFIG.GeometryLib.lib.placeableGeometryTracking


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

/**
 * Test tokens for containment.
 */
export function testTokenGeometryContainment() {
  let incorrectTokens = new Set();
  for ( const token of canvas.tokens.placeables ) {
    const geom = token.GeometryLib.geometry;
    using ctr = Point3d.fromTokenCenter(token);
    for ( const face of geom.iterateFaces() ) {
      if ( face.isFacing(ctr) ) incorrectTokens.add(token);
    }
  }
  console.log(`${incorrectTokens.size} incorrect tokens out of ${canvas.tokens.placeables.length}.`, incorrectTokens);
  return incorrectTokens;
}

export function testTokenPrototypeGeometryContainment() {
  let incorrectTokens = new Set();
  for ( const token of canvas.tokens.placeables ) {
    const geom = token.GeometryLib.geometry;
    using ctr = Point3d.tmp.set(0, 0, 0);
    const pf = geom._prototypeFaces;

    if ( pf.top.isFacing(ctr) ) incorrectTokens.add(token);
    if ( pf.bottom.isFacing(ctr) ) incorrectTokens.add(token);
    for ( const side of pf.sides ) {
      if ( side.isFacing(ctr) ) incorrectTokens.add(token);
    }
  }
  console.log(`${incorrectTokens.size} incorrect tokens out of ${canvas.tokens.placeables.length}.`, incorrectTokens);
  return incorrectTokens;
}

export function testWallGeometryContainment() {
  let incorrectWalls = new Set();
  for ( const wall of canvas.walls.placeables ) {
    const geom = wall.GeometryLib.geometry;
    using ctr = Point3d.midPoint(wall.edge.a, wall.edge.b);
    using delta2d = wall.edge.b.subtract(wall.edge.a);
    using dirLeft = Point3d.tmp.set(delta2d.y, -delta2d.x, 0);
    using dirRight = Point3d.tmp.set(-delta2d.y, delta2d.x, 0);

    dirRight.normalize(dirRight).multiplyScalar(50, dirRight);
    dirLeft.normalize(dirLeft).multiplyScalar(50, dirLeft);

    using ptRight = ctr.add(dirRight)
    using ptLeft = ctr.add(dirLeft)

    // For wall geometry, top is left, bottom is right.
    if ( geom.faces.top && !geom.faces.top.isFacing(ptLeft) ) incorrectWalls.add(wall);
    if ( geom.faces.bottom && !geom.faces.bottom.isFacing(ptRight) ) incorrectWalls.add(wall);
  }
  console.log(`${incorrectWalls.size} incorrect walls out of ${canvas.walls.placeables.length}.`);
  return incorrectWalls;
}

export function testTileGeometryContainment() {
  let incorrectTiles = new Set();
  for ( const tile of canvas.tiles.placeables ) {
    const geom = tile.GeometryLib.geometry;
    const ctr2d = tile.center;
    using ptTop = Point3d.tmp.set(ctr2d.x, ctr2d.y, tile.elevationZ + 50);
    using ptBottom = Point3d.tmp.set(ctr2d.x, ctr2d.y, tile.elevationZ - 50);
    if ( !(geom.faces.top.isFacing(ptTop)
        || geom.faces.bottom.isFacing(ptBottom)) ) incorrectTiles.add(tile);
  }
  console.log(`${incorrectTiles.size} incorrect tiles out of ${canvas.tiles.placeables.length}.`);
  return incorrectTiles;
}

export function testRegionGeometryContainment() {
  let incorrectRegions = new Set();
  for ( const region of canvas.regions.placeables ) {
    const geom = region.GeometryLib.geometry;
    if ( !geom.faces.top ) continue;

    const bottomZ = isFinite(region.bottomZ) ? region.bottomZ : -1e06;
    const topZ = isFinite(region.topZ) ? region.topZ : 1e06;
    const midZ = bottomZ + ((topZ - bottomZ) * 0.5);
    for ( let i = 0; i < region.document.polygons.length; i += 1 ) {
      const polygon = region.document.polygons[i]
      const isHole = !polygon.isPositive;
      const ctr2d = polygon.center;
      const isContained = polygon.contains(ctr2d.x, ctr2d.y);
      using ctr = Point3d.tmp.set(ctr2d.x, ctr2d.y, midZ);

      // _polygonFaces should match polygons.
      const polyTop = geom._polygonFaces.top[i];
      if ( polyTop.isHole ^ isHole ) console.error(`region ${region.id} poly top holes are wrong at ${i}.`);
      if ( polyTop.isFacing(ctr) ^ (isHole ^ isContained) ) incorrectRegions.add(region);

      const polyBottom = geom._polygonFaces.bottom[i];
      if ( polyBottom.isFacing(ctr) ^ (isHole ^ isContained) ) incorrectRegions.add(region);

      if ( polyBottom.isHole ^ isHole ) console.error(`region ${region.id} poly bottom holes are wrong at ${i}.`);
      for ( const polySide of geom._polygonFaces.sides[i] ) {
        if ( polySide.isHole ^ isHole ) console.error(`region ${region.id} poly sides holes are wrong at ${i}.`);
        if ( polySide.isFacing(ctr) ^ (isHole ^ isContained) ) incorrectRegions.add(region);
      }
    }

    // Test the full polygon top/bottom.
    // Sides are more difficult, as no guarantee that the sides correspond to a given top portion.
    const polygon = geom.faces.top.toPolygon2d();
    const ctr2d = polygon.center;
    const isContained = polygon.contains(ctr2d.x, ctr2d.y);
    using ctr = Point3d.tmp.set(ctr2d.x, ctr2d.y, midZ);

    if ( geom.faces.top.isFacing(ctr) ^ !isContained ) incorrectRegions.add(region);
    if ( geom.faces.bottom.isFacing(ctr) ^ !isContained ) incorrectRegions.add(region);

  }
  console.log(`${incorrectRegions.size} incorrect regions out of ${canvas.regions.placeables.length}.`);
  return incorrectRegions;
}


