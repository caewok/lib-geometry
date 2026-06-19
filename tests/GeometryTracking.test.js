/* globals
canvas,
CONFIG,
*/
"use strict";

import { MODULE_ID } from "../../const.js";
import { GEOMETRY_LIB_ID } from "../const.js";

export function registerTests(quench) {
  quench.registerBatch(
    `${MODULE_ID}.libGeometry.GeometryTracking`,

  (context) => {
      const { describe, it, expect, before } = context;

// ----- NOTE: AABB2d.overlapsAABB -----
describe("Walls", () => {
  let mgr;
  before(() => {
    mgr = CONFIG[GEOMETRY_LIB_ID].geometryManager;
    if ( !mgr.wall ) {
      mgr.types.push("wall");
      mgr.wall = new mgr.constructor.GEOMETRY_MANAGERS.wall;
      mgr.wall.registerHooks();
      mgr.wall.initializeScene();
    }
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
  let mgr;
  before(() => {
    mgr = CONFIG[GEOMETRY_LIB_ID].geometryManager;
    if ( !mgr.token ) {
      mgr.types.push("token");
      mgr.token = new mgr.constructor.GEOMETRY_MANAGERS.token;
      mgr.token.registerHooks();
      mgr.token.initializeScene();
    }
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
  let mgr;
  before(() => {
    mgr = CONFIG[GEOMETRY_LIB_ID].geometryManager;
    if ( !mgr.tile ) {
      mgr.types.push("tile");
      mgr.tile = new mgr.constructor.GEOMETRY_MANAGERS.tile;
      mgr.tile.registerHooks();
      mgr.tile.initializeScene();
    }
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
  let mgr;
  before(() => {
    mgr = CONFIG[GEOMETRY_LIB_ID].geometryManager;
    if ( !mgr.region ) {
      mgr.types.push("region");
      mgr.region = new mgr.constructor.GEOMETRY_MANAGERS.region;
      mgr.region.registerHooks();
      mgr.region.initializeScene();
    }
  });

  describe("Model Matrix", () => {
    // Region shapes have the model matrix
    it("should have numeric values", () => {
      canvas.regions.placeables.forEach(region => {
        const geom = mgr.region.geomForPlaceable(region);
        expect(geom.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
      });
    });
  });

  describe("AABB", () => {
    it("should have numeric values", () => {
      canvas.regions.placeables.forEach(region => {
        const geom = mgr.region.geomForPlaceable(region);
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

describe("Levels", () => {
  let mgr;
  before(() => {
    mgr = CONFIG[GEOMETRY_LIB_ID].geometryManager;
    if ( !mgr.level ) {
      mgr.types.push("level");
      mgr.level.background = new mgr.constructor.GEOMETRY_MANAGERS.level.background;
      mgr.level.background.registerHooks();
      mgr.level.background.initializeScene();

      mgr.level.foreground = new mgr.constructor.GEOMETRY_MANAGERS.level.foreground;
      mgr.level.foreground.registerHooks();
      mgr.level.foreground.initializeScene();
    }
  });

  describe("Model Matrix", () => {
    // Region shapes have the model matrix
    it("should have numeric values", () => {
      canvas.scene.levels.forEach(levelD => {
        const geom = mgr.level.background.geomForPlaceableDocument(levelD);
        expect(geom.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
      });
    });
  });

  describe("AABB", () => {
    it("should have numeric values", () => {
      canvas.scene.levels.forEach(levelD => {
        const geom = mgr.region.geomForPlaceableDocument(levelD);
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


