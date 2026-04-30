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
	
  // --- Boolean Operators ---
  describe("GeometryLib | SDF Operators", function() {
    describe("union", function() {
      it("opUnion should return the minimum distance", function() {
        const d1 = 10;
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
    });

    // --- Operators ---

    describe("opExtrusion", function() {
      it("should create a 3d volume from a 2d primitive", function() {
        const circle2d = p => SDF.sdCircle(p, 50);
        const h = 20; // Total height 20 (from -20 to 20 or 0 to 20 depending on implementation)
        
        // Point inside the 2d circle and inside the vertical height
        const pInside = new Point3d(0, 0, 5);
        expect(SDF.opExtrusion(pInside, circle2d, h)).to.be.below(0);
        
        // Point above the extrusion height
        const pAbove = new Point3d(0, 0, 30);
        expectClose(SDF.opExtrusion(pAbove, circle2d, h), 10);
      });
    });

    describe("opOnion", function() {
      it("should create a shell/ring effect", function() {
        const circle = p => SDF.sdCircle(p, 50);
        const thickness = 5;
        // Point at distance 50 was 0, now it should be -5
        expectClose(SDF.opOnion(new PIXI.Point(50, 0), circle, thickness), -5);
        // Point at distance 55 was 5, now it should be 0
        expectClose(SDF.opOnion(new PIXI.Point(55, 0), circle, thickness), 0);
      });
    });
  });
  
  // --- 2D Primitives ---  
  describe("GeometryLib | SDF 2d Primitives", function() {
    
   describe("sdSegment", function() {
      const a = new PIXI.Point(0, 0);
      const b = new PIXI.Point(100, 0);

      it("should return 0 for a point on the segment", function() {
        expectClose(SDF.sdSegment(new PIXI.Point(50, 0), a, b), 0);
      });

      it("should return the distance to the nearest endpoint when beyond the segment", function() {
        expectClose(SDF.sdSegment(new PIXI.Point(-10, 0), a, b), 10);
        expectClose(SDF.sdSegment(new PIXI.Point(110, 0), a, b), 10);
      });
    });

    describe("sdCircle", function() {
      it("should return negative distance inside and positive outside", function() {
        const r = 50;
        const pInside = new PIXI.Point(0, 0);
        const pOutside = new PIXI.Point(0, 60);
        expect(SDF.sdCircle(pInside, r)).to.equal(-50);
        expect(SDF.sdCircle(pOutside, r)).to.equal(10);
      });
    });

    describe("sdRectangle (2D Box)", function() {
      const b = new PIXI.Point(50, 25); // Half-extents

      it("should return negative distance for the center", function() {
        expect(SDF.sdRectangle(new PIXI.Point(0, 0), b)).to.equal(-25);
      });

      it("should return distance to the nearest edge", function() {
        expectClose(SDF.sdRectangle(new PIXI.Point(60, 0), b), 10);
      });
    });

    describe("sdOrientedRectangle", function() {
      it("should calculate distance for a rotated rectangle axis", function() {
        const a = new PIXI.Point(0, 0);
        const b = new PIXI.Point(100, 100); // Diagonal axis
        const th = 20; // Width of 20
        // Point on the axis
        expectClose(SDF.sdOrientedRectangle(new PIXI.Point(50, 50), a, b, th), -10);
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
        expectClose(d, -50);
        
        const dPoints = SDF.sdPolygon(p, [...square.iteratePoints()]);
        expectClose(d, dPoints);
      });

      it("should return a positive distance for points outside the polygon", function() {
        const p = new PIXI.Point(100, 0);
        const d = SDF.sdPIXIPolygon(p, square);
        expect(d).to.be.above(0);
        expectClose(d, 50);
        
        const dPoints = SDF.sdPolygon(p, [...square.iteratePoints()]);
        expectClose(d, dPoints);
      });

      it("should correctly calculate distance to the nearest edge (not just vertex)", function() {
        // Point is closer to the edge (50, 25) than any vertex
        const p = new PIXI.Point(60, 25);
        const d = SDF.sdPIXIPolygon(p, square);
        expectClose(d, 10);
        
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
  });
 
    // --- 2D Corners ---
    describe("GeometryLib | SDF 2d Corners", function() {
    
			describe("dCornerSquaredBox", function() {
				it("should identify the nearest corner of a rectangle", function() {
					const b = new PIXI.Point(50, 50);
					const p = new PIXI.Point(60, 60); // Closer to corner (50, 50)
					const expectedDistSq = (10**2) + (10**2);
					expectClose(SDF.dCornerSquaredBox(p, b), expectedDistSq);
				});
			});
			
    });
    
    // --- 3D Primitives ---
    describe("GeometryLib | SDF 3d", function() {
    
			describe("sdSphere", function() {
				it("should calculate distance to a 3D sphere", function() {
					const p = new Point3d(100, 0, 0);
					expectClose(SDF.sdSphere(p, 50), 50);
				});
			});
	
			describe("sdPlane", function() {
				it("should calculate distance to a plane", function() {
					const plane = {
						point: new Point3d(0, 0, 10),
						normal: new Point3d(0, 0, 1)
					};
					const p = new Point3d(0, 0, 15);
					expectClose(SDF.sdPlane(p, plane), 5);
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
					expectClose(d, Math.sqrt(100 + 100));
					
					p = new Point3d(60, 0, -10);
					d = SDF.sdPolygon3d(p, square3d);
					expectClose(d, Math.sqrt(100 + 100));
					
				});
			});
	
			describe("sdCube", function() {
				it("should correctly calculate distance for a 3d cube (box)", function() {
					const b = new PIXI.Point(20, 10, 5); // Half-extents
					const p = new PIXI.Point(25, 0, 10);  // 5 units outside on X
					expectClose(SDF.sdCube(p, b), 5);
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
					expectClose(d, 5);
				});
	
				it("should not mutate the input vertex points during calculation", function() {
					const p = new Point3d(5, 5, 5);
					const aCopy = { x: a.x, y: a.y, z: a.z };
					SDF.sdTriangle3d(p, tri);
					expect(a.x).to.equal(aCopy.x);
					expect(a.y).to.equal(aCopy.y);
				});
			});
		});
},
{ displayName: "libGeometry: Signed Distance Functions (SDF)" },
);

}