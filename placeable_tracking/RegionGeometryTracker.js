/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Trackers
import { RegionUpdateTracker, RegionElevationTracker } from "./RegionTracker.js";

// Mixing
import { mix } from "../mixwith.js";
import {
  AbstractPlaceableGeometryTracker,
  PlaceableAABBMixin,
  PlaceableModelMatrixMixin,
  PlaceableFacesMixin
} from "./AbstractPlaceableGeometryTracker.js";

// LibGeometry
import { CenteredPolygon } from "../CenteredPolygon/CenteredPolygon.js";
import { CenteredRectangle } from "../CenteredPolygon/CenteredRectangle.js";
import { Ellipse } from "../Ellipse.js";
import { GEOMETRY_LIB_ID, OTHER_MODULES } from "../const.js";
import { AABB3d } from "../AABB.js";
import { MatrixFloat32 } from "../MatrixFlat.js";
import { Quad3d, Polygon3d, Polygons3d, Ellipse3d, Circle3d } from "../3d/Polygon3d.js";
import { Point3d } from "../3d/Point3d.js";

/**
 * Prototype order:
 * WallGeometryTracker -> PlaceableFacesMixin -> PlaceableMatricesMixin -> PlaceableAABBMixin -> AbstractPlaceableGeometryTracker
 */
export class RegionGeometryTracker extends mix(AbstractPlaceableGeometryTracker).with(PlaceableAABBMixin, PlaceableFacesMixin) {
  /** @type {string} */
  static PLACEABLE_NAME = "Region";

  /** @type {string} */
  static layer = "regions";

  /** @type {TrackerKeys} */
  static TRACKERS = {
    shape: RegionUpdateTracker,
    position: RegionElevationTracker,
  };

  get region() { return this.placeable; }

  get shapes() { return this.placeable.document.shapes; }

  get hasMultiPlaneRamp() {
    const TM = OTHER_MODULES.TERRAIN_MAPPER;
    if ( !TM ) return false;
    const tmHandler = this.region[TM.KEY];
    return tmHandler.isRamp && tmHandler.splitPolygons;
  }

  // ----- NOTE: AABB ----- //
  calculateAABB() {
    AABB3d.union(this.shapes.map(shape => shape[GEOMETRY_LIB_ID][this.constructor.ID].aabb), this._aabb);
  }

  // ----- NOTE: Matrices ---- //
  // Not used for the region itself.

  // ----- NOTE: Faces ---- //

  /** @type {Faces} */
  /* Handled in parent.
  _prototypeFaces = {
    top: new Quad3d(),
    bottom: new Quad3d(),
    sides: [],
  }
  */

  /** @type {Faces} */
  /* Handled in parent.
  _faces = {
    top: new Quad3d(),
    bottom: new Quad3d(),
    sides: [],
  }
  */

  /** @type {Polygons3d} */
  /*
  faces = {
    top: new Polygons3d(),
    bottom: new Polygons3d(),
    multiTops: [], // Could use Polygons3d except if ramps used with ramp per shape.
    multiBottoms: [], // Could use Polygons3d except if ramps used with ramp per shape.
    sides: [],
  };
  */

  /*
  *iterateFaces() {
    if ( this.hasMultiPlaneRamp ) {
      for ( const top of this.faces.multiTops ) yield top;
      for ( const bottom of this.faces.multiBottoms ) yield bottom;
      for ( const side of this.faces.sides ) yield side;
    } else yield*  super.iterateFaces();
  }
  */

  _initializePrototypeFaces() {
    // Initialize the shapes for this region.
    this.shapes.forEach(shape => this._initializeShape(shape));
  }

  _initializeShape(shape) {
    let shapeTrackerClass;
    switch ( shape.type ) {
      case "rectangle": shapeTrackerClass = RegionRectangleShapeGeometryTracker; break;
      case "polygon": shapeTrackerClass = RegionPolygonShapeGeometryTracker; break;
      case "ellipse": shapeTrackerClass = RegionEllipseShapeGeometryTracker; break;
      case "circle": shapeTrackerClass = RegionCircleShapeGeometryTracker; break;
    }
    let shapeTracker = shape[GEOMETRY_LIB_ID]?.[this.constructor.ID];
    if ( !(shapeTracker instanceof shapeTrackerClass) ) {
      if ( shapeTracker ) shapeTracker.destroy();
      shapeTracker = shapeTrackerClass.create(shape, this.region);
    }
    shapeTracker.placeable = shape;
    shapeTracker.initialize();
  }

  _updateFaces() {
    this.buildRegionPolygons3d();
  }

  // ----- NOTE: Update underlying shapes ----- //

  updatePosition() {
    this.#applyToShapes("updatePosition");
  }

  updateRotation() {
    this.#applyToShapes("updateRotation");
  }

  updateScale() {
    this.#applyToShapes("updateScale");
  }

  updateShape() {
    this._initializePrototypeFaces(); // Must rebuild the shape b/c they likely were changed.
    this.#applyToShapes("updateShape");
  }

  _placeableUpdated() {
    this.#applyToShapes("_placeableUpdated");
    super._placeableUpdated(); // For AABB and faces.
  }

  #applyToShapes(fnName) {
    this.shapes.forEach(shape => shape[GEOMETRY_LIB_ID][this.constructor.ID][fnName]());
  }

  destroy() {
    this.#applyToShapes("destroy");
    super.destroy();
  }

  // ----- NOTE: Combine underlying shapes ----- //

  combinedFaces = [];

  /**
   * Iterate over the faces.
   */
  *iterateFaces() {
    this.update();
    for ( const face of this.combinedFaces ) {
      yield face.top;
      yield face.bottom;
      for ( const side of face.sides ) yield side;
    }
  }

  get faces() {
    this.update();
    return this.combinedFaces;
  }

  buildRegionPolygons3d() {
    const shapePaths = this.buildRegionPaths();

    // Clear prior data.
    this.combinedFaces.length = 0;

    // TODO: Handle ramps.
    // TODO: Handle steps.
    // TODO: Handle multi-plane ramps. this.hasMultiPlaneRamp
    // TODO: Handle multi-plane steps. this.hasMultiPlaneRamp
    const ClipperPaths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths;
    const { topZ, bottomZ } = this.constructor.regionElevation(this.region);
    for ( const shapePath of shapePaths ) {
      if ( shapePath instanceof ClipperPaths ) {
        const polys = Polygons3d.fromClipperPaths(shapePath, topZ);
        const face = {
          top: polys,
          bottom: polys.clone().reverseOrientation().setZ(bottomZ),
          sides: [],
        };
        // Build all the side polys.
        face.sides = face.top.buildTopSides(bottomZ);
        this.combinedFaces.push(face);

      } else {
        const geometry = shapePath[GEOMETRY_LIB_ID][this.constructor.ID];
        this.combinedFaces.push(geometry._faces);
      }
    }
  }

  buildRegionPaths() {
    const ClipperPaths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths;
    const pathShapes = [];

    // TODO: Handle ramps.
    // TODO: Handle steps.
    // TODO: Handle multi-plane ramps. this.hasMultiPlaneRamp
    // TODO: Handle multi-plane steps. this.hasMultiPlaneRamp
    try {
      const uniqueShapes = this.combineRegionShapes();
      for ( const shapeGroup of uniqueShapes ) {
        if ( shapeGroup.length === 1 ) {
          const geometry = shapeGroup[0][GEOMETRY_LIB_ID][this.constructor.ID];
          if ( geometry.isHole ) continue;
          pathShapes.push(shapeGroup[0]);
        } else {
          // Combine and convert to Polygons3d.
          const paths = shapeGroup.map(shape => shape[GEOMETRY_LIB_ID][this.constructor.ID].toClipperPath());
          const combinedPaths = paths.length === 1 ? paths[0] : ClipperPaths.joinPaths(paths);
          const path = combinedPaths.union();
          pathShapes.push(path);
        }
      }
    } catch (error) {
      this.combinedFaces.length = 0;
      console.error(`${this.constructor.name}|buildRegionPolygons3d failed build`, error);

      const cp = new ClipperPaths();
      switch ( CONFIG[GEOMETRY_LIB_ID].CONFIG.clipperVersion ) {
        case 1: cp.paths = this.region.document.clipperPaths; break;
        case 2: this.region.document.clipperPaths.forEach(path => cp.addPathClipper1Points(path)); break;
      }
      pathShapes.push(cp);
    }
    return pathShapes;
  }

  combineRegionShapes() {
    // Form groups of shapes. If any shape overlaps another, they share a group.
    // So if A overlaps B and B overlaps C, [A,B,C] form a group regardless of whether A overlaps C.
    const shapes = this.shapes;
    const nShapes = shapes.length;
    const usedShapes = new Set();
    const uniqueShapes = [];
     for ( let i = 0; i < nShapes; i += 1 ) {
      if ( usedShapes.has(i) ) continue;
      const shape = shapes[i];
      const shapeGroup = [shape];
      uniqueShapes.push(shapeGroup);
      for ( let j = i + 1; j < nShapes; j += 1 ) {
        if ( usedShapes.has(j) ) continue;
        const other = shapes[j];
        const otherGeometry = other[GEOMETRY_LIB_ID][this.constructor.ID];
        const otherPIXI = otherGeometry.shapePIXI;

        // Any overlap counts.
        for ( const shape of shapeGroup ) {
          const shapeGeometry = shape[GEOMETRY_LIB_ID][this.constructor.ID];
          const shapePIXI = shapeGeometry.shapePIXI;
          if ( shapePIXI.overlaps(otherPIXI) ) {
            shapeGroup.push(other);
            usedShapes.add(j);
            break;
          }
        }
      }
    }
    return uniqueShapes;
  }

  static regionElevation(region) {
    const MAX_ELEV = 1e06;
    let topZ = region.topZ;
    let bottomZ = region.bottomZ;

    // If terrain mapper is active, use the plateau elevation if present.
    const TM = OTHER_MODULES.TERRAIN_MAPPER;
    if ( TM ) topZ = region.document.getFlag(TM.ID, TM.FLAGS.PLATEAU_ELEVATION) ?? topZ;

    // Force elevations to be finite values.
    if ( !isFinite(topZ) ) topZ = MAX_ELEV;
    if ( !isFinite(bottomZ) ) bottomZ = -MAX_ELEV;
    return { topZ, bottomZ };
  }

}

