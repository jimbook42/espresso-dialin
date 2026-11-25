export const FLOW_STROKE = '#16877d';
export const LIVE_FLOW_STROKE = '#63c5b6';
const SUSTAINED_FLOW_S = 0.5;

// The outer Tukey fence is weighted by time so notification bursts do not set the axis.
export function typicalFlowRange(points, minimumTop = 2) {
  let lower = -6;
  let upper = 6;
  if (points.length >= 4) {
    const weighted = points.map((point, i) => ({
      value: point.flowGs,
      seconds: i === 0 || point.breakBefore ? 0.2 : Math.min(0.5, point.tS - points[i - 1].tS),
    })).sort((a, b) => a.value - b.value);
    const total = weighted.reduce((sum, point) => sum + point.seconds, 0);
    const quantile = (fraction) => {
      let remaining = total * fraction;
      return weighted.find(({ seconds }) => (remaining -= seconds) <= 0)?.value ?? weighted.at(-1).value;
    };
    const q1 = quantile(0.25);
    const q3 = quantile(0.75);
    const spread = Math.max(0.5, q3 - q1);
    lower = q1 - 3 * spread;
    upper = q3 + 3 * spread;
  }
  let min = 0;
  let max = minimumTop;
  let runStart;
  let runEdge;
  let side = 0;
  for (const { flowGs, tS, breakBefore } of points) {
    const nextSide = flowGs < lower ? -1 : flowGs > upper ? 1 : 0;
    if (nextSide !== side || breakBefore) {
      runStart = tS;
      runEdge = flowGs;
      side = nextSide;
    }
    if (side === 0) {
      min = Math.min(min, flowGs);
      max = Math.max(max, flowGs);
    } else {
      runEdge = side < 0 ? Math.min(runEdge, flowGs) : Math.max(runEdge, flowGs);
      // A sustained excursion is part of the extraction, even when it takes up
      // too little of the full shot to enter the middle half of the distribution.
      if (tS - runStart >= SUSTAINED_FLOW_S - 1e-9) {
        min = Math.min(min, runEdge);
        max = Math.max(max, runEdge);
      }
    }
  }
  return [min, max];
}

export function splitFlowPlot(points, min, max) {
  const visible = [];
  const outliers = [];
  let breakBefore = false;
  for (const point of points) {
    if (point.flowGs < min || point.flowGs > max) {
      outliers.push(point);
      breakBefore = true;
    } else {
      visible.push(breakBefore ? { ...point, breakBefore } : point);
      breakBefore = false;
    }
  }
  return { visible, outliers };
}

// Dense traces need at most the first, last and extreme estimates per SVG pixel.
// Always start a new bucket at a recording break, even inside the same pixel.
export function flowPointsForPlot(points, startS, endS, width) {
  if (points.length <= width * 4) return points;
  const visible = [];
  let first = 0;
  let minimum = 0;
  let maximum = 0;
  const pixel = (point) => Math.floor(width * (point.tS - startS) / (endS - startS));
  for (let index = 1; index <= points.length; index += 1) {
    const point = points[index];
    if (!point || point.breakBefore || pixel(point) !== pixel(points[first])) {
      for (const keep of [...new Set([first, minimum, maximum, index - 1])].sort((a, b) => a - b)) {
        visible.push(points[keep]);
      }
      first = minimum = maximum = index;
    } else {
      if (point.flowGs < points[minimum].flowGs) minimum = index;
      if (point.flowGs > points[maximum].flowGs) maximum = index;
    }
  }
  return visible;
}
