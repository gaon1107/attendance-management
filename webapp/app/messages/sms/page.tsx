// [문자 관리]의 진입점 — 사이드바 메뉴가 가리키는 주소다. 실제 화면은 탭별로 나뉘어 있다.
//  · 지금은 [발송 기록]으로 보낸다. 3-2b에서 [메시지 발송]이 생기면 **여기 주소만** 그쪽으로 바꾼다
//    (사이드바·도움말·북마크를 건드리지 않아도 된다).
//  · 옛 주소에 붙어 온 기간(?from=..&to=..)을 **그대로 들고 간다** — 버리면 북마크가 조용히 이번 달로 돌아간다(검수 경미 1).
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
  redirect(query ? `/messages/sms/logs?${query}` : "/messages/sms/logs");
}
