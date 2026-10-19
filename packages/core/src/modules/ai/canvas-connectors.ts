/*
 * Native path normalization follows @smartdoca/canvas 0.5.5.
 * Copyright (c) 2026 smartdoca
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { fail } from "../../shared/errors.js";

type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };
type DiagramRect = Rect & { id: string };

function segmentIntersects(a: Point, b: Point, rect: Rect) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  let start = 0,
    end = 1;
  for (const [p, q] of [
    [-dx, a.x - rect.x],
    [dx, rect.x + rect.width - a.x],
    [-dy, a.y - rect.y],
    [dy, rect.y + rect.height - a.y],
  ]) {
    if (p === 0) {
      if (q! < 0) return false;
      continue;
    }
    const t = q! / p!;
    if (p! < 0) start = Math.max(start, t);
    else end = Math.min(end, t);
    if (start > end) return false;
  }
  return start <= end;
}

/** Explicit automatic routing for current native diagrams. Never runs on reads. */
export function autoCanvasConnector(
  nodes: DiagramRect[],
  sourceId: string,
  targetId: string,
  otherRoutes: Point[][] = [],
) {
  const source = nodes.find((n) => n.id === sourceId)!,
    target = nodes.find((n) => n.id === targetId)!;
  if (
    !source ||
    !target ||
    nodes.some((n) => ![n.x, n.y, n.width, n.height].every(Number.isFinite))
  )
    fail(400, "自动走线需要同一分组内明确的节点边界", {
      code: "canvas_diagram_node_invalid",
    });
  const ports = ["top", "right", "bottom", "left"] as const;
  const anchors = [
    { x: 0.5, y: 0 },
    { x: 1, y: 0.5 },
    { x: 0.5, y: 1 },
    { x: 0, y: 0.5 },
  ];
  const endpoint = (node: Rect, anchor: Point) => ({
    x: node.x + node.width * anchor.x,
    y: node.y + node.height * anchor.y,
  });
  const expanded = nodes.map((n) =>
    n.id === sourceId || n.id === targetId
      ? { x: n.x + 1, y: n.y + 1, width: n.width - 2, height: n.height - 2 }
      : { x: n.x - 8, y: n.y - 8, width: n.width + 16, height: n.height + 16 },
  );
  const offsets = (vertical: boolean, center: number) => {
    const values = [
      ...new Set(
        nodes.flatMap((n) =>
          vertical
            ? [n.x - 40, n.x + n.width + 40]
            : [n.y - 40, n.y + n.height + 40],
        ),
      ),
    ];
    return [
      ...new Set([
        ...values
          .sort((a, b) => Math.abs(a - center) - Math.abs(b - center))
          .slice(0, 16),
        Math.min(...values),
        Math.max(...values),
      ]),
    ];
  };
  let best:
    | {
        score: number;
        sourcePort: (typeof ports)[number];
        targetPort: (typeof ports)[number];
        offset?: number;
      }
    | undefined;
  for (let si = 0; si < anchors.length; si++)
    for (let ti = 0; ti < anchors.length; ti++) {
      const a = anchors[si]!,
        b = anchors[ti]!,
        from = endpoint(source, a),
        to = endpoint(target, b);
      const sv = a.y === 0 || a.y === 1,
        tv = b.y === 0 || b.y === 1;
      const candidates: (number | undefined)[] = [
        undefined,
        ...(sv === tv
          ? offsets(sv, sv ? (from.x + to.x) / 2 : (from.y + to.y) / 2)
          : []),
      ];
      for (const offset of candidates) {
        const route = canvasConnectorRoute(from, to, a, b, "elbow", offset);
        if (
          route.points
            .slice(1)
            .some((p, i) =>
              expanded.some((rect) =>
                segmentIntersects(route.points[i]!, p, rect),
              ),
            )
        )
          continue;
        let score =
          route.points
            .slice(1)
            .reduce(
              (sum, p, i) =>
                sum +
                Math.hypot(p.x - route.points[i]!.x, p.y - route.points[i]!.y),
              0,
            ) +
          (route.points.length - 2) * 12;
        for (let i = 1; i < route.points.length; i++) {
          const a = route.points[i - 1]!,
            b = route.points[i]!;
          for (const other of otherRoutes)
            for (let j = 1; j < other.length; j++) {
              const c = other[j - 1]!,
                d = other[j]!;
              const overlap =
                a.x === b.x && c.x === d.x && Math.abs(a.x - c.x) < 1
                  ? Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
                    Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
                  : a.y === b.y && c.y === d.y && Math.abs(a.y - c.y) < 1
                    ? Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
                      Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
                    : 0;
              score += Math.max(0, overlap) * 2;
            }
        }
        if (!best || score < best.score)
          best = {
            score,
            sourcePort: ports[si]!,
            targetPort: ports[ti]!,
            ...(offset === undefined ? {} : { offset }),
          };
      }
    }
  if (!best)
    fail(
      400,
      "没有找到避开卡片的原生走线，请先扩大卡片间距或移动节点，再自动走线",
      { code: "canvas_diagram_node_invalid" },
    );
  const { score: _score, ...result } = best;
  return result;
}

