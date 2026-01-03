/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometryInstanced, GeometryNonInstanced } from "./GeometryDesc.js";
import { Rectangle3dVertices, Polygon3dVertices, Hex3dVertices, BasicVertices } from "./BasicVertices.js";
import { OBJParser } from "./OBJParser.js";
import { TriangleSplitter } from "./TriangleSplitter.js";
import { geoDelaunay } from "./d3-geo-voronoi-bundled.js";

import { OTHER_MODULES, GEOMETRY_LIB_ID } from "../const.js";
import { Point3d } from "../3d/Point3d.js";
import { Sphere } from "../3d/Sphere.js";
import { Triangle3d } from "../3d/Polygon3d.js";
import { isOnSegment } from "../util.js";

// import { geoDelaunay } from "https://cdn.skypack.dev/d3-geo-voronoi@2";

const tmpRect = new PIXI.Rectangle();

/**
 * Converts 3D Cartesian coordinates (x, y, z) on a sphere
 * to geographic latitude and longitude in degrees.
 * @param {Point3d} pt
 * @returns {PIXI.Point} Object with latitude and longitude in degrees.
 * @returns {{lon: number, lat: number}}
 */
function cartesianToLonLat(pt) {
  // Calculate the radius 'r' from the center (0,0,0) to the point (x,y,z).
  // This ensures the function works even if the points aren't on a unit sphere (r=1).
  const r = pt.magnitude();

  // If r is 0, the point is at the origin. We'll default to (0, 0).
  if ( r === 0 ) PIXI.Point.tmp.set(0, 0);

  // --- Calculate Latitude ---
  // Latitude (lat) is the angle from the equatorial (XY) plane.
  // We can find it using arcsin(z / r).
  // Math.asin() returns values in radians from -PI/2 to PI/2.
  const latRadians = Math.asin(pt.z / r);

  // --- Calculate Longitude ---
  // Longitude (lon) is the angle in the XY-plane from the +X axis.
  // Math.atan2(y, x) correctly calculates the angle in all four quadrants.
  // It returns values in radians from -PI to PI.
  const lonRadians = Math.atan2(-pt.y, pt.x);

  // Convert radians to degrees
  const lat = latRadians * (180 / Math.PI);
  const lon = lonRadians * (180 / Math.PI);

  return PIXI.Point.tmp.set(lon, lat);
}


/**
 * Two types of token geometries: instanced and non-instanced.
 * All the non-instanced store an instanced geometry for fast calculation.
 */


// ----- NOTE: Instanced Token geometries ----- //

export class GeometryToken extends GeometryInstanced {

  _defineInstanceVertices() {
    return Rectangle3dVertices.calculateVertices();
  }
}

export class GeometrySquareToken extends GeometryToken {}

export class GeometryHexToken extends GeometryToken {

  constructor(hexKey = "0_1_1", opts) {
    super(hexKey, opts);
  }

  get hexKey() { return this.type; }

  _defineInstanceVertices() {
    const { hexagonalShape, width, height } = Hex3dVertices.hexPropertiesForKey(this.hexKey);
    return Hex3dVertices.calculateVertices(hexagonalShape, { width, height });
  }
}

export class GeometrySphericalToken extends GeometryToken {
  _defineInstanceVertices() {
    return this.calculateSphericalVertices();
  }

  /**
   * How many spherical points are necessary to achieve a given spacing for a given sphere radius?
   * @param {number} [radius=1]
   * @param {number} [spacing]        Defaults to the module spacing default for per-pixel calculator.
   * @returns {number}
   */
  static numberOfSphericalPointsForSpacing(r = 1, l = CONFIG[GEOMETRY_LIB_ID].perPixelSpacing || 10) {
    /*
    Surface area of a sphere is 4πr^2.
    With N points, divide by N to get average area per point.
    Assuming perfectly equidistant points, consider side length of a square with average area.
    l = sqrt(4πr^2/N) = 2r*sqrt(π/N)
    To get N, square both sides and simplify.
    N = (4πr^2) / l^2
    l = 2 * r * Math.sqrt(Math.PI / N);
    */
    return (4 * Math.PI * (r ** 2)) / (l ** 2);
  }

