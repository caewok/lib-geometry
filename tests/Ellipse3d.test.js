/* globals
CONFIG,
*/
"use strict";

import { MODULE_ID } from "../../const.js";

export function registerTests(quench) {

  quench.registerBatch(
    `${MODULE_ID}.libGeometry.Ellipse3d`,

  (context) => {
      const { describe, it, expect, before, beforeEach } = context;

      let Ellipse3d;
      let Point3d;
      let Matrix;

      before(() => {
        Ellipse3d = CONFIG.GeometryLib.lib.threeD.Ellipse3d;
        Point3d = CONFIG.GeometryLib.lib.threeD.Point3d;
        Matrix = CONFIG.GeometryLib.lib.Matrix;
      });

describe("Ellipse3d#transform", () => {
  let baseEllipse;

    beforeEach(() => {
      // Create a standard ellipse at origin: radiusX = 10, radiusY = 5, facing up (z-normal)
      baseEllipse = new Ellipse3d();
      baseEllipse._setDimensions({ center: new Point3d(0, 0, 0), radiusX: 10, radiusY: 5, angle: 0 });
    });

    it("should translate the ellipse correctly", () => {
      const M = Matrix.translation({ x: 10, y: -20, z: 30 }, { d3: true });
      const transformed = baseEllipse.transform(M);

      expect(transformed.center.x).to.be.closeTo(10, 1e-6);
      expect(transformed.center.y).to.be.closeTo(-20, 1e-6);
      expect(transformed.center.z).to.be.closeTo(30, 1e-6);

      expect(transformed.radiusX).to.be.closeTo(10, 1e-6);
      expect(transformed.radiusY).to.be.closeTo(5, 1e-6);
      expect(transformed.angle).to.be.closeTo(0, 1e-6);
    });

    it("should scale the ellipse uniformly", () => {
      const M = Matrix.scale({ x: 2, y: 2, z: 2 }, { d3: true });
      const transformed = baseEllipse.transform(M);

      expect(transformed.center.x).to.be.closeTo(0, 1e-6);
      expect(transformed.radiusX).to.be.closeTo(20, 1e-6);
      expect(transformed.radiusY).to.be.closeTo(10, 1e-6);
      expect(transformed.angle).to.be.closeTo(0, 1e-6);
    });

    it("should scale the ellipse non-uniformly", () => {
      const M = Matrix.scale({ x: 1, y: 3, z: 1 }, { d3: true });
      const transformed = baseEllipse.transform(M);

      // A 10x5 ellipse scaled by y*3 becomes 10x15.
      // The transform method swaps to ensure radiusX is the major axis.
      expect(transformed.radiusX).to.be.closeTo(15, 1e-6);
      expect(transformed.radiusY).to.be.closeTo(10, 1e-6);

      // Because the major axis is now along the Y-axis, the angle should shift by PI/2
      expect(Math.abs(transformed.angle)).to.be.closeTo(Math.PI / 2, 1e-6);
    });

    it("should rotate the ellipse around the Z axis", () => {
      const M = Matrix.rotationZ(Math.PI / 4); // 45 degrees
      const transformed = baseEllipse.transform(M);

      expect(transformed.center.x).to.be.closeTo(0, 1e-6);
      expect(transformed.center.y).to.be.closeTo(0, 1e-6);

      expect(transformed.radiusX).to.be.closeTo(10, 1e-6);
      expect(transformed.radiusY).to.be.closeTo(5, 1e-6);
      expect(transformed.angle).to.be.closeTo(Math.PI / 4, 1e-6);
    });

    it("should rotate the ellipse around the X axis (changing the plane normal)", () => {
      const M = Matrix.rotationX(Math.PI / 2); // 90 degrees
      const transformed = baseEllipse.transform(M);

      // The normal should now be pointing along the Y axis instead of Z
      expect(transformed.plane.normal.x).to.be.closeTo(0, 1e-6);
      expect(Math.abs(transformed.plane.normal.y)).to.be.closeTo(1, 1e-6);
      expect(transformed.plane.normal.z).to.be.closeTo(0, 1e-6);
    });

    it("should mutate the provided `out` object if supplied", () => {
      const outTarget = new Ellipse3d();
      const M = Matrix.translation({ x: 5, y: 5, z: 5 }, { d3: true });

      const result = baseEllipse.transform(M, outTarget);

      expect(result).to.equal(outTarget);
      expect(outTarget.center.x).to.be.closeTo(5, 1e-6);
    });

    it("should convert an ellipse into a Circle3d if scaled to have equal radii", () => {
      // Requires fixing the `out.majorAxis === out.minorAxis` bug in your source code first.
      const M = Matrix.scale({ x: 1, y: 2, z: 1 }, { d3: true });
      const transformed = baseEllipse.transform(M);

      // baseEllipse was 10x5. Scaling Y by 2 makes it 10x10.
      expect(transformed.radiusX).to.be.closeTo(10, 1e-6);
      expect(transformed.radiusY).to.be.closeTo(10, 1e-6);

      // Ensure it successfully cast/cloned to the Circle3d subclass
      expect(transformed.constructor.name).to.equal("Circle3d");
    });
  });
}, { displayName: "Ellipse3d Tests" });

}
