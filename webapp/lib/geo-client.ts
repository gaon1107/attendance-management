// 사무실 출근용 현재 위치 가져오기 — **브라우저 전용**(화면 컴포넌트에서만 부른다).
//
// 2026-11-20 휴대폰 실시험에서 발견: 같은 휴대폰·같은 방식인데 출근 6번 중 3번이 위치 없이(= "확인 불가") 기록됐다.
//   예전 코드는 정밀 위치(GPS)를 10초 기다리다 실패하면 **아무 안내 없이** 위치 없이 진행해서,
//   직원도 관리자도 이유(권한 차단인지, 실내라 못 잡은 건지)를 알 수 없었다.
//
// 동작:
//   ① 정밀 위치(GPS) 10초 시도
//   ② 권한 차단이 아닌 실패(시간 초과·위치 없음·정확도 낮음)면 → 대략 위치(와이파이·기지국)로 한 번 더(최대 6초, 30초 이내 저장값 허용)
//   ③ 그래도 실패하면 이유를 돌려준다 → 화면이 안내 문구로 보여 준다.
// 출근 자체는 막지 않는다(위치가 없으면 서버가 "확인 불가"로 기록) — 기존 원칙 그대로.
//
// 🔴 정확도 상한(검수 치명 C-1): 대략 위치는 기지국으로 잡히면 오차가 수백 m~수 km다. 그런 좌표를 그대로 보내면
//    사무실 안에 있는 직원이 **"위치 벗어남"으로 법정 기록에 남는다**(서버는 좌표만 보고 반경과 비교한다).
//    서버 원칙은 "모르는 것은 벗어남이 아니라 확인 불가"(app/actions/attendance.ts) — 그래서 오차가 MAX_ACCURACY_M보다
//    큰 좌표는 버리고 "확인 불가"로 보낸다. (정밀 요청인데 휴대폰이 '대략적 위치' 권한만 준 경우도 여기서 걸러진다)
//    📌 근본 해결은 정확도를 서버로 보내 회사 반경과 함께 판정하는 것(서버 판정 변경 — 별도 승인 과제).
// ※ 좌표는 서버로 보내 판정만 하고 저장하지 않는다(서버 쪽 원칙).

export type GeoFailReason = "unsupported" | "denied" | "unavailable" | "timeout" | "inaccurate";
export type GeoResult = { ok: true; lat: number; lng: number } | { ok: false; reason: GeoFailReason };

const PRECISE_TIMEOUT_MS = 10_000;
const COARSE_TIMEOUT_MS = 6_000;
const COARSE_MAX_AGE_MS = 30_000; // 이동 중(주차장·지하철)에 잡힌 낡은 위치를 줄이려 30초(검수 경미 2)
/**
 * 이보다 오차가 큰 좌표는 버린다(C-1). 와이파이 기반 위치는 보통 20~100m, 기지국 기반은 수백 m 이상.
 * 150m = 회사 반경 기본값(200m)보다 작게(재확인 중간 지적 — 오차가 반경보다 크면 "벗어남" 오기록 위험이 남는다).
 * 반경을 이보다 작게 잡은 회사는 여전히 일부 위험이 남는다 → 근본 해결은 오차를 서버로 보내 반경과 함께 판정(별도 과제).
 */
export const MAX_ACCURACY_M = 150;
// 바깥 감시 타이머(검수 M-1): 표준상 timeout은 "권한 창에 답하기를 기다리는 시간"을 세지 않아,
//   창을 무시하면 콜백이 영영 안 오는 브라우저가 있다 → 버튼이 영구히 잠긴다. 권한 창에 답할 시간을 넉넉히 준다.
const PRECISE_GUARD_MS = 30_000;
const COARSE_GUARD_MS = COARSE_TIMEOUT_MS + 4_000;

