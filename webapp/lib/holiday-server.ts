// 공휴일 서버 로직 — 정부 API 수집·저장 + DB 조회 + 화면용 offDays 구성.
// ※ 서버 전용(process.env·prisma 사용). 클라이언트 번들에 들어가면 안 된다.
import { prisma } from "@/lib/db";
import { buildOffDays, locdateToIso, type HolidayLike } from "@/lib/holidays";

// 공공데이터포털 한국천문연구원 특일정보 — 공휴일 정보 조회(getRestDeInfo).
const ENDPOINT = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";

// 한 해 공휴일을 정부 API에서 수집(12개월). 네트워크·형식·인증 오류는 throw한다.
export async function fetchHolidaysForYear(year: number): Promise<HolidayLike[]> {
  const key = process.env.HOLIDAY_API_KEY;
  if (!key) throw new Error("HOLIDAY_API_KEY(공휴일 인증키)가 .env에 없습니다.");

  const out: HolidayLike[] = [];
  for (let m = 1; m <= 12; m++) {
    const url =
      `${ENDPOINT}?solYear=${year}&solMonth=${String(m).padStart(2, "0")}` +
      `&numOfRows=100&_type=xml&ServiceKey=${encodeURIComponent(key)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`공휴일 API 응답 오류(HTTP ${res.status})`);
    const xml = await res.text();

    // 인증·서비스 오류 응답(예: SERVICE_KEY_IS_NOT_REGISTERED_ERROR)을 빨리 잡아 알기 쉽게 알린다.
    const authMsg = xml.match(/<returnAuthMsg>\s*([\s\S]*?)\s*<\/returnAuthMsg>/)?.[1];
    if (authMsg) throw new Error(`공휴일 API 인증 오류: ${authMsg}`);

    for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
      // isHoliday=Y 인 항목만 "쉬는 날"로 본다(국경일 중 공휴일 아닌 날 제외).
      if (!/<isHoliday>\s*Y\s*<\/isHoliday>/.test(item)) continue;
      const loc = item.match(/<locdate>\s*(\d{8})\s*<\/locdate>/)?.[1];
      const iso = loc ? locdateToIso(loc) : null;
      if (!iso) continue;
      const name = item.match(/<dateName>\s*([\s\S]*?)\s*<\/dateName>/)?.[1]?.trim() || "공휴일";
      out.push({ date: iso, name });
    }
  }
  return out;
}

// 여러 해를 수집해 Holiday 표에 저장(연 단위 통째 교체). 실패해도 기존 저장분은 남는다.
// ※ 삭제→삽입은 하나의 트랜잭션이고, 그 앞에서 "0건 응답"을 먼저 막는다(아래). 따라서
//    네트워크·인증 오류(throw)든 0건 응답이든, 그 해 기존 저장분이 지워지는 일은 없다.
export async function syncHolidays(years: number[]): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    let count = 0;
    for (const year of years) {
      const list = await fetchHolidaysForYear(year); // 네트워크·인증 오류면 여기서 throw → 이 연도 저장 안 함
      // 안전장치: 한 해 공휴일이 0건인 경우는 현실적으로 없다(항상 15일+). 0건 = 정부 응답 이상(NODATA·구조변경)으로
      //   보고, 삭제하지 않고 기존 저장분을 보존한다. 지우고 0건을 넣으면 공휴일이 다시 평일 취급돼 지각·결근이 틀어진다.
      if (list.length === 0) {
        throw new Error(`${year}년 공휴일이 0건으로 조회되어 저장을 건너뜁니다(기존 데이터 보존). 잠시 후 다시 시도하세요.`);
      }
      // 같은 payload에 동일 날짜가 중복으로 와도 전역 unique 위반이 나지 않도록 날짜 기준 중복 제거.
      const byDate = new Map<string, { date: string; name: string }>();
      for (const h of list) if (!byDate.has(h.date)) byDate.set(h.date, h);
      const uniq = [...byDate.values()];
      await prisma.$transaction([
        prisma.holiday.deleteMany({ where: { year } }),
        ...uniq.map((h) => prisma.holiday.create({ data: { date: h.date, name: h.name, year } })),
      ]);
      count += uniq.length;
    }
    return { ok: true, count };
  } catch (e) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : "알 수 없는 오류" };
  }
}

// 저장된 전국 공휴일 조회(연도 목록).
export async function getNationalHolidays(years: number[]): Promise<HolidayLike[]> {
  if (!years.length) return [];
  return prisma.holiday.findMany({
    where: { year: { in: years } },
    select: { date: true, name: true },
  });
}

// 회사 수동 휴무일 조회(해당 연도들만). date는 문자열이라 연도 prefix로 거른다(회사당 개수 적음).
export async function getCompanyHolidays(companyId: string, years: number[]): Promise<HolidayLike[]> {
  if (!years.length) return [];
  const rows = await prisma.companyHoliday.findMany({
    where: { companyId },
    select: { date: true, name: true },
  });
  const ys = new Set(years.map(String));
  return rows.filter((r) => ys.has(r.date.slice(0, 4)));
}

// 기간이 걸치는 연도 목록(start~end 포함).
export function yearsInRange(start: Date, end: Date): number[] {
  const ys: number[] = [];
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) ys.push(y);
  return ys;
}

// 화면 판정용 "쉬는 날 ISO 집합" 한 번에 구성.
// holidayAutoOn=false면 전국 공휴일은 조회조차 하지 않고, 회사 수동 휴무일만 적용한다.
export async function loadOffDays(
  companyId: string,
  holidayAutoOn: boolean,
  start: Date,
  end: Date
): Promise<Set<string>> {
  const years = yearsInRange(start, end);
  const [national, company] = await Promise.all([
    holidayAutoOn ? getNationalHolidays(years) : Promise.resolve([] as HolidayLike[]),
    getCompanyHolidays(companyId, years),
  ]);
  return buildOffDays(national, company, holidayAutoOn);
}
