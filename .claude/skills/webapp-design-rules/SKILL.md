---
name: webapp-design-rules
description: 근태관리 webapp(Next.js)의 화면(UI 페이지)을 새로 만들거나 고칠 때 항상 지켜야 하는 디자인 기준. 로그인된 관리자/직원 화면을 추가·수정하거나, 레이아웃·사이드바·카드·표·색·반응형을 다룰 때 이 규칙을 먼저 적용한다. (트리거: 화면 추가, 페이지 만들기, UI 수정, 대시보드, 레이아웃, 사이드바, 디자인)
---

# 근태관리 webapp 디자인 룰 (리뉴얼 기준)

> 2026-07-06 리뉴얼 작업에서 확립한 기준. **새 화면을 만들거나 기존 화면을 고칠 때 반드시 이 규칙을 따른다.**
> 위치: `webapp/` (Next.js 16 + React + Prisma + 로컬 SQLite). 실행: `cd webapp && npm run dev` → http://localhost:3000

---

## 0. 절대 원칙 2가지 (먼저 기억)

1. **가짜 데이터 금지.** 화면에는 **실제 DB(Prisma)에 있는 값만** 표시한다. 디자인 목업에 있어도 DB에 없는 값(예: 결재 대기·휴가 신청·주간 출근율·연차)은 **넣지 않는다.** 없는 데이터를 지어내면 거짓 화면이 된다.
2. **공통 뼈대(AppShell)를 반드시 쓴다.** 로그인 후 보는 모든 화면은 `AppShell`로 감싼다. 그래야 사이드바·상단바·폭·반응형이 항상 똑같다. 화면마다 레이아웃을 직접 짜지 않는다.

---

## 1. 화면 뼈대 — 항상 AppShell 사용

로그인된 화면(관리자/직원)은 예외 없이 이렇게 시작한다:

```tsx
import { AppShell } from "@/app/components/AppShell";

export default async function XxxPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  // (관리자 전용이면) if (me.role !== "admin") redirect("/attendance");

  return (
    <AppShell
      user={me}
      active="dashboard"           // 사이드바 활성 항목: dashboard|employees|reports|attendance|auth-method|settings
      title="화면 제목"
      subtitle={me.company.name}    // 선택
      right={<버튼이나 날짜 등>}     // 선택: 상단바 오른쪽
    >                               // ⚠️ narrow 옵션은 2026-07-09부로 사용하지 않는다(전 화면 전체 폭)
      {/* 콘텐츠 */}
    </AppShell>
  );
}
```

- **AppShell**: `webapp/app/components/AppShell.tsx` (사이드바 + 상단바 + 콘텐츠 영역)
- **Sidebar**: `webapp/app/components/Sidebar.tsx` (왼쪽 76px 아이콘 레일, 역할별 링크). 메뉴를 바꾸려면 여기 `ICON`/`LABEL`/`itemsFor` 수정.

---

## 2. 콘텐츠 폭 규칙 (중요 — 사장님 확정 2026-07-09 갱신)

- **모든 화면(관리자·직원)이 PC에서 화면 폭을 꽉 채운다.** `.page`에는 max-width가 없다(좌우 28px 패딩만). AppShell 기본값 그대로 쓰면 된다.
- **`narrow` 옵션은 더 이상 쓰지 않는다.** (구 규칙 "폼=640px 중앙"은 2026-07-09 폐지 — 페이지마다 폭이 달라 들쭉날쭉하다는 사장님 지적)
- 폼 화면이 넓어서 어색하면 **`.split-2`로 2단 카드 배치**한다(폼 | 목록, 정보 | 수정 등). 좁은 화면에선 자동으로 세로로 접힌다.
- **예외(사장님 확정 2026-07-10): 웹캠 촬영이 주인 화면(얼굴 등록 등)은 영상이 화면 중앙에 오도록 콘텐츠를 가운데 정렬**(`<div style={{ maxWidth: 640, margin: "0 auto" }}>` 래퍼)한다.
- 규칙은 `webapp/app/globals.css`의 `.page` / `.split-2`에 정의. **여기 폭을 바꾸면 전 화면에 반영된다.**

---

## 3. 반응형 규칙 (PC/모바일 둘 다) — 클래스만 쓰면 자동

카드 격자와 2단 구성은 **인라인 grid를 직접 쓰지 말고** globals.css의 공통 클래스를 쓴다. 그래야 폰에서 자동으로 접힌다.

| 클래스 | 넓은 화면 | 태블릿(≤920px) | 폰(≤600px) |
|---|---|---|---|
| `.kpi-grid` | 4열 | 2열 | 2열 |
| `.kpi-grid-3` | 3열 | 3열 | 2열 |
| `.dash-split` | 콘텐츠 + 320px 패널 | 세로 스택 | 세로 스택 |
| `.split-2` | 균등 2열 (폼\|목록 등) | 세로 스택 | 세로 스택 |

예) `<div className="kpi-grid" style={{ marginBottom: 16 }}> ...카드 4개... </div>`

- **표(table)는 반드시 `<div style={{ overflowX: "auto" }}>`로 감싸고** table에 `minWidth`를 준다(폰에서 표가 깨지지 않고 가로 스크롤).

---

