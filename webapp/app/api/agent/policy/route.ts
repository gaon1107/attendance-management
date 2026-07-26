// [PC 에이전트] 정책 내려주기 — 앱이 5분마다(잠금 중엔 1분마다) 부른다.
//  · 응답에는 "지금 잠가야 하나"를 앱이 계산할 재료만 담긴다(lib/pcoff-policy.ts의 PcOffPolicy 타입이 범위를 못박음).
//  · 이 호출 자체가 생존신호(lastSeenAt) 역할도 한다 → [PC관리]의 온라인 표시 근거.
import { NextResponse } from "next/server";
import { authenticateAgent, touchDevice } from "@/lib/agent-auth";
import { buildPcOffPolicy } from "@/lib/pcoff-policy";

export async function GET(req: Request) {
  const res = await authenticateAgent(req);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  const { auth } = res;

  // 앱 버전은 쿼리로 받아 함께 갱신(설치본 업데이트 안내용). 없으면 기존 값 유지.
  const version = new URL(req.url).searchParams.get("v");

  const policy = await buildPcOffPolicy(auth.user.id, auth.user.companyId);

  // 생존신호 기록은 "있으면 좋은 것"이지 필수가 아니다.
  //  · ⚠️ 여기서 실패(예: SQLite 쓰기 잠금)하면 정책까지 못 내려가고, 앱은 승인된 연장근무를 모른 채 판단하게 된다.
  //    그래서 실패해도 정책은 정상으로 내려보낸다(경고 로그만).
  try {
    await touchDevice(auth.device.id, version ? version.slice(0, 20) : null);
  } catch (e) {
    console.warn("[agent] 생존신호 기록 실패(정책 응답은 정상 처리됨):", e);
  }

  return NextResponse.json(policy, {
    // 정책은 항상 최신이어야 한다 — 브라우저·중간 캐시에 남기지 않는다(승인 즉시 해제가 늦어지지 않게).
    headers: { "Cache-Control": "no-store" },
  });
}
