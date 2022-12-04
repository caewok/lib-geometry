/* globals
foundry
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

// WeilerAtherton
import { WeilerAthertonClipper } from "./WeilerAtherton.js";

// Matrix
import { Matrix } from "./Matrix.js";

// Shadow
import { Shadow } from "./Shadow.js";

// ClipperPaths
import { ClipperPaths } from "./ClipperPaths.js";

export function registerGeometry(categories = []) {
  // Always register additions to methods

  registerPIXIPolygonMethods();
  registerPIXICircleMethods();
  registerPIXIRectangleMethods();
  registerPIXIPointMethods();
  registerFoundryUtilsMethods();

  for ( const category of categories ) REGISTER[category]();
}

const REGISTER = {
  CenteredPolygons: registerCenteredPolygons,
  RegularPolygons: registerRegularPolygons,
  Draw: registerDraw,
  ThreeD: register3d,
  Ellipse: registerEllipse,
  Shadow: registerShadow,
  Matrix: registerMatrix,
  WeilerAthertonClipper: registerWeilerAthertonClipper,
  ClipperPaths: registerClipperPaths
}


// Store new geometry classes in foundry.utils
export function registerCenteredPolygons() {
  foundry.utils.GeometryLib ??= {};
  if ( foundry.utils.GeometryLib.CenteredPolygons ) return;

  foundry.utils.GeometryLib.CenteredPolygons = {
    CenteredPolygonBase,
    CenteredPolygon,
    CenteredRectangle
  };
}

export function registerRegularPolygons() {
  foundry.utils.GeometryLib ??= {};
  if ( foundry.utils.GeometryLib.RegularPolygons ) return;

  foundry.utils.GeometryLib.RegularPolygons = {
    RegularPolygon,
    EquilateralTriangle,
    Square,
    Hexagon,
    RegularStar
  };
}

export function registerDraw() {
  foundry.utils.GeometryLib ??= {};
  if ( foundry.utils.GeometryLib.Draw ) return;

  foundry.utils.GeometryLib.Draw = Draw;
}

export function register3d() {
  foundry.utils.GeometryLib ??= {};
  if ( foundry.utils.GeometryLib.threeD ) return;

  foundry.utils.GeometryLib.threeD = {
    Plane,
    Point3d,
    Ray3d
  };
}

export function registerEllipse() {
  foundry.utils.GeometryLib ??= {};
  if ( foundry.utils.GeometryLib.Ellipse ) return;

  foundry.utils.GeometryLib.Ellipse = Ellipse;
}

export function registerWeilerAthertonClipper() {
  foundry.utils.GeometryLib ??= {};
  if ( foundry.utils.GeometryLib.WeilerAthertonClipper ) return;

  foundry.utils.GeometryLib.WeilerAthertonClipper = WeilerAthertonClipper;
}

export function registerShadow() {
  foundry.utils.GeometryLib ??= {};
  if ( foundry.utils.GeometryLib.Shadow ) return;

  foundry.utils.GeometryLib.Shadow = Shadow;
}

export function registerMatrix() {
  foundry.utils.GeometryLib ??= {};
  if ( foundry.utils.GeometryLib.Matrix ) return;

  foundry.utils.GeometryLib.Matrix = Matrix;
}

export function registerClipperPaths() {
  foundry.utils.GeometryLib ??= {};
  if ( foundry.utils.GeometryLib.ClipperPaths ) return;

  foundry.utils.GeometryLib.ClipperPaths = ClipperPaths;
}
