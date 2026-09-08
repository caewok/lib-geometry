/* globals
canvas,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Geometry
import { PlaceableGeometry } from "./PlaceableGeometry.js";
import { CubePrimitive, CylinderPrimitive } from "./InstancedGeometricPrimitive.js";
import { ConePrimitive } from "./ConePrimitive.js";
import { ExtrudedPolygonPrimitive, ExtrudedPolygonPrimitiveWithHoles } from "./ModelGeometricPrimitive.js";

// LibGeometry
import { GEOMETRY_LIB_ID } from "../const.js";
import { Point3d } from "../3d/Point3d.js";
import { NULL_SET } from "../util.js";

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

/*
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
*/

// Some temporary points to use.
const tmpPoints = Point3d.createN(4);

export class RegionGeometry extends PlaceableGeometry {
  /** @type {string} */
  static PLACEABLE_NAME = "Region";

  /** @type {string} */
  static LAYER = "regions";

  static UPDATE_KEY_MAP = new Map([
    ...super.UPDATE_KEY_MAP,
    ["elevation.bottom", "elevation"],
    ["elevation.top", "elevation"],
    ["elevation.top.inclusive", "elevation"],

    ["restriction.enabled", "wallRestriction"],
    ["restriction.type", "wallRestriction"],
    ["restriction.priority", "wallRestriction"],

    ["_shapeConstraints", "shapeConstraints"],
  ]);

  get region() { return this.placeable; }

  get regionShapes() { return this.placeableDocument.shapes; }

  get regionPolygons() { return this.placeableDocument.polygons; }

  /**
   * Is this region currently restricted by walls? Ignores the scene rect.
   * @returns {boolean} True if restricted.
   */
  get isWallRestricted() {
    const regionD = this.placeableDocument;
    if ( !this.constructor.wallRestricted(regionD) ) return false;

    const sc = regionD._shapeConstraints;
    if ( sc.length !== 1 || sc[0].length !== 8 ) return true; // Simple canvas bounds would be 8 points.
    const canvasArr = canvas.scene.dimensions.rect.toPolygon().points;
    return !sc[0].equals(canvasArr);
  }

  /**
   * Is this shape currently restricted by walls?
   * Presumes without test that isWallRestricted returns true; test this separately.
   * @param {RegionShape} regionShape
   * @returns {boolean} True if restricted.
   */
  static shapeIsWallRestricted(regionShape, regionD) {
    if ( !regionD._shapeConstraints ) return false;
    const restrictionBounds = regionD._shapeConstraints.map(constraintArr => new PIXI.Polygon(constraintArr));
    for ( const r of restrictionBounds ) {
      for ( const poly of regionShape.polygons ) {
        if ( poly.overlaps(r) ) return true;
      }
    }
    return false;
  }

  /**
   * Is this shape a hole?
   * @param {RegionShape} regionShape
   * @returns {boolean} True if hole.
   */
  static shapeIsHole(regionShape) { return regionShape.hole; }

  /**
   * Is this shape constrained by the grid?
   * @param {RegionShape} regionShape
   * @returns {boolean} True if restricted.
   */
  static shapeIsGridConstrained(regionShape) { return regionShape.isAffectedByGrid; }

  /**
   * Multiple shapes may be used to construct region shapes. If so, CombinedGeometricPrimitive should be used.
   * Shapes are linked to a given region shape by their shape id.
   */

  /**
   * Id, taking into account the shape index
   * @param {number} shapeIdx
   * @returns {string}
   */
  _shapeId(shapeIdx) { return `${this.placeableId}_${shapeIdx}`; }

  /**
   * Get the shape index for a shape. Uses the id.
   * @param {GeometricPrimitive}
   * @returns {number}
   */
  _shapeIndex(shape) { return Number(shape.id.split("_").at(-1)); }

  initialize() {
    console.debug(`RegionGeometry|initialize ${this.placeableDocument.name} (${this.placeableId})`);
    this.createShapes();
    super.initialize();
  }

  updateAllShapes() {
    console.debug(`RegionGeometry|updateAllShapes ${this.placeableDocument.name} (${this.placeableId})`);
    for ( let i = 0, iMax = this.shapes.length; i < iMax; i += 1 ) this._updateShapeDimensions(i);
  }

