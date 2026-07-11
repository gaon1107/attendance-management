"use client";
// 데모 화면 — 웹캠 연속 촬영(3장) → 판독 → 점수·얼굴박스 표시 + 시도 이력 + 기준값 슬라이더.
// 판정 = 판정 방식(평균/AND)을 장마다 적용해 "모든 장이 기준 이상"이어야 진짜 (한 장이라도 미달이면 위조 의심).
// 이력의 판정은 슬라이더·판정 방식을 움직이면 즉시 다시 계산된다(장별 점수 원본을 들고 있으므로).
import { useEffect, useRef, useState } from "react";
import { analyzeLiveness, type AnalyzeResult } from "./actions/liveness";

// 장별 점수 원본 — 기준값·판정 방식을 나중에 바꿔도 재판정할 수 있게 전부 보관
type HistoryFrame = { v1se: number; v2: number; tex?: number; texErr?: string };
type HistoryItem = {
  at: string;
  frames: HistoryFrame[]; // 연속 촬영 장별 점수 (1~3장)
  faceCount: number;
  brightness?: number; // 얼굴 영역 평균 밝기(0~255, 첫 장) — 저조도 기준선 캘리브레이션 근거용
  thumb: string; // 작은 미리보기(브라우저 안에서만, 서버 저장 없음)
  detectMs?: number;
  livenessMs?: number;
};

// 서버 응답의 장별 결과 → 화면·이력용 점수 목록
function resFrames(res: AnalyzeResult): HistoryFrame[] {
  return (res.frames ?? []).map((f) => ({
    v1se: f.models.find((m) => m.name === "V1SE")?.realProb ?? 0,
    v2: f.models.find((m) => m.name === "V2")?.realProb ?? 0,
    tex: f.texture?.score,
    texErr: f.textureError,
  }));
}

// 연속 촬영 장수·간격 — 각도 운으로 한 장만 통과하는 위조(구부린 오린 사진 등)를 막기 위해 전 장 통과를 요구한다
const FRAME_COUNT = 3;
const FRAME_GAP_MS = 300;

