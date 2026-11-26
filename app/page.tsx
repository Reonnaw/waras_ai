"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DrawingUtils, FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { Camera, CameraOff, FlipHorizontal2, RotateCcw, Volume2, VolumeX } from "lucide-react";
import params from "@/lib/waras_params.json";
import { evaluateRep, jointAngles, RepTracker, type Frame, type Verdict } from "@/lib/squat";
import { WarasCatMascot, WarasLogo, type MascotStatus } from "@/components/WarasCatMascot";
import { ThemeToggle } from "@/components/ThemeToggle";

// WASM version must match the installed @mediapipe/tasks-vision version.
const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// Thigh parallel to the floor ≈ 90° at the knee; the matching hip angle comes from the fitted hip–knee line.
const KNEE_TARGET = 90;
const HIP_TARGET = Math.round(params.k * KNEE_TARGET + params.b);

// Live phase from the knee angle. 160° matches RepTracker's default `up`; "Dasar" is within 10° of parallel.
type Phase = "Berdiri" | "Gerak" | "Dasar";
const PHASES: Phase[] = ["Berdiri", "Gerak", "Dasar"];
const phaseOf = (knee: number): Phase => (knee >= 160 ? "Berdiri" : knee <= KNEE_TARGET + 10 ? "Dasar" : "Gerak");

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

// Square-wave blips you can hear from 3 m away: rising pair = valid rep, one low buzz = needs correction.
function playCue(ac: AudioContext, ok: boolean) {
  (ok ? [660, 990] : [220]).forEach((freq, i) => {
    const t = ac.currentTime + i * 0.12;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (ok ? 0.1 : 0.3));
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  });
}

