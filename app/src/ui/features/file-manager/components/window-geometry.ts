export interface WindowRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Bounds for floating file editors, in their positioned container's coordinates. */
export function fitFileWindow(
  rect: WindowRectangle,
  bounds: { width: number; height: number },
  minimum: { width: number; height: number },
): WindowRectangle {
  if (bounds.width <= 0 || bounds.height <= 0) return rect;
  const top = Math.min(
    49,
    Math.max(0, bounds.height - Math.min(minimum.height, bounds.height)),
  );
  const width = Math.min(
    bounds.width,
    Math.max(Math.min(minimum.width, bounds.width), rect.width),
  );
  const height = Math.min(
    bounds.height - top,
    Math.max(Math.min(minimum.height, bounds.height - top), rect.height),
  );
  return {
    x: Math.max(0, Math.min(bounds.width - width, rect.x)),
    y: Math.max(top, Math.min(bounds.height - height, rect.y)),
    width,
    height,
  };
}
