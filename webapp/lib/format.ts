// [입력 서식 유틸] 전화번호 자동 하이픈 + 큰 숫자 천단위 콤마. 전역 서식기(InputAutoFormat)와 폼에서 공용.
// 규칙은 여기 한 곳에만 둔다(모든 페이지가 이 함수를 통해 같은 서식을 쓴다).

// 한국 전화번호 하이픈: 숫자만 추려 번호 종류에 맞춰 넣는다(최대 11자리). 빈 가운데 그룹은 하이픈을 붙이지 않는다.
//  - 휴대폰(01x): 3-…-4    예) 01062153980 → 010-6215-3980
//  - 서울(02):   2-…-4     예) 0212345678 → 02-1234-5678
//  - 대표번호(15xx·16xx·18xx, 0으로 시작 안 함): 4-4  예) 15441234 → 1544-1234
//  - 기타 지역번호(031·070 등, 0으로 시작): 3-…-4
//  - 위 규칙에 안 맞으면(국가코드 붙은 붙여넣기 등) 원문을 훼손하지 않도록 숫자만 반환한다(잘못된 하이픈 방지).
export function formatKoreanPhone(input: string): string {
  const d = (input.match(/\d/g) || []).join("").slice(0, 11);
  if (d === "") return "";

  let groups: string[];
  if (d.startsWith("02")) {
    if (d.length <= 2) groups = [d];
    else if (d.length <= 5) groups = [d.slice(0, 2), d.slice(2)];
    else if (d.length <= 9) groups = [d.slice(0, 2), d.slice(2, d.length - 4), d.slice(d.length - 4)];
    else groups = [d.slice(0, 2), d.slice(2, 6), d.slice(6, 10)];
  } else if (d.startsWith("01")) {
    if (d.length <= 3) groups = [d];
    else if (d.length <= 7) groups = [d.slice(0, 3), d.slice(3)];
    else if (d.length <= 10) groups = [d.slice(0, 3), d.slice(3, d.length - 4), d.slice(d.length - 4)];
    else groups = [d.slice(0, 3), d.slice(3, 7), d.slice(7, 11)];
  } else if (/^1[0-9]{3}/.test(d) && d.length <= 8) {
    groups = d.length <= 4 ? [d] : [d.slice(0, 4), d.slice(4, 8)];
  } else if (d.startsWith("0")) {
    if (d.length <= 3) groups = [d];
    else if (d.length <= 7) groups = [d.slice(0, 3), d.slice(3)];
    else if (d.length <= 10) groups = [d.slice(0, 3), d.slice(3, d.length - 4), d.slice(d.length - 4)];
    else groups = [d.slice(0, 3), d.slice(3, 7), d.slice(7, 11)];
  } else {
    return d; // 규칙 밖 → 하이픈으로 훼손하지 않고 숫자만
  }
  return groups.filter(Boolean).join("-");
}

// 천단위 콤마: 정수부만 3자리마다 콤마, 소수부는 보존한다. 1,000 미만은 콤마가 붙지 않는다.
//  - 예) 1000 → 1,000 / 1000000 → 1,000,000 / 2000.50 → 2,000.50 / 0.5 → 0.5 / 빈 값 → ""
//  - 소수점은 첫 1개만 인정(이후 점은 무시). 정수 필드에 써도 안전(소수를 삼키지 않음).
export function formatThousands(input: string): string {
  const cleaned = input.replace(/[^\d.]/g, "");
  if (cleaned === "" || cleaned === ".") return "";
  const dot = cleaned.indexOf(".");
  let intPart = dot === -1 ? cleaned : cleaned.slice(0, dot);
  const decPart = dot === -1 ? "" : cleaned.slice(dot + 1).replace(/\./g, ""); // 이후 소수점 제거
  intPart = intPart.replace(/^0+(?=\d)/, ""); // 앞자리 0 제거(마지막 0은 남김)
  if (intPart === "") intPart = "0";
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dot === -1 ? grouped : `${grouped}.${decPart}`;
}

// 서버 저장·계산 전에 콤마 제거(글자칸으로 받은 숫자 파싱용). 예) "1,000,000" → "1000000"
export function stripCommas(input: string): string {
  return input.replace(/,/g, "");
}
