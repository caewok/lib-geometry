/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Primitives
import { PlaceableGeometry } from "./PlaceableGeometry.js";
import { CubePrimitive, CylinderPrimitive, CircularCylinderPrimitive } from "./InstancedGeometricPrimitive.js";
import { ConePrimitive } from "./ConeGeometricPrimitive.js";
import { ExtrudedPolygonPrimitive, ExtrudedPolygonPrimitiveWithHoles } from "./ModelGeometricPrimitive.js";
import { HoledPrimitive } from "./HoledGeometricPrimitive.js";
import { RingPrimitive } from "./RingGeometricPrimitive.js";
import { CombinedGeometricPrimitive } from "./CombinedGeometricPrimitive.js";

// LibGeometry
import { GEOMETRY_LIB_ID } from "../const.js";
import { Point3d } from "../3d/Point3d.js";
import { gridUnitsToPixels } from "../util.js";
import { Polygons3d } from "../3d/Polygon3d.js";
import { CutawayPolygon } from "../CutawayPolygon.js";


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

  // ----- NOTE: Basic getters ----- //

  get region() { return this.placeable; }

  get regionShapes() { return this.placeableDocument.shapes; }

  get regionPolygons() { return this.placeableDocument.polygons; }

  get polygonTree() { return this.placeableDocument.polygonTree; }

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
   * Get the region shape polygons.
   * If the region is a polygon, first simplify using Clipper to ensure no complex (self-intersecting) polygons.
   * @param {RegionShape} regionShape
   * @returns {PIXI.Polygon[]}
   */
  regionShapePolygons(regionShape) {
    if ( regionShape.type !== "polygon" ) return regionShape.polygons;
    const ClipperPaths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths;
    const cPaths = ClipperPaths.fromPolygons(regionShape.polygons);
    return cPaths.simplifyPolygons().toPolygons();
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


  // ----- NOTE: Shape Creation ----- //

  /**
   * Representation of region shape at each index.
   * Each shape may be combined with others, e.g. to create solid/hole islands.
   * These get stored in the shapes property for the geometry.
   * @type {GeometricPrimitive} The primitive shape corresponding to each region shape.
   *   Should be marked as isHole if the region shape is a hole.
   */
  baseShapes = [];

  createShapes() {
    console.debug(`RegionGeometry|createShapes ${this.placeableDocument.name} (${this.placeableId})`);
    const regionShapes = this.regionShapes;

    this._createBaseShapes();
    this._createShapesFromBaseShapes();

    // Track whether base shapes must be recreated by storing a signature linked to each.
    // (Cannot use the region shape as a key because it changes when any shape in the region is updated.)
    this.baseShapes.forEach((baseShape, idx) => this.structuralSignatureMap.set(baseShape, this._getStructuralSignature(regionShapes[idx])));
  }

  /**
   * Create base shapes from region shapes.
   */
  _createBaseShapes() {
    const regionShapes = this.regionShapes;
    const baseShapes = this.baseShapes;

    // Clear the old base shapes.
    baseShapes.forEach(subshape => subshape?.destroy());

    // Each base shape corresponds to a region shape.
    const n = regionShapes.length;
    baseShapes.length = n;
    for ( let i = 0; i < n; i += 1 ) {
      baseShapes[i] = this._createBaseShape(i);
      this._updateShapeDimensions(i);
    }
  }

  /**
   * Create a geometric primitive representing the region shape at the given index.
   * @param {number} i      Index of the region shape in region.document.shapes
   * @returns {GeometricPrimitive}
   */
  _createBaseShape(i) {
    const regionD = this.placeableDocument;
    const id = this._shapeId(i);
    const regionShape = this.regionShapes[i];
    const baseMethod = (this.constructor.shapeIsGridConstrained(regionShape)
      || this.constructor.shapeIsWallRestricted(regionShape, regionD))
      ? "_instantiateRestrictedBaseShape" : "_instantiateBasicBaseShape";
    const out = this[baseMethod](id, regionShape);
    if ( regionShape.hole ) out.reverseOrientation();
    return out;
  }

  /**
   * Create shapes from the base shapes, accounting for holes.
   */
  _createShapesFromBaseShapes() {
    const regionShapes = this.regionShapes;
    const baseShapes = this.baseShapes;
    const shapes = this.shapes;

    // Clear the old shapes, keeping HolePrimitives. Don't destroy shapes b/c either a reused base shape or a HolePrimitive.
    const oldShapes = new Set();
    for ( const shape of shapes ) {
      if ( shape.is("HoledPrimitive") ) oldShapes.add(shape);
    }
    shapes.length = 0;

    // If no holes, we can just use the base shapes as the final primitive shapes.
    const hasHoles = regionShapes.some(shape => shape.hole);
    const numBaseShapes = this.baseShapes.length;
    if ( !hasHoles ) {
      shapes.length = numBaseShapes;
      for ( let i = 0; i < numBaseShapes; i += 1 ) shapes[i] = baseShapes[i];
      oldShapes.forEach(oldShape => oldShape.destroy(false));
      return;
    }

    // For each solid shape, combine with any overlapping holes.
    // (Contained holes are handled using islands, below.)
    const { pixiShapes, combinedBaseShapes } = this.#processOverlappingHoles();

    // Now figure out which region shape holes correspond to which solid islands to build the actual shapes.
    // Get the 2d shape for each base shape. Need the model shape.
    const holeIndices = new Set(combinedBaseShapes.map((shape, idx) => shape.isHole ? idx : -1));
    // holeIndices.delete(-1); // Can skip this because buildIslands will ignore it.
    const islands = Polygons3d.buildIslands(pixiShapes, holeIndices);

    // Actual shapes use HoledPrimitive to combine with holes, linking to the base geometric shapes.
    // Build a shape for each islandÑeither the primitive or a combined.
    for ( const island of islands ) {
      let shape;
      const solid = combinedBaseShapes[island.solidIndex];
      if ( island.holeIndices.length ) {
        for ( shape of oldShapes ) {
          if ( shape.solid === solid ) { oldShapes.delete(shape); break; }
        }
        const id = `${this._shapeId(island.solidIndex)}_island}`;

        // For either the new or existing primitive, update the solid and holes.
        shape ??= new HoledPrimitive(id)
        shape.replaceSolid(solid);
        const holes = island.holeIndices.map(idx => baseShapes[idx]);
        holes.forEach(hole => shape.addHole(hole))

      } else shape = solid;
      shapes.push(shape)
    }
    oldShapes.forEach(oldShape => oldShape.destroy(false));
  }

  /**
   * For each solid shape, determine if one or more holes overlap but are not contained by it.
   * Combine these using Clipper to form 1+ solid polygons.
   * Track index to reuse base shapes where possible.
   * Contained holes handled separately, using islands.
   * @returns {object}
   *   - @prop {(PIXI.Polygon|PIXI.Ellipse|PIXI.Circle|PIXI.Circle)[]} pixiShapes       2d polygons: 1 for each base shape + any extra solids or holes
   *   - @prop {GeometricPrimitive[]} combinedBaseShapes                                Either original base shapes or newly combined extruded polygons
   */
  #processOverlappingHoles() {
    const baseShapes = this.baseShapes;
    const numBaseShapes = this.baseShapes.length;
    const pixiShapes = baseShapes.map(shape => shape.toPIXIShape());
    const overlappingHoleIndices = Array.from({ length: 5 }, () => []);
    for ( let i = 0; i < numBaseShapes; i += 1 ) {
      if ( baseShapes[i].isHole ) continue;
      const solid = pixiShapes[i];
      for ( let j = 0; j < numBaseShapes; j += 1 ) {
        if ( !baseShapes[j].isHole ) continue;
        const hole = pixiShapes[j];
        if ( solid.overlaps(hole) && !solid.envelops(hole) ) overlappingHoleIndices[i].push(j);
      }
    }

    // For each solid with overlapping holes, create new solids and holes.
    const combinedBaseShapes = [];
    const polys2d = pixiShapes.map(shape2d => shape2d.toPolygon());
    for ( let i = 0; i < numBaseShapes; i += 1 ) {
      // Non-polygon PIXI shapes do not have isPositive/hole property, so add after conversion to 2d polygon.
      if ( polys2d[i].isPositive ^ !baseShapes[i].isHole ) polys2d[i].reverseOrientation();
    }

    for ( let i = 0; i < numBaseShapes; i += 1 ) {
      combinedBaseShapes[i] = baseShapes[i];
      const holeIndices = overlappingHoleIndices[i];
      if ( !holeIndices.length ) continue;

      // Combine the solid with its holes.
      const solid = polys2d[i];
      const combinedPolys = this.#subtractHoles([solid.toPolygon()], holeIndices.map(idx => polys2d[idx]));

      // Sort by solid, then area. The largest solid is the primary for this shape.
      combinedPolys.sort((a, b) => (a.isPositive - b.isPositive) || (a.area - b.area));
      pixiShapes[i] = combinedPolys[0];
      pixiShapes.push(...combinedPolys.slice(1));
      let solids = [];
      let holes = [];
      combinedPolys.forEach(poly => poly.isPositive ? solids.push(poly) : holes.push(poly));
      const hasHoles = holes.length;

      // The first solid (island) replaces the base shape at that index.
      if ( solids.length ) combinedBaseShapes[i] = hasHoles
          ? ExtrudedPolygonPrimitiveWithHoles.fromPolygon(`${baseShapes[i].id}_combined_holes`, solids[0], holes)
            : ExtrudedPolygonPrimitive.fromPolygon(`${baseShapes[i].id}_combined`, solids[0]);

      // Additional solids (islands) are added at the end.
      for ( let j = 1, n = solids.length; j < n; i += 1 ) {
        combinedBaseShapes.push(hasHoles
          ? ExtrudedPolygonPrimitiveWithHoles.fromPolygon(`${baseShapes[i].id}_combined_holes`, solids[j], holes)
            : ExtrudedPolygonPrimitive.fromPolygon(`${baseShapes[i].id}_combined`, solids[j]));
      }
    }
    return { pixiShapes, combinedBaseShapes };
  }

  /**
   * Use the region shape polygons along with wall constraints to create the base shape for a region shape.
   * Handles wall restrictions, grid constraints, or both.
   * @param {string} id                 The base id for this region shape.
   * @param {RegionShapeData} regionShape
   * @returns {GeometricPrimitive}
   */
  _instantiateRestrictedBaseShape(id, regionShape) {
    let polys = this.regionShapePolygons(regionShape);
    if ( this.placeableDocument._shapeConstraints ) {
      const constraintPolys = this.placeableDocument._shapeConstraints.map(arr => new PIXI.Polygon(arr));
      const polys = this.#intersectConstraints(polys, constraintPolys);
    }

    // Should only be either:
    // (a) single polygon
    // (b) polygon + hole polygon (ring)
    // (c) multiple solid polygons (self-intersecting polygon, cleaned)

    let opts = this._shapeDimensions(regionShape);
    if ( regionShape.type === "ring" ) opts = opts.outer;
    let out;
    if ( polys.length === 1 ) out = ExtrudedPolygonPrimitive.fromPolygon(id, polys[0], opts)
    else if ( !polys[1].isPositive ) {
      // Solid and 1+ holes.
      const solid = ExtrudedPolygonPrimitive.fromPolygon(`${id}_0`, solid);
      const holes = polys.slice(1).map((poly, i) => ExtrudedPolygonPrimitive.fromPolygon(`${id}_${i + 1}`, poly, opts));
      out = new HoledPrimitive(id, solid, holes);
    } else {
      // 2+ solids.
      const solids = polys.map((poly, i) => ExtrudedPolygonPrimitive.fromPolygon(`${id}_${i}`, poly, opts));
      out = CombinedGeometricPrimitive.combine(id, solids);
    }
    if ( regionShape.hole ) out.reverseOrientation();
    return out;
  }

  /**
   * Create a base geometric primitive shape for the region, ignoring any wall restrictions or grid constraints.
   * @param {string} id                 The base id for this region shape.
   * @param {RegionShapeData} regionShape
   * @returns {GeometricPrimitive}
   */
  _instantiateBasicBaseShape(id, regionShape) {
    let out;
    // See shape.constructor.TYPES
    switch ( regionShape.type ) {
      case "circle": out = new CircularCylinderPrimitive(id); break;
      case "ellipse": out = new CylinderPrimitive(id); break;

      case "line":
      case "rectangle": out = new CubePrimitive(id); break;

      case "cone": {
        // For flat cones, just create an extruded triangle.
        const angle = regionShape.angle;
        if ( regionShape.type === "flat" ) out =  ConePrimitive.createFlatPrimitive(id, angle);
        else out = ConePrimitive.create(id, angle, { curvature: regionShape.curvature, density: PIXI.Circle.approximateVertexDensity(regionShape.radius) });
        break;
      }

       // Rings have holes built in, so use ExtrudedPolygonPrimitiveWithHoles.
      case "ring": out = RingPrimitive.create(id); break;

      // Other shapes use the basic extruded polygon shape.
      case "emanation":
      case "polygon":
      case "grid":
      case "token":

      default: { /* eslint-disable-line no-fallthrough */
        const opts = this._shapeDimensions(regionShape);
        out = ExtrudedPolygonPrimitive.fromPolygon(id, this.regionShapePolygons(regionShape)[0], opts);
        break;
      }
    }
    if ( regionShape.hole ) out.reverseOrientation();
    return out;
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
   * Subtract hole polygons from solid polygons using Clipper.
   * @param {PIXI.Polygon|PIXI.Circle|PIXI.Ellipse[]} solids
   * @param {PIXI.Polygon|PIXI.Circle|PIXI.Ellipse[]} holes
   * @returns {PIXI.Polygon[]} Object containing solid and hole polygons.
   */
  #subtractHoles(solids, holes) {
    // Only required if a solid overlaps but does not envelop a hole.
    // Calculate boolean difference (solid - hole).
    const ClipperPaths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths;
    const solidPaths = ClipperPaths.fromPolygons(solids);
    const holePaths = ClipperPaths.fromPolygons(holes);
    return holePaths
      .diffPaths(solidPaths)
      .clean()
      .toPolygons();
  }

  // ----- NOTE: Shape Updating -----

  _update() {
    console.debug(`RegionGeometry|_update ${this.placeableDocument.name} (${this.placeableId})`);

    if ( this.activeUpdates.has("shapes")
      || this.activeUpdates.has("wallRestriction")
      || this.activeUpdates.has("shapeConstraints") ) {

      const { deleted, added } = this._updateBaseShapes();

      // For deleted shapes, remove from any parent and destroy.
      for ( const deletedShape of deleted ) {
        if ( !deletedShape.parent ) continue;
        deletedShape.parent.removeChild(deletedShape);
        deletedShape.destroy();
      }
      this._updateTransforms();
      if ( deleted.size || added.size ) this._createShapesFromBaseShapes();

    } else if ( this.activeUpdates.has("elevation") ) this._updateTransforms();

    super._update();
  }

  /**
   * The base shape array is smaller than the region shape array: remove shapes deleted by user.
   * Unfortunately, FoundryVTT will not tell us explicitly, so we have to infer.
   * Changes the base shape array in place.
   */
  _updateBaseShapes() {
    const regionShapes = this.regionShapes;
    const baseShapes = this.baseShapes;
    const numRegionShapes = regionShapes.length;

    // For each shape, a mis-matched signature indicates either the shape was changed or
    // one before it was deleted. Reuse shapes where possible.
    const added = new Set();
    const oldShapes = new Set(baseShapes);
    for ( let i = 0; i < numRegionShapes; i += 1 ) {
       // Check if the current shape is already correct.
      const regionShape = regionShapes[i];
      const newSignature = this._getStructuralSignature(regionShape);
      let reusedShape = null;
      for ( const potentialMatch of oldShapes ) {
        const oldSignature = this.structuralSignatureMap.get(potentialMatch);
        if ( newSignature === oldSignature ) {
          reusedShape = potentialMatch;
          oldShapes.delete(potentialMatch);
          break;
        }
      }

      if ( reusedShape ) {
        reusedShape.id = this._shapeId(i); // Relabel to track the new shape index.
        baseShapes[i] = reusedShape;
      } else {
        const baseShape = this._createBaseShape(i);
        this._updateShapeDimensions(i);
        added.add(baseShape);
        baseShapes[i] = baseShape;
      }
      this.structuralSignatureMap.set(baseShapes[i], newSignature);
    }

    // Truncate baseShapes in case shapes were deleted.
    baseShapes.length = numRegionShapes;
    return { deleted: oldShapes, added };
  }

  _updateTransforms() {
    this.baseShapes.forEach((shape, i) => {
      if ( this.regionShapes[i].hole !== shape.isHole ) shape.reverseOrientation();
      this._updateShapeDimensions(i)
    });
  }

  /** @type {Map<GeometricPrimitive, string>} */
  structuralSignatureMap = new WeakMap();

  /**
   * Update a specific shape.
   * @param {number} shapeIdx
   * @param {Set<string>} [changeKeys]   Optional change keys; if not provided everything will be updated
   *   Adding a "elevation" key will update the position and scale.
   */
  _updateShapeDimensions(shapeIdx) {
    console.debug(`RegionGeometry|_updateShapeDimensions ${shapeIdx} ${this.placeableDocument.name} (${this.placeableId})`);
    const shape = this.baseShapes[shapeIdx];
    if ( !shape ) return;

    const regionShape = this.regionShapes[shapeIdx];
    let opts = this._shapeDimensions(regionShape);

    if ( shape.isHole ^ regionShape.hole ) shape.reverseOrientation();

    if ( regionShape.type === "ring" ) {
      const regionD = this.placeableDocument;
      const restricted = this.constructor.shapeIsGridConstrained(regionShape)
        || this.constructor.shapeIsWallRestricted(regionShape, regionD);
      if ( restricted ) opts = opts.outer;
      else {
        shape.solid.setPosition(opts.outer.center);
        shape.solid.setRotation(opts.outer.angles);
        shape.solid.setScale(opts.outer.dims);
        shape.solid.setAnchor(opts.outer.anchors);

        shape.holes[0].setPosition(opts.inner.center);
        shape.holes[0].setRotation(opts.inner.angles);
        shape.holes[0].setScale(opts.inner.dims);
        shape.holes[0].setAnchor(opts.inner.anchors);
        return;
      }
    }

    shape.setPosition(opts.center);
    shape.setRotation(opts.angles);
    shape.setScale(opts.dims);
    shape.setAnchor(opts.anchors);
  }

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
  _getStructuralSignature(regionShape) {
    // Note: Translation (x, y) might change overlap status, correctly forcing a rebuild.
    const isRestricted = this.isWallRestricted && this.constructor.shapeIsWallRestricted(regionShape, this.placeableDocument);
    const parts = [
      regionShape.type,
      regionShape.isAffectedByGrid ? "grid" : "gridless",
      isRestricted ? "restricted" : "unrestricted",
    ];

    // Append type-specific properties that fundamentally alter the underlying geometry.
    const keys = [];
    switch ( regionShape.type ) {
      case "emanation": keys.push("radius"); break;
      case "cone": keys.push("angle", "curvature", "radius"); break;
      case "polygon": keys.push("points"); break;
      case "ring": {
        if ( (regionShape.radius - regionShape.innerWidth) > 0 ) keys.push("innerWidth", "outerWidth", "radius");
        else keys.push("innerWidth", "outerWidth"); // Treat as cylinder, so radius handled via dimensions.
        break;
      }
    }
    parts.push(...keys.map(key => `${key}:${regionShape[key]}`));
    return parts.join("|");
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

      case "ring": {
        const outerRadius = regionShape.radius + regionShape.outerWidth;
        const innerRadius = regionShape.radius;
        dims.set(outerRadius * 2, outerRadius * 2, zHeight);
        return {
          outer: { center, angles, dims, anchors, topZ, bottomZ },
          inner: { center, angles, dims: dims.clone().set(innerRadius * 2, innerRadius * 2, zHeight), anchors, topZ, bottomZ },
        };
      }

      case "cone": dims.set(regionShape.radius, regionShape.radius, zHeight); break;

      case "polygon": break; // Dimensions set by the points.

      case "grid": break; // Unclear what this is.

      case "token": break; // Unclear what this is.
    }

    return { center, angles, dims, anchors, topZ, bottomZ };
  }

  /**
   * Polygon, circle, or ellipse that represents the shape.
   * Rectangles ignored as a 4-point polygon will be transformed to a Quad3d in ModelGeometricPrimitive
   * Used instead of just regionShape.polygons where feasible, because shapes other than polygon may be more efficient.
   * @param {RegionShape} regionShape
   * @returns {PIXI.Polygon[]|PIXI.Ellipse[]|PIXI.Circle[]|PIXI.Circle[2]} Pixi shape, or two circles for rings.
   */
  _shapeToPIXI(regionShape) {
    // TODO: In theory, rotation can be handled by the shape dimension update. But would need to rotate
    // everything (holes) if the shape itself is rotated, plus additional handling if holes are rotated.
    // Probably not worth it...
    if ( regionShape.rotation ) return this.regionShapePolygons(regionShape);

    switch ( regionShape.type ) {
      case "circle":  return [new PIXI.Circle(regionShape.x, regionShape.y, regionShape.radius)];
      case "ellipse": return [new PIXI.Ellipse(regionShape.x, regionShape.y, regionShape.radiusX, regionShape.radiusY)];
      case "ring": {
        const innerRadius = regionShape.radius - regionShape.innerWidth;
        const outerRadius = regionShape.radius + regionShape.outerWidth;
        const outer = new PIXI.Circle(regionShape.x, regionShape.y, outerRadius)
        if ( innerRadius > 0 ) {
          const inner = new PIXI.Circle(regionShape.x, regionShape.y, innerRadius);
          return [outer, inner];
        }
        return outer;
      }
      default: return this.regionShapePolygons(regionShape);
    }

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
    return this.constructor.elevationZ(this.placeableDocument);
  }

  static elevationZ(regionD) {
    const { top, topInclusive } = regionD.elevation;
    const topE = this.finiteElevation(topInclusive ? top : top - 1); // Subtract 1 grid distance if not inclusive.
    const topZ = gridUnitsToPixels(topE);
    const bottomZ = this.finiteElevation(regionD.bottomZ);
    return { topZ, bottomZ };
  }

  /** @type {number} */
  static zHeight(regionD) {
    const { bottomZ, topZ } = this.elevationZ(regionD);
    return topZ - bottomZ;
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

  /**
   * Slice this 3d shape with a vertical plane, returning 2d cross-section(s) as CutawayPolygons.
   * Correctly handles shapes with holes (internal cavities, Polygons3d hole faces, etc.).
   * @param {PIXI.Point|Point3d} start     Starting point of the slice on the XY plane
   * @param {PIXI.Point|Point3d} end       Ending point of the slice on the XY plane
   * @returns {CutawayPolygon[]} Array of CutawayPolygon cross-sections (solids and holes)
   */
  verticalSlice(start, end) {
    // Vertical slices sometimes need the top and bottom elevation.

    const cutaways = [];
    const { topZ, bottomZ } = this.elevationZ;
    for ( const s of this.shapes ) cutaways.push(...s.verticalSlice(start, end, { topZ, bottomZ }));
    if ( cutaways.length < 2 ) return cutaways;

    // Use Clipper to union the cutaways. Holes go straight through, leaving 1+ solid polygons.
    const paths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths.fromPolygons(cutaways);
    const out = paths
      .union()
      .clean()
      .toPolygons();
    return out.map(poly => CutawayPolygon.fromPolygon(poly, start, end));
  }

}


