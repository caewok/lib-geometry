/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { AbstractInstancedVertices, AbstractModelVerticesMixin, VertexObject } from "./GeometryDesc.js";
import { Rectangle3dVertices, Polygon3dVertices, Ellipse3dVertices, Circle3dVertices } from "./BasicVertices.js";
import { RegionGeometryTracker } from "../placeable_tracking/RegionGeometryTracker.js";
import { gridUnitsToPixels } from "../util.js";
import { ElevatedPoint } from "../3d/ElevatedPoint.js";
import { GEOMETRY_LIB_ID, GEOMETRY_ID, OTHER_MODULES } from "../const.js";
import { mix } from "../mixwith.js";

export class RegionRectangleInstancedVertices extends AbstractInstancedVertices {
  static type = "RegionRectangle";

  static calculateVertices() { return Rectangle3dVertices._getUnitVertices(); }
}

export class RegionCircleInstancedVertices extends AbstractInstancedVertices {
  static type = "RegionCircle";

  static calculateVertices() { return Circle3dVertices._getUnitVertices(); }
}

export class RegionEllipseInstancedVertices extends AbstractInstancedVertices {
  static type = "RegionEllipse";

  static calculateVertices() { return Ellipse3dVertices._getUnitVertices(); }
}


class AbstractRegionVertices {}

const tmpPoly = new PIXI.Polygon();
export class RegionPolygonModelVertices extends mix(AbstractRegionVertices).with(AbstractModelVerticesMixin)  {

  static type = "RegionPolygon";

  get instanced() { return false; }

  /** @type {RegionShape} */
  get shape() { return this.placeable; }

  /** @type {Region} */
  region;

  constructor(shape, region) {
    super(shape);
    this.region = region;
  }

  calculateModel(opts = {}) {
    tmpPoly.points = this.shape.points;
    const elev = RegionGeometryTracker.regionElevation(this.region);
    const vo = new VertexObject();
    vo.vertices = Polygon3dVertices.calculateVertices(tmpPoly, elev);
    vo.dropNormalsAndUVs({ keepNormals: opts.hasNormals, keepUVs: opts.hasUVs, out: vo });
    vo.condense(vo);
    return vo;
  }
}

export class RegionPolygonRampVertices extends RegionPolygonModelVertices {
  // TODO: Can we cache the untrimmed vertices or untrimmed + elevation change?
  calculateModel(_opts) {
    const elev = RegionGeometryTracker.regionElevation(this.region);
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

export class RegionVertices {

  /** @type {Region} */
  region;

  constructor(region) {
    this.region = region;
  }

  /** @type {enum<string, class>} */
  static VERTEX_CLASSES = {
    rectangle: RegionRectangleInstancedVertices,
    ellipse: RegionEllipseInstancedVertices,
    circle: RegionCircleInstancedVertices,
    polygon: RegionPolygonModelVertices,
  }

  /**
   * Combines the region shapes where necessary.
   * Returns vertex class
   */
  combineShapes() {
    const geom = this.region[GEOMETRY_LIB_ID][GEOMETRY_ID];
    const shapePaths = geom.buildRegionPaths();
    const ClipperPaths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths;
    const out = [];
    for ( const shapePath of shapePaths ) {
      // Create a fake shape to use in lieu of a PolygonShape.
      if ( shapePath instanceof ClipperPaths ) {
        const polys = ClipperPaths.toPolygons();
        for ( const poly of polys ) {
          const shapePoly = {
            points: poly.points,
            type: "polygon",
          };
          out.push(shapePoly);
        }
      } else out.push(shapePath);
    }
    return out;
  }
}


