# 오픈소스 Anti-Spoofing 심층 비교 — 채택 후보 결정 보고서

> **담당**: 얼굴인증·실근무시간 전용 에이전트 (face-auth)
> **작성일**: 2026-07-10
> **목적**: "공개된(오픈소스) Anti-Spoofing 중 성능이 좋아 우리 근태관리에 실제 채택해도 될 것"을 결정
> **선행 문서**: [liveness-antispoofing-조사.md](liveness-antispoofing-조사.md) (개요·상용 SDK 포함) — 본 문서는 오픈소스만 심층 비교
> **판단 환경**: Windows Server 2019 · GPU 없음(CPU만) · ONNX 배포 · 웹캠 480px JPEG 흐름 · 상업 SaaS(라이선스가 1순위 탈락 기준)

---

## ① 사장님용 3줄 요약

1. **채택 추천 1순위: MiniFASNet 계열**(중국 MiniVision사가 Apache-2.0 무료 라이선스로 공개한 초경량 위조판별 AI) — 모델 2개(V1SE+V2)를 함께 돌려 확률을 합산하는 방식. 세계에서 가장 많이 쓰이는 얼굴인식 파이썬 라이브러리(DeepFace)가 공식 채택한 사실상의 오픈소스 표준이고, CPU만으로 0.1초 안에 판별되며, 상업 서비스에 써도 법적 문제가 없습니다.
2. **예비 후보: Intel OpenVINO anti-spoof-mn3** (MIT 무료 라이선스) — Intel이 배포를 정리한 모델로 우리 서버(Intel CPU)에 최적화되고, 학습 데이터가 더 다양해 1순위와 **동시에 돌려 교차 확인**하는 용도로도 좋습니다.
3. 나머지 후보(CompreFace, CDCN, DeepPixBiS, FLIP 등)는 **라이선스 위험·GPU 필요·기능 미포함** 등으로 탈락입니다. 어떤 오픈소스도 100% 차단은 못 하므로, 채택 확정 전에 우리 사무실 웹캠으로 종이사진·휴대폰화면·동영상 공격 테스트(아래 PoC 계획)를 통과해야 최종 합격입니다.

---

## ② 후보 수집 결과 (2026-07 기준 웹 확인)

넓게 수집한 후보 11개 중, 1차 스크리닝(상업 라이선스·CPU·배포 가능성)을 통과한 **본선 후보 4개**와 **탈락 7개**로 나눴다.

### 본선 후보 비교표

