using System;

namespace NewgaonPcOff.Core;

/// <summary>왜 잠기는지 / 왜 안 잠기는지. 화면 문구와 기록에 함께 쓴다.</summary>
internal enum LockReason
{
    /// <summary>정책을 모른다(서버·캐시 모두 없음, 또는 값이 이상함) → 잠그지 않는다.</summary>
    PolicyUnknown,

    /// <summary>이 PC가 연결되지 않았다 → 잠그지 않는다.</summary>
    NotPaired,

    /// <summary>회사가 끔 · 예외자 · 교대근무 등 → 잠그지 않는다.</summary>
    Disabled,

    /// <summary>서버가 오늘 날짜 정보를 주지 않았다 → 잠그지 않는다.</summary>
    NoDayInfo,

    /// <summary>근무시간 중 → 잠그지 않는다.</summary>
    WorkHours,

    /// <summary>승인된 연장근무 중 → 잠그지 않는다.</summary>
    Overtime,

    /// <summary>[일시사용] 중 → 잠그지 않는다.</summary>
    TempUse,

    /// <summary>어제 유예가 새벽으로 넘어온 구간. 어제가 근무일이었는지 알 수 없어 잠그지 않는다.</summary>
    Spill,

    /// <summary>퇴근 + 유예를 지났다 → 잠근다.</summary>
    AfterWork,

    /// <summary>출근 기준시각 전이다 → 잠근다.</summary>
    BeforeWork,

    /// <summary>근무일이 아니다(주말·공휴일·회사휴무일) → 잠근다.</summary>
    OffDay,
}

/// <summary>
/// 판정 결과 한 벌. <b>계산만 담고 동작은 담지 않는다</b> — 실제로 화면을 잠그는 일은 2-C가 한다.
/// </summary>
internal sealed class LockDecision
{
    /// <summary>지금 잠겨 있어야 하는가.</summary>
    public bool ShouldLock { get; init; }

    public LockReason Reason { get; init; }

    /// <summary>판정에 쓴 시각(서버 기준). 기준을 모르면 <c>null</c>.</summary>
    public DateTimeOffset? At { get; init; }

    /// <summary>
    /// 지금 상태가 바뀌는 시각. 모르면 <c>null</c>.
    ///  · 안 잠긴 상태면 = <b>잠길 시각</b> / 잠긴 상태면 = <b>풀릴 시각</b>.
    /// </summary>
    public DateTimeOffset? ChangeAt { get; init; }

    /// <summary>오늘이 쉬는 날이면 그 이름(예: "광복절"). 화면 안내용.</summary>
    public string? OffDayName { get; init; }

    /// <summary>상태가 바뀌기까지 남은 시간. <see cref="ChangeAt"/>이 없으면 <c>null</c>.</summary>
    public TimeSpan? Remaining
        => ChangeAt.HasValue && At.HasValue && ChangeAt.Value > At.Value ? ChangeAt.Value - At.Value : null;

    /// <summary>같은 상태인지(화면을 다시 그릴지 판단할 때 쓴다 — 남은 시간 표시는 따로 갱신한다).</summary>
    public bool SameStateAs(LockDecision? other)
        => other != null && other.ShouldLock == ShouldLock && other.Reason == Reason && other.ChangeAt == ChangeAt;

    public static LockDecision NoLock(LockReason reason, DateTimeOffset? at = null)
        => new() { ShouldLock = false, Reason = reason, At = at };
}
