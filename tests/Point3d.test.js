/* globals
PIXI,
*/
"use strict";

import { Point3d } from "../3d/Point3d.js";
import { MODULE_ID } from "../../const.js";

export function registerTests(quench) {

  quench.registerBatch(
    `${MODULE_ID}.libGeometry.Point3d`,

  (context) => {
      const { describe, it, expect } = context;

  describe("Point3d", () => {

    describe("Construction & Pooling", () => {
      it("should initialize with x, y, and z coordinates", () => {
        const p = new Point3d(10, 20, 30);
        expect(p.x).to.equal(10);
        expect(p.y).to.equal(20);
        expect(p.z).to.equal(30);
      });

      it("Point3d.tmp should provide distinct objects from its own pool", () => {
        const p1 = Point3d.tmp;
        const p2 = Point3d.tmp;
        expect(p1).to.not.equal(p2);
        expect(p1).to.be.an.instanceof(Point3d);
        p1.release();
        p2.release();
      });

      it("should iterate through x, y, and z", () => {
        const p = new Point3d(1, 2, 3);
        const results = [...p];
        expect(results).to.deep.equal([1, 2, 3]);
      });
    });

    describe("3D Vector Math", () => {
      it("magnitude() should calculate the 3D Euclidean distance", () => {
        // Standard 3-4-5 triangle + z dimension
        // sqrt(3^2 + 4^2 + 12^2) = sqrt(9 + 16 + 144) = sqrt(169) = 13
        const p = new Point3d(3, 4, 12);
        expect(p.magnitude()).to.equal(13);
      });

      it("dot() should include the z component", () => {
        const a = new Point3d(1, 2, 3);
        const b = new Point3d(4, 5, 6);
        // (1*4) + (2*5) + (3*6) = 4 + 10 + 18 = 32
        expect(a.dot(b)).to.equal(32);
      });

      it("cross() should calculate the correct vector product", () => {
        const a = new Point3d(1, 0, 0);
        const b = new Point3d(0, 1, 0);
        const res = a.cross(b);

        // i x j = k
        expect(res.x).to.equal(0);
        expect(res.y).to.equal(0);
        expect(res.z).to.equal(1);
        res.release();
      });
    });

    describe("Arithmetic Overrides", () => {
      it("add() should sum all three components", () => {
        const a = new Point3d(1, 1, 1);
        const b = new Point3d(2, 3, 4);
        const res = a.add(b);
        expect(res.z).to.equal(5);
        res.release();
      });

      it("subtract() should handle missing z on PIXI.Point inputs", () => {
        const a = new Point3d(0, 0, 10);
        const b = new PIXI.Point(0, 0); // z is undefined
        const res = a.subtract(b);
        expect(res.z).to.equal(10); // 10 - 0
        res.release();
      });
    });

    describe("Coordinate Conversion & Hashing", () => {
      it("to2d() should handle homogenous coordinates", () => {
        const p = new Point3d(10, 20, 2);
        const res = p.to2d({ homogenous: true });

        // 10/2, 20/2
        expect(res.x).to.equal(5);
        expect(res.y).to.equal(10);
        res.release();
      });

      it("key should return a BigInt incorporating z", () => {
        const p = new Point3d(1, 2, 3);
        expect(typeof p.key).to.equal('bigint');

        const pSame = new Point3d(1, 2, 3);
        const pDiff = new Point3d(1, 2, 4);
        expect(p.key).to.equal(pSame.key);
        expect(p.key).to.not.equal(pDiff.key);
      });

      it("invertKey should reconstruct a point from a key", () => {
        const pOrig = new Point3d(1, 2, 3);
        const p = Point3d.invertKey(pOrig.key);

        expect(p.x).to.equal(pOrig.x);
        expect(p.y).to.equal(pOrig.y);
        expect(p.z).to.equal(pOrig.z);
        p.release();
      });

    });

    describe("Static Factory Methods", () => {
      it("midPoint() should find the center including z", () => {
        const a = new Point3d(0, 0, 0);
        const b = new Point3d(10, 20, 30);
        const mid = Point3d.midPoint(a, b);

        expect(mid.x).to.equal(5);
        expect(mid.y).to.equal(10);
        expect(mid.z).to.equal(15);
        mid.release();
      });
    });

    describe("Foundry Integration", () => {
      // Note: These require a mocked or active Token object
      it("fromTokenCenter() should average bottomZ and topZ", () => {
        const mockToken = {
          center: { x: 100, y: 100 },
          bottomZ: 0,
          topZ: 20
        };
        const p = Point3d.fromTokenCenter(mockToken);
        expect(p.z).to.equal(10);
        p.release();
      });
    });
  });
  }, { displayName: "Point3d" });
}