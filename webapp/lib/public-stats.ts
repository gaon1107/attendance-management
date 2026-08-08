// 홈화면(랜딩)에 보여줄 **공개 통계**. 로그인 없이 누구나 보는 숫자라 규칙이 특별하다.
//
// 🔴 이 파일의 3가지 불변식 — 하나라도 깨면 법적·보안 문제가 된다.
//  ① **한 회사·한 사람의 정보는 절대 내보내지 않는다.** 전체 합계·비율만 낸다.
//     (회사 이름·직원 이름·회사별 숫자를 반환값에 넣지 말 것. 로그인 없이 노출된다.)
//     ⚠️ **합계라서 안전한 게 아니다 — 표본이 1이면 합계가 곧 그 회사(그 사람) 값이다.**
//        "사용 중인 회사 1개사"라고 스스로 밝히는 순간 나머지 숫자 전부가 그 회사 한 곳의 정보가 되고,
//        직원이 1명이면 그 사람의 근무시간·출근한 날짜가 공개된다(근로시간은 개인정보).
//        그래서 아래 MIN_* 기준을 넘지 못하면 아무것도 내보내지 않는다(검수 지적 — 치명).
//  ② **테스트·검증 회사(Company.isDemo=true)는 전부 제외한다.** 실고객이 없는데 "사용 중인 회사"로
//     세면 허위표시가 된다. 새 집계를 추가할 때도 반드시 실고객 회사로만 좁힐 것.
//  ③ **숫자를 만들어내지 않는다.** DB에 있는 것만 센다. 데이터가 모자라면 `enough: false`를 돌려
//     화면이 미리보기를 아예 감추게 한다(0건·평평한 그래프를 판매 화면에 띄우지 않기 위해).
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

// ── 공개 최소 기준(익명성 보호) ──
// 이 셋을 **모두** 넘겨야 미리보기를 공개한다. 하나라도 못 넘으면 화면에서 통째로 감춘다.
// 숫자를 낮추면 그만큼 "특정 회사·특정 개인의 값"에 가까워진다 — 낮출 때는 사장님 판단이 필요하다.
const MIN_COMPANIES = 5; // 회사가 몇 곳만 되면 합계에서 개별 회사 값을 되짚기 쉬워진다
const MIN_EMPLOYEES = 20;
const MIN_RECORDS = 50; // 최근 TREND_DAYS일 출퇴근 기록 수
// 도넛(출퇴근 방식 비율)의 **분모** 최소치. 직원 수와 별개로 세야 한다 —
// ⚠️ 직원이 20명이어도 방식을 고른 사람이 1명이면 도넛은 "얼굴인증 100%"가 되고,
//    그건 통계가 아니라 **그 한 사람의 생체정보 동의 선택**을 공개하는 것이다(검수 지적).
const MIN_METHOD_PICKED = 10;

export type LandingStats = {
  /** false면 화면은 미리보기(KPI·차트)를 렌더하지 않는다 */
  enough: boolean;
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
  enough: false,
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
    const real = await prisma.company.findMany({ where: { isDemo: false }, select: { id: true, createdAt: true } });
    const ids = real.map((c) => c.id);
    if (ids.length === 0) return EMPTY; // 실고객 0개사 → 보여줄 것이 없다

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
    // ⚠️ 분모가 MIN_METHOD_PICKED 미만이면 비율 자체를 만들지 않는다(n=1의 "100%"는 통계가 아니다).
    const facePct = pickedN > 0 ? Math.round((faceN / pickedN) * 100) : 0;
    const authMix = pickedN >= MIN_METHOD_PICKED
      ? [{ label: "얼굴인증", pct: facePct }, { label: "GPS", pct: 100 - facePct }]
      : [];

    // ── 보여줄 만한가 ──
    //  ① 최근 기간에 기록이 한 건도 없으면 KPI는 0, 차트는 바닥에 붙은 평평한 선이 된다.
    //     판매용 첫 화면에 그걸 띄우지 않는다(2026-08-09 결정: "실데이터 + 자동 숨김").
    //  ② 🔴 그리고 **표본이 작으면 아예 공개하지 않는다**(위 불변식 ① 참고). 회사가 한두 곳일 때
    //     "1개사 · 3명 · 118시간"을 공개하면 익명 합계가 아니라 그 회사·그 사람의 근태 정보다.
    const enough =
      auth7 >= MIN_RECORDS &&
      ids.length >= MIN_COMPANIES &&
      employees >= MIN_EMPLOYEES &&
      // authMix는 분모(방식을 고른 사람 수)가 MIN_METHOD_PICKED 이상일 때만 채워진다.
      // 도넛이 빌 때 차트 오른쪽이 흰 여백으로 남는 것도 이 조건이 함께 막는다.
      authMix.length > 0;

    return {
      enough,
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