  calculateSphericalVertices() {
    // Assume a 1x1 token is sufficient resolution for a decent sphere.
    /*
    // The folowing is approximately 87. From center to far 3d corner.
    // Point3d.distanceBetween(Point3d.tmp.set(0,0,0), Point3d.tmp.set(50, 50 ,50))
    const w = canvas.grid.sizeX;
    const h = canvas.grid.sizeY;
    const z = canvas.grid.size;
    const r = Point3d.distanceBetween(Point3d.tmp.set(0,0,0), Point3d.tmp.set(w * 0.5, h * 0.5, z * 0.5)); // Want the radius, not the diameter.
    */
    const r = 87;
    const nPoints = Math.floor(this.numberOfSphericalPointsForSpacing(r)) || 1;
    const sphericalPoints = Sphere.pointsLattice(nPoints);

    // Scale the points by 1/2, so instead of -1 to 1 they go from -.5 to .5.
    sphericalPoints.forEach(pt => pt.multiplyScalar(0.5, pt));

    const lonLatPoints = sphericalPoints.map(pt => cartesianToLonLat(pt));
    const lonLatArr = lonLatPoints.map(pt => [pt.x, pt.y])

    const delauney = geoDelaunay(lonLatArr);
    const tris3d = delauney.triangles.map(triIndices => {
      const a = sphericalPoints[triIndices[0]];
      const b = sphericalPoints[triIndices[1]];
      const c = sphericalPoints[triIndices[2]];
      return Triangle3d.from3Points(a, b, c);
    });

    // Test by scaling.
    // scaledTris3d = tris3d.map(tri => tri.scale({ x: 1000, y: 1000, z: 1000 }))
    // scaledTris3d.forEach(tri => tri.draw2d())

    Point3d.release(...sphericalPoints);
    PIXI.Point.release(...lonLatPoints);
    const vertices = Triangle3d.trianglesToVertices(tris3d, { addNormals: true })
    tris3d.forEach(tri => Point3d.release(...tri.points));
    return BasicVertices.appendUVs(vertices, { stride: 6, outArr: 8 })
  }
}

/* Not yet fully implemented.
export class GeometryCustomToken extends GeometryToken {

  static FLAGS = {
    CUSTOM_TOKENS: {
      FILE_LOC: "customShapeFile",
      NAME: "customShapeName",
      OFFSET: "customShapeOffset",
    },
  };

  objData = {
    fileLoc: "",
    name: "",
    offset: null,
    parser: null,
  };

  get instanceKey() {
    const key = super.instanceKey;
    const { fileLoc, name, offset } = this.objData;
    return `${key}_${fileLoc}|${name}|${offset}`
  }

  defineInstance(force = false) {
    if ( force ) return; // Don't define instance until initialize.
    super.defineInstance();
  }

  async initialize() {
    await this.loadOBJFileFromToken();
    this.defineInstance(true);
    return super.initialize();
  }

  async loadOBJFileFromToken(token) {
    const ATV = OTHER_MODULES.ALTERNATIVE_TOKEN_VISIBILITY;
    const FLAGS = this.constructor.FLAGS;
    const doc = token.document;
    const objFile = (ATV ? doc.getFlag(ATV.ID, FLAGS.CUSTOM_TOKENS.FILE_LOC) : 0) || "modules/tokenvisibility/icons/Cube.obj";
    const objName = (ATV ? doc.getFlag(ATV.ID, FLAGS.CUSTOM_TOKENS.NAME) : 0) || "Cube";
    const objOffset = Point3d.fromObject((ATV ? doc.getFlag(ATV.KEY, FLAGS.CUSTOM_TOKENS.OFFSET) : 0) || { x: 0, y: 0, z: 0 });
    this.objData.fileLoc = objFile;
    this.objData.name = objName;
    this.objData.offset = objOffset;
    this.objData.parser = new OBJParser(objFile);
    await this.objData.parser.loadObjectFile();
  }

  _defineInstanceVertices() {
    const obj = this.objData.parser.getObject(this.objData.name);
    return obj.combineMaterials()
  }
}
*/

// ----- NOTE: Non-Instanced Token geometries ----- //

class GeometryNonInstancedToken extends GeometryNonInstanced {

  get token() { return this.placeable; }

  instancedGeom;

