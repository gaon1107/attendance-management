using System;
using NewgaonPcOff.Diagnostics;

namespace NewgaonPcOff.Core;

/// <summary>
/// 이 실행이 <b>테스트 모드</b>인가. 실기기 검증(2-D)에서 사람 PC를 실제로 잠가 보기 위한 안전장치다.
///
/// ⚠️ 왜 실행 인자로만 받는가 (2-A 검수 치명 지적)
///  · 설정 파일(<c>config.json</c>)에 두면 직원이 메모장으로 <c>testMode: true</c>를 적어
///    <b>잠금을 영구히 무력화</b>할 수 있다. 그래서 이 값은 <b>실행할 때 준 인자에서만</b> 읽는다.
///  · 자동 시작 등록(Phase 3)에는 이 인자를 <b>넣지 않는다</b>. 평소 실행은 언제나 테스트 모드가 아니다.
///  · 테스트 모드라는 사실은 화면에 크게 표시한다 — 숨기면 "잠긴 줄 알았는데 안 잠긴 PC"가 생긴다.
/// </summary>
internal static class AppMode
{
    /// <summary>테스트 모드로 켜는 실행 인자.</summary>
    public const string TestFlag = "--test-mode";

    /// <summary>테스트 모드로 실행됐는가.</summary>
    public static bool TestMode { get; private set; }

    /// <summary>테스트 모드에서 잠금화면이 <b>스스로 풀리기까지</b>의 시간(테스트하는 사람이 갇히지 않게).</summary>
    public static readonly TimeSpan TestAutoUnlock = TimeSpan.FromSeconds(60);

    /// <summary>
    /// 테스트 모드에서 <b>저절로 잠기는 것은 실행당 한 번뿐</b>이라는 표시.
    ///  · 왜 이렇게 하나: 잠금 시간대(예: 새벽)에 테스트 모드로 켜면, 잠깐 쉬었다가 또 잠기고를
    ///    되풀이해 <b>PC를 못 쓰게</b> 만든다. 한 번 보여 주면 확인은 끝난 것이다.
    ///  · 다시 보고 싶으면 트레이의 <b>[테스트] 잠금화면 미리보기</b>를 누른다(원할 때만 뜬다).
    /// </summary>
    public const string TestAutoLockOnceNote = "테스트 모드에서 자동 잠금은 실행당 1회";

    /// <summary>앱이 켜질 때 딱 한 번 부른다.</summary>
    public static void Parse(string[]? args)
    {
        if (args == null) return;

        foreach (var a in args)
        {
            if (string.Equals((a ?? "").Trim(), TestFlag, StringComparison.OrdinalIgnoreCase))
            {
                TestMode = true;
                Log.Warn($"테스트 모드로 실행합니다 — 잠금화면은 {TestAutoUnlock.TotalSeconds:0}초 뒤 스스로 풀립니다. " +
                         "그 뒤로는 저절로 잠기지 않습니다([테스트] 잠금화면 미리보기로만).");
                return;
            }
        }
    }
}
