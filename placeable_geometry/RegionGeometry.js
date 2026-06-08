/* globals
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
import { NULL_SET } from "../util.js";
import { CenteredPolygon } from "../CenteredPolygon/CenteredPolygon.js";
import { CenteredRectangle } from "../CenteredPolygon/CenteredRectangle.js";
import { Ellipse } from "../Ellipse.js";
import { OTHER_MODULES } from "../const.js";
import { AABB3d } from "../3d/AABB3d.js";
import { MatrixFloat32 } from "../Matrix.js";
import { Quad3d, Polygon3d, Polygons3d, Ellipse3d, Circle3d } from "../3d/Polygon3d.js";

/**
  Region will either be a single shape or a group of polygons.
  If more than one shape, treated as polygons.

  NOTE: Shapes can be destroyed/recreated without an update hook.
  Presumably, they are not getting changed without a hook.

  Regions store combined shapes as region.polygons.
*/

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
};


export class RegionGeometry extends PlaceableGeometry {
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

  static TRACKER_TYPES = TRACKER_TYPES;

  static UPDATE_KEYS = {
    position: new Set(TRACKER_TYPES.elevation),
    scale: NULL_SET,
    rotation: NULL_SET,
    shape: new Set(TRACKER_TYPES.shapes),
    properties: NULL_SET,
  };

  get region() { return this.placeable; }

  get shapes() { return this.placeable.document.shapes; }

  get polygons() { return this.placeable.document.polygons; }

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
    if ( shapes.some(shape => shape.gridBased) ) return ST.POLYGONS;
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
      case ST.ELLIPSE: return RegionEllipseShapeGeometry.create(this.region);
      case ST.CIRCLE: return RegionCircleShapeGeometry.create(this.region);
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

  get modelMatrix() { return this.shapeGeom.modelMatrix; }

  get placeableId() { return this.shapeGeom.placeableId; }

  destroy() { this.shapeGeom.destroy(); super.destroy(); }

  // ----- NOTE: Faces ---- //

  get _prototypeFaces() { return this.shapeGeom._prototypeFaces; }

  get faces() { return this.shapeGeom.faces; }

  *iterateFaces() { yield* this.shapeGeom.iterateFaces(); }

  rayIntersection(rayOrigin, rayDirection, opts) { return this.shapeGeom.rayIntersection(rayOrigin, rayDirection, opts); }

  draw2d(opts) { this.shapeGeom.draw2d(opts); }

  // Mostly for debugging at the moment, but may become important for ramps.
  // TODO: if the number of region polygons === number of region shapes,
  // can we infer a 1:1 relationship?
  // And if so, can we use the actual shape (circle/ellipse/rectangle/poly)?
  get _polygonFaces() { return this._polygonGeom._polygonFaces; }

  get _polygonGeom() {
    if ( this.shapeGeom instanceof RegionPolygonShapeGeometry ) return this.shapeGeom;
    const geom = RegionPolygonShapeGeometry.create(this.region);
    geom.initialize();
    return geom;
  };

  // ----- NOTE: Update underlying shapes ----- //

