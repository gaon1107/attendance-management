"use client";
// 공통 화면 페이징 훅 — 이미 로드·필터된 배열을 페이지 단위로 잘라 보여준다(서버 조회 무관, 렌더 부하만 줄임).
//  · page(0-based)·size 상태 보유. 현재 페이지가 범위를 벗어나면 safePage로 파생 보정(클램프, effect 불필요).
//  · resetKey(검색어·필터 시그니처)가 바뀌면 렌더 중 1페이지로 리셋(빈 페이지 방지 — React 권장 "이전값 비교" 패턴).
//  · 처음 개발: 목록 화면 페이징(2026-07). 공통 부품.
import { useMemo, useState } from "react";

export type Pagination<T> = {
  view: T[]; // 현재 페이지에 보여줄 조각
  page: number; // 0-based (범위 보정된 값)
  size: number;
  total: number;
  start: number; // 현재 페이지 첫 항목의 0-based 인덱스(비면 0)
  end: number; // 현재 페이지 마지막 항목의 1-based 인덱스(비면 0)
  pageCount: number;
  setPage: (p: number) => void;
  setSize: (s: number) => void;
};

export function usePagination<T>(items: T[], opts?: { initialSize?: number; resetKey?: unknown }): Pagination<T> {
  const initialSize = opts?.initialSize ?? 100;
  const resetKey = opts?.resetKey;
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(initialSize);
  const [prevKey, setPrevKey] = useState(resetKey);

  // resetKey(검색어·필터)가 바뀌면 렌더 중 1페이지로 리셋(effect 없이 — 연쇄 렌더 회피).
  if (resetKey !== prevKey) {
    setPrevKey(resetKey);
    setPage(0);
  }

  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(Math.max(page, 0), pageCount - 1); // 총건수·크기 변화로 범위 밖이면 파생 보정
  const startIdx = total === 0 ? 0 : safePage * size;
  const view = useMemo(() => items.slice(startIdx, startIdx + size), [items, startIdx, size]);

  return {
    view,
    page: safePage,
    size,
    total,
    start: startIdx,
    end: startIdx + view.length,
    pageCount,
    setPage: (p: number) => setPage(Math.max(0, Math.min(p, pageCount - 1))),
    setSize: (s: number) => {
      setSize(s);
      setPage(0);
    },
  };
}