  initialize() {
    const G = CONST.GRID_TYPES;
    let instanceCl;
    switch ( canvas.grid.type ) {
      case G.GRIDLESS: instanceCl = GeometryToken; break;
      case G.SQUARE: instanceCl = GeometrySquareToken; break;
      default: instanceCl = GeometryHexToken;
    }
    let type = undefined;
    if ( canvas.grid.isHexagonal ) type = Hex3dVertices.hexKeyForToken(this.token);
    this.instancedGeom = new instanceCl(type, { addUVs: this.addUVs, addNormals: this.addNormals });
  }

  // No instanced vertices per se but can use instance when not constrained.
  _calculateModel(vertices, indices, _placeable) {
    if ( this.instanced ) return this.instancedGeom.calculateModel(this.token);
    return super._calculateModel(vertices, indices);
  }
}

export class GeometryConstrainedToken extends GeometryNonInstancedToken {

  get instanced() { return !this.token.isConstrainedTokenBorder; }

  // Calculation when token is constrained.
  _calculateModelVertices(_vertices) {
    const { topZ, bottomZ, constrainedTokenBorder } = this.token;
    return Polygon3dVertices.calculateVertices(constrainedTokenBorder.toPolygon(), { topZ, bottomZ });
  }
}

export class GeometryLitToken extends GeometryNonInstancedToken {

  get instanced() {
    const { litTokenBorder, tokenBorder } = this.token;
    return litTokenBorder && litTokenBorder.equals(tokenBorder);
  }

  _calculateModelVertices(_vertices) {
    const { litTokenBorder, topZ, bottomZ } = this.token;
    const border = litTokenBorder || this.placeable.constrainedTokenBorder;
    return Polygon3dVertices.calculateVertices(border.toPolygon(), { topZ, bottomZ });
  }
}

export class GeometryBrightLitToken extends GeometryNonInstancedToken {

  get instanced() {
    const { brightLitTokenBorder, tokenBorder } = this.token;
    return brightLitTokenBorder && brightLitTokenBorder.equals(tokenBorder);
  }

  _calculateModelVertices(_vertices) {
    const { brightLitTokenBorder, topZ, bottomZ } = this.token;
    const border = brightLitTokenBorder || this.placeable.constrainedTokenBorder;
    return Polygon3dVertices.calculateVertices(border.toPolygon(), { topZ, bottomZ });
  }
}

/* Not yet fully implemented.
export class GeometryConstrainedCustomToken extends GeometryNonInstancedToken {
  initialize() {
    this.instancedGeom = new GeometryCustomToken();
  }

  get instanced() { return !this.token.isConstrainedTokenBorder; }

  // Calculation when token is constrained.
  _calculateModel(vertices, indices) {
    const res = super._calculateModel(vertices, indices); // Returns { vertices, indices }
    if ( this.instanced ) return res;

    // Locate each edge in the constrained token border that does not match the token border.
    // Convert to triangles, which will be later constrained by the constrained border.
    const token = this.placeable;
    let tris = Triangle3d.fromVertices(res.vertices, res.indices, this.stride);

    // TODO: Need to ensure the edges are A --> B where CW faces in toward the filled polygon.
    const edgeDiffFn = token.tokenBorder instanceof PIXI.Rectangle ? diffRectanglePolygonEdges : diffPolygonEdges;
    const edges = edgeDiffFn(token.tokenBorder, token.constrainedTokenBorder.toPolygon());

    // Split the custom shape using a vertical plane corresponding to each edge.
    for ( const edge of edges ) {
      const splitter = TriangleSplitter.from2dPoints(edge.A, edge.B, true);
      tris = splitter.splitFromTriangles3d(tris);
    }
    const vs = Triangle3d.trianglesToVertices(tris, { addNormals: this.addNormals })
    return BasicVertices.condenseVertexData(vs, { stride: this.stride });
  }
}

export class GeometryLitCustomToken extends GeometryConstrainedCustomToken {
  get instanced() {
    const { litTokenBorder, tokenBorder } = this.token;
    return litTokenBorder && litTokenBorder.equals(tokenBorder);
  }

  // Calculation when token is lit.
  _calculateModel(vertices, indices) {
    const res = super._calculateModel(vertices, indices); // Returns { vertices, indices }
    if ( this.instanced ) return res;

    // Locate each edge in the constrained token border that does not match the token border.
    // Convert to triangles, which will be later constrained by the constrained border.
    const token = this.placeable;
    let tris = Triangle3d.fromVertices(res.vertices, res.indices, this.stride);

    // TODO: Need to ensure the edges are A --> B where CW faces in toward the filled polygon.
    const edgeDiffFn = token.tokenBorder instanceof PIXI.Rectangle ? diffRectanglePolygonEdges : diffPolygonEdges;
    const edges = edgeDiffFn(token.tokenBorder, token.constrainedTokenBorder.toPolygon());

    // Split the custom shape using a vertical plane corresponding to each edge.
    for ( const edge of edges ) {
      const splitter = TriangleSplitter.from2dPoints(edge.A, edge.B, true);
      tris = splitter.splitFromTriangles3d(tris);
    }
    const vs = Triangle3d.trianglesToVertices(tris, { addNormals: this.addNormals })
    return BasicVertices.condenseVertexData(vs, { stride: this.stride });
  }
}
*/