// Track each shape separately, per region.
class AbstractRegionShapeGeometryTracker extends mix(AbstractPlaceableGeometryTracker).with(PlaceableAABBMixin, PlaceableModelMatrixMixin, PlaceableFacesMixin) {
  /** @type {TrackerKeys} */
  static TRACKERS = {};

  get shape() { return this.placeable; }

  get shapeIndex() { return this.region.document.shapes.indexOf(this.shape); }

  get isHole() { return this.shape.hole; }

  /** @type {Region} */
  region;

  static create(shape, region) {
    // Singleton. If this tracker already exists, keep it.
    const obj = shape[GEOMETRY_LIB_ID] ??= {};
    if ( obj[this.ID] ) return obj[this.ID];

    const out = new this(shape);
    obj[this.ID] = out;
    out.region = region;
    return out;
  }

  // ----- NOTE: AABB ----- //

  calculateAABB() { return AABB3d.fromShape(this.shapePIXI, this._aabb); }

  // ----- NOTE: PIXI Shape ----- //

  /** @type {PIXI.Polygon|PIXI.Rectangle|PIXI.Circle|PIXI.Ellipse} */
  shapePIXI;

  /** @type {PIXI.Polygon|PIXI.Rectangle|PIXI.Circle|PIXI.Ellipse} */
  unrotatedShapePIXI;

