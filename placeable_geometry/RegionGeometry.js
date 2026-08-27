/* globals
canvas,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Geometry
import { PlaceableGeometry } from "./PlaceableGeometry.js";
import { CubePrimitive, CylinderPrimitive,  } from "./InstancedGeometricPrimitive.js";
import { ExtrudedPolygonPrimitive } from "./ModelGeometricPrimitive.js";

// LibGeometry
import { GEOMETRY_LIB_ID } from "../const.js";
import { Point3d } from "../3d/Point3d.js";
import { almostLessThan, NULL_SET } from "../util.js";

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
  "radius",
  "radiusX",
  "radiusY",
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
  for ( let i = 0, n = changes.shapes.length; i < n; i += 1 ) {
    const updatedShape = changes.shapes[0];

    if ( !updatedShape.type ) {
      console.error("RegionGeometry|updated shape has no type.");
      trackingArr[i] = NULL_SET;
      continue;
    }

    const trackingSet = trackingArr[i] = new Set();
    const originalShape = originalShapes[i];

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

  // Convert from Set so the options will pass through.
  options[GEOMETRY_LIB_ID] = options[GEOMETRY_LIB_ID].map(s => [...s.values()]);
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

  /**
   * Id, taking into account the shape index
   * @param {number} shapeIdx
   * @returns {string}
   */
  _shapeId(shapeIdx) { return `${this.placeableId}_${shapeIdx}`; }


  initialize() {
    this.createShapes();
    super.initialize();
  }

  updateAllShapes() {
    const { shapes, regionShapes } = this;
    for ( let i = 0, iMax = shapes.length; i < iMax; i += 1 ) {
      const shape = shapes[i];
      const regionShape = regionShapes[i];
       this._updateShape(shape, regionShape);
    }
  }

  createShapes() {
    const regionShapes = this.regionShapes;
    const shapes = this.shapes;
    this.iterateShapes().forEach(subshape => subshape.destroy());
    this.shapes.length = 1;

    // If there are holes or wall restrictions, use the model polygon shape for the entire region.
    if ( this.regionPolygons.length &&
      (this.placeableDocument.restriction.enabled
      || regionShapes.some(regionShape => regionShape.hole)) ) {
      const id = this.placeableId;
      const zElevs = this.elevationZ;
      this.shapes[0] = ExtrudedPolygonPrimitive.fromPolygons(id, this.regionPolygons, zElevs);
      return;
    }

    const n = regionShapes.length;
    this.shapes.length = n;
    for ( let i = 0, iMax = n; i < iMax; i += 1 ) shapes[i] = this._buildRegionShape(i);
    return shapes;
  }

  /**
   * Construct a primitive shape for a given region shape.
   * @param {number} idx        Index of the region shape in the region.document.shapes array
   * @returns {GeometricPrimitive|null}
   */
  _buildRegionShape(shapeIdx) {
    const regionShape = this.regionShapes[shapeIdx];
    const id = this._shapeId(shapeIdx);
    const zElevs = this.elevationZ;

    let shape;
    if ( regionShape.gridBased ) shape = ExtrudedPolygonPrimitive.fromPolygons(id, regionShape.polygons, zElevs);
    else switch ( regionShape.type ) {
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
        const opts = this._polygonPrimitiveTransforms(regionShape);
        if ( almostLessThan(opts.dims.z, 0) ) opts.dim.z = 1; // zHeight must be positive.
        shape = ExtrudedPolygonPrimitive.fromPolygons(id, regionShape.polygons, opts);
        opts.center.release();
        opts.dims.release();
        opts.angles.release();
      }
    }
    return shape;
  }

  /**
   * Calculate the transform information for a region shape represented by a model polygon.
   * @param {RegionShape} regionShape
   * @param {number} levelSegmentIdx
   * @returns {object}
   *   - @prop {Point3d} center     The translation information
   *   - @prop {Point3d} dims       The scaling information
   *   - @prop {Point3d} angles     The rotation information
   */
  _polygonPrimitiveTransforms(regionShape) {
    const { topZ, bottomZ } = this.elevationZ;
    const { z, zHeight } = this.constructor.zDimensions(topZ, bottomZ);
    const opts = {
      center: Point3d.tmp,
      dims: Point3d.tmp,
      angles: Point3d.tmp,
    }

    const origin = regionShape.origin;
    opts.center.set(origin.x, origin.y, z);
    if ( regionShape.rotation ) opts.angles.set(0, 0, Math.toRadians(regionShape.rotation));
    else opts.angles.set(0, 0, 0);
    if ( regionShape.radius ) opts.dims.set(regionShape.radius, regionShape.radius, zHeight);
    else if ( regionShape.base?.width ) opts.dims.set(regionShape.base.width * canvas.grid.size, regionShape.base.height * canvas.grid.size, zHeight)
    else opts.dims.set(1, 1, zHeight);

    return opts;
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
    if ( regionShapes.some(regionShape => regionShape.hole) || this._updateFlags.levels || this.placeableDocument.restriction.enabled ) {
      // Each level shape array should contain a single polygon primitive.
      this.initialize();
      this.updateAllShapes();
      return;
    }

    // Use the passthrough tracking sets to determine updates for each region shape.
    let trackingArr = opts?.[GEOMETRY_LIB_ID] || [];
    trackingArr = trackingArr.map(arr => new Set(arr));


    // Go through each segment array and examine the shapes.
    // If no specific changes, re-do everything but don't rebuild shapes unless we have to.
    if ( trackingArr.length && shapes.length > regionShapes.length  ) {
      // Remove the extra shapes.
      for ( let i = regionShapes.length, iMax = shapes.length; i < iMax; i += 1 ) shapes[i].destroy();
      shapes.length = regionShapes.length;
    }

    for ( let i = 0, iMax = regionShapes.length; i < iMax; i += 1 ) {
      // Don't rebuild shapes unless we have to.
      const trackingSet = trackingArr[i]; // May be undefined.
      const needsRebuild = !shapes[i]
        || !(shapes[i] instanceof this.shapeClass(regionShapes[i]))
        || (trackingSet && (trackingSet.has("type") || trackingSet.has("points")));
      if ( needsRebuild ) {
        if ( shapes[i] ) shapes[i].destroy();
        shapes[i] = this._buildRegionShape(i);
        shapes[i].initialize();
        this._updateShape(shapes[i], regionShapes[i]);
        continue;
      }

      // Trigger elevation changes, which are based on the overall region change.
      if ( trackingSet && this._updateFlags.elevation ) trackingSet.add("elevation");

      // If no tracking set, update everything.
      // Otherwise, update selectively based on the tracking set.
      this._updateShape(shapes[i], regionShapes[i], trackingSet);
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
  _updateShape(shape, regionShape, changes) {
    const { topZ, bottomZ } = this.elevationZ;
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


  // blockSense handled by parent class.

  // isPresentAtLevel handled by parent class.

  // couldBlock handled by parent class.


  /**
   * Top and bottom elevation of a region.
   * @param {RegionDocument} regionDocument
   * @returns {object}
   * - @prop {number} topZ
   * - @prop {number} bottomZ
   */
  get elevationZ() {
    const elevs = super.elevationZ
    if ( !this.placeableDocument.elevation.topInclusive ) elevs.topZ -= 1; // Subtract 1 pixel if not inclusive.
    return elevs;
  }
}


