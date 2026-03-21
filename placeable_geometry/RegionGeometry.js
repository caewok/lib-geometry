/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Mixing
import { mix } from "../mixwith.js";
import {
  PlaceableGeometry,
  PlaceableAABBMixin,
  PlaceableModelMatrixMixin,
  PlaceableFacesMixin
} from "./PlaceableGeometry.js";

// LibGeometry
import { CenteredPolygon } from "../CenteredPolygon/CenteredPolygon.js";
import { CenteredRectangle } from "../CenteredPolygon/CenteredRectangle.js";
import { Ellipse } from "../Ellipse.js";
import { GEOMETRY_LIB_ID, OTHER_MODULES } from "../const.js";
import { AABB3d } from "../3d/AABB3d.js";
import { MatrixFloat32 } from "../Matrix.js";
import { Quad3d, Polygon3d, Polygons3d, Ellipse3d, Circle3d } from "../3d/Polygon3d.js";
import { Point3d } from "../3d/Point3d.js";


/**
 * Prototype order:
 * WallGeometryTracker -> PlaceableFacesMixin -> PlaceableMatricesMixin -> PlaceableAABBMixin -> PlaceableGeometry
 */
export class RegionGeometry extends mix(PlaceableGeometry).with(PlaceableAABBMixin, PlaceableFacesMixin) {
  /** @type {string} */
  static PLACEABLE_NAME = "Region";

  /** @type {string} */
  static layer = "regions";

  static getShapeGeom(shape) {
    const idx = shape.parent.shapes.indexOf(shape);
    const region = shape.parent?.object;
    if ( !region ) return;
    const regionGeom = region[GEOMETRY_LIB_ID][GEOMETRY_LIB];
    if ( !regionGeom ) return;
    return regionGeom.shapeGeometries[idx];
  }

  get region() { return this.placeable; }

  get shapes() { return this.placeable.document.shapes; }

  get hasMultiPlaneRamp() {
    const TM = OTHER_MODULES.TERRAIN_MAPPER;
    if ( !TM ) return false;
    const tmHandler = this.region[TM.KEY];
    return tmHandler.isRamp && tmHandler.splitPolygons;
  }

  /**
   * NOTE: Shapes can be destroyed/recreated without an update hook.
   * Presumably, they are not getting changed without a hook.
   * Store here by index and update accordingly.
   * @type {AbstractRegionShapeGeometry[]} */
  shapeGeometries = [];

  // ----- NOTE: AABB ----- //
  calculateAABB() {
    AABB3d.union(this.shapeGeometries.map(geom => geom.aabb), this.aabb);
  }

  // ----- NOTE: Matrices ---- //
  // Not used for the region itself.

  // ----- NOTE: Faces ---- //

  _updateFaces() {
    this.buildRegionFaces();
  }

  // ----- NOTE: Update underlying shapes ----- //

  static create(placeable) {
    const geom = super.create(placeable);
    const shapes = geom.shapes;
    for ( let i = 0, n = shapes.length; i < n; i += 1 ) {
      geom.shapeGeometries[i] = geom._createShape(shapes[i]);
    }
    return geom;
  }

  _createShape(shape) {
    let geomClass;
    switch ( shape.type ) {
      case "rectangle": geomClass = RegionRectangleShapeGeometry; break;
      case "polygon": geomClass = RegionPolygonShapeGeometry; break;
      case "ellipse": geomClass = RegionEllipseShapeGeometry; break;
      case "circle": geomClass = RegionCircleShapeGeometry; break;
    }
    return geomClass.create(shape, this.region);
  }

  initialize() {
    // Initialize the shapes for this region.
    this.shapeGeometries.forEach(geom => geom.initialize());
    super.initialize();
  }

  shapeUpdated() {
    // Must rebuild the shape; likely changed.
    this._initializePrototypeFaces();
    const shapes = this.shapes;
    for ( let i = 0, n = shapes.length; i < n; i += 1 ) {
      const geom = this._createShape(shapes[i]);
      this.shapeGeometries[i] = geom
      geom.initialize();
    }
    super.shapeUpdated();
  }