export function DemoClient() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);

  const [camError, setCamError] = useState("");
  const [busy, setBusy] = useState(false);
  // 시작 기본값 — 실측(2026-07-11)에서 오려낸 사진을 가장 잘 막은 조합으로 고정.
  //   기준값 80% / 판정방식 AND(둘 다 통과) / 얼굴크기 35%. 화면에서 슬라이더·토글로 언제든 바꿀 수 있다.
  const [threshold, setThreshold] = useState(0.8);
  // 판정 방식 — "avg"=두 모델 평균 / "and"=두 모델 모두 공통 기준 이상 / "perModel"=모델별 다른 기준(차등).
  // AND는 "둘 중 낮은 점수 ≥ 기준"과 같다. 차등은 저조도에 약한 모델 A와 강한 모델 B에 다른 기준을 준다.
  const [mode, setMode] = useState<"avg" | "and" | "perModel">("and");
  // 모델별 차등 기준(perModel 방식 전용) — 모델 A(V1SE)는 저조도에 약해 낮게, 모델 B(V2)는 강해 높게. 기본 A60/B85.
  const [thA, setThA] = useState(0.6);
  const [thB, setThB] = useState(0.85);
  // 얼굴 크기 기준(%) — 이 값 미만이면 판독을 진행하지 않음. 가이드 타원 크기도 이 값에 연동.
  const [minPercent, setMinPercent] = useState(35);
  // 밝기 기준(0~255) — 얼굴이 이 값보다 어두우면 위조 판정 대신 재촬영 안내. 0=꺼짐(기존 동작).
  // 초기엔 꺼짐 — 어두운 곳/밝은 곳 밝기 값을 보고 슬라이더로 기준선을 정한 뒤 확정한다(기준값 80% 때와 동일 절차).
  const [minBrightness, setMinBrightness] = useState(0);
  const [last, setLast] = useState<{ res: AnalyzeResult; snapshot: string } | null>(null);
  const [lastError, setLastError] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      } catch {
        setCamError("카메라를 열 수 없습니다. 브라우저 카메라 권한을 허용해 주세요.");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  function toBlobAsync(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  }

  async function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || busyRef.current) return;
    if (!video.videoWidth) {
      setLastError("카메라 영상을 준비하는 중입니다. 잠시 후 다시 눌러주세요.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setLastError("");

    // 판독 정확도를 위해 원본 해상도(최대 1280) 그대로, 낮은 압축으로 캡처
    const maxW = 1280;
    const scale = video.videoWidth > maxW ? maxW / video.videoWidth : 1;
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      busyRef.current = false;
      setBusy(false);
      return;
    }

    try {
      // 연속 3장 촬영 (0.3초 간격) — 각 장은 서버 액션 본문 한도 대비 850KB 이하로 재압축
      const blobs: Blob[] = [];
      let snapshot = "";
      for (let i = 0; i < FRAME_COUNT; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, FRAME_GAP_MS));
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (i === 0) snapshot = canvas.toDataURL("image/jpeg", 0.9);
        let blob = await toBlobAsync(canvas, 0.9);
        for (const q of [0.75, 0.6]) {
          if (blob && blob.size <= 850 * 1024) break;
          blob = await toBlobAsync(canvas, q);
        }
        if (!blob || blob.size > 900 * 1024) {
          setLastError(!blob ? "촬영에 실패했습니다. 다시 시도해 주세요." : "사진 용량이 계속 너무 큽니다. 조명을 밝게 하고 다시 시도해 주세요.");
          return;
        }
        blobs.push(blob);
      }

      const fd = new FormData();
      for (const b of blobs) fd.append("image", b, "frame.jpg");
      fd.append("minPercent", String(minPercent)); // 얼굴 크기 기준 — 미만이면 서버가 판독 없이 거절
      fd.append("minBrightness", String(minBrightness)); // 밝기 기준 — 미만이면 서버가 판독 없이 재촬영 안내(0=꺼짐)

      const res = await analyzeLiveness(fd);
      if (res.tooSmall) {
        // 얼굴이 기준보다 작음 — 판독 미진행. 사진+박스로 어느 크기였는지 보여준다.
        setLast({ res, snapshot });
        setLastError(res.message || "얼굴이 작습니다. 타원 안에 채워 다시 촬영해 주세요.");
        return;
      }
      if (res.tooDark) {
        // 얼굴이 기준보다 어두움 — 판독 미진행. 사진+박스로 어느 밝기였는지 보여준다.
        setLast({ res, snapshot });
        setLastError(res.message || "화면이 어둡습니다. 더 밝은 곳에서 다시 촬영해 주세요.");
        return;
      }
      if (res.ok && res.frames && res.frames.length > 0) {
        setLast({ res, snapshot });
        const frames = resFrames(res);
        // 이력용 작은 썸네일 — 얼굴 좌표(첫 장 기준)와 일치하도록 첫 장 스냅샷에서 축소.
        // 축소 실패해도 판독 결과·이력은 유지해야 하므로 실패 시 원본 스냅샷으로 대체한다.
        let thumb = snapshot;
        try {
          const thumbCanvas = document.createElement("canvas");
          const tw = 96;
          thumbCanvas.width = tw;
          thumbCanvas.height = Math.round((canvas.height / canvas.width) * tw);
          const thumbImg = new Image();
          const loaded = await new Promise<boolean>((resolve) => {
            thumbImg.onload = () => resolve(true);
            thumbImg.onerror = () => resolve(false);
            thumbImg.src = snapshot;
          });
          if (loaded) {
            thumbCanvas.getContext("2d")?.drawImage(thumbImg, 0, 0, thumbCanvas.width, thumbCanvas.height);
            thumb = thumbCanvas.toDataURL("image/jpeg", 0.7);
          }
        } catch {
          // 썸네일 축소 실패 — 원본 스냅샷 사용
        }
        setHistory((h) => [
          {
            at: new Date().toLocaleTimeString("ko-KR", { hour12: false }),
            frames,
            faceCount: res.faceCount ?? 1,
            brightness: res.brightness,
            thumb,
            detectMs: res.detectMs,
            livenessMs: res.livenessMs,
          },
          ...h,
        ]);
      } else {
        setLast(null);
        setLastError(res.message || "판독에 실패했습니다.");
      }
    } catch {
      setLastError("판독 요청 중 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // 판정은 "통과/미달(boolean)"로 계산한다 — 평균/AND는 공통 기준(threshold), 차등은 모델별 기준(thA/thB).
  //   ⚠️ 평균·AND 공식은 기존과 동일 → 같은 입력이면 판정도 100% 동일(회귀 없음). 차등만 신규 분기.
  const framePass = (f: HistoryFrame) =>
    mode === "perModel"
      ? f.v1se >= thA && f.v2 >= thB
      : mode === "and"
      ? Math.min(f.v1se, f.v2) >= threshold
      : (f.v1se + f.v2) / 2 >= threshold;
  // 촬영 1회(여러 장) 통과 = 모든 장이 통과 (기존 "전 장 통과" 규칙 유지)
  const capturePass = (frames: HistoryFrame[]) => frames.length > 0 && frames.every(framePass);
  const passText = (pass: boolean) => (pass ? "진짜" : "위조 의심");
  const passColor = (pass: boolean) => (pass ? "#16A34A" : "#DC2626");
  // 표시용 대표 점수(판정과 별개, 숫자 readout) — 평균은 두 모델 평균, 그 외(AND·차등)는 둘 중 낮은 값
  const effFrame = (f: HistoryFrame) => (mode === "avg" ? (f.v1se + f.v2) / 2 : Math.min(f.v1se, f.v2));
  const effMin = (frames: HistoryFrame[]) => Math.min(...frames.map(effFrame));
  const effLabel = mode === "avg" ? "평균(최저 장)" : "낮은쪽(최저 장)";

  const card: React.CSSProperties = { background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16 };
  const rect = last?.res.rect;
  const imgSize = last?.res.imageSize;
  // 최근 판독 결과의 장별 점수·유효점수 (판독 성공일 때만)
  const lastFrames = last?.res.ok ? resFrames(last.res) : [];
  const lastEff = lastFrames.length > 0 ? effMin(lastFrames) : null;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}>
        {/* 왼쪽: 라이브 카메라 */}
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>① 카메라</div>
          <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", background: "#111827", borderRadius: 10, overflow: "hidden" }}>
            <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
            {/* 얼굴 크기 가이드 타원 — 아래 "얼굴 크기 기준" 슬라이더와 연동(근태 webapp과 동일 규칙: 폭 = 기준 × 1.5) */}
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              <div
                style={{
                  position: "absolute", left: "50%", top: "48%", transform: "translate(-50%, -50%)",
                  width: `${Math.min(70, Math.round(minPercent * 1.5))}%`,
                  height: `${Math.min(88, Math.round(Math.min(70, Math.round(minPercent * 1.5)) * 1.73))}%`,
                  border: "3px dashed rgba(255,255,255,0.85)", borderRadius: "50%", boxShadow: "0 0 0 9999px rgba(0,0,0,0.18)",
                }}
              />
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 8, textAlign: "center", color: "#fff", fontSize: 13, fontWeight: 700, textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}>
                얼굴을 타원 안에 채워주세요
              </div>
            </div>
          </div>
          <canvas ref={canvasRef} style={{ display: "none" }} />
          {camError && <div style={{ marginTop: 10, fontSize: 13, color: "#B91C1C" }}>{camError}</div>}
          <button
            type="button"
            onClick={capture}
            disabled={busy}
            style={{ width: "100%", marginTop: 12, height: 52, border: "none", borderRadius: 10, background: busy ? "#93C5FD" : "#2563EB", color: "#fff", fontFamily: "inherit", fontSize: 16, fontWeight: 700, cursor: busy ? "default" : "pointer" }}
          >
            {busy ? "판독 중… (연속 3장)" : "📷 촬영해서 판독하기 (연속 3장)"}
          </button>
          {/* 얼굴 크기 기준 — 이 값 미만이면 판독을 진행하지 않음(근태 출퇴근과 동일). 타원 크기 연동 */}
          <div style={{ marginTop: 14, padding: "12px 14px", background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
              <span>얼굴 크기 기준 (미만이면 판독 안 함)</span>
              <span style={{ color: "#2563EB", fontVariantNumeric: "tabular-nums" }}>{minPercent}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={50}
              step={5}
              value={minPercent}
              onChange={(e) => setMinPercent(Number(e.target.value))}
              style={{ width: "100%" }}
            />
            <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>
              슬라이더를 움직이면 타원 크기도 함께 바뀝니다. 적당한 값을 찾으면 근태 [설정 → 얼굴 인식 기준 크기]에 같은 값을 넣으세요.
            </div>
          </div>

          {/* 밝기 기준 — 얼굴이 이 값보다 어두우면 위조 판정 대신 재촬영 안내(0=꺼짐). 저조도 오탐 방지 */}
          <div style={{ marginTop: 12, padding: "12px 14px", background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
              <span>밝기 기준 (미만이면 재촬영 안내)</span>
              <span style={{ color: "#2563EB", fontVariantNumeric: "tabular-nums" }}>{minBrightness === 0 ? "꺼짐" : minBrightness}</span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              value={minBrightness}
              onChange={(e) => setMinBrightness(Number(e.target.value))}
              style={{ width: "100%" }}
            />
            <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>
              0(꺼짐)이면 밝기 검사를 하지 않습니다(기존과 동일). 어두운 곳/밝은 곳에서 촬영해 결과의 <b>밝기</b> 값을 본 뒤,
              어두운 진짜가 걸리지 않을 만큼만 기준을 올리세요. (얼굴 영역 평균 밝기 0~255)
            </div>
          </div>

          <div style={{ marginTop: 12, fontSize: 13, color: "#6B7280", lineHeight: 1.6 }}>
            시험 방법: ① 본인 얼굴 → ② 휴대폰에 얼굴 사진 띄워 카메라에 비추기 → ③ A4 인쇄 사진 → ④ 모니터 화면 → ⑤ 동영상 재생
            → ⑥ 얼굴 모양으로 오려낸 인쇄 사진(구부려서도). 각각 여러 번 반복해 점수와 질감점수를 비교하세요.
          </div>
        </div>

        {/* 오른쪽: 최근 판독 결과 */}
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>② 판독 결과</div>
          {!last && !lastError && <div style={{ fontSize: 14, color: "#6B7280" }}>아직 판독한 사진이 없습니다. 왼쪽에서 촬영해 보세요.</div>}
          {lastError && (
            <div style={{ background: "#FEE2E2", borderRadius: 8, padding: "12px 14px", fontSize: 14, color: "#991B1B", marginBottom: 12 }}>{lastError}</div>
          )}
          {/* 얼굴이 기준보다 작아 판독 미진행 — 어느 크기로 찍혔는지 사진+주황 박스로 표시 */}
          {last && last.res.tooSmall && (
            <div style={{ position: "relative", width: "100%", borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={last.snapshot} alt="크기 미달 사진" style={{ width: "100%", display: "block" }} />
              {last.res.rect && last.res.imageSize && (
                <div
                  style={{
                    position: "absolute",
                    left: `${(last.res.rect.x / last.res.imageSize.width) * 100}%`,
                    top: `${(last.res.rect.y / last.res.imageSize.height) * 100}%`,
                    width: `${(last.res.rect.width / last.res.imageSize.width) * 100}%`,
                    height: `${(last.res.rect.height / last.res.imageSize.height) * 100}%`,
                    border: "3px solid #F59E0B",
                    borderRadius: 6,
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
                  }}
                />
              )}
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "rgba(180, 83, 9, 0.9)", color: "#fff", fontSize: 13, fontWeight: 700, padding: "8px 12px", textAlign: "center" }}>
                {/* 기준은 "촬영 당시 적용된 값"(서버 반환)을 표시 — 슬라이더를 나중에 움직여도 과거 결과가 안 바뀜 */}
                판독 안 함 — 얼굴 폭 {last.res.facePercent?.toFixed(0)}% &lt; 기준 {last.res.minPercent ?? minPercent}%
              </div>
            </div>
          )}
          {/* 얼굴이 기준보다 어두워 판독 미진행 — 어느 밝기로 찍혔는지 사진+파란 박스로 표시 */}
          {last && last.res.tooDark && (
            <div style={{ position: "relative", width: "100%", borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={last.snapshot} alt="저조도 사진" style={{ width: "100%", display: "block" }} />
              {last.res.rect && last.res.imageSize && (
                <div
                  style={{
                    position: "absolute",
                    left: `${(last.res.rect.x / last.res.imageSize.width) * 100}%`,
                    top: `${(last.res.rect.y / last.res.imageSize.height) * 100}%`,
                    width: `${(last.res.rect.width / last.res.imageSize.width) * 100}%`,
                    height: `${(last.res.rect.height / last.res.imageSize.height) * 100}%`,
                    border: "3px solid #3B82F6",
                    borderRadius: 6,
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
                  }}
                />
              )}
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "rgba(29, 78, 216, 0.9)", color: "#fff", fontSize: 13, fontWeight: 700, padding: "8px 12px", textAlign: "center" }}>
                판독 안 함 — 밝기 {last.res.brightness?.toFixed(1)} &lt; 기준 {last.res.minBrightness ?? minBrightness} · 더 밝은 곳에서 촬영하세요
              </div>
            </div>
          )}
          {last && last.res.ok && lastFrames.length > 0 && lastEff != null && (
            <>
              <div style={{ position: "relative", width: "100%", borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={last.snapshot} alt="판독한 사진" style={{ width: "100%", display: "block" }} />
                {rect && imgSize && (
                  <div
                    style={{
                      position: "absolute",
                      left: `${(rect.x / imgSize.width) * 100}%`,
                      top: `${(rect.y / imgSize.height) * 100}%`,
                      width: `${(rect.width / imgSize.width) * 100}%`,
                      height: `${(rect.height / imgSize.height) * 100}%`,
                      border: `3px solid ${passColor(capturePass(lastFrames))}`,
                      borderRadius: 6,
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
                    }}
                  />
                )}
              </div>

              {/* 판정: 판정 방식별로 모든 장이 통과해야 "진짜" (차등은 모델 A/B가 각자 기준을 넘어야 함) */}
              <div style={{ fontSize: 26, fontWeight: 800, color: passColor(capturePass(lastFrames)), marginBottom: 4 }}>
                {passText(capturePass(lastFrames))}{" "}
                <span style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>
                  · 진짜 확률 {(lastEff * 100).toFixed(1)}%
                  <span style={{ fontSize: 13, fontWeight: 400, color: "#6B7280" }}>
                    {" "}({lastFrames.length}장 중 최저 ·{" "}
                    {mode === "perModel" ? `차등 A≥${(thA * 100).toFixed(0)} B≥${(thB * 100).toFixed(0)}` : mode === "and" ? "둘 중 낮은 값" : "두 모델 평균"})
                  </span>
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 10 }}>
                얼굴 {last.res.faceCount}개
                {typeof last.res.facePercent === "number" && (
                  <>
                    {/* 근태 webapp과 동일 계산: 화면(4:3, 좌우 잘림)에서 실제 보이는 폭 기준. 기준은 촬영 당시 적용값 */}
                    {" "}· <b style={{ color: "#111827" }}>얼굴 폭 = 화면의 {last.res.facePercent.toFixed(0)}%</b>
                    <span> (기준 {last.res.minPercent ?? minPercent}% 이상만 판독)</span>
                  </>
                )}
                {typeof last.res.brightness === "number" && (
                  // 저조도 캘리브레이션용 — 어두운 진짜가 어느 밝기에서 오탐 났는지 값으로 확인
                  <> · <b style={{ color: "#111827" }}>밝기 {last.res.brightness.toFixed(1)}</b> (0~255)</>
                )}
                {" "}· 검출 {last.res.detectMs}ms · 판독 {last.res.livenessMs}ms ({lastFrames.length}장 합계)
              </div>

              {/* 장별 점수 표 — 기준 미달 점수는 빨간색. 질감점수는 관찰용(판정 미반영) */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #E5E7EB" }}>
                      {["장", "모델A (V1SE)", "모델B (V2)", "유효점수", "질감점수(관찰)"].map((h) => (
                        <th key={h} style={{ textAlign: "left", padding: "7px 10px", fontWeight: 700, color: "#6B7280", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lastFrames.map((f, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                        <td style={{ padding: "7px 10px", fontWeight: 700 }}>{i + 1}</td>
                        {/* 차등 모드에선 모델 A/B를 각자 기준으로 색칠 — 어느 모델이 자기 기준을 넘고 못 넘었는지 바로 보임 */}
                        <td style={{ padding: "7px 10px", fontVariantNumeric: "tabular-nums", color: mode === "perModel" ? passColor(f.v1se >= thA) : undefined, fontWeight: mode === "perModel" ? 700 : 400 }}>{(f.v1se * 100).toFixed(1)}%</td>
                        <td style={{ padding: "7px 10px", fontVariantNumeric: "tabular-nums", color: mode === "perModel" ? passColor(f.v2 >= thB) : undefined, fontWeight: mode === "perModel" ? 700 : 400 }}>{(f.v2 * 100).toFixed(1)}%</td>
                        <td style={{ padding: "7px 10px", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: passColor(framePass(f)) }}>
                          {(effFrame(f) * 100).toFixed(1)}%
                        </td>
                        <td style={{ padding: "7px 10px", fontVariantNumeric: "tabular-nums" }} title={f.texErr}>
                          {f.tex != null ? f.tex.toFixed(1) : f.texErr ? "분석불가" : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 6, lineHeight: 1.5 }}>
                연속 {lastFrames.length}장을 각각 판독 — <b>모든 장의 유효점수가 기준 이상이어야 진짜</b>입니다.
                질감점수는 인쇄 망점·화면 격자 같은 규칙 무늬의 세기(클수록 인쇄/화면 의심)로, 아직 판정에 반영하지 않는
                관찰용입니다. 진짜 얼굴과 오려낸 인쇄 사진으로 여러 번 실측해 값 차이를 확인해 주세요.
              </div>
            </>
          )}

          {/* 판정 방식 토글 — 평균(현 근태 방식) vs 둘 다 통과(AND). 이력·최근 결과가 즉시 재계산된다 */}
          <div style={{ marginTop: 16, borderTop: "1px solid #E5E7EB", paddingTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>판정 방식</div>
            <div style={{ display: "flex", gap: 8 }}>
              {(
                [
                  { key: "avg", label: "평균" },
                  { key: "and", label: "둘 다 통과 (AND)" },
                  { key: "perModel", label: "모델별 차등" },
                ] as const
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMode(m.key)}
                  style={{
                    flex: 1, height: 40, borderRadius: 8, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer",
                    border: `1px solid ${mode === m.key ? "#2563EB" : "#E5E7EB"}`,
                    background: mode === m.key ? "#EFF6FF" : "#fff",
                    color: mode === m.key ? "#1D4ED8" : "#374151",
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "#6B7280", marginTop: 6, lineHeight: 1.5 }}>
              평균 = 두 모델 평균으로 판정. 둘 다 통과 = <b>두 모델 모두</b> 공통 기준 이상(둘 중 낮은 값으로 판정).
              모델별 차등 = <b>모델 A·B에 다른 기준</b>(A는 저조도에 약해 낮게, B는 강해 높게). 연속 3장이므로 어느 방식이든 <b>모든 장이 통과</b>해야 합니다.
            </div>
          </div>

          {/* 기준값 슬라이더 — 평균/AND는 공통 기준 1개, 차등은 모델 A/B 기준 2개 */}
          {mode !== "perModel" ? (
            <div style={{ marginTop: 16, borderTop: "1px solid #E5E7EB", paddingTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                <span>판정 기준값 (이 값 미만이면 위조 의심)</span>
                <span style={{ color: "#2563EB", fontVariantNumeric: "tabular-nums" }}>{(threshold * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(threshold * 100)}
                onChange={(e) => setThreshold(Number(e.target.value) / 100)}
                style={{ width: "100%" }}
              />
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>
                슬라이더나 판정 방식을 바꾸면 아래 이력의 판정도 즉시 다시 계산됩니다.
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 16, borderTop: "1px solid #E5E7EB", paddingTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                <span>모델 A(V1SE) 기준 — 저조도에 약해 낮게</span>
                <span style={{ color: "#2563EB", fontVariantNumeric: "tabular-nums" }}>{(thA * 100).toFixed(0)}%</span>
              </div>
              <input type="range" min={0} max={100} value={Math.round(thA * 100)} onChange={(e) => setThA(Number(e.target.value) / 100)} style={{ width: "100%" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, margin: "12px 0 6px" }}>
                <span>모델 B(V2) 기준 — 저조도에 강해 높게</span>
                <span style={{ color: "#2563EB", fontVariantNumeric: "tabular-nums" }}>{(thB * 100).toFixed(0)}%</span>
              </div>
              <input type="range" min={0} max={100} value={Math.round(thB * 100)} onChange={(e) => setThB(Number(e.target.value) / 100)} style={{ width: "100%" }} />
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>
                모델 A·B가 <b>각자 기준을 모두 넘어야</b> 진짜입니다. 어두운 진짜는 통과시키되 위조(특히 어두운 위조)가 새지 않는지 실측하세요. 이력 판정도 즉시 재계산됩니다.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 시도 이력 */}
      <div style={{ ...card, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>③ 시도 이력 ({history.length}회)</div>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setHistory([])}
              style={{ height: 32, padding: "0 12px", border: "1px solid #E5E7EB", borderRadius: 6, background: "#fff", fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}
            >
              이력 지우기
            </button>
          )}
        </div>
        {/* 현재 적용 설정 — 이력 판정은 이 설정으로 즉시 재계산되므로, 표(캡처)가 어떤 설정 결과인지 한눈에 확인 */}
        <div style={{ fontSize: 12, color: "#374151", background: "#F3F4F6", borderRadius: 8, padding: "8px 12px", marginBottom: 10, lineHeight: 1.6 }}>
          <b>현재 적용 설정</b> · 판정방식{" "}
          <b style={{ color: "#1D4ED8" }}>
            {mode === "perModel" ? "모델별 차등" : mode === "and" ? "둘 다 통과(AND)" : "평균"}
          </b>{" "}
          ·{" "}
          {mode === "perModel" ? (
            <>기준 <b>모델A≥{(thA * 100).toFixed(0)}% · 모델B≥{(thB * 100).toFixed(0)}%</b></>
          ) : (
            <>기준값 <b>{(threshold * 100).toFixed(0)}%</b></>
          )}{" "}
          · 얼굴크기 <b>{minPercent}%</b> · 밝기기준 <b>{minBrightness === 0 ? "꺼짐" : minBrightness}</b>
          <span style={{ color: "#6B7280" }}> (설정을 바꾸면 아래 판정이 즉시 재계산됩니다)</span>
        </div>
        {history.length === 0 ? (
          <div style={{ fontSize: 14, color: "#6B7280" }}>촬영할 때마다 여기에 쌓입니다. (브라우저 안에서만 — 새로고침하면 사라짐)</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720, fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #E5E7EB" }}>
                  {/* 모델A/B는 여러 장 중 최저값 — 판정이 "모든 장 통과"이므로 가장 나쁜 장이 결과를 정한다 */}
                  {["사진", "시각", "모델A(최저)", "모델B(최저)", effLabel, "질감(최대)", "밝기", "판정", "속도"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "9px 12px", fontWeight: 700, color: "#6B7280", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => {
                  const minA = Math.min(...h.frames.map((f) => f.v1se));
                  const minB = Math.min(...h.frames.map((f) => f.v2));
                  const texes = h.frames.map((f) => f.tex).filter((t): t is number => t != null);
                  const eff = effMin(h.frames);
                  const pass = capturePass(h.frames);
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ padding: "8px 12px" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={h.thumb} alt="" style={{ width: 64, borderRadius: 4, display: "block" }} />
                      </td>
                      <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{h.at}</td>
                      <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums" }}>{(minA * 100).toFixed(1)}%</td>
                      <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums" }}>{(minB * 100).toFixed(1)}%</td>
                      <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{(eff * 100).toFixed(1)}%</td>
                      <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums" }}>{texes.length > 0 ? Math.max(...texes).toFixed(1) : "—"}</td>
                      <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums" }}>{h.brightness != null ? h.brightness.toFixed(1) : "—"}</td>
                      <td style={{ padding: "8px 12px", fontWeight: 700, color: passColor(pass), whiteSpace: "nowrap" }}>{passText(pass)}</td>
                      <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums", color: "#6B7280", whiteSpace: "nowrap" }}>
                        {h.detectMs != null && h.livenessMs != null ? `${h.detectMs}+${h.livenessMs}ms` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
