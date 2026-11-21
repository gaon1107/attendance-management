// 비밀번호 찾기 — 경로가 두 가지다.
//  [A] 문자 인증코드(관리자 없이 밤·주말에도 됨) = **1순위·첫 화면** — 문자 발송이 설정돼 있을 때만 보여준다.
//      · 회사 계정: 가온 계정 문자로 된다(복구 번호를 확인해 둔 경우).
//      · 직원: **그 회사가 비즈모아샷 계정을 연결했을 때만** 된다(2026-11-21 요금 규칙, 메시지 관리 2단계).
//        이 화면은 어느 회사인지 모르므로, 첫 화면이 [A]여도 "연결한 회사만 발송"을 문구로 알린다
//        (ForgotPasswordForm 머리말 🔴 — 2026-11-21 사장님 결정으로 [A]가 1순위).
//  [B] 관리자 승인(기존) — 직원이 문자로 못 찾을 때의 길(2순위). 항상 남겨 둔다.
//
// ⚠️ 이 파일이 서버 컴포넌트인 이유: 문자 발송 설정 여부(.env)는 서버에서만 읽을 수 있다.
//    설정이 안 됐는데 [A]를 보여주면 "인증번호를 보냈다"고 해놓고 영영 오지 않는 화면이 된다.
import { connection } from "next/server";
import { smsConfigured, companySmsSendAvailable } from "@/lib/sms";
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

      <ForgotPasswordForm
        smsEnabled={smsEnabled}
        ownerRecoveryEnabled={OWNER_RECOVERY_ENABLED}
        employeeSmsEnabled={companySmsSendAvailable()}
      />
    </div>
  );
}
