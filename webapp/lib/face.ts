// [얼굴인식 서버(GaonFR) 연동]
// 근태앱 백엔드에서만 호출한다(비밀값은 .env에만, 브라우저로 노출 금지).
//
// 인증 흐름 (2단계 토큰):
//   1) POST /login/       헤더 LicenseKey + Authorization: Basic base64("ID:Secret")  → 응답 헤더 ClientToken (24시간)
//   2) POST /get/token/   헤더 ClientToken                                            → 응답 헤더 ApiToken (15분)
//   3) 기능 호출          헤더 ApiToken 으로 /v1/face/enrollment·recognize·unenrollment
//      · StatusCode 4016(또는 401/403) = 토큰 만료 → 재발급 후 1회 재시도
//
// 데이터 규칙(우리 제품): FaceId = 직원 id, Group = 회사 id(companyId) → 회사별 격리.
//   얼굴 원본/특징값은 얼굴서버에만 저장. 우리 DB엔 "등록했다"는 표시만 남긴다.

const BASE_URL = (process.env.FACE_API_BASE_URL || "").replace(/\/+$/, "");
const CLIENT_ID = process.env.FACE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.FACE_CLIENT_SECRET || "";
const LICENSE_KEY = process.env.FACE_LICENSE_KEY || "";

// 토큰 메모리 캐시(수명보다 살짝 짧게 잡아 만료 직전 재발급)
let clientToken: { value: string; at: number } | null = null;
let apiToken: { value: string; at: number } | null = null;
const CLIENT_TOKEN_TTL = 23 * 60 * 60 * 1000; // 24h → 23h 안전마진
const API_TOKEN_TTL = 13 * 60 * 1000; // 15분 → 13분 안전마진

function assertConfigured(): void {
  if (!BASE_URL || !CLIENT_ID || !CLIENT_SECRET || !LICENSE_KEY) {
    throw new Error("얼굴서버 설정(.env FACE_*)이 없습니다.");
  }
}

// [1단계] 로그인 → ClientToken(응답 헤더)
async function login(): Promise<string> {
  assertConfigured();
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE_URL}/login/`, {
    method: "POST",
    headers: { LicenseKey: LICENSE_KEY, Authorization: `Basic ${basic}` },
  });
  const token = res.headers.get("ClientToken");
  if (!res.ok || !token) {
    throw new Error(`얼굴서버 로그인 실패 (HTTP ${res.status})`);
  }
  clientToken = { value: token, at: Date.now() };
  return token;
}

async function getClientToken(): Promise<string> {
  if (clientToken && Date.now() - clientToken.at < CLIENT_TOKEN_TTL) return clientToken.value;
  return login();
}

// [2단계] ClientToken → ApiToken(응답 헤더)
async function fetchApiToken(): Promise<string> {
  const ct = await getClientToken();
  const res = await fetch(`${BASE_URL}/get/token/`, {
    method: "POST",
    headers: { ClientToken: ct },
  });
  const token = res.headers.get("ApiToken");
  if (!res.ok || !token) {
    // ClientToken이 만료됐을 수 있으니 한 번 다시 로그인해서 재시도
    clientToken = null;
    const ct2 = await getClientToken();
    const res2 = await fetch(`${BASE_URL}/get/token/`, { method: "POST", headers: { ClientToken: ct2 } });
    const token2 = res2.headers.get("ApiToken");
    if (!res2.ok || !token2) throw new Error(`얼굴서버 ApiToken 발급 실패 (HTTP ${res2.status})`);
    apiToken = { value: token2, at: Date.now() };
    return token2;
  }
  apiToken = { value: token, at: Date.now() };
  return token;
}

async function getApiToken(): Promise<string> {
  if (apiToken && Date.now() - apiToken.at < API_TOKEN_TTL) return apiToken.value;
  return fetchApiToken();
}

// 응답 본문의 StatusCode 로 토큰 만료(4016) 여부 판단
function isTokenExpired(status: number, body: unknown): boolean {
  if (status === 401 || status === 403) return true;
  return !!(body && typeof (body as { StatusCode?: unknown }).StatusCode === "number" && (body as { StatusCode: number }).StatusCode === 4016);
}

type FaceResult = { success: boolean; message?: string; faceId?: string };

// [얼굴 등록] 사진 1장을 회사(Group) 안에 직원(FaceId)로 등록한다. (토큰 만료 시 1회 자동 재시도)
export async function enrollFace(imageBuffer: Buffer, faceId: string, group: string): Promise<FaceResult> {
  const doRequest = async (token: string) => {
    const form = new FormData();
    form.append("Image", new Blob([new Uint8Array(imageBuffer)], { type: "image/jpeg" }), "face.jpg");
    form.append("FaceId", String(faceId));
    form.append("Group", String(group));
    const res = await fetch(`${BASE_URL}/v1/face/enrollment/`, {
      method: "POST",
      headers: { ApiToken: token },
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    return { res, body };
  };

  try {
    let token = await getApiToken();
    let { res, body } = await doRequest(token);
    if (isTokenExpired(res.status, body)) {
      apiToken = null;
      token = await getApiToken();
      ({ res, body } = await doRequest(token));
    }
    // 성공 판정: HTTP 2xx + 에러 StatusCode(>=4000) 없음
    const sc = (body as { StatusCode?: number }).StatusCode;
    if (res.ok && !(typeof sc === "number" && sc >= 4000)) {
      const faces = (body as { Faces?: Array<{ FaceId?: string }> }).Faces;
      const enrolledId = Array.isArray(faces) && faces[0]?.FaceId ? faces[0].FaceId : String(faceId);
      return { success: true, faceId: enrolledId };
    }
    const b = body as { StatusMessage?: string; Message?: string };
    return { success: false, message: b.StatusMessage || b.Message || `얼굴 등록 실패 (HTTP ${res.status})` };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : "얼굴 등록 중 오류" };
  }
}

// [얼굴 삭제] 회사(Group) 안 직원(FaceId)의 등록 얼굴을 지운다. (동의 철회·퇴사 시)
export async function unenrollFace(faceId: string, group: string): Promise<FaceResult> {
  const doRequest = async (token: string) => {
    const params = new URLSearchParams();
    params.append("FaceId[]", String(faceId));
    params.append("Group", String(group));
    const res = await fetch(`${BASE_URL}/v1/face/unenrollment/`, {
      method: "POST",
      headers: { ApiToken: token, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const body = await res.json().catch(() => ({}));
    return { res, body };
  };

  try {
    let token = await getApiToken();
    let { res, body } = await doRequest(token);
    if (isTokenExpired(res.status, body)) {
      apiToken = null;
      token = await getApiToken();
      ({ res, body } = await doRequest(token));
    }
    const sc = (body as { StatusCode?: number }).StatusCode;
    if (res.ok && !(typeof sc === "number" && sc >= 4000)) return { success: true };
    const b = body as { StatusMessage?: string; Message?: string };
    return { success: false, message: b.StatusMessage || b.Message || `얼굴 삭제 실패 (HTTP ${res.status})` };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : "얼굴 삭제 중 오류" };
  }
}

// 연결 확인용(설정 여부) — 화면에서 "준비됨"을 판단할 때 사용
export function isFaceConfigured(): boolean {
  return !!(BASE_URL && CLIENT_ID && CLIENT_SECRET && LICENSE_KEY);
}
