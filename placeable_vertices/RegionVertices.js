/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { AbstractInstancedVertices, VertexObject } from "./PlaceableVertices.js";
import { Rectangle3dVertices, Polygon3dVertices, Ellipse3dVertices, Circle3dVertices } from "./BasicVertices.js";
import { RegionGeometry } from "../placeable_geometry/RegionGeometry.js";
import { gridUnitsToPixels } from "../util.js";
import { ElevatedPoint } from "../3d/ElevatedPoint.js";
import { GEOMETRY_LIB_ID, GEOMETRY_ID, OTHER_MODULES } from "../const.js";

export class RegionVertices extends AbstractInstancedVertices  {

  static type = "Region";

  get region() { return this.placeable; }

  get instanced() {
    const geom = this.region[GEOMETRY_LIB_ID][GEOMETRY_ID];
    const ST = this.constructor.SHAPE_TYPES;
    return geom.type > ST.POLYGONS;
  }

  calculateModel() {
    const geom = this.region[GEOMETRY_LIB_ID][GEOMETRY_ID];
    const ST = geom.constructor.SHAPE_TYPES;
    const type = geom.type;
    if ( type === ST.HOLE || type === ST.EMPTY ) return new VertexObject();
    if ( this.instanced ) {
      let cl;
      switch ( type ) {
        case ST.EMPTY:
        case ST.HOLE: return new VertexObject();
        case ST.POLYGONS: cl = RegionPolygonModelVertices; break;
        case ST.RECTANGLE: cl = RegionRectangleInstancedVertices; break;
        case ST.ELLIPSE: cl = RegionEllipseInstancedVertices; break;
        case ST.CIRCLE: cl = RegionCircleInstancedVertices; break;
      }
      const obj = new cl(this.placeable);
      return obj.calculateModel();
    }
  }
}

export class RegionPolygonModelVertices extends RegionVertices {

  /** @type {boolean} */
  instanced = false;

  static type = "RegionPolygon";

  calculateModel(opts = {}) {
    const elev = RegionGeometry.regionElevation(this.region);
    const vo = new VertexObject();
    for ( const poly of this.region.document.polygons ) {
      vo.vertices.push(...Polygon3dVertices.calculateVertices(poly, elev));
    }
    vo.dropNormalsAndUVs({ keepNormals: opts.hasNormals, keepUVs: opts.hasUVs, out: vo });
    return vo;
  }
}

export class RegionRectangleInstancedVertices extends RegionVertices {
  /** @type {boolean} */
  instanced = true;

  static type = "RegionRectangle";

  static calculateVertices() { return Rectangle3dVertices._getUnitVertices(); }
}

export class RegionCircleInstancedVertices extends RegionVertices {

  /** @type {boolean} */
  instanced = true;

  static type = "RegionCircle";

  static numTopVertices = 6; // 2 triangles, 3 points each.

  static calculateVertices() { return Circle3dVertices._getUnitVertices(); }
}

export class RegionEllipseInstancedVertices extends RegionVertices {

  /** @type {boolean} */
  instanced = true;

  static type = "RegionEllipse";

  static numTopVertices = 6; // 2 triangles, 3 points each.

  static calculateVertices() { return Ellipse3dVertices._getUnitVertices(); }
}


export class RegionPolygonRampVertices extends RegionPolygonModelVertices {
  static type = "RegionPolygonRamp";

  // TODO: Can we cache the untrimmed vertices or untrimmed + elevation change?
  calculateModel(opts) {
    const tm = this.region[OTHER_MODULES.TERRAIN_MAPPER.ID];
    const useSteps = false;
    const round = false;
    const elev = RegionGeometry.regionElevation(this.region);
    const vo = new VertexObject();
    for ( const poly of this.region.document.polygons ) {
      const untrimmedVertices = Polygon3dVertices.calculateVertices(poly, elev);

      // Modify elevation for ramp.
      // Replace each top elevation with elevation at that point.
      const out = new Float32Array(untrimmedVertices); // Make a copy so untrimmed is not changed.
      for ( let i = 0, n = out.length; i < n; i += 8 ) {
        const [x, y, z] = out.subarray(i, i + 3);
        if ( z !== elev.topZ ) continue;
        const waypoint = ElevatedPoint.fromPoint({ x, y, z });
        out[i + 2] = gridUnitsToPixels(tm._rampElevation(waypoint, useSteps, round));
      }
      vo.vertices.push(...out);
    }
    vo.dropNormalsAndUVs({ keepNormals: opts.hasNormals, keepUVs: opts.hasUVs, out: vo });
    return vo;
  }
}
