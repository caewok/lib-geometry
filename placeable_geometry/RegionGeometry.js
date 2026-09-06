/* globals
canvas,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Geometry
import { PlaceableGeometry } from "./PlaceableGeometry.js";
import { CombinedGeometricPrimitive } from "./GeometricPrimitive.js";
import { CubePrimitive, CylinderPrimitive } from "./InstancedGeometricPrimitive.js";
import { ExtrudedPolygonPrimitive, ExtrudedTrianglePrimitive } from "./ModelGeometricPrimitive.js";

// LibGeometry
import { GEOMETRY_LIB_ID } from "../const.js";
import { Point3d } from "../3d/Point3d.js";
import { Segment } from "../Segment.js";
import { almostLessThan, NULL_SET } from "../util.js";

/**
  Region will either be a single shape or a group of polygons.
  If more than one shape, treated as polygons.

  NOTE: Shapes can be destroyed/recreated without an update hook.
  Presumably, they are not getting changed without a hook.

  Regions store combined shapes as region.polygons.
*/


/**
 * A ConePrimitive can represent a 3d extruded cone that is either flat, round, or semicircular.
 * Represents it as 1 or 2 pieces: the triangle base and arc shape, if any.
 */
export class ConePrimitive extends CombinedGeometricPrimitive {

  /** @type {"flat"|"round"|"semicircle"} */
  type = "flat";

  /** @type {number<radians>} */
  theta = 0; // Angle of the cone at the apex.

  /** @type {number} */
  radius = 0;

  // ----- NOTE: Static factory methods ----- //

  /**
   * Cone is built from extruded triangle + extruded arc.
   */
  static fromRegionShape(id, regionShape, { density, ...opts } = {}) {
    if ( regionShape.type !== "cone" ) throw Error("ConePrimitive|Only cone types may be used.", { regionShape });

    using apex = PIXI.Point.tmp.copyFrom(regionShape);
    const rotation = Math.toRadians(regionShape.rotation);
    const theta = Math.toRadians(regionShape.angle);
    const radius = regionShape.radius;
    density ??= PIXI.Circle.approximateVertexDensity(regionShape.radius);

    // Track shape parameters, primarily for debugging.
    const out = new this(id);
    out.type = regionShape.curvature;
    out.radius = radius;
    out.theta = theta;

    let baseSegment;
    let arcCircle;
    let arcStartAngle;
    let arcEndAngle;
    switch ( regionShape.curvature ) {
      case "flat":
        baseSegment = this.flatConeBase(apex, radius, theta, rotation);
        break;
      case "semicircle": {
        baseSegment = this.semiCircleConeBase(apex, radius, theta, rotation);
        arcCircle = this.semiCircleConeCircle(regionShape, regionShape.radius, theta, rotation);
        arcStartAngle = Math.normalizeRadians(-Math.PI_1_2 + rotation);
        arcEndAngle = Math.normalizeRadians(Math.PI_1_2 + rotation);
        break;
      }
      case "round": {
        baseSegment = this.roundConeBase(apex, radius, theta, rotation);
        arcCircle = this.roundConeCircle(regionShape, regionShape.radius);
        arcStartAngle = Math.normalizeRadians(-(theta / 2) + rotation);
        arcEndAngle = Math.normalizeRadians((theta / 2) + rotation)
      }
    }

    const triShape = ExtrudedTrianglePrimitive.fromTriangle(`baseTri_${id}`, apex, baseSegment.a, baseSegment.b, opts);
    out.addShape(triShape);
    if ( regionShape.curvature === "flat" ) return;

    // Build the extruded polygon arc piece.
    const arcPoints = arcCircle.pointsForArc(arcStartAngle, arcEndAngle, { density, includeEndpoints: false });
    const poly = new PIXI.Polygon(baseSegment.a, ...arcPoints, baseSegment.b);
    const arcShape = ExtrudedPolygonPrimitive.fromPolygon(`${regionShape.curvature}_${id}`, poly, opts);
    out.addShape(arcShape);
    return out;
  }

  // ----- NOTE: Math helpers ----- //