  createShapes() {
    console.debug(`RegionGeometry|createShapes ${this.placeableDocument.name} (${this.placeableId})`);
    const regionShapes = this.regionShapes;
    const shapes = this.shapes;
    this.shapes.forEach(subshape => subshape?.destroy());

    // If no shapes for this region, return.
    const n = regionShapes.length;
    if ( n === 0 ) {
      shapes.length = 0;
      return;
    }

    // Identify holes, if any.
    const groupedShapes = this._groupShapesAndHoles();

    // Create a primitive shape for each region shape.
    this.shapes.length = n;
    for ( let i = 0; i < n; i += 1 ) {
      const holes = groupedShapes[i];
      shapes[i] = holes ? this._buildRegionShape(i, holes) : null;
    }
    return shapes;
  }

  /**
   * Parses region shapes to group base shapes with their associated holes
   * @returns {object[RegionShape[]|null]} Array of arrays, with each subarray holding
   *   holes for the shape at that index. If no shape for that index, null.
   */
  _groupShapesAndHoles() {
    const n = this.regionShapes.length;
    const grouped = new Array(n).fill(null);
    let currentBaseIdx = -1;
    for ( let i = 0; i < n; i += 1 ){
      const regionShape = this.regionShapes[i];
      if ( this.constructor.shapeIsHole(regionShape) ) {
        if ( ~currentBaseIdx ) grouped[currentBaseIdx].push(regionShape);
      } else {
        currentBaseIdx = i;
        grouped[i] = [];
      }
    }
    return grouped;
  }

  /**
   * Construct primitive shapes for a given region shape.
   * @param {number} idx        Index of the region shape in the region.document.shapes array
   * @param {object} shapeGroup
   *   - @prop {RegionShape} shape
   *   - @prop {RegionShape[]} holes
   * @returns {GeometricPrimitive[]}
   */
  _buildRegionShape(shapeIdx, holeShapes = []) {
    console.debug(`RegionGeometry|_buildRegionShape ${this.placeableDocument.name} (${this.placeableId})`);
    const regionShape = this.regionShapes[shapeIdx];

    // If holes, use ExtrudedPolygonPrimitiveWithHoles.
    const id = this._shapeId(shapeIdx);
    const opts = this._shapeDimensions(regionShape);
    let shape;

    // If grid-restricted or wall-restricted, use ExtrudedPolygonPrimitive.
    if ( this.isWallRestricted && this.constructor.shapeIsWallRestricted(regionShape, this.placeableDocument) ) {
      // Must intersect the polygon against the constraints. Only the region.document.polygons are already constrained.
      // TODO: Convert all this to ClipperPaths to avoid the back-and-forth conversions.
      let ixPolys = [...regionShape.polygons];
      const constraintPoly = new PIXI.Polygon();
      for ( let i = 0, n = ixPolys.length; i < n; i += 1 ) {
        for ( const constraintArr of this.placeableDocument._shapeConstraints ) {
          constraintPoly.points = constraintArr;
          ixPolys[i] = ixPolys[i].intersectPolygon(constraintPoly);
        }
      }

      // Clean polygons.
      ixPolys = ixPolys.filter(poly => {
        poly.clean();
        return poly.points.length > 7;
      });

      if ( holeShapes.length ) {
        for ( let i = 0, n = holeShapes.length; i < n; i += 1 ) {
          for ( const constraintArr of this.placeableDocument._shapeConstraints ) {
            constraintPoly.points = constraintArr;
            holeShapes[i] = holeShapes[i].intersectPolygon(constraintPoly);
          }
        }
        shape = ExtrudedPolygonPrimitiveWithHoles.fromPolygons(
          id,
          [ixPolys, ...holeShapes.flatMap(shape => shape.polygons)],
          opts
        );

      } else shape = ExtrudedPolygonPrimitive.fromPolygons(id, ixPolys, opts);
    }

    else if ( holeShapes.length ) shape = ExtrudedPolygonPrimitiveWithHoles.fromPolygons(
      id,
      [regionShape.polygons, ...holeShapes.flatMap(shape => shape.polygons)],
      opts
    );

    else if ( this.constructor.shapeIsGridConstrained(regionShape) ) shape = ExtrudedPolygonPrimitive.fromPolygons(id, regionShape.polygons, opts);

    // Otherwise, select a shape.
    else switch ( regionShape.type ) {
      // See shape.constructor.TYPES
      case "circle":
      case "ellipse": shape = new CylinderPrimitive(id); break;

      case "line":
      case "rectangle": shape = new CubePrimitive(id); break;

      case "cone": shape = ConePrimitive.fromRegionShape(id, regionShape, opts); break;

       // Rings have holes built in, so use ExtrudedPolygonPrimitiveWithHoles.
      case "ring": shape = ExtrudedPolygonPrimitiveWithHoles.fromPolygons(id, regionShape.polygons, opts); break;

      case "emanation":
        // Use the polygon b/c corner radiuses can vary.
        // base.x, base.y, rotation, base.width (# grid spaces), base.height (# grid spaces), origin

      case "polygon": /* eslint-disable-line no-fallthrough */
        // Obv. use the polygon.
        // rotation, although not user-set, origin

      case "grid": /* eslint-disable-line no-fallthrough */
        // Unclear what this is.

      case "token": /* eslint-disable-line no-fallthrough */
        // Unclear what this is.

      default: shape = ExtrudedPolygonPrimitive.fromPolygons(id, regionShape.polygons, opts); /* eslint-disable-line no-fallthrough */
    }
    shape.initialize();
    return shape;
  }

