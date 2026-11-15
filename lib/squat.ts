// Squat rules from Chen et al. (2026), Computers 15(5):293, doi:10.3390/computers15050293.
// Keep the angle math identical to colab/waras_fit.ipynb so fitted params stay valid.

export type Pt = { x: number; y: number; visibility?: number };
export type Params = { k: number; b: number; tol: number; delta: number; minPassRatio: number };
export type Frame = { hip: number; knee: number; hipY: number; kneeY: number; thigh: number };
export type Verdict = { ok: boolean; issues: string[] };

// Angle at b (degrees) via the law of cosines.
export function angle(a: Pt, b: Pt, c: Pt): number {
  const ab = Math.hypot(a.x - b.x, a.y - b.y);
  const cb = Math.hypot(c.x - b.x, c.y - b.y);
  const ac = Math.hypot(a.x - c.x, a.y - c.y);
  if (ab === 0 || cb === 0) return NaN;
  const cos = (ab * ab + cb * cb - ac * ac) / (2 * ab * cb);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

// MediaPipe indices: shoulder, hip, knee, ankle.
const LEFT = [11, 23, 25, 27];
const RIGHT = [12, 24, 26, 28];

// aspect = video width / height; MediaPipe x and y are normalized separately, so x must be rescaled.
export function jointAngles(lm: Pt[], aspect = 1, minVisibility = 0.5): Frame | null {
  const vis = (ids: number[]) => ids.reduce((s, i) => s + (lm[i]?.visibility ?? 0), 0) / ids.length;
  const ids = vis(LEFT) >= vis(RIGHT) ? LEFT : RIGHT;
  if (vis(ids) < minVisibility) return null;
  const [s, h, k, a] = ids.map((i) => ({ x: lm[i].x * aspect, y: lm[i].y }));
  const hip = angle(s, h, k);
  const knee = angle(h, k, a);
  if (Number.isNaN(hip) || Number.isNaN(knee)) return null;
  return { hip, knee, hipY: h.y, kneeY: k.y, thigh: Math.hypot(h.x - k.x, h.y - k.y) };
}

export function evaluateRep(frames: Frame[], p: Params): Verdict {
  const issues: string[] = [];

  // Check 1: hip–knee coordination against the fitted line.
  const residuals = frames.map((f) => f.hip - (p.k * f.knee + p.b));
  const inBand = residuals.filter((r) => Math.abs(r) <= p.tol).length;
  if (inBand / frames.length < p.minPassRatio) {
    const mean = residuals.reduce((s, r) => s + r, 0) / residuals.length;
    issues.push(
      mean < 0
        ? "Badan terlalu membungkuk (good morning). Dada tegak, tekuk lutut bersamaan dengan panggul."
        : "Panggul kurang ditekuk. Dorong pinggul ke belakang saat turun.",
    );
  }

  // Check 2: depth at the lowest frame (image y grows downward), soft tolerance delta·thigh.
  const low = frames.reduce((m, f) => (f.hipY > m.hipY ? f : m));
  if (low.hipY < low.kneeY - p.delta * low.thigh) issues.push("Kurang dalam. Turunkan panggul sampai paha sejajar lantai.");

  return { ok: issues.length === 0, issues };
}

// Splits a stream of frames into reps: starts when the knee bends below `up`, ends when it straightens again.
// Reps whose deepest knee angle never passes `down` are treated as noise and dropped.
export class RepTracker {
  private frames: Frame[] = [];
  private up: number;
  private down: number;
  constructor(up = 160, down = 145) {
    this.up = up;
    this.down = down;
  }
  push(f: Frame): Frame[] | null {
    if (f.knee < this.up) {
      this.frames.push(f);
      return null;
    }
    const rep = this.frames;
    this.frames = [];
    return rep.length > 0 && Math.min(...rep.map((r) => r.knee)) < this.down ? rep : null;
  }
}
