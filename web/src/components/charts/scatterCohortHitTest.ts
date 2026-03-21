/** Convert viewport coordinates to SVG user-space (viewBox) coordinates. */
export function clientToSvgUserPoint(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } | null {
  try {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const loc = pt.matrixTransform(ctm.inverse());
    return { x: loc.x, y: loc.y };
  } catch {
    return null;
  }
}

/** Even–odd ray casting; `poly` closed implicitly. */
export function pointInPolygon(x: number, y: number, poly: ReadonlyArray<{ x: number; y: number }>): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x;
    const yi = poly[i]!.y;
    const xj = poly[j]!.x;
    const yj = poly[j]!.y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-18) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
