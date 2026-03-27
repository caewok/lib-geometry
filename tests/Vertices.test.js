/* globals
CONFIG,
Hooks,
*/
"use strict";

import { BasicVertices } from "../placeable_vertices/BasicVertices.js";

Hooks.on("quenchReady", (quench) => {
  quench.registerBatch(
    "libGeometry.Vertices",

  (context) => {
      const { describe, it, assert } = context;

// ----- NOTE: AABB2d.overlapsAABB -----
describe("BasicVertices Core Logic", () => {
  it("Array.prototype.set should overwrite instead of insert", () => {
    const target = [1, 2, 3, 4];
    target.set([8, 8], 1);
    assert.deepEqual(target, [1, 8, 8, 4], "Array.set did not overwrite correctly.");
  });

  it("zipInsert should correctly interleave two TypedArrays", () => {
    // 3 vertices: Position data (stride 3)
    const positions = new Float32Array([
      10, 20, 30, // Vertex 0
      40, 50, 60, // Vertex 1
      70, 80, 90  // Vertex 2
    ]);

    // 3 vertices: UV data (stride 2)
    const uvs = new Float32Array([
      0.1, 0.2,   // Vertex 0
      0.3, 0.4,   // Vertex 1
      0.5, 0.6    // Vertex 2
    ]);

    // We expect a stride of 5 (3 pos + 2 uv)
    // zipInsert(mainArray, insertArray, { stride, insertStride })
    const combined = BasicVertices.zipInsert(positions, uvs, { stride: 3, insertStride: 2 });

    const expected = new Float32Array([
      10, 20, 30, 0.1, 0.2,
      40, 50, 60, 0.3, 0.4,
      70, 80, 90, 0.5, 0.6
    ]);

    assert.deepEqual(Array.from(combined), Array.from(expected), "Interleaved data does not match expectation.");
  });

  it("zipExtract should correctly pull data out of an interleaved buffer", () => {
    const interleaved = new Float32Array([
      1, 2, 3, 0.1, 0.2,
      4, 5, 6, 0.3, 0.4,
      7, 8, 9, 0.5, 0.6
    ]);

    // Extract positions: First 3 components, stride 5, offset 0
    const extractedPos = BasicVertices.zipExtract(interleaved, { stride: 5, extractStride: 3, offset: 0 });
    const expectedPos = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(Array.from(extractedPos), Array.from(expectedPos), "Extracted positions are incorrect.");

    // Extract UVs: 2 components, stride 5, offset 3
    const extractedUV = BasicVertices.zipExtract(interleaved, { stride: 5, extractStride: 2, offset: 3 });
    const expectedUV = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    assert.deepEqual(Array.from(extractedUV), Array.from(expectedUV), "Extracted UVs are incorrect.");
  });

  it("zipInsert should handle standard Arrays via the polyfill", () => {
    // Tests if the Array.prototype.set polyfill is working correctly within the zip logic
    const base = [1, 2];
    const insert = [9];

    // Result should be [1, 2, 9] per vertex if stride logic is applied
    const result = BasicVertices.zipInsert(base, insert, { stride: 2, insertStride: 1 });
    assert.deepEqual(result, [1, 2, 9], "zipInsert failed on standard Arrays.");
  });

  it("zipInsert should handle 'repeated' data correctly", () => {
    // If insertArray is shorter than necessary, it should repeat or use duplicateArray logic
    const positions = new Float32Array([1, 1, 1, 2, 2, 2]); // 2 vertices
    const constantNormal = new Float32Array([0, 0, 1]);     // Only 1 normal provided

    // Logic should duplicate the normal for every vertex
    const result = BasicVertices.zipInsert(positions, constantNormal, { stride: 3, insertStride: 3 });

    const expected = new Float32Array([
      1, 1, 1, 0, 0, 1,
      2, 2, 2, 0, 0, 1
    ]);

    assert.deepEqual(Array.from(result), Array.from(expected), "zipInsert failed to repeat/duplicate short arrays.");
  });

  it("calculateNormals should return vertical normals for XY plane triangles", () => {
    const vertices = new Float32Array([0,0,0, 10,0,0, 0,10,0]); // Right triangle on floor
    const normals = BasicVertices.calculateNormals(vertices, { stride: 3 });

    // Check first vertex normal
    assert.equal(normals[0], 0);
    assert.equal(normals[1], 0);
    assert.equal(Math.abs(normals[2]), 1, "Normal Z-axis should be 1.0");
  });

  it("condenseVertexData should reduce shared vertices", () => {
    // Two triangles sharing two points (a quad)
    const vertices = new Float32Array([
      0,0,0,  1,0,0,  0,1,0, // Tri 1
      1,0,0,  1,1,0,  0,1,0  // Tri 2
    ]);
    const result = BasicVertices.condenseVertexData(vertices, { stride: 3 });

    // 4 unique points: (0,0), (1,0), (0,1), (1,1)
    assert.equal(result.numVertices, 4, "Should have condensed 6 vertices down to 4");
    assert.equal(result.indices.length, 6, "Index count should remain 6");
  });

  it("condenseVertexData should handle near 1 vertices", () => {
    // Two triangles sharing two points (a quad)
    const vertices = new Float32Array([
      0,0,0,  1.00000001,0,0,  0,1,0, // Tri 1
      0.99999999,0,0,  1,1,0,  0,1,0  // Tri 2
    ]);
    const result = BasicVertices.condenseVertexData(vertices, { stride: 3, precision: 5 });

    // 4 unique points: (0,0), (1,0), (0,1), (1,1)
    assert.equal(result.numVertices, 4, "Should have condensed 6 vertices down to 4");
    assert.equal(result.indices.length, 6, "Index count should remain 6");
  });
});

describe("BasicVertices.calculateUVs", () => {

  it("should correctly project and normalize a horizontal quad on the XY plane", () => {
    // A 10x10 quad on the XY plane (Z=5)
    // 6 vertices (2 triangles)
    const vertices = new Float32Array([
      0,  0, 5,   // V0 (Bottom-Left)
      10, 0, 5,   // V1 (Bottom-Right)
      0, 10, 5,   // V2 (Top-Left)

      10, 0, 5,   // V1
      10, 10, 5,  // V3 (Top-Right)
      0, 10, 5    // V2
    ]);

    const uvs = BasicVertices.calculateUVs(vertices, { stride: 3 });

    // 6 vertices * 2 components (u, v) = 12 elements
    assert.equal(uvs.length, 12, "UV array length should be vertices.length / stride * 2");

    // V0: should be (0, 0)
    assert.equal(uvs[0], 0);
    assert.equal(uvs[1], 0);

    // V1: should be (1, 0) because X is 10 and max X is 10
    assert.equal(uvs[2], 1);
    assert.equal(uvs[3], 0);

    // V3: should be (1, 1)
    assert.equal(uvs[8], 1);
    assert.equal(uvs[9], 1);

    // V2: should be (0, 1)
    assert.equal(uvs[10], 0);
    assert.equal(uvs[11], 1);
  });

  it("should project onto YZ axes when the quad is facing the X direction", () => {
    // A quad on the YZ plane at X=100
    const vertices = new Float32Array([
      100, 0, 0,   // Bottom-Left
      100, 50, 0,  // Bottom-Right
      100, 0, 50,  // Top-Left

      100, 50, 0,
      100, 50, 50, // Top-Right
      100, 0, 50
    ]);

    const uvs = BasicVertices.calculateUVs(vertices, { stride: 3 });

    // The logic should detect the normal is [1, 0, 0] and use Y/Z for U/V
    // Y range 0-50, Z range 0-50
    assert.equal(uvs[0], 0, "U (Y-axis) should be 0");
    assert.equal(uvs[1], 0, "V (Z-axis) should be 0");

    assert.equal(uvs[8], 1, "U (Y-axis) should be 1 at Y=50");
    assert.equal(uvs[9], 1, "V (Z-axis) should be 1 at Z=50");
  });

  it("should handle custom position offsets within a larger stride", () => {
    // Interleaved data: [PosX, PosY, PosZ, Junk1, Junk2] (Stride 5)
    const vertices = new Float32Array([
      0, 0, 0, 99, 99,
      1, 0, 0, 99, 99,
      0, 1, 0, 99, 99
    ]);

    const uvs = BasicVertices.calculateUVs(vertices, { stride: 5, positionOffset: 0 });

    // triangle is (0,0), (1,0), (0,1)
    // UVs should be (0,0), (1,0), (0,1)
    assert.equal(uvs[0], 0);
    assert.equal(uvs[1], 0);
    assert.equal(uvs[2], 1);
    assert.equal(uvs[3], 0);
    assert.equal(uvs[4], 0);
    assert.equal(uvs[5], 1);
  });

  it("should avoid division by zero for single-line or single-point 'meshes'", () => {
    // All vertices at the same spot - range will be 0
    const vertices = new Float32Array([
      5, 5, 5,
      5, 5, 5,
      5, 5, 5
    ]);

    // This should not result in NaNs
    const uvs = BasicVertices.calculateUVs(vertices, { stride: 3 });

    assert.isFalse(isNaN(uvs[0]), "UV calculation resulted in NaN on zero-range data");
    assert.isFalse(isNaN(uvs[1]), "UV calculation resulted in NaN on zero-range data");
  });

});

describe("BasicVertices.transformVertexPositions", () => {
  // Setup common dependencies from GeometryLib
  const { MatrixFloat32 } = CONFIG.GeometryLib.lib.Matrix;

  it("should apply a translation transformation correctly", () => {
    // 2 vertices, stride 3 (positions only)
    const vertices = new Float32Array([
      1, 2, 3,
      10, 20, 30
    ]);

    // Create a translation matrix: +5 on X, -5 on Y, +10 on Z
    const M = MatrixFloat32.translation(5, -5, 10);

    BasicVertices.transformVertexPositions(vertices, M, { stride: 3 });

    const expected = new Float32Array([
      6, -3, 13,  // (1+5, 2-5, 3+10)
      15, 15, 40  // (10+5, 20-5, 30+10)
    ]);

    assert.deepEqual(Array.from(vertices), Array.from(expected), "Translation was not applied correctly.");
  });

  it("should apply a scaling transformation correctly", () => {
    const vertices = new Float32Array([1, 1, 1]);
    const M = MatrixFloat32.scale(2, 3, 4);

    BasicVertices.transformVertexPositions(vertices, M, { stride: 3 });

    assert.equal(vertices[0], 2, "X should be scaled by 2");
    assert.equal(vertices[1], 3, "Y should be scaled by 3");
    assert.equal(vertices[2], 4, "Z should be scaled by 4");
  });

  it("should respect custom stride and positionOffset", () => {
    // Interleaved data: [Junk, PosX, PosY, PosZ, Junk] (Stride 5, Position starts at index 1)
    const vertices = new Float32Array([
      99, 1, 1, 1, 99,
      99, 2, 2, 2, 99
    ]);

    const M = MatrixFloat32.translation(10, 10, 10);

    BasicVertices.transformVertexPositions(vertices, M, { stride: 5, positionOffset: 1 });

    // Check first vertex
    assert.equal(vertices[0], 99, "Pre-position junk data should be untouched");
    assert.equal(vertices[1], 11, "X position should be transformed");
    assert.equal(vertices[2], 11, "Y position should be transformed");
    assert.equal(vertices[3], 11, "Z position should be transformed");
    assert.equal(vertices[4], 99, "Post-position junk data should be untouched");

    // Check second vertex
    assert.equal(vertices[6], 12, "Second vertex X should be transformed");
  });

  it("should leave vertices unchanged with an identity matrix", () => {
    const vertices = new Float32Array([5, 10, 15, 20, 25, 30]);
    const M = new MatrixFloat32(); // Defaults to identity

    const original = new Float32Array(vertices);
    BasicVertices.transformVertexPositions(vertices, M, { stride: 3 });

    assert.deepEqual(Array.from(vertices), Array.from(original), "Identity matrix should not modify vertices.");
  });

  it("should correctly handle rotation around the Z axis", () => {
    // Point at (1, 0, 0)
    const vertices = new Float32Array([1, 0, 0]);

    // Rotate 90 degrees (Math.PI / 2) around Z
    // (1, 0, 0) rotated 90 deg CCW should become (0, 1, 0)
    const M = MatrixFloat32.rotationZ(Math.PI / 2);

    BasicVertices.transformVertexPositions(vertices, M, { stride: 3 });

    // Use closeTo for floating point math
    assert.closeTo(vertices[0], 0, 0.00001, "X should be ~0 after 90deg rotation");
    assert.closeTo(vertices[1], 1, 0.00001, "Y should be ~1 after 90deg rotation");
    assert.equal(vertices[2], 0, "Z should remain 0");
  });
});

},
{ displayName: "libGeometry: Vertices" },
);

});