  /**
   * Base points for a flat cone.
   * @param {PIXI.Point} apex         Origin (top point) of the cone
   * @param {number} radius           Radius of the cone arc
   * @param {number} theta            Cone angle, in radians
   * @param {number} [rotation=0]     Cone rotation, in radians
   * @returns {Segment}
   */
  static flatConeBase(apex, radius, theta, rotation = 0) {
    // Find the length of a leg.
    const halfAngle = theta / 2;
    const sideLength = radius / Math.cos(halfAngle); // Hypotenuse

    // Project the base points using the side length and angles.
    const b = apex.fromAngle(rotation - halfAngle, sideLength);
    const c = apex.fromAngle(rotation + halfAngle, sideLength);
    return new Segment(b, c);
  }

  /**
   * Base points for a semicircle cone.
   * @param {PIXI.Point} apex         Origin (top point) of the cone
   * @param {number} radius           Radius of the cone arc
   * @param {number} theta            Cone angle, in radians
   * @param {number} [rotation=0]     Cone rotation, in radians
   * @returns {Segment}
   */
  static semiCircleConeBase(apex, totalLength, theta, rotation = 0) {
    // Find the length of a leg.
    // l = h / cos(theta / 2)
    const halfAngle = theta / 2;
    const h = totalLength / (1 + Math.tan(halfAngle));
    const sideLength = h / ( Math.cos(halfAngle));

    // Project the base points using the side length and angles.
    const b = apex.fromAngle(rotation - halfAngle, sideLength);
    const c = apex.fromAngle(rotation + halfAngle, sideLength);
    return new Segment(b, c);
  }

  /**
   * Base points for a round cone.
   * @param {PIXI.Point} apex         Origin (top point) of the cone
   * @param {number} radius           Radius of the cone arc
   * @param {number} theta            Cone angle, in radians
   * @param {number} [rotation=0]     Cone rotation, in radians
   * @returns {Segment}
   */
  static roundConeBase(apex, radius, theta) {
    const halfAngle = theta / 2;
    const b = PIXI.Point.tmp.set(
      apex.x + (radius * Math.cos(theta - halfAngle)),
      apex.y + (radius * Math.sin(theta - halfAngle)),
    );
    const c = PIXI.Point.tmp.set(
      apex.x + (radius * Math.cos(theta + halfAngle)),
      apex.y + (radius * Math.sin(theta + halfAngle)),
    );
    return new Segment(b, c);
  }


  /**
   * Get the circle shape the forms the round cone arc.
   * @param {PIXI.Point} apex         Origin (top point) of the cone
   * @param {number} radius           Radius of the cone arc
   * @returns {PIXI.Circle}
   */
  static roundConeCircle(apex, radius) { return new PIXI.Circle(apex.x, apex.y, radius); }


