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
    signal: AbortSignal.timeout(10_000), // 서버 무응답 시 무한 대기 방지
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
    signal: AbortSignal.timeout(10_000), // 서버 무응답 시 무한 대기 방지
  });
  const token = res.headers.get("ApiToken");
  if (!res.ok || !token) {
    // ClientToken이 만료됐을 수 있으니 한 번 다시 로그인해서 재시도
    clientToken = null;
    const ct2 = await getClientToken();
    const res2 = await fetch(`${BASE_URL}/get/token/`, { method: "POST", headers: { ClientToken: ct2 }, signal: AbortSignal.timeout(10_000) });
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

export type FaceRect = { x: number; y: number; width: number; height: number };
type FaceResult = {
  success: boolean;
  message?: string;
  faceId?: string;
  // 등록 시 서버가 실제로 인식한 얼굴 위치(보낸 사진 좌표계) — 화면에 검출 영역을 그릴 때 사용
  faceRect?: FaceRect;
  imageSize?: { width: number; height: number };
};

// 서버 응답(PascalCase)에서 얼굴 위치·이미지 크기를 안전하게 꺼낸다(없으면 undefined)
function parseRect(body: unknown): { faceRect?: FaceRect; imageSize?: { width: number; height: number } } {
  const b = body as {
    ImageSize?: { Width?: number; Height?: number };
    Faces?: Array<{ FaceRect?: { X?: number; Y?: number; Width?: number; Height?: number } }>;
  };
  const r = Array.isArray(b.Faces) ? b.Faces[0]?.FaceRect : undefined;
  const faceRect =
    r && [r.X, r.Y, r.Width, r.Height].every((v) => typeof v === "number")
      ? { x: r.X!, y: r.Y!, width: r.Width!, height: r.Height! }
      : undefined;
  const imageSize =
    typeof b.ImageSize?.Width === "number" && typeof b.ImageSize?.Height === "number"
      ? { width: b.ImageSize.Width, height: b.ImageSize.Height }
      : undefined;
  return { faceRect, imageSize };
}

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
    // 연속 요청 제한(429) — 등록 직전에 크기 확인(detect)을 먼저 부르므로 걸릴 수 있다. 잠시 쉬고 1회 재시도.
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1200));
      ({ res, body } = await doRequest(token));
    }
    // 성공 판정: HTTP 2xx + 에러 StatusCode(>=4000) 없음
    const sc = (body as { StatusCode?: number }).StatusCode;
    if (res.ok && !(typeof sc === "number" && sc >= 4000)) {
      const faces = (body as { Faces?: Array<{ FaceId?: string }> }).Faces;
      const enrolledId = Array.isArray(faces) && faces[0]?.FaceId ? faces[0].FaceId : String(faceId);
      return { success: true, faceId: enrolledId, ...parseRect(body) };
    }
    const b = body as { StatusMessage?: string; Message?: string };
    return { success: false, message: b.StatusMessage || b.Message || `얼굴 등록 실패 (HTTP ${res.status})` };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : "얼굴 등록 중 오류" };
  }
}

type RecognizeResult = {
  success: boolean;
  message?: string;
  faceId?: string;
  similarity?: number;
  faceCount?: number;
  // 인식된 얼굴 위치·이미지 크기(라이브니스 판독 크롭용) — 응답에 없으면 undefined (기존 동작 무변경)
  faceRect?: FaceRect;
  imageSize?: { width: number; height: number };
};

