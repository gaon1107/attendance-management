// 로그인 세션 — 로그인 시 "출입증(토큰)"을 발급해 DB에 저장하고, 브라우저 쿠키엔 토큰만 담는다.
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { prisma } from "./db";

const COOKIE_NAME = "session";

// ── 세션 정책 (검수 M-16, 2026-08-10 사장님 확정) ──────────────────────────
// 역할에 따라 다르게 준다. 한쪽으로 통일하면 둘 중 하나가 반드시 손해다.
//  · 직원: 30일 유지·유휴 만료 없음. **매일 출퇴근을 찍는 앱**이라 개인 폰에서 자주 로그인하게
//    만들면 출퇴근 기록 자체가 번거로워진다(제품의 핵심 기능을 해친다).
//  · 관리자·회사계정: 7일 + 12시간 미사용 시 자동 로그아웃. 남의 개인정보·생체정보·급여를 보는
//    권한이고, 사무실 PC를 켜둔 채 퇴근하는 일이 실제로 흔하다.
//
// 🔴 **회사 계정(isOwner)은 이 조이기의 대상이 아니다.** 왜인지 반드시 읽을 것:
//    회사 계정은 비밀번호를 되찾을 방법이 **하나도 없다**. 관리자 승인 경로도(password-reset.ts),
//    문자 인증 경로도(reset-code.ts) `isOwner`를 명시적으로 제외한다 — 회사 열쇠를 남이 가져가지
//    못하게 막은 것이라 그 자체는 옳다. 그래서 "로그인을 못 하면 복구 수단이 0"이다.
//    여기에 12시간 유휴를 걸면, 평소 안 쓰던 회사 계정이 정작 필요한 순간(관리자 전원 퇴사 등)
//    비밀번호를 기억 못 해 **회사가 영구히 잠긴다.** 회사 계정의 존재 이유가 정반대가 된다(검수 치명 2).
//    → 복구 경로를 먼저 만든 뒤에 조인다. 그전까지는 기존 정책(30일·유휴 없음)을 유지한다.
//    ⏳ 2026-11-21: 복구 경로(문자 인증)를 만들었다(lib/owner-recovery.ts). 단 **운영 서버 문자가 꺼진 동안은
//       여전히 복구 수단이 0**이고, 켜도 번호를 확인해 둔 회사만 되찾을 수 있다. 그래서 아직 조이지 않는다.
//       운영 문자를 켜고 회사들이 번호를 확인한 뒤, 사장님 승인을 받아 조인다(로드맵 ④).
//
// 2026-11-20 사장님 승인: 직원(·회사계정)은 "쓰는 동안 계속 유지" — 마지막 사용 후 30일 안 쓰면 그때 만료.
//   예전엔 로그인 순간부터 30일 고정이라 매일 출퇴근해도 30일째에 한 번 튕겼다(휴대폰 홈 화면 앱 사용 시 불편).
//   · 연장은 아래 getCurrentUser의 "마지막 활동 시각 갱신"(5분에 한 번)에서 DB 만료(expiresAt)를 함께 미는 방식.
//   · 브라우저 쿠키는 길게(COOKIE_LONG_MS) 두고 **실제 만료 판단은 DB**가 한다 — getCurrentUser는 서버 화면에서도
//     불려 쿠키를 다시 쓸 수 없어서다.
//   · 🔒 최대 수명 1년(SESSION_HARD_MAX_MS, 검수 중간 M-1): 연장에 상한이 없으면 출입증(토큰)을 훔친 사람이
//     30일에 한 번만 써도 영구히 로그인된다. 로그인 시각(createdAt)부터 1년이 지나면 무조건 다시 로그인.
//     쿠키도 1년이라 정상 사용자는 잃는 것이 없다(= "쓰는 동안 유지, 단 1년에 한 번은 다시 로그인").
//   · 실무 관리자(짧은 정책)는 그대로: 7일 고정 + 12시간 유휴. 연장하지 않는다.
const EMPLOYEE_MAX_MS = 30 * 24 * 60 * 60 * 1000; // 30일(마지막 사용 기준)
const ADMIN_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 7일
const SESSION_HARD_MAX_MS = 365 * 24 * 60 * 60 * 1000; // 연장해도 넘지 못하는 최대 수명(로그인 시각 기준)
const COOKIE_LONG_MS = SESSION_HARD_MAX_MS; // 직원 쿠키 수명 = 최대 수명(브라우저 상한 400일 이내)
const ADMIN_IDLE_MS = 12 * 60 * 60 * 1000; // 12시간 미사용 → 끊음
/** 마지막 활동 시각을 다시 쓰기까지의 최소 간격. ⚠️ 이게 없으면 화면 열 때마다 DB 쓰기가 터진다. */
const IDLE_TOUCH_MS = 5 * 60 * 1000;

