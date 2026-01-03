/* globals
canvas,
ClipperLib,
CONFIG,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


import { GeometryNonInstanced, GeometryInstanced, AbstractGeometry } from "./GeometryDesc.js";
import { BasicVertices, Rectangle3dVertices, Circle3dVertices, Ellipse3dVertices, Polygon3dVertices } from "./BasicVertices.js";

import { GEOMETRY_LIB_ID, OTHER_MODULES } from "../const.js";
import { ElevatedPoint } from "../3d/ElevatedPoint.js";
import { gridUnitsToPixels } from "../util.js";

const tmpRect = new PIXI.Rectangle();
const tmpPoly = new PIXI.Polygon();

/*
This assumes that combined shapes should not have interior walls. So we have:
1. Instanced single rects, circles, ellipses that could use a model matrix.
2. Single polygons or combined polygons that are one-offs.
3. Polygons with holes that are one-offs.

If we don't care about interior walls, we could drop combined polygons (2).
This would be helpful in increasing the number of instanced geometries.
*/

/**
 * Determine elevation of a region, specific to LOS considerations.
 * If terrain mapper is present, returns the top of the plateau or ramp.
 * Ensures top and bottom have a defined MIN/MAX, not null or infinity.
 * @param {Region} region
 * @returns {object<topZ: {number}, bottomZ: {number}>}
 */
export function regionElevation(region) {
  const tm = region.terrainmapper;
  let topZ = (tm && tm.isElevated)
    ? gridUnitsToPixels(tm.plateauElevation) : region.topZ;
  let bottomZ = region.bottomZ;
  if ( !(topZ && isFinite(topZ)) ) topZ = 1e06;
  if ( !(bottomZ && isFinite(bottomZ)) ) bottomZ = -1e06;
  const rampFloor = (tm && tm.isRamp) ? gridUnitsToPixels(tm.rampFloor) : null;
  return { topZ, bottomZ, rampFloor };
}

/**
 * Converts region shape to a temporary PIXI shape.
 * Must clone the shape if needed more than just temporarily.
 * @param {RegionShape} regionShape
 * @returns {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon|Ellipse}
 */
const tmpRectangle = new PIXI.Rectangle();
const tmpCircle = new PIXI.Circle();
const tmpPolygon = new PIXI.Polygon();
const tmpEllipse = new PIXI.Ellipse(); // No need for rotation right now?

function convertRegionShapeToPIXI(regionShape) {
  const shapeData = regionShape.data;
  switch ( shapeData.type ) {
    case "rectangle": {
      // TODO: What about the shape data rotation parameter? Is it actually used?
      tmpRectangle.copyFrom(shapeData);
      return tmpRectangle;
    }
    case "polygon": {
      tmpPolygon.points = shapeData.points;
      return tmpPolygon;
    }
    case "circle": {
      tmpCircle.x = shapeData.x;
      tmpCircle.y = shapeData.y;
      tmpCircle.radius = shapeData.radius;
      return tmpCircle;
    }
    case "ellipse": {
      // TODO: What about the shape data rotation parameter? Is it actually used?
      tmpEllipse.x = shapeData.x;
      tmpEllipse.y = shapeData.y;
      tmpEllipse.width = shapeData.radiusX;
      tmpEllipse.height = shapeData.radiusY;
      // tmpEllipse.rotation = shapeData.rotation;
      return tmpEllipse;
    }
    default: console.error(`Shape ${shapeData.type} not recognized.`, regionShape);
  }
}


/**
 * Handles all shapes in a region, comprising multiple geometries.
 * Separates out instanced shapes.
 * Separates out all other single, combined, or holed polygons.
 * Preset to handle interior walls or not.
 */
export class GeometryRegion extends AbstractGeometry {
   // TODO: Cache the data params for the shape. Only update when needed.
   // Use a WeakMap to store the shapes?

  // Can get a decent ellipse or circle with density around 50. Works for radius of 5000+.
  static CIRCLE_DENSITY = 50;

