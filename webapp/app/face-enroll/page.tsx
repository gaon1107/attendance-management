// 얼굴 등록(직원 본인) — 웹캠으로 본인 얼굴을 촬영해 얼굴서버에 등록한다. (2phase)
// 법적 가드레일: 얼굴=생체정보. 얼굴인증 선택+동의한 본인만. 원본은 우리 DB 미저장(얼굴서버에만).
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { isFaceConfigured } from "@/lib/face";
import { FaceCapture } from "./FaceCapture";

function ymd(d: Date): string {
  return new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default async function FaceEnrollPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  // 🔒 회사 계정은 사람이 아니다 — 본인 근태·생체정보 화면에 들어갈 이유가 없다(검수 2차 3·9).
  if (me.isOwner) redirect("/dashboard");

  const ready = isFaceConfigured();
  const needConsent = me.authMethod !== "face" || !me.faceConsentAt;
  const enrolled = !!me.faceEnrolledAt;

  return (
    <AppShell user={me} active="auth-method" title="얼굴 등록" subtitle={`${me.name} 님`}>
      {/* 웹캠 촬영 화면 — 영상이 화면 중앙에 오도록 이 화면만 가운데 정렬(사장님 결정 2026-07-10) */}
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
      {/* 법적/프라이버시 안내 */}
      <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, padding: "14px 16px", marginBottom: 16, fontSize: 13, color: "#1E40AF", lineHeight: 1.6 }}>
        얼굴은 <b>생체정보(민감정보)</b>입니다. 등록한 얼굴은 <b>얼굴인식 서버에만</b> 저장되고, 이 앱에는 원본이 저장되지 않습니다.
        출퇴근 시 <b>본인 확인</b> 용도로만 사용하며, 언제든 삭제할 수 있습니다.
      </div>

      {!ready && (
        <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 10, padding: "14px 16px", fontSize: 14, color: "#92400E" }}>
          얼굴서버 설정이 아직 없습니다. 관리자에게 문의하세요.
        </div>
      )}

      {ready && needConsent && (
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, fontSize: 14, lineHeight: 1.7 }}>
          얼굴 등록을 하려면 먼저 <b>[인증방식]</b>에서 <b>얼굴인증 선택</b>과 <b>생체정보 동의</b>가 필요합니다.
          <div style={{ marginTop: 12 }}>
            <Link
              href="/auth-method"
              style={{ display: "inline-block", height: 42, lineHeight: "42px", padding: "0 18px", borderRadius: 8, background: "var(--primary)", color: "#fff", fontWeight: 700, fontSize: 14, textDecoration: "none" }}
            >
              인증방식으로 가기
            </Link>
          </div>
        </div>
      )}

      {ready && !needConsent && (
        <>
          {/* 현재 등록 상태 */}
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", marginBottom: 16, fontSize: 14 }}>
            현재 상태:{" "}
            {enrolled ? (
              <b style={{ color: "var(--success)" }}>
                등록됨 <span style={{ color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>({me.faceEnrollCount}/3회)</span>{" "}
                <span style={{ color: "var(--text-sub)", fontWeight: 400 }}>· 최근 {ymd(me.faceEnrolledAt!)}</span>
              </b>
            ) : (
              <b style={{ color: "var(--text-sub)" }}>아직 등록 안 됨</b>
            )}
          </div>

          {/* 웹캠 촬영 + 등록 + 삭제 (클라이언트, 각도 다르게 최대 3회) */}
          <FaceCapture
            initialCount={me.faceEnrollCount}
            minPercent={
              (await prisma.company.findUnique({ where: { id: me.companyId }, select: { faceMinPercent: true } }))?.faceMinPercent ?? 30
            }
          />
        </>
      )}
      </div>
    </AppShell>
  );
}
