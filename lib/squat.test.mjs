// Run: node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { angle, evaluateRep, jointAngles, RepTracker } from "./squat.ts";

const P = { k: 0.9525, b: 4.1593, tol: 15, delta: 0.15, minPassRatio: 0.9 };

// Synthetic rep: knee 175 -> minKnee -> 175; hipFn maps knee to hip angle; bottomGap = (kneeY - hipY)/thigh at the bottom.
function rep(minKnee, hipFn, bottomGap) {
  const out = [];
  for (let i = 0; i <= 40; i++) {
    const t = Math.sin((Math.PI * i) / 40); // 0 -> 1 -> 0
    const knee = 175 - (175 - minKnee) * t;
    out.push({ hip: hipFn(knee), knee, hipY: 0.5 + 0.2 * t - bottomGap * 0.2 * t, kneeY: 0.7, thigh: 0.2 });
  }
  return out;
}
const good = (k) => P.k * k + P.b;

test("angle", () => {
  assert.equal(Math.round(angle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })), 90);
  assert.equal(Math.round(angle({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })), 180);
});

test("jointAngles picks visible side and rejects low visibility", () => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  Object.assign(lm[12], { x: 0.5, y: 0.2, visibility: 1 }); // shoulder
  Object.assign(lm[24], { x: 0.5, y: 0.5, visibility: 1 }); // hip
  Object.assign(lm[26], { x: 0.5, y: 0.7, visibility: 1 }); // knee
  Object.assign(lm[28], { x: 0.5, y: 0.9, visibility: 1 }); // ankle
  const f = jointAngles(lm);
  assert.equal(Math.round(f.hip), 180);
  assert.equal(Math.round(f.knee), 180);
  assert.equal(jointAngles(lm.map((p) => ({ ...p, visibility: 0.1 }))), null);
});

test("standard squat passes", () => {
  assert.deepEqual(evaluateRep(rep(85, good, 0), P), { ok: true, issues: [] });
});

test("shallow squat fails depth only", () => {
  const v = evaluateRep(rep(130, good, 0.6), P);
  assert.equal(v.ok, false);
  assert.equal(v.issues.length, 1);
  assert.match(v.issues[0], /Kurang dalam/);
});

test("good-morning squat fails coordination", () => {
  const v = evaluateRep(rep(85, (k) => good(k) - 40 * ((175 - k) / 90), 0), P);
  assert.equal(v.ok, false);
  assert.match(v.issues[0], /membungkuk/);
});

test("RepTracker emits one rep per down-up cycle and ignores small bends", () => {
  const t = new RepTracker();
  const stand = { hip: 175, knee: 175, hipY: 0.5, kneeY: 0.7, thigh: 0.2 };
  const emitted = [...rep(85, good, 0), stand, ...rep(155, good, 0), stand].map((f) => t.push(f)).filter(Boolean);
  assert.equal(emitted.length, 1);
});