  static MODEL_SHAPES = new Set(["circle", "ellipse", "rectangle"]);

  /** @type {Region} */
  get region() { return this.placeable; };

  get allowInteriorWalls() { return CONFIG[GEOMETRY_LIB_ID].CONFIG.allowInteriorWalls; }


  // Could use IterableWeakMap if we really need to iterate over the map.
  // For now, accessing shapes via region.document.regionShapes is working.
  shapeData = new WeakMap();

  updateShapes() {
    // Cache the PIXI shape and geometry for each region shape.
    this.shapeData = new WeakMap();
    const opts = { addUVs: this.addUVs, addNormals: this.addNormals, density: this.constructor.CIRCLE_DENSITY };
    this.region.document.regionShapes.forEach((shape, idx) => {
      this.shapeData.set(shape, {
        shapePIXI: convertRegionShapeToPIXI(shape).clone(),
        geom: GeometryRectangleRegionShape.createFromRegion(this.region, idx, opts),
      });
    });
  }

//   calculateModelMatrices() {
//     return this.region.document.regionShapes.map(shape => {
//       this.shapeData.get(shape).geom.calculateTransformMatrix();
//     });
//   }

  updateGeometry() {
    const { polyShape, instanceGeoms } = this.calculateInstancedGeometry();
    this.polygonGeom = polyShape;
    this.instanceGeoms = instanceGeoms;
  }

  // Only the polygon vertices and indices.
  get modelVertices() { return this.polygonGeom.vertices; }

  get modelIndices() { return this.polygonGeom.indices; }

  get vertices() { return this.modelVertices; }

  get indices() { return this.modelIndices; }

  instanceGeoms = {};

  polygonGeom;

  /**
   * Calculate the region geometry and combine into a single large vertex and index for the polygons.
   * Keep instanced region separate
   */
  calculateInstancedGeometry() {
    const uniqueShapes = this.combineRegionShapes();
    const shapeGroups = this.groupRegionShapes(uniqueShapes);
    return this.calculateRegionGeometry(shapeGroups);
  }

  /**
   * Combines shapes as necessary and returns data to construct the entire region:
   * 1. For single shapes: the geom
   * 2. For combined polygons or polygons with holes: the untrimmed vertices
   */
  calculateRegionGeometry(shapeGroups) {
    shapeGroups ??= this._groupRegionShapes();
    const { region, addNormals, addUVs } = this;
    const opts = { region, addNormals, addUVs, density: this.constructor.CIRCLE_DENSITY };
    const { topZ, bottomZ } = regionElevation(region);
    const polyVOpts = { topZ, bottomZ, useFan: this.useFan };
    const out = {
      circle: [],
      ellipse: [],
      rectangle: [],
      polygon: [],
      combined: [],
    };

    // If the region is a ramp or step, make all the shapes polygons or combined.
    const TM = OTHER_MODULES.TERRAIN_MAPPER;
    if ( TM && this.region[TM.ID].isRamp ) {
      for ( const [type, groupArr] of Object.entries(shapeGroups) ) {
        const outArr = type === "combined" ? out.combined : out.polygon;
        for ( const shapeGroup of groupArr ) {
          let geom;
          const id = `${region.sourceId}_${shapeGroup.type}_${shapeGroup.idx}`;
          switch ( type ) {
            case "circle":
            case "ellipse":
            case "rectangle":
            case "polygon": {
              const shape = shapeGroup.shapes[0]; // Always singular for circle, ellipse, rect.
              geom = new GeometryRampRegionShape({ placeable: shape, ...opts });
              geom.id = id;
              break;
            }
            case "combined": {
              const vertices = Polygon3dVertices.calculateVertices(shapeGroup.path, polyVOpts);
              geom = new GeometryRampRegionShape(opts);
              geom.id = id;
              geom._untrimmedVertices = vertices;
              break;
            }
          }
          outArr.push(geom);
        }
      }
      return out;
    }

    for ( const [type, groupArr] of Object.entries(shapeGroups) ) {
      const outArr = out[type];
      for ( const shapeGroup of groupArr ) {
        let geom;
        switch ( type ) {
          case "circle":
          case "ellipse":
          case "rectangle":
          case "polygon": {
            const shape = shapeGroup.shapes[0]; // Always singular for circle, ellipse, rect.
            if ( !this.shapeData.has(shape) ) this.updateShapes(); // TODO: Should not be needed here.
            geom = this.shapeData.get(shape).geom;
            break;
          }
          case "combined": {
            const vertices = Polygon3dVertices.calculateVertices(shapeGroup.path, polyVOpts);
            geom = new GeometryPolygonRegionShape(opts);
            geom.id = `${region.sourceId}_${shapeGroup.type}_${shapeGroup.idx}`;
            geom._untrimmedVertices = vertices;
            break;
          }
        }
        outArr.push(geom);
      }
    }
    return out;
  }

