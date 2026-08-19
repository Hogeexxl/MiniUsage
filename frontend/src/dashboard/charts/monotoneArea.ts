export type Point = { x: number; y: number };
type Segment = { from: Point; c1: Point; c2: Point; to: Point };

function monotoneSegments(points: Point[]): Segment[] {
  if (points.length < 2) return [];
  const delta = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    const dx = next.x - point.x;
    return dx === 0 ? 0 : (next.y - point.y) / dx;
  });
  const tangent = new Array(points.length).fill(0) as number[];
  tangent[0] = delta[0];
  tangent[tangent.length - 1] = delta[delta.length - 1];
  for (let index = 1; index < tangent.length - 1; index += 1) {
    const left = delta[index - 1];
    const right = delta[index];
    tangent[index] = left === 0 || right === 0 || Math.sign(left) !== Math.sign(right) ? 0 : (left + right) / 2;
  }
  for (let index = 0; index < delta.length; index += 1) {
    if (delta[index] === 0) {
      tangent[index] = 0;
      tangent[index + 1] = 0;
      continue;
    }
    const a = tangent[index] / delta[index];
    const b = tangent[index + 1] / delta[index];
    const magnitude = a * a + b * b;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangent[index] = scale * a * delta[index];
      tangent[index + 1] = scale * b * delta[index];
    }
  }
  return points.slice(0, -1).map((from, index) => {
    const to = points[index + 1];
    const dx = to.x - from.x;
    return {
      from,
      c1: { x: from.x + dx / 3, y: Math.max(0, from.y + (tangent[index] * dx) / 3) },
      c2: { x: to.x - dx / 3, y: Math.max(0, to.y - (tangent[index + 1] * dx) / 3) },
      to,
    };
  });
}

const p = (point: Point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`;

export function buildMonotoneAreaPath(pointsTop: Point[], pointsBottom: Point[]): string {
  if (pointsTop.length === 0 || pointsTop.length !== pointsBottom.length) return "";
  const top = monotoneSegments(pointsTop);
  const bottom = monotoneSegments(pointsBottom);
  let path = `M${p(pointsTop[0])}`;
  for (const segment of top) path += ` C${p(segment.c1)} ${p(segment.c2)} ${p(segment.to)}`;
  path += ` L${p(pointsBottom[pointsBottom.length - 1])}`;
  for (let index = bottom.length - 1; index >= 0; index -= 1) {
    const segment = bottom[index];
    path += ` C${p(segment.c2)} ${p(segment.c1)} ${p(segment.from)}`;
  }
  return `${path} Z`;
}