  _update(opts) {
    console.debug(`RegionGeometry|_update ${this.placeableDocument.name} (${this.placeableId})`);

    // If no opts object, then just update all without rebuilding anything.
    if ( !opts ) return this.updateAllShapes();

    /*
    There is currently no (easy) way to tell if a shape is otherwise the same but for a position/rotation/scale change.
    Editing a shape results in a new shape, and the update hook shows all the shape properties as changed.
    The current work-around is a preupdate hook that passes through an array of changes to the specific shapes.
    */

    // If there are holes, use the model polygon shape for the entire region.
    // Because a change to any shape could change the model polygon for the region, just
    // redo everything.
    // Similarly, if the region's levels changed, redo everything.
    if ( this.regionShapes.some(regionShape => regionShape.hole) || this.placeableDocument.restriction.enabled ) {
      // Each level shape array should contain a single polygon primitive.
      this.initialize();
      this.updateAllShapes();
      return;
    }

    this._updateShapes(opts);

    // Handle parent updates last.
    super._update(opts);
  }

  /**
   * Remove shapes when region shapes have been removed.
   */
  _updateShapes(opts) {
    console.debug(`RegionGeometry|_updateShapes ${this.placeableDocument.name} (${this.placeableId})`);
    let trackingArr = opts?.[GEOMETRY_LIB_ID] || [];
    trackingArr = trackingArr.map(arr => new Set(arr));

    const { shapes, regionShapes } = this;
    const numRegionShapes = regionShapes.length;

    // Determine the shape/hole grouping.
    const groupedShapes = this._groupShapesAndHoles();

    // For each shape, a mis-matched class indicates either the shape was changed
    // or a shape prior to it was deleted. Reuse shapes where possible, creating new as needed and
    // deleting shapes as necessary.
    // Create a pool of existing shapes available for reuse, and reset this.shapes.
    const oldShapes = new Set(shapes);
    shapes.length = numRegionShapes;
    shapes.fill(null);

    for ( let i = 0; i < numRegionShapes; i += 1 ) {

      // If the shape is just a hole, no primary shape to create or update.
      if ( !groupedShapes[i] ) continue;


      // Check if the current element is already correct.
      const regionShape = regionShapes[i];
      const mustRebuild = this._mustRebuild(regionShape, trackingArr[i]);
      let reusedShape;

      if ( !mustRebuild ) {
        for ( const potentialMatch of oldShapes ) {
          if ( this._shapeClassMatchesRegionShape(potentialMatch, regionShape) ) {
            reusedShape = potentialMatch;
            oldShapes.delete(potentialMatch);
            break;
          }
        }
      }

      if ( reusedShape ) {
        shapes[i] = reusedShape;
        shapes[i].id = this._shapeId(i); // Relabel to track the new shape index.
      } else shapes[i] = this._rebuildShape(i, groupedShapes[i]);

      // Apply dimensional updates to the shape.
      this._updateShapeDimensions(i, trackingArr[i]);
    }

    // Clean up any remaining unused shapes from the pool.
    oldShapes.forEach(shape => shape.destroy());
  }

  /**
   * Rebuild an existing shape.
   * @param {number} i          The index of the shape in the array.
   */
  _rebuildShape(i, holes) {
    console.debug(`RegionGeometry|_rebuildShape ${i} ${this.placeableDocument.name} (${this.placeableId})`);
    const shapes = this.shapes;
    if ( shapes[i] )  shapes[i].destroy();

    if ( !holes ) holes = this._groupShapesAndHoles()[i];

    shapes[i] = holes ? this._buildRegionShape(i, holes) : null;
    this._updateShapeDimensions(i);
  }