  groupRegionShapes(uniqueShapes) {
    uniqueShapes ??= this.combineRegionShapes();
    const ClipperPaths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths;
    const out = {
      circle: [],
      ellipse: [],
      rectangle: [],
      polygon: [],
      combined: [],
    };
    for ( const shapeGroup of uniqueShapes ) {
      if ( shapeGroup.type === "combined" ) {
        // Combine using Clipper.
        const paths = shapeGroup.shapes.map(shape => this.constructor.shapeToClipperPaths(shape));
        const combinedPaths = paths.length === 1 ? paths[0] : ClipperPaths.joinPaths(paths);
        const path = combinedPaths.combine();
        shapeGroup.path = path;
        out.polygon.push(shapeGroup);
      }
      out[shapeGroup.type].push(shapeGroup);
    }
    return out;
  }

  /**
   * Calculate the region geometry and combine into a single large vertex and index.
   * No instancing
   */
//   calculateNonInstancedGeometry() {
//     const { addNormals, addUVs } = this;
//     const { instanceGeoms, polygonVertices } = this.calculateRegionGeometry();
//     const untrimmedInstanceVs = instanceGeoms.map(geom => geom.untrimmedVertices);
//     if ( !(polygonVertices.length || untrimmedInstanceVs.length) ) return {};
//
//     // TODO: Create one or multiple poly shapes?
//
//
//
//     const trimmedData = BasicVertices.trimVertexData(combineTypedArrays([...polygonVertices, ...untrimmedInstanceVs]), { addNormals, addUVs });
//     const polyShape = new GeometryPolygonRegionShape({region: this.region, addNormals, addUVs });
//     polyShape._vertices = trimmedData.vertices;
//     polyShape._indices = trimmedData.indices;
//     return polyShape;
//   }



  /**
   * TODO: Preset PIXI shapes for each shape? Use in the GeometryShapes below?
   * Combine the region shapes by testing for overlap.
   * See PlaceableTriangles.combine2dShapes
   */
  combineRegionShapes() {
    const region = this.region;
    const nShapes = region.document.regionShapes.length;
    if ( !nShapes ) return [];

    // Form groups of shapes. If any shape overlaps another, they share a group.
    // So if A overlaps B and B overlaps C, [A,B,C] form a group regardless of whether A overlaps C.
    const usedShapes = new Set();
    const uniqueShapes = [];
    const omitInteriorWalls = !this.allowInteriorWalls;
    for ( let i = 0; i < nShapes; i += 1 ) {
      const shape = region.document.regionShapes[i];
      if ( usedShapes.has(shape) ) continue; // Don't need to add to usedShapes b/c not returning to this shape.
      const shapeGroup = { shapes: [shape], hasHole: shape.data.hole, path: null };
      for ( let j = i + 1; j < nShapes; j += 1 ) {
        const other = region.document.regionShapes[j];
        if ( usedShapes.has(other) ) continue;
        const otherPIXI = this.shapeData.get(other).shapePIXI;

        // Any overlap counts if a hole or if we want to combine polys to avoid interior walls.
        for ( const shape of shapeGroup.shapes ) {
          if ( (other.data.hole || shapeGroup.hasHole || omitInteriorWalls)
            && this.shapeData.get(shape).shapePIXI.overlaps(otherPIXI) ) {

            shapeGroup.hasHole ||= other.data.hole;
            shapeGroup.shapes.push(other);
            usedShapes.add(other);
            break;
          }
        }
      }
      uniqueShapes.push(shapeGroup);
    }
    return uniqueShapes;
  }

