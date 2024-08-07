/* globals
CONFIG,
foundry,
Hooks
*/
"use strict";

const VERSION = "0.3.7";

// Foundry utils
import { registerFoundryUtilsMethods } from "./util.js";

// Regular Polygons
import { RegularPolygon } from "./RegularPolygon/RegularPolygon.js";
import { EquilateralTriangle } from "./RegularPolygon/EquilateralTriangle.js";
import { Square } from "./RegularPolygon/Square.js";
import { Hexagon } from "./RegularPolygon/Hexagon.js";
import { RegularStar } from "./RegularPolygon/RegularStar.js";

// Centered Polygons
import { CenteredPolygonBase } from "./CenteredPolygon/CenteredPolygonBase.js";
import { CenteredPolygon } from "./CenteredPolygon/CenteredPolygon.js";
import { CenteredRectangle } from "./CenteredPolygon/CenteredRectangle.js";

// Holed Shapes
import { ShapeHoled } from "./ShapeHoled.js";

// 3d
import { Plane } from "./3d/Plane.js";
import { Point3d } from "./3d/Point3d.js";
import { Ray3d } from "./3d/Ray3d.js";

// Draw
import { Draw } from "./Draw.js";

// Ellipse
import { Ellipse } from "./Ellipse.js";

// Matrix
import { Matrix } from "./Matrix.js";

// Shadow
import { Shadow, ShadowProjection } from "./Shadow.js";

// ClipperPaths
import { ClipperPaths } from "./ClipperPaths.js";

// Graph
import { Graph, GraphVertex, GraphEdge } from "./Graph.js";

// Patcher
import { Patcher } from "../Patcher.js";

// PIXI
import { PATCHES as PATCHES_Circle } from "./PIXI/Circle.js";
import { PATCHES as PATCHES_Point } from "./PIXI/Point.js";
import { PATCHES as PATCHES_Polygon } from "./PIXI/Polygon.js";
import { PATCHES as PATCHES_Rectangle } from "./PIXI/Rectangle.js";

// Elevation
import { PATCHES as PATCHES_ELEVATION } from "./elevation.js";

// Constrained Token Border
import { PATCHES as PATCHES_Token } from "./Token.js";
import { PATCHES as PATCHES_ConstrainedTokenBorder, ConstrainedTokenBorder } from "./ConstrainedTokenBorder.js";

// PixelCache
import { PixelCache, TilePixelCache, TrimmedPixelCache } from "./PixelCache.js";
import { PATCHES as PATCHES_Tile } from "./Tile.js";

const PATCHES = {
  "PIXI.Circle": PATCHES_Circle,
  "PIXI.Point": PATCHES_Point,
  "PIXI.Polygon": PATCHES_Polygon,
  "PIXI.Rectangle": PATCHES_Rectangle,

  // PixelCache
  "Tile": PATCHES_Tile,

  // Elevation patches.
  "foundry.canvas.sources.BaseEffectSource": PATCHES_ELEVATION.PointSource,
  "foundry.canvas.sources.PointVisionSource": PATCHES_ELEVATION.VisionSource,
  "PlaceableObject": PATCHES_ELEVATION.PlaceableObject,
  "Wall": PATCHES_ELEVATION.Wall,

  // Elevation and Constrained Token patches
  "Token": foundry.utils.mergeObject(PATCHES_ELEVATION.Token, PATCHES_Token),
  "foundry.canvas.edges.CanvasEdges": PATCHES_ConstrainedTokenBorder
}

export function registerGeometry() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.registered ??= new Set();
  const currentVersion = CONFIG.GeometryLib.version;
  if ( currentVersion && !foundry.utils.isNewerVersion(VERSION, currentVersion) ) return;

  // If older PATCHER is present, deregister it and remove it.
  if ( CONFIG.GeometryLib.PATCHER ) deRegister();

  // Create a new Patcher object and register the patches.
  CONFIG.GeometryLib.PATCHER = new Patcher();
  CONFIG.GeometryLib.PATCHER.addPatchesFromRegistrationObject(PATCHES);
  CONFIG.GeometryLib.version = VERSION;

  // Patches
  registerPIXIMethods();
  registerElevationAdditions();
  registerConstrainedTokenBorder();
  registerPixelCache();

  // New classes
  registerFoundryUtilsMethods();
  register3d();
  registerCenteredPolygons();
  registerRegularPolygons();
  registerDraw();
  registerEllipse();
  registerShadow();
  registerMatrix();
  registerClipperPaths();
  registerGraph();
  registerShapeHoled();
}

function deRegister() {
  CONFIG.GeometryLib.registered?.clear();
  CONFIG.GeometryLib.PATCHER.deregisterGroup("ELEVATION");
  CONFIG.GeometryLib.PATCHER.deregisterGroup("PIXI");
  CONFIG.GeometryLib.PATCHER.deregisterGroup("PIXEL_CACHE");
}

export function registerGraph() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.Graph = {
    Graph,
    GraphVertex,
    GraphEdge
  };
}

export function registerElevationAdditions() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.proneStatusId = "prone";
  CONFIG.GeometryLib.proneMultiplier = 0.33;
  CONFIG.GeometryLib.visionHeightMultiplier = 1;
  CONFIG.GeometryLib.PATCHER.registerGroup("ELEVATION");
}

export function registerPIXIMethods() {
  CONFIG.GeometryLib.PATCHER.registerGroup("PIXI");
}

export function registerConstrainedTokenBorder() {
  CONFIG.GeometryLib.PATCHER.registerGroup("CONSTRAINED_TOKEN_BORDER");
  CONFIG.GeometryLib.ConstrainedTokenBorder = ConstrainedTokenBorder;
}

export function registerPixelCache() {
  CONFIG.GeometryLib.pixelCacheResolution = 1;
  CONFIG.GeometryLib.PATCHER.registerGroup("PIXEL_CACHE");
  CONFIG.GeometryLib.PixelCache = PixelCache;
  CONFIG.GeometryLib.TrimmedPixelCache = TrimmedPixelCache;
  CONFIG.GeometryLib.TilePixelCache = TilePixelCache;
}

export function registerCenteredPolygons() {
  // Dependencies
  registerRegularPolygons();

  CONFIG.GeometryLib.CenteredPolygons = {
    CenteredPolygonBase,
    CenteredPolygon,
    CenteredRectangle
  };
}

export function registerRegularPolygons() {
  // Dependencies
  registerFoundryUtilsMethods();
  registerPIXIMethods();

  CONFIG.GeometryLib.RegularPolygons = {
    RegularPolygon,
    EquilateralTriangle,
    Square,
    Hexagon,
    RegularStar
  };
}

export function registerDraw() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.Draw = Draw;
}

export function register3d() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.threeD = {
    Plane,
    Point3d,
    Ray3d
  };
}

export function registerEllipse() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.Ellipse ??= Ellipse;
}

export function registerShadow() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.Shadow = Shadow;
  CONFIG.GeometryLib.ShadowProjection = ShadowProjection;
}

export function registerMatrix() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.Matrix = Matrix;
}

export function registerClipperPaths() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.ClipperPaths = ClipperPaths;
}

export function registerShapeHoled() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.ShapeHoled = ShapeHoled;
}
