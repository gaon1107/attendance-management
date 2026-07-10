# 라이브니스(위조 얼굴 차단) 기술 조사 보고서

> **담당**: 얼굴인증·실근무시간 전용 에이전트 (face-auth)
> **작성일**: 2026-07-10
> **연결 문서**: [face-spec.md](face-spec.md) — 특히 "GaonFR는 라이브니스를 판별하지 못한다"는 [0]·[7]의 공백을 메우기 위한 조사
> **조사 범위**: Passive Liveness / Face Anti-Spoofing(FAS) 기술 원리, 온프레미스 오픈소스·상용 SDK, 우리 서버 설치 가능성

---

## ① 사장님용 3줄 요약

1. **설치 가능합니다.** 사진·휴대폰 화면으로 하는 대리출근을 걸러내는 AI(라이브니스)를 **GaonFR를 전혀 건드리지 않고**, 우리 웹앱 서버 옆에 작은 판별 프로그램 하나를 추가로 세우는 방식으로 붙일 수 있습니다. GPU(고성능 그래픽카드) 없이 일반 CPU로 충분합니다.
2. **1차는 무료 오픈소스**(MiniFASNet, 상업 사용 허용 라이선스)로 시작하는 것을 추천합니다. 인쇄 사진·휴대폰 화면 재생 같은 흔한 부정의 대부분을 걸러내며, 추가 비용이 없습니다. 다만 오픈소스는 조명·카메라가 바뀌면 성능이 떨어질 수 있어 **"보조 잠금장치"로 쓰고, 판정 로그를 남겨 관리자가 확인**하는 운영이 필요합니다.
3. **더 강한 차단이 필요해지면 2차로 유료 SDK**(국제 인증 iBeta Level 2 통과 제품, KBY-AI·FacePlugin 등)를 같은 자리에 갈아끼우면 됩니다. 처음부터 유료로 갈 필요는 없습니다.

---

## ② 기술 설명 (쉬운 말)

### 2-1. 라이브니스 검사가 뭔가?

- **라이브니스(Liveness) 검사** = 카메라 앞에 있는 것이 "살아있는 진짜 사람"인지, "사진·화면·가면"인지 구별하는 기술. 얼굴인식(누구인지 맞히기)과는 별개의 검사다.
- 이게 없으면: 동료 사진을 인쇄해 들거나, 휴대폰에 얼굴 동영상을 띄워 카메라에 비추는 것만으로 **대리출근**이 가능하다. GaonFR(우리 사내 얼굴인식 서버)는 "누구인지"만 판별하고 "진짜 사람인지"는 판별하지 못하므로, 이 검사를 우리가 따로 얹어야 한다.

### 2-2. Passive vs Active — 두 가지 방식

| 구분 | Passive(수동형, 무동작) | Active(능동형, 동작 요구) |
|---|---|---|
| 방식 | 사용자가 아무것도 안 해도 됨. **찍힌 이미지 1장(또는 짧은 영상)만 AI가 분석** | "눈 깜빡이세요", "고개 돌리세요" 같은 지시를 주고 반응 확인 |
| 사용자 경험 | 좋음 (출퇴근이 1초면 끝) | 번거로움 (매일 아침 지시 수행) |
| 우회 난이도 | AI 품질에 좌우됨 | **깜빡이는 동영상을 미리 찍어 재생하면 뚫림** (단독으론 약함) |
| 결론 | **본명 검사는 Passive가 주력.** Active는 보조로만 | 등록 시 1회 정도만 쓰는 게 적당 |

### 2-3. Passive AI는 이미지에서 무엇을 보나?

단일 RGB 이미지(일반 웹캠 사진)만으로 다음 단서들을 종합 판별한다:

