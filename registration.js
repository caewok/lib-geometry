/* globals
CONFIG,
foundry,
game,
*/
"use strict";

const VERSION = "0.4.4";

// Foundry utils
import { GEOMETRY_CONFIG } from "./const.js";
import { registerFoundryUtilsMethods } from "./util.js";

import "./tests/AABB.test.js";

// Import all the files so GEOMETRY_CONFIG is populated.

// Regular Polygons
import "./RegularPolygon/RegularPolygon.js";
import "./RegularPolygon/EquilateralTriangle.js";
import "./RegularPolygon/Square.js";
import "./RegularPolygon/Hexagon.js";
import "./RegularPolygon/RegularStar.js";

// Centered Polygons
import "./CenteredPolygon/CenteredPolygonBase.js";
import "./CenteredPolygon/CenteredPolygon.js";
import "./CenteredPolygon/CenteredRectangle.js";

// Holed Shapes
import "./ShapeHoled.js";

// 3d
import "./3d/Plane.js";
import "./3d/Point3d.js";
import "./3d/Ray3d.js";
import "./3d/Sphere.js";
import "./3d/Polygon3d.js";
import "./3d/Barycentric.js";

// AABB
import "./AABB.js";

// Draw
import "./Draw.js";

// Ellipse
import "./Ellipse.js";

// Matrix
import "./Matrix.js";
import "./MatrixFlat.js";

// Shadow
import "./Shadow.js";

// ClipperPaths
import "./ClipperPaths.js";
import "./Clipper2Paths.js";

// Graph
import "./Graph.js";

// Benchmark
import "./Benchmark.js";

// Patcher
import { Patcher } from "../Patcher.js";

// PIXI
import { PATCHES as PATCHES_Circle } from "./PIXI/Circle.js";
import { PATCHES as PATCHES_Point } from "./PIXI/Point.js";
import { PATCHES as PATCHES_Polygon } from "./PIXI/Polygon.js";
import { PATCHES as PATCHES_Rectangle } from "./PIXI/Rectangle.js";
import { PATCHES as PATCHES_Ellipse } from "./PIXI/Ellipse.js";
import { PATCHES as PATCHES_RoundedRectangle } from "./PIXI/RoundedRectangle.js";

// Elevation
import { PATCHES as PATCHES_ELEVATION } from "./elevation.js";

// Constrained Token Border and Edges
import { PATCHES as PATCHES_Token } from "./Token.js";
import { PATCHES as PATCHES_CanvasEdges } from "./CanvasEdges.js";
import { PATCHES as PATCHES_ConstrainedTokenBorder } from "./ConstrainedTokenBorder.js";
import { PATCHES as PATCHES_Edge } from "./Edge.js";
import { PATCHES as PATCHES_AmbientLight } from "./AmbientLight.js";
import { PATCHES as PATCHES_AmbientSound } from "./AmbientSound.js";

// PixelCache
import "./PixelCache.js";
import { PATCHES as PATCHES_Tile } from "./Tile.js";

// Grid measurement
import "./GridCoordinates.js";
import "./3d/GridCoordinates3d.js";
import "./3d/ElevatedPoint.js";
import "./3d/HexGridCoordinates3d.js";

// Cutaway
import "./CutawayPolygon.js";

const PATCHES_V12 = {
  "PIXI.Circle": PATCHES_Circle,
  "PIXI.Point": PATCHES_Point,
  "PIXI.Polygon": PATCHES_Polygon,
  "PIXI.Rectangle": PATCHES_Rectangle,
  "PIXI.Ellipse": PATCHES_Ellipse,
  "PIXI.RoundedRectangle": PATCHES_RoundedRectangle,

  // PixelCache
  "Tile": PATCHES_Tile,

  // Elevation patches.
  "foundry.canvas.sources.BaseEffectSource": PATCHES_ELEVATION.PointSource,
  "foundry.canvas.sources.PointVisionSource": PATCHES_ELEVATION.VisionSource,
  "PlaceableObject": PATCHES_ELEVATION.PlaceableObject,
  "Wall": PATCHES_ELEVATION.Wall,
  "Region": PATCHES_ELEVATION.Region,

  // Elevation and Constrained Token patches
  "Token": foundry.utils.mergeObject(PATCHES_ELEVATION.Token, PATCHES_Token),
  "foundry.canvas.edges.CanvasEdges": PATCHES_CanvasEdges,
  "foundry.canvas.edges.Edge": PATCHES_Edge,
  "ConstrainedTokenBorder": PATCHES_ConstrainedTokenBorder,
  "foundry.documents.BaseAmbientLight": PATCHES_AmbientLight,
  "foundry.documents.BaseAmbientSound": PATCHES_AmbientSound,
}