/** 짧은 정책(7일+12시간 유휴)을 적용할 대상인가 — 실무 관리자만. 회사 계정은 위 주석대로 제외. */
function isTightPolicy(u: { role: string; isOwner: boolean }): boolean {
  return u.role === "admin" && !u.isOwner;
}

/**
 * 로그인 성공 시 호출 — 세션 발급 + 쿠키 설정.
 * @param role 호출부가 이미 알고 있으면 넘긴다(로그인 경로는 이미 사용자 행을 읽어 뒀다).
 */
export async function createSession(userId: string, known?: { role: string; isOwner: boolean }): Promise<void> {
  // 넘겨받지 못했으면 조회한다.
  //  ⚠️ 조회가 실패하면 **짧은 쪽**으로 떨어진다. 만료 정책의 기본값은 언제나 안전한(짧은) 쪽이어야 한다
  //     — 예전엔 실패 시 조용히 30일이 나갔다(검수 중간 8).
  let u = known;
  if (!u) {
    const found = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isOwner: true } });
    u = found ?? { role: "admin", isOwner: false }; // 모르면 가장 짧은 정책
  }
  const tight = isTightPolicy(u);
  const maxMs = tight ? ADMIN_MAX_MS : EMPLOYEE_MAX_MS;

  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + maxMs);
  await prisma.session.create({ data: { token, userId, expiresAt, lastSeenAt: now } });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true, // JS로 못 읽게(보안)
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // 관리자 = DB 만료와 같게(7일 고정). 직원 = 길게 — DB 만료가 사용할 때마다 밀리므로 쿠키가 먼저 죽지 않게.
    expires: tight ? expiresAt : new Date(now.getTime() + COOKIE_LONG_MS),
    path: "/",
  });
}

