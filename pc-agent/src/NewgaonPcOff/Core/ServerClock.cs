using System;
using NewgaonPcOff.Diagnostics;

namespace NewgaonPcOff.Core;

/// <summary>
/// "지금 몇 시인가"를 <b>서버 기준</b>으로 답한다. 이 앱은 PC 시계를 그대로 믿지 않는다.
///
/// 왜 이렇게까지 하는가
///  · 직원이 PC 시계를 3시간 뒤로 돌리면 "아직 퇴근 전"이 되어 잠금이 무력화된다.
///  · 그래서 서버가 알려준 시각을 기준점으로 잡고, 그 뒤로 <b>얼마나 흘렀는지</b>만 더한다.
///
/// 흐른 시간을 재는 두 가지 자와 그 약점
///  · 부팅 후 경과(TickCount64): 시계를 돌려도 안 흔들린다. 단 <b>절전/최대절전 중에는 멈춘다</b>.
///  · PC 시계: 절전에도 정확하다. 단 <b>사람이 마음대로 바꿀 수 있다</b>.
///  → 그래서 <b>둘 중 더 많이 흐른 쪽</b>을 쓴다.
///     시계를 뒤로 돌리면 부팅경과가 이기고(회피 실패), 절전 후 깨어나면 PC 시계가 이긴다(정확).
///
/// 남는 구멍(정직한 한계)
///  · 시계를 <b>앞으로</b> 돌리면 잠금이 일찍 오거나 일찍 풀릴 수 있다. 다만 서버와 통신되는 순간
///    기준점이 새로 맞춰지므로(폴링 5분) 온라인에서는 오래 통하지 않는다.
///    네트워크를 끊고 시계를 돌리는 고의 우회는 서버 쪽 보상 장치의 영역이다(README 참조).
/// </summary>
internal sealed class ServerClock
{
    /// <summary>두 자의 차이가 이만큼 벌어지면 "기준을 다시 받아야 한다"고 본다.</summary>
    private static readonly TimeSpan DriftLimit = TimeSpan.FromMinutes(2);

    private DateTimeOffset _base;      // 기준점: 서버가 알려준 시각
    private long _baseTick;            // 그때의 부팅 후 경과(ms)
    private DateTimeOffset _baseWall;  // 그때의 PC 시계(UTC)
    private bool _has;

    /// <summary>
    /// 회사 기준 시간대. <b>서버가 준 표기에서 읽지 않는다</b> — 서버는 UTC(Z)로 보내므로
    /// 그대로 쓰면 판정이 9시간 어긋난다(실기기 검증에서 잡은 버그). 자세한 이유는 <see cref="Hm.CompanyOffset"/>.
    /// </summary>
    public TimeSpan Offset => Hm.CompanyOffset;

    /// <summary>기준점을 갖고 있는가. 없으면 <see cref="Now"/>가 <c>null</c>이고 → 아무것도 잠그지 않는다.</summary>
    public bool HasReference => _has;

    /// <summary>기준점이 된 서버 시각(화면에 "무엇을 기준으로 판단 중인지" 보여줄 때 쓴다).</summary>
    public DateTimeOffset? ReferenceAt => _has ? _base : null;

    /// <summary>지금 시각(서버 기준). 기준점이 없으면 <c>null</c>.</summary>
    public DateTimeOffset? Now => _has ? Measure().Now : null;

    /// <summary>
    /// 두 자가 크게 어긋났는지 <b>지금 확인하고, 확인했다는 사실을 기록한다</b>(읽으면 내려가는 신호).
    ///  · 왜 한 번만인가: 어긋남은 "서버에 다시 물어봐라"는 <b>신호</b>다. 계속 켜져 있으면 폴링 주기가
    ///    영구히 10초로 좁혀져 서버를 두드리고 기록을 잡음으로 채운다(검수 지적).
    ///  · 왜 <see cref="Now"/> 안에서 하지 않는가: 값을 읽는 곳에서 상태를 바꾸면,
    ///    "누가 먼저 읽는지"에 따라 동작이 달라져 조용히 깨진다.
    /// </summary>
    public bool ConsumeDriftSignal()
    {
        if (!_has) return false;

        var m = Measure();
        if (!m.Drifted) return false;

        // 다시 묻기로 했으니 신호를 내린다(다음 Sync가 기준을 새로 맞춘다).
        //  ⚠️ 순서 주의: 새 기준값을 **먼저** 잡고 나서 두 자를 0으로 되돌린다.
        //     거꾸로 하면 Measure()가 이미 0이 된 두 자로 재서 옛 기준값을 그대로 돌려준다.
        _base = m.Now;
        _baseTick = Environment.TickCount64;
        _baseWall = DateTimeOffset.UtcNow;
        return true;
    }

