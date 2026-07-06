// 생체정보(얼굴) 이용 동의 화면 — 얼굴 등록 전 별도 명시적 동의(법적 필수). (리뉴얼 디자인: AppShell 적용)
// ※ 아래 문안은 초안입니다. 실제 운영 전 개인정보 전문가·노무사 검토 필요.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AppShell } from "@/app/components/AppShell";
import { ConsentForm } from "./ConsentForm";

const BOXES = [
  { title: "무엇을 수집하나요", body: "얼굴 이미지와 얼굴 특징점(본인 확인용 수치 데이터)." },
  { title: "왜 수집하나요", body: "출퇴근 시 본인 확인 및 근태 기록을 위해서만 사용합니다." },
  { title: "얼마나 보관하나요", body: "재직 중 또는 동의 철회 시까지. 목적 달성·퇴사 시 지체 없이 파기합니다." },
  { title: "어떻게 철회하나요", body: "[인증방식] 화면에서 언제든 동의를 철회하고 삭제를 요청할 수 있습니다." },
];

export default async function ConsentPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  return (
    <AppShell user={me} active="auth-method" title="생체정보 이용 동의" subtitle={`${me.name} 님`} narrow>
      <p style={{ fontSize: 14, color: "var(--text-sub)", marginBottom: 20, lineHeight: 1.6 }}>
        얼굴인증을 사용하려면 아래 내용에 동의가 필요합니다. 동의는 강제가 아니며, GPS 방식으로도 출퇴근할 수 있습니다.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        {BOXES.map((b) => (
          <div key={b.title} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{b.title}</div>
            <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.6 }}>{b.body}</div>
          </div>
        ))}
      </div>

      <ConsentForm />

      <div style={{ textAlign: "center", marginTop: 16 }}>
        <Link href="/auth-method" style={{ fontSize: 13, color: "var(--text-sub)", textDecoration: "none" }}>
          ← 돌아가기
        </Link>
      </div>

      <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 24, lineHeight: 1.6 }}>
        ※ 본 동의 문안은 초안이며, 실제 운영 전 개인정보 전문가·노무사 검토를 거쳐 확정됩니다.
      </div>
    </AppShell>
  );
}
