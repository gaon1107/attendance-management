// 홈화면(랜딩)에 보여줄 **공개 통계**. 로그인 없이 누구나 보는 숫자라 규칙이 특별하다.
//
// 🔴 이 파일의 3가지 불변식 — 하나라도 깨면 법적·보안 문제가 된다.
//  ① **한 회사·한 사람의 정보는 절대 내보내지 않는다.** 전체 합계·비율만 낸다.
//     (회사 이름·직원 이름·회사별 숫자를 반환값에 넣지 말 것. 로그인 없이 노출된다.)
//     ⚠️ 다만 **합계라서 늘 안전한 건 아니다 — 표본이 1이면 합계가 곧 그 회사(그 사람) 값이다.**
//        "가입한 회사 1개사"라고 스스로 밝히는 순간 나머지 숫자가 그 회사 한 곳의 정보가 되고,
//        직원이 1명이면 그 사람의 근무시간·출근한 날짜가 공개된다(근로시간은 개인정보).
//        예전에는 최소 표본(회사5·직원20·기록50)을 못 넘으면 감췄는데,
//        **2026-08-09 사장님 지시로 "처음부터 보여준다"로 바꿨다.** 그래서 이 위험은 코드가 막지 않는다 —
//        약관·개인정보처리방침에 "고객사 통계를 익명 합계로 공개" 근거를 넣는 것이 전제다
//        (project-status.md 0-N에 등재). **다시 감추려면 이 파일에 최소 기준을 되살리면 된다.**
//  ② **테스트·검증 회사(Company.isDemo=true)는 전부 제외한다.** 실고객이 없는데 "가입한 회사"로
//     세면 허위표시가 된다. 새 집계를 추가할 때도 반드시 실고객 회사로만 좁힐 것.
//  ③ **숫자를 만들어내지 않는다.** DB에 있는 것만 센다. 조회가 실패하면 `ok: false`를 돌려
//     화면이 미리보기를 감춘다(0으로 채운 화면을 진짜 데이터처럼 보여주지 않기 위해).
//
// 성능: 공개 페이지라 익명 방문자가 전부 DB를 때린다. 그래서 호출하는 쪽(app/page.tsx)이
//       `export const revalidate`로 5분 캐시를 걸고, 이 함수는 그 안에서 최대 14일치만 읽는다.
import { prisma } from "@/lib/db";
import { workedMinutes, effectiveEnd } from "@/lib/worktime";
import { toISODate } from "@/lib/period";

// 추이 차트와 KPI가 함께 쓰는 기간(일). 화면의 "최근 N일" 글자도 이 값에서 만든다 —
// ⚠️ 여기만 바꾸면 라벨까지 따라 바뀐다. 화면에 "7일"을 손으로 적지 말 것(예전에 그래서
//    40일을 그리는데 라벨은 "최근 7일"이라고 적혀 있었다 — 검증 중 발견).
export const TREND_DAYS = 7;

// ※ 예전에 있던 공개 최소 기준(MIN_COMPANIES 5 · MIN_EMPLOYEES 20 · MIN_RECORDS 50 ·
//    MIN_METHOD_PICKED 10)은 **2026-08-09 사장님 지시("그냥 처음부터 보여줘")로 없앴다.**
//    되살리려면 아래 `ok` 계산에 조건을 다시 넣으면 된다(위 불변식 ① 참고).

export type LandingStats = {
  /** DB 조회 성공 여부. false면 화면이 미리보기를 감춘다(0으로 채운 화면을 진짜처럼 보여주지 않으려고) */
  ok: boolean;
  companies: number;
  companiesNewThisMonth: number;
  employees: number;
  employeesNewThisMonth: number;
  /** 최근 TREND_DAYS일 출퇴근 기록 수(출근+퇴근) — "인증"이 아니다(정정 생성분 포함) */
  auth7: number;
  /** 그 앞 같은 기간 — 증감 배지 계산용 */
  auth7Prev: number;
  /** 최근 TREND_DAYS일 실근무 합계(시간) */
  work7Hours: number;
  work7PrevHours: number;
  trend: { label: string; count: number }[];
  authMix: { label: string; pct: number }[];
};

const EMPTY: LandingStats = {
  ok: false,
  companies: 0, companiesNewThisMonth: 0,
  employees: 0, employeesNewThisMonth: 0,
  auth7: 0, auth7Prev: 0,
  work7Hours: 0, work7PrevHours: 0,
  trend: [], authMix: [],
};