  shapeUpdated() {
    // Must rebuild the shape; likely changed.
    this.shapeGeom = this.buildGeometry();
    this.shapeGeom.initialize();
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
    // Same as TokenGeometry#initializeCubeFaces.
    // Build top/bottom.
    this.constructor.QUADS.up.clone(this._prototypeFaces.top);
    this.constructor.QUADS.down.clone(this._prototypeFaces.bottom);
    this._prototypeFaces.top.setZ(0.5);
    this._prototypeFaces.bottom.setZ(-0.5);

    // Build sides.
    this._prototypeFaces.sides.length = 0;
    this._prototypeFaces.sides.push(
      this.constructor.QUADS.north.clone(),
      this.constructor.QUADS.west.clone(),
      this.constructor.QUADS.south.clone(),
      this.constructor.QUADS.east.clone(),
    );

    // Adjust the sides so that they are at the region edge.
    for ( let i = 0; i < 4; i += 1 ) {
      this._prototypeFaces.sides[0].points[i].y = -0.5; // North.
      this._prototypeFaces.sides[1].points[i].x = -0.5; // West.
      this._prototypeFaces.sides[2].points[i].y = 0.5; // South.
      this._prototypeFaces.sides[3].points[i].x = 0.5; // East.
    }
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
    // By default, the Ellipse3d faces up.
    // Same as TokenGeometry#initializeEllipseFaces
    this._prototypeFaces.top.radiusX = 1;
    this._prototypeFaces.top.radiusY = 1;
    this._prototypeFaces.top.clone(this._prototypeFaces.bottom);
    this._prototypeFaces.bottom.reverseOrientation();
    this._prototypeFaces.top.setZ(0.5);
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
    // By default, the Circle3d faces up.
    // Same as TokenGeometry#initializeEllipseFaces
    this._prototypeFaces.top.radius = 1;
    this._prototypeFaces.top.clone(this._prototypeFaces.bottom);
    this._prototypeFaces.bottom.reverseOrientation();
    this._prototypeFaces.top.setZ(0.5);
    this._prototypeFaces.bottom.setZ(-0.5);

    const density = PIXI.Circle.approximateVertexDensity(this.shape.radius);
    this._prototypeFaces.sides = this._prototypeFaces.top.buildTopSides(-0.5, { density });
    super._initializePrototypeFaces();
  }
}

export class RegionPolygonShapeGeometry extends AbstractRegionShapeGeometry {

  /** @type {PIXI.Polygon[]} */
  get polygons() { return this.placeable.document.polygons; }

  calculateAABB() {
    const { topZ, bottomZ } = RegionGeometry.regionElevation(this.region);
    const z = [topZ, bottomZ];
    const aabbs = this.polygons.map(poly => AABB3d.fromPolygon(poly, z));
    AABB3d.union(aabbs, this.aabb);
    aabbs.forEach(aabb => aabb.release());
  }

  // ----- NOTE: Faces ---- //

  /** @type {Faces} */
  _initializePrototypeFaces() { /* Unused */ }

  // Mostly for debugging at the moment, but may become important for ramps.
  // TODO: if the number of region polygons === number of region shapes,
  // can we infer a 1:1 relationship?
  // And if so, can we use the actual shape (circle/ellipse/rectangle/poly)?
  _polygonFaces = {
    top: [],
    bottom: [],
    sides: [],
  };

  _updateFaces() {
    // TODO: Handle ramps

    this._polygonFaces.top.length = 0;
    this._polygonFaces.bottom.length = 0;
    this._polygonFaces.sides.length = 0;
    const polys = this.polygons;
    if ( !polys.length ) {
      this.faces.top = null;
      this.faces.bottom = null;
      this.faces.sides = [];
      return;
    }

    let top;
    let bottom;
    let sides;
    if ( polys.length === 1 ) {
      ({ top, bottom, sides } = this._buildPolygonFaces(polys[0]));
      this._polygonFaces.top.push(top);
      this._polygonFaces.bottom.push(bottom);
      this._polygonFaces.sides.push(sides);
    } else {
      top = new Polygons3d();
      bottom = new Polygons3d();
      sides = [];
      for ( const poly of polys ) {
        const res = this._buildPolygonFaces(poly);
        top.polygons.push(res.top);
        bottom.polygons.push(res.bottom);
        sides.push(...res.sides);

        this._polygonFaces.top.push(res.top);
        this._polygonFaces.bottom.push(res.bottom);
        this._polygonFaces.sides.push(res.sides);
      }
    }
    this.faces.top = top;
    this.faces.bottom = bottom;
    this.faces.sides = sides;
  }

  _buildPolygonFaces(poly) {
    const { topZ, bottomZ } = RegionGeometry.regionElevation(this.region);
    const top = Polygon3d.fromPolygon(poly, topZ);
    const bottom = top.clone()
    top.setZ(topZ);
    bottom.setZ(bottomZ);

    // Top faces up.
    // Bottom faces down
    // Holes are ignored.
    top.plane.normal.set(0, 0, 1);
    bottom.plane.normal.set(0, 0, -1);

    // Foundry default is for positive polygons to be normal; not positive are holes.
    if ( !poly.isPositive ) {
      top.isHole = true;
      bottom.isHole = true;
    }

    // Sides will orient based on the isHole parameter.
    const sides = top.buildTopSides(bottomZ);
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
