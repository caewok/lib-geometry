/* globals
canvas,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Geometry
import { PlaceableGeometry, LevelSpanningMixin } from "./PlaceableGeometry.js";
import { CubePrimitive, CylinderPrimitive,  } from "./InstancedGeometricPrimitive.js";
import { ExtrudedPolygonPrimitive } from "./ModelGeometricPrimitive.js";

// LibGeometry
import { GEOMETRY_LIB_ID } from "../const.js";
import { CenteredPolygon } from "../CenteredPolygon/CenteredPolygon.js";
import { CenteredRectangle } from "../CenteredPolygon/CenteredRectangle.js";
import { Ellipse } from "../Ellipse.js";
import { Point3d } from "../3d/Point3d.js";
import { NULL_SET } from "../util.js";

import { mix } from "../mixwith.js";

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
const TRANSFORM_CHANGES = [
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
    for ( const key of TRANSFORM_CHANGES ) {
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
      for ( const key of TRANSFORM_CHANGES ) {
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

export class RegionGeometry extends mix(PlaceableGeometry).with(LevelSpanningMixin) {
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
    this.buildShapesForAllLevels();
    super.initialize();
  }

  updateAllShapes() {
    const { shapes, regionShapes } = this;
    for ( const shapeArr of shapes ) { // Per level segment shape.
      for ( let i = 0, iMax = shapeArr.length; i < iMax; i += 1 ) {
        if ( shapeArr[i] ) this.#updateShape(shapeArr[i], regionShapes[i]);
      }
    }
  }

  buildShapesForAllLevels() {
    const shapes = this.shapes;
    this.iterateShapes().forEach(subshape => subshape.destroy());

    const levelSegments = this.constructor.levelSegments;
    const numSegments = levelSegments.length;
    shapes.length = numSegments;

    // Build a primitive shape array only for level segments that this region is present within.
    for ( let i = 0; i < numSegments; i += 1 ) {
      const segment = levelSegments[i];
      if ( !segment.ids.some(id => this.isPresentAtLevel(id)) ) continue;
      shapes[i] = this.#buildAllShapes(i);
    }
  }

  #buildAllShapes(levelSegmentIdx) {
    const regionShapes = this.regionShapes;

    // If there are holes, use the model polygon shape for the entire region.
    if ( regionShapes.some(regionShape => regionShape.hole) ) {
      const id = this._levelShapeId(levelSegmentIdx);
      const { topZ, bottomZ } = this.constructor.placeableElevationZ(this.placeableDocument);
      const zElevs = this.constructor.elevationZForSegment(levelSegmentIdx, topZ, bottomZ);
      return [ExtrudedPolygonPrimitive.fromPolygons(id, this.regionPolygons, zElevs)];
    }

    const n = regionShapes.length;
    const shapes = Array(n)
    for ( let i = 0, iMax = n; i < iMax; i += 1 ) shapes[i] = this.#buildRegionShape(levelSegmentIdx, i);
    return shapes;
  }

  /**
   * Construct a primitive shape for a given region shape.
   * @param {number} idx        Index of the region shape in the region.document.shapes array
   * @returns {GeometricPrimitive}
   */
  #buildRegionShape(levelSegmentIdx, shapeIdx) {
    const regionShape = this.regionShapes[shapeIdx];
    const id = this._levelShapeId(levelSegmentIdx, shapeIdx);
    let shape;
    if ( regionShape.gridBased ) {
      const { topZ, bottomZ } = this.constructor.placeableElevationZ(this.placeableDocument);
      const zElevs = this.constructor.elevationZForSegment(levelSegmentIdx, topZ, bottomZ);
      shape = ExtrudedPolygonPrimitive.fromPolygons(id, regionShape.polygons, zElevs);

    } else switch ( regionShape.type ) {
      // See shape.constructor.TYPES
      case "circle":
      case "ellipse": shape = new CylinderPrimitive(id); break;

      case "line":
      case "rectangle": shape = new CubePrimitive(id); break;

      case "emanation":
        // Use the polygon b/c corner radiuses can vary.
        // base.x, base.y, rotation, base.width (# grid spaces), base.height (# grid spaces), origin

      case "ring": /* eslint-disable-line no-fallthrough */
         // Use the polygon(s) b/c of the hole.
        // rotation, x, y, radius as width, origin

      case "polygon": /* eslint-disable-line no-fallthrough */
        // Obv. use the polygon.
        // rotation, although not user-set, origin

      case "cone": /* eslint-disable-line no-fallthrough */
        // Use the polygon b/c no unit cone shape b/c angle varies.
        // rotation, x, y, radius as width, origin


      case "grid": /* eslint-disable-line no-fallthrough */
        // Unclear what this is.

      case "token": /* eslint-disable-line no-fallthrough */
        // Unclear what this is.

      default: {  /* eslint-disable-line no-fallthrough */
        // Pass the center, rotation, and dimensions so a prototype can be created.
        using center = Point3d.tmp;
        using dims = Point3d.tmp;
        using angles = Point3d.tmp;

        const { topZ, bottomZ } = this.constructor.placeableElevationZ(this.placeableDocument);
        const opts = this.constructor.elevationZForSegment(levelSegmentIdx, topZ, bottomZ);
        const { z, zHeight } = this.constructor.zDimensions(opts.topZ, opts.bottomZ);
        opts.center = center;
        opts.dims = dims;
        opts.angles = angles;

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
    // Because a change to any shape could change the model polygon for the region, just
    // redo everything.
    // Similarly, if the region's levels changed, redo everything.
    if ( regionShapes.some(regionShape => regionShape.hole) || this._updateFlags.levels ) {
      // Each level shape array should contain a single polygon primitive.
      this.initialize();
      this.updateAllShapes();
      return;
    }

    // Use the passthrough tracking sets to determine updates for each region shape.
    const trackingArr = opts?.[GEOMETRY_LIB_ID] || [];

    // Go through each segment array and examine the shapes.
    for ( let segmentIdx = 0, n = this.constructor.levelSegments.length; segmentIdx < n; segmentIdx += 1 ) {
      const shapeArr = shapes[segmentIdx];
      if ( !shapeArr ) continue;

      // If no specific changes, re-do everything but don't rebuild shapes unless we have to.
      if ( trackingArr.length && shapeArr.length > regionShapes.length  ) {
        // Remove the extra shapes.
        for ( let i = regionShapes.length, iMax = shapeArr.length; i < iMax; i += 1 ) shapeArr[i].destroy();
        shapeArr.length = regionShapes.length;
      }

      for ( let i = 0, iMax = regionShapes.length; i < iMax; i += 1 ) {
        // Don't rebuild shapes unless we have to.
        const trackingSet = trackingArr[i]; // May be undefined.
        const needsRebuild = !shapeArr[i]
          || !(shapeArr[i] instanceof this.shapeClass(regionShapes[i]))
          || (trackingSet && (trackingSet.has("type") || trackingSet.has("points")));
        if ( needsRebuild ) {
          if ( shapeArr[i] ) shapeArr[i].destroy();
          shapeArr[i] = this.#buildRegionShape(i);
          shapeArr[i].initialize();
          this.#updateShape(shapeArr[i], regionShapes[i]);
          continue;
        }

        // Trigger elevation changes, which are based on the overall region change.
        if ( trackingSet && this._updateFlags.elevation ) trackingSet.add("elevation");

        // If no tracking set, update everything.
        // Otherwise, update selectively based on the tracking set.
        this.#updateShape(shapeArr[i], regionShapes[i], trackingSet);
      }
    }

    // Handle parent updates last.
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
    const { topZ, bottomZ } = this.constructor.placeableElevationZ(this.placeableDocument);
    const { z, zHeight } = this.constructor.zDimensions(topZ, bottomZ);

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

  // ----- NOTE: Levels ----- //

  /**
   * Id, taking into account the level segment.
   * Combines the level segment ids so each segment is unique.
   * @param {number} levelSegmentIdx
   * @param {number} shapeIdx
   * @returns {string}
   */
  _levelShapeId(levelSegmentIdx, shapeIdx) {
    let id = super._levelShapeId(levelSegmentIdx);
    if ( typeof shapeIdx !== "undefined" ) id += `_${shapeIdx}`;
    return id;
  }

  // ----- NOTE: Geometric shapes and faces ----- //

  /**
   * Iterate over the shapes.
   * @param {object} [opts]
   * @param {CONST.WALL_RESTRICTION_TYPES} [opts.senseType]   If provided, will return early if geometry does not block this sense type.
   * @param {string} [opts.levelId]                           If provided, will return early if geometry does not affect this level.
   * @yields {GeometricPrimitive}
   */
  *iterateShapes(opts) {
    for ( const shapeArr of super.iterateShapes(opts) ) yield* shapeArr;
  }

  /**
   * Top and bottom elevation of a region.
   * @param {Region} region
   * @returns {object}
   * - @prop {number} topZ
   * - @prop {number} bottomZ
   */
  static placeableElevationZ(regionDocument) {
    const elevZ = super.placeableElevationZ(regionDocument);
    if ( !regionDocument.elevation.topInclusive ) elevZ.topZ -= 1; // Subtract 1 pixel if not inclusive.
    return elevZ;
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