- **질감(텍스처)**: 종이·화면의 표면 질감은 실제 피부와 미세하게 다르다. AI가 픽셀 수준의 질감 차이를 학습.
- **모아레(moiré) 무늬**: 휴대폰/모니터 화면을 카메라로 다시 찍으면 생기는 물결 줄무늬. 화면 재생 공격의 대표 단서.
- **반사·색 왜곡**: 화면은 스스로 빛을 내고(광원 반사 패턴이 다름), 인쇄물은 색 재현 범위가 좁아 피부색이 미묘하게 왜곡된다.
- **주파수(푸리에) 특성**: 진짜 얼굴과 재촬영 이미지는 이미지의 "주파수 성분"(디테일 분포)이 다르다. MiniFASNet 같은 모델은 이걸 별도 감독 신호로 학습한다.
- **깊이 단서**: 사진·화면은 평평하다. 단일 이미지에서도 입체감 단서(그림자·원근)를 추정해 평면 공격을 잡는다.

### 2-4. 정확도를 말하는 국제 표준 용어

- **APCER** (Attack Presentation Classification Error Rate) = **공격이 통과해버린 비율** (사진을 진짜로 오판). 낮을수록 안전.
- **BPCER** (Bona-fide Presentation Classification Error Rate) = **진짜 사람이 거절당한 비율** (본인을 사진으로 오판). 낮을수록 편리. 두 지표는 임계값에 따라 반비례 관계 — 하나를 조이면 다른 쪽이 올라간다.
- **iBeta 인증** = 미국 공인 시험기관 iBeta가 ISO/IEC 30107-3 표준에 따라 실제 공격을 시도해보는 제3자 인증.
  - **Level 1**: 인쇄 사진, 종이 가면, 화면 재생 공격을 통과해야 함 (통과 기준: 공격 성공률 사실상 0%대)
  - **Level 2**: 실리콘·라텍스·레진 등 **정교한 3D 가면** 공격까지 방어해야 함
  - 상용 SDK 비교 시 "iBeta Level 2 인증/준수(compliant)"가 품질의 사실상 기준선이다. 단, "certified(공식 인증)"와 "compliant(자체 주장)"는 다르므로 계약 전 인증서 확인 필요.

### 2-5. 오픈소스 FAS의 솔직한 한계 — "도메인 일반화" 문제

학계·실무 공통으로 지적되는 FAS 최대 약점: **학습 때 본 카메라·조명·인종·배경과 다른 환경에 가면 성능이 뚝 떨어진다**(cross-domain generalization 실패). CVPR 등 최신 연구가 계속 나오는 이유가 이것이다.

우리에게 주는 시사점:
- 오픈소스 모델(CelebA-Spoof 등 공개 데이터로 학습)은 **우리 고객사 사무실의 웹캠·형광등 환경에서 논문 수치만큼 안 나올 수 있다.** 실제로 MiniFASNet은 저조도·역광에서 취약하다는 실전 보고가 있다.
- 그러므로 도입 시 반드시: ① 우리 환경(실제 사무실 웹캠)으로 **자체 검증 테스트**를 하고 ② 임계값을 보수적으로 잡고 ③ **판정 실패 시 GPS 대체 경로**(이미 face-spec에 있음)와 관리자 알림으로 보완해야 한다. "AI 하나로 100% 차단"은 어떤 제품도 불가능하다.
- 또 하나 중요한 실무 제약: **현재 웹앱이 480px로 줄인 JPEG를 서버에 보내는데, 모아레·질감 단서는 해상도·압축에 민감**하다. 라이브니스용 프레임은 더 높은 해상도(720p 권장)·낮은 압축으로 별도 전송해야 판별력이 산다.

---

## ③ 오픈소스 / 상용 비교표

### 3-1. 온프레미스 오픈소스