## 4. 디자인 토큰 (globals.css의 CSS 변수 사용)

색은 하드코딩하지 말고 변수를 쓴다:

| 변수 | 값 | 용도 |
|---|---|---|
| `--primary` | #2563EB | 주색(파랑), 강조·버튼 |
| `--success` | #16A34A | 성공(초록), 근무중 |
| `--warning` | #F59E0B | 주의(주황), 지각·미확인 |
| `--danger` | #DC2626 | 위험(빨강), 퇴근·삭제 |
| `--text` / `--text-sub` | #111827 / #6B7280 | 본문 / 보조 글자 |
| `--border` | #E5E7EB | 테두리 |
| `--bg` / `--card` | #F9FAFB / #FFFFFF | 배경 / 카드 |

- 폰트: Pretendard (globals.css에서 이미 로드).
- 숫자에는 `fontVariantNumeric: "tabular-nums"` (자릿수 정렬).
- 카드/섹션: `background:#fff; border:1px solid var(--border); borderRadius:12; overflow:hidden`.
- 라벨은 `whiteSpace:"nowrap"`로 글자 단위 줄바꿈 방지.

---

## 5. 반복 컴포넌트 패턴 (복붙 기준)

**KPI 카드**
```tsx
<div style={{ background:"#fff", border:"1px solid var(--border)", borderRadius:12, padding:"16px 20px" }}>
  <div style={{ fontSize:13, color:"var(--text-sub)", fontWeight:700, marginBottom:10, whiteSpace:"nowrap" }}>{label}</div>
  <div style={{ fontSize:26, fontWeight:700, fontVariantNumeric:"tabular-nums", lineHeight:1, whiteSpace:"nowrap" }}>
    {value}<span style={{ fontSize:14, fontWeight:400, color:"var(--text-sub)", marginLeft:2 }}>{unit}</span>
  </div>
</div>
```

**표(table)** — 헤더는 회색 배경, 이름 칸은 이니셜 아바타
```tsx
const th = { textAlign:"left", fontSize:13, fontWeight:700, color:"var(--text-sub)", padding:"11px 20px" };
const td = { padding:"12px 20px", fontSize:15, verticalAlign:"middle" };
// thead tr: background:"var(--bg)", borderBottom:"1px solid var(--border)"
// tbody tr: borderBottom:"1px solid #F3F4F6"
// 이니셜 아바타: 30x30 원, background:#EEF2F7, color:#374151, 이름.slice(0,1)
```

**상태 배지(pill)**
```tsx
<span style={{ display:"inline-flex", alignItems:"center", gap:6, height:24, padding:"0 9px", borderRadius:6, background:"#DCFCE7" }}>
  <span style={{ width:6, height:6, borderRadius:"50%", background:"var(--success)" }} />
  <span style={{ fontSize:13, fontWeight:700, color:"#15803D" }}>근무 중</span>
</span>
```

---

## 6. 확인(검증) 절차

새 화면/수정 후 반드시 브라우저로 확인한다:
1. `cd webapp && npm run dev` (또는 프리뷰 서버)
2. 로그인: 관리자 `admin@skytech.co.kr`/`test1234`, 직원 `kim@skytech.co.kr`/`emp12345`
3. **데스크톱(넓은 폭)과 모바일(375px) 둘 다** 확인.
4. 콘솔/서버 오류 0건 확인.

**주의 — CSS 캐시 함정:** `globals.css`를 고쳤는데 화면에 반영이 안 되면, Next 개발서버의 `.next` 빌드 캐시 때문이다. **`webapp/.next` 폴더를 지우고 dev 서버를 재시작**하면 새 CSS가 적용된다.

---

## 7. 파일 지도

- `webapp/app/components/AppShell.tsx` — 공통 뼈대(사이드바+상단바+콘텐츠)
- `webapp/app/components/Sidebar.tsx` — 왼쪽 아이콘 네비게이션(역할별)
- `webapp/app/globals.css` — 디자인 토큰 + 레이아웃/반응형 클래스 (`.page`, `.split-2`, `.kpi-grid`, `.dash-split` 등)
- 화면 예시(이 규칙을 이미 따름): `app/dashboard`(dash-split), `app/settings`·`app/leave`·`app/attendance`(split-2 2단), `app/records`(표 전체 폭)
- 원본 디자인 목업: `근태 관리 디자인 스타일/리뉴얼_화면/*.dc.html`

---

## 8. 새 화면 만들 때 체크리스트

- [ ] `AppShell`로 감쌌는가? (직접 사이드바/상단바 만들지 않음)
- [ ] `narrow`를 쓰지 않았는가? (전 화면 전체 폭 — 폼이 넓어 어색하면 `.split-2` 2단 배치)
- [ ] 카드 격자에 `.kpi-grid`/`.kpi-grid-3`, 2단에 `.dash-split`/`.split-2`를 썼는가? (인라인 grid 금지)
- [ ] 표를 `overflowX:auto`로 감싸고 `minWidth`를 줬는가?
- [ ] 색을 CSS 변수(`var(--...)`)로 썼는가? (하드코딩 금지)
- [ ] **DB에 없는 가짜 데이터를 넣지 않았는가?**
- [ ] 데스크톱 + 모바일(375) 둘 다 브라우저로 확인했는가?
