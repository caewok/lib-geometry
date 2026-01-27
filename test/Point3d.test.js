const { Point3d } = require('../src/Point3d'); // Adjust the import according to your structure

describe('Point3d Class Tests', () => {
    let point;

    beforeEach(() => {
        point = new Point3d(1, 2, 3);
    });

    test('should create a Point3d instance with given coordinates', () => {
        expect(point.x).toBe(1);
        expect(point.y).toBe(2);
        expect(point.z).toBe(3);
    });

    test('should calculate distance to another Point3d', () => {
        const pointB = new Point3d(4, 5, 6);
        expect(point.distanceTo(pointB)).toBeCloseTo(5.196, 3);
    });

    test('should return the correct string representation', () => {
        expect(point.toString()).toBe('Point3d(1, 2, 3)');
    });

    test('should handle edge cases for distance calculation', () => {
        const pointB = new Point3d(1, 2, 3);
        expect(point.distanceTo(pointB)).toBe(0); // same point
    });

    test('should correctly translate the point', () => {
        point.translate(1, 1, 1);
        expect(point.x).toBe(2);
        expect(point.y).toBe(3);
        expect(point.z).toBe(4);
    });

    // Add more tests for all methods and edge cases
});
