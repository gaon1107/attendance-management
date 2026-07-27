// 사업자등록번호 — 형식·체크섬 검사(순수) + 국세청 진위확인(네트워크).
//
// 왜 필요한가
//  · 지금 회원가입은 이메일 중복만 보고 통과시킨다. "아무나 막 가입한다"는 사장님 지적(2026-07-27).
//  · 사업자등록번호는 **거짓으로 지어내기 어렵고**(체크섬이 있다) 국세청이 무료로 진위를 확인해 준다.
//    가입 문턱을 크게 높이지 않으면서 장난 가입을 걸러내는 가장 값싼 방법이다.
//
// ⚠️ 이 파일의 네트워크 함수(verifyBizRegNo)는 **서버에서만** 부른다(process.env를 읽는다).
//    형식 검사(normalize/isValidFormat/format)는 순수 함수라 어디서든 쓸 수 있다.

/** 국세청 사업자등록정보 상태조회(공공데이터포털). 인증키는 .env의 BIZREG_API_KEY. */
const STATUS_URL = "https://api.odcloud.kr/api/nts-businessman/v1/status";

/** 국세청 응답을 기다리는 최대 시간(ms). 넘으면 "확인 보류"로 넘어간다 — 가입을 막지 않는다. */
const TIMEOUT_MS = 5000;

/** 숫자만 남긴다. "123-45-67890" → "1234567890" */
export function normalizeBizRegNo(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/[^0-9]/g, "");
}

/** 보기 좋은 형태로. "1234567890" → "123-45-67890" (10자리가 아니면 원문 그대로) */
export function formatBizRegNo(raw: string | null | undefined): string {
  const d = normalizeBizRegNo(raw);
  if (d.length !== 10) return String(raw ?? "");
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

/**
 * 사업자등록번호 자체 검사(국세청에 묻지 않고 계산만으로 판별).
 *  · 마지막 자리는 앞 9자리로 계산되는 **검증숫자**다. 아무 숫자나 10개 쓰면 여기서 걸린다.
 *  · 국세청 공표 산식: 가중치 [1,3,7,1,3,7,1,3,5] 곱해 더하고, 9번째 자리×5의 십의 자리를 더한 뒤
 *    (10 - 합%10) % 10 이 마지막 자리와 같아야 한다.
 */
export function isValidBizRegNoFormat(raw: string | null | undefined): boolean {
  const d = normalizeBizRegNo(raw);
  if (d.length !== 10) return false;
  if (/^(\d)\1{9}$/.test(d)) return false; // 0000000000 같은 값은 계산상 통과할 수 있어 따로 막는다

  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * weights[i];
  sum += Math.floor((Number(d[8]) * 5) / 10);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(d[9]);
}

/**
 * 국세청 확인 결과.
 *  · verified = 정상 영업 중인 사업자
 *  · closed   = 국세청에 있으나 휴업·폐업 상태
 *  · invalid  = 국세청에 등록되지 않은 번호
 *  · unknown  = 확인하지 못함(키 없음·서버 장애·시간 초과) → **가입을 막지 않는다**
 */
export type BizRegState = "verified" | "closed" | "invalid" | "unknown";

export type BizRegCheck = { state: BizRegState; detail: string };

/**
 * 국세청에 사업자등록번호 상태를 묻는다.
 *
 * 🔴 **fail-open**: 확인하지 못하면 `unknown`을 돌려주고 호출 측은 가입을 **통과**시킨다.
 *    국세청 서버 장애로 신규 고객을 놓치는 손해가, 장난 가입 하나를 놓치는 손해보다 크다.
 *    대신 회사 정보에 "확인 보류"로 남아 나중에 확인할 수 있다.
 */
export async function verifyBizRegNo(raw: string): Promise<BizRegCheck> {
  const b_no = normalizeBizRegNo(raw);
  if (!isValidBizRegNoFormat(b_no)) return { state: "invalid", detail: "형식이 올바르지 않습니다." };

  const key = process.env.BIZREG_API_KEY;
  if (!key) {
    // 키를 아직 발급받지 않은 상태(개발 중). 조용히 넘어가지 않고 기록은 남긴다.
    console.warn("[bizreg] BIZREG_API_KEY가 없어 국세청 확인을 건너뜁니다(확인 보류로 처리).");
    return { state: "unknown", detail: "확인 키가 설정되지 않았습니다." };
  }

  const timer = new AbortController();
  const cut = setTimeout(() => timer.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${STATUS_URL}?serviceKey=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ b_no: [b_no] }),
      signal: timer.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[bizreg] 국세청 응답 오류 ${res.status} — 확인 보류로 처리합니다.`);
      return { state: "unknown", detail: "국세청 확인 서버에 연결하지 못했습니다." };
    }

    const json = (await res.json()) as { data?: { b_stt_cd?: string; tax_type?: string }[] };
    const row = json.data?.[0];
    if (!row) return { state: "unknown", detail: "국세청 응답을 읽지 못했습니다." };

    // b_stt_cd: "01"=계속사업자 "02"=휴업자 "03"=폐업자. 미등록 번호는 이 값이 비어 있다.
    if (row.b_stt_cd === "01") return { state: "verified", detail: "정상 사업자" };
    if (row.b_stt_cd === "02" || row.b_stt_cd === "03") {
      return { state: "closed", detail: row.b_stt_cd === "03" ? "폐업한 사업자입니다." : "휴업 중인 사업자입니다." };
    }
    return { state: "invalid", detail: "국세청에 등록되지 않은 번호입니다." };
  } catch (e) {
    // 시간 초과·네트워크 장애 — 가입을 막지 않는다.
    const why = e instanceof Error && e.name === "AbortError" ? "응답 시간 초과" : "연결 실패";
    console.warn(`[bizreg] 국세청 확인 실패(${why}) — 확인 보류로 처리합니다.`);
    return { state: "unknown", detail: "국세청 확인 서버에 연결하지 못했습니다." };
  } finally {
    clearTimeout(cut);
  }
}
