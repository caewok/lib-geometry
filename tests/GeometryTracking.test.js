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
    if ( !mgr.walls ) mgr.addManager("walls");
  });

  describe("Model Matrix", () => {
    it("should have numeric values", () => {
      canvas.walls.placeables.forEach(wall => {
        const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.walls.geomForPlaceable(wall);
        for ( const shape of geom.shapes ) {
          expect(shape.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
        }
      });
    });
  });

  describe("AABB", () => {
    it("should have numeric values", () => {
      canvas.walls.placeables.forEach(wall => {
        const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.walls.geomForPlaceable(wall);
        expect(isFinite(geom.aabb.min.x)).to.be.true;
        expect(isFinite(geom.aabb.min.y)).to.be.true;
        expect(isFinite(geom.aabb.min.z)).to.be.true;
        expect(isFinite(geom.aabb.max.x)).to.be.true;
        expect(isFinite(geom.aabb.max.y)).to.be.true;
        expect(isFinite(geom.aabb.max.z)).to.be.true;
      });
    });
  });
});

describe("Tokens", () => {
  let mgr;
  before(() => {
    mgr = CONFIG[GEOMETRY_LIB_ID].geometryManager;
    if ( !mgr.tokens ) mgr.addManager("tokens");
  });

  describe("Model Matrix", () => {
    it("should have numeric values", () => {
      canvas.tokens.placeables.forEach(token => {
        const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.tokens.geomForPlaceable(token).full;
        for ( const shape of geom.shapes ) {
          expect(shape.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
        }
      });
    });
  });

  describe("AABB", () => {
    it("should have numeric values", () => {
      canvas.tokens.placeables.forEach(token => {
        const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.tokens.geomForPlaceable(token).full;
        expect(isFinite(geom.aabb.min.x)).to.be.true;
        expect(isFinite(geom.aabb.min.y)).to.be.true;
        expect(isFinite(geom.aabb.min.z)).to.be.true;
        expect(isFinite(geom.aabb.max.x)).to.be.true;
        expect(isFinite(geom.aabb.max.y)).to.be.true;
        expect(isFinite(geom.aabb.max.z)).to.be.true;
      });
    });
  });
});

describe("Tiles", () => {
  let mgr;
  before(() => {
    mgr = CONFIG[GEOMETRY_LIB_ID].geometryManager;
    if ( !mgr.tiles ) mgr.addManager("levels");
  });

  describe("Model Matrix", () => {
    it("should have numeric values", () => {
      canvas.tiles.placeables.forEach(tile => {
        const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.tiles.geomForPlaceable(tile).full;
        for ( const shape of geom.shapes ) {
          expect(shape.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
        }
      });
    });
  });

  describe("AABB", () => {
    it("should have numeric values", () => {
      canvas.tiles.placeables.forEach(tile => {
        const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.tiles.geomForPlaceable(tile).full;
        expect(isFinite(geom.aabb.min.x)).to.be.true;
        expect(isFinite(geom.aabb.min.y)).to.be.true;
        expect(isFinite(geom.aabb.min.z)).to.be.true;
        expect(isFinite(geom.aabb.max.x)).to.be.true;
        expect(isFinite(geom.aabb.max.y)).to.be.true;
        expect(isFinite(geom.aabb.max.z)).to.be.true;
      });
    });
  });
});

describe("Regions", () => {
  let mgr;
  before(() => {
    mgr = CONFIG[GEOMETRY_LIB_ID].geometryManager;
    if ( !mgr.regions ) mgr.addManager("regions");
  });

  describe("Model Matrix", () => {
    // Region shapes have the model matrix
    it("should have numeric values", () => {
      canvas.regions.placeables.forEach(region => {
        const geom = mgr.regions.geomForPlaceable(region);
        for ( const shape of geom.shapes ) {
          expect(shape.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
        }
      });
    });
  });

  describe("AABB", () => {
    it("should have numeric values", () => {
      canvas.regions.placeables.forEach(region => {
        const geom = mgr.regions.geomForPlaceable(region);
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
    if ( !mgr.levels ) mgr.addManager("levels");
  });

  describe("Model Matrix", () => {
    // Region shapes have the model matrix
    it("should have numeric values", () => {
      canvas.scene.levels.forEach(levelD => {
        const geom = mgr.levels.background.geomForDocument(levelD).full;
        for ( const shape of geom.shapes ) {
          expect(shape.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
        }
      });
    });
  });

  describe("AABB", () => {
    it("should have numeric values", () => {
      canvas.scene.levels.forEach(levelD => {
        const geom = mgr.levels.background.geomForDocument(levelD);
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


