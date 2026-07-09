"use client";
// 웹캠으로 얼굴을 촬영해 등록하는 화면(클라이언트).
// [촬영하기] 한 번이면 끝: 영상 위에 스캔 효과 → 자동 등록 → 서버가 인식한 얼굴 영역 + "N회차 등록 완료!"를 영상 위에 표시.
// 각도를 다르게 최대 3회까지 등록 → 인식 정확도 향상. 삭제하면 얼굴서버 정보를 다 지우고 1회차부터 다시 시작한다.
// 촬영한 사진은 서버로만 보내고 브라우저에 저장하지 않는다.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { enrollMyFace, deleteMyFace } from "@/app/actions/face";

type Msg = { type: "ok" | "err" | "info"; text: string } | null;
// 영상 위 오버레이 상태: 스캔 중 → (성공: 검출 영역+완료 문구) or (실패: 안내)
type BoxPct = { left: number; top: number; width: number; height: number };
type Overlay =
  | { kind: "scan" }
  | { kind: "success"; round: number; box: BoxPct | null }
  | { kind: "error"; text: string }
  | null;

const MAX = 3;
// 회차별 각도 안내(0=1회차 …)
const ANGLE_HINTS = [
  "1회차 — 정면을 바라봐 주세요.",
  "2회차 — 고개를 살짝 왼쪽으로 돌려주세요.",
  "3회차 — 고개를 살짝 오른쪽으로 돌려주세요.",
];
const SCAN_MIN_MS = 1400; // 스캔 효과 최소 표시 시간(서버가 빨라도 효과가 보이게)
const SUCCESS_MS = 2200; // 완료 문구 표시 시간

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function FaceCapture({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const submittingRef = useRef(false); // 더블클릭 동기 차단
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [count, setCount] = useState(initialCount);
  const [phase, setPhase] = useState<"loading" | "camera" | "done">(initialCount >= MAX ? "done" : "loading");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [busy, setBusy] = useState(false); // 삭제 처리 중
  const [msg, setMsg] = useState<Msg>(null);

  // 카메라 켜기(스트림 없으면 새로 요청, 있으면 재연결) → 촬영 화면으로
  const openCamera = useCallback(async () => {
    try {
      let stream = streamRef.current;
      if (!stream || stream.getTracks().every((t) => t.readyState === "ended")) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        streamRef.current = stream;
      }
      if (videoRef.current && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPhase("camera");
      setMsg(null);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setMsg({
        type: "err",
        text:
          name === "NotAllowedError"
            ? "카메라 사용이 거부되었습니다. 브라우저 주소창의 카메라 권한을 허용해 주세요."
            : name === "NotFoundError"
            ? "카메라를 찾을 수 없습니다. 웹캠이 연결돼 있는지 확인해 주세요."
            : "카메라를 열 수 없습니다. 브라우저를 새로고침해 주세요.",
      });
      setPhase("camera");
    }
  }, []);

  // 최초 진입 1회만: 3회 미만이면 카메라 켜기. 화면을 떠날 때만 카메라·타이머 정리.
  // ⚠️ 등록 성공 시 서버 화면 갱신으로 initialCount가 바뀌는데, 그때 이 정리가 다시 돌면
  //    성공 타이머가 지워져 화면이 잠긴다 → 의존성 없이 마운트/언마운트에만 실행.
  useEffect(() => {
    if (initialCount < MAX) openCamera();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 카메라 화면이 다시 그려질 때 영상 재연결 — 까만 화면 방지
  useEffect(() => {
    if (phase !== "camera") return;
    const v = videoRef.current;
    const s = streamRef.current;
    if (v && s && v.srcObject !== s) {
      v.srcObject = s;
      v.play().catch(() => {});
    }
  }, [phase]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  // 서버가 준 얼굴 위치(보낸 사진 좌표) → 화면 % 좌표.
  // 영상이 거울처럼 좌우 반전돼 있어 가로는 뒤집고, 화면 박스(4:3)와 카메라 비율이 다르면
  // objectFit:cover 로 잘려 보이는 만큼을 보정한다. 값은 0~100% 범위로 자른다.
  function toBoxPct(
    rect: { x: number; y: number; width: number; height: number },
    imgW: number,
    imgH: number
  ): BoxPct | null {
    if (!imgW || !imgH || rect.width <= 0 || rect.height <= 0) return null;
    const containerAspect = 4 / 3; // 화면 박스 비율(aspectRatio "4 / 3"과 동일해야 함)
    const imgAspect = imgW / imgH;
    let visW = imgW, visH = imgH, offX = 0, offY = 0; // cover로 실제 보이는 영역
    if (imgAspect > containerAspect) {
      visW = imgH * containerAspect;
      offX = (imgW - visW) / 2;
    } else if (imgAspect < containerAspect) {
      visH = imgW / containerAspect;
      offY = (imgH - visH) / 2;
    }
    const mirroredX = imgW - (rect.x + rect.width); // 좌우 반전
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const left = clamp(((mirroredX - offX) / visW) * 100, 0, 100);
    const top = clamp(((rect.y - offY) / visH) * 100, 0, 100);
    return {
      left,
      top,
      width: clamp((rect.width / visW) * 100, 0, 100 - left),
      height: clamp((rect.height / visH) * 100, 0, 100 - top),
    };
  }

  // [촬영하기] — 현재 프레임을 찍어 스캔 효과와 함께 자동 등록한다.
  function captureAndEnroll() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || submittingRef.current || overlay) return;
    if (!video.videoWidth) {
      setMsg({ type: "info", text: "카메라 영상을 준비하는 중입니다. 잠시 후 다시 눌러주세요." });
      return;
    }
    submittingRef.current = true;
    setMsg(null);

    const maxW = 480;
    const scale = video.videoWidth > maxW ? maxW / video.videoWidth : 1;
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      submittingRef.current = false;
      return;
    }
    ctx.drawImage(video, 0, 0, w, h);
    setOverlay({ kind: "scan" });

    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          submittingRef.current = false;
          setOverlay({ kind: "error", text: "촬영에 실패했습니다. 다시 시도해 주세요." });
          return;
        }
        try {
          const fd = new FormData();
          fd.append("image", blob, "face.jpg");
          // 서버 등록과 최소 스캔 시간(효과가 보이게)을 함께 기다린다
          const [res] = await Promise.all([enrollMyFace(fd), delay(SCAN_MIN_MS)]);
          if (res.ok) {
            const newCount = res.count ?? Math.min(MAX, count + 1);
            setCount(newCount);
            router.refresh(); // 서버 화면(등록 상태·횟수) 갱신
            // 서버가 인식한 얼굴 영역(있으면)을 화면 좌표로 변환해 표시
            const box = res.faceRect
              ? toBoxPct(res.faceRect, res.imageSize?.width ?? w, res.imageSize?.height ?? h)
              : null;
            setOverlay({ kind: "success", round: newCount, box });
            timerRef.current = setTimeout(() => {
              setOverlay(null);
              submittingRef.current = false;
              if (newCount >= MAX) {
                stopCamera();
                setPhase("done");
                setMsg({ type: "ok", text: `얼굴 등록 완료! (${newCount}/${MAX}회) 이제 출퇴근에서 얼굴로 본인 확인을 할 수 있습니다.` });
              }
            }, SUCCESS_MS);
          } else {
            if (typeof res.count === "number") setCount(res.count);
            submittingRef.current = false;
            setOverlay({ kind: "error", text: res.message });
          }
        } catch {
          submittingRef.current = false;
          setOverlay({ kind: "error", text: "등록 중 오류가 발생했습니다. 다시 시도해 주세요." });
        }
      },
      "image/jpeg",
      0.85
    );
  }

  // 실패 안내를 닫고 다시 촬영 대기 상태로
  function dismissError() {
    setOverlay(null);
  }

  // "여기까지 완료" — 등록을 여기서 마친다
  function finish() {
    stopCamera();
    setPhase("done");
    setMsg({ type: "ok", text: `얼굴 등록을 마쳤습니다. (${count}/${MAX}회)` });
  }

  // "삭제하고 처음부터" — 얼굴서버 정보 전부 삭제 + 1회차부터 다시
  async function handleDelete() {
    if (busy) return;
    // 성공 오버레이 대기 중이던 타이머를 정리(안 하면 삭제 후 "등록 완료" 화면으로 튐)
    if (timerRef.current) clearTimeout(timerRef.current);
    submittingRef.current = false;
    setBusy(true);
    setMsg({ type: "info", text: "등록된 얼굴을 삭제하는 중입니다…" });
    try {
      await deleteMyFace();
      setCount(0);
      setOverlay(null);
      router.refresh(); // 페이지 상태(미등록)로 갱신
      await openCamera(); // 카메라 다시 켜서 1회차부터
      setMsg({ type: "info", text: "삭제되었습니다. 1회차부터 다시 등록해 주세요." });
    } catch {
      setMsg({ type: "err", text: "삭제 중 오류가 발생했습니다. 다시 시도해 주세요." });
    } finally {
      setBusy(false);
    }
  }

  const scanning = overlay?.kind === "scan";
  const box: React.CSSProperties = {
    position: "relative",
    width: "100%", aspectRatio: "4 / 3", background: "#111827", borderRadius: 12, overflow: "hidden",
  };
  const btn = (bg: string, color: string, bordered = false): React.CSSProperties => ({
    height: 46, padding: "0 18px", border: bordered ? "1px solid var(--border)" : "none", borderRadius: 8,
    background: bg, color, fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: "pointer", flex: 1,
  });
  // 영상 위 안내 배너(중앙) 공통 스타일
  const overlayBanner = (bg: string): React.CSSProperties => ({
    position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
    background: bg, color: "#fff", borderRadius: 10, padding: "12px 20px",
    fontSize: 16, fontWeight: 700, textAlign: "center", maxWidth: "86%", lineHeight: 1.5,
  });
  const corner = (pos: React.CSSProperties): React.CSSProperties => ({
    position: "absolute", width: 34, height: 34, borderColor: "#38BDF8", borderStyle: "solid", borderWidth: 0, opacity: 0.9, ...pos,
  });

  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
      {/* 진행 표시(0/3 … 3/3) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-sub)" }}>등록 진행</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>{count} / {MAX}</span>
        <div style={{ display: "flex", gap: 4, marginLeft: 4 }}>
          {Array.from({ length: MAX }).map((_, i) => (
            <span key={i} style={{ width: 22, height: 6, borderRadius: 3, background: i < count ? "var(--primary)" : "var(--border)" }} />
          ))}
        </div>
      </div>

      {phase === "done" ? (
        <div style={{ textAlign: "center", padding: "24px 8px" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--success)" }}>얼굴 등록 완료 ({count}/{MAX}회)</div>
          <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 8 }}>
            {count >= MAX ? "최대 횟수까지 등록했습니다." : ""} 이제 출퇴근에서 얼굴로 본인 확인을 할 수 있습니다.
          </div>
        </div>
      ) : (
        <>
          {/* 다음 회차 각도 안내 */}
          <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: "9px 12px", marginBottom: 10, fontSize: 13, color: "#1E40AF", fontWeight: 700, textAlign: "center" }}>
            {ANGLE_HINTS[Math.min(count, MAX - 1)]}
          </div>

          <div style={box}>
            <video
              ref={videoRef} playsInline muted
              style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", display: "block" }}
            />

            {/* 스캔 효과 — 격자 + 모서리 브래킷 + 흐르는 스캔 라인 */}
            {scanning && (
              <div style={{ position: "absolute", inset: 0 }}>
                <div className="face-scan-grid" />
                <span style={corner({ top: 10, left: 10, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 })} />
                <span style={corner({ top: 10, right: 10, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 })} />
                <span style={corner({ bottom: 10, left: 10, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 })} />
                <span style={corner({ bottom: 10, right: 10, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 })} />
                <div className="face-scan-line" />
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 14, textAlign: "center", color: "#BAE6FD", fontSize: 14, fontWeight: 700, textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>
                  얼굴 분석 중…
                </div>
              </div>
            )}

            {/* 성공 — 서버가 인식한 얼굴 영역 + 완료 문구 */}
            {overlay?.kind === "success" && (
              <div style={{ position: "absolute", inset: 0 }}>
                {overlay.box && (
                  <div
                    className="face-detect-box"
                    style={{ left: `${overlay.box.left}%`, top: `${overlay.box.top}%`, width: `${overlay.box.width}%`, height: `${overlay.box.height}%` }}
                  />
                )}
                <div style={overlayBanner("rgba(22, 101, 52, 0.92)")}>
                  ✅ {overlay.round}회차 등록 완료!
                  {overlay.round < MAX && (
                    <div style={{ fontSize: 13, fontWeight: 400, marginTop: 4, color: "#DCFCE7" }}>
                      각도를 바꿔 더 등록하면 인식이 정확해져요. (최대 {MAX}회)
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 실패 — 영상 위 안내 */}
            {overlay?.kind === "error" && (
              <div style={{ position: "absolute", inset: 0 }} onClick={dismissError}>
                <div style={overlayBanner("rgba(153, 27, 27, 0.92)")}>
                  {overlay.text}
                  <div style={{ fontSize: 13, fontWeight: 400, marginTop: 4, color: "#FECACA" }}>화면을 누르고 다시 촬영해 주세요.</div>
                </div>
              </div>
            )}
          </div>
          <canvas ref={canvasRef} style={{ display: "none" }} />

          <div style={{ fontSize: 13, color: "var(--text-sub)", margin: "12px 2px", lineHeight: 1.5 }}>
            밝은 곳에서 얼굴이 화면 가운데 오도록 하고 [촬영하기]를 누르면 자동으로 등록됩니다.
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={overlay?.kind === "error" ? dismissError : captureAndEnroll}
              disabled={phase !== "camera" || scanning || overlay?.kind === "success"}
              style={{ ...btn("var(--primary)", "#fff"), opacity: scanning || overlay?.kind === "success" ? 0.6 : 1 }}
            >
              {scanning ? "분석 중…" : overlay?.kind === "error" ? "다시 촬영하기" : "📷 촬영하기"}
            </button>
          </div>

          {/* 이미 1회 이상 등록했다면 추가 촬영 없이 여기서 마칠 수 있게 */}
          {count > 0 && (
            <button
              type="button"
              onClick={finish}
              disabled={busy || overlay !== null}
              style={{ width: "100%", marginTop: 10, height: 44, border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              ✓ 여기까지 등록하고 완료 ({count}/{MAX}회)
            </button>
          )}
        </>
      )}

      {/* 삭제 — 등록이 하나라도 있으면 언제든 처음부터 다시 */}
      {count > 0 && (
        <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy || overlay !== null}
            style={{ height: 40, padding: "0 16px", border: "1px solid var(--danger)", borderRadius: 8, background: "#fff", color: "var(--danger)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
          >
            {busy ? "삭제 중…" : "등록한 얼굴 삭제하고 처음부터"}
          </button>
          <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 8 }}>
            삭제하면 얼굴서버에서 모두 지워지고 1회차부터 다시 등록합니다.
          </div>
        </div>
      )}

      {msg && (
        <div
          style={{
            marginTop: 14, padding: "12px 14px", borderRadius: 8, fontSize: 14,
            background: msg.type === "ok" ? "#DCFCE7" : msg.type === "err" ? "#FEE2E2" : "#F3F4F6",
            color: msg.type === "ok" ? "#166534" : msg.type === "err" ? "#991B1B" : "var(--text-sub)",
          }}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
