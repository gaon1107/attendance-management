// 고객사 사용 안내서 — **어떤 안내서가 있고 어느 파일인지 이 파일 한 곳에서만 정한다.** (사장님 지시 2026-11-20)
//
// 왜 한 곳에 모으나
//  · 화면([도움말] — app/help/page.tsx)과 내려주는 통로(app/api/guide/[slug]/route.ts)가 **같은 목록**을 본다.
//    두 곳에 따로 적으면 한쪽만 고쳐서 "버튼은 보이는데 눌러도 안 열리는" 상태가 된다.
//
// ⚠️ 안내서 원본은 docs/12_안내서/ 에 있고, 그 원본을 굽는 것은 scripts/build-guide.mjs 다(건드리지 않는다).
//    여기서 다루는 것은 webapp 안으로 복사된 **사본**이다. 복사는 scripts/sync-guide.mjs 가 한다.
import fs from "node:fs/promises";
import path from "node:path";
import { cache } from "react";

/** 안내서 종류 — 주소에 그대로 쓰인다(/api/guide/admin).
 *  ⚠️ 글자 타입으로 못 박아 둔다. string 으로 두면 나중에 이름을 바꿨을 때 컴파일이 통과해
 *     **모든 화면에서 [그림까지 자세히 보기] 버튼이 조용히 사라진다**(검수 경미 8). */
export type GuideSlug = "admin" | "employee";

export type GuideDef = {
  slug: GuideSlug; // 주소에 쓰는 이름(/api/guide/admin)
  file: string;   // 사본 폴더 안의 파일 이름 — 내려받을 때 이 이름으로 저장된다
  title: string;
  desc: string;
  /** 관리자만 볼 수 있는가. 🔒 관리자 안내서에는 **관리 화면 캡처 34장**이 들어 있어 직원에게 주지 않는다. */
  adminOnly: boolean;
};

export const GUIDES: GuideDef[] = [
  {
    slug: "admin",
    file: "근태관리_사용안내서.html",
    title: "관리자 사용 안내서",
    desc: "가입 · 직원 등록 · 근태 현황 보는 법",
    adminOnly: true,
  },
  {
    slug: "employee",
    file: "근태관리_직원안내서.html",
    title: "직원용 출퇴근 안내",
    desc: "휴대폰으로 출퇴근 찍는 법 · 휴가와 정정 신청하는 법",
    adminOnly: false,
  },
];

/** 이 역할이 볼 수 있는 안내서인가.
 *  🔴 화면([도움말])과 내려주는 통로(app/api/guide)가 **반드시 이 함수 하나**를 쓴다.
 *     두 곳에서 따로 판단하면 "화면에는 보이는데 눌러도 차단" 또는 그 반대가 조용히 생긴다. */
export function canRead(g: GuideDef, role: string): boolean {
  return g.adminOnly ? role === "admin" : true;
}

// 사본이 놓이는 폴더.
//  · `public/` 이 **아니다.** public 에 두면 로그인하지 않아도 주소만 알면 누구나 받을 수 있고,
//    안내서 안에는 관리자 화면 캡처가 34장 그대로 들어 있다. 반드시 로그인 검사를 거치는 통로로만 내려준다.
//  · process.cwd() = 개발 PC 는 webapp/, 운영 상자(Docker)는 /app → 양쪽에서 같은 자리를 가리킨다.
const GUIDE_DIR = path.join(process.cwd(), "guide-files");

export function guideBySlug(slug: string): GuideDef | null {
  return GUIDES.find((g) => g.slug === slug) ?? null;
}

/** 사본 파일의 전체 경로.
 *  ⚠️ 파일 이름은 위 목록에 **고정**돼 있다 — 주소에서 받은 글자를 경로에 붙이지 않으므로
 *     `../../` 같은 경로 조작으로 다른 파일을 빼내갈 수 없다. */
export function guidePath(g: GuideDef): string {
  return path.join(GUIDE_DIR, g.file);
}

