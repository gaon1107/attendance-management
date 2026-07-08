// 인증방식 선택 (직원) — 얼굴 / GPS. 얼굴은 강제가 아니며 언제든 바꿀 수 있음(인권위 기준). (리뉴얼 디자인)
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AppShell } from "@/app/components/AppShell";
import { chooseGps, withdrawBiometric } from "@/app/actions/authmethod";

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

  return (
    <AppShell user={me} active="auth-method" title="출퇴근 인증방식" subtitle={`${me.name} 님`} narrow>
      <p style={{ fontSize: 14, color: "var(--text-sub)", marginBottom: 20, lineHeight: 1.6 }}>
        둘 중 하나를 꼭 골라야 하는 건 아니며, 나중에 언제든 바꿀 수 있습니다.
      </p>

      {sp.consented === "1" && (
        <div style={{ background: "#DCFCE7", border: "1px solid #86EFAC", borderRadius: 10, padding: "14px 16px", marginBottom: 16, fontSize: 14, color: "#166534" }}>
          생체정보 이용에 동의하셨습니다. 이제 아래 <b>[얼굴 등록하기]</b>로 본인 얼굴을 등록해 주세요.
        </div>
      )}

      {/* 현재 상태 */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", marginBottom: 20, fontSize: 14 }}>
        현재 인증방식:{" "}
        <b style={{ color: "var(--text)" }}>
          {method === "face" ? "얼굴인증" : method === "gps" ? "GPS(위치)" : "아직 선택 안 함"}
        </b>
        {method === "face" && consentDate && <span style={{ color: "var(--text-sub)" }}> · 생체정보 동의일 {consentDate}</span>}
      </div>

      {/* 얼굴 선택·동의한 경우: 얼굴 등록 화면으로 */}
      {method === "face" && (
        <div style={{ marginBottom: 20 }}>
          <Link
            href="/face-enroll"
            style={{ display: "block", width: "100%", height: 46, lineHeight: "46px", textAlign: "center", background: "var(--primary)", color: "#fff", borderRadius: 8, fontWeight: 700, fontSize: 15, textDecoration: "none" }}
          >
            얼굴 등록하기 →
          </Link>
          <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 8, textAlign: "center" }}>
            웹캠으로 본인 얼굴을 등록하면 출퇴근에서 얼굴로 본인 확인을 할 수 있습니다.
          </div>
        </div>
      )}

      {/* 선택 카드 2개 — 같은 크기·비중 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={cardStyle(method === "face")}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>🙂</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>얼굴인증 사용하기</div>
          <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.5, marginBottom: 14 }}>
            카메라로 본인 확인. 생체정보 동의가 필요합니다.
          </div>
          <Link href="/consent" style={btnStyle("var(--primary)", "#fff")}>
            {method === "face" ? "동의 다시 보기" : "선택"}
          </Link>
        </div>

        <div style={cardStyle(method === "gps")}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>📍</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>GPS만 사용하기</div>
          <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.5, marginBottom: 14 }}>
            위치로 출퇴근 확인. 생체정보를 수집하지 않습니다.
          </div>
          <form action={chooseGps}>
            <button type="submit" style={btnStyle("#fff", "var(--text)", true)}>선택</button>
          </form>
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
    background: "var(--card)",
    border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
    borderRadius: 12,
    padding: 20,
    textAlign: "center",
  };
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
