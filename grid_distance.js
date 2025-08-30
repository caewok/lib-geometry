/* globals
canvas,
CONST,
foundry,
game,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Point3d } from "./3d/Point3d.js";
import { HexGridCoordinates3d } from "./3d/HexGridCoordinates3d.js";
import { GridCoordinates3d } from "./3d/GridCoordinates3d.js";
import { pixelsToGridUnits } from "./util.js";
import { GRID_DIAGONALS } from "./const.js";

/**
 * Measure the distance between two points accounting for the current grid rules.
 * For square, this accounts for the diagonal rules. For hex, measures in number of hexes.
 * @param {Point} a
 * @param {Point} b
 * @param {object} [opts]
 * @param {function} [opts.altGridDistFn]    Function generated from alternatingGridDistance; used for alternating rules
 * @param {GRID_DIAGONALS} [opts.diagonals]  Diagonal rule to use
 * @returns {number} Distance, in grid units
 */
export function gridDistanceBetween(a, b, { altGridDistFn, diagonals } = {}) {
  if ( canvas.grid.isGridless ) return pixelsToGridUnits(Point3d.distanceBetween(a, b));
  const distFn = canvas.grid.isHexagonal ? hexGridDistanceBetween : squareGridDistanceBetween;
  const dist = distFn(a, b, altGridDistFn, diagonals);

  // Round to the nearest grid distance if close.
  const gridD = canvas.grid.distance;
  if ( (dist % gridD).almostEqual(0) ) return Math.round(dist / gridD) * gridD;
  return dist;
}


/**
 * Measure the 3d segment distance for a hex grid.
 * @param {Point|Point3d} a
 * @param {Point|Point3d} b
 * @param {function} [altGridDistFn]    Function generated from alternatingGridDistance; used for alternating rules
 * @param {GRID_DIAGONALS} [diagonals]  Diagonal rule to use
 * @returns {number} Number of hexes accounting for grid size.
 */
function hexGridDistanceBetween(p0, p1, altGridDistFn, diagonals) {
  diagonals ??= canvas.grid.diagonals ?? game.settings.get("core", "gridDiagonals");
  const D = GRID_DIAGONALS;

  // Ensure these are Point3ds.
  p0 = Point3d.fromObject(p0);
  p1 = Point3d.fromObject(p1);

  // Translate the 2d movement to cube units. Elevation is in grid size units.
  const d0 = canvas.grid.pointToCube(p0);
  const d1 = canvas.grid.pointToCube(p1);
  d0.k = (p0.z / canvas.grid.size) || 0; // Normalize so that elevation movement = 1 when traversing 1 grid space vertically.
  d1.k = (p1.z / canvas.grid.size) || 0;
  const dist2d = foundry.grid.HexagonalGrid.cubeDistance(d0, d1);
  const distElev = Math.abs(d0.k - d1.k);
  Point3d.release(p0, p1);

  // Like with squareGridDistanceBetween, use the maximum axis to avoid Math.max(), Max.min() throughout.
  const [maxAxis, minAxis] = dist2d > distElev ? [dist2d, distElev] : [distElev, dist2d];
  let l;
  switch ( diagonals ) {
    case D.EQUIDISTANT: l = maxAxis; break; // Max dx, dy, dz
    case D.EXACT: l = exactGridDistance(maxAxis, minAxis); break;
    case D.EUCLIDEAN: l = Math.hypot(maxAxis, minAxis); break;
    case D.APPROXIMATE: l = approxGridDistance(maxAxis, minAxis); break;
    case D.ALTERNATING_1:
    case D.ALTERNATING_2: {
      altGridDistFn ??= alternatingGridDistance();
      l = altGridDistFn(maxAxis, minAxis);
      break;
    }
    case D.RECTILINEAR:
    case D.ILLEGAL: l = maxAxis + minAxis; break;
  }
  return l * canvas.grid.distance;
}

/**
 * Measure the 2d or 3d segment distance for a square grid, accounting for diagonal movement.
 * @param {Point|Point3d} a             Segment endpoint
 * @param {Point|Point3d} b             Other segment endpoint
 * @param {function} [altGridDistFn]    Function generated from alternatingGridDistance; used for alternating rules
 * @param {GRID_DIAGONALS} diagonals    Diagonal rule to use
 * @returns {number} Distance accounting for grid size.
 */
function squareGridDistanceBetween(p0, p1, altGridDistFn, diagonals) {
  diagonals ??= canvas.grid.diagonals ?? game.settings.get("core", "gridDiagonals");
  const D = GRID_DIAGONALS;

  p0 = Point3d.fromObject(p0);
  p1 = Point3d.fromObject(p1);

  // Normalize so that dx === 1 when traversing 1 grid space.
  // abs(p0.x - p1.x) / canvas.grid.size, ...
  const delta = Point3d.tmp;
  p0
    .subtract(p1, delta)
    .abs(delta)
    .multiplyScalar(1 / canvas.grid.size, delta);

  // Make dx the maximum, dy, the middle, and dz the minimum change across the axes.
  // If two-dimensional, dz will be zero. (Slightly faster than an array sort.)
  const minMax = Math.minMax(...delta);
  const maxAxis = minMax.max;
  const minAxis = minMax.min;
  const midAxis = delta.x.between(delta.y, delta.z) ? delta.x
    : delta.y.between(delta.x, delta.z) ? delta.y : delta.z;
  Point3d.release(p0, p1, delta);

  // TODO: Make setting to use Euclidean distance.
  // exactDistanceFn = setting ? Math.hypot : exactGridDistance;
  let l;
  switch ( diagonals ) {
    case D.EQUIDISTANT: l = maxAxis; break; // Max dx, dy, dz
    case D.EXACT: l = exactGridDistance(maxAxis, midAxis, minAxis); break;
    case D.EUCLIDEAN: l = Math.hypot(maxAxis, midAxis, minAxis); break;
    case D.APPROXIMATE: l = approxGridDistance(maxAxis, midAxis, minAxis); break;
    case D.ALTERNATING_1:
    case D.ALTERNATING_2: {
      altGridDistFn ??= alternatingGridDistance({ diagonals });
      l = altGridDistFn(maxAxis, midAxis, minAxis);
      break;
    }
    case D.RECTILINEAR:
    case D.ILLEGAL: l = maxAxis + midAxis + minAxis; break;
  }

  return l * canvas.grid.distance;
}

