"use client";
// [전역 입력 자동 서식기] 앱 최상단에 1개만 심는다(app/layout.tsx). 화면 전체의 입력을 감시해
//   ① type="tel" → 전화번호 하이픈(010-6215-3980) ② data-format="number" → 천단위 콤마(1,000,000)
//   를 타이핑하는 즉시 적용한다. 이벤트 위임 방식이라 "새로 만든 페이지의 입력칸"도 자동으로 적용된다.
// React 제어(controlled) 입력도 반영되도록 네이티브 setter로 값을 넣고 input 이벤트를 다시 알린다.
import { useEffect } from "react";
import { formatKoreanPhone, formatThousands } from "@/lib/format";

export function InputAutoFormat() {
  useEffect(() => {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;

    function formatterFor(el: HTMLInputElement): ((v: string) => string) | null {
      if (el.matches('input[type="tel"]')) return formatKoreanPhone;
      if (el.matches('input[data-format="number"]')) return formatThousands;
      return null;
    }

    function onInput(e: Event) {
      const el = e.target as HTMLInputElement | null;
      if (!el || el.tagName !== "INPUT") return;
      const fmt = formatterFor(el);
      if (!fmt) return;

      const before = el.value;
      const after = fmt(before);
      if (after === before) return; // 변화 없음 → 재진입/무한루프 방지

      // 커서 앞의 숫자 개수를 기준으로, 서식 후 같은 자리로 커서를 복원한다.
      const caret = el.selectionStart ?? before.length;
      const digitsBeforeCaret = (before.slice(0, caret).match(/\d/g) || []).length;

      if (nativeSetter) nativeSetter.call(el, after);
      else el.value = after;

      let pos = 0;
      let seen = 0;
      while (pos < after.length && seen < digitsBeforeCaret) {
        if (/\d/.test(after[pos])) seen++;
        pos++;
      }
      try {
        el.setSelectionRange(pos, pos);
      } catch {
        // 일부 input 타입은 setSelectionRange 미지원 — 커서 복원만 생략(값은 이미 반영됨)
      }

      // 제어 컴포넌트(React state)가 서식된 값을 받도록 input 이벤트를 다시 발생시킨다.
      // 재진입 시 before===after가 되어 위에서 즉시 return → 루프 없음.
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // 캡처 단계에서 먼저 정규화(다른 onChange보다 앞서 값이 서식된 상태가 되게)
    document.addEventListener("input", onInput, true);
    return () => document.removeEventListener("input", onInput, true);
  }, []);

  return null;
}
