// 초대 수락 화면(공개) — 초대 링크로 들어온 직원이 스스로 가입한다.
// 초대가 없거나 이미 쓰였거나 만료됐으면 안내만 보여준다.
import Link from "next/link";
import { prisma } from "@/lib/db";
import { InviteForm } from "./InviteForm";

// 로고 + 카드 공통 껍데기
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 18 }}>근</div>
        <span style={{ fontSize: 18, fontWeight: 700 }}>근태관리</span>
      </div>
      <div style={{ width: "100%", maxWidth: 440, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "36px 36px 32px" }}>
        {children}
      </div>
    </div>
  );
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const invite = await prisma.invite.findUnique({
    where: { token },
    include: { company: true },
  });

  const invalid = !invite || !!invite.usedAt || invite.expiresAt < new Date();

  if (invalid) {
    return (
      <Shell>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>사용할 수 없는 초대예요</div>
        <p style={{ fontSize: 14, color: "var(--text-sub)", lineHeight: 1.6, marginBottom: 24 }}>
          이 초대 링크는 이미 사용됐거나 만료됐습니다(초대는 7일간, 1회만 유효). 관리자에게 새 링크를 요청해주세요.
        </p>
        <Link href="/login" style={{ fontSize: 14, color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
          로그인 화면으로 →
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>{invite!.company.name}에 합류하기</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 24, lineHeight: 1.6 }}>
        아래 정보를 입력하면 계정이 만들어집니다. 비밀번호는 본인만 알 수 있게 직접 정하세요.
      </p>
      <InviteForm token={token} />
      <div style={{ textAlign: "center", fontSize: 13, color: "var(--text-sub)", marginTop: 20 }}>
        이미 계정이 있으세요?{" "}
        <Link href="/login" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>로그인</Link>
      </div>
    </Shell>
  );
}