/** 자정 기준 날짜(로컬). 서버 TZ=Asia/Seoul 전제 — 저장소 관례. */
function midnight(offsetDays = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

export async function getLandingStats(): Promise<LandingStats> {
  try {
    // 실고객 회사만. 여기서 좁힌 ids를 아래 모든 집계가 그대로 쓴다(불변식 ②).
    // ⚠️ Attendance에는 Company 관계가 없고 companyId 값만 있어서 `company: { isDemo: false }`로
    //    거를 수 없다. 그래서 id 목록을 먼저 뽑아 `companyId: { in: ids }`로 좁힌다.
    //  🔴 해지(탈퇴)한 회사도 뺀다(2026-11-22 검수 중간 4) — 홈페이지의 "고객사 N개사"에 계속 세면
    //     대외 수치가 실제보다 많아진다(5분 캐시라 눈치채기도 어렵다).
    const real = await prisma.company.findMany({ where: { isDemo: false, terminatedAt: null }, select: { id: true, createdAt: true } });
    const ids = real.map((c) => c.id);
    // ⚠️ 실고객이 0개사여도 여기서 멈추지 않는다("처음부터 보여준다" — 2026-08-09).
    //    `companyId: { in: [] }`는 아무것도 못 맞히므로 아래 집계가 전부 0으로 나오고, 화면은 0을 그대로 보여준다.

    const now = new Date();
    const day0 = midnight(-(TREND_DAYS - 1)); // 최근 구간의 시작(오늘 포함)
    const prev0 = midnight(-(TREND_DAYS * 2 - 1)); // 그 앞 같은 길이 구간의 시작
    // ⚠️ 앞 구간의 **끝**을 "지금까지 흐른 만큼"으로 자른다. 안 자르면 진행 중인 오늘(예: 오전 10시,
    //    6.4일치)을 완전한 7일과 비교해 **매일 오전마다 빨간 감소 배지**가 상시로 붙는다(검수 지적).
    const prevEnd = new Date(prev0.getTime() + (now.getTime() - day0.getTime()));
    const monthStart = new Date();
    monthStart.setHours(0, 0, 0, 0);
    monthStart.setDate(1);
    // 쿼리 하한. ⚠️ clockIn 조건을 **AND로** 걸어야 [companyId, clockIn] 색인을 탄다.
    //    예전엔 `OR: [clockIn>=, clockOut>=]`이라 색인이 무력화되어 회사의 **전 기간** 근태를 훑었다(검수 지적).
    //    이틀 여유를 두는 이유: 밤샘·자정 넘김 근무처럼 출근이 구간 밖이고 퇴근만 안에 걸린 기록을 놓치지 않기 위함.
    //    (이틀보다 오래 열린 기록은 effectiveEnd가 출근일 자정으로 잘라내므로 어차피 이 구간에 기여하지 않는다.)
    // ⚠️ 이 "이틀"은 lib/worktime.ts가 **열린 기록을 24시간 안으로 묶어 준다**는 사실과 짝이다
    //    (openSessionSince·MAX_SHIFT_MS). 그 상수를 48시간 이상으로 올리면 여기도 함께 늘려야 한다 —
    //    안 늘리면 앞 구간 집계가 조용히 적게 잡혀 **증감 배지가 실제보다 좋게** 나온다(검수 지적).
    const scanFrom = new Date(prev0.getTime() - 2 * 86400000);

    const [employees, employeesNewThisMonth, rows, byMethod] = await Promise.all([
      prisma.user.count({ where: { companyId: { in: ids }, isOwner: false, deactivatedAt: null } }),
      prisma.user.count({ where: { companyId: { in: ids }, isOwner: false, deactivatedAt: null, createdAt: { gte: monthStart } } }),
      prisma.attendance.findMany({
        where: { companyId: { in: ids }, clockIn: { gte: scanFrom } },
        select: { clockIn: true, clockOut: true, breaks: { select: { startAt: true, endAt: true } }, user: { select: { isOwner: true } } },
      }),
      prisma.user.groupBy({
        by: ["authMethod"],
        _count: { _all: true },
        where: { companyId: { in: ids }, isOwner: false, deactivatedAt: null, authMethod: { in: ["face", "gps"] } },
      }),
    ]);

    // 회사 계정(isOwner)은 사람이 아니라 마스터 키다 — 근태 집계 대상이 아니다(저장소 관례).
    const atts = rows.filter((r) => !r.user.isOwner);

    // ── 출퇴근 기록 수: 출근 1건 + 퇴근 1건. 각 사건이 "언제 일어났는지"로 날짜를 가른다. ──
    // ⚠️ "인증 건수"라고 부르지 않는다 — 관리자가 [근태 정정]으로 만든 기록은 얼굴·GPS 인증을 거치지
    //    않았는데 여기 함께 세어진다. 광고 문구로 "인증"이라 쓰면 과대 표현이 된다(검수 지적).
    const bucket = new Map<string, number>();
    let auth7 = 0, auth7Prev = 0;
    const countEvent = (at: Date) => {
      if (at >= day0 && at <= now) {
        auth7 += 1;
        const key = toISODate(at);
        bucket.set(key, (bucket.get(key) ?? 0) + 1);
      } else if (at >= prev0 && at < prevEnd) {
        auth7Prev += 1;
      }
    };
    for (const a of atts) {
      countEvent(a.clockIn);
      if (a.clockOut) countEvent(a.clockOut);
    }

    // ── 실근무 합계: 기록의 출근일이 어느 구간인지로 가른다. ──
    // 상한(effectiveEnd)을 함께 적용한다 — 퇴근을 잊어 며칠 열린 기록이 수백 시간으로 부풀지 않게.
    // 다른 화면(대시보드·리포트)과 **같은 기준**이라 숫자가 어긋나지 않는다.
    let work7Min = 0, work7PrevMin = 0;
    for (const a of atts) {
      const mins = workedMinutes(a, effectiveEnd(a.clockIn, a.clockOut, now));
      // `<= now`: 위 countEvent와 **같은 경계 규칙**을 쓴다. 한쪽에만 상한이 있으면 미래 시각 기록이
      //   생겼을 때 두 집계가 어긋난다(지금 미래 기록을 만드는 경로는 없지만 규칙은 맞춰 둔다 — 검수 지적).
      if (a.clockIn >= day0 && a.clockIn <= now) work7Min += mins;
      // 앞 구간도 인증 건수와 같은 자리에서 자른다(위 prevEnd 주석 참고 — 상시 감소 배지 방지).
      else if (a.clockIn >= prev0 && a.clockIn < prevEnd) work7PrevMin += mins;
    }

    // ── 추이: 기록이 없는 날도 0으로 채워 날짜 축이 끊기지 않게 한다. ──
    const trend = Array.from({ length: TREND_DAYS }, (_, i) => {
      const d = midnight(-(TREND_DAYS - 1) + i);
      return {
        label: `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, "0")}`,
        count: bucket.get(toISODate(d)) ?? 0,
      };
    });

    // ── 출퇴근 방식 비율: 아직 방식을 고르지 않은 직원은 제외(비율의 분모에 넣으면 의미가 흐려진다). ──
    // 두 값의 합이 반드시 100이 되게 뒤쪽을 뺄셈으로 구한다(반올림 때문에 99·101이 되는 것 방지).
    const faceN = byMethod.find((m) => m.authMethod === "face")?._count._all ?? 0;
    const gpsN = byMethod.find((m) => m.authMethod === "gps")?._count._all ?? 0;
    const pickedN = faceN + gpsN;
    // 아무도 방식을 고르지 않았으면(분모 0) 비율을 만들 수 없어 도넛을 비운다 — 화면은 꺾은선만 넓게 그린다.
    // 🔴 **여기에는 최소 인원 기준이 없다 — 사장님이 그렇게 확정했다(2026-08-09).**
    //    방식을 고른 사람이 1명이면 도넛은 "얼굴인증 100%"가 되고, 그건 통계가 아니라
    //    **그 한 사람이 생체정보(얼굴) 이용에 동의했다는 사실**을 로그인 없이 공개하는 것이다
    //    (얼굴=민감정보 — 상위 사규 6항). 예전에 `pickedN >= 10` 기준이 있었으나 없앴다.
    //    위험을 짚어 드린 뒤 "그냥 보여 줘"로 재확인받았으므로 **코드로 막지 않는다.**
    //    ⚠️ 그래서 **약관·개인정보처리방침의 "고객사 통계 익명 합계 공개" 조항이 유일한 방어선**이다
    //       (project-status.md 0-N①). 그 조항을 넣을 때 **생체정보 동의 비율도 공개 대상에 포함**시켜야 한다.
    //    되살리려면 아래 `pickedN > 0`을 `pickedN >= N`으로 바꾸면 된다(그것 하나로 도넛만 감춰진다).
    const facePct = pickedN > 0 ? Math.round((faceN / pickedN) * 100) : 0;
    const authMix = pickedN > 0
      ? [{ label: "얼굴인증", pct: facePct }, { label: "GPS", pct: 100 - facePct }]
      : [];

    return {
      // 여기까지 왔으면 조회는 성공했다 → 값이 0이든 아니든 그대로 보여준다("처음부터 보여줘", 2026-08-09).
      ok: true,
      companies: ids.length,
      companiesNewThisMonth: real.filter((c) => c.createdAt >= monthStart).length,
      employees,
      employeesNewThisMonth,
      auth7,
      auth7Prev,
      work7Hours: Math.round(work7Min / 60),
      work7PrevHours: Math.round(work7PrevMin / 60),
      trend,
      authMix,
    };
  } catch (e) {
    // DB가 안 붙어도 홈화면은 떠야 한다(공개 페이지 = 첫인상). 미리보기만 조용히 감춘다.
    // ⚠️ 오류 내용을 화면·반환값에 절대 담지 않는다(DB 구조가 공개로 새어나간다).
    //    대신 **서버 로그에는 반드시 남긴다** — 안 남기면 스키마 오타·마이그레이션 누락·DB 잠금이
    //    모두 "미리보기 숨김"으로만 보여서 고장과 정상 동작을 구분할 수 없다(검수 지적).
    console.error("[public-stats] 홈화면 공개 통계 집계 실패:", e);
    return EMPTY;
  }
}