  /**
   * Convert a shape's clipper points to the clipper path class.
   */
  static shapeToClipperPaths(shape) {
    if ( shape.clipperPaths.length !== 1 ) console.error("Shape clipper paths not recognized.");
    let clipperPoints = shape.clipperPaths;
    const scalingFactor = CONST.CLIPPER_SCALING_FACTOR;
    const ClipperPaths = CONFIG.tokenvisibility.ClipperPaths;
    if ( shape.data.hole ^ !ClipperLib.Clipper.Orientation(clipperPoints[0]) ) {
      // Don't modify the original array.
      const tmp = [...clipperPoints[0]];
      tmp.reverse();
      clipperPoints = [tmp];
    }

    switch ( CONFIG[GEOMETRY_LIB_ID].clipperVersion ) {
      // For both, the points are already scaled, so just pass through the scaling factor to the constructor.
      case 2: return new ClipperPaths(ClipperPaths.pathFromClipper1Points(clipperPoints), { scalingFactor });
      default: return new ClipperPaths(clipperPoints, { scalingFactor });
    }
  }

  // ----- NOTE: Debug ----- //

  debugDrawModel(opts = {}) {
    opts.addNormal ??= this.addNormals;
    opts.addUVs ??= this.addUVs;
    const { vertices, indices } = this.calculateNonInstancedGeometry();
    if ( vertices.length ) BasicVertices.debugDraw(vertices, indices, opts);
  }

  debugDrawWithInstancedModels(opts = {}) {
    opts.addNormal ??= this.addNormals;
    opts.addUVs ??= this.addUVs;
    const { polygons, instanceGeoms } = this.calculateInstancedGeometry();
    if ( polygons.vertices ) BasicVertices.debugDraw(polygons.vertices, polygons.indices, opts);
    instanceGeoms.forEach(geom => geom.debugDrawModel(opts));
  }
}


const RegionShapeMixin = function(Base) {
  class GeometryRegionShape extends Base {
    get shape() { return this.placeable; } // Not technically a placeable

    region; // Needed to get elevation and flag data.

    constructor(shape, { region, ...opts } = {}) {
      super(opts);
      this.region = region;
    }

    static createFromRegion(region, idx, opts = {}) {
      const shape = region.document.regionShapes[idx];
      const cl = REGION_SHAPE_CLASSES[shape.data.type];
      const geom = new cl(shape, { region, ...opts });
      geom.id = `${region.sourceId}_${shape.data.type}_${idx}`;
      return geom;
    }

    _defineInstanceVertices(cl, opts) {
      this._untrimmedInstanceVertices = cl.calculateVertices(undefined, opts);
      return this._untrimmedInstanceVertices;
    }
  }
  return GeometryRegionShape;
}

class GeometryRectangleRegionShape extends RegionShapeMixin(GeometryInstanced) {

  _defineInstanceVertices() {
    const untrimmedV = Rectangle3dVertices.calculateVertices();
    return super._defineInstanceVertices(Rectangle3dVertices, untrimmedV);
  }

  _modelMatrix(shape) {
    // TODO: Does the rectangle shape ever use its rotation property?
    const { x, y, width, height } = shape.data;
    const elev = regionElevation(this.region);
    tmpRect.x = x;
    tmpRect.y = y;
    tmpRect.width = width;
    tmpRect.height = height;
    return Rectangle3dVertices.transformMatrixFromRectangle(tmpRect, elev);
  }
}

