export type MascotStatus = "idle" | "good" | "warning";

// 16x16 sprites. . = empty, w = fur, g = shade, d = ground, k = pupil, a = state accent.
const SPRITES: Record<MascotStatus, string[]> = {
  // Sitting, tail curled, waiting.
  idle: [
    "................",
    "..w......w......",
    "..ww....ww......",
    "..wgwwwwgw......",
    ".wwwwwwwwww.....",
    ".wwkwwwwkww.....",
    ".wwkwwwwkww.....",
    ".wwwwggwwww.....",
    "..wwwwwwww......",
    "...wwwwww.......",
    "..wwwwwwww......",
    "..wwwwwwww...ww.",
    "..wwgwwgww....w.",
    "..wwgwwgww....w.",
    "..wwwwwwwwwwww..",
    "..dddddddddddd..",
  ],
  // Standing tall, paws up, happy eyes, check mark.
  good: [
    "...............a",
    "..w......w....a.",
    "..wa....aw.a.a..",
    "..wwwwwwww..a...",
    ".wwwwwwwwww.....",
    ".wwkwwwwkww.....",
    ".wkwkwwkwkw.....",
    ".wwwwggwwww.....",
    "w.wwwwwwww.w....",
    "ww.wwwwww.ww....",
    ".wwwwwwwwww.....",
    "...wwwwww.......",
    "...wwwwww.......",
    "...ww..ww.......",
    "...ww..ww.......",
    "..dddddddddd....",
  ],
  // Crouched low, ears flat, wide eyes, bristled tail, exclamation mark.
  warning: [
    ".............a..",
    ".............a..",
    ".............a..",
    "................",
    ".............a..",
    "ww........ww....",
    ".wwwwwwwwww.....",
    ".wwwwwwwwww.....",
    ".wwaawwaaww.....",
    ".wwkawwkaww.....",
    ".wwwwggwwww.....",
    "..wwwddwww......",
    "wwwwwwwwwwww.w.w",
    "wwwwwwwwwwwwwww.",
    "www..wwww..www..",
    "dddddddddddddd..",
  ],
};

// Theme tokens, so the cat is white on dark and black on light.
const ACCENT: Record<MascotStatus, string> = { idle: "fill-mute", good: "fill-ok", warning: "fill-warn" };
const BASE: Record<string, string> = { w: "fill-ink", g: "fill-mute", d: "fill-line", k: "fill-canvas" };
const LABEL: Record<MascotStatus, string> = {
  idle: "Kucing WARAS menunggu",
  good: "Kucing WARAS senang: squat benar",
  warning: "Kucing WARAS waspada: perbaiki posisi",
};

// Merge horizontal runs of one color into a single rect so the SVG stays small.
function toRects(rows: string[], accent: string) {
  const rects: { x: number; y: number; w: number; cls: string }[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const c = row[x];
      let end = x + 1;
      while (row[end] === c) end++;
      if (c !== ".") rects.push({ x, y, w: end - x, cls: c === "a" ? accent : BASE[c] });
      x = end;
    }
  });
  return rects;
}

export function WarasCatMascot({ status, size = 64 }: { status: MascotStatus; size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ imageRendering: "pixelated" }}
      role="img"
      aria-label={LABEL[status]}
      className="shrink-0"
    >
      {toRects(SPRITES[status], ACCENT[status]).map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} className={r.cls} />
      ))}
    </svg>
  );
}

// 12x11 head used as the brand mark. app/icon.svg is drawn from the same grid.
const LOGO = [
  "w..........w",
  "ww........ww",
  "wgw......wgw",
  "wwwwwwwwwwww",
  "wwwwwwwwwwww",
  "wwaawwwwaaww",
  "wwaawwwwaaww",
  "wwwwwggwwwww",
  "wwwwwwwwwwww",
  ".wwwwwwwwww.",
  "..wwwwwwww..",
];

export function WarasLogo({ size = 24 }: { size?: number }) {
  return (
    <svg
      viewBox="0 -0.5 12 12"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      aria-hidden
      className="shrink-0"
    >
      {toRects(LOGO, "fill-ok").map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} className={r.cls} />
      ))}
    </svg>
  );
}
