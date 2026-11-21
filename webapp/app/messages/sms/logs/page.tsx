// 문자 관리 — 발송 기록(관리자 전용). 메시지 관리 3단계-1.
//  · 데이터: SmsLog. **회사 격리**(companyId = 내 회사)가 최우선 불변식이다.
//  · 기간: createdAt 기준(기본 이번 달). 성능 위해 최대 92일·2,000건으로 제한(로그인 이력과 같은 방식).
//  · 받는 사람 이름은 SmsLog에 없다 — userId로 **지금의** 직원 이름을 찾아 붙인다(초대 문자는 userId가 없어 "—").
//  · 이 화면은 **조회 전용**이다. 직접 보내기는 3-2b, 전송 결과 확정(회신)은 3-3에서 붙는다.
//  · 보관기간: **1년**(2026-11-22 사장님 결정). 이 화면을 열 때 하루 1회 자동 파기가 돈다 — lib/sms-retention.ts.
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { toISODate } from "@/lib/period";
import { formatPhone, maskPhone } from "@/lib/phone";
import { smsKindLabel, smsResultLabel, smsPayerLabel } from "@/lib/sms-labels";
import { purgeExpiredSmsLogs, SMS_RETENTION_DAYS } from "@/lib/sms-retention";
import { MessageTabs } from "@/app/messages/MessageTabs";
import { SmsLogClient, type SmsRow } from "./SmsLogClient";

/** 한 번에 읽는 최대 건수(안전 상한). 넘으면 화면이 "기간을 좁혀 보라"고 알린다. */
const MAX_ROWS = 2000;
/** 한 번에 조회할 수 있는 최대 기간(일). */
const MAX_DAYS = 92;

// Date → "MM-DD HH:MM" (로그인 이력과 같은 표기)
function fmtDateTime(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

export default async function SmsMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  // 관리자 전용 — 직원은 회사 문자 기록을 볼 이유가 없다(사이드바에도 안 보인다).
  if (me.role !== "admin") redirect("/attendance");

  // 보관기간(1년)이 지난 문자 기록 자동 파기의 정기 트리거 — 하루 1회만 실제로 동작한다.
  //  화면 응답을 보낸 뒤(after) 실행되므로 조회 속도에 영향이 없다(접속기록 파기와 같은 방식).
  after(() => purgeExpiredSmsLogs());

  const sp = await searchParams;
  const todayISO = toISODate(new Date());
  const now = new Date();
  const defFrom = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  const defTo = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  // 잘못된 날짜가 URL로 들어와도 화면이 깨지지 않게 형식을 검사하고 기본값으로 돌린다.
  const normISO = (s: string | undefined, fb: string): string => {
    if (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00").getTime())) return s;
    return fb;
  };
  const fromISO = normISO(sp.from, defFrom);
  let toISO = normISO(sp.to, defTo);
  if (toISO < fromISO) toISO = fromISO;
  const start = new Date(fromISO + "T00:00:00");
  const endDay = new Date(toISO + "T00:00:00");
  let end = new Date(endDay);
  end.setDate(end.getDate() + 1);
  const maxEnd = new Date(start);
  maxEnd.setDate(maxEnd.getDate() + MAX_DAYS);
  if (end > maxEnd) {
    end = maxEnd;
    const capEnd = new Date(maxEnd);
    capEnd.setDate(capEnd.getDate() - 1);
    toISO = toISODate(capEnd);
  }

  const logs = await prisma.smsLog.findMany({
    where: { companyId: me.companyId, createdAt: { gte: start, lt: end } },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
  });

  // 받는 사람 이름 — 기록에는 번호만 있다. 지금 같은 회사에 있는 계정의 이름을 붙인다.
  //  · 퇴사자는 계정이 남으므로(soft delete) 이름이 그대로 보인다. 계정을 지웠거나 초대 문자처럼
  //    대상 계정이 없으면 "—"가 된다.
  //  · isOwner는 **번호를 가릴지 판단**하는 데 쓴다(아래 치명 1 주석).
  const userIds = [...new Set(logs.map((l) => l.userId).filter((x): x is string => !!x))];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { companyId: me.companyId, id: { in: userIds } },
        select: { id: true, name: true, employeeNo: true, isOwner: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const rows: SmsRow[] = logs.map((l) => {
    const u = l.userId ? userById.get(l.userId) : undefined;
    const name = u?.name ?? "—";
    // 🔴 [2026-11-22 검수 치명 1] **회사 계정(가입할 때 만든 계정)의 번호만 가린다.**
    //  · 그 번호는 회사 계정을 되찾는 복구용 연락처다. 이 제품은 저장된 복구 번호를 늘 maskPhone으로
    //    가려 보여 주고([계정 설정]), 회사 계정 상세 화면 자체를 막아 둔다(employees/[id] isOwner → notFound).
    //    이 화면이 그 보호를 우회하면 안 된다 — 관리자가 여럿인 회사에서 어깨너머로 샌다.
    //  · phone_verify(복구 번호 확인)·recovery_notice(번호 변경 통지)는 **회사 계정 전용 문자**라
    //    대상 계정을 못 찾아도(계정 삭제 등) 가린다. 판단이 갈리면 가리는 쪽이 안전하다.
    //  · 직원 번호는 가리지 않는다 — [직원 관리]가 이미 전체를 보여 주고, 초대 문자는 userId가 없어
    //    번호가 유일한 식별 수단이다(검수 확인).
    const ownerTarget = (u?.isOwner ?? false) || l.kind === "phone_verify" || l.kind === "recovery_notice";
    const phone = ownerTarget ? maskPhone(l.toNumber) : formatPhone(l.toNumber);
    const kindLabel = smsKindLabel(l.kind);
    const resultLabel = smsResultLabel(l.result);
    const payerLabel = smsPayerLabel(l.viaCompany);
    return {
      id: l.id,
      timeText: fmtDateTime(l.createdAt),
      name,
      employeeNo: u?.employeeNo ?? null,
      phone,
      kindLabel,
      result: l.result,
      resultLabel,
      viaCompany: l.viaCompany,
      payerLabel,
      detail: l.detail ?? "",
      // 검색 대상 — 하이픈 없이 붙여 넣는 관리자를 위해 숫자 원문도 넣는다(검수 경미 9).
      //  ⚠️ 가린 번호(회사 계정)는 **원문을 넣지 않는다.** 넣으면 검색으로 뒷자리를 되짚을 수 있어 가린 의미가 없다.
      search: [name, u?.employeeNo ?? "", phone, ownerTarget ? "" : l.toNumber, kindLabel, resultLabel, payerLabel, l.detail ?? ""]
        .join(" ")
        .toLowerCase(),
    };
  });

  return (
    <AppShell user={me} active="messages-sms" title="문자 관리" subtitle={me.company.name}>
      <MessageTabs active="logs" />
      <SmsLogClient
        rows={rows}
        from={fromISO}
        to={toISO}
        todayISO={todayISO}
        capped={logs.length >= MAX_ROWS}
        retentionDays={SMS_RETENTION_DAYS}
      />
    </AppShell>
  );
}
