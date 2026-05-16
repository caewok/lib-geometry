/* globals
PIXI,
*/

import { SDF } from "../sdf/SDF.js";
import { MODULE_ID } from "../../const.js";
import { Point3d } from "../3d/Point3d.js";
import { Polygon3d, Triangle3d } from "../3d/Polygon3d.js";

const EPSILON = 1e-6;

/**
 * Unit tests for the SDF (Signed Distance Function) class.
 * Run these using the Quench module in FoundryVTT.
 */
export function registerTests(quench) {

  quench.registerBatch(
    `${MODULE_ID}.libGeometry.SDF`,

  (context) => {
      const { describe, it, expect } = context;

	// Helper to check distance with a small epsilon for floating point errors
	const expectClose = (val, target) => expect(val).to.be.closeTo(target, EPSILON);

  // --- NOTE: Boolean Operators ---
  describe("GeometryLib | SDF Operators", function() {
    describe("union", function() {
      it("opUnion should return the minimum distance", function() {
        const d1 = 10 ;
        const d2 = 5;
        expect(SDF.union(d1, d2)).to.equal(5);
      });
    });

		describe("intersection", function() {
			it("intersection should return the maximum distance", function() {
				expect(SDF.intersection(10, 20)).to.equal(20);
			});
		});

		describe("xor", function() {
		  it("xor should follow the parity logic", function() {
				// Points inside both should be "outside" the result
				expect(SDF.xor(-10, -5)).to.equal(5);
			});
		});

		describe("subtraction", function() {
      it("Subtraction should return the maximum of d1 and -d2", function() {
        const d1 = 10; // Object 1
        const d2 = -5; // Object 2 (point is inside)
        // Subtracting d2 from d1 means the point is "inside" the hole
        expect(SDF.subtraction(d1, d2)).to.equal(10);
      });

      it("Subtraction should correctly subtract the second shape from the first", function() {
        // formula: Math.max(d1, -d2)
        expect(SDF.subtraction(10, -20)).to.equal(20);
        expect(SDF.subtraction(5, 12)).to.equal(5);
      });
    });

    // --- NOTE: Operators --- //
    describe("revolve", function() {
      it("should correctly revolve a 2D primitive into 3D space", function() {
        const primitive = (q) => SDF.sdCircle(q, 20);
        const p = new Point3d(30, 40, 0); // hypot(30, 40) gives a 2D radius of 50
        // Point evaluated on 2D primitive is (50, 0).
        // Distance from (50, 0) to a circle of radius 20 is 30. 30^2 = 900.
        expectClose(SDF.opRevolution(p, primitive, 0), 900);
      });
    });

    describe("opExtrusion", function() {
      it("should create a 3d volume from a 2d primitive", function() {
        const circle2d = p => SDF.sdCircle(p, 50);
        const h = 20; // Total height 20 (from -20 to 20 or 0 to 20 depending on implementation)

        // Point inside the 2d circle and inside the vertical height
        const pInside = new Point3d(0, 0, 5);
        expect(SDF.opExtrusion(pInside, circle2d, h)).to.be.below(0);

        // Point above the extrusion height
        const pAbove = new Point3d(0, 0, 30);
        expectClose(SDF.opExtrusion(pAbove, circle2d, h), 10 ** 2);
      });
    });

    describe("opOnion", function() {
      it("should create a shell/ring effect", function() {
        const circle = p => SDF.sdCircle(p, 50);
        const thickness = 5;
        // Point at distance 50 was 0, now it should be -5
        expectClose(SDF.opOnion(new PIXI.Point(50, 0), circle, thickness), -(5 ** 2));
        // Point at distance 55 was 5, now it should be 0
        expectClose(SDF.opOnion(new PIXI.Point(55, 0), circle, thickness), 0);
      });
    });

    // ----- NOTE: Smooth operators ----- //
    describe("Smooth Operators", function() {
      it("smoothUnion should smoothly blend intersecting distances downward", function() {
        const d1 = 10;
        const d2 = 8;
        const k = 4;
        expect(SDF.smoothUnion(d1, d2, k)).to.be.lessThan(8);
      });

      it("smoothIntersection should smoothly blend intersecting distances upward", function() {
        const d1 = 10;
        const d2 = 12;
        const k = 4;
        expect(SDF.smoothIntersection(d1, d2, k)).to.be.greaterThan(12);
      });

      it("smoothSubtraction should smoothly subtract shapes", function() {
        const d1 = 5;
        const d2 = -5;
        const k = 4;
        expect(SDF.smoothSubtraction(d1, d2, k)).to.be.a("number");
      });
    });
  });

  // --- NOTE: Conversions ---
  describe("GeometryLib | SDF Conversions", function() {
    describe("fromSquaredDistance", function() {
      it("should convert a positive squared distance to linear distance", function() {
        expect(SDF.fromSquaredDistance(25)).to.equal(5);
      });

      it("should preserve the negative sign for internal distances", function() {
        expect(SDF.fromSquaredDistance(-25)).to.equal(-5);
      });

      it("should return 0 for zero distance", function() {
        expect(SDF.fromSquaredDistance(0)).to.equal(0);
      });
    });

    describe("toSquaredDistance", function() {
      it("should convert a linear distance to signed squared distance", function() {
        expect(SDF.toSquaredDistance(5)).to.equal(25);
      });

      it("should preserve the negative sign when converting to squared distance", function() {
        expect(SDF.toSquaredDistance(-5)).to.equal(-25);
      });

      it("should return 0 for zero distance", function() {
        expect(SDF.toSquaredDistance(0)).to.equal(0);
      });
    });
  });

  // --- NOTE: 2D Primitives ---
  describe("GeometryLib | SDF 2d Primitives", function() {

   describe("sdSegment", function() {
      const a = new PIXI.Point(0, 0);
      const b = new PIXI.Point(100, 0);

      it("should return 0 for a point on the segment", function() {
        expectClose(SDF.sdSegment(new PIXI.Point(50, 0), a, b), 0);
      });

      it("should return the distance to the nearest endpoint when beyond the segment", function() {
        expectClose(SDF.sdSegment(new PIXI.Point(-10, 0), a, b), 10 ** 2);
        expectClose(SDF.sdSegment(new PIXI.Point(110, 0), a, b), 10 ** 2);
      });
    });

    describe("sdCircle", function() {
      it("should return negative distance inside and positive outside", function() {
        const r = 50;
        const pInside = new PIXI.Point(0, 0);
        const pOutside = new PIXI.Point(0, 60);
        expect(SDF.sdCircle(pInside, r)).to.equal(-(50 ** 2));
        expect(SDF.sdCircle(pOutside, r)).to.equal(10 ** 2);
      });
    });

    describe("sdRectangle (2D Box)", function() {
      const b = new PIXI.Point(50, 25); // Half-extents

      it("should return negative distance for the center", function() {
        expect(SDF.sdRectangle(new PIXI.Point(0, 0), b)).to.equal(-(25 ** 2));
      });

      it("should return distance to the nearest edge", function() {
        expectClose(SDF.sdRectangle(new PIXI.Point(60, 0), b), 10 ** 2);
      });
    });

    describe("sdOrientedRectangle", function() {
      it("should calculate distance for a rotated rectangle axis", function() {
        const a = new PIXI.Point(0, 0);
        const b = new PIXI.Point(100, 100); // Diagonal axis
        const th = 20; // Thickness
        // Point on the axis
        expectClose(SDF.sdOrientedRectangle(new PIXI.Point(50, 50), a, b, th), -((th * 0.5) ** 2));
      });
    });

    describe("sdPIXIPolygon", function() {
      // Define a 100x100 square centered at the origin
      const square = new PIXI.Polygon(
        -50, -50,
        50, -50,
        50, 50,
        -50, 50,
      );

      it("should return a negative distance for points inside the polygon", function() {
        const p = new PIXI.Point(0, 0);
        const d = SDF.sdPIXIPolygon(p, square);
        expect(d).to.be.below(0);
        expectClose(d, -(50 ** 2));

        const dPoints = SDF.sdPolygon(p, [...square.iteratePoints()]);
        expectClose(d, dPoints);
      });

      it("should return a positive distance for points outside the polygon", function() {
        const p = new PIXI.Point(100, 0);
        const d = SDF.sdPIXIPolygon(p, square);
        expect(d).to.be.above(0);
        expectClose(d, 50 ** 2);

        const dPoints = SDF.sdPolygon(p, [...square.iteratePoints()]);
        expectClose(d, dPoints);
      });

      it("should correctly calculate distance to the nearest edge (not just vertex)", function() {
        // Point is closer to the edge (50, 25) than any vertex
        const p = new PIXI.Point(60, 25);
        const d = SDF.sdPIXIPolygon(p, square);
        expectClose(d, 10 ** 2);

        const dPoints = SDF.sdPolygon(p, [...square.iteratePoints()]);
        expectClose(d, dPoints);
      });
    });

    describe("sdHexagon", function() {
      it("should return 0 for a point on the edge", function() {
        const r = 10;
        // Top edge of a flat-topped hexagon is at r * sin(60)
        const d = SDF.sdHexagon(new PIXI.Point(0, r), r);
        expectClose(d, 0);
      });

      it("should return negative for the origin", function() {
        const d = SDF.sdHexagon(new PIXI.Point(0, 0), 10);
        expect(d).to.be.below(0);
      });
    });

    describe("sdPIXIPolygonsWithHoles", function() {
      it("should handle polygon object with hole", function() {
        const main = new PIXI.Polygon(
          0, 0,
          100, 0,
          0, 100,
        );
        const hole = new PIXI.Polygon(
          10, 20, // Reversed orientation.
          20, 10,
          10, 10,
        );

        const polys = [main, hole];
        const pInsideHole = new PIXI.Point(12.5, 12.5);
        let d = SDF.sdPIXIPolygonsWithHoles(pInsideHole, polys);
        expect(d).to.be.greaterThan(0);

        const pInside = new PIXI.Point(20, 20);
        d = SDF.sdPIXIPolygonsWithHoles(pInside, polys);
        expect(d).to.be.lessThan(0);

        const pOutside = new PIXI.Point(-100, -100);
        d = SDF.sdPIXIPolygonsWithHoles(pOutside, polys);
        expect(d).to.be.greaterThan(0);
      });
    });

    describe("sdCircle (Interior)", function() {
			it("should return a negative squared distance for a point inside the circle", function() {
				const p = new PIXI.Point(25, 0);
				const r = 50;
				// Point is 25 units inside the radius of 50. Signed squared distance = -(25^2) = -625
				expectClose(SDF.sdCircle(p, r), -625);
			});
		});

		describe("sdRectangle (Interior)", function() {
			it("should return a negative squared distance for a point inside the rectangle", function() {
				const p = new PIXI.Point(4, 0);
				const b = new PIXI.Point(10, 10);
				// Closest edge is at x = 10 (distance of 6 units inside). Signed squared distance = -(6^2) = -36
				expectClose(SDF.sdRectangle(p, b), -36);
			});
		});

		describe("sdOrientedRectangle", function() {
			it("should return correct squared distance for points outside", function() {
				const p = new PIXI.Point(0, 20);
				const a = new PIXI.Point(-10, 0);
				const b = new PIXI.Point(10, 0);
				const th = 10; // Thickness
				// Point is 15 units above the upper edge of the segment. 15^2 = 225
				expectClose(SDF.sdOrientedRectangle(p, a, b, th), 225);
			});

			it("should return negative squared distance for points inside", function() {
				const p = new PIXI.Point(0, 2);
				const a = new PIXI.Point(-10, 0);
				const b = new PIXI.Point(10, 0);
				const th = 10; // Thickness
				// Point is 3 units inside the thickness envelope. Signed squared distance = -9
				expectClose(SDF.sdOrientedRectangle(p, a, b, th), -9);
			});
		});

		describe("sdSegment (Cap Boundary Edge Case)", function() {
			it("should accurately calculate distance when a point projects past the endpoints", function() {
				const a = new PIXI.Point(-10, 0);
				const b = new PIXI.Point(10, 0);
				const p = new PIXI.Point(13, 4);
				// Closest segment feature is endpoint B(10, 0). dx = 3, dy = 4. Distance squared = 9 + 16 = 25
				expectClose(SDF.sdSegment(p, a, b), 25);
			});
		});

  });

  // --- 3D Primitives ---
  describe("GeometryLib | SDF 3d", function() {

    describe("sdSphere", function() {
      it("should calculate distance to a 3D sphere", function() {
        const p = new Point3d(100, 0, 0);
        expectClose(SDF.sdSphere(p, 50), 50 ** 2);
      });
    });

    describe("sdPlane", function() {
      it("should calculate distance to a plane", function() {
        const plane = {
          point: new Point3d(0, 0, 10),
          normal: new Point3d(0, 0, 1)
        };
        const p = new Point3d(0, 0, 15);
        expectClose(SDF.sdPlane(p, plane), 5 ** 2);
      });
    });

    describe("sdPolygon3d", function() {
      const square3d = Polygon3d.from3dPoints([
        new Point3d(-50, -50, 0),
        new Point3d(50, -50, 0),
        new Point3d(50, 50, 0),
        new Point3d(-50, 50, 0),
      ]);

      it("should return 0 for point on the polygon", function() {
        const p = new Point3d(0, 0, 0);
        const d = SDF.sdPolygon3d(p, square3d);
        expectClose(d, 0);
      });

      it("should handle points offset in the Z-axis", function() {
        let p = new Point3d(60, 0, 10); // 10 units away from edge on X, 10 units up on Z
        let d = SDF.sdPolygon3d(p, square3d);
        // Distance should be hypotenuse of 10 and 10
        expectClose(d, 100 + 100);

        p = new Point3d(60, 0, -10);
        d = SDF.sdPolygon3d(p, square3d);
        expectClose(d, 100 + 100);

      });
    });

    describe("sdTriangle3d", function() {
      const a = new Point3d(0, 0, 0);
      const b = new Point3d(10, 0, 0);
      const c = new Point3d(0, 10, 0);
      const tri = Triangle3d.from3Points(a, b, c);

      it("should return correct distance for point directly above the triangle", function() {
        const p = new Point3d(2, 2, 5);
        const d = SDF.sdTriangle3d(p, tri);
        expectClose(d, 5 ** 2);
      });

      it("should not mutate the input vertex points during calculation", function() {
        const p = new Point3d(5, 5, 5);
        const aCopy = { x: a.x, y: a.y, z: a.z };
        SDF.sdTriangle3d(p, tri);
        expect(a.x).to.equal(aCopy.x);
        expect(a.y).to.equal(aCopy.y);
      });
    });

    describe("sdSphere (Interior)", function() {
			it("should return a negative squared distance for a point inside the sphere", function() {
				const p = new Point3d(0, 0, 3);
				const r = 5;
				// 2 units inside the shell. Signed squared distance = -(2^2) = -4
				expectClose(SDF.sdSphere(p, r), -4);
			});
		});

		describe("sdRectangle3d (Interior)", function() {
			it("should return a negative squared distance for a point inside the box", function() {
				const p = new Point3d(0, 8, 0);
				const b = new Point3d(10, 10, 10);
				// Closest face is y = 10 (2 units inside). Signed squared distance = -(2^2) = -4
				expectClose(SDF.sdRectangle3d(p, b), -4);
			});

			it("should correctly calculate distance for a 3d cube (box)", function() {
        const b = new PIXI.Point(20, 10, 5); // Half-extents
        const p = new PIXI.Point(25, 0, 10);  // 5 units outside on X
        expectClose(SDF.sdRectangle3d(p, b), 5 ** 2);
      });
		});

		describe("sdTriangle3d (External Voronoi Region Edge Case)", function() {
			it("should correctly handle points projecting outside the corner vertices", function() {
				const a = new Point3d(0, 0, 0);
				const b = new Point3d(10, 0, 0);
				const c = new Point3d(0, 10, 0);
				const p = new Point3d(-3, -4, 0);
				// Closest feature is vertex A(0,0,0). Distance squared = (-3)^2 + (-4)^2 = 25
				expectClose(SDF.sdTriangle3d(p, { a, b, c }), 25);
			});
		});

  });

  // ----- NOTE: Ray march -----

  describe("SDF.raymarch", function() {
		const radius = 20;
		// Primitive function for a circle centered at (50, 0)
		const circleAt50 = (p) => {
			const shifted = new PIXI.Point(p.x - 50, p.y);
			return SDF.sdCircle(shifted, radius);
		};

		it("should hit a 2D circle directly in front of the ray", function() {
			const origin = new PIXI.Point(0, 0);
			const direction = new PIXI.Point(1, 0); // Pointing right
			const dist = SDF.raymarch(origin, direction, circleAt50);

			// Center is at 50, radius is 20. Edge is at 50 - 20 = 30.
			expectClose(dist, 30);
		});

		it("should return 0 (or very close) if starting on the surface", function() {
			const origin = new PIXI.Point(30, 0);
			const direction = new PIXI.Point(1, 0);
			const dist = SDF.raymarch(origin, direction, circleAt50);

			expectClose(dist, 0);
		});

		it("should handle starting inside the shape", function() {
			const origin = new PIXI.Point(50, 0); // Exactly at center
			const direction = new PIXI.Point(1, 0);
			const dist = SDF.raymarch(origin, direction, circleAt50);

			// Should return nearest distance to an edge from the inside.
			expectClose(dist, radius);
		});

		it("should return null when the ray misses the shape", function() {
			const origin = new PIXI.Point(0, 50); // Ray is shifted up
			const direction = new PIXI.Point(1, 0); // Firing right, will miss circle at (50, 0)
			const maxDist = 100;
			const dist = SDF.raymarch(origin, direction, circleAt50, { maxDist });

			expect(dist).to.equal(null);
		});
	});

	// ----- NOTE: Raymarch 3d -----

	describe("SDF.raymarch (3D)", function() {
		const size = new Point3d(10, 10, 10); // Half-extents for a 20x20x20 cube
		// Box centered at (0, 0, 100)
		const boxAt100z = (p) => {
			const shifted = new Point3d(p.x, p.y, p.z - 100);
			return SDF.sdCube(shifted, size);
		};

		it("should hit the front face of a 3D cube", function() {
			const origin = new Point3d(0, 0, 0);
			const direction = new Point3d(0, 0, 1); // Pointing +Z
			const dist = SDF.raymarch(origin, direction, boxAt100z);

			// Center at 100, half-extent 10. Front face is at 100 - 10 = 90.
			expectClose(dist, 90);
		});

		it("should hit a 3D cube at an angle (diagonal)", function() {
			const origin = new Point3d(-50, 0, 50);
			// Normalize a direction pointing towards the corner
			const direction = new Point3d(1, 0, 1).normalize();
			const dist = SDF.raymarch(origin, direction, boxAt100z);

			// If moving diagonally from -50 to -10 (x) and 50 to 90 (z)
			// The distance traveled should be roughly 40 * sqrt(2)
			expectClose(dist, 40 * Math.sqrt(2));
		});

		it("should return null for a ray parallel to the box", function() {
			const origin = new Point3d(50, 0, 0);
			const direction = new Point3d(0, 0, 1); // Firing parallel to Z, offset by 50 units
			const maxDist = 500;
			const dist = SDF.raymarch(origin, direction, boxAt100z, { maxDist });

			expect(dist).to.equal(null);
		});

		it("should respect the maxSteps limit", function() {
			const origin = new Point3d(0, 0, 0);
			const direction = new Point3d(0, 0, 1);
			// With maxSteps = 1, it should never reach the box at 90 units
			const dist = SDF.raymarch(origin, direction, boxAt100z, { maxSteps: 1, maxDist: 1000 });

			expect(dist).to.equal(null);
		});
	});

	describe("SDF.raymarch with Complex Primitives", function() {
		it("should hit the intersection of two shapes", function() {
			// Intersection of two spheres
			// Both spheres are radius 15.
			// One sphere centered at -10,0; other at 10, 0.
			const scene = (p) => {
				const d1 = SDF.sdSphere(new Point3d(p.x - 10, p.y, p.z), 15);
				const d2 = SDF.sdSphere(new Point3d(p.x + 10, p.y, p.z), 15);
				return SDF.intersection(d1, d2);
			};

			const origin = new Point3d(0, 0, -50);
			const direction = new Point3d(0, 0, 1);
			const dist = SDF.raymarch(origin, direction, scene, { surfaceEpsilon: EPSILON });

			// The spheres overlap between x = -5 and x = 5.
			// At x=0, the sphere surface distance from center (10,0,0) with radius 15:
			// 0^2 + y^2 + z^2 = 15^2 offset by 10 in X.
			// sqrt(10^2 + z^2) = 15 => 100 + z^2 = 225 => z^2 = 125 => z = 11.18
			// Distance from origin (0,0,-50) to z = -11.18 is 38.82
			expectClose(dist, 50 - Math.sqrt(15*15 - 10*10));
		});
	});

},
{ displayName: "libGeometry: Signed Distance Functions (SDF)" },
);

}