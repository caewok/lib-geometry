describe('Point3d', () => {
  let point;

  beforeEach(() => {
    // Create a fresh instance for each test
    point = new Point3d(1, 2, 3);
  });

  test('should initialize correctly with x, y, z values', () => {
    expect(point.x).toBe(1);
    expect(point.y).toBe(2);
    expect(point.z).toBe(3);
  });

  test('toJSON should return correct object representation', () => {
    expect(point.toJSON()).toEqual({ x: 1, y: 2, z: 3 });
  });

  test('clone should create a new Point3d instance with identical properties', () => {
    const clone = point.clone();
    expect(clone).toEqual(point);
    expect(clone).not.toBe(point); // Ensure it\'s not the same instance
  });

  test('should calculate distance between two points', () => {
    const otherPoint = new Point3d(4, 6, 8);
    const distance = Point3d.distanceBetween(point, otherPoint);
    expect(distance).toBeCloseTo(7.4833, 4); // Approximate value
  });

  test('should calculate midPoint between two points', () => {
    const otherPoint = new Point3d(5, 8, 11);
    const mid = Point3d.midPoint(point, otherPoint);
    expect(mid.x).toBeCloseTo(3.0);
    expect(mid.y).toBeCloseTo(5.0);
    expect(mid.z).toBeCloseTo(7.0);
  });

  test('should normalize the vector', () => {
    const normalized = point.normalize();
    const magnitude = normalized.magnitude();
    expect(magnitude).toBeCloseTo(1, 6); // Length of a normalized vector should be ~1
  });

  test('should check equality of two points', () => {
    const samePoint = new Point3d(1, 2, 3);
    const otherPoint = new Point3d(4, 5, 6);
    expect(point.equals(samePoint)).toBe(true);
    expect(point.equals(otherPoint)).toBe(false);
  });

  test('should add two points correctly', () => {
    const otherPoint = new Point3d(4, 6, 8);
    const result = point.add(otherPoint);
    expect(result.x).toBe(5);
    expect(result.y).toBe(8);
    expect(result.z).toBe(11);
  });

  test('should subtract two points correctly', () => {
    const otherPoint = new Point3d(4, 6, 8);
    const result = point.subtract(otherPoint);
    expect(result.x).toBe(-3);
    expect(result.y).toBe(-4);
    expect(result.z).toBe(-5);
  });

  test('should calculate dot product correctly', () => {
    const otherPoint = new Point3d(4, 6, 8);
    const result = point.dot(otherPoint);
    expect(result).toBe(4 + 12 + 24); // dot product calculation
  });

  test('should calculate cross product correctly', () => {
    const otherPoint = new Point3d(4, 6, 8);
    const result = point.cross(otherPoint);
    expect(result.x).toBe(-2);
    expect(result.y).toBe(4);
    expect(result.z).toBe(-2);
  });

  test('angleBetween should return correct angle', () => {
    const a = new Point3d(1, 1, 0);
    const b = new Point3d(0, 0, 0);
    const c = new Point3d(1, 0, 0);
    const angle = Point3d.angleBetween(a, b, c);
    expect(angle).toBeCloseTo(Math.PI / 4); // 45 degrees in radians
  });

  test('should round decimals correctly', () => {
    point.set(1.2345, 2.3456, 3.4567).roundDecimals(2);
    expect(point.x).toBeCloseTo(1.23);
    expect(point.y).toBeCloseTo(2.35);
    expect(point.z).toBeCloseTo(3.46);
  });

  test('should create point from object with elevationZ', () => {
    const obj = { x: 5, y: 6, elevationZ: 7 };
    const newPoint = Point3d.fromObject(obj);
    expect(newPoint.x).toBe(5);
    expect(newPoint.y).toBe(6);
    expect(newPoint.z).toBe(7);
  });
});