"use client";
// 다음(카카오) 우편번호 검색 버튼 — 클릭 시 팝업에서 주소를 고르면 우편번호+도로명주소를 돌려준다.
// 별도 API 키가 필요 없는 무료 서비스(스크립트를 처음 클릭 때 1회 로드).
import { useCallback, useRef, useState } from "react";

const SCRIPT_SRC = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";

// 다음 우편번호 위젯 타입(필요한 부분만 선언)
type PostcodeData = { zonecode: string; roadAddress: string; jibunAddress: string };
type DaumPostcode = { new (opts: { oncomplete: (d: PostcodeData) => void }): { open: () => void } };
declare global {
  interface Window {
    daum?: { Postcode: DaumPostcode };
  }
}

export function PostcodeButton({
  onComplete,
  label = "주소 검색",
}: {
  onComplete: (zip: string, address: string) => void;
  label?: string;
}) {
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);

  // 스크립트를 한 번만 로드하고, window.daum이 준비될 때까지 폴링해서 resolve.
  // (load 이벤트가 이미 지난 뒤에 다시 붙는 경우에도 고착되지 않도록 폴링 방식 사용)
  const ensureScript = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        if (window.daum?.Postcode) return resolve();
        // 스크립트가 아직 없으면 추가(있으면 재사용)
        if (!document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)) {
          const s = document.createElement("script");
          s.src = SCRIPT_SRC;
          s.async = true;
          s.onerror = () => reject(new Error("load failed"));
          document.head.appendChild(s);
        }
        // 준비될 때까지 최대 8초 폴링
        let waited = 0;
        const iv = setInterval(() => {
          if (window.daum?.Postcode) {
            clearInterval(iv);
            resolve();
          } else if ((waited += 100) >= 8000) {
            clearInterval(iv);
            reject(new Error("timeout"));
          }
        }, 100);
      }),
    []
  );

  const open = useCallback(async () => {
    if (loadingRef.current) return; // 중복 클릭 방지
    loadingRef.current = true;
    setLoading(true);
    try {
      await ensureScript();
      if (!window.daum?.Postcode) throw new Error("not ready");
      new window.daum.Postcode({
        oncomplete: (data) => {
          const addr = data.roadAddress || data.jibunAddress || "";
          onComplete(data.zonecode || "", addr);
        },
      }).open();
    } catch {
      alert("주소 검색을 불러오지 못했습니다. 인터넷 연결을 확인하거나 주소를 직접 입력해 주세요.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [ensureScript, onComplete]);

  return (
    <button
      type="button"
      onClick={open}
      disabled={loading}
      style={{
        height: 44,
        padding: "0 18px",
        border: "1px solid var(--primary)",
        borderRadius: 8,
        background: "#fff",
        color: "var(--primary)",
        fontFamily: "inherit",
        fontSize: 14,
        fontWeight: 700,
        cursor: loading ? "default" : "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {loading ? "여는 중..." : `🔍 ${label}`}
    </button>
  );
}