| 평가 기준 | **① MiniFASNet 원본** (minivision-ai/Silent-Face-Anti-Spoofing) | **② DeepFace `anti_spoofing=True`** (serengil/deepface) | **③ yakhyo/face-anti-spoofing** (MiniFASNet ONNX 재구현) | **④ OpenVINO anti-spoof-mn3** (+ 원 저장소 kprokofi) |
|---|---|---|---|---|
| **1. 라이선스** (탈락 1순위 기준) | **Apache-2.0** — 상업 SaaS OK (LICENSE 파일 직접 확인) | **MIT** (DeepFace 본체) + 내장 가중치는 MiniFASNet Apache-2.0 — 상업 OK | **Apache-2.0** — 상업 OK | **MIT** — 상업 OK. Intel이 Open Model Zoo 배포 시 상업 사용 가능으로 정리 |
| **2. 성능·교차환경 일반화 평판** | 자사 데이터 기준 오탐률 1e-5에서 통과율 97.8%(공개판). **실전 평판: 인쇄사진·화면재생은 잘 잡으나 저조도·역광·카메라 편차에 취약**하다는 실측 연구·후기 존재. 고정밀판(99.7%)은 비공개 | 내부적으로 ①의 V1+V2 확률 합산 — 성능 동일. **실사용 이슈에서 "진짜 사람을 spoof로 오판" 보고 존재** → 임계값(0.5)을 낮추는 워크어라운드가 공식 답변. 실전 후기가 가장 많이 축적된 경로 | ①과 동일 가중치(V1SE+V2) — 성능 동일. 검증 수치 자체 제시는 없음 | CelebA-Spoof 기준 AUC 0.998, EER 2.26%, ACER 3.8%. **학습 데이터가 3종**(CelebA-Spoof + LCC-FASD + CASIA-SURF CeFA)으로 ①보다 다양 → 이론상 교차환경에 유리하나 실전 후기 양은 ①②보다 적음 |
| **3. CPU 실시간 / Windows+ONNX 배포** | 0.41~0.43M 파라미터(모델당 약 1.8MB). 모바일 CPU 20~40ms → 서버 CPU 여유. PyTorch 원본 — ONNX 변환 직접 해야 함 | pip 설치 한 줄로 즉시 사용(내부에서 가중치 자동 다운로드). 단 **DeepFace 전체 프레임워크가 딸려옴**(TensorFlow 의존 등 무거움) | **ONNX 변환·추론 코드 완비** — 우리 A안(ONNX Runtime CPU 마이크로서비스)에 바로 이식 가능. 가장 궁합 좋음 | 0.15 GFLOPs 초경량, 128×128 입력. ONNX·OpenVINO IR 둘 다 제공. **Intel CPU 최적화는 후보 중 최고** |
| **4. 유지보수·커뮤니티** | ★약 3천 (오픈소스 FAS 중 최대). **단 2020년 이후 실질 갱신 중단** — 코드는 안정, 신형 공격 대응 갱신 없음 | **DeepFace는 2025~2026 현재도 활발히 커밋·이슈 대응** (★2만+). anti-spoofing 관련 질문·답변 최다 | **2025-12 가중치 릴리스** — 최근 활동 확인됨. ★32로 소규모 (코드가 얇아 우리가 직접 유지 가능한 수준) | 원 저장소는 갱신 중단(★190), Open Model Zoo는 Intel이 저장소 유지. 모델 자체 갱신 없음 |
| **5. 입력 요구 ↔ 우리 480p JPEG 궁합** | 얼굴 검출 박스 기준 **2.7×/4× 배율 크롭 → 80×80 리사이즈**. 최종 입력이 80×80이라 480p로도 동작은 함. 단 "카메라 직접 촬영 이미지"가 전제 — **강한 JPEG 압축은 질감 단서 훼손** → 720p·저압축 권장 | 좌동 (+ 자체 얼굴검출 내장이라 전처리 자동) | 좌동 (얼굴검출기 별도 필요 — 초경량 검출기 동봉 구성 가능) | 얼굴 크롭 → **128×128 리사이즈** 단일 크롭 — 전처리가 가장 단순 |

### 본선 4개의 관계 정리 (중요)

①②③은 **같은 모델(MiniFASNet)의 세 가지 포장**이다:
- ① = 원본(학습 코드+가중치, PyTorch)
- ② = 원본을 내장한 대형 라이브러리 (검증된 사용법·후기 최다, 대신 무거움)
- ③ = 원본을 ONNX 추론용으로만 얇게 재구현 (우리 배포 형태와 정확히 일치, 최근 갱신)

즉 실질 선택지는 **"MiniFASNet 계열(①②③) vs mn3(④)"** 2파전이다.

---

## ③ 탈락 후보와 사유 (한 줄씩)