// Current native elbow paths are simplified and must leave both ports outward.
// The label uses half the length of that normalized path, not the raw bends.
function simplify(points: Point[]): Point[] {
  let result = points
    .filter(
      (p, i) =>
        !i || Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y) > 1e-6,
    )
    .map((p) => ({ ...p }));
  let changed = true;
  while (changed && result.length > 2) {
    changed = false;
    for (let i = 1; i < result.length - 1; i++) {
      const a = result[i - 1]!,
        b = result[i]!,
        c = result[i + 1]!,
        span = Math.hypot(c.x - a.x, c.y - a.y);
      if (
        span <= 1e-6 ||
        Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) <=
          1e-6 * span
      ) {
        result.splice(i, 1);
        changed = true;
        break;
      }
    }
    for (let i = 0; !changed && i < result.length - 3; i++) {
      for (let j = i + 2; j < result.length - 1; j++) {
        const a = result[i]!,
          b = result[i + 1]!,
          c = result[j]!,
          d = result[j + 1]!;
        const dx = b.x - a.x,
          dy = b.y - a.y,
          ex = d.x - c.x,
          ey = d.y - c.y,
          det = dx * ey - dy * ex;
        if (Math.abs(det) < 0.001) continue;
        const u = ((c.x - a.x) * ey - (c.y - a.y) * ex) / det,
          v = ((c.x - a.x) * dy - (c.y - a.y) * dx) / det;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        result = [
          ...result.slice(0, i + 1),
          { x: a.x + u * dx, y: a.y + u * dy },
          ...result.slice(j + 1),
        ];
        changed = true;
        break;
      }
    }
  }
  return result;
}

