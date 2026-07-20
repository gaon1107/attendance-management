"use client";
// 범용 페이징 표 — 서버가 만든 행(<tr> 배열, 행 안의 서버액션 폼 포함)을 받아 페이지 단위로 잘라 렌더한다.
//  · 서버 컴포넌트가 head(<thead>)+rows(<tr>[])+빈문구를 넘기면, 여기서 usePagination으로 슬라이스 + 푸터.
//  · 검색이 없는 "내 신청" 목록 등 서버 렌더 표를 최소 변경으로 페이징할 때 사용.
//  · 처음 개발: 목록 화면 페이징(2026-07). 공통 부품.
import type { ReactNode } from "react";
import { TablePagination } from "./TablePagination";
import { usePagination } from "./usePagination";

export function PaginatedTable({
  head,
  rows,
  colSpan,
  emptyText,
  minWidth = 520,
  initialSize = 100,
}: {
  head: ReactNode;
  rows: ReactNode[];
  colSpan: number;
  emptyText: string;
  minWidth?: number;
  initialSize?: number;
}) {
  const pg = usePagination(rows, { initialSize });
  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth }}>
          {head}
          <tbody>
            {pg.view.length === 0 ? (
              <tr>
                <td colSpan={colSpan} style={{ padding: "28px 16px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>{emptyText}</td>
              </tr>
            ) : (
              pg.view
            )}
          </tbody>
        </table>
      </div>
      <TablePagination pg={pg} />
    </>
  );
}
