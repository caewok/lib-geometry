/* globals
canvas,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Geometry
import { PlaceableGeometry } from "./PlaceableGeometry.js";
import { CubePrimitive, CylinderPrimitive,  } from "./InstancedGeometricPrimitive.js";
import { ExtrudedPolygonPrimitive } from "./ModelGeometricPrimitive.js";

// LibGeometry
import { GEOMETRY_LIB_ID } from "../const.js";
import { CenteredPolygon } from "../CenteredPolygon/CenteredPolygon.js";
import { CenteredRectangle } from "../CenteredPolygon/CenteredRectangle.js";
import { Ellipse } from "../Ellipse.js";
import { Point3d } from "../3d/Point3d.js";

/**
  Region will either be a single shape or a group of polygons.
  If more than one shape, treated as polygons.

  NOTE: Shapes can be destroyed/recreated without an update hook.
  Presumably, they are not getting changed without a hook.

  Regions store combined shapes as region.polygons.
*/

/**
 * Hook the region preupdate to pass through shape-specific updates.
 */
const TRANFORM_CHANGES = [
  "x",
  "y",
  "width",
  "height",
  "length",
  "rotation",
  "hole",
  "gridBased",
];

Hooks.on("preUpdateRegion", function(regionD, changes, options, _userId) {
  if ( !changes.shapes ) return;

  /* Track changes in an array in options:
  Array index: Index of the new shapes array.
  Changes to a polygon number of sides is treated as new.
  Changes to a polygon area treated as new.
  Otherwise, object indicating changes made.
  */

  const trackingArr = options[GEOMETRY_LIB_ID] = new Array(changes.shapes.length);
  const originalShapes = regionD.shapes;
  for ( const [index, updatedShape] of Object.entries(changes.shapes) ) {
    if ( !updatedShape.type ) {
      console.error("RegionGeometry|updated shape has no type.");
      trackingArr[index] = structuredClone(updatedShape);
      continue;
    }

    const trackingSet = trackingArr[index] = new Set();
    const originalShape = originalShapes[index];
    const typeChanged = !(originalShape && updatedShape.type === originalShape.type);
    if ( typeChanged ) {
      trackingSet.add("type");
      continue;
    };

    // Basic values.
    for ( const key of TRANFORM_CHANGES ) {
      if ( !(Object.hasOwn(originalShape, key) && Object.hasOwn(updatedShape, key)) ) continue;
      if ( originalShape[key] !== updatedShape[key] ) trackingSet.add(key);
    }

    // Polygon-specific
    if ( updatedShape.type === "polygon"
      && !originalShape.points.equals(updatedShape.points) ) trackingSet.add("points");

    // Base (emanation) specific
    if ( !Object.hasOwn(updatedShape, "base") && Object.hasOwn(originalShape, "base") ) {
      console.error("RegionGeometry|updated shape has no base.");
      continue;
    } else if ( Object.hasOwn(updatedShape, "base") && !Object.hasOwn(originalShape, "base") ) {
      console.error("RegionGeometry|original shape has no base.");
      continue;
    } else if ( Object.hasOwn(updatedShape, "base") ) {
      for ( const key of TRANFORM_CHANGES ) {
        const orig = originalShape.base;
        const updated = updatedShape.base;
        if ( !(Object.hasOwn(orig, key) && Object.hasOwn(updated, key)) ) continue;
        if ( orig[key] !== updated[key] ) trackingSet.add(`base.${key}`);
      }
    }
  }
});


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

  /**
   * Return the shape class for a given region shape type.
   * May also be dependent on the region (e.g., plateaus, steps, etc.)
   */
  shapeClass(regionShape) {
    if ( regionShape.gridBased ) return ExtrudedPolygonPrimitive;
    switch ( regionShape.type ) {
      case "circle":
      case "ellipse": return CylinderPrimitive;

      case "line":
      case "rectangle": return CubePrimitive;

      default: return ExtrudedPolygonPrimitive;
    }
  }

  get region() { return this.placeable; }

  get regionShapes() { return this.placeableDocument.shapes; }

  get regionPolygons() { return this.placeableDocument.polygons; }

  get bottomZ() { return this.placeable.bottomZ; }

  get topZ() { return this.placeable.topZ; }

  initialize() {
    this.buildAllShapes();
    super.initialize();
    this.updateAllShapes();
  }

  updateAllShapes() {
    const { shapes, regionShapes } = this;
    for ( let i = 0, iMax = shapes.length; i < iMax; i += 1 ) this.#updateShape(shapes[i], regionShapes[i]);
  }

  buildAllShapes() {
    const { shapes, regionShapes } = this;
    shapes.forEach(shape => shape.destroy());
    shapes.length = 0;

    // If there are holes, use the model polygon shape for the entire region.
    if ( regionShapes.some(regionShape => regionShape.hole) ) {
      const opts = this.constructor.regionElevation(this.placeableDocument); // topZ, bottomZ.
      shapes.push(ExtrudedPolygonPrimitive.fromPolygons(this.placeableId, this.regionPolygons, opts));
      return;
    }

    const n = regionShapes.length;
    shapes.length = n;
    for ( let i = 0, iMax = n; i < iMax; i += 1 ) shapes[i] = this.#buildRegionShape(i);
  }

  /**
   * Construct a primitive shape for a given region shape.
   * @param {number} idx        Index of the region shape in the region.document.shapes array
   * @returns {GeometricPrimitive}
   */
  #buildRegionShape(idx) {
    const regionShape = this.regionShapes[idx];
    const id = `${this.placeableId}_${idx}`;
    let shape;
    if ( regionShape.gridBased ) {
      const opts = this.constructor.regionElevation(this.placeableDocument);
      shape = ExtrudedPolygonPrimitive.fromPolygons(id, regionShape.polygons, opts);

    } else switch ( regionShape.type ) {
      // See shape.constructor.TYPES
      case "circle":
      case "ellipse": shape = new CylinderPrimitive(id); break;

      case "line":
      case "rectangle": shape = new CubePrimitive(id); break;

      case "emanation": // Use the polygon b/c corner radiuses can vary.
        // base.x, base.y, rotation, base.width (# grid spaces), base.height (# grid spaces), origin

      case "ring": // Use the polygon(s) b/c of the hole.
        // rotation, x, y, radius as width, origin

      case "polygon": // Obv. use the polygon.
        // rotation, although not user-set, origin

      case "cone": // Use the polygon b/c no unit cone shape b/c angle varies.
        // rotation, x, y, radius as width, origin


      case "grid": /* eslint-disable-line no-fallthrough */ // Unclear what this is.
      case "token": // Unclear what this is.
      default: {
        // Pass the center, rotation, and dimensions so a prototype can be created.
        const opts = this.constructor.regionElevation(this.placeableDocument);
        using center = Point3d.tmp;
        using dims = Point3d.tmp;
        using angles = Point3d.tmp;
        opts.center = center;
        opts.dims = dims;
        opts.angles = angles;

        const zHeight = opts.topZ - opts.bottomZ;
        const z = opts.bottomZ + (zHeight * 0.5);
        const origin = regionShape.origin;
        opts.center.set(origin.x, origin.y, z);
        if ( regionShape.rotation ) opts.angles.set(0, 0, Math.toRadians(regionShape.rotation));
        else opts.angles.set(0, 0, 0);
        if ( regionShape.radius ) opts.dims.set(regionShape.radius, regionShape.radius, zHeight);
        else if ( regionShape.base?.width ) opts.dims.set(regionShape.base.width * canvas.grid.size, regionShape.base.height * canvas.grid.size, zHeight)
        else opts.dims.set(1, 1, 1);
        shape = ExtrudedPolygonPrimitive.fromPolygons(id, regionShape.polygons, opts);
      }
    }
    return shape;
  }

  _update(opts) {
    /*
    There is currently no (easy) way to tell if a shape is otherwise the same but for a position/rotation/scale change.
    Editing a shape results in a new shape, and the update hook shows all the shape properties as changed.
    The current work-around is a preupdate hook that passes through an array of changes to the specific shapes.
    */
    const { shapes, regionShapes } = this;

    // If there are holes, use the model polygon shape for the entire region.
    if ( regionShapes.some(regionShape => regionShape.hole) ) {
      shapes.forEach(shape => shape.destroy);
      const opts = this.constructor.regionElevation(this.placeableDocument); // topZ, bottomZ.
      shapes.push(ExtrudedPolygonPrimitive.fromPolygons(this.placeableId, this.regionPolygons, opts));
      return;
    }

    if ( !opts ) {
      if ( shapes.length > regionShapes.length ) {
        for ( let i = regionShapes.length, iMax = shapes.length; i < iMax; i += 1 ) shapes[i].destroy();
        shapes.length = regionShapes.length;
      }

      for ( let i = 0, iMax = regionShapes.length; i < iMax; i += 1 ) {
        if ( !shapes[i] ) shapes[i] = this.#buildRegionShape(i);
        else if ( !(shapes[i] instanceof this.shapeClass(regionShapes[i])) ) {
          shapes[i].destroy();
          shapes[i] = this.#buildRegionShape(i);
        }
        this.#updateShape(shapes[i], regionShapes[i])
      }
      return;
    }

    // Go through each shape and update or recreate as needed.
    const trackingArr = opts[GEOMETRY_LIB_ID];
    for ( let i = 0, iMax = trackingArr.length; i < iMax; i += 1 ) {
      const trackingSet = trackingArr[i];
      if ( !shapes[i] ) shapes[i] = this.#buildRegionShape(i);
      else if ( trackingSet.has("type") || trackingSet.has("points") ) {
        shapes[i].destroy();
        shapes[i] = this.#buildRegionShape(i);
        continue;
      }
      if ( this._updateFlags.elevation ) trackingSet.add("elevation");

      // TODO: Updates to region levels.
      this.#updateShape(shapes[i], regionShapes[i], trackingSet);
    }
    super._update();
  }

  /**
   * Update a specific shape.
   * @param {GeometricPrimitive} shape
   * @param {ShapeData} regionShape      The region shape; assumed to have been already updated
   * @param {Set<string>} [changeKeys]   Optional change keys; if not provided everything will be updated
   *   Adding a "elevation" key will update the position and scale.
   */
  #updateShape(shape, regionShape, changes) {

    const { topZ, bottomZ } = this.constructor.regionElevation(this.placeableDocument);
    const zHeight = topZ - bottomZ;
    const z = bottomZ + (zHeight * 0.5);

    let center;
    let angles;
    let dims;
    let anchors;

    // If changes not provided, modify all parameters.
    if ( !changes ) {
      changes = new Set(Object.keys(regionShape));
      changes.add("elevation");
      changes.add("anchorX"); // Only used for some.

      // Emanation has a base with additional values.
      if ( changes.has("base") ) Object.keys(regionShape.base).forEach(key => changes.add(`base.${key}`));
    }

    // Use regionShape.origin to set the position.
    if ( changes.has("x") || changes.has("y") || changes.has("elevation") ) {
      const origin = regionShape.origin;
      center = Point3d.tmp.set(origin.x, origin.y, z);
    }

    // All shapes have rotation, so can set here.
    if ( changes.has("rotation") ) angles = Point3d.tmp.set(0, 0, Math.toRadians(regionShape.rotation));

    // Anchors default to 0, 0, 0, which is already the default value.

    // Update dims by shape type. Update anchor for specific shapes.
    switch ( regionShape.type ) {
      case "circle":
        if ( changes.has("radius")
          || changes.has("elevation") ) dims = Point3d.tmp.set(regionShape.radius * 2, regionShape.radius * 2, zHeight);
        break;

      case "ellipse":
        if ( changes.has("radiusX")
          || changes.has("radiusY")
          || changes.has("elevation") ) dims = Point3d.tmp.set(regionShape.radiusX * 2, regionShape.radiusY * 2, zHeight);
        break;

      case "line": {
        if ( changes.has("length")
          || changes.has("width")
          || changes.has("elevation") ) dims = Point3d.tmp.set(regionShape.length, regionShape.width, zHeight);

        // Line anchors from middle left.
        if ( changes.has("anchorX") ) anchors = Point3d.tmp.set(0.5, 0.0, 0.0);
        break;
      }

      case "rectangle": {
        if ( changes.has("width")
          || changes.has("height")
          || changes.has("elevation") ) dims = Point3d.tmp.set(regionShape.width, regionShape.height, zHeight);

        // Rectangle anchors from user-defined position.
        // Those represent percentage anchors from 0–1. Conform to the unit cube from -0.5 to 0.5.
        if ( changes.has("anchorX")
          || changes.has("anchorY") ) anchors = Point3d.tmp.set(0.5 - regionShape.anchorX, 0.5 - regionShape.anchorY, 0);
        break;
      }

      // Rest are using polygons.
      case "emanation": // Use the polygon b/c corner radiuses can vary.
        if ( changes.has("base.width") || changes.has("base.height") || changes.has("elevation")  ) {
          const { width, height } = regionShape.base;
          const s = canvas.grid.size;
          dims = Point3d.tmp.set(width * s, height * s, zHeight);
        }
        break;

      case "ring": // Use the polygon(s) b/c of the hole.
      case "cone": // Use the polygon b/c no unit cone shape b/c angle varies.
        if ( changes.has("radius")
          || changes.has("elevation") ) dims = Point3d.tmp.set(regionShape.radius, regionShape.radius, zHeight);
        break;

      case "polygon": break; // Obv. use the polygon. Dimensions set by the points.

      case "grid": break; // Unclear what this is.

      case "token": break; // Unclear what this is.

    }

    if ( center ) {
      shape.setPosition(center);
      center.release();
    }
    if ( angles ) {
      shape.setRotation(angles);
      angles.release();
    }
    if ( dims ) {
      shape.setScale(dims);
      dims.release();
    }
    if ( anchors ) {
      shape.setAnchor(anchors);
      anchors.release();
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