| 항목 | MiniVision **Silent-Face-Anti-Spoofing** (MiniFASNet) | Intel **OpenVINO anti-spoof-mn3** | MiniAiLive / FacePlugin GitHub 공개판 |
|---|---|---|---|
| 라이선스 | **Apache-2.0** (상업 사용 가능, 확인함) | **MIT** (상업 사용 가능, Intel이 배포 정리) | 소스는 공개지만 **핵심 모델은 라이선스 키 필요** — 사실상 상용 |
| 모델 크기 | MiniFASNetV1/V2 각 약 0.4M 파라미터 (**수 MB, 초경량**) | MobileNetV3 기반, 128×128 입력, 초경량 | Docker 서버 이미지 형태 |
| CPU 실시간 | **가능** — 모바일 CPU에서도 20~40ms 수준, 서버 CPU면 여유 | **가능** — OpenVINO가 Intel CPU 최적화 전문 | CPU 가능 (Docker) |
| Windows 구동 | Python(PyTorch/ONNX 변환) — **Windows OK** | OpenVINO는 Windows 공식 지원 / ONNX 변환도 가능 | **Linux Docker 전제** — Windows Server 2019에서 리눅스 컨테이너는 번거로움 |
| 정확도 평판 | 공개판 기준 오탐률 1e-5에서 본인통과 97.8% **(자사 데이터 기준)**. DeepFace가 `anti_spoofing=True` 옵션으로 내장 채택 → 사실상 오픈소스 표준. CelebA-Spoof 검증 재현 ~98% | CelebA-Spoof 학습, 공개 벤치마크 존재. 단독 검증 자료는 MiniFASNet보다 적음 | iBeta Level 2 주장 (유료 확인 필요) |
| 유지보수 상태 | **2020년 이후 사실상 갱신 중단** (코드는 안정, 신형 공격 대응 갱신은 없음) | Open Model Zoo 유지 (모델 자체 갱신은 없음) | 활발 (영업 목적 공개) |
| 알려진 한계 | 저조도·역광 취약, 카메라 기종 따라 성능 편차, 얼굴 검출 박스 기준 특수한 크롭(2.7x/4x 배율) 전처리 필요, 3D 가면 미검증 | 위와 유사 (같은 계열 학습 데이터) | 무료 사용 불가 |

> **정리**: 오픈소스 실전 선택지는 사실상 **MiniFASNet(Apache-2.0)** 하나로 수렴한다. OpenVINO mn3는 백업 후보. InsightFace는 얼굴인식 라이브러리로 유명하지만 **라이브니스는 오픈소스로 제공하지 않고 상용 SDK에만 포함**한다.

### 3-2. 상용 온프레미스 SDK (2차 후보)

