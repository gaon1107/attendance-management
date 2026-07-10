// [GaonFR 얼굴서버 연동 — 데모용 축소판]
// 근태 webapp의 lib/face.ts와 동일한 토큰 흐름(2단계)을 쓰되, 데모에 필요한 detect(얼굴 위치)만 제공한다.
// 비밀값은 .env(FACE_*)에만 둔다. 브라우저 노출 금지.

const BASE_URL = (process.env.FACE_API_BASE_URL || "").replace(/\/+$/, "");
const CLIENT_ID = process.env.FACE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.FACE_CLIENT_SECRET || "";
const LICENSE_KEY = process.env.FACE_LICENSE_KEY || "";

let clientToken: { value: string; at: number } | null = null;
let apiToken: { value: string; at: number } | null = null;
const CLIENT_TOKEN_TTL = 23 * 60 * 60 * 1000; // 24h → 23h 안전마진
const API_TOKEN_TTL = 13 * 60 * 1000; // 15분 → 13분 안전마진

export function isConfigured(): boolean {
  return !!(BASE_URL && CLIENT_ID && CLIENT_SECRET && LICENSE_KEY);
}

async function login(): Promise<string> {
  if (!isConfigured()) throw new Error("얼굴서버 설정(.env FACE_*)이 없습니다.");
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE_URL}/login/`, {
    method: "POST",
    headers: { LicenseKey: LICENSE_KEY, Authorization: `Basic ${basic}` },
    signal: AbortSignal.timeout(10_000),
  });
  const token = res.headers.get("ClientToken");
  if (!res.ok || !token) throw new Error(`얼굴서버 로그인 실패 (HTTP ${res.status})`);
  clientToken = { value: token, at: Date.now() };
  return token;
}

async function getClientToken(): Promise<string> {
  if (clientToken && Date.now() - clientToken.at < CLIENT_TOKEN_TTL) return clientToken.value;
  return login();
}

async function fetchApiToken(): Promise<string> {
  const ct = await getClientToken();
  const res = await fetch(`${BASE_URL}/get/token/`, {
    method: "POST",
    headers: { ClientToken: ct },
    signal: AbortSignal.timeout(10_000),
  });
  const token = res.headers.get("ApiToken");
  if (!res.ok || !token) {
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

function isTokenExpired(status: number, body: unknown): boolean {
  if (status === 401 || status === 403) return true;
  return !!(body && typeof (body as { StatusCode?: unknown }).StatusCode === "number" && (body as { StatusCode: number }).StatusCode === 4016);
}

export type FaceRect = { x: number; y: number; width: number; height: number };
export type DetectResult = {
  success: boolean;
  message?: string;
  faces: FaceRect[];
  imageSize?: { width: number; height: number };
};

// [얼굴 검출] 사진에서 얼굴 위치(들)만 찾는다. 누구인지 식별하지 않는다.
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
    console.error("[demo] detect 실패:", e);
    const timedOut = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
    return { success: false, faces: [], message: timedOut ? "얼굴서버 응답 시간 초과" : "얼굴서버에 연결하지 못했습니다." };
  }
}