| 후보 | 탈락 사유 |
|---|---|
| **Exadel CompreFace** (오픈소스 얼굴인식 서버) | **오픈소스판에 anti-spoofing 기능이 없음** — GitHub 이슈(#802, #1199)로 요청만 있고 미답변/미구현, 라이브니스는 Exadel의 별도 상용 제품군에만 존재 |
| **CDCN / CDCN++** (CVPR 2020, ZitongYu 공개 구현) | 연구용 코드 — 학습 파이프라인 중심으로 배포용 경량 모델·전처리 도구가 없고, 유지보수 중단, 라이선스·가중치 상업 사용 조건 불명확 |
| **DeepPixBiS** (Idiap 연구소) | 원 구현이 Idiap bob 프레임워크(GPL 계열) 기반 — **상업 SaaS 라이선스 위험**, 벤치마크에서도 CDCN에 밀림, 비공식 재구현들은 출처·라이선스 불명 |
| **FLIP** (ICCV 2023, CLIP 기반) | 교차 도메인 일반화 연구로는 우수하나 **CLIP ViT 백본이라 GPU 필수** — CPU 서버 부적합, 라이선스 미표기, 프로덕션 도구 없음 |
| **hairymax/Face-AntiSpoofing** | 구성(CelebA-Spoof 학습+ONNX)은 좋으나 **저장소에 라이선스 파일이 없음** — 상업 사용 근거 부재로 채택 불가 (참고용으로만) |
| **facenox/face-antispoof-onnx** (600KB 경량판) | CelebA-Spoof 70k 검증 ~98%로 참고 가치는 있으나 개인 프로젝트로 검증 주체·라이선스 신뢰도가 낮음 — 원본 가중치를 직접 쓰는 게 안전 |
| **MiniAiLive / FacePlugin / KBY-AI GitHub 공개 저장소** | 소스만 공개, **핵심 모델은 라이선스 키 필요 = 사실상 상용** — "오픈소스" 범위 밖 (상용 후보로는 선행 보고서에 정리) |
| **InsightFace** | 얼굴인식은 오픈소스지만 **라이브니스는 상용 SDK에만 포함** — 오픈소스 후보 아님 |

---

## ④ 결론 — 채택 추천

### 1순위 (채택 권고): **MiniFASNet V1SE+V2 앙상블 — 원본 Apache-2.0 가중치를 ONNX로 직접 구동**

구성: ①원본의 공개 가중치(V1SE 4.0배율 + V2 2.7배율)를 ONNX로 변환(③ yakhyo 저장소의 변환·추론 코드 참고/이식)해, 우리 라이브니스 마이크로서비스(Python + ONNX Runtime CPU)에서 두 모델 확률을 합산 판정. DeepFace(②)와 동일한 검증된 판정 방식.

**근거 5가지**
1. **라이선스 안전**: Apache-2.0 원본 확인 — 상업 SaaS 사용에 법적 걸림 없음 (탈락 1순위 기준 통과).
2. **실전 검증량 최대**: DeepFace가 공식 채택해 전 세계에서 가장 많이 실사용된 오픈소스 FAS — 문제·해법(임계값 조정 등)이 공개적으로 축적돼 있어 운영 리스크 예측 가능.
3. **우리 인프라 완벽 호환**: 모델당 ~1.8MB, CPU 수십 ms, ONNX Runtime은 Windows Server 2019 공식 지원. GPU 불필요.
4. **핵심 공격에 강함**: 우리가 막아야 할 공격은 3D 가면이 아니라 **종이사진·휴대폰 화면·동영상 재생**(대리출근) — 이 평면 공격 대역이 MiniFASNet의 주특기.
5. **의존성 최소**: DeepFace 통째 도입(②) 대신 ONNX 직접 구동을 택하면 TensorFlow 등 무거운 의존성 없이 마이크로서비스가 가볍고, 추후 상용 SDK 교체도 쉬움.

**알려진 약점(운영으로 보완)**: 저조도·역광에서 진짜 사람 오거절 증가, 2020년 이후 모델 갱신 없음(딥페이크 인젝션·3D 가면 미보장). → 임계값 보수 운영 + 재시도 + GPS 대체 경로 + 판정 로그로 보완하고, 한계는 보안 검토서에 명시.

### 예비: **OpenVINO anti-spoof-mn3 (MIT)**

- 학습 데이터 3종으로 교차환경 다양성이 이론상 우위, 전처리(128×128 단일 크롭) 단순, Intel CPU 최적화 최고.
- 활용법: 1순위가 PoC에서 우리 웹캠 환경 성능 미달 시 **교체 후보**, 또는 여유가 되면 **1순위와 동시 구동해 두 판정 불일치 시 재촬영을 요구하는 교차확인(앙상블)** 구성으로 차단률을 올리는 데 사용.

### PoC(검증) 계획 — 이걸 통과해야 최종 채택 확정

**환경**: 실제 사무실 웹캠(고객사 배포 기종과 동일/유사), 조명 3조건(주간 자연광 / 형광등 / 저조도·역광). 라이브니스용 프레임은 720p 저압축으로 캡처하되, **현행 480p JPEG로도 병행 측정해 해상도 영향을 수치로 확인**.

**공격 테스트 (차단률 측정 — APCER)**: 공격자 2인, 각 조명 조건 포함하여
| 공격 유형 | 시도 횟수 | 합격 기준 |
|---|---|---|
| A4 컬러 인쇄 사진 (평면+구부림) | 30회 | 차단 ≥ 95% |
| 휴대폰 화면 정지 사진 | 30회 | 차단 ≥ 95% |
| 휴대폰 동영상 재생 (깜빡임 포함 영상) | 30회 | 차단 ≥ 95% |
| PC 모니터 화면 (사진·영상) | 30회 | 차단 ≥ 95% |

**본인 테스트 (오거절률 측정 — BPCER)**: 실사용자 10명 × 조명 3조건 × 3회 이상 = 100회+
- 합격 기준: 1회 시도 오거절 ≤ 5%, **재시도 2회 포함 최종 통과율 ≥ 99%** (저조도 조건 단독으로도 재시도 포함 ≥ 95%)

**절차**: ① 기본 임계값(real ≥ 0.7)으로 측정 → ② 결과 곡선 보고 임계값 조정(공격 차단 95%를 지키는 선에서 오거절 최소화) → ③ 미달 시 예비(mn3) 단독·앙상블로 재측정 → ④ 그래도 미달이면 상용 SDK 검토로 전환(선행 보고서 2차 로드맵). 모든 결과는 `docs/09_test/`에 기록하고 security-architect 검토에 첨부.

---

## ⑤ 출처 링크

**1순위 후보 (MiniFASNet 계열)**
- [minivision-ai/Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing) · [영문 README (모델 크기·속도·정확도)](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/blob/master/README_EN.md) · [LICENSE = Apache-2.0](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/blob/master/LICENSE)
- [serengil/deepface (anti_spoofing 내장, 활발 유지보수)](https://github.com/serengil/deepface) · [DeepFace anti-spoofing 해설 — 오탐 시 임계값 조정 답변 포함](https://sefiks.com/2024/06/08/face-anti-spoofing-for-facial-recognition-in-python/)
- [yakhyo/face-anti-spoofing — MiniFASNet ONNX 추론, 2025-12 릴리스](https://github.com/yakhyo/face-anti-spoofing)
- [MiniFASNet 구조 해설 (DeepWiki — 푸리에 분기·다중 스케일 크롭·80×80 입력)](https://deepwiki.com/minivision-ai/Silent-Face-Anti-Spoofing/2.1-face-anti-spoofing-approach)
- [MiniFASNet 실전 한계 연구 (저조도·환경 편차 취약)](https://www.researchgate.net/publication/399857484_Mitigating_Ethnic_Bias_in_Face_Anti-Spoofing_Systems_Using_MiniFASNet_and_the_SARSpoof_Dataset)

**예비 후보 (mn3)**
- [OpenVINO anti-spoof-mn3 모델 문서 (128×128 입력, CelebA-Spoof)](https://docs.openvino.ai/2023.3/omz_models_model_anti_spoof_mn3.html) · [Open Model Zoo 저장소 (MIT)](https://github.com/openvinotoolkit/open_model_zoo/tree/master/models/public/anti-spoof-mn3)
- [kprokofi/light-weight-face-anti-spoofing — 원 저장소 (MIT, MN3, 3종 데이터셋, AUC 0.998)](https://github.com/kprokofi/light-weight-face-anti-spoofing)

**탈락 후보 확인 근거**
- [CompreFace 라이브니스 지원 문의 이슈 #1199 (미구현)](https://github.com/exadel-inc/CompreFace/issues/1199) · [이슈 #802](https://github.com/exadel-inc/CompreFace/issues/802)
- [CDCN 논문 (CVPR 2020)](https://openaccess.thecvf.com/content_CVPR_2020/papers/Yu_Searching_Central_Difference_Convolutional_Networks_for_Face_Anti-Spoofing_CVPR_2020_paper.pdf) · [ZitongYu/DeepFAS — FAS 연구 총정리 저장소](https://github.com/ZitongYu/DeepFAS)
- [DeepPixBiS 비공식 구현 예](https://github.com/Saiyam26/Face-Anti-Spoofing-using-DeePixBiS)
- [FLIP — CLIP 기반 교차도메인 FAS (ICCV 2023, GPU 전제)](https://github.com/koushiksrivats/FLIP)
- [hairymax/Face-AntiSpoofing (라이선스 미표기)](https://github.com/hairymax/Face-AntiSpoofing) · [facenox/face-antispoof-onnx](https://github.com/facenox/face-antispoof-onnx)

**일반화 한계 배경 연구**
- [Test-Time Domain Generalization for FAS (CVPR 2024)](https://openaccess.thecvf.com/content/CVPR2024/papers/Zhou_Test-Time_Domain_Generalization_for_Face_Anti-Spoofing_CVPR_2024_paper.pdf)
- [교차 도메인 일반화 개선 연구 (IJCV 2024)](https://link.springer.com/article/10.1007/s11263-024-02240-2)
