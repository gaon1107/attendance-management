"use client";
// RangeCalendar를 "서버 페이지에서 바로" 쓰기 위한 얇은 래퍼.
//  · RangeCalendar는 onApply(함수)를 받는데, 함수는 서버→클라이언트로 넘길 수 없다.
//    이 래퍼가 useRouter를 갖고 있어, 서버 페이지는 basePath(문자열)만 넘기면 된다.
//  · [적용] 시 `${basePath}?from=..&to=..`(+extraQuery)로 이동 → 서버가 그 기간을 다시 조회.
import { useRouter } from "next/navigation";
import { RangeCalendar } from "./RangeCalendar";

export function RangeCalendarNav({
  from,
  to,
  todayISO,
  basePath,
  extraQuery,
}: {
  from: string;
  to: string;
  todayISO: string;
  basePath: string;
  extraQuery?: Record<string, string>;
}) {
  const router = useRouter();
  return (
    <RangeCalendar
      from={from}
      to={to}
      todayISO={todayISO}
      onApply={(f, t) => {
        const qs = new URLSearchParams({ ...(extraQuery ?? {}), from: f, to: t });
        router.push(`${basePath}?${qs.toString()}`);
      }}
    />
  );
}