const PATCHES_V13 = {
  // Don't need CanvasEdges b/c quadtree already in v13.
  // Do need

  "PIXI.Circle": PATCHES_Circle,
  "PIXI.Point": PATCHES_Point,
  "PIXI.Polygon": PATCHES_Polygon,
  "PIXI.Rectangle": PATCHES_Rectangle,
  "PIXI.Ellipse": PATCHES_Ellipse,
  "PIXI.RoundedRectangle": PATCHES_RoundedRectangle,

  // PixelCache
  "Tile": PATCHES_Tile,

  // Elevation patches.
  "foundry.canvas.sources.BaseEffectSource": PATCHES_ELEVATION.PointSource,
  "foundry.canvas.sources.PointVisionSource": PATCHES_ELEVATION.VisionSource,
  "foundry.canvas.placeables.PlaceableObject": PATCHES_ELEVATION.PlaceableObject,
  "foundry.canvas.placeables.Wall": PATCHES_ELEVATION.Wall,
  "foundry.canvas.placeables.Region": PATCHES_ELEVATION.Region,

  // Elevation and Constrained Token patches
  "foundry.canvas.placeables.Token": foundry.utils.mergeObject(PATCHES_ELEVATION.Token, PATCHES_Token),
  "foundry.canvas.geometry.edges.CanvasEdges": PATCHES_CanvasEdges,
  "foundry.canvas.geometry.edges.Edge": PATCHES_Edge,
  "ConstrainedTokenBorder": PATCHES_ConstrainedTokenBorder,
  "foundry.documents.BaseAmbientLight": PATCHES_AmbientLight,
  "foundry.documents.BaseAmbientSound": PATCHES_AmbientSound,
}

export function registerGeometry() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.registered ??= new Set();
  const currentVersion = CONFIG.GeometryLib.version;
  if ( currentVersion && !foundry.utils.isNewerVersion(VERSION, currentVersion) ) return;
  registerFoundryUtilsMethods();
  registerGeometryLibConstants();
  foundry.utils.mergeObject(CONFIG.GeometryLib, GEOMETRY_CONFIG);
  registerGeometryLibPatches();
  CONFIG.GeometryLib.version = VERSION;
}

export function registerGeometryLibConstants() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.proneStatusId = "prone";
  CONFIG.GeometryLib.proneMultiplier = 0.33;
  CONFIG.GeometryLib.visionHeightMultiplier = 1;
  CONFIG.GeometryLib.pixelCacheResolution = 1;
}

export function registerGeometryLibPatches() {
  // If older PATCHER is present, deregister it and remove it.
  if ( CONFIG.GeometryLib.PATCHER ) deRegister();

  // Use different names for v13.
  const patches = foundry.utils.isNewerVersion(game.version, "13") ? PATCHES_V13 : PATCHES_V12;

  // Create a new Patcher object and register the patches.
  CONFIG.GeometryLib.PATCHER = new Patcher();
  CONFIG.GeometryLib.PATCHER.addPatchesFromRegistrationObject(patches);
  CONFIG.GeometryLib.PATCHER.registerGroup("PIXI");
  CONFIG.GeometryLib.PATCHER.registerGroup("CONSTRAINED_TOKEN_BORDER");

  CONFIG.GeometryLib.PATCHER.registerGroup("PIXEL_CACHE");
  CONFIG.GeometryLib.PATCHER.registerGroup("ELEVATION");

  if ( foundry.utils.isNewerVersion(game.version, "13") ) {
    CONFIG.GeometryLib.PATCHER.registerGroup("CANVAS_EDGES_V13");
  } else {
    CONFIG.GeometryLib.PATCHER.registerGroup("CANVAS_EDGES");
  }
}

function deRegister() {
  CONFIG.GeometryLib.registered?.clear();
  CONFIG.GeometryLib.PATCHER.deregisterGroup("ELEVATION");
  CONFIG.GeometryLib.PATCHER.deregisterGroup("PIXI");
  CONFIG.GeometryLib.PATCHER.deregisterGroup("PIXEL_CACHE");
  CONFIG.GeometryLib.PATCHER.deregisterGroup("CANVAS_EDGES");
  CONFIG.GeometryLib.PATCHER.deregisterGroup("CANVAS_EDGES_V13");
  CONFIG.GeometryLib.PATCHER.deregisterGroup("CONSTRAINED_TOKEN_BORDER");
}
