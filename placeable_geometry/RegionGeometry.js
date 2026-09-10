/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Geometry
import { PlaceableGeometry } from "./PlaceableGeometry.js";
import { CubePrimitive, CylinderPrimitive } from "./InstancedGeometricPrimitive.js";
import { ConePrimitive } from "./ConeGeometricPrimitive.js";
import { ExtrudedPolygonPrimitive, ExtrudedPolygonPrimitiveWithHoles } from "./ModelGeometricPrimitive.js";
import { EmptyGeometricPrimitive } from "./EmptyGeometricPrimitive.js";

// LibGeometry
import { GEOMETRY_LIB_ID } from "../const.js";
import { Point3d } from "../3d/Point3d.js";

/**
  Region will either be a single shape or a group of polygons.
  If more than one shape, treated as polygons.

  NOTE: Shapes can be destroyed/recreated without an update hook.
  Presumably, they are not getting changed without a hook.

  Regions store combined shapes as region.polygons.
*/

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

    ["shapes", "shapes"],
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
      shapes[i] = holes ? this._buildRegionShape(i, holes) : new EmptyGeometricPrimitive(this._shapeId(i));
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
    const shape = this._instantiateShape(regionShape, holeShapes, id);
    this.structuralSignatureMap.set(shape, this._getStructuralSignature(regionShape, holeShapes));
    shape.initialize();
    return shape;
  }

  /**
   * Intersect polygons against constraints
   * @param {PIXI.Polygon[]} polys
   * @param {PIXI.Polygon[]} constraints
   * @returns {PIXI.Polygon[]}
   */
  #intersectConstraints(polys, constraints) {
    const ClipperPaths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths;
    let polyPaths = ClipperPaths.fromPolygons(polys);
    for ( const constraint of constraints ) polyPaths = polyPaths.intersectPolygon(constraint);
    return polyPaths.clean().toPolygons();
  }

  /**
   * Instantiate the correct primitive shape based on constraints and type.
   * @param {RegionShape} regionShape
   * @param {RegionShape[]} holeShapes
   * @param {string} id
   * @param {GeometricPrimitive} Null if the shape cannot be instantiated (e.g., is empty)
   */
  _instantiateShape(regionShape, holeShapes, id) {
    const opts = this._shapeDimensions(regionShape);

    // 1. Wall Restricted.
    // If grid-restricted or wall-restricted, use ExtrudedPolygonPrimitive.
    if ( this.isWallRestricted && this.constructor.shapeIsWallRestricted(regionShape, this.placeableDocument) ) {
      // Must intersect the polygon against the constraints. Only the region.document.polygons are already constrained.
      // Batch all constraints into a single clipper object.
      const constraintPolys = this.placeableDocument._shapeConstraints.map(arr => new PIXI.Polygon(arr));
      const ixPolys = this.#intersectConstraints(regionShape.polygons, constraintPolys)
      if ( !ixPolys.length ) return new EmptyGeometricPrimitive(id);

      // Intersect hole polygons with constraints and clean, if applicable.
      let ixHolePolys = [];
      if ( holeShapes.length ) {
        const allHolePolygons = holeShapes.flatMap(h => h.polygons);
        ixHolePolys = this.#intersectConstraints(allHolePolygons, constraintPolys);
      }

      // Instantiate the appropriate primitive.
      // 1a. With holes.
      if ( ixHolePolys.length ) return ExtrudedPolygonPrimitiveWithHoles.fromPolygons(id, ixPolys, ixHolePolys, opts);

      // 1b. Without holes.
      return ExtrudedPolygonPrimitive.fromPolygons(id, ixPolys, opts);
    }

    // 2. Contains holes.
    if ( holeShapes.length ) {
      return ExtrudedPolygonPrimitiveWithHoles.fromPolygons(id, regionShape.polygons, holeShapes.flatMap(shape => shape.polygons), opts);
    }

    // 3. Grid constrained.
    if ( this.constructor.shapeIsGridConstrained(regionShape) ) return ExtrudedPolygonPrimitive.fromPolygons(id, regionShape.polygons, opts);

    // 4. Base primitive types. See shape.constructor.TYPES
    switch ( regionShape.type ) {
      case "circle":
      case "ellipse": return new CylinderPrimitive(id);

      case "line":
      case "rectangle": return new CubePrimitive(id);

      case "cone": return ConePrimitive.fromRegionShape(id, regionShape, opts);

       // Rings have holes built in, so use ExtrudedPolygonPrimitiveWithHoles.
      case "ring": return ExtrudedPolygonPrimitiveWithHoles.fromPolygons(id, regionShape.polygons, opts);

      // Other shapes use the basic extruded polygon shape.
      case "emanation":
      case "polygon":
      case "grid":
      case "token":

      default: return ExtrudedPolygonPrimitive.fromPolygons(id, regionShape.polygons, opts); /* eslint-disable-line no-fallthrough */
    }
  }

  _update() {
    console.debug(`RegionGeometry|_update ${this.placeableDocument.name} (${this.placeableId})`);

    if ( this.activeUpdates.has("shapes")
      || this.activeUpdates.has("wallRestriction")
      || this.activeUpdates.has("shapeConstraints") ) this._updateShapes();
    else if ( this.activeUpdates.has("elevation") ) {
      this.shapes.forEach((_shape, i) => this._updateShapeDimensions(i));
    }
    super._update();
  }

  /** @type {Map<GeometricPrimitive, string>} */
  structuralSignatureMap = new WeakMap();

  /**
   * Remove shapes when region shapes have been removed.
   */
  _updateShapes() {
    console.debug(`RegionGeometry|_updateShapes ${this.placeableDocument.name} (${this.placeableId})`);

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
      const holeGroup = groupedShapes[i];
      if ( !holeGroup ) {
        console.debug(`RegionGeometry|_updateShapes ${this.placeableDocument.name} (${this.placeableId})|Using empty (hole) for ${i}`);
        shapes[i] = new EmptyGeometricPrimitive(this._shapeId(i));
        continue;
      };

      // Check if the current shape is already correct.
      const regionShape = regionShapes[i];
      const newSignature = this._getStructuralSignature(regionShape, holeGroup);

      // Check pool for a matching structural signature.
      let reusedShape = null;
      for ( const potentialMatch of oldShapes ) {
        const oldSignature = this.structuralSignatureMap.get(potentialMatch);
        if ( !oldSignature ) { // Should not happen.
          console.warn(`RegionGeometry#_updateShapes|No old signature for ${potentialMatch.id}`, { newSignature, potentialMatch });
          continue;
        };
        if ( newSignature === oldSignature ) {
          reusedShape = potentialMatch;
          oldShapes.delete(potentialMatch);
          break;
        }
      }

      // Reuse or rebuild.
      if ( reusedShape ) {
        console.debug(`RegionGeometry|_updateShapes ${this.placeableDocument.name} (${this.placeableId})|Reusing shape for ${i}`);
        shapes[i] = reusedShape;
        shapes[i].id = this._shapeId(i); // Relabel to track the new shape index.
      } else {
        console.debug(`RegionGeometry|_updateShapes ${this.placeableDocument.name} (${this.placeableId})|Rebuilding shape for ${i}`);
        shapes[i] = this._buildRegionShape(i, holeGroup);
      }

      // Apply dimensional updates to the shape.
      this._updateShapeDimensions(i);
    }

    // Clean up any remaining unused shapes from the pool.
    oldShapes.forEach(shape => shape.destroy());

    // Should not be any nulls in the shape array.
    if ( this.shapes.some(shape => !shape) ) console.error(`RegionGeometry#_updateShapes|Some shapes in region ${this.placeableDocument.name} (${this.placeableDocument.id}) are null.`);
  }

  /**
   * Update a specific shape.
   * @param {number} shapeIdx
   * @param {Set<string>} [changeKeys]   Optional change keys; if not provided everything will be updated
   *   Adding a "elevation" key will update the position and scale.
   */
  _updateShapeDimensions(shapeIdx) {
    console.debug(`RegionGeometry|_updateShapeDimensions ${shapeIdx} ${this.placeableDocument.name} (${this.placeableId})`);
    const shape = this.shapes[shapeIdx];
    if ( !shape ) return;

    const regionShape = this.regionShapes[shapeIdx];
    const opts = this._shapeDimensions(regionShape);
    shape.setPosition(opts.center);
    shape.setRotation(opts.angles);
    shape.setScale(opts.dims);
    shape.setAnchor(opts.anchors);
  }


  // ----- NOTE: Shape dimensions ----- //


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

  // ----- NOTE: Shape change tracking ----- //

  /**
   * For each shape type, what properties force a rebuild?
   * Can ignore gridBased; handled elsewhere
   * If none, the shape is omitted.
   * @type {object<string[]>}
   */
  static STRUCTURAL_SIGNATURE_KEYS = {
    circle: [],
    ellipse: [],
    line: [],
    rectangle: [],
    emanation: ["radius"],
    ring: ["innerWidth", "outerWidth", "radius"],
    cone: ["angle", "curvature", "radius"],
    polygon: ["points"],
    grid: [],
    token: [],
  };


  /**
   * Generates a deterministic signature of properties that dictate shape geometry construction.
   * If this string changes, the geometry must be fully rebuilt.
   * Dimensional properties (x, y, rotation, scale, anchors) are intentionally excluded and
   * instead handled by the model matrix and the _shapeDimensions method.
   *
   * @param {RegionShape} regionShape
   * @param {RegionShape[]} holes
   * @returns {string}
   */
  _getStructuralSignature(regionShape, holes = []) {
    // Note: Translation (x, y) might change overlap status, correctly forcing a rebuild.
    const isRestricted = this.isWallRestricted && this.constructor.shapeIsWallRestricted(regionShape, this.placeableDocument);
    const parts = [
      regionShape.type,
      regionShape.isAffectedByGrid ? "grid" : "gridless",
      isRestricted ? "restricted" : "unrestricted",
    ];

    // Append type-specific properties that fundamentally alter the underlying geometry.
    parts.push(...this.constructor.STRUCTURAL_SIGNATURE_KEYS[regionShape.type].map(key => `${key}:${regionShape[key]}`));

    // Recursively append hole signatures.
    if ( holes.length ) {
      const holeStrings = holes.map(hole => this._getStructuralSignature(hole)); // eslint-disable-line no-unused-vars
      parts.push("holes:(${holeStrings.join('|')})");
    }
    return parts.join("|");
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