  /**
   * Update a specific shape.
   * @param {number} shapeIdx
   * @param {Set<string>} [changeKeys]   Optional change keys; if not provided everything will be updated
   *   Adding a "elevation" key will update the position and scale.
   */
  _updateShapeDimensions(shapeIdx, changes) {
    console.debug(`RegionGeometry|_updateShapeDimensions ${shapeIdx} ${this.placeableDocument.name} (${this.placeableId})`);
    const shape = this.shapes[shapeIdx];
    if ( !shape ) return;

    const regionShape = this.regionShapes[shapeIdx];
    changes ??= this._allChanges(regionShape);

    if ( this.activeUpdates.has("elevation") ) changes.add("elevation");

    const { modifyCenter, modifyAngles, modifyDims, modifyAnchors } = this._shapeDimensionModificationsNeeded(regionShape, changes);
    if ( !(modifyCenter || modifyAngles || modifyDims || modifyAnchors) ) return;
    const opts = this._shapeDimensions(regionShape);

    if ( modifyCenter ) shape.setPosition(opts.center);
    if ( modifyAngles ) shape.setRotation(opts.angles);
    if ( modifyDims ) shape.setScale(opts.dims);
    if ( modifyAnchors ) shape.setAnchor(opts.anchors);
  }

  /**
   * For a given set of changes for a region shape, is a rebuild needed no matter what?
   * In other words, could we simply update or swap shapes or does this shape need to be rebuilt entirely from scratch?
   * @param {RegionShape} regionShape
   * @param {Set<string>} changes
   */
  _mustRebuild(regionShape, changes) {
    // If the shape is grid-based or wall-restricted, it is a polygon that must be rebuilt.
    if ( this.activeUpdates.has("shapeConstraints")
      && this.isWallRestricted && this.constructor.shapeIsWallRestricted(regionShape) ) return true;

    if ( this.constructor.shapeIsGridConstrained(regionShape) && changes.has("gridBased") ) return true;

    // Some types need to be rebuilt when certain parameters change, causing the underlying shape to warp.
    switch ( regionShape.type ) {
      case "cone": return changes.has("angle") || changes.has("curvature") || changes.has("radius");
      case "emanation": return changes.has("radius");
      case "ring": return changes.has("innerWidth") || changes.has("outerWidth") || changes.has("radius");


      case "polygon": return changes.has("points");
    }
    return false;
  }

  /**
   * For a given shape index and change set, does this shape need to be rebuilt entirely?
   * @param {number} shapeIdx
   * @param {Set<string>} changes
   * @returns {boolean}
   */
  _shapeClassMatchesRegionShape(shape, regionShape) {
    switch ( regionShape.type ) {
      case "circle":
      case "ellipse": return shape instanceof CylinderPrimitive;

      case "line":
      case "rectangle": return shape instanceof CubePrimitive;

      case "cone": return shape instanceof ConePrimitive;

      default: return false;
    }
  }

  _allChanges(regionShape) {
    const changes = new Set(Object.keys(regionShape));
    changes.add("elevation");
    changes.add("anchorX"); // Only used for some.

    // Emanation has a base with additional values.
    if ( changes.has("base") ) Object.keys(regionShape.base).forEach(key => changes.add(`base.${key}`));
    return changes;
  }

