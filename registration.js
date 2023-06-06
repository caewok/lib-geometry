/* globals
CONFIG
*/
"use strict";

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
import { Shadow } from "./Shadow.js";

// ClipperPaths
import { ClipperPaths } from "./ClipperPaths.js";

export function registerGeometry() {
  registerFoundryUtilsMethods();
  registerPIXIMethods();

  registerCenteredPolygons();
  registerRegularPolygons();
  registerDraw();
  registerEllipse();
  registerShadow();
  registerMatrix();
  registerClipperPaths();
}

export function registerPIXIMethods() {
  registerPIXIPolygonMethods();
  registerPIXICircleMethods();
  registerPIXIRectangleMethods();
  registerPIXIPointMethods();
}

export function registerCenteredPolygons() {
  CONFIG.GeometryLib ??= {};
  if ( CONFIG.GeometryLib.CenteredPolygons ) return;

  // Dependencies
  registerRegularPolygons();

  CONFIG.GeometryLib.CenteredPolygons = {
    CenteredPolygonBase,
    CenteredPolygon,
    CenteredRectangle
  };
}

export function registerRegularPolygons() {
  CONFIG.GeometryLib ??= {};
  if ( CONFIG.GeometryLib.RegularPolygons ) return;

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
  if ( CONFIG.GeometryLib.Draw ) return;

  CONFIG.GeometryLib.Draw = Draw;
}

export function register3d() {
  CONFIG.GeometryLib ??= {};
  if ( CONFIG.GeometryLib.threeD ) return;

  CONFIG.GeometryLib.threeD = {
    Plane,
    Point3d,
    Ray3d
  };
}

export function registerEllipse() {
  CONFIG.GeometryLib ??= {};
  if ( CONFIG.GeometryLib.Ellipse ) return;

  CONFIG.GeometryLib.Ellipse = Ellipse;
}

export function registerShadow() {
  CONFIG.GeometryLib ??= {};
  if ( CONFIG.GeometryLib.Shadow ) return;

  CONFIG.GeometryLib.Shadow = Shadow;
}

export function registerMatrix() {
  CONFIG.GeometryLib ??= {};
  if ( CONFIG.GeometryLib.Matrix ) return;

  CONFIG.GeometryLib.Matrix = Matrix;
}

export function registerClipperPaths() {
  CONFIG.GeometryLib ??= {};
  if ( CONFIG.GeometryLib.ClipperPaths ) return;

  CONFIG.GeometryLib.ClipperPaths = ClipperPaths;
}
