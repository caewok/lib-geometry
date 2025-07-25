import { AABB2d } from "./AABB.js";
import { Point3d } from "./3d/Point3d.js";


describe('AABB2d.overlapsAABB', () => {
  it('should return true when two boxes overlap', () => {
    const box1 = new AABB2d();
    box1.min = new PIXI.Point(0, 0);
    box1.max = new PIXI.Point(5, 5);

    const box2 = new AABB2d();
    box2.min = new PIXI.Point(3, 3);
    box2.max = new PIXI.Point(8, 8);

    expect(box1.overlapsAABB(box2)).toBe(true);
    expect(box2.overlapsAABB(box1)).toBe(true);
  });

  it('should return false when two boxes do not overlap', () => {
    const box1 = new AABB2d();
    box1.min = new PIXI.Point(0, 0);
    box1.max = new PIXI.Point(2, 2);

    const box2 = new AABB2d();
    box2.min = new PIXI.Point(3, 3);
    box2.max = new PIXI.Point(5, 5);

    expect(box1.overlapsAABB(box2)).toBe(false);
    expect(box2.overlapsAABB(box1)).toBe(false);
  });

  it('should return true when boxes touch at the edge', () => {
    const box1 = new AABB2d();
    box1.min = new PIXI.Point(0, 0);
    box1.max = new PIXI.Point(2, 2);

    const box2 = new AABB2d();
    box2.min = new PIXI.Point(2, 2);
    box2.max = new PIXI.Point(4, 4);

    expect(box1.overlapsAABB(box2)).toBe(true);
    expect(box2.overlapsAABB(box1)).toBe(true);
  });

  it('should work for negative coordinates', () => {
    const box1 = new AABB2d();
    box1.min = new PIXI.Point(-5, -5);
    box1.max = new PIXI.Point(0, 0);

    const box2 = new AABB2d();
    box2.min = new PIXI.Point(-2, -2);
    box2.max = new PIXI.Point(2, 2);

    expect(box1.overlapsAABB(box2)).toBe(true);
    expect(box2.overlapsAABB(box1)).toBe(true);
  });
});