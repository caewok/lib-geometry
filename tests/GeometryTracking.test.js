/* globals
PIXI,
*/
"use strict";

import { MODULE_ID } from "../../const.js";
import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "../const.js";
import { WallGeometryTracker } from "../placeable_tracking/WallGeometryTracker.js";
import { TokenGeometryTracker } from "../placeable_tracking/TokenGeometryTracker.js";
import { TileGeometryTracker } from "../placeable_tracking/TileGeometryTracker.js";
import { RegionGeometryTracker } from "../placeable_tracking/RegionGeometryTracker.js";

export function registerTests(quench) {

  quench.registerBatch(
    `${MODULE_ID}.libGeometry.GeometryTracking`,

  (context) => {
      const { describe, it, expect, before } = context;

// ----- NOTE: AABB2d.overlapsAABB -----
describe("Walls", () => {
  before(() => {
    WallGeometryTracker.registerExistingPlaceables()
  });

  describe("Model Matrix", () => {
    it("should have numeric values", () => {
      canvas.walls.placeables.forEach(wall => {
        const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.wall.geomForPlaceable(wall);
        expect(geom.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
      });
    });
  });
});

describe("Tokens", () => {
  before(() => {
    TokenGeometryTracker.registerExistingPlaceables()
  });

  describe("Model Matrix", () => {
    it("should have numeric values", () => {
      canvas.tokens.placeables.forEach(token => {
        const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.token.geomForPlaceable(token);
        expect(geom.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
      });
    });
  });
});

describe("Tiles", () => {
  before(() => {
    TileGeometryTracker.registerExistingPlaceables()
  });

  describe("Model Matrix", () => {
    it("should have numeric values", () => {
      canvas.tiles.placeables.forEach(tile => {
        const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.tile.geomForPlaceable(tile);
        expect(geom.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
      });
    });
  });
});

describe("Regions", () => {
  before(() => {
    RegionGeometryTracker.registerExistingPlaceables()
  });

  describe("Model Matrix", () => {
    // Region shapes have the model matrix
    it("should have numeric values", () => {
      canvas.regions.placeables.forEach(region => {
        const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.region.geomForPlaceable(region);
        expect(regionGeom.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
      });
    });
  });

  describe("AABB", () => {
    it("should have numeric values", () => {
      canvas.regions.placeables.forEach(region => {
        const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.region.geomForPlaceable(region);
        expect(isFinite(geom.aabb.min.x)).to.be.true;
        expect(isFinite(geom.aabb.min.y)).to.be.true;
        expect(Number.isNumeric(geom.aabb.min.z)).to.be.true;
        expect(isFinite(geom.aabb.max.x)).to.be.true;
        expect(isFinite(geom.aabb.max.y)).to.be.true;
        expect(Number.isNumeric(geom.aabb.max.z)).to.be.true;
      });
    });

  });
});

},
{ displayName: "libGeometry: Geometry tracking" },
);

}


