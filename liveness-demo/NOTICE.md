# 모델 출처·라이선스 고지

- `models/MiniFASNetV1SE.onnx`, `models/MiniFASNetV2.onnx`
  - 원 모델: [minivision-ai/Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing) — **Apache License 2.0**
  - ONNX 변환본 배포: [yakhyo/face-anti-spoofing](https://github.com/yakhyo/face-anti-spoofing) (releases/weights) — **Apache License 2.0**
  - 용도: 얼굴 위조(사진/화면) 판독. 상업적 사용 가능(Apache-2.0).
- 전처리·판정 방식은 위 원 구현을 재현: 얼굴 상자 배율 크롭(V1SE=4.0, V2=2.7) → 80×80 → BGR·0~255 → softmax, 출력 [1]=진짜 확률.