    /// <summary>흐른 시간을 두 자로 재서 "지금"과 "어긋남"을 함께 계산한다(상태를 바꾸지 않는다).</summary>
    private (DateTimeOffset Now, bool Drifted) Measure()
    {
        var tickElapsed = TimeSpan.FromMilliseconds(Environment.TickCount64 - _baseTick);
        var wallElapsed = DateTimeOffset.UtcNow - _baseWall;

        // 어긋남 = 두 자의 결과가 크게 다름(절전 복귀·시계 조작).
        var drifted = (tickElapsed - wallElapsed).Duration() > DriftLimit;

        var elapsed = tickElapsed > wallElapsed ? tickElapsed : wallElapsed;
        if (elapsed < TimeSpan.Zero) elapsed = TimeSpan.Zero; // 기준점보다 과거로는 절대 가지 않는다

        return ((_base + elapsed).ToOffset(Offset), drifted);
    }

    /// <summary>서버 응답으로 기준점을 새로 맞춘다(폴링이 성공할 때마다).</summary>
    public void Sync(DateTimeOffset serverTime)
    {
        var before = Now;

        _base = serverTime;
        _baseTick = Environment.TickCount64;
        _baseWall = DateTimeOffset.UtcNow;
        _has = true;

        // 크게 튀었으면 기록해 둔다(원인 추적용). 값 자체는 비밀이 아니다.
        if (before.HasValue)
        {
            var jump = (serverTime - before.Value).Duration();
            if (jump > DriftLimit) Log.Warn($"서버 시각 기준이 {(int)jump.TotalSeconds}초 움직였습니다(재동기).");
        }
        else
        {
            var pcGap = (int)Math.Round((DateTimeOffset.Now - serverTime).TotalSeconds);
            Log.Info($"서버 시각 기준을 맞췄습니다 (이 PC 시계와 {pcGap:+0;-0;0}초 차이).");
        }
    }

    /// <summary>
    /// 저장해둔 정책(캐시)으로 기준점을 세운다 — 서버에 못 붙는 상태에서 쓴다.
    ///  · 재부팅했을 수 있으니 부팅 후 경과는 기준으로 쓸 수 없다. 대신 <b>캐시를 저장한 시점의 PC 시계</b>를
    ///    기준점으로 삼아 그 뒤 흐른 시간을 더한다(그래서 껐다 켜도 판정이 이어진다).
    ///  · 이 상태는 정확도가 낮으므로 화면에 "마지막으로 받은 설정으로 판단 중"이라고 밝힌다.
    /// </summary>
    public void SyncFromCache(DateTimeOffset serverTime, DateTimeOffset savedWallUtc)
    {
        _base = serverTime;
        _baseWall = savedWallUtc;

        // ⚠️ 부팅 후 경과도 "저장 시점"으로 되돌려 놓는다.
        //    그러지 않으면(지금 값으로 두면) 두 자의 결과가 처음부터 "저장 후 흐른 시간"만큼 달라져
        //    저장 2분만 지난 캐시도 항상 "어긋남"으로 잡힌다 → 폴링이 영구히 10초 주기로 좁혀지고
        //    오프라인 내내 기록이 잡음으로 가득 찬다(검수에서 실측된 오탐).
        var sinceSaved = DateTimeOffset.UtcNow - savedWallUtc;
        if (sinceSaved < TimeSpan.Zero) sinceSaved = TimeSpan.Zero;
        _baseTick = Environment.TickCount64 - (long)sinceSaved.TotalMilliseconds;

        _has = true;

        Log.Info($"저장된 설정으로 시각 기준을 세웠습니다 (기준 {serverTime.ToOffset(Offset):yyyy-MM-dd HH:mm}).");
    }

    /// <summary>기준점을 버린다(연결이 끊겼을 때). 이후 <see cref="Now"/>는 <c>null</c> → 잠그지 않는다.</summary>
    public void Reset() => _has = false;
}
