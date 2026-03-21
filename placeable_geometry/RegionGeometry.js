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
  Region will either be a single shape or a group of polygons.
  If more than one shape, treated as polygons.

  NOTE: Shapes can be destroyed/recreated without an update hook.
  Presumably, they are not getting changed without a hook.

  Regions store combined shapes as region.polygons.
*/


/**
 * Prototype order:
 * WallGeometryTracker -> PlaceableFacesMixin -> PlaceableMatricesMixin -> PlaceableAABBMixin -> PlaceableGeometry
 */
export class RegionGeometry extends mix(PlaceableGeometry).with(PlaceableAABBMixin, PlaceableFacesMixin) {
  /** @type {string} */
  static PLACEABLE_NAME = "Region";

  /** @type {string} */
  static layer = "regions";

  static SHAPE_TYPES = {
    EMPTY: -1,
    HOLE: 0,
    POLYGONS: 1,
    RECTANGLE: 2,
    ELLIPSE: 3,
    CIRCLE: 4,
  };

  get region() { return this.placeable; }

  get shapes() { return this.placeable.document.shapes; }

  get polygons() { return this.placeable.polygons; }

  get hasMultiPlaneRamp() {
    const TM = OTHER_MODULES.TERRAIN_MAPPER;
    if ( !TM ) return false;
    const tmHandler = this.region[TM.KEY];
    return tmHandler.isRamp && tmHandler.splitPolygons;
  }

  get type() {
    const shapes = this.shapes;
    const ST = this.constructor.SHAPE_TYPES;
    if ( !shapes.length ) return ST.EMPTY;
    if ( shapes.every(shape => shape.hole) ) return ST.HOLE;
    if ( shapes.length > 1 ) return ST.POLYGONS;
    switch ( shapes[0].type ) {
      case "rectangle": return ST.RECTANGLE;
      case "ellipse": return ST.ELLIPSE;
      case "circle": return ST.CIRCLE;
      default: return ST.POLYGONS;
    }
  }

  /** @type {AbstractRegionShapeGeometry} */
  shapeGeom;

  buildGeometry() {
    // TODO: Handle ramps
    const ST = this.constructor.SHAPE_TYPES;
    switch ( this.type ) {
      case ST.EMPTY:
      case ST.HOLE:
      case ST.POLYGONS: return RegionPolygonShapeGeometry.create(this.region);
      case ST.RECTANGLE: return RegionRectangleShapeGeometry.create(this.region);
      case ST.ELLIPSE: return RegionRectangleShapeGeometry.create(this.region);
      case ST.CIRCLE: return RegionRectangleShapeGeometry.create(this.region);
    }
  }

  initialize() {
    this.shapeGeom = this.buildGeometry();
    this.shapeGeom.initialize();
    super.initialize();
  }

  // ----- NOTE: AABB ----- //

  get aabb() { return this.shapeGeom.aabb; }

  // ----- NOTE: Matrices ---- //

  get model() { return this.shapeGeom.model; }

  get _model() { return this.shapeGeom._model; }

  // ----- NOTE: Faces ---- //

  get _prototypeFaces() { return this.shapeGeom._prototypeFaces; }

  get faces() { return this.shapeGeom.faces; }

  _updateFaces() { this.shapeGeom._updateFaces(); }

  // ----- NOTE: Update underlying shapes ----- //

  shapeUpdated() {
    // Must rebuild the shape; likely changed.
    this.shapeGeom = this.buildGeometry();
    this.shapeGeom.initialize();
    this._initializePrototypeFaces();
    super.shapeUpdated();
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

  get region() { return this.placeable; }

  get shapes() { return this.placeable.document.shapes; }

  static create(region) { return new this(region); }
}

class InstancedShape extends AbstractRegionShapeGeometry {

  get shape() { return this.placeable.document.shapes[0]; }

  initialize() {
    this.unrotatedShapePIXI = this.constructor.shapePIXI(this.shape, false);
    this.shapePIXI = this.shape.rotation ? this.constructor.shapePIXI(this.shape, true) : this.unrotatedShapePIXI;
    super.initialize();
  }

  // ----- NOTE: PIXI Shape ----- //

  /** @type {PIXI.Polygon|PIXI.Rectangle|PIXI.Circle|PIXI.Ellipse} */
  shapePIXI;

  /** @type {PIXI.Polygon|PIXI.Rectangle|PIXI.Circle|PIXI.Ellipse} */
  unrotatedShapePIXI;

  static shapePIXI(shape, rotate = true) { return convertRegionShapeToPIXI(shape, rotate); }

  // ----- NOTE: AABB ----- /

  calculateAABB() {
    const { topZ, bottomZ } = this.region;
    return AABB3d.fromShape(this.shapePIXI, [topZ, bottomZ], this.aabb);
  }

  // ----- NOTE: Matrices ----- //

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
}

export class RegionRectangleShapeGeometry extends InstancedShape {

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

export class RegionEllipseShapeGeometry extends InstancedShape {

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
}

export class RegionCircleShapeGeometry extends InstancedShape {

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
}

export class RegionPolygonShapeGeometry extends AbstractRegionShapeGeometry {

  /** @type {PIXI.Polygon[]} */
  get polygons() { return this.placeable.polygons; }

  initialize() { /* Unused */ }

  calculateAABB() {
    const { topZ, bottomZ } = this.region;
    const z = [topZ, bottomZ];
    const aabbs = this.polygons.map(poly => AABB3d.fromPolygon(poly, z));
    const out = AABB3d.union(aabbs);
    aabbs.forEach(aabb => aabb.release());
    return out;
  }

  // ----- NOTE: Faces ---- //

  /** @type {Faces} */
  _initializePrototypeFaces() { /* Unused */ }

  _updateFaces() {
    // TODO: Handle ramps
    const polys = this.polygons;
    let top;
    let bottom;
    let sides;
    if ( polys.length > 1 ) ({ top, bottom, sides } = this._buildPolygonFace(polys[0]));
    else {
      top = new Polygons3d();
      bottom = new Polygons3d();
      sides = [];
      for ( const poly of polys ) {
        const res = this._buildPolygonFace(poly);
        top.polygons.push(res.top);
        bottom.polygons.push(res.bottom);
        sides.push(...res.sides);
      }
    }
    this.faces.top = top;
    this.faces.bottom = bottom;
    this.faces.sides = sides;
  }

  _buildPolygonFace(poly) {
    const { topZ, bottomZ } = this.region;
    const top = Polygon3d.fromPolygon(poly, topZ);
    const bottom = top.clone().reverseOrientation();
    bottom.setZ(bottomZ);
    const sides = top.buildTopSides(bottomZ);

    // TODO: Is hole orientation correct for each face?
    return { top, bottom, sides };
  }

  // Model matrix is identity b/c the polygons are in canvas coordinates, not instanced.
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