const LABEL = "font-mono text-[11px] uppercase tracking-wider text-mute";

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopRef = useRef<() => void>(undefined);
  // Refs so the frame loop (created once in start) always sees the latest tracker and audio setting.
  const trackerRef = useRef(new RepTracker());
  const cueRef = useRef<AudioContext | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "running" | "error">("idle");
  const [error, setError] = useState("");
  const [live, setLive] = useState<Frame | null>(null);
  const [history, setHistory] = useState<boolean[]>([]); // one entry per rep: passed or not
  const [last, setLast] = useState<Verdict | null>(null);
  const [mirror, setMirror] = useState(true);
  const [audio, setAudio] = useState(false);

  useEffect(
    () => () => {
      stopRef.current?.();
      cueRef.current?.close();
    },
    [],
  );

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
        draw.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: "#22C55E", lineWidth: 3 });
        draw.drawLandmarks(lm, { color: "#EDEDED", fillColor: "#0A0A0A", lineWidth: 2, radius: 3 });
        const f = jointAngles(lm, video.videoWidth / video.videoHeight);
        setLive(f);
        const rep = f && trackerRef.current.push(f);
        if (rep) {
          const v = evaluateRep(rep, params);
          if (cueRef.current) playCue(cueRef.current, v.ok);
          setLast(v);
          setHistory((h) => [...h, v.ok]);
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

  function toggleAudio() {
    if (cueRef.current) {
      cueRef.current.close();
      cueRef.current = null;
      setAudio(false);
    } else {
      // Created inside the click so browsers allow it to play.
      cueRef.current = new AudioContext();
      playCue(cueRef.current, true);
      setAudio(true);
    }
  }

  function reset() {
    trackerRef.current = new RepTracker();
    setHistory([]);
    setLast(null);
  }

  const running = status === "running";
  const total = history.length;
  const good = history.filter(Boolean).length;
  const mood: MascotStatus = !last ? "idle" : last.ok ? "good" : "warning";
  const flip = mirror ? "-scale-x-100" : "";

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col lg:border-x lg:border-line">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <WarasLogo size={24} />
          <h1 className="text-[15px] font-extrabold tracking-[-0.02em]">WARAS</h1>
          <span className="text-mute" aria-hidden>
            /
          </span>
          <p className="truncate text-[13px] tracking-[-0.01em] text-mute">
            Wawasan Analisis Raga dan Sikap<span className="hidden md:inline">: korektor squat real-time</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <p className={`${LABEL} hidden h-8 items-center gap-2 border border-line px-2 sm:flex`}>
            <span className="size-1.5 bg-ok" aria-hidden />
            On-device vision • No server upload
          </p>
          <ThemeToggle />
        </div>
      </header>

      <main className="grid flex-1 content-start lg:grid-cols-[minmax(0,68fr)_minmax(0,32fr)] lg:grid-rows-[auto_1fr] lg:content-stretch">
        {/* Optical viewport */}
        <section aria-label="Kamera" className="p-3 sm:p-5">
          <div className="relative">
            <Reticle />
            <div className="relative aspect-[4/3] w-full border border-line md:aspect-video">
              {/* The screen stays dark in both themes so the video and overlay read like a monitor. */}
              <div data-theme="dark" className="absolute inset-0 overflow-hidden bg-well text-ink">
                {/* Mirrored like a selfie by default; angles are unaffected by the flip. */}
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className={`absolute inset-0 h-full w-full object-contain ${flip}`}
                />
                <canvas ref={canvasRef} className={`absolute inset-0 h-full w-full object-contain ${flip}`} />

                {running && (
                  <p className={`${LABEL} absolute left-3 top-3 flex items-center gap-2 bg-canvas/80 px-2 py-1`}>
                    <span className={`size-1.5 ${live ? "bg-ok" : "bg-line-strong"}`} aria-hidden />
                    <span className={live ? "text-ink" : ""}>{live ? "Pose terkunci" : "Mencari pose…"}</span>
                  </p>
                )}
                {running && live && <PhaseStrip phase={phaseOf(live.knee)} />}

                {!running && (
                  <SetupOverlay loading={status === "loading"} error={status === "error" ? error : ""} onStart={start} />
                )}
              </div>
            </div>

            {/* Control bar, flush under the viewport */}
            <div className="grid auto-rows-[44px] grid-cols-2 gap-px border-x border-b border-line bg-line sm:grid-cols-4">
              <ControlButton
                onClick={running ? stop : start}
                disabled={status === "loading"}
                icon={running ? <CameraOff size={14} strokeWidth={1.5} /> : <Camera size={14} strokeWidth={1.5} />}
              >
                {running ? "Hentikan kamera" : status === "loading" ? "Memuat…" : "Mulai kamera"}
              </ControlButton>
              <ControlButton
                onClick={() => setMirror((m) => !m)}
                pressed={mirror}
                icon={<FlipHorizontal2 size={14} strokeWidth={1.5} />}
              >
                Mirror
              </ControlButton>
              <ControlButton
                onClick={toggleAudio}
                pressed={audio}
                icon={audio ? <Volume2 size={14} strokeWidth={1.5} /> : <VolumeX size={14} strokeWidth={1.5} />}
              >
                Audio cue
              </ControlButton>
              <ControlButton
                onClick={reset}
                disabled={total === 0}
                icon={<RotateCcw size={14} strokeWidth={1.5} />}
              >
                Reset
              </ControlButton>
            </div>
          </div>
        </section>

        {/* Telemetry column */}
        {/* Phones: camera, telemetry, then method. Desktop: method sits under the camera, telemetry spans both rows. */}
        <aside
          aria-label="Telemetri"
          className="flex flex-col bg-panel lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-l lg:border-line"
        >
          <div className="grid grid-cols-2">
            <Metric label="Repetisi" className="border-b border-r">
              <BigNumber>{total}</BigNumber>
            </Metric>
            <Metric label="Benar" className="border-b">
              <BigNumber className="text-ok">{good}</BigNumber>
            </Metric>
            <Metric label="Sudut panggul" className="border-b border-r">
              <Angle value={live?.hip} target={HIP_TARGET} />
            </Metric>
            <Metric label="Sudut lutut" className="border-b">
              <Angle value={live?.knee} target={KNEE_TARGET} />
            </Metric>
          </div>

          <History history={history} />

          <section
            aria-live="polite"
            aria-label="Repetisi terakhir"
            className={`m-4 border-l-[3px] bg-canvas p-4 ${
              mood === "good" ? "border-ok" : mood === "warning" ? "border-warn" : "border-line-strong"
            }`}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className={LABEL}>Repetisi terakhir</h2>
              {last && (
                <span className="font-mono text-[11px] uppercase tracking-wider tabular-nums">
                  <span className="text-mute">#{String(total).padStart(2, "0")} · </span>
                  <span className={`font-semibold ${last.ok ? "text-ok" : "text-warn"}`}>{last.ok ? "Valid" : "Perbaiki"}</span>
                </span>
              )}
            </div>
            <div className="flex items-start gap-4">
              <WarasCatMascot status={mood} size={64} />
              <div className="min-w-0 text-sm leading-relaxed">
                {!last && <p className="text-mute">Lakukan satu squat penuh (turun lalu berdiri).</p>}
                {last?.ok && <p className="font-semibold text-ok">Bagus! Squat standar.</p>}
                {last && !last.ok && (
                  <ol className="space-y-2">
                    {last.issues.map((issue, i) => (
                      <li key={issue} className="flex gap-2">
                        <span className="font-mono text-[11px] leading-6 text-warn tabular-nums">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span>{issue}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </section>

          <footer className="mt-auto border-t border-line px-4 py-3 font-mono text-[11px] leading-relaxed text-mute">
            Video diproses di perangkatmu dan tidak dikirim ke server. Metode: Yao et al. (2026), Computers 15(5):293.
          </footer>
        </aside>

        <MethodPanel />
      </main>
    </div>
  );
}

function Reticle() {
  const tick = "pointer-events-none absolute size-3 border-ink";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
      <span className={`${tick} -left-[5px] -top-[5px] border-l border-t`} />
      <span className={`${tick} -right-[5px] -top-[5px] border-r border-t`} />
      <span className={`${tick} -bottom-[5px] -left-[5px] border-b border-l`} />
      <span className={`${tick} -bottom-[5px] -right-[5px] border-b border-r`} />
    </div>
  );
}

const STEPS = [
  "Taruh kamera setinggi pinggang",
  "Berdiri menyamping 2–3 m dari kamera",
  "Seluruh badan dari bahu sampai pergelangan kaki terlihat",
];

function SetupOverlay({ loading, error, onStart }: { loading: boolean; error: string; onStart: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-10 p-5">
      <AlignmentGuide />
      <div className="flex max-w-xs flex-col gap-5">
        <div>
          <p className={`${LABEL} mb-3`}>Persiapan</p>
          <ol className="space-y-2.5">
            {STEPS.map((s, i) => (
              <li key={s} className="flex gap-3 text-[13px] leading-snug sm:text-sm">
                <span className="font-mono text-[11px] leading-5 text-mute tabular-nums">
                  {String(i + 1).padStart(2, "0")}.
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
        <button
          onClick={onStart}
          disabled={loading}
          className="self-start bg-ok px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-wider text-black hover:bg-ink disabled:cursor-wait disabled:opacity-60"
        >
          {loading ? "Memuat model…" : "Mulai kamera"}
        </button>
        {error && (
          <p role="alert" className="border-l-[3px] border-warn pl-3 font-mono text-[11px] text-warn">
            Gagal: {error}
          </p>
        )}
      </div>
    </div>
  );
}

// Side view: camera at waist height on the left, athlete in profile 2–3 m away, tracked joints marked.
function AlignmentGuide() {
  const joints: [number, number][] = [
    [150, 44],
    [150, 82],
    [150, 106],
    [150, 128],
  ];
  return (
    <svg
      viewBox="0 0 200 150"
      className="hidden w-56 shrink-0 md:block lg:w-64"
      fill="none"
      stroke="#737373"
      strokeWidth={1}
      shapeRendering="crispEdges"
      aria-label="Panduan posisi: kamera setinggi pinggang, badan menyamping"
      role="img"
    >
      <line x1="6" y1="130" x2="194" y2="130" stroke="#404040" />
      {/* camera + tripod */}
      <rect x="14" y="76" width="16" height="10" stroke="#EDEDED" />
      <line x1="30" y1="81" x2="34" y2="81" stroke="#EDEDED" />
      <line x1="22" y1="86" x2="22" y2="130" />
      {/* line of sight at waist height */}
      <line x1="36" y1="81" x2="140" y2="81" strokeDasharray="3 3" />
      {/* distance */}
      <line x1="22" y1="140" x2="150" y2="140" />
      <line x1="22" y1="136" x2="22" y2="144" />
      <line x1="150" y1="136" x2="150" y2="144" />
      <text x="86" y="137" textAnchor="middle" fill="#737373" stroke="none" fontSize="8" className="font-mono">
        2–3 M
      </text>
      {/* athlete in profile */}
      <circle cx="150" cy="34" r="7" stroke="#EDEDED" shapeRendering="auto" />
      <polyline points="150,44 150,82 150,106 150,128 140,128" stroke="#EDEDED" />
      <polyline points="150,46 150,66 146,72" stroke="#EDEDED" />
      {joints.map(([x, y]) => (
        <rect key={y} x={x - 2} y={y - 2} width="4" height="4" fill="#22C55E" stroke="none" />
      ))}
      {/* visible span: shoulder → ankle */}
      <line x1="172" y1="44" x2="172" y2="128" stroke="#22C55E" />
      <line x1="168" y1="44" x2="176" y2="44" stroke="#22C55E" />
      <line x1="168" y1="128" x2="176" y2="128" stroke="#22C55E" />
    </svg>
  );
}

function ControlButton({
  onClick,
  disabled,
  pressed,
  icon,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className="flex min-w-0 items-center justify-center gap-2 bg-panel px-2 font-mono text-[11px] uppercase tracking-wider text-ink hover:bg-line disabled:cursor-not-allowed disabled:text-mute disabled:hover:bg-panel"
    >
      {pressed !== undefined && (
        <span className={`size-1.5 shrink-0 ${pressed ? "bg-ok" : "bg-line-strong"}`} aria-hidden />
      )}
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

function Metric({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`flex flex-col gap-3 border-line p-4 ${className}`}>
      <h2 className={LABEL}>{label}</h2>
      {children}
    </div>
  );
}

function BigNumber({ className = "", children }: { className?: string; children: ReactNode }) {
  return <p className={`font-mono text-5xl font-bold leading-none tabular-nums tracking-tight ${className}`}>{children}</p>;
}

// Gauge runs from 180° (standing, empty) to 40° (very deep, full); green once the target depth is reached.
const pct = (deg: number) => Math.min(100, Math.max(0, ((180 - deg) / 140) * 100));

function Angle({ value, target }: { value?: number; target: number }) {
  const has = value !== undefined;
  const reached = has && value <= target;
  return (
    <>
      <BigNumber className={reached ? "text-ok" : ""}>{has ? `${value.toFixed(0)}°` : "—"}</BigNumber>
      <div>
        <div className="relative h-1 bg-line">
          {has && (
            <div className={`absolute inset-y-0 left-0 ${reached ? "bg-ok" : "bg-ink"}`} style={{ width: `${pct(value)}%` }} />
          )}
          <div className="absolute -inset-y-1 w-px bg-mute" style={{ left: `${pct(target)}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[10px] uppercase tracking-wider text-mute tabular-nums">
          <span>180°</span>
          <span>Target {target}°</span>
        </div>
      </div>
    </>
  );
}

const HISTORY_SLOTS = 12;

// Last 12 reps as a strip of cells, oldest on the left.
function History({ history }: { history: boolean[] }) {
  const offset = Math.max(0, history.length - HISTORY_SLOTS);
  const recent = history.slice(offset);
  const rate = history.length ? Math.round((history.filter(Boolean).length / history.length) * 100) : null;
  return (
    <div className="border-b border-line p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className={LABEL}>Riwayat {HISTORY_SLOTS} rep</h2>
        <span className="font-mono text-[11px] uppercase tracking-wider text-mute tabular-nums">
          Akurasi <span className="text-ink">{rate === null ? "—" : `${rate}%`}</span>
        </span>
      </div>
      <ol className="grid grid-cols-12 gap-1">
        {Array.from({ length: HISTORY_SLOTS }, (_, i) => {
          const ok = recent[i];
          return (
            <li
              key={i}
              className={`h-3 ${ok === undefined ? "border border-line" : ok ? "bg-ok" : "bg-warn"}`}
              aria-hidden={ok === undefined}
              aria-label={ok === undefined ? undefined : `Rep ${offset + i + 1}: ${ok ? "valid" : "perbaiki"}`}
            />
          );
        })}
      </ol>
    </div>
  );
}

function PhaseStrip({ phase }: { phase: Phase }) {
  return (
    <ol aria-label="Fase squat" className="absolute right-3 top-3 flex border border-line bg-canvas/80">
      {PHASES.map((p) => {
        const on = p === phase;
        return (
          <li
            key={p}
            aria-current={on ? "step" : undefined}
            className={`border-line px-2 py-1 font-mono text-[11px] uppercase tracking-wider not-first:border-l ${
              on ? (p === "Dasar" ? "bg-ok text-black" : "bg-ink text-canvas") : "text-mute"
            }`}
          >
            {p}
          </li>
        );
      })}
    </ol>
  );
}

const fmt = (n: number, digits: number) => n.toFixed(digits).replace(".", ",");

// What the app actually checks, with the live fitted numbers, so the verdict is never a black box.
const RULES = [
  {
    title: "Koordinasi",
    body: "Sudut panggul harus mengikuti sudut lutut sepanjang gerakan.",
    formula: `|panggul − (${fmt(params.k, 2)}·lutut + ${fmt(params.b, 2)})| ≤ ${fmt(params.tol, 1)}° · ≥${Math.round(params.minPassRatio * 100)}% frame`,
  },
  {
    title: "Kedalaman",
    body: "Di titik terendah, panggul tidak boleh lebih tinggi dari lutut.",
    formula: `toleransi ${fmt(params.delta * 100, 1)}% panjang paha`,
  },
  {
    title: "Hitungan",
    body: "Satu repetisi dihitung saat lutut menekuk lalu lurus kembali.",
    formula: "mulai < 160° · wajib < 145° · selesai ≥ 160°",
  },
];

function MethodPanel() {
  return (
    <section aria-label="Cara penilaian" className="border-t border-line px-3 py-5 sm:px-5 lg:col-start-1 lg:border-t-0 lg:pt-0">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 className={LABEL}>Cara penilaian</h2>
        {/* Leave-one-subject-out result on the paper's Zenodo data; see README "Akurasi". */}
        <p className="font-mono text-[11px] uppercase tracking-wider text-mute tabular-nums">
          Akurasi uji <span className="text-ink">91,15%</span> · LOSO
        </p>
      </div>
      <ol className="grid gap-px border border-line bg-line sm:grid-cols-3">
        {RULES.map((r, i) => (
          <li key={r.title} className="flex flex-col gap-2 bg-panel p-4">
            <p className="flex items-baseline gap-2">
              <span className="font-mono text-[11px] text-mute tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-sm font-semibold tracking-[-0.01em]">{r.title}</span>
            </p>
            <p className="text-[13px] leading-relaxed text-mute">{r.body}</p>
            <p className="mt-auto border-t border-line pt-2 font-mono text-[11px] text-ink tabular-nums">{r.formula}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