// 현재 로그인한 사용자를 반환(없으면 null). 회사 정보도 함께 가져온다.
// 🔒 임시 비밀번호(mustChangePassword) 상태면 기본적으로 null — 로그인 안 한 것으로 취급한다(9-C).
//    예전엔 AppShell(화면 뼈대)에서만 막아서, AppShell을 안 거치는 엑셀/PDF/API 라우트와
//    서버 액션 전부(156곳)가 임시 비밀번호 상태로도 호출 가능했다. 인증의 근원인 이 함수에서
//    막으면 새 라우트를 만들어도 자동으로 보호된다.
//    예외(allowMustChange: true)는 임시 비밀번호 상태에서도 되어야 하는 3곳뿐:
//    비밀번호 변경 화면·변경 액션(안 열리면 영영 못 바꿈)·로그아웃(기록용 조회).
export async function getCurrentUser(opts?: { allowMustChange?: boolean }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    // 🔒 회사 문자 계정 비밀번호(암호문)는 로그인 정보에 싣지 않는다(2026-11-21, 메시지 관리 1단계 검수 경미 3).
    //    모든 요청의 me.company에 실려 있으면, 누가 me를 화면 쪽으로 통째로 넘기는 순간 암호문이 브라우저로 샌다.
    //    필요한 곳(발송)은 lib/company-sms-account.ts가 따로 읽는다.
    include: { user: { include: { company: { omit: { smsPasswordEnc: true } } } } },
  });
  if (!session) return null;
  const now = new Date();
  // 만료된 세션은 즉시 정리(DB에 쌓이지 않게)하고 로그아웃 처리
  if (session.expiresAt < now) {
    await prisma.session.deleteMany({ where: { token } });
    return null;
  }

  // ── 실무 관리자 유휴 만료(검수 M-16) ──────────────────────────────────
  //  · 직원·회사계정은 대상이 아니다(위 정책 주석 참고).
  //  · ⚠️ lastSeenAt이 없는 세션(이 기능 도입 전에 로그인한 사람)은 **끊지 않고 아래에서 채운다.**
  //    없다고 만료로 보면 기능을 켜는 순간 로그인해 둔 사람이 전부 튕긴다.
  if (isTightPolicy(session.user)) {
    const last = session.lastSeenAt;
    if (last && now.getTime() - last.getTime() > ADMIN_IDLE_MS) {
      await prisma.session.deleteMany({ where: { token } });
      return null;
    }
  }

  // 퇴사(비활성화)된 계정이면 로그인 상태로 보지 않는다(방어).
  if (session.user.deactivatedAt) return null;
  // 🔴 해지(탈퇴)된 회사면 **그 회사 사람 전원**이 로그인 상태가 아니다(2026-11-22, 이용약관 제15조 ①).
  //    · 이 한 줄이 화면·서버액션 전부를 막는다 — 모든 경로가 이 함수를 지나기 때문이다(93개 파일).
  //      개별 화면에 검사를 흩뿌리면 새 화면을 만들 때마다 빠뜨린다.
  //    · 데이터는 그대로 둔다. 되살리면(terminatedAt=null) 즉시 예전처럼 쓸 수 있다.
  //    · 세션 자체는 지우지 않는다 — 되살렸을 때 다시 로그인하지 않아도 되고, 해지가 실수였을 때 흔적이 남는다.
  if (session.user.company.terminatedAt) return null;
  // 임시 비밀번호 상태 차단(위 주석). 화면 경로는 각 페이지의 !me → redirect("/login")를 타고,
  // 로그인 폼에서 다시 로그인하면 auth.ts가 /change-password로 보낸다.
  if (session.user.mustChangePassword && !opts?.allowMustChange) return null;

  // 마지막 활동 시각 갱신 — **5분에 한 번만.**
  //  ⚠️ 조건 없이 쓰면 안 된다. 이 함수는 여러 화면에서 불리고(93개 파일), 모든 사용자·모든 요청마다
  //     쓰기가 생기면 SQLite 쓰기 락이 출퇴근 기록과 경합한다.
  //  ⚠️ 갱신은 **위 검사들을 통과한 뒤에** 한다(검수 경미 10) — 로그인으로 쳐주지도 않는 세션이
  //     자기 유휴 타이머를 계속 연장하면 안 된다.
  //  ⚠️ 조건을 where에 넣어 **한 방(updateMany)으로** 처리한다(검수 경미 9) — 읽고 판단해서 쓰면
  //     같은 세션의 동시 요청이 둘 다 통과해 중복 쓰기가 난다.
  //  · 기록 실패가 로그인 상태를 끊으면 안 되므로 조용히 무시한다(부가 기능).
  if (!session.lastSeenAt || now.getTime() - session.lastSeenAt.getTime() > IDLE_TOUCH_MS) {
    const cutoff = new Date(now.getTime() - IDLE_TOUCH_MS);
    try {
      await prisma.session.updateMany({
        where: { token, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }] },
        // 직원·회사계정은 만료도 "지금부터 30일"로 민다(쓰는 동안 유지). 실무 관리자는 7일 고정이라 손대지 않는다.
        //  ⚠️ 판단 기준은 **지금의 역할**(session.user) — 관리자로 승격되면 owner.ts가 만료를 7일로 당기고,
        //     그 뒤로는 여기서 다시 늘어나지 않는다.
        //  · 임시 비밀번호 상태(로그인 화면·비밀번호 변경 화면에서만 여기까지 옴)는 연장하지 않는다(검수 경미 4).
        //  · 연장 값은 로그인 시각 + 1년을 넘지 않는다(최대 수명, 위 정책 주석).
        data:
          isTightPolicy(session.user) || session.user.mustChangePassword
            ? { lastSeenAt: now }
            : {
                lastSeenAt: now,
                expiresAt: new Date(
                  Math.min(now.getTime() + EMPLOYEE_MAX_MS, session.createdAt.getTime() + SESSION_HARD_MAX_MS)
                ),
              },
      });
    } catch (e) {
      // ⚠️ 에러 객체를 통째로 찍지 않는다 — Prisma 검증 에러는 인자(세션 토큰)를 펼쳐 넣는다(사규 8).
      console.warn("[session] 마지막 활동 시각 갱신 실패(무시):", e instanceof Error ? e.message : String(e));
    }
  }

  return session.user;
}

// 로그아웃 — 세션 삭제 + 쿠키 제거
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token } });
    cookieStore.delete(COOKIE_NAME);
  }
}