/**
 * @typedef {object} PolyEdge
 * @prop {object} A
 *   - @prop {number} x
 *   - @prop {number} y
 * @prop {object} B
 *   - @prop {number} x
 *   - @prop {number} y
 */

/**
 * Find edges in polygon1 that are not part of the polygon0 edge.
 * If any portion of the edge overlaps, that counts as part of the polygon.
 * @param {PIXI.Polygon} poly0
 * @param {PIXI.Polygon} poly1
 * @returns {Set<PolyEdge>}
 */
function diffPolygonEdges(poly0, poly1) {
  // Sweep left to right along x-axis with sorting instead of brute force
  const orient2d = foundry.utils.orient2dFast;
  const edges0 = [...poly0.iterateEdges({ close: true })];
  const edges1 = [...poly1.iterateEdges({ close: true })];

  // Sort edges by their maximum x value.
  const sortFn = (a, b) => Math.max(a.A.x, a.B.x)  - Math.max(b.A.x, b.B.x)
  edges0.sort(sortFn);
  edges1.sort(sortFn);

  const edges0Set = new Set(edges0);
  const edges1Set = new Set([edges1]);
  for ( const edge1 of edges1 ) {
    const targetX = Math.max(edge1.A.x, edge1.A.y);
    for ( const edge0 of edges0Set ) {
      // If this edge is too far left, can skip going forward.
      if ( Math.max(edge0.A.x, edge0.A.y) < targetX ) {
        edges0Set.delete(edge0);
        continue;
      }

      // Edge 0 and edge 1 must be collinear.
      if ( !(orient2d(edge0.A, edge0.B, edge1.A).almostEqual(0)
          && orient2d(edge0.A, edge0.B, edge1.B).almostEqual(0)) ) continue;

      // Edge1's endpoint must be within edge0 or vice-versa
      if ( isOnSegment(edge0.A, edge0.B, edge1.A)
        || isOnSegment(edge0.A, edge0.B, edge1.B)
        || isOnSegment(edge1.A, edge1.B, edge0.A)
        || isOnSegment(edge1.A, edge1.B, edge0.B) ) edges1Set.delete(edge1);
    }
  }
  return edges1Set;
}

/**
 * Find edges in polygon that are not part of the rectangle edge.
 * If any portion of the edge overlaps, that counts as part of the rectangle.
 * @param {PIXI.Rectangle} rect
 * @param {PIXI.Polygon} poly1
 * @returns {Set<PolyEdge>}
 */
function diffRectanglePolygonEdges(rect, poly) {
  const out = new Set();
  for ( const edge of poly.iterateEdges({ close: true }) ) {
    if ( (edge.B.y - edge.A.y).almostEqual(0) ) { // Edge is horizontal
      if ( edge.A.x.between(rect.left, rect.right)
        || edge.B.x.between(rect.left, rect.right)
        || (edge.A.x < rect.left && edge.B.x > rect.right)
        || (edge.B.x < rect.left && edge.A.x > rect.right) ) continue;

    } else if ( (edge.B.x - edge.A.x).almostEqual() ) { // Edge is vertical
      if ( edge.A.y.between(rect.top, rect.bottom)
        || edge.B.y.between(rect.top, rect.bottom)
        || (edge.A.y < rect.top && edge.B.y > rect.bottom)
        || (edge.B.y < rect.top && edge.A.y > rect.bottom) ) continue;
    }
    out.add(edge);
  }
  return out;
}