  /**
   * Determine what dimensions of the shape require modification.
   * @param {ShapeData} regionShape       The region shape; assumed to have been already updated
   * @param {Set<string>} [changes]         Optional change keys; if not provided everything will be updated
   *   Adding a "elevation" key will update the position and scale.
   * @returns {object}
   *   - @prop {boolean} modifyCenter
   *   - @prop {boolean} modifyAngles
   *   - @prop {boolean} modifyDims
   *   - @prop {boolean} modifyAnchors
   */
  _shapeDimensionModificationsNeeded(regionShape, changes) {
    changes ??= this._allChanges(regionShape);
    const modifyCenter = changes.has("x") || changes.has("y") || changes.has("elevation");
    const modifyAngles = changes.has("rotation");
    let modifyDims = false;
    let modifyAnchors = false;

    switch ( regionShape.type ) {
      case "circle": modifyDims = changes.has("radius") || changes.has("elevation"); break;
      case "ellipse": modifyDims = changes.has("radiusX") || changes.has("radiusY") || changes.has("elevation"); break;
      case "line":
        modifyDims = changes.has("length") || changes.has("width") || changes.has("elevation");
        modifyAnchors = changes.has("anchorX");
        break;
      case "rectangle":
        modifyDims = changes.has("width") || changes.has("height") || changes.has("elevation")
        modifyAnchors = changes.has("anchorX") || changes.has("anchorY");
        break;
      case "emanation": modifyDims = changes.has("base.width") || changes.has("base.height") || changes.has("elevation"); break;
      case "ring":
      case "cone": modifyDims = changes.has("radius") || changes.has("elevation"); break;

      case "polygon": break; // Obv. use the polygon. Dimensions set by the points.
      case "grid": break; // Unclear what this is.
      case "token": break; // Unclear what this is.
    }
    return { modifyCenter, modifyAngles, modifyDims, modifyAnchors };
  }

  /**
   * Determine the dimensions for a given shape.
   * @param {ShapeData} regionShape      The region shape; assumed to have been already updated
   * @returns {object} Center (position), angles, dims, anchors, using the temporary points.
   */
  _shapeDimensions(regionShape) {
    const { topZ, bottomZ } = this.elevationZ;
    const { z, zHeight } = this.constructor.zDimensions(topZ, bottomZ);
    const [center, angles, dims, anchors] = tmpPoints;

    // Center/Position: Use regionShape.origin
    const origin = regionShape.origin;
    center.set(origin.x, origin.y, z);

    // All shapes have rotation.
    angles.set(0, 0, Math.toRadians(regionShape.rotation));

    // Set defaults for dims and anchors.
    dims.set(1, 1, 1);
    anchors.set(0, 0, 0);

    // Update dims by shape type. Update anchor for specific shapes.
    switch ( regionShape.type ) {
      case "circle": dims.set(regionShape.radius * 2, regionShape.radius * 2, zHeight); break;
      case "ellipse": dims.set(regionShape.radiusX * 2, regionShape.radiusY * 2, zHeight); break;
      case "line":
        dims.set(regionShape.length, regionShape.width, zHeight);
        anchors.set(0.5, 0.0, 0.0); // Line anchors from middle left.
        break;
      case "rectangle":
        dims.set(regionShape.width, regionShape.height, zHeight);

        // Rectangle anchors from user-defined position.
        // Those represent percentage anchors from 0Ð1. Conform to the unit cube from -0.5 to 0.5.
        anchors.set(0.5 - regionShape.anchorX, 0.5 - regionShape.anchorY, 0);
        break;

      // Rest use polygons
      case "emanation": { // Use the polygon b/c corner radiuses can vary.
        const { width, height } = regionShape.base;
        const s = canvas.grid.size;
        dims.set(width * s, height * s, zHeight);
        break;
      }

      case "ring": // Use the polygon(s) b/c of the hole.
      case "cone": // Use the polygon b/c no unit cone shape b/c angle varies.
        dims.set(regionShape.radius, regionShape.radius, zHeight);
        break;

      case "polygon": break; // Obv. use the polygon. Dimensions set by the points.

      case "grid": break; // Unclear what this is.

      case "token": break; // Unclear what this is.
    }

    return { center, angles, dims, anchors, topZ, bottomZ };
  }


  // ----- NOTE: Levels ----- //


  // blockSense handled by parent class.

  // isPresentAtLevel handled by parent class.

  // couldBlock handled by parent class.


  /**
   * Top and bottom elevation of a region.
   * @returns {object}
   * - @prop {number} topZ
   * - @prop {number} bottomZ
   */
  get elevationZ() {
    const elevs = super.elevationZ
    if ( !this.constructor.topInclusive(this.placeableDocument) ) elevs.topZ -= 1; // Subtract 1 pixel if not inclusive.
    return elevs;
  }

  // ------ NOTE: Static property retrieval ----- //

  /**
   * Is this region restricted by walls?
   * @param {RegionDocument} regionD
   * @returns {boolean}
   */
  static wallRestricted(regionD) { return regionD.restriction.enabled; }

  /**
   * Does this region include its top elevation?
   * @param {RegionDocument} regionD
   * @returns {boolean}
   */
  static topInclusive(regionD) { return regionD.elevation.topInclusive; }
}