  /**
   * Get the circle shape the forms the semicircle cone arc.
   * @param {PIXI.Point} apex         Origin (top point) of the cone
   * @param {number} totalLength      Length from apex to the arc along the middle line of the cone
   * @param {number} theta            Cone angle, in radians
   * @param {number} [rotation=0]     Cone rotation, in radians
   * @returns {PIXI.Circle}
   */
  static semiCircleConeCircle(apex, totalLength, theta, rotation = 0 ) {
/*
                     .---.
                 . '       ' .
               /               \  <-- Half-circle arc
              |------- C -------| <-- Base line (Diameter = 2 * l * sin(φ/2))
               \       |       /
                \      | h    /
                 \     |     /
                  \    |    /
                   \   |   /  Total length t = h + r
                    \  |  /   Side length = l
                     \ | /    Cone Angle = φ
                       P (Apex)
*/
    // Base of cone is flat line segment that forms the diameter of the circle.
    // arc radius = h / 2 = l * sin(theta / 2)
    // Two straight sides of cone form isoceles triangle.
    // base length (h) = 2 * l * sin(theta / 2)
    // totalLength = h + radius
    // h = totalLength / (1 + tan(theta / 2))
    // cx = apex.x + h * cos(rotation)
    // cy = apex.y + h * sin(rotation)

    // tan = opp / adj
    // Math.tan(theta/2) = r / h
    // r = h * Math.tan(theta/2)
    // t = h + r
    // t = h + h *  Math.tan(theta/2) = h * (1 + Math.tan(theta/2))
    // h = t / (1 + Math.tan(theta/2))

    // Altitude of the triangle (distance from P to C).
    const halfAngle = theta / 2;
    const h = totalLength / (1 + Math.tan(halfAngle));

    // Radius of the half-circle arc
    const arcRadius = h * Math.tan(halfAngle);

    // Construct circle that creates the arc.
    const x = apex.x + (h * Math.cos(rotation));
    const y = apex.y + (h * Math.sin(rotation));
    return new PIXI.Circle(x, y, arcRadius)
  }


}

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
    // ["shapes", "shapes"],
  ]);

  /**
   * Return the shape class for a given region shape type.
   * May also be dependent on the region (e.g., plateaus, steps, etc.)
   * @param {number} i      Index of the shape
   */
  shapeClass(i) {
    const regionShape = this.regionShapes[i];
    if ( regionShape.gridBased ) return ExtrudedPolygonPrimitive;
    switch ( regionShape.type ) {
      case "circle":
      case "ellipse": return CylinderPrimitive;

      case "line":
      case "rectangle": return CubePrimitive;

      case "cone": return ConePrimitive;

      default: return ExtrudedPolygonPrimitive;
    }
  }

  get region() { return this.placeable; }

  get regionShapes() { return this.placeableDocument.shapes; }

  get regionPolygons() { return this.placeableDocument.polygons; }

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
    const { shapes, regionShapes } = this;
    for ( let i = 0, iMax = shapes.length; i < iMax; i += 1 ) this._updateShape(i);
  }

  createShapes() {
    console.debug(`RegionGeometry|createShapes ${this.placeableDocument.name} (${this.placeableId})`);
    const regionShapes = this.regionShapes;
    const shapes = this.shapes;
    this.shapes.forEach(subshape => subshape.destroy());

    // If no shapes for this region, return.
    const n = regionShapes.length;
    if ( n === 0 ) {
      shapes.length = 0;
      return;
    }

    // If there are holes or wall restrictions, use the model polygon shape for the entire region.
    if ( this.regionPolygons.length &&
      (this.placeableDocument.restriction.enabled
      || regionShapes.some(regionShape => regionShape.hole)) ) {
      this.shapes.length = 1;
      this.shapes[0] = this._buildEntireRegionShape();
      return;
    }

    // Create a primitive shape for each region shape.
    this.shapes.length = n;
    for ( let i = 0; i < n; i += 1 ) shapes[i] = this._buildRegionShapes(i);
    return shapes;
  }

  /**
   * Construct a primitive shape using the polygons for the entire region.
   * @returns {GeometricPrimitive[]}
   */
  _buildEntireRegionShapes() {
    console.debug(`RegionGeometry|_buildEntireRegionShapes ${this.placeableDocument.name} (${this.placeableId})`);
    const id = this.placeableId;
    const zElevs = this.elevationZ;
    const shape = ExtrudedPolygonPrimitive.fromPolygons(id, this.regionPolygons, zElevs);
    shape.initialize();
    return shape;
  }

  /**
   * Construct primitive shapes for a given region shape.
   * @param {number} idx        Index of the region shape in the region.document.shapes array
   * @returns {GeometricPrimitive[]}
   */
  _buildRegionShapes(shapeIdx) {
    console.debug(`RegionGeometry|_buildRegionShapes ${this.placeableDocument.name} (${this.placeableId})`);
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

      case "cone": {
        const opts = this._shapeDimensions(regionShape);
        if ( almostLessThan(opts.dims.z, 0) ) opts.dims.z = 1; // zHeight must be positive.
        shape = ConePrimitive.fromRegionShape(id, regionShape, opts);
        break;
      }

      case "emanation":
        // Use the polygon b/c corner radiuses can vary.
        // base.x, base.y, rotation, base.width (# grid spaces), base.height (# grid spaces), origin

      case "ring": /* eslint-disable-line no-fallthrough */
         // Use the polygon(s) b/c of the hole.
        // rotation, x, y, radius as width, origin

      case "polygon": /* eslint-disable-line no-fallthrough */
        // Obv. use the polygon.
        // rotation, although not user-set, origin

      case "grid": /* eslint-disable-line no-fallthrough */
        // Unclear what this is.

      case "token": /* eslint-disable-line no-fallthrough */
        // Unclear what this is.

      default: {  /* eslint-disable-line no-fallthrough */
        // Pass the center, rotation, and dimensions so a prototype can be created.
        const opts = this._shapeDimensions(regionShape);
        if ( almostLessThan(opts.dims.z, 0) ) opts.dims.z = 1; // zHeight must be positive.
        shape = ExtrudedPolygonPrimitive.fromPolygons(id, regionShape.polygons, opts);
      }
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

    // For each shape, a mis-matched class indicates either the shape was changed
    // or a shape prior to it was deleted. Reuse shapes where possible, creating new as needed and
    // deleting shapes as necessary.

    let i = 0;
    while ( true ) {
      // If we reach the end of the region shapes, truncate leftover elements.
      if ( i >= numRegionShapes ) {
        for ( let j = numRegionShapes, n = shapes.length; j < n; j += 1 ) this.shapes[j].destroy();
        shapes.length = i;
        break;
      }

      // Check if the current element is already correct.
      if ( !this.rebuildNeeded(shapes[i], regionShapes[i], trackingArr[i]) ) {
        this._updateShape(i, trackingArr[i]);
        i++;
        continue;
      }

      // Look ahead in the remaining array to see if the target exists.
      // Reuse instead of deleting.
      let foundIndex = -1;
      for ( let j = i + 1, n = shapes.length; j < n; j++ ) {
        if ( !this.rebuildNeeded(shapes[j], regionShapes[i], trackingArr[i]) ) {
          foundIndex = j;
          break;
        }
      }

      if ( ~foundIndex ) {
        shapes.splice(i, foundIndex - i);
        this.shape[i].id = this._shapeId(i); // Relabel to track the new shape index.
        this._updateShape(i, trackingArr[i]);
      } else {
        // Target class is not present downstream, so create anew.
        this._rebuildShape(i);
        continue;
      }
    }
  }

  /**
   * Rebuild an existing shape.
   * @param {number} i          The index of the shape in the array.
   */
  _rebuildShape(i) {
    console.debug(`RegionGeometry|_rebuildShape ${i} ${this.placeableDocument.name} (${this.placeableId})`);
    const shapes = this.shapes;
    if ( shapes[i] )  shapes[i].destroy();
    shapes[i] = this._buildRegionShape(i);
    shapes[i].initialize();
    this._updateShape(i);
  }

  /**
   * Update a specific shape.
   * @param {number} shapeIdx
   * @param {Set<string>} [changeKeys]   Optional change keys; if not provided everything will be updated
   *   Adding a "elevation" key will update the position and scale.
   */
  _updateShape(shapeIdx, changes) {
    console.debug(`RegionGeometry|_updateShape ${shapeIdx} ${this.placeableDocument.name} (${this.placeableId})`);
    const shape = this.shapes[shapeIdx];
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

  _

  /**
   * For a given shape index and change set, does this shape need to be rebuilt entirely?
   * @param {number} shapeIdx
   * @param {Set<string>} [changeKeys]   Optional change keys; if not provided everything will be updated
   *   Adding a "elevation" key will update the position and scale.
   * @returns {boolean}
   */
  rebuildNeeded(shape, regionShape, changes) {
    if ( changes.has("type") || changes.has("points") ) return true;
    if ( !(shape instanceof this.shapeClass(regionShape)) ) return true;

    // Some types need to be rebuilt when certain parameters change, causing the underlying shape to warp.
    switch ( regionShape.type ) {
      case "cone": return changes.has("angle") || changes.has("curvature") || changes.has("radius");
      case "emanation": return changes.has("radius");
      case "ring": return changes.has("innerWidth") || changes.has("outerWidth") || changes.has("radius");
    }
    return false;
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
        // Those represent percentage anchors from 0–1. Conform to the unit cube from -0.5 to 0.5.
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