  updateShape() {
    this.unrotatedShapePIXI = this.constructor.shapePIXI(this.shape, false);
    this.shapePIXI = this.shape.rotation ? this.constructor.shapePIXI(this.shape, true) : this.unrotatedShapePIXI;
    super.updateShape();
  }

  updateRotation() {
    this.shapePIXI = this.shape.rotation ? this.constructor.shapePIXI(this.shape, true) : this.unrotatedShapePIXI;
    super.updateRotation();
  }

  // ----- NOTE: Matrices ----- //

  /**
   * Create an id used for the model matrix tracking.
   * @type {string}
   */
  get placeableId() { return `${this.region.id}-${this.shapeIndex}`; }

  calculateTranslationMatrix() {
    const mat = super.calculateTranslationMatrix();
    const { topZ, bottomZ } = RegionGeometryTracker.regionElevation(this.region);
    const zHeight = topZ - bottomZ;
    const z = topZ - (zHeight * 0.5);
    const center = this.unrotatedShapePIXI.center;
    return MatrixFloat32.translation(center.x, center.y, z, mat);
  }

  calculateRotationMatrix() {
    const mat = super.calculateRotationMatrix();
    const rot = Math.toRadians(this.shape.rotation);
    return MatrixFloat32.rotationZ(rot, true, mat);
  }

  calculateScaleMatrix() {
    const mat = super.calculateScaleMatrix();
    const bounds = this.unrotatedShapePIXI.getBounds();
    const { topZ, bottomZ } = RegionGeometryTracker.regionElevation(this.region);
    const scaleZ = topZ - bottomZ;
    return MatrixFloat32.scale(bounds.width, bounds.height, scaleZ, mat);
  }

  _initializePrototypeFaces() {
    if ( this.isHole ) {
      this._prototypeFaces.top.reverseOrientation();
      this._prototypeFaces.bottom.reverseOrientation();
      this._prototypeFaces.sides.forEach(side => side.reverseOrientation());
    }
    super._initializePrototypeFaces();
  }

  toClipperPath() {
    return this.faces.top.toClipperPaths();
  }

  // ----- NOTE: Shape characteristics ----- //

  static shapePIXI(shape, rotate = true) { return convertRegionShapeToPIXI(shape, rotate); }

}



class RegionRectangleShapeGeometryTracker extends AbstractRegionShapeGeometryTracker {

  // ----- NOTE: Faces ---- //

  /** @type {Faces} */
  _prototypeFaces = {
    top: new Quad3d(),
    bottom: new Quad3d(),
    sides: [new Quad3d(), new Quad3d(), new Quad3d(), new Quad3d()],
  }

  /**
   * Create the initial face shapes for this wall, using a 0.5 x 0.5 x 0.5 unit cube.
   * Normal walls have front (top) and back (bottom). One-directional walls have only top.
   */
  _initializePrototypeFaces() {
    this.constructor.QUADS.up.clone(this._prototypeFaces.top);
    this.constructor.QUADS.down.clone(this._prototypeFaces.bottom);
    const RECT_SIDES = this.constructor.RECT_SIDES;
    for ( const side of Object.keys(RECT_SIDES) ) this.constructor.QUADS[side].clone(this._prototypeFaces.sides[RECT_SIDES[side]]);

    // Adjust sides so they are 0.5 from center in each direction.
    this._prototypeFaces.sides[RECT_SIDES.north].translate({ y: -0.5 }, this._prototypeFaces.sides[RECT_SIDES.north]);
    this._prototypeFaces.sides[RECT_SIDES.south].translate({ y: 0.5 }, this._prototypeFaces.sides[RECT_SIDES.south]);
    this._prototypeFaces.sides[RECT_SIDES.west].translate({ x: -0.5 }, this._prototypeFaces.sides[RECT_SIDES.west]);
    this._prototypeFaces.sides[RECT_SIDES.east].translate({ x: 0.5 }, this._prototypeFaces.sides[RECT_SIDES.east]);

    super._initializePrototypeFaces();
  }
}

