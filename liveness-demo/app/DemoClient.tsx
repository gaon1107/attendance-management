"use client";
// 데모 화면 — 웹캠 촬영 → 판독 → 점수·얼굴박스 표시 + 시도 이력 + 기준값 슬라이더.
// 이력의 판정은 슬라이더를 움직이면 즉시 다시 계산된다(점수 원본을 들고 있으므로).
import { useEffect, useRef, useState } from "react";
import { analyzeLiveness, type AnalyzeResult } from "./actions/liveness";

type HistoryItem = {
  at: string;
  v1se: number;
  v2: number;
  avg: number;
  faceCount: number;
  thumb: string; // 작은 미리보기(브라우저 안에서만, 서버 저장 없음)
  detectMs?: number;
  livenessMs?: number;
};

export function DemoClient() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);

  const [camError, setCamError] = useState("");
  const [busy, setBusy] = useState(false);
  const [threshold, setThreshold] = useState(0.5);
  // 판정 방식 — "avg"=두 모델 평균으로 판정(현 근태 방식) / "and"=두 모델 모두 기준 이상이어야 진짜.
  // AND는 "둘 중 낮은 점수 ≥ 기준"과 같으므로, 유효점수를 min으로 바꾸면 판정·이력 재계산이 그대로 된다.
  const [mode, setMode] = useState<"avg" | "and">("avg");
  // 얼굴 크기 기준(%) — 이 값 미만이면 판독을 진행하지 않음. 가이드 타원 크기도 이 값에 연동.
  const [minPercent, setMinPercent] = useState(30);
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
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const snapshot = canvas.toDataURL("image/jpeg", 0.9);

    // 서버 액션 본문 한도(1MB) 대비: 크면 품질을 낮춰 재압축 (저조도 노이즈·큰 해상도 카메라 대비)
    let blob = await toBlobAsync(canvas, 0.9);
    for (const q of [0.75, 0.6]) {
      if (blob && blob.size <= 850 * 1024) break;
      blob = await toBlobAsync(canvas, q);
    }
    {
      {
        if (!blob || blob.size > 900 * 1024) {
          busyRef.current = false;
          setBusy(false);
          setLastError(!blob ? "촬영에 실패했습니다. 다시 시도해 주세요." : "사진 용량이 계속 너무 큽니다. 조명을 밝게 하고 다시 시도해 주세요.");
          return;
        }
        try {
          const fd = new FormData();
          fd.append("image", blob, "frame.jpg");
          fd.append("minPercent", String(minPercent)); // 얼굴 크기 기준 — 미만이면 서버가 판독 없이 거절
          const res = await analyzeLiveness(fd);
          if (res.tooSmall) {
            // 얼굴이 기준보다 작음 — 판독 미진행. 사진+박스로 어느 크기였는지 보여준다.
            setLast({ res, snapshot });
            setLastError(res.message || "얼굴이 작습니다. 타원 안에 채워 다시 촬영해 주세요.");
            return;
          }
          if (res.ok && res.models && typeof res.realScore === "number") {
            setLast({ res, snapshot });
            const v1se = res.models.find((m) => m.name === "V1SE")?.realProb ?? 0;
            const v2 = res.models.find((m) => m.name === "V2")?.realProb ?? 0;
            // 이력용 작은 썸네일
            const thumbCanvas = document.createElement("canvas");
            const tw = 96;
            thumbCanvas.width = tw;
            thumbCanvas.height = Math.round((canvas.height / canvas.width) * tw);
            thumbCanvas.getContext("2d")?.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
            setHistory((h) => [
              {
                at: new Date().toLocaleTimeString("ko-KR", { hour12: false }),
                v1se,
                v2,
                avg: res.realScore!,
                faceCount: res.faceCount ?? 1,
                thumb: thumbCanvas.toDataURL("image/jpeg", 0.7),
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
    }
  }

  const judge = (score: number) => (score >= threshold ? "진짜" : "위조 의심");
  const judgeColor = (score: number) => (score >= threshold ? "#16A34A" : "#DC2626");
  // 판정 방식에 따른 유효점수 — 평균 모드는 서버가 계산한 평균 원본, AND 모드는 두 모델 중 낮은 값.
  const effHist = (h: HistoryItem) => (mode === "and" ? Math.min(h.v1se, h.v2) : h.avg);
  const effLabel = mode === "and" ? "낮은쪽(진짜확률)" : "평균(진짜확률)";
  // 최근 판독 결과의 유효점수 (판독 성공일 때만)
  const lastEff =
    last?.res.ok && last.res.models && typeof last.res.realScore === "number"
      ? mode === "and"
        ? Math.min(...last.res.models.map((m) => m.realProb))
        : last.res.realScore
      : null;

  const card: React.CSSProperties = { background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16 };
  const rect = last?.res.rect;
  const imgSize = last?.res.imageSize;

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
            {busy ? "판독 중…" : "📷 촬영해서 판독하기"}
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

          <div style={{ marginTop: 12, fontSize: 13, color: "#6B7280", lineHeight: 1.6 }}>
            시험 방법: ① 본인 얼굴 → ② 휴대폰에 얼굴 사진 띄워 카메라에 비추기 → ③ A4 인쇄 사진 → ④ 모니터 화면 → ⑤ 동영상 재생. 각각 여러 번 반복해 점수를 비교하세요.
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
          {last && last.res.ok && (
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
                      border: `3px solid ${judgeColor(lastEff ?? last.res.realScore!)}`,
                      borderRadius: 6,
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
                    }}
                  />
                )}
              </div>

              <div style={{ fontSize: 26, fontWeight: 800, color: judgeColor(lastEff ?? last.res.realScore!), marginBottom: 4 }}>
                {judge(lastEff ?? last.res.realScore!)}{" "}
                <span style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>
                  · 진짜 확률 {((lastEff ?? last.res.realScore!) * 100).toFixed(1)}%
                  <span style={{ fontSize: 13, fontWeight: 400, color: "#6B7280" }}> ({mode === "and" ? "둘 중 낮은 값" : "두 모델 평균"})</span>
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
                {" "}· 검출 {last.res.detectMs}ms · 판독 {last.res.livenessMs}ms
              </div>

              {last.res.models!.map((m) => (
                <div key={m.name} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700 }}>{m.name === "V1SE" ? "모델 A (V1SE·4.0배)" : "모델 B (V2·2.7배)"}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{(m.realProb * 100).toFixed(1)}%</span>
                  </div>
                  <div style={{ height: 8, background: "#F3F4F6", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${m.realProb * 100}%`, height: "100%", background: m.realProb >= threshold ? "#16A34A" : "#DC2626" }} />
                  </div>
                </div>
              ))}
            </>
          )}

          {/* 판정 방식 토글 — 평균(현 근태 방식) vs 둘 다 통과(AND). 이력·최근 결과가 즉시 재계산된다 */}
          <div style={{ marginTop: 16, borderTop: "1px solid #E5E7EB", paddingTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>판정 방식</div>
            <div style={{ display: "flex", gap: 8 }}>
              {(
                [
                  { key: "avg", label: "평균 (현재 근태 방식)" },
                  { key: "and", label: "둘 다 통과 (AND)" },
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
              평균 = 두 모델 점수의 평균으로 판정. 둘 다 통과 = <b>두 모델 모두</b> 기준 이상이어야 진짜(둘 중 낮은 점수로 판정).
              위조는 더 잘 잡지만 어두운 조명에서 진짜 얼굴을 잘못 의심할 수 있어요 — 밝게/어둡게/역광에서 비교해 보세요.
            </div>
          </div>

          {/* 기준값 슬라이더 */}
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
        {history.length === 0 ? (
          <div style={{ fontSize: 14, color: "#6B7280" }}>촬영할 때마다 여기에 쌓입니다. (브라우저 안에서만 — 새로고침하면 사라짐)</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640, fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #E5E7EB" }}>
                  {["사진", "시각", "모델A", "모델B", effLabel, "판정", "속도"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "9px 12px", fontWeight: 700, color: "#6B7280", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ padding: "8px 12px" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={h.thumb} alt="" style={{ width: 64, borderRadius: 4, display: "block" }} />
                    </td>
                    <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{h.at}</td>
                    <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums" }}>{(h.v1se * 100).toFixed(1)}%</td>
                    <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums" }}>{(h.v2 * 100).toFixed(1)}%</td>
                    <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{(effHist(h) * 100).toFixed(1)}%</td>
                    <td style={{ padding: "8px 12px", fontWeight: 700, color: judgeColor(effHist(h)), whiteSpace: "nowrap" }}>{judge(effHist(h))}</td>
                    <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums", color: "#6B7280", whiteSpace: "nowrap" }}>
                      {h.detectMs != null && h.livenessMs != null ? `${h.detectMs}+${h.livenessMs}ms` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
