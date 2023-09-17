/* globals
CONFIG,
foundry,
Hooks
*/
"use strict";

const VERSION = "0.2.9";

// PIXI
import { registerPIXIPolygonMethods } from "./PIXI/Polygon.js";
import { registerPIXICircleMethods } from "./PIXI/Circle.js";
import { registerPIXIRectangleMethods } from "./PIXI/Rectangle.js";
import { registerPIXIPointMethods } from "./PIXI/Point.js";

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

// Elevation
import { registerElevationAdditions } from "./elevation.js";

// Graph
import { Graph, GraphVertex, GraphEdge } from "./Graph.js";

export function registerGeometry() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.registered ??= new Set();

  const currentVersion = CONFIG.GeometryLib.version;
  if ( currentVersion && !foundry.utils.isNewerVersion(VERSION, currentVersion) ) return;
  if ( currentVersion ) deRegister();
  CONFIG.GeometryLib.version = VERSION;

  registerFoundryUtilsMethods();
  registerPIXIMethods();
  register3d();

  registerElevationAdditions();
  registerCenteredPolygons();
  registerRegularPolygons();
  registerDraw();
  registerEllipse();
  registerShadow();
  registerMatrix();
  registerClipperPaths();
  register3d();
  registerGraph();
}


function deRegister() {
  CONFIG.GeometryLib.registered?.clear();
  if ( !CONFIG.GeometryLib.hooks ) return;
  CONFIG.GeometryLib.hooks.forEach((name, id) => Hooks.off(name, id));
  CONFIG.GeometryLib.hooks.clear();
}

export function registerGraph() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.Graph = {
    Graph,
    GraphVertex,
    GraphEdge
  };
}

export function registerPIXIMethods() {
  registerPIXIPolygonMethods();
  registerPIXICircleMethods();
  registerPIXIRectangleMethods();
  registerPIXIPointMethods();
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