| 항목 | **KBY-AI** Face Liveness SDK | **FacePlugin** Liveness SDK | **Luxand** FaceSDK + 인증 라이브니스 애드온 |
|---|---|---|---|
| 온프레미스 | O — Docker(Linux/Windows), 모바일 SDK, 서버 SDK | O — 크로스플랫폼, Linux 서버 SDK 중심 | O — **Windows DLL 네이티브** (.NET/C#에서 바로 호출 가능) |
| iBeta | Level 1·2 **준수(compliant) 주장**, ISO 30107-3, 자칭 정확도 99.8% | Level 2 **준수 주장** (인쇄·재생·3D마스크·딥페이크) | **iBeta 인증(certified) 라이브니스 애드온** 별도 판매 |
| 방식 | Passive(단일 이미지) + Active 별도 제공 | Passive 3D | 이미지·영상 검사 |
| 가격 구조 | **영구(퍼페추얼) 라이선스** 옵션 있음, 금액은 문의제 | 문의제 (월/영구 옵션) | 본체는 등급별 일회성 구매, 라이브니스 애드온은 별도 라이선스 키 |
| 우리 환경 적합성 | Docker 서버형이 우리 A안 구조와 맞음 | 위와 유사 | **.NET/Windows 친화적**이라 우리 서버와 궁합은 최고. 단 애드온 비용 별도 |
| 유의점 | "compliant" 표현 — 계약 전 **iBeta 공식 인증서 원본 확인** 필수 | 동일 | 인증 범위(Level 1/2)를 문서로 확인 |

- (비교용 1줄) **AWS Rekognition Face Liveness** 등 클라우드형: 정확도·인증은 우수하지만 **얼굴 이미지가 해외 클라우드로 전송되어 생체정보 국외 이전 문제** → 우리 서비스에서는 배제.

---

## ④ 우리 서버 설치 가능성 판단

### 판정: **가능 (조건부)** — GaonFR 무개조 전제로 문제 없음

| 판단 항목 | 결과 | 근거 |
|---|---|---|
| GaonFR 개조 필요? | **불필요** | 라이브니스는 얼굴인식 **앞단의 독립 검사**다. "라이브니스 통과 → GaonFR 등록/인식 호출" 순서로 웹앱이 제어하면 되고, GaonFR API는 지금 그대로 쓴다. (역컴파일 복구 상태인 GaonFR를 건드리지 않는 것이 절대 조건 — 충족) |
| GPU 없는 CPU 서버로 되나? | **된다** | MiniFASNet은 0.4M 파라미터 초경량(모바일 CPU에서도 20~40ms). 서버 CPU에서 이미지 1장 판별에 수십 ms + 얼굴검출 포함해도 1초 미만. 출퇴근은 초당 수십 건이 몰리는 작업이 아니므로 충분 |
| Windows Server 2019 구동? | **된다** | Python + ONNX Runtime(또는 OpenVINO)은 Windows 공식 지원. Node의 onnxruntime-node도 Windows 지원. 단, 상용 SDK 중 Docker(Linux) 전제 제품은 Windows Server 2019에서 번거로우므로 그 경우 웹앱 서버(리눅스) 쪽에 두는 게 낫다 |
| 법적 요건(생체정보) | **충족 가능** | 이미지가 사내/자사 인프라 밖으로 안 나감. 라이브니스 서비스도 face-spec의 원칙과 동일하게 **이미지 무저장(pass-through, 판별 후 메모리 폐기)**으로 설계하면 됨. 클라우드형만 피하면 된다 |
| 조건(리스크) | 아래 2개 | ① 오픈소스 모델의 **환경 일반화 한계** → 도입 전 자체 공격 테스트(사진·휴대폰 화면·모니터·동영상) 필수, 임계값 튜닝 필요 ② **480px 압축 JPEG로는 판별 단서가 뭉개질 수 있음** → 라이브니스용 프레임은 720p·저압축으로 별도 캡처 전송 필요 (웹앱 캡처 코드 소폭 수정) |

### 아키텍처 3안 평가 (GaonFR 무개조 공통)

| 안 | 구성 | 난이도 | 보안 | 성능 | 평가 |
|---|---|---|---|---|---|
| **A안. 별도 라이브니스 마이크로서비스** | 같은 윈도우 서버(또는 웹앱 서버)에 Python(FastAPI)+ONNX CPU 서비스. 웹앱이 [① 라이브니스 API → 통과 시 ② GaonFR 호출] | 중 (서비스 1개 추가 운영) | 사내망 한정 노출, 이미지 무저장 원칙 적용 용이. 웹앱과 분리돼 장애 격리 | 수십 ms | **추천.** 나중에 상용 SDK(Docker)로 갈아끼울 때도 이 API 자리만 교체하면 됨. 얼굴검출(전처리용)도 이 서비스 안에 초경량 검출기를 함께 두면 GaonFR detect 호출 왕복이 없어 빠름 |
| **B안. Node 백엔드 내장** (onnxruntime-node) | Next.js 백엔드에 ONNX 모델 직접 로딩 | **하 (가장 쉬움)** | 별도 서비스 없음. 웹앱 배포에 모델이 묶임 | 수십 ms | **1차 최소구현으로 대안 가능.** 단 MiniFASNet 전처리(얼굴 박스 기준 2.7x/4x 크롭)를 Node에서 직접 구현해야 하고, 상용 전환 시 구조 변경 필요. 파일럿엔 좋고 장기엔 A안이 깔끔 |
| **C안. 브라우저 Active(깜빡임 등)** | MediaPipe로 눈 깜빡임·고개 움직임을 클라이언트에서 확인 | 하 | **단독으론 불충분** — 깜빡이는 동영상 재생으로 우회 가능, 클라이언트 판정은 조작 가능 | 즉시 | **단독 채택 불가, 조합용.** 특히 **얼굴 등록 시 1회** "깜빡여 주세요"를 넣으면 등록 단계의 사진 도용을 값싸게 차단. 매일 출퇴근에는 넣지 않음(UX 저하) |

> **추천 조합**: **A안(서버 Passive) + C안(등록 시에만 Active 1회)**. 판정의 최종 권한은 항상 서버(A안)에 둔다.

---

## ⑤ 추천안과 단계별 도입 로드맵

### 1차 (MVP, 무료·자체 구축) — 예상 작업량: 개발 3~5일 + 자체 공격 테스트 2~3일

1. **라이브니스 마이크로서비스 구축(A안)**: Python + ONNX Runtime(CPU) + MiniFASNet V1/V2 앙상블(두 모델 확률 합산 — DeepFace와 같은 방식). 입력: JPEG 이미지, 출력: `{ real 확률, 판정, 얼굴박스 }`. **이미지는 판별 후 즉시 메모리 폐기, 저장 금지.**
2. **웹앱 흐름 수정**: 등록·출퇴근 인증 시 [라이브니스 통과 → GaonFR 호출] 순서로 변경. 라이브니스용 프레임은 **720p·저압축**으로 캡처(현행 480px 인식용 프레임과 별도).
3. **등록 화면에 Active 1회 추가(C안)**: MediaPipe 깜빡임 확인 — 등록 시에만.
4. **판정 기준·운영 정책** (초기값, 자체 테스트 후 조정):
   - real 확률 **≥ 0.7 → 통과**
   - **0.4 ~ 0.7 → 재촬영 안내** (최대 2회): 안내 문구는 사람을 의심하지 않는 표현으로 — *"조명이나 화면 반사 때문에 얼굴 확인이 어려워요. 밝은 곳에서 카메라를 정면으로 보고 다시 시도해 주세요."*
   - **< 0.4 → 얼굴인증 차단 + GPS 대체 안내**: *"얼굴 확인이 되지 않아 얼굴 출근을 진행할 수 없어요. GPS 출근을 이용해 주세요."* (부정 사용 지목·비난 문구 금지 — 오탐 가능성 항상 존재)
   - 3회 연속 실패 또는 <0.4 판정 발생 시 **관리자 대시보드에 기록·알림** (판정 점수만 기록, 이미지는 저장하지 않음 — 이미지 보존이 필요하다는 요구가 나오면 별도 동의 항목·보존기간을 보안 검토와 함께 재설계)
5. **자체 공격 테스트(완료 조건)**: 실제 사무실 웹캠 환경에서 ① 인쇄 사진 ② 휴대폰 화면 사진 ③ 휴대폰 동영상 재생 ④ 모니터 화면 — 각 20회 이상 시도해 차단률 기록, 실사용자 10명 이상으로 오거절률(BPCER) 측정. **목표: 사진·화면 차단률 95% 이상 / 진짜 사람 오거절 5% 이하(재시도 포함 통과 99% 이상).**

### 2차 (부정이 실측되거나 고객 요구 시) — 유료 전환

6. **iBeta Level 2 상용 SDK 도입**: KBY-AI(영구 라이선스, Docker 서버형) / FacePlugin / Luxand(Windows .NET 친화) 중 견적 비교. **계약 전 iBeta 공식 인증서 원본 + 우리 웹캠 이미지로 PoC(성능 검증)** 필수. A안 구조 덕분에 마이크로서비스 안의 모델만 교체하면 됨.
7. **3D 가면·딥페이크 인젝션**(카메라 신호에 가짜 영상 주입) 등 고급 공격 대응은 2차 SDK 선정 기준에 포함. 1차 오픈소스는 3D 가면 방어를 보장하지 않음을 보안 검토서에 명시.
8. 판정 로그 통계로 임계값 재튜닝, 고객사별 조명 환경 이슈 대응.

### 보안·법무 체크 (security-architect 검토 대상)

- 라이브니스 서비스도 얼굴 이미지를 다루므로 **face-spec과 동일한 원칙 적용**: HTTPS 전용, 사내망 한정, 이미지 무저장, 판정 점수만 로그.
- 개인정보 처리방침·생체정보 동의서에 "위조 여부 판별을 위한 자동 분석" 수행 사실 반영 필요 (이미지 추가 보관은 없음).
- GaonFR 서버에는 변경 없음 → 기존 GaonFR 생체정보 의무 점검 항목 그대로 유지.

---

## ⑥ 출처 링크

**기술 원리·인증 기준**
- [Regula — Liveness Detection 개요 (Passive/Active, 공격 유형)](https://regulaforensics.com/blog/liveness-detection/)
- [iApp — iBeta 인증 가이드 (Level 1/2, ISO 30107-3, 통과 기준)](https://iapp.co.th/blog/what-is-ibeta-biometric-testing-complete-guide)
- [Unidata — iBeta Level 3와 신규 표준](https://unidata.pro/blog/ibeta-level-3-new-standards/)
- [Innovatrics — Passive Liveness 문서 (iBeta Level 2 통과 사례)](https://developers.innovatrics.com/digital-onboarding/docs/functionalities/face/passive-liveness-check/)
- [RGB 카메라 FAS 서베이 논문 (질감·모아레·반사 단서)](https://arxiv.org/pdf/2010.04145)

**오픈소스**
- [minivision-ai/Silent-Face-Anti-Spoofing (GitHub)](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing) · [영문 README](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/blob/master/README_EN.md) · [LICENSE = Apache-2.0](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/blob/master/LICENSE)
- [DeepFace의 anti-spoofing 해설 (MiniFASNet 내장, Sefik Serengil)](https://sefiks.com/2024/06/08/face-anti-spoofing-for-facial-recognition-in-python/)
- [MiniFASNet 구조 해설 (DeepWiki — 푸리에 분기, 다중 스케일 크롭)](https://deepwiki.com/minivision-ai/Silent-Face-Anti-Spoofing/2.1-face-anti-spoofing-approach)
- [facenox/face-antispoof-onnx — MiniFASNetV2-SE ONNX 경량판, CelebA-Spoof 70k 검증 ~98%](https://github.com/facenox/face-antispoof-onnx)
- [OpenVINO anti-spoof-mn3 모델 문서](https://docs.openvino.ai/2023.3/omz_models_model_anti_spoof_mn3.html) · [Open Model Zoo 저장소](https://github.com/openvinotoolkit/open_model_zoo/tree/master/models/public/anti-spoof-mn3)
- [MiniFASNet 실전 한계 연구 (저조도·타 환경 취약)](https://www.researchgate.net/publication/399857484_Mitigating_Ethnic_Bias_in_Face_Anti-Spoofing_Systems_Using_MiniFASNet_and_the_SARSpoof_Dataset)

**도메인 일반화(오픈소스 한계) 연구**
- [Test-Time Domain Generalization for FAS (CVPR 2024)](https://openaccess.thecvf.com/content/CVPR2024/papers/Zhou_Test-Time_Domain_Generalization_for_Face_Anti-Spoofing_CVPR_2024_paper.pdf)
- [Physics 기반 데이터 합성으로 교차 도메인 일반화 개선 (IJCV 2024)](https://link.springer.com/article/10.1007/s11263-024-02240-2)

**상용 SDK**
- [KBY-AI Face Liveness Detection SDK (iBeta L1·2 준수, 온프레미스·영구 라이선스)](https://kby-ai.com/face-liveness-detection-sdk/) · [제품 GitHub](https://github.com/kby-ai/Product)
- [FacePlugin Liveness SDK (iBeta L2 준수 주장, 온프레미스)](https://faceplugin.com/face-liveness-detection/) · [GitHub](https://github.com/Faceplugin-ltd/Face-Liveness-Detection-SDK)
- [Luxand FaceSDK — iBeta 인증 라이브니스 애드온 (Windows 온프레미스)](https://www.luxand.com/facesdk/documentation/certifiedliveness.php)
- [MiniAiLive FaceLivenessDetection-SDK-Docker (iBeta L2 인증 주장, 라이선스 키 필요)](https://github.com/MiniAiLive/FaceLivenessDetection-SDK-Docker)
