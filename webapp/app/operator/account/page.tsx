// 운영자 [내 계정] — 본인 비밀번호·이름 변경. (2026-11-20 사장님 요청)
//
// 🔴 로그인 검사는 **여기 맨 위**에서 한다(layout이 아니라 — app/operator/layout.tsx 주석의 이유 그대로).
// 🔴 이 화면에는 **계정 만들기·남의 계정 건드리기·계정 끄기를 두지 않는다.** 그건 서버에서
//    scripts/create-operator.mjs 로만 한다. 이유는 app/actions/operator.ts 의 [내 계정] 머리말 참고.
import { redirect } from "next/navigation";
import { getCurrentOperator } from "@/lib/operator-session";
// 🔴 고객사용(10자)이 아니라 **운영자용 12자**다. 화면 안내와 서버 검사가 같은 상수를 봐야
//    "화면은 10자라는데 저장은 거부되는"(또는 그 반대) 사고가 안 난다(검수 치명 1).
import { OPERATOR_PASSWORD_MIN_LEN } from "@/lib/password-policy";
import { OperatorHeader } from "../OperatorHeader";
import { OperatorNameForm, OperatorPasswordForm } from "./OperatorAccountForms";

export const dynamic = "force-dynamic";

export default async function OperatorAccountPage() {
  const me = await getCurrentOperator();
  if (!me) redirect("/operator/login");

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <OperatorHeader name={me.name} active="account" />
      <main style={{ padding: "24px 28px", maxWidth: 980 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>내 계정</h1>
        <p style={{ fontSize: 13, color: "var(--text-sub)", margin: "0 0 20px", wordBreak: "keep-all", lineHeight: 1.6 }}>
          로그인 아이디는 <strong>{me.email}</strong> 입니다. 아이디는 이 화면에서 바꿀 수 없습니다 —
          바꾸려면 서버에서 계정을 새로 만들어야 합니다.
        </p>

        <div className="split-2">
          <OperatorPasswordForm minLen={OPERATOR_PASSWORD_MIN_LEN} />
          <OperatorNameForm current={me.name} />
        </div>

        <div
          style={{
            marginTop: 16,
            background: "#fff",
            border: "1px solid var(--border)",
            borderLeft: "4px solid var(--warning)",
            borderRadius: 12,
            padding: "14px 18px",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>잊어버리면 되돌릴 방법이 없습니다</div>
          <p style={{ fontSize: 13, color: "var(--text-sub)", margin: 0, wordBreak: "keep-all", lineHeight: 1.7 }}>
            운영자 계정에는 <strong>비밀번호 찾기·재설정 창구가 없습니다.</strong> 회원사 전체를 볼 수 있는
            계정이라 일부러 만들지 않았습니다. 잊으면 서버에서 직접 다시 정해야 하니,
            새 비밀번호는 안전한 곳에 적어 두세요.
          </p>
        </div>
      </main>
    </div>
  );
}
