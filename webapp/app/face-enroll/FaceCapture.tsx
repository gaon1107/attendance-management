"use client";
// 웹캠으로 얼굴을 촬영해 등록하는 화면(클라이언트).
// 각도를 다르게 최대 3회까지 등록 → 인식 정확도 향상. 매 등록 후 "추가 등록하시겠습니까?" 권유.
// 삭제하면 얼굴서버 정보를 다 지우고 1회차부터 다시 시작한다.
// 촬영한 사진은 서버로만 보내고 브라우저에 저장하지 않는다.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { enrollMyFace, deleteMyFace } from "@/app/actions/face";

type Msg = { type: "ok" | "err" | "info"; text: string } | null;

const MAX = 3;
// 회차별 각도 안내(0=1회차 …)
const ANGLE_HINTS = [
  "1회차 — 정면을 바라봐 주세요.",
  "2회차 — 고개를 살짝 왼쪽으로 돌려주세요.",
  "3회차 — 고개를 살짝 오른쪽으로 돌려주세요.",
];

export function FaceCapture({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const blobRef = useRef<Blob | null>(null);

  const [count, setCount] = useState(initialCount);
  const [phase, setPhase] = useState<"loading" | "camera" | "preview" | "prompt" | "done">(
    initialCount >= MAX ? "done" : "loading"
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
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

  // 최초 진입: 3회 미만이면 카메라 켜기
  useEffect(() => {
    if (initialCount >= MAX) return;
    openCamera();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [initialCount, openCamera]);

  // 카메라 화면이 다시 그려질 때(2·3회차 등) 영상 재연결 — 까만 화면 방지
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

  // 촬영 — 현재 영상 프레임을 캔버스에 그려 작은 JPEG로 만든다(용량 축소).
  function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    const maxW = 480;
    const scale = video.videoWidth > maxW ? maxW / video.videoWidth : 1;
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        blobRef.current = blob;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(URL.createObjectURL(blob));
        setPhase("preview");
        setMsg(null);
      },
      "image/jpeg",
      0.85
    );
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    blobRef.current = null;
    setMsg(null);
    setPhase("camera");
  }

  // 등록 — 촬영한 사진을 서버로 보내 얼굴서버에 등록한다.
  async function submit() {
    if (!blobRef.current) return;
    setSubmitting(true);
    setMsg({ type: "info", text: "얼굴을 등록하는 중입니다…" });
    try {
      const fd = new FormData();
      fd.append("image", blobRef.current, "face.jpg");
      const res = await enrollMyFace(fd);
      if (res.ok) {
        const newCount = res.count ?? Math.min(MAX, count + 1);
        setCount(newCount);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        blobRef.current = null;
        router.refresh(); // 서버 화면(등록 상태·횟수) 갱신
        if (newCount >= MAX) {
          stopCamera();
          setPhase("done");
          setMsg({ type: "ok", text: `얼굴 등록 완료! (${newCount}/${MAX}회) 이제 출퇴근에서 얼굴로 본인 확인을 할 수 있습니다.` });
        } else {
          setPhase("prompt");
          setMsg(null);
        }
      } else {
        if (typeof res.count === "number") setCount(res.count);
        setMsg({ type: "err", text: res.message });
      }
    } catch {
      setMsg({ type: "err", text: "등록 중 오류가 발생했습니다. 다시 시도해 주세요." });
    } finally {
      setSubmitting(false);
    }
  }

  // "추가로 등록" — 다음 각도로 한 번 더
  function enrollMore() {
    setMsg(null);
    setPhase("camera");
  }
  // "완료" — 여기서 마친다
  function finish() {
    stopCamera();
    setPhase("done");
    setMsg({ type: "ok", text: `얼굴 등록을 마쳤습니다. (${count}/${MAX}회)` });
  }

  // "삭제하고 처음부터" — 얼굴서버 정보 전부 삭제 + 1회차부터 다시
  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    setMsg({ type: "info", text: "등록된 얼굴을 삭제하는 중입니다…" });
    try {
      await deleteMyFace();
      setCount(0);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      blobRef.current = null;
      router.refresh(); // 페이지 상태(미등록)로 갱신
      await openCamera(); // 카메라 다시 켜서 1회차부터
      setMsg({ type: "info", text: "삭제되었습니다. 1회차부터 다시 등록해 주세요." });
    } catch {
      setMsg({ type: "err", text: "삭제 중 오류가 발생했습니다. 다시 시도해 주세요." });
    } finally {
      setBusy(false);
    }
  }

  const box: React.CSSProperties = {
    width: "100%", aspectRatio: "4 / 3", background: "#111827", borderRadius: 12, overflow: "hidden",
    display: "flex", alignItems: "center", justifyContent: "center",
  };
  const btn = (bg: string, color: string, bordered = false): React.CSSProperties => ({
    height: 46, padding: "0 18px", border: bordered ? "1px solid var(--border)" : "none", borderRadius: 8,
    background: bg, color, fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: "pointer", flex: 1,
  });
  const nextLabel = Math.min(count + 1, MAX); // 다음 등록 회차(표시용, 3 초과 방지)

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
      ) : phase === "prompt" ? (
        <div style={{ textAlign: "center", padding: "18px 8px" }}>
          <div style={{ fontSize: 30, marginBottom: 6 }}>👍</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{count}번째 얼굴이 등록됐어요!</div>
          <div style={{ fontSize: 14, color: "var(--text-sub)", marginTop: 8, lineHeight: 1.6 }}>
            <b style={{ color: "var(--text)" }}>각도를 살짝 바꿔</b> 한 번 더 등록하면 인식이 더 정확해집니다.<br />
            추가로 등록하시겠습니까? <span style={{ color: "var(--text-sub)" }}>(최대 {MAX}회)</span>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button type="button" onClick={finish} style={btn("#fff", "var(--text)", true)}>이대로 완료</button>
            <button type="button" onClick={enrollMore} style={btn("var(--primary)", "#fff")}>추가로 등록 ({nextLabel}회차)</button>
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
              style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", display: phase === "preview" ? "none" : "block" }}
            />
            {phase === "preview" && previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="촬영한 얼굴" style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
            )}
          </div>
          <canvas ref={canvasRef} style={{ display: "none" }} />

          <div style={{ fontSize: 13, color: "var(--text-sub)", margin: "12px 2px", lineHeight: 1.5 }}>
            밝은 곳에서 얼굴이 화면 가운데 오도록 하고, 위 안내 각도로 촬영해 주세요.
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            {phase === "preview" ? (
              <>
                <button type="button" onClick={retake} disabled={submitting} style={btn("#fff", "var(--text)", true)}>다시 촬영</button>
                <button type="button" onClick={submit} disabled={submitting} style={btn("var(--primary)", "#fff")}>
                  {submitting ? "등록 중…" : `이 얼굴로 등록 (${nextLabel}/${MAX})`}
                </button>
              </>
            ) : (
              <button type="button" onClick={capture} disabled={phase !== "camera"} style={btn("var(--primary)", "#fff")}>📷 촬영하기</button>
            )}
          </div>

          {/* 이미 1회 이상 등록했다면 추가 촬영 없이 여기서 마칠 수 있게 */}
          {count > 0 && (
            <button
              type="button"
              onClick={finish}
              disabled={submitting}
              style={{ width: "100%", marginTop: 10, height: 44, border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              ✓ 여기까지 등록하고 완료 ({count}/{MAX}회)
            </button>
          )}
        </>
      )}

      {/* 삭제 — 등록이 하나라도 있으면(진행 중 포함) 언제든 처음부터 다시 */}
      {count > 0 && (
        <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
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