  // ----- NOTE: Combine underlying shapes ----- //

  combinedFaces = [];

  /**
   * Iterate over the faces.
   */
  *iterateFaces() {
    for ( const face of this.combinedFaces ) {
      yield face.top;
      yield face.bottom;
      for ( const side of face.sides ) yield side;
    }
  }

  get faces() { return this.combinedFaces; }

  buildRegionFaces() {
    const ClipperPaths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths;
    const { topZ, bottomZ } = this.constructor.regionElevation(this.region);
    this.combinedFaces.length = 0;

    // TODO: Handle ramps.
    // TODO: Handle steps.
    // TODO: Handle multi-plane ramps. this.hasMultiPlaneRamp
    // TODO: Handle multi-plane steps. this.hasMultiPlaneRamp

    const uniqueGeoms = this.combineRegionShapes();
    for ( const geomGroup of uniqueGeoms ) {
      if ( geomGroup.length === 1 ) {
        const geom = geomGroup[0];
        if ( geom.isHole ) continue;
        this.combinedFaces.push(geom.faces);
      } else {
        let path;
        try {
          // Combine paths
          const paths = geomGroup.map(geom => geom.toClipperPath());
          const combinedPaths = paths.length === 1 ? paths[0] : ClipperPaths.joinPaths(paths);
          path = combinedPaths.union();
        } catch (error) {
          console.error(`${this.constructor.name}|buildRegionPolygons3d failed build`, error);
          path = new ClipperPaths();
          switch ( CONFIG[GEOMETRY_LIB_ID].CONFIG.clipperVersion ) {
            case 1: path.paths = this.region.document.clipperPaths; break;
            case 2: this.region.document.clipperPaths.forEach(p => path.addPathClipper1Points(p)); break;
          }
        }

        // Build a set of faces for the polygons.
        const polys = Polygons3d.fromClipperPaths(path, topZ);
        const face = {
          top: polys,
          bottom: polys.clone().reverseOrientation().setZ(bottomZ),
          sides: [],
        };
        face.sides = face.top.buildTopSides(bottomZ);
        this.combinedFaces.push(face);
      }
    }

    return this.combinedFaces;
  }

  /**
   * Form groups of shapes. If any shape overlaps another, they share a group.
   * So if A overlaps B and B overlaps C, [A,B,C] form a group
   * regardless of whether A overlaps C.
   * @returns {AbstractRegionShapeGeometry[][]} Array, each holding an array of grouped geoms.
   */
  combineRegionShapes() {
    // Form groups of shapes. If any shape overlaps another, they share a group.
    // So if A overlaps B and B overlaps C, [A,B,C] form a group regardless of whether A overlaps C.
    const geoms = this.shapeGeometries;
    const nShapes = geoms.length;
    const usedShapes = new Set();
    const uniqueGeoms = [];
     for ( let i = 0; i < nShapes; i += 1 ) {
      if ( usedShapes.has(i) ) continue;
      const geom = geoms[i];
      const geomGroup = [geom];
      uniqueGeoms.push(geomGroup);
      for ( let j = i + 1; j < nShapes; j += 1 ) {
        if ( usedShapes.has(j) ) continue;
        const other = geoms[j];
        const otherPIXI = other.shapePIXI;

        // Any overlap counts.
        for ( const geom of geomGroup ) {
          const shapePIXI = geom.shapePIXI;
          if ( shapePIXI.overlaps(otherPIXI) ) {
            geomGroup.push(other);
            usedShapes.add(j);
            break;
          }
        }
      }
    }
    return uniqueGeoms;
  }

  /**
   * Top and bottom elevation of a region, accounting for plateaus.
   * @param {Region} region
   * @returns {object}
   * - @prop {number} topZ
   * - @prop {number} bottomZ
   */
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
class AbstractRegionShapeGeometry extends mix(PlaceableGeometry).with(PlaceableAABBMixin, PlaceableModelMatrixMixin, PlaceableFacesMixin) {
  /** @type {TrackerKeys} */
  static TRACKERS = {};

