"use client";

import { useEffect, useRef, useState } from "react";
import { DrawingUtils, FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import params from "@/lib/waras_params.json";
import { evaluateRep, jointAngles, RepTracker, type Frame, type Verdict } from "@/lib/squat";

// WASM version must match the installed @mediapipe/tasks-vision version.
const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

async function createPose() {
  const vision = await FilesetResolver.forVisionTasks(WASM);
  const make = (delegate: "GPU" | "CPU") =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
    });
  try {
    return await make("GPU");
  } catch {
    return make("CPU"); // some phones/browsers have no usable WebGL
  }
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopRef = useRef<() => void>(undefined);
  const [status, setStatus] = useState<"idle" | "loading" | "running" | "error">("idle");
  const [error, setError] = useState("");
  const [live, setLive] = useState<Frame | null>(null);
  const [reps, setReps] = useState({ total: 0, good: 0 });
  const [last, setLast] = useState<Verdict | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  async function start() {
    setStatus("loading");
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      stopRef.current = () => stream.getTracks().forEach((t) => t.stop());
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      const pose = await createPose();
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      const draw = new DrawingUtils(ctx);
      const tracker = new RepTracker();
      let raf = 0;
      let lastTime = -1;

      const loop = () => {
        raf = requestAnimationFrame(loop);
        if (video.currentTime === lastTime || video.videoWidth === 0) return;
        lastTime = video.currentTime;
        if (canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const lm = pose.detectForVideo(video, performance.now()).landmarks[0];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!lm) return setLive(null);
        draw.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: "#22c55e", lineWidth: 4 });
        draw.drawLandmarks(lm, { color: "#ffffff", radius: 3 });
        const f = jointAngles(lm, video.videoWidth / video.videoHeight);
        setLive(f);
        const rep = f && tracker.push(f);
        if (rep) {
          const v = evaluateRep(rep, params);
          setLast(v);
          setReps((r) => ({ total: r.total + 1, good: r.good + (v.ok ? 1 : 0) }));
        }
      };
      loop();

      stopRef.current = () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        pose.close();
      };
      setStatus("running");
    } catch (e) {
      stopRef.current?.();
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function stop() {
    stopRef.current?.();
    stopRef.current = undefined;
    setStatus("idle");
    setLive(null);
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">WARAS</h1>
        <p className="text-sm opacity-70">Wawasan Analisis Raga dan Sikap: korektor squat real-time</p>
      </header>

      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
          {/* Mirrored like a selfie; angles are unaffected by the flip. */}
          <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full -scale-x-100 object-contain" />
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full -scale-x-100 object-contain" />
          {status !== "running" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
              <p className="max-w-sm text-sm opacity-80">
                Taruh kamera setinggi pinggang, berdiri <b>menyamping</b> 2–3 m dari kamera, seluruh badan dari bahu
                sampai pergelangan kaki harus terlihat.
              </p>
              <button
                onClick={start}
                disabled={status === "loading"}
                className="rounded-lg bg-green-600 px-5 py-2.5 font-semibold text-white hover:bg-green-500 disabled:opacity-60"
              >
                {status === "loading" ? "Memuat model…" : "Mulai kamera"}
              </button>
              {status === "error" && <p className="text-sm text-red-400">Gagal: {error}</p>}
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Repetisi" value={reps.total} />
            <Stat label="Benar" value={reps.good} />
            <Stat label="Sudut panggul" value={live ? `${live.hip.toFixed(0)}°` : "–"} />
            <Stat label="Sudut lutut" value={live ? `${live.knee.toFixed(0)}°` : "–"} />
          </div>

          <div aria-live="polite" className="rounded-xl border border-current/15 p-4">
            <p className="mb-1 text-xs uppercase opacity-60">Repetisi terakhir</p>
            {!last && <p className="text-sm opacity-70">Lakukan satu squat penuh (turun lalu berdiri).</p>}
            {last?.ok && <p className="font-semibold text-green-600">Bagus! Squat standar.</p>}
            {last && !last.ok && (
              <ul className="list-disc space-y-1 pl-4 text-sm text-amber-600">
                {last.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            )}
          </div>

          {status === "running" && (
            <button onClick={stop} className="rounded-lg border border-current/20 px-4 py-2 text-sm">
              Berhenti
            </button>
          )}
          <p className="text-xs opacity-60">
            Video diproses di perangkatmu dan tidak dikirim ke server. Metode: Chen et al. (2026), Computers 15(5):293.
          </p>
        </aside>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-current/15 p-3">
      <p className="text-xs opacity-60">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
