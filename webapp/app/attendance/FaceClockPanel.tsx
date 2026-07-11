"use client";
// 얼굴인증 직원용 출근/퇴근 패널.
// 출근: 근무형태 선택 → (사무실이면 위치 수집) → 웹캠 촬영 → 서버에서 본인 확인 후 출근 처리.
// 퇴근: 웹캠 촬영 → 본인 확인 후 퇴근 처리.
// 얼굴은 선택 수단(강제 금지) — "일반 방식으로" 버튼을 항상 함께 제공한다.
// 촬영 사진은 서버로만 보내고 저장하지 않는다.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { faceClockIn, faceClockOut } from "@/app/actions/face";
import { clockOut } from "@/app/actions/attendance";
import { ClockInPanel } from "./ClockInPanel";

type Msg = { type: "ok" | "err" | "info"; text: string } | null;
type WorkMode = "office" | "home" | "field";

export function FaceClockPanel({ action }: { action: "in" | "out" }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // idle=버튼 화면, camera=촬영 화면, fallback=일반 방식
  const [phase, setPhase] = useState<"idle" | "camera" | "fallback">("idle");
  const [mode, setMode] = useState<WorkMode>("office");
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false); // 더블클릭 즉시 차단용(상태 갱신은 비동기라 ref로 동기 차단)
  const unmountedRef = useRef(false); // 화면 이탈 후 늦게 도착한 카메라 스트림을 끄기 위한 표시
  const [msg, setMsg] = useState<Msg>(null);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      stopCamera(); // 화면 떠날 때 카메라 끄기
    };
  }, []);

  // 카메라 화면이 그려진 뒤 영상 연결(까만 화면 방지)
  useEffect(() => {
    if (phase !== "camera") return;
    const v = videoRef.current;
    const s = streamRef.current;
    if (v && s && v.srcObject !== s) {
      v.srcObject = s;
      v.play().catch(() => {});
    }
  }, [phase]);

  async function openCamera() {
    try {
      let stream = streamRef.current;
      if (!stream || stream.getTracks().every((t) => t.readyState === "ended")) {
        stream = await navigator.mediaDevices.getUserMedia({
          // 1280×720 요청 — 라이브니스(사진판독) 기준값이 이 화질에서 측정됨(liveness-demo와 동일 조건)
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        // 기다리는 사이 화면을 떠났으면 즉시 끈다(웹캠 불이 계속 켜져 있는 것 방지)
        if (unmountedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
      }
      setPhase("camera");
      setMsg({ type: "info", text: "얼굴이 화면 가운데 오도록 하고 [촬영해서 확인]을 눌러주세요." });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setMsg({
        type: "err",
        text:
          name === "NotAllowedError"
            ? "카메라 사용이 거부되었습니다. 브라우저 주소창의 카메라 권한을 허용해 주세요."
            : name === "NotFoundError"
            ? "카메라를 찾을 수 없습니다. 웹캠 연결을 확인하거나 아래 일반 방식을 이용해 주세요."
            : "카메라를 열 수 없습니다. 새로고침하거나 아래 일반 방식을 이용해 주세요.",
      });
    }
  }

  // 출근: 근무형태 버튼 → (사무실이면 현재 위치 수집: 실패해도 진행) → 카메라
  function startClockIn(m: WorkMode) {
    setMode(m);
    coordsRef.current = null;
    if (m === "office" && navigator.geolocation) {
      setMsg({ type: "info", text: "현재 위치 확인 중…" });
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          coordsRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          openCamera();
        },
        () => openCamera(), // 위치 거부/실패해도 얼굴 확인으로 진행(서버가 IP로도 확인)
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      openCamera();
    }
  }

  function toBlobAsync(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  }

  // 촬영 → JPEG → 서버로 보내 본인 확인 + 출퇴근 처리
  async function captureAndSubmit() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || submitting || submittingRef.current) return;
    if (!video.videoWidth) {
      setMsg({ type: "info", text: "카메라 영상을 준비하는 중입니다. 잠시 후 다시 눌러주세요." });
      return;
    }
    submittingRef.current = true; // toBlob(비동기) 전에 동기로 잠가 빠른 두 번 클릭 차단
    // 판독 정확도를 위해 최대 1280 그대로, 품질 0.9 — 라이브니스 기준값 측정 조건(liveness-demo)과 동일
    const maxW = 1280;
    const scale = video.videoWidth > maxW ? maxW / video.videoWidth : 1;
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      submittingRef.current = false;
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // 서버 액션 본문 한도(1MB) 대비: 크면 품질을 낮춰 재압축(저조도 노이즈·고해상도 카메라 대비)
    let blob = await toBlobAsync(canvas, 0.9);
    for (const q of [0.75, 0.6]) {
      if (blob && blob.size <= 850 * 1024) break;
      blob = await toBlobAsync(canvas, q);
    }
    // 그래도 한도를 넘으면(초고밀도 노이즈 등 극단 케이스) 해상도를 960으로 한 단계 줄여 재시도
    if (blob && blob.size > 850 * 1024 && canvas.width > 960) {
      const s = 960 / canvas.width;
      const w = Math.round(canvas.width * s);
      const h = Math.round(canvas.height * s);
      const small = document.createElement("canvas");
      small.width = w;
      small.height = h;
      small.getContext("2d")?.drawImage(canvas, 0, 0, w, h);
      blob = await toBlobAsync(small, 0.75);
    }
    if (!blob) {
      submittingRef.current = false;
      setMsg({ type: "err", text: "촬영에 실패했습니다. 다시 시도해 주세요." });
      return;
    }
    setSubmitting(true);
    setMsg({ type: "info", text: "얼굴을 확인하는 중입니다…" });
    try {
      const fd = new FormData();
      fd.append("image", blob, "face.jpg");
      let res: { ok: boolean; message: string };
      if (action === "in") {
        fd.append("mode", mode);
        if (coordsRef.current) {
          fd.append("lat", String(coordsRef.current.lat));
          fd.append("lng", String(coordsRef.current.lng));
        }
        res = await faceClockIn(fd);
      } else {
        res = await faceClockOut(fd);
      }
      if (res.ok) {
        stopCamera();
        setPhase("idle");
        setMsg({ type: "ok", text: res.message });
        router.refresh();
      } else {
        setMsg({ type: "err", text: `${res.message} (다시 촬영하거나 아래 일반 방식을 이용하세요)` });
      }
    } catch {
      setMsg({ type: "err", text: "확인 중 오류가 발생했습니다. 다시 시도해 주세요." });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function cancelCamera() {
    stopCamera();
    setPhase("idle");
    setMsg(null);
  }

  const bigBtn = (bg: string): React.CSSProperties => ({
    width: "100%", height: 56, border: "none", borderRadius: 12, background: bg, color: "#fff",
    fontFamily: "inherit", fontSize: 18, fontWeight: 700, cursor: submitting ? "default" : "pointer",
    opacity: submitting ? 0.6 : 1,
  });
  const secondaryBtn: React.CSSProperties = {
    flex: 1, height: 52, border: "1px solid var(--border)", borderRadius: 12, background: "#fff",
    color: "var(--text)", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: "pointer",
  };
  const linkBtn: React.CSSProperties = {
    border: "none", background: "none", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 13,
    textDecoration: "underline", cursor: "pointer", padding: 0,
  };

  // 일반 방식(얼굴 없이) — 강제 금지 원칙에 따른 대체 수단
  if (phase === "fallback") {
    return (
      <div>
        {action === "in" ? (
          <ClockInPanel />
        ) : (
          <form action={clockOut} style={{ marginBottom: 10 }}>
            <button type="submit" style={bigBtn("var(--danger)")}>퇴근하기</button>
          </form>
        )}
        <div style={{ textAlign: "center", marginTop: 10 }}>
          <button type="button" style={linkBtn} onClick={() => { setPhase("idle"); setMsg(null); }}>
            ← 얼굴 인증으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  if (phase === "camera") {
    return (
      <div>
        <div style={{ width: "100%", aspectRatio: "4 / 3", background: "#111827", borderRadius: 12, overflow: "hidden" }}>
          <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
        </div>
        <canvas ref={canvasRef} style={{ display: "none" }} />
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button type="button" onClick={cancelCamera} disabled={submitting} style={secondaryBtn}>취소</button>
          <button type="button" onClick={captureAndSubmit} disabled={submitting} style={{ ...bigBtn("var(--primary)"), flex: 2, width: "auto", height: 52, fontSize: 16 }}>
            {submitting ? "확인 중…" : `📷 촬영해서 ${action === "in" ? "출근" : "퇴근"}`}
          </button>
        </div>
        {msg && <MsgBox msg={msg} />}
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button type="button" style={linkBtn} onClick={() => { stopCamera(); setPhase("fallback"); setMsg(null); }}>
            얼굴 인증이 안 되나요? 일반 방식으로 {action === "in" ? "출근" : "퇴근"}하기
          </button>
        </div>
      </div>
    );
  }

  // idle — 버튼 화면
  return (
    <div>
      {action === "in" ? (
        <>
          <button type="button" onClick={() => startClockIn("office")} style={{ ...bigBtn("var(--primary)"), marginBottom: 12 }}>
            😀 얼굴로 사무실 출근
          </button>
          <div style={{ display: "flex", gap: 12 }}>
            <button type="button" onClick={() => startClockIn("home")} style={secondaryBtn}>🏠 재택근무</button>
            <button type="button" onClick={() => startClockIn("field")} style={secondaryBtn}>🚗 외근</button>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 12 }}>
            버튼을 누르면 웹캠으로 본인 확인 후 출근됩니다. 사무실 출근만 위치를 확인해요.
          </div>
        </>
      ) : (
        <button type="button" onClick={openCamera} style={{ ...bigBtn("var(--danger)"), marginBottom: 10 }}>
          😀 얼굴로 퇴근하기
        </button>
      )}
      {msg && <MsgBox msg={msg} />}
      <div style={{ textAlign: "center", marginTop: 10 }}>
        <button type="button" style={linkBtn} onClick={() => { setPhase("fallback"); setMsg(null); }}>
          얼굴 없이 일반 방식으로 {action === "in" ? "출근" : "퇴근"}하기
        </button>
      </div>
    </div>
  );
}

function MsgBox({ msg }: { msg: NonNullable<Msg> }) {
  return (
    <div
      style={{
        marginTop: 12, padding: "12px 14px", borderRadius: 8, fontSize: 14,
        background: msg.type === "ok" ? "#DCFCE7" : msg.type === "err" ? "#FEE2E2" : "#F3F4F6",
        color: msg.type === "ok" ? "#166534" : msg.type === "err" ? "#991B1B" : "var(--text-sub)",
      }}
    >
      {msg.text}
    </div>
  );
}