function approxGridDistance(maxAxis = 0, midAxis = 0, minAxis = 0) {
  return maxAxis + (0.5 * midAxis) + (0.25 * minAxis);
  // Equivalent to:
  // return maxAxis + ((0.5 * (midAxis - minAxis)) + (0.75 * minAxis))
}

function exactGridDistance(maxAxis = 0, midAxis = 0, minAxis = 0) {
  const A = Math.SQRT2 - 1;
  const B = Math.SQRT3 - 1;
  return maxAxis + (A * midAxis) + ((B - A) * minAxis);
  // Equivalent to:
  // maxAxis + (A * (midAxis - minAxis)) + (B * minAxis);
}

/**
 * Track the diagonals required for measuring alternating grid distance.
 * Returns a function that calls _alternatingGridDistance with the cached previous diagonals.
 * Handles hex or square grids.
 * @param {object} [opts]
 *   - @param {number} [opts.lPrev]
 *   - @param {number} [opts.prevMaxAxis]
 *   - @param {number} [opts.prevMidAxis]
 *   - @param {number} [opts.prevMinAxis]
 * @returns {function}
 *   - @param {Point|Point3d} p0
 *   - @param {Point|Point3d} p1
 *   - @param {object} [opts]     Same opts as the original function.
 *   - @returns {number} The distance in number of squares or hexes
 */
export function alternatingGridDistance(opts = {}) {
  const diagonals = opts.diagonals ??= canvas.grid.diagonals ?? game.settings.get("core", "gridDiagonals");
  let lPrev = opts.lPrev ?? ((diagonals === CONST.GRID_DIAGONALS.ALTERNATING_2) ? 1 : 0);
  let prevMaxAxis = opts.prevMaxAxis ?? lPrev;
  let prevMidAxis = opts.prevMidAxis ?? lPrev;
  let prevMinAxis = opts.prevMinAxis ?? lPrev;
  return (maxAxis = 0, midAxis = 0, minAxis = 0) => {
    prevMaxAxis += maxAxis;
    prevMidAxis += midAxis;
    prevMinAxis += minAxis;
    const lCurr = _alternatingGridDistance(prevMaxAxis, prevMidAxis, prevMinAxis);
    const l = lCurr - lPrev; // If 2:1:2, this will cause the flip along with dxPrev and dyPrev.
    lPrev = lCurr;
    return l;
  };
}

function _alternatingGridDistance(maxAxis = 0, midAxis = 0, minAxis = 0) {
  // How many full spaces have been traversed?
  const spacesX = Math.floor(maxAxis);
  const spacesY = Math.floor(midAxis);
  const spacesZ = Math.floor(minAxis);

  // Shift in x,y since last move.
  const deltaX = maxAxis - spacesX;
  const deltaY = midAxis - spacesY;
  const deltaZ = minAxis - spacesZ;

  // Determine the movement assuming diagonals === 2, so
  const a = approxGridDistance(spacesX, spacesY, spacesZ);
  const A = Math.floor(a); // If no prior move, this is the total move.

  // Add in the previous move deltas. Essentially do an approximate move for the deltas.
  const B = Math.floor(a + 1);
  const C = Math.floor(a + 1.5);
  const D = Math.floor(a + 1.75);
  return A + ((B - A) * deltaX) + ((C - B) * deltaY) + ((D - C) * deltaZ);
  // Same as
  // (A * (1 - deltaX)) + (B * (deltaX - deltaY)) + (C * (deltaY - deltaZ)) + (D * deltaZ);
}

/**
 * Constructs a direct path grid, accounting for elevation and diagonal elevation.
 * @param {ElevatedPoint} start
 * @param {ElevatedPoint} end
 * @param {GridOffset[]} [path2d]             Optional path2d for the start and end waypoints.
 * @returns {GridCoordinates3d[]}
 */
export function getDirectPath(start, end) {
  switch ( canvas.grid.type ) {
    case CONST.GRID_TYPES.GRIDLESS: return GridCoordinates3d._directPathGridless(start, end);
    case CONST.GRID_TYPES.SQUARE: return GridCoordinates3d._directPathSquare(start, end);
    default: return HexGridCoordinates3d._directPathHex(start, end);
  }
}


/**
 * Get the function to measure the offset distance for a given distance with given previous diagonals.
 * @param {number} [diagonals=0]
 * @returns {function}
 */
export function getOffsetDistanceFn(diagonals = 0) {
  switch ( canvas.grid.type ) {
    case CONST.GRID_TYPES.GRIDLESS:
      return (a, b) => pixelsToGridUnits(Point3d.distanceBetween(a, b));
    case CONST.GRID_TYPES.SQUARE: return GridCoordinates3d._singleOffsetDistanceFn(diagonals);
    default: return HexGridCoordinates3d._singleOffsetDistanceFn(diagonals);
  }
}


