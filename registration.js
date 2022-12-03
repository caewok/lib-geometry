/* globals
foundry
*/
"use strict";

// PIXI
import { registerPIXIPolygonMethods } from "./PIXI/Polygon.js";
import { registerPIXICircleMethods } from "./PIXI/Circle.js";
import { registerPIXIRectangleMethods } from "./PIXI/Rectangle.js";
import { registerPIXIPointMethods } from "./PIXI/Point.js";

// Regular Polygons
import { RegularPolygon } from "./RegularPolygon/RegularPolygon.js";
import { EquilateralTriangle } from "./RegularPolygon/EquilateralTriangle.js";
import { Square } from "./RegularPolygon/Square.js";
import { Hexagon } from "./RegularPolygon/Hexagon.js";
import { RegularStar } from "./RegularPolygon/RegularStar.js";

// Centered Polygons
import { CenteredPolygonBase } from "./CenteredPolygon/CenteredPolygonBase";
import { CenteredPolygon } from "./CenteredPolygon/CenteredPolygon";
import { CenteredRectangle } from "./CenteredPolygon/CenteredRectangle";

// 3d
import { Plane } from "./3d/Plane.js";
import { Point3d } from "./3d/Point3d.js";
import { Ray3d } from "./3d/Plane.js";

// Draw
import { Draw } from "./Draw.js";

// Ellipse
import { Ellipse } from "./Ellipse.js";

// WeilerAtherton
import { WeilerAtherton } from "./WeilerAtherton.js";

// Matrix
import { Matrix } from "./Matrix.js";

// Shadow
import { Shadow } from "./Shadow.js";

// Helper to register all PIXI methods
export function registerPIXI() {
  registerPIXIPolygonMethods();
  registerPIXICircleMethods();
  registerPIXIRectangleMethods();
  registerPIXIPointMethods();
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

export function registerWeilerAtherton() {
  foundry.utils.GeometryLib ??= {};
  if ( foundry.utils.GeometryLib.WeilerAtherton ) return;

  foundry.utils.GeometryLib.WeilerAtherton = WeilerAtherton;
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
