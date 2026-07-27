using System;

namespace NewgaonPcOff.Core;

/// <summary>
/// "지금 이 프로그램이 어떤 상태인가" 한 장. 화면·트레이는 <b>이 값만 읽어서</b> 표시한다.
///  · 화면이 직접 계산하지 않게 하는 이유: 같은 것을 두 곳에서 계산하면 반드시 어긋난다.
///  · ⚠️ 여기 없는 것은 화면에 쓰지 않는다(사규: 화면에 가짜 데이터 금지).
/// </summary>
internal sealed class AgentStatus
{
    /// <summary>이 PC가 연결되어 있는가(열 수 있는 기기 토큰이 있는가).</summary>
    public bool Paired { get; init; }

    /// <summary>서버가 이 기기를 거부했다(관리자가 연결 해제·만료) → 다시 연결해야 한다.</summary>
    public bool Revoked { get; init; }

    /// <summary>판정에 쓸 수 있는 정책이 있는가.</summary>
    public bool HasPolicy => Policy != null;

    /// <summary>서버가 아니라 <b>저장된 설정</b>으로 판단 중인가(= 서버에 못 붙는 상태).</summary>
    public bool FromCache { get; init; }

    /// <summary>검증을 통과한 정책. 없으면 <c>null</c>.</summary>
    public SafePolicy? Policy { get; init; }

    /// <summary>판정 결과. 항상 값이 있다(최악의 경우 "정책 모름 → 잠그지 않음").</summary>
    public LockDecision Decision { get; init; } = LockDecision.NoLock(LockReason.PolicyUnknown);

    /// <summary>서버에서 정책을 마지막으로 잘 받은 시각(이 PC 시계 기준 — 화면 표시용).</summary>
    public DateTimeOffset? LastServerOkAt { get; init; }

    /// <summary>서버에 마지막으로 물어본 시각(성공·실패 무관).</summary>
    public DateTimeOffset? LastTryAt { get; init; }

    /// <summary>서버 통신 실패 사유(사람이 읽는 문장). 성공했으면 <c>null</c>.</summary>
    public string? LastError { get; init; }

    /// <summary>정책 값이 이상해서 판정할 수 없는 사유. 정상이면 <c>null</c>.</summary>
    public string? PolicyProblem { get; init; }

    /// <summary>다음에 서버에 물어볼 시각(화면에 "5분마다 자동 확인"을 정직하게 보여주기 위해).</summary>
    public DateTimeOffset? NextPollAt { get; init; }

    /// <summary>지금 서버에 물어보는 중인가.</summary>
    public bool Checking { get; init; }

    /// <summary>[일시사용]이 끝나는 시각. 쓰는 중이 아니면 <c>null</c>.</summary>
    public DateTimeOffset? TempUseUntil { get; init; }

    /// <summary>오늘 남은 [일시사용] 횟수.</summary>
    public int TempUseLeft { get; init; }

    /// <summary>
    /// 인터넷이 끊긴 상태인가(= 서버에 닿지도 못한다).
    ///  · ⚠️ <see cref="FromCache"/>와 다르다. 저장된 설정을 쓰는 중이어도 서버가 401·5xx로 <b>대답은 한</b>
    ///    경우가 있는데, 그때는 인터넷이 멀쩡하므로 "오프라인"이라고 말하면 안 된다.
    ///  · 화면은 이 값으로 오프라인 안내를 켠다(<see cref="FromCache"/>로 켜면 없는 사실을 말하게 된다).
    /// </summary>
    public bool Offline { get; init; }

    /// <summary>지금 [일시사용]이 <b>오프라인 몫</b>에서 나가는가(서버가 오프라인 한도를 준 경우에만 참).</summary>
    public bool UsingOfflineQuota { get; init; }

    /// <summary>아직 서버로 보내지 못한 기록 건수(오프라인이었을 때 쌓인다).</summary>
    public int PendingEvents { get; init; }
}
