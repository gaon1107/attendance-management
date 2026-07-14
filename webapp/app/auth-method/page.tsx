// 인증방식 선택 (직원) — 얼굴 / GPS. 얼굴은 강제가 아니며 언제든 바꿀 수 있음(인권위 기준). (리뉴얼 디자인)
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AppShell } from "@/app/components/AppShell";
import { chooseGps, withdrawBiometric } from "@/app/actions/authmethod";
import { PHOTO_CONSENT_SINCE } from "@/lib/clock-photo";

export default async function AuthMethodPage({
  searchParams,
}: {
  searchParams: Promise<{ consented?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const sp = await searchParams;

  const method = me.authMethod; // "face" | "gps" | null
  const consentDate = me.faceConsentAt ? new Date(me.faceConsentAt).toLocaleDateString("ko-KR") : null;
  // 사진 보관 문구(2026-07-11)보다 먼저 동의한 사람 — 재동의 전까지 사진이 저장되지 않으므로 안내 배너
  const needReconsent = method === "face" && !!me.faceConsentAt && me.faceConsentAt < PHOTO_CONSENT_SINCE;

  return (
    <AppShell user={me} active="auth-method" title="출퇴근 인증방식" subtitle={`${me.name} 님`}>
      <p style={{ fontSize: 14, color: "var(--text-sub)", marginBottom: 20, lineHeight: 1.6 }}>
        둘 중 하나를 꼭 골라야 하는 건 아니며, 나중에 언제든 바꿀 수 있습니다.
      </p>

      {sp.consented === "1" && (
        <div style={{ background: "#DCFCE7", border: "1px solid #86EFAC", borderRadius: 10, padding: "14px 16px", marginBottom: 16, fontSize: 14, color: "#166534" }}>
          {me.faceEnrolledAt
            ? <>생체정보 이용에 다시 동의하셨습니다. 이미 등록된 얼굴로 계속 사용합니다. (변경은 아래 <b>[얼굴 관리]</b>)</>
            : <>생체정보 이용에 동의하셨습니다. 이제 아래 <b>얼굴인증 카드의 [얼굴 등록하기]</b>로 본인 얼굴을 등록해 주세요.</>}
        </div>
      )}

      {needReconsent && sp.consented !== "1" && (
        <Link
          href="/consent"
          style={{ display: "block", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "14px 16px", marginBottom: 16, fontSize: 14, color: "#92400E", fontWeight: 700, textDecoration: "none" }}
        >
          생체정보 동의 내용이 갱신되었습니다(출퇴근 촬영 사진 보관 항목 추가). 다시 동의해 주세요 →
          <div style={{ fontSize: 12, fontWeight: 400, marginTop: 4, color: "#A16207" }}>
            다시 동의해도 등록된 얼굴은 그대로 유지됩니다. 재동의 전까지는 출퇴근 촬영 사진이 저장되지 않습니다.
          </div>
        </Link>
      )}

      {/* 현재 상태 */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", marginBottom: 20, fontSize: 14 }}>
        현재 인증방식:{" "}
        <b style={{ color: "var(--text)" }}>
          {method === "face" ? "얼굴인증" : method === "gps" ? "GPS(위치)" : "아직 선택 안 함"}
        </b>
        {method === "face" && consentDate && <span style={{ color: "var(--text-sub)" }}> · 생체정보 동의일 {consentDate}</span>}
      </div>

      {/* 선택 카드 2개 — 같은 크기·비중(공통 .split-2: 모바일에서 자동 세로). 얼굴 카드는 상태(미선택→동의→등록)에 따라 버튼이 바뀐다 */}
      <div className="split-2">
        <div style={cardStyle(method === "face")}>
          {method === "face" && <div><CurrentBadge /></div>}
          <div style={{ fontSize: 30, marginBottom: 8 }}>🙂</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>얼굴인증 사용하기</div>
          <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.5, marginBottom: 14 }}>
            카메라로 본인 확인. 생체정보 동의가 필요합니다.
          </div>
          {method !== "face" ? (
            // 1단계: 아직 얼굴을 선택 안 함 → 동의 화면으로
            <Link href="/consent" style={btnStyle("var(--primary)", "#fff")}>선택</Link>
          ) : !me.faceEnrolledAt ? (
            // 2단계: 동의 완료·미등록 → 얼굴 등록
            <>
              <Link href="/face-enroll" style={btnStyle("var(--primary)", "#fff")}>얼굴 등록하기 →</Link>
              <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 8 }}>
                웹캠으로 등록하면 출퇴근에서 얼굴로 본인 확인을 합니다.
              </div>
              <Link href="/consent" style={{ display: "inline-block", marginTop: 8, fontSize: 12, color: "var(--text-sub)", textDecoration: "underline" }}>
                동의 내용 다시 보기
              </Link>
            </>
          ) : (
            // 3단계: 등록 완료 → 관리(추가등록·삭제)
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--success)", marginBottom: 10 }}>
                ✅ 얼굴 등록됨 ({me.faceEnrollCount}/3회)
              </div>
              <Link href="/face-enroll" style={btnStyle("#fff", "var(--text)", true)}>얼굴 관리 (추가등록·삭제)</Link>
              <Link href="/consent" style={{ display: "inline-block", marginTop: 8, fontSize: 12, color: "var(--text-sub)", textDecoration: "underline" }}>
                동의 내용 다시 보기
              </Link>
            </>
          )}
        </div>

        <div style={cardStyle(method === "gps")}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>📍</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>GPS만 사용하기</div>
          <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.5, marginBottom: 14 }}>
            위치로 출퇴근 확인. 생체정보를 수집하지 않습니다.
          </div>
          {method === "gps" ? (
            // 이미 GPS 사용 중 — 버튼 대신 비활성 표시(다시 누를 필요 없음)
            <div style={{ height: 44, lineHeight: "44px", borderRadius: 8, background: "#fff", border: "1px solid var(--border)", color: "var(--text-sub)", fontSize: 14, fontWeight: 700 }}>
              현재 사용 중
            </div>
          ) : (
            // 아직 GPS가 아님 — 이 방식으로 전환하는 파란 버튼
            <form action={chooseGps}>
              <button type="submit" style={btnStyle("var(--primary)", "#fff")}>이 방식으로 선택</button>
            </form>
          )}
        </div>
      </div>

      {/* 얼굴 사용 중이면 철회 */}
      {method === "face" && (
        <form action={withdrawBiometric} style={{ marginTop: 20 }}>
          <button type="submit" style={{ height: 44, padding: "0 18px", border: "1px solid var(--danger)", borderRadius: 8, background: "#fff", color: "var(--danger)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            생체정보 동의 철회 (GPS로 전환)
          </button>
          <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 8 }}>
            철회하면 얼굴 방식을 중단하고 GPS로 출퇴근합니다.
          </div>
        </form>
      )}
    </AppShell>
  );
}

function cardStyle(active: boolean): React.CSSProperties {
  return {
    // 현재 사용 중인 카드는 연한 파란 배경 + 굵은 파란 테두리로 "선택됨"을 또렷이 보여준다.
    background: active ? "#EFF6FF" : "var(--card)",
    border: `${active ? 2 : 1}px solid ${active ? "var(--primary)" : "var(--border)"}`,
    borderRadius: 12,
    padding: 20,
    textAlign: "center",
    position: "relative",
  };
}

// "현재 사용 중" 배지 — 선택된 카드 상단에 표시.
function CurrentBadge() {
  return (
    <div style={{ display: "inline-block", background: "var(--primary)", color: "#fff", fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, marginBottom: 10 }}>
      ✅ 현재 사용 중
    </div>
  );
}
function btnStyle(bg: string, color: string, bordered = false): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    height: 44,
    lineHeight: "44px",
    border: bordered ? "1px solid var(--border)" : "none",
    borderRadius: 8,
    background: bg,
    color,
    fontFamily: "inherit",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "none",
    textAlign: "center",
  };
}
