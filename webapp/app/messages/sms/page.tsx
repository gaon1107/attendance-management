// [문자 관리]의 진입점 — 사이드바 메뉴가 가리키는 주소다. 실제 화면은 탭별로 나뉘어 있다.
//  · [메시지 발송]으로 보낸다 — 가장 자주 쓰는 화면이다(2026-11-22, 3-2b).
//    바꾸고 싶으면 **여기 주소만** 고치면 된다(사이드바·도움말·북마크를 건드리지 않아도 된다).
//  · 옛 주소에 기간(?from=..&to=..)이 붙어 오면 **기록 화면으로** 들고 간다 — 버리면 북마크가 조용히 이번 달로 돌아간다.
import { redirect } from "next/navigation";

export default async function SmsMessagesIndex({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v) && v.length > 0) qs.set(k, v[0]);
  }
  const query = qs.toString();
  // 기간(from/to)이 붙어 왔으면 기록을 보려던 것이다 — 발송 화면은 그 값을 쓰지 않는다(검수 중간 15).
  if (qs.has("from") || qs.has("to")) redirect(`/messages/sms/logs?${query}`);
  redirect("/messages/sms/send");
}