// 표준 오류 번호(1=권한 거부, 2=위치 없음, 3=시간 초과). 인스턴스 상수(err.PERMISSION_DENIED)는 일부 WebView·위조 도구에
// 없을 수 있어 숫자로 직접 비교한다(검수 M-2).
function reasonOf(err: { code?: number } | null | undefined): GeoFailReason {
  const code = err?.code;
  return code === 1 ? "denied" : code === 3 ? "timeout" : "unavailable";
}

function once(options: PositionOptions, guardMs: number): Promise<GeoResult> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: GeoResult) => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      resolve(r);
    };
    const guard = setTimeout(() => finish({ ok: false, reason: "timeout" }), guardMs);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const acc = pos?.coords?.accuracy;
          const lat = pos?.coords?.latitude;
          const lng = pos?.coords?.longitude;
          if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
            finish({ ok: false, reason: "unavailable" });
          } else if (typeof acc === "number" && Number.isFinite(acc) && acc > MAX_ACCURACY_M) {
            finish({ ok: false, reason: "inaccurate" });
          } else {
            finish({ ok: true, lat, lng });
          }
        },
        (err) => finish({ ok: false, reason: reasonOf(err) }),
        options
      );
    } catch {
      finish({ ok: false, reason: "unavailable" });
    }
  });
}

/**
 * 항상 끝난다(거부·무한 대기 없음 — 바깥 감시 타이머). 최대 약 40초(권한 창을 무시한 최악의 경우), 보통 0~16초.
 * @param onRetry 정밀 위치에 실패해 대략 위치로 다시 시도할 때 한 번 불린다(화면 안내 갱신용).
 */
export async function getOfficePosition(onRetry?: () => void): Promise<GeoResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return { ok: false, reason: "unsupported" };

  const precise = await once({ enableHighAccuracy: true, timeout: PRECISE_TIMEOUT_MS, maximumAge: 0 }, PRECISE_GUARD_MS);
  if (precise.ok || precise.reason === "denied") return precise; // 권한 차단은 다시 물어도 똑같다

  onRetry?.();
  const coarse = await once({ enableHighAccuracy: false, timeout: COARSE_TIMEOUT_MS, maximumAge: COARSE_MAX_AGE_MS }, COARSE_GUARD_MS);
  if (coarse.ok) return coarse;
  // 두 번째가 권한 차단이면 그 이유가 더 정확하다(첫 실패 사이에 사용자가 거부한 경우 등)
  return coarse.reason === "denied" ? coarse : precise;
}

/** 실패 이유 → 직원에게 보여 줄 안내(무엇을 하면 되는지까지). */
export function geoFailMessage(reason: GeoFailReason): string {
  switch (reason) {
    case "denied":
      return (
        "위치 권한이 차단돼 있습니다. 주소창의 아이콘(아이폰은 'aA')에서 위치를 '허용'으로 바꿔 주세요. " +
        "그래도 안 되면 휴대폰 설정에서 브라우저(크롬·사파리)의 위치 권한을 확인하고, 카카오톡 등에서 열었다면 크롬·사파리로 열어 주세요."
      );
    case "unsupported":
      return "이 브라우저는 위치 기능을 지원하지 않습니다.";
    case "inaccurate":
      return "위치 오차가 너무 커서 사무실 여부를 판단할 수 없습니다. 휴대폰 설정에서 '정확한 위치'를 켜고, 와이파이를 켠 상태로 다시 시도해 주세요.";
    case "timeout":
    case "unavailable":
    default:
      return "현재 위치를 잡지 못했습니다. 휴대폰의 위치(GPS)가 켜져 있는지 확인하고, 창가 등 위치가 잘 잡히는 곳에서 다시 시도해 주세요.";
  }
}

export const GEO_RETRY_MESSAGE = "정확한 위치를 잡지 못해 대략 위치로 다시 확인하는 중…";
/** 위치 없이 진행하기 **전에** 알린다 — 출근이 끝나면 출근 패널이 퇴근 화면으로 바뀌어 사후 안내는 바로 사라진다. */
export const GEO_NO_LOCATION_NOTE = "이대로 출근하면 '위치 확인 불가'로 기록됩니다.";