// [얼굴 인식] 사진 1장을 회사(Group) 안에서 "누구인지" 확인한다. (출퇴근 본인확인용)
// 성공 = 얼굴 정확히 1개 + FaceId가 "Unknown"이 아님. 본인 여부(FaceId == 직원 id) 판단은 호출한 쪽에서 한다.
export async function recognizeFace(imageBuffer: Buffer, group: string): Promise<RecognizeResult> {
  const doRequest = async (token: string) => {
    const form = new FormData();
    form.append("Image", new Blob([new Uint8Array(imageBuffer)], { type: "image/jpeg" }), "face.jpg");
    form.append("Group", String(group));
    const res = await fetch(`${BASE_URL}/v1/face/recognize/`, {
      method: "POST",
      headers: { ApiToken: token },
      body: form,
      signal: AbortSignal.timeout(10_000), // 얼굴서버가 멈춰도 화면이 무한 대기하지 않도록 10초 제한
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
    if (res.status === 429) {
      return { success: false, message: "요청이 몰려 있습니다. 잠시 후 다시 시도해 주세요." };
    }
    const sc = (body as { StatusCode?: number }).StatusCode;
    if (!res.ok || (typeof sc === "number" && sc >= 4000)) {
      const b = body as { StatusMessage?: string; Message?: string };
      return { success: false, message: b.StatusMessage || b.Message || `얼굴 인식 실패 (HTTP ${res.status})` };
    }
    const faces = (body as { Faces?: Array<{ FaceId?: string; Similarity?: number }> }).Faces;
    if (!Array.isArray(faces) || faces.length === 0) {
      return { success: false, message: "얼굴을 찾지 못했습니다. 밝은 곳에서 정면으로 다시 시도해 주세요.", faceCount: 0 };
    }
    if (faces.length > 1) {
      return { success: false, message: "얼굴이 여러 개 감지되었습니다. 혼자 화면에 나오도록 다시 시도해 주세요.", faceCount: faces.length };
    }
    const face = faces[0];
    if (!face.FaceId || face.FaceId === "Unknown") {
      return { success: false, message: "등록된 얼굴과 일치하지 않습니다.", faceCount: 1 };
    }
    return { success: true, faceId: String(face.FaceId), similarity: face.Similarity, faceCount: 1, ...parseRect(body) };
  } catch (e) {
    // 통신 실패/시간 초과 — 영어 원문 대신 한국어 안내로 (자세한 원인은 서버 로그로)
    console.error("[face] recognize 요청 실패:", e);
    const timedOut = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
    return {
      success: false,
      message: timedOut
        ? "얼굴서버 응답이 늦어지고 있습니다. 잠시 후 다시 시도하거나 일반 방식을 이용해 주세요."
        : "얼굴서버에 연결하지 못했습니다. 잠시 후 다시 시도하거나 일반 방식을 이용해 주세요.",
    };
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

type DetectResult = {
  success: boolean;
  message?: string;
  faces: FaceRect[];
  imageSize?: { width: number; height: number };
};

// [얼굴 검출] 사진에서 얼굴 위치(들)만 찾는다. 누구인지 식별하지 않는다.
// 용도: 등록 전 "얼굴 크기(비율)" 확인 — 작은 얼굴(멀리 든 사진 등)로 등록되는 것 방지.
export async function detectFaces(imageBuffer: Buffer): Promise<DetectResult> {
  const doRequest = async (token: string) => {
    const form = new FormData();
    form.append("Image", new Blob([new Uint8Array(imageBuffer)], { type: "image/jpeg" }), "frame.jpg");
    const res = await fetch(`${BASE_URL}/v1/face/detect/`, {
      method: "POST",
      headers: { ApiToken: token },
      body: form,
      signal: AbortSignal.timeout(10_000),
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
    if (res.status === 429) return { success: false, faces: [], message: "요청이 몰려 있습니다. 잠시 후 다시 시도해 주세요." };
    const sc = (body as { StatusCode?: number }).StatusCode;
    if (!res.ok || (typeof sc === "number" && sc >= 4000)) {
      const b = body as { StatusMessage?: string; Message?: string };
      return { success: false, faces: [], message: b.StatusMessage || b.Message || `얼굴 검출 실패 (HTTP ${res.status})` };
    }
    const b = body as {
      ImageSize?: { Width?: number; Height?: number };
      Faces?: Array<{ FaceRect?: { X?: number; Y?: number; Width?: number; Height?: number } }>;
    };
    const faces: FaceRect[] = [];
    for (const f of b.Faces ?? []) {
      const r = f.FaceRect;
      if (r && [r.X, r.Y, r.Width, r.Height].every((v) => typeof v === "number")) {
        faces.push({ x: r.X!, y: r.Y!, width: r.Width!, height: r.Height! });
      }
    }
    const imageSize =
      typeof b.ImageSize?.Width === "number" && typeof b.ImageSize?.Height === "number"
        ? { width: b.ImageSize.Width, height: b.ImageSize.Height }
        : undefined;
    return { success: true, faces, imageSize };
  } catch (e) {
    console.error("[face] detect 요청 실패:", e);
    return { success: false, faces: [], message: "얼굴서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

// 연결 확인용(설정 여부) — 화면에서 "준비됨"을 판단할 때 사용
export function isFaceConfigured(): boolean {
  return !!(BASE_URL && CLIENT_ID && CLIENT_SECRET && LICENSE_KEY);
}