function normalize(points: Point[], source: Point, target: Point): Point[] {
  const from = points[0]!,
    to = points.at(-1)!;
  if (Math.hypot(from.x - to.x, from.y - to.y) < 1e-6)
    return [{ ...from }, { ...to }];
  const sh = source.x === 0 || source.x === 1,
    th = target.x === 0 || target.x === 1;
  const orthogonal: Point[] = [{ ...from }];
  for (let i = 1; i < points.length; i++) {
    const a = orthogonal.at(-1)!,
      b = points[i]!;
    if (Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6) {
      const previous = orthogonal.at(-2);
      const horizontal =
        i === 1
          ? sh
          : i === points.length - 1
            ? !th
            : previous
              ? Math.abs(a.x - previous.x) < 1e-6
              : sh;
      orthogonal.push(horizontal ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
    }
    orthogonal.push({ ...b });
  }
  const alignEnd = (path: Point[], horizontal: boolean) => {
    const a = path.at(-2)!,
      b = path.at(-1)!;
    if (horizontal ? Math.abs(b.y - a.y) < 1e-6 : Math.abs(b.x - a.x) < 1e-6)
      return path;
    const sign = (horizontal ? b.x >= a.x : b.y >= a.y) ? 1 : -1;
    const bend =
      (horizontal ? b.x : b.y) -
      sign * Math.min(32, Math.max(16, Math.hypot(b.x - a.x, b.y - a.y) / 3));
    return [
      ...path.slice(0, -1),
      horizontal ? { x: bend, y: a.y } : { x: a.x, y: bend },
      horizontal ? { x: bend, y: b.y } : { x: b.x, y: bend },
      b,
    ];
  };
  const sign = (port: Point, horizontal: boolean) =>
    (horizontal ? port.x : port.y) === 0 ? -1 : 1;
  const outward = (path: Point[], port: Point, horizontal: boolean) => {
    if (path.length < 2) return false;
    const a = path[0]!,
      b = path[1]!;
    return horizontal
      ? Math.abs(a.y - b.y) < 1e-6 && (b.x - a.x) * sign(port, true) > 1e-6
      : Math.abs(a.x - b.x) < 1e-6 && (b.y - a.y) * sign(port, false) > 1e-6;
  };
  const repairStart = (path: Point[], port: Point, horizontal: boolean) => {
    if (outward(path, port, horizontal) || path.length < 4) return path;
    const result = path.map((p) => ({ ...p })),
      axis = horizontal ? "x" : "y",
      old = result[1]![axis];
    result[1]![axis] = result[0]![axis] + sign(port, horizontal) * 32;
    if (Math.abs(result[2]![axis] - old) < 1e-6)
      result[2]![axis] = result[1]![axis];
    return result;
  };
  let result = simplify(
    alignEnd(alignEnd(orthogonal, th).reverse(), sh).reverse(),
  );
  result = simplify(
    repairStart(
      repairStart(result, source, sh).reverse(),
      target,
      th,
    ).reverse(),
  );
  if (outward(result, source, sh) && outward([...result].reverse(), target, th))
    return result;
  const s = sign(source, sh),
    t = sign(target, th);
  const start = sh
    ? { x: from.x + s * 32, y: from.y }
    : { x: from.x, y: from.y + s * 32 };
  const end = th
    ? { x: to.x + t * 32, y: to.y }
    : { x: to.x, y: to.y + t * 32 };
  if (sh && th) {
    const y =
      Math.abs(from.y - to.y) < 1e-6 ? from.y + 64 : (from.y + to.y) / 2;
    return simplify([from, start, { x: start.x, y }, { x: end.x, y }, end, to]);
  }
  if (!sh && !th) {
    const x =
      Math.abs(from.x - to.x) < 1e-6 ? from.x + 64 : (from.x + to.x) / 2;
    return simplify([from, start, { x, y: start.y }, { x, y: end.y }, end, to]);
  }
  if (sh) {
    let y = end.y + t * 32;
    if (Math.abs(y - from.y) < 1e-6) y += t * 32;
    return simplify([from, start, { x: start.x, y }, { x: to.x, y }, to]);
  }
  let x = end.x + t * 32;
  if (Math.abs(x - from.x) < 1e-6) x += t * 32;
  return simplify([from, start, { x, y: start.y }, { x, y: to.y }, to]);
}

/** Current native straight/elbow routing and normalized path-length label anchor. */
export function canvasConnectorRoute(
  from: Point,
  to: Point,
  source: Point,
  target: Point,
  mode: string,
  offset?: number,
) {
  const sv = source.y === 0 || source.y === 1,
    tv = target.y === 0 || target.y === 1;
  const sign = (anchor: Point, vertical: boolean) =>
    (vertical ? anchor.y : anchor.x) === 0 ? -1 : 1;
  const s = sign(source, sv),
    t = sign(target, tv);
  let points = [from, to],
    middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  if (mode === "elbow") {
    if (sv === tv && offset !== undefined) {
      const start = sv
        ? { x: from.x, y: from.y + s * 32 }
        : { x: from.x + s * 32, y: from.y };
      const end = tv
        ? { x: to.x, y: to.y + t * 32 }
        : { x: to.x + t * 32, y: to.y };
      points = sv
        ? [
            from,
            start,
            { x: offset, y: start.y },
            { x: offset, y: end.y },
            end,
            to,
          ]
        : [
            from,
            start,
            { x: start.x, y: offset },
            { x: end.x, y: offset },
            end,
            to,
          ];
      middle = sv
        ? { x: offset, y: (start.y + end.y) / 2 }
        : { x: (start.x + end.x) / 2, y: offset };
    } else if (sv === tv) {
      const a = sv ? from.y : from.x,
        b = sv ? to.y : to.x;
      const bend =
        s === t
          ? s > 0
            ? Math.max(a, b) + 40
            : Math.min(a, b) - 40
          : (a + b) / 2;
      points = sv
        ? [from, { x: from.x, y: bend }, { x: to.x, y: bend }, to]
        : [from, { x: bend, y: from.y }, { x: bend, y: to.y }, to];
      middle = sv
        ? { x: (from.x + to.x) / 2, y: bend }
        : { x: bend, y: (from.y + to.y) / 2 };
    } else {
      const corner = sv ? { x: from.x, y: to.y } : { x: to.x, y: from.y };
      if (
        (sv ? corner.y - from.y : corner.x - from.x) * s >= 24 &&
        (tv ? corner.y - to.y : corner.x - to.x) * t >= 24
      ) {
        points = [from, corner, to];
        middle = corner;
      } else {
        const bend = (sv ? from.y : from.x) + s * 40;
        const end = tv
          ? { x: to.x, y: to.y + t * 40 }
          : { x: to.x + t * 40, y: to.y };
        points = sv
          ? [from, { x: from.x, y: bend }, { x: end.x, y: bend }, end, to]
          : [from, { x: bend, y: from.y }, { x: bend, y: end.y }, end, to];
        middle = sv
          ? { x: (from.x + end.x) / 2, y: bend }
          : { x: bend, y: (from.y + end.y) / 2 };
      }
    }
  }
  if (mode === "elbow") {
    points = normalize(points, source, target);
    const lengths = points
      .slice(1)
      .map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
    let remaining = lengths.reduce((a, b) => a + b, 0) / 2;
    for (let i = 0; i < lengths.length; i++) {
      if (remaining <= lengths[i]!) {
        const ratio = remaining / (lengths[i] || 1),
          a = points[i]!,
          b = points[i + 1]!;
        middle = { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
        break;
      }
      remaining -= lengths[i]!;
    }
  }
  const control =
    [...points].reverse().find((p) => p.x !== to.x || p.y !== to.y) ?? from;
  const angle = Math.atan2(to.y - control.y, to.x - control.x);
  const head = `M${to.x - 9 * Math.cos(angle - 0.48)} ${to.y - 9 * Math.sin(angle - 0.48)}L${to.x} ${to.y}L${to.x - 9 * Math.cos(angle + 0.48)} ${to.y - 9 * Math.sin(angle + 0.48)}`;
  return {
    points,
    middle,
    path: points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join("") + head,
  };
}

/** Explicit label layout for current native diagrams; no document is changed by reading it. */
export function canvasConnectorLabel(
  route: ReturnType<typeof canvasConnectorRoute>,
  width: number,
  height: number,
  obstacles: Rect[],
  occupied: Rect[],
) {
  if (
    [...obstacles, ...occupied].some(
      (rect) =>
        ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite),
    )
  )
    fail(
      400,
      "自动安排标签需要明确的节点和标签边界，请读取后指定尺寸或显式 labelOffset",
      { code: "canvas_diagram_node_invalid" },
    );
  const candidates: Point[] = [route.middle];
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1]!,
      b = route.points[i]!;
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (a.y === b.y && Math.abs(a.x - b.x) >= width + 16)
      candidates.push(
        { x: middle.x, y: middle.y - 24 },
        { x: middle.x, y: middle.y + 24 },
        middle,
      );
    if (a.x === b.x && Math.abs(a.y - b.y) >= height + 16)
      candidates.push(
        { x: middle.x - width / 2 - 12, y: middle.y },
        { x: middle.x + width / 2 + 12, y: middle.y },
        middle,
      );
  }
  for (const distance of [32, 64, 96, 144, 192, 256])
    for (const [x, y] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      candidates.push({
        x: route.middle.x + x! * distance,
        y: route.middle.y + y! * distance,
      });
  const intersects = (box: Rect, other: Rect, margin: number) =>
    box.x < other.x + other.width + margin &&
    box.x + box.width > other.x - margin &&
    box.y < other.y + other.height + margin &&
    box.y + box.height > other.y - margin;
  const chosen = candidates
    .sort(
      (a, b) =>
        Math.hypot(a.x - route.middle.x, a.y - route.middle.y) -
        Math.hypot(b.x - route.middle.x, b.y - route.middle.y),
    )
    .find((point) => {
      const box = {
        x: point.x - width / 2,
        y: point.y - height / 2,
        width,
        height,
      };
      return (
        !obstacles.some((rect) => intersects(box, rect, 8)) &&
        !occupied.some((rect) => intersects(box, rect, 6))
      );
    });
  if (!chosen)
    fail(
      400,
      "连线标签附近没有足够空白，请先增大节点间距或调整连线端口/offset",
      { code: "canvas_diagram_node_invalid" },
    );
  return { x: chosen.x - route.middle.x, y: chosen.y - route.middle.y };
}