class GeometryEllipseRegionShape extends RegionShapeMixin(GeometryInstanced) {

  static NUM_DENSITY_INCREMENTS = 10;

  get density() { return this.type; }


  constructor(type, { radius, density, ...opts } = {}) {
    radius ??= canvas.grid.size;
    density ??= GeometryEllipseRegionShape.instanceDensityForRadius(radius); // Cannot use "this" yet.
    opts.type = density;
    super(opts);
  }

  static instanceDensityForRadius(radius) {
    const density = PIXI.Circle.approximateVertexDensity(radius);
    const N = this.NUM_DENSITY_INCREMENTS;
    return Math.ceil(density / N) * N; // Round up to nearest N.
  }

  _defineInstanceVertices(cl, opts = {}) {
    cl ??= Ellipse3dVertices;
    opts.density ??= this.density;
    return super._defineInstanceVertices(cl, opts);
  }

  _modelMatrix(shape) {
    const { x, y, radiusX, radiusY } = shape.data;
    const elev = regionElevation(this.region);
    tmpEllipse.x = x;
    tmpEllipse.y = y;
    tmpEllipse.width = radiusX;
    tmpEllipse.height = radiusY;
    return Ellipse3dVertices.transformMatrixFromEllipse(tmpEllipse, elev);
  }
}

class GeometryCircleRegionShape extends GeometryEllipseRegionShape {

  _defineInstanceVertices() {
    const density = this.density;
    return super._defineInstanceVertices(Circle3dVertices, { density });
  }

  _modelMatrix(shape) {
    const { x, y, radius } = shape.data;
    const elev = regionElevation(this.region);
    tmpCircle.x = x;
    tmpCircle.y = y;
    tmpCircle.radius = radius;
    return Circle3dVertices.transformMatrixFromCircle(tmpCircle, elev);
  }
}

class GeometryPolygonRegionShape extends RegionShapeMixin(GeometryNonInstanced) {

  _calculateModelVertices() {
    tmpPoly.points = this.placeable.data.points;
    const elev = regionElevation(this.region);
    return Polygon3dVertices.calculateVertices(tmpPoly, elev);
  }
}

export class GeometryRampRegionShape extends GeometryPolygonRegionShape {
  /** @type {PIXI.Polygon} */
  poly;

  constructor(opts = {}) {
    super(opts);
    if ( this.placeable ) this.poly = convertRegionShapeToPIXI(this.placeable).toPolygon({ density: opts.density || GeometryRegion.CIRCLE_DENSITY });
  }

  // TODO: Can we cache the untrimmed vertices or untrimmed + elevation change?
  _calculateModelVertices() {
    const elev = regionElevation(this.region);
    let untrimmedVertices;
    if ( this.placeable ) untrimmedVertices = Polygon3dVertices.calculateVertices(this.poly, elev);

    const vs = untrimmedVertices;
    const tm = this.region[OTHER_MODULES.TERRAIN_MAPPER.ID];
    const useSteps = false;
    const round = false;

    // Modify elevation for ramp.
    // Replace each top elevation with elevation at that point.
    const out = new Float32Array(untrimmedVertices); // Make a copy so untrimmed is not changed.
    for ( let i = 0, iMax = vs.length; i < iMax; i += 8 ) {
      const [x, y, z] = out.subarray(i, i + 3);
      if ( z !== elev.topZ ) continue;
      const waypoint = ElevatedPoint.fromPoint({ x, y, z });
      out[i + 2] = gridUnitsToPixels(tm._rampElevation(waypoint, useSteps, round));
    }

    return out;
  }

}

export const REGION_SHAPE_CLASSES = {
  ellipse: GeometryEllipseRegionShape,
  circle: GeometryCircleRegionShape,
  polygon: GeometryPolygonRegionShape,
  rectangle: GeometryRectangleRegionShape,
  ramp: GeometryRampRegionShape,
}
