/* globals
CONFIG,
foundry,
*/
"use strict";

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
import { PATCHES as PATCHES_Tile } from "./Tile.js";

const PATCHES = {
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

export function registerGeometryLibPatches() {
  // If older PATCHER is present, deregister it and remove it.
  if ( CONFIG.GeometryLib.PATCHER ) deRegister();

  // Create a new Patcher object and register the patches.
  CONFIG.GeometryLib.PATCHER = new Patcher();
  CONFIG.GeometryLib.PATCHER.addPatchesFromRegistrationObject(PATCHES);
  CONFIG.GeometryLib.PATCHER.registerGroup("PIXI");
  CONFIG.GeometryLib.PATCHER.registerGroup("CONSTRAINED_TOKEN_BORDER");
  CONFIG.GeometryLib.PATCHER.registerGroup("PIXEL_CACHE");
  CONFIG.GeometryLib.PATCHER.registerGroup("ELEVATION");
  CONFIG.GeometryLib.PATCHER.registerGroup("CANVAS_EDGES");
}

export function deRegister() {
  CONFIG.GeometryLib.registered?.clear();
  CONFIG.GeometryLib.PATCHER.deregisterGroup("ELEVATION");
  CONFIG.GeometryLib.PATCHER.deregisterGroup("PIXI");
  CONFIG.GeometryLib.PATCHER.deregisterGroup("PIXEL_CACHE");
  CONFIG.GeometryLib.PATCHER.deregisterGroup("CANVAS_EDGES");
  CONFIG.GeometryLib.PATCHER.deregisterGroup("CONSTRAINED_TOKEN_BORDER");
}
