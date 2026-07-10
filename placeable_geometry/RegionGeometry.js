/* globals
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Geometry
import { PlaceableGeometry } from "./PlaceableGeometry.js";
import { CubeTransformPrimitive, CylinderPrimitive,  } from "./InstancedGeometricPrimitive.js";
import { ExtrudedPolygonPrimitive } from "./ModelGeometricPrimitive.js";

// LibGeometry
import { CenteredPolygon } from "../CenteredPolygon/CenteredPolygon.js";
import { CenteredRectangle } from "../CenteredPolygon/CenteredRectangle.js";
import { Ellipse } from "../Ellipse.js";

/**
  Region will either be a single shape or a group of polygons.
  If more than one shape, treated as polygons.

  NOTE: Shapes can be destroyed/recreated without an update hook.
  Presumably, they are not getting changed without a hook.

  Regions store combined shapes as region.polygons.
*/

const TRACKER_TYPES = {
  elevation: [
    "elevation.bottom",
    "elevation.top",
    "flags.terrainmapper.plateauElevation",
    "flags.terrainmapper.rampFloor",
  ],
  shapes: [
    "shapes",
    "flags.terrainmapper.rampDirection",
    "flags.terrainmapper.splitPolygons",
    "flags.terrainmapper.elevationAlgorithm",
  ],
  level: [
    "levels",
  ],
};

export class RegionGeometry extends PlaceableGeometry {
  /** @type {string} */
  static PLACEABLE_NAME = "Region";

  /** @type {string} */
  static LAYER = "regions";

  static TRACKER_TYPES = TRACKER_TYPES;

  static UPDATE_KEYS = {
    ...super.UPDATE_KEYS,
    properties: new Set(TRACKER_TYPES.shapes),
    level: new Set(TRACKER_TYPES.level),
    elevation: new Set(TRACKER_TYPES.elevation),
  };

  get region() { return this.placeable; }

  get regionShapes() { return this.placeableDocument.shapes; }

  get regionPolygons() { return this.placeableDocument.polygons; }

  get bottomZ() { return this.placeable.bottomZ; }

  get topZ() { return this.placeable.topZ; }

  initialize() {
    this.#buildRegionShapes();
    super.initialize();
  }

  #buildRegionShapes() {
    this.shapes.forEach(shape => shape.destroy());
    const regionShapes = this.regionShapes;

    // If there are holes, use the model polygon shape for the entire region.
    const opts = this.constructor.regionElevation(this.placeableDocument); // topZ, bottomZ.

    if ( regionShapes.some(regionShape => regionShape.hole) ) {
      // TODO: Need correct handling of center/dims/angles for these polygons vs individual shapes.
      this.shapes.push(ExtrudedPolygonPrimitive.fromPolygons(this.placeableId, this.regionPolygons, opts));
    }

