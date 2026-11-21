// 비밀번호 찾기 — 경로가 두 가지다.
//  [A] 문자 인증코드(직원 스스로, 관리자 없이 밤·주말에도 됨) — 문자 발송이 설정돼 있을 때만 보여준다.
//  [B] 관리자 승인(기존) — 전화번호가 없거나 문자가 꺼져 있을 때의 유일한 길. 항상 남겨 둔다.
//
// ⚠️ 이 파일이 서버 컴포넌트인 이유: 문자 발송 설정 여부(.env)는 서버에서만 읽을 수 있다.
//    설정이 안 됐는데 [A]를 보여주면 "인증번호를 보냈다"고 해놓고 영영 오지 않는 화면이 된다.
import { connection } from "next/server";
import { smsConfigured } from "@/lib/sms";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { OWNER_RECOVERY_ENABLED } from "@/lib/owner-recovery";

export default async function ForgotPasswordPage() {
  // 🔴 [2026-11-21 검수 치명 1] 요청마다 새로 그리게 한다. 이 줄이 없으면 Next가 이 화면을 **빌드할 때 한 번**
  //    만들어 고정한다. 운영 빌드(Docker)에는 .env가 없으므로 "문자 꺼짐"으로 굳어, 운영에 문자 계정을 넣어도
  //    문자 인증이 영영 나타나지 않는다(개발 서버는 늘 새로 그려서 시험으로는 안 잡힌다).
  await connection();
  const smsEnabled = smsConfigured();

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
      }}
    >
      {/* 로고 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "var(--primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontWeight: 700,
            fontSize: 18,
          }}
        >
          근
        </div>
        <span style={{ fontSize: 18, fontWeight: 700 }}>근태관리</span>
      </div>

      <ForgotPasswordForm smsEnabled={smsEnabled} ownerRecoveryEnabled={OWNER_RECOVERY_ENABLED} />
    </div>
  );
}