  get shape() { return this.placeable; }

  get shapeIndex() { return this.region.document.shapes.indexOf(this.shape); }

  get isHole() { return this.shape.hole; }

  /** @type {Region} */
  region;

  static create(shape, region) {
    const geom = super.create(shape);
    geom.region = region;
    return geom;
  }

  initialize() {
    this.unrotatedShapePIXI = this.constructor.shapePIXI(this.shape, false);
    this.shapePIXI = this.shape.rotation ? this.constructor.shapePIXI(this.shape, true) : this.unrotatedShapePIXI;
    super.initialize();
  }

  // ----- NOTE: AABB ----- //

  calculateAABB() { return AABB3d.fromShape(this.shapePIXI, this.aabb); }

  // ----- NOTE: PIXI Shape ----- //

  /** @type {PIXI.Polygon|PIXI.Rectangle|PIXI.Circle|PIXI.Ellipse} */
  shapePIXI;

  /** @type {PIXI.Polygon|PIXI.Rectangle|PIXI.Circle|PIXI.Ellipse} */
  unrotatedShapePIXI;

  shapeUpdated() {
    // Handle as one group b/c shape changes impact all three.
    this.calculateTranslationMatrix();
    this.calculateRotationMatrix();
    this.calculateScaleMatrix();

    this.unrotatedShapePIXI = this.constructor.shapePIXI(this.shape, false);
    this.shapePIXI = this.shape.rotation ? this.constructor.shapePIXI(this.shape, true) : this.unrotatedShapePIXI;
    super.shapeUpdated();
  }

  // ----- NOTE: Matrices ----- //

  /**
   * Create an id used for the model matrix tracking.
   * @type {string}
   */
  get placeableId() { return `${this.region.id}-${this.shapeIndex}`; }

  calculateTranslationMatrix() {
    const mat = super.calculateTranslationMatrix();
    const { topZ, bottomZ } = RegionGeometry.regionElevation(this.region);
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
    const { topZ, bottomZ } = RegionGeometry.regionElevation(this.region);
    const scaleZ = topZ - bottomZ;
    return MatrixFloat32.scale(bounds.width, bounds.height, scaleZ, mat);
  }

  _initializePrototypeFaces() {
    if ( this.isHole ) {
      this._prototypeFaces.top.reverseOrientation();
      this._prototypeFaces.bottom.reverseOrientation();
      this._prototypeFaces.top.isHole = true;
      this._prototypeFaces.bottom.isHole = true;
      this._prototypeFaces.sides.forEach(side => side.reverseOrientation());
      // Don't mark sides as holes as they are supposed to be solid (marking the inside side walls for the hole).
    }
    super._initializePrototypeFaces();
  }

  toClipperPath() {
    return this.faces.top.toClipperPaths();
  }

  // ----- NOTE: Shape characteristics ----- //

  static shapePIXI(shape, rotate = true) { return convertRegionShapeToPIXI(shape, rotate); }
}



export class RegionRectangleShapeGeometry extends AbstractRegionShapeGeometry {

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

export class RegionEllipseShapeGeometry extends AbstractRegionShapeGeometry {

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

export class RegionCircleShapeGeometry extends AbstractRegionShapeGeometry {

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

export class RegionPolygonShapeGeometry extends AbstractRegionShapeGeometry {

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
    const poly = this.unrotatedShapePIXI ??= this.constructor.shapePIXI(this.shape, false);
    const polyCenter = poly.center;
    const bounds = poly.getBounds();
    const unitPoly = poly
      .translate(-polyCenter.x, -polyCenter.y)
      .scale(1/bounds.width, 1/bounds.height);
    Polygon3d.fromPolygon(unitPoly, 0.5, this._prototypeFaces.top);
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