    // If gridBased shape, use the model polygon shape.
    // Need the index for the id.
    for ( let i = 0, iMax = regionShapes.length; i < iMax; i += 1 ) {
      const regionShape = regionShapes[i];
      const id = `${this.placeableId}_${i}`;
      let shape;
      if ( regionShape.gridBased ) shape = CubeTransformPrimitive.fromPolygons(id, regionShape.polygons, opts);
      else switch ( regionShape.type ) {
        // See shape.constructor.TYPES
        case "circle":
        case "ellipse":
          shape = new CylinderPrimitive(id);
          // Translation, rotation, and scale all from 0,0,0 for circle and ellipse extrusions.
          break;

        case "line":
        case "rectangle":
          shape = new CubeTransformPrimitive(id);

          // Use TL as the translation and rotation center.
          shape.modelMatrix.translationCenter = { x: -0.5, y: -0.5, z: 0.0 };
          shape.modelMatrix.rotationCenter = { x: -0.5, y: -0.5, z: 0.0 };
          break;

        case "emanation": // Use the polygon b/c corner radiuses can vary.
        case "ring": // Use the polygon(s) b/c of the hole.
        case "polygon": // Obv. use the polygon.
        case "cone": // Use the polygon b/c no unit cone shape b/c angle varies.
        case "grid": // Unclear what this is.
        case "token": // Unclear what this is.
        default: shape = ExtrudedPolygonPrimitive.fromPolygons(id, regionShape.polygons, opts);
      }
    }
  }

  _update() {
    // There is currently no (easy) way to tell if a shape is otherwise the same but for a position/rotation/scale change.
    // Editing a shape results in a new shape, and the update hook shows all the shape properties as changed.
    // These methods thus are currently used only to set up new shapes.

    // Rebuild the shapes if any update occurs.
    // TODO: Could handle region elevation changes separately.
    // TODO: Could cache shape properties and then handle changes more discretely.
    if ( this._updateFlags.values().some(value => Boolean(value)) ) {
      this.#buildRegionShapes();
      this.#updateShapeModel();
    }
  }

  #updateShapeModel() {
    const { regionShapes, shapes } = this;
    const { topZ, bottomZ } = this.constructor.regionElevation(this.placeableDocument);
    const zHeight = topZ - bottomZ;
    const z = bottomZ + (zHeight * 0.5);

    for ( let i = 0, iMax = regionShapes.length; i < iMax; i += 1 ) {
      const shape = shapes[i];
      if ( shape instanceof ExtrudedPolygonPrimitive ) continue;

      const regionShape = regionShapes[i];
      shape.setPosition(regionShape.x, regionShape.y, z);
      shape.setRotation(0, 0, Math.toRadians(regionShape.rotation));

      switch ( regionShape.type ) {
        case "circle": shape.setScale(regionShape.radius, regionShape.radius, zHeight); break;
        case "ellipse": shape.setScale(regionShape.radiusX, regionShape.radiusY, zHeight); break;

        case "line": shape.setScale(regionShape.length, regionShape.width, zHeight); break;
        case "rectangle": shape.setScale(regionShape.width, regionShape.height); break;

        // Rest are using polygons, which were skipped above.


        case "emanation": // Use the polygon b/c corner radiuses can vary.
        case "ring": // Use the polygon(s) b/c of the hole.
        case "polygon": // Obv. use the polygon.
        case "cone": // Use the polygon b/c no unit cone shape b/c angle varies.
        case "grid": // Unclear what this is.
        case "token": // Unclear what this is.

      }

    }
  }



  /**
   * Top and bottom elevation of a region.
   * @param {Region} region
   * @returns {object}
   * - @prop {number} topZ
   * - @prop {number} bottomZ
   */
  static regionElevation(regionDocument) {
    const MAX_ELEV = 1e06;
    const elev = regionDocument.elevation;
    let topZ = regionDocument.topZ - (!elev.topInclusive * 1); // Subtract 1 pixel if not inclusive.
    let bottomZ = regionDocument.bottomZ

    // Force elevations to be finite values.
    if ( !isFinite(topZ) ) topZ = MAX_ELEV;
    if ( !isFinite(bottomZ) ) bottomZ = -MAX_ELEV;
    return { topZ, bottomZ };
  }
}

/**
 * Converts region shape to a PIXI shape.
 * @param {RegionShape} regionShape
 * @returns {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon|Ellipse}
 */
export function convertRegionShapeToPIXI(regionShape, rotate = true) {
  switch ( regionShape.type ) {
    case "rectangle": {
      if ( rotate && regionShape.rotation ) return convertRegionRotatedRectangleShapeToPIXI(regionShape);
      return convertRegionRectangleShapeToPIXI(regionShape);
    }
    case "ellipse": {
      if ( rotate && regionShape.rotation ) return convertRegionRotatedEllipseShapeToPIXI(regionShape);
      return convertRegionEllipseShapeToPIXI(regionShape);
    }
    case "polygon": {
      if ( rotate && regionShape.rotation ) return convertRegionRotatedPolygonShapeToPIXI(regionShape);
      return convertRegionPolygonShapeToPIXI(regionShape);
    }
    case "circle": return convertRegionCircleShapeToPIXI(regionShape);
    default: console.error(`Shape ${regionShape.type} not recognized.`, regionShape);
  }
}

function convertRegionRectangleShapeToPIXI(rectShape) { return new PIXI.Rectangle(rectShape.x, rectShape.y, rectShape.width, rectShape.height); }
function convertRegionCircleShapeToPIXI(circleShape) { return new PIXI.Circle(circleShape.x, circleShape.y, circleShape.radius); }
function convertRegionEllipseShapeToPIXI(ellipseShape) { return new PIXI.Ellipse(ellipseShape.x, ellipseShape.y, ellipseShape.radiusX, ellipseShape.radiusY); }
function convertRegionPolygonShapeToPIXI(polygonShape) { return new PIXI.Polygon(polygonShape.points); }

// Rotated shapes.
function convertRegionRotatedRectangleShapeToPIXI(rectShape) {
  const rect = CenteredRectangle.fromPIXIRectangle(rectShape);
  rect.rotation = rectShape.rotation;
  return rect;
}

function convertRegionRotatedEllipseShapeToPIXI(ellipseShape) {
  return new Ellipse(ellipseShape.x, ellipseShape.y, ellipseShape.radiusX, ellipseShape.radiusY, { rotation: ellipseShape.rotation });
}

function convertRegionRotatedPolygonShapeToPIXI(polygonShape) {
  const poly = CenteredPolygon.fromPIXIPolygon(convertRegionPolygonShapeToPIXI(polygonShape));
  poly.rotation = polygonShape.rotation;
  return poly;
}