export type GuideInfo = GuideDef & { updatedAt: Date; bytes: number };

/** 사본을 만들 때 scripts/sync-guide.mjs 가 함께 적어 둔 목록표(만든 날짜·크기). */
type Manifest = { files?: Record<string, { bytes?: number; updatedAt?: string; anchors?: string[] } | undefined> };

// cache(): **같은 요청 안에서는 한 번만** 읽는다. 사이드바가 붙은 화면 54곳이 전부 이걸 지나고,
// [도움말] 화면은 한 요청에서 두 번 부른다 — 작은 파일이지만 공짜로 줄일 수 있는 일이다(검수 경미 1).
const readManifest = cache(async function readManifest(): Promise<Manifest> {
  try {
    return JSON.parse(await fs.readFile(path.join(GUIDE_DIR, "manifest.json"), "utf8")) as Manifest;
  } catch {
    // 목록표가 없어도 안내서는 열린다 — 날짜만 파일 시간으로 대신한다(아래).
    return {};
  }
});

/** **실제로 파일이 있는** 안내서만 돌려준다.
 *  · 없는 안내서의 버튼은 화면에 그리지 않는다(눌러도 안 되는 버튼을 보여 주지 않는다).
 *  · 이 부가 기능이 고장 나도 대시보드(본기능)는 떠야 하므로 파일별로 건너뛴다.
 *    ⚠️ 단, **조용히** 건너뛰지는 않는다 — 아무 자국도 안 남기면 "고장"과 "정상"을 구분할 수 없다(검수 중간 3). */
export async function listAvailableGuides(role: string): Promise<GuideInfo[]> {
  const manifest = await readManifest();
  const out: GuideInfo[] = [];
  for (const g of GUIDES) {
    // 볼 수 없는 안내서는 **목록에 담지도 않는다**(없는 것처럼 보인다).
    if (!canRead(g, role)) continue;
    try {
      const st = await fs.stat(guidePath(g));
      if (!st.isFile()) continue;
      // 날짜는 **목록표 우선**. 파일 시간은 git·Docker 를 거치면 "서버가 받은 날"로 바뀌어 거짓이 된다.
      const fromManifest = manifest.files?.[g.file]?.updatedAt;
      const made = fromManifest ? new Date(fromManifest) : null;
      out.push({ ...g, updatedAt: made && !Number.isNaN(made.getTime()) ? made : st.mtime, bytes: st.size });
    } catch (e) {
      console.warn(`[guide] 안내서 사본이 없어 화면에서 숨깁니다: ${g.file} —`, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

/** 화면별 도움말 창의 [그림까지 자세히 보기] 주소를 만든다. 볼 수 없거나 안내서가 없으면 null.
 *  🔴 안내서가 바뀌어 그 장(anchor)이 사라졌으면 **장 없이** 맨 위로 연다 —
 *     없는 장을 가리키면 조용히 엉뚱한 곳(맨 위)으로 가는데, 그럴 바에는 처음부터 맨 위가 정직하다.
 *     장 목록은 사본을 만들 때 기록해 둔다(scripts/sync-guide.mjs → manifest.json). */
export async function guideSectionHref(slug: GuideSlug, anchor: string | undefined, role: string): Promise<string | null> {
  const g = guideBySlug(slug);
  if (!g || !canRead(g, role)) return null;
  try {
    const st = await fs.stat(guidePath(g));
    if (!st.isFile()) return null;
  } catch {
    return null; // 사본이 없다 — 링크를 걸면 눌러도 안 열린다.
  }
  const base = `/api/guide/${g.slug}`;
  if (!anchor) return base;
  const have = (await readManifest()).files?.[g.file]?.anchors ?? [];
  return have.includes(anchor) ? `${base}#${anchor}` : base;
}

/** 2.3MB · 712KB 처럼 사람이 읽기 좋은 크기(1MB 미만은 KB — "0.0MB" 로 보이지 않게). */
export function formatGuideSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}