class RegionEllipseShapeGeometryTracker extends AbstractRegionShapeGeometryTracker {

  // ----- NOTE: Faces ---- //

  /** @type {Faces} */
  _prototypeFaces = {
    top: new Ellipse3d(),
    bottom: new Ellipse3d(),
    sides: [],
  }

  /**
   * Create the initial face shapes for this ellipse.
   * Uses 1 x 1 x 0.5 b/c the scale matrix is set using the half-radii.
   */
  _initializePrototypeFaces() {
    Ellipse3d.fromCenterPoint(Point3d.tmp.set(0, 0, 0.5), 1.0, 1.0, this._prototypeFaces.top);
    this._prototypeFaces.top.clone(this._prototypeFaces.bottom).reverseOrientation();
    this._prototypeFaces.bottom.setZ(-0.5);
    const density = PIXI.Circle.approximateVertexDensity(Math.max(this.shape.radiusX, this.shape.radiusY));
    this._prototypeFaces.sides = this._prototypeFaces.top.buildTopSides(-0.5, { density });
    super._initializePrototypeFaces();
  }

  toClipperPath() {
    const density = PIXI.Circle.approximateVertexDensity(Math.max(this.shape.radiusX, this.shape.radiusY));
    return this.faces.top.toClipperPaths({ density });
  }
}

class RegionCircleShapeGeometryTracker extends AbstractRegionShapeGeometryTracker {

  // ----- NOTE: Faces ---- //

  /** @type {Faces} */
  _prototypeFaces = {
    top: new Circle3d(),
    bottom: new Circle3d(),
    sides: [],
  }

  /**
   * Create the initial face shapes for this wall, using a 0.5 x 0.5 x 0.5 unit cube.
   * Normal walls have front (top) and back (bottom). One-directional walls have only top.
   */
  _initializePrototypeFaces() {
    Circle3d.fromCenterPoint(Point3d.tmp.set(0, 0, 0.5), 0.5, this._prototypeFaces.top);
    this._prototypeFaces.top.clone(this._prototypeFaces.bottom).reverseOrientation();
    this._prototypeFaces.bottom.setZ(-0.5);
    const density = PIXI.Circle.approximateVertexDensity(this.shape.radius);
    this._prototypeFaces.sides = this._prototypeFaces.top.buildTopSides(-0.5, { density });
    super._initializePrototypeFaces();
  }

  toClipperPath() {
    const density = PIXI.Circle.approximateVertexDensity(this.shape.radius);
    return this.faces.top.toClipperPaths({ density });
  }
}

class RegionPolygonShapeGeometryTracker extends AbstractRegionShapeGeometryTracker {

  // ----- NOTE: Faces ---- //

  /** @type {Faces} */
  _prototypeFaces = {
    top: new Polygon3d(),
    bottom: new Polygon3d(),
    sides: [],
  }

  /**
   * Create the initial face shapes for this wall, using a 0.5 x 0.5 x 0.5 unit cube.
   * Normal walls have front (top) and back (bottom). One-directional walls have only top.
   */
  _initializePrototypeFaces() {
    // Center and scale polygon points to a 0.5 cube.
    const polyCenter = poly.center;
    const bounds = poly.getBounds();
    const poly = this.unrotatedShapePIXI
      .translate(-polyCenter.x, polyCenter.y)
      .scale(1/bounds.width, 1/bounds.height);
    Polygon3d.fromPolygon(poly, 0.5, this._prototypeFaces.top);
    this._prototypeFaces.top.clone(this._prototypeFaces.bottom).reverseOrientation();
    this._prototypeFaces.bottom.setZ(-0.5);
    this._prototypeFaces.sides = this._prototypeFaces.top.buildTopSides(-0.5);
    super._initializePrototypeFaces();
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
