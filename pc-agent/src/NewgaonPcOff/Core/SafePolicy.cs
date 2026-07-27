using System;

namespace NewgaonPcOff.Core;

/// <summary>
/// 검증을 통과한 정책. <b>판정기는 이 그릇만 받는다.</b>
///  · 서버 JSON을 그대로 판정기에 넣지 않는 이유: 값 하나가 이상해도(음수 유예, 목록 속 빈 칸)
///    판정기가 예외로 멈추면 잠금·해제가 <b>통째로</b> 안 돈다. 그래서 입구에서 한 번만 걸러낸다.
///  · 여기 담긴 값은 전부 "이미 검증된 값"이다. 판정기는 다시 의심하지 않는다.
/// </summary>
internal sealed class SafePolicy
{
    /// <summary>이 PC가 잠금 대상인가. false면 판정기는 아무것도 하지 않는다.</summary>
    public bool Enabled { get; init; }

    /// <summary>Enabled=false인 이유(화면 문구용).</summary>
    public string? DisabledReason { get; init; }

    /// <summary>서버(회사) 시간대.</summary>
    public TimeSpan Offset { get; init; } = TimeSpan.FromHours(9);

    /// <summary>출근 기준시각(자정부터 분). <see cref="Hm.Invalid"/>면 미설정 → 출근 전 잠금을 적용하지 않는다.</summary>
    public int StartMin { get; init; } = Hm.Invalid;

    /// <summary>퇴근 기준시각(자정부터 분). Enabled=true면 항상 유효한 값이다.</summary>
    public int EndMin { get; init; } = Hm.Invalid;

    /// <summary>퇴근 후 유예(분). 0 이상.</summary>
    public int DelayMin { get; init; }

    /// <summary>사용 가능 종료 = 퇴근 + 유예. 1440을 넘으면 자정을 넘긴다는 뜻.</summary>
    public int EndWithDelayMin => EndMin + DelayMin;

    /// <summary>
    /// 어제의 유예가 오늘 새벽으로 넘어온 분량(0이면 넘어오지 않음).
    ///  · 예) 퇴근 23:30 + 유예 60분 = 다음날 00:30까지 → 30분.
    ///  · ⚠️ 서버는 <b>어제가 근무일이었는지</b>를 알려주지 않는다(오늘·내일 이틀치만 준다).
    ///    그래서 이 구간은 "판정 불가"로 보고 잠그지 않는다(fail-open).
    /// </summary>
    public int SpillMin => Math.Max(0, EndWithDelayMin - Hm.Day);

    /// <summary>잠금 몇 분 전에 알릴지(내림차순·중복 제거). 2-C의 사전알림이 쓴다.</summary>
    public int[] NotifyMins { get; init; } = [];

    /// <summary>
    /// 이 직원의 근무요일 CSV(예: "1,2,3,4,5", 0=일요일).
    ///  · ⚠️ <b>판정에는 쓰지 않는다</b> — 판정은 서버가 이미 계산해 준 <see cref="Days"/>로만 한다
    ///    (공휴일·회사휴무일이 반영된 값이라 요일만 보면 휴일에 안 잠기는 사고가 난다).
    ///    이 값은 "회사 설정을 사람에게 보여줄 때"만 쓴다.
    /// </summary>
    public string WorkDaysCsv { get; init; } = "";

    /// <summary>오늘·내일(서버가 준 만큼)의 근무일 여부. 최소 1개는 있다.</summary>
    public DayRule[] Days { get; init; } = [];

    /// <summary>승인된 연장근무를 <b>절대 시각으로 펼친</b> 목록(자정 넘김 처리 완료).</summary>
    public TimeWindow[] Overtime { get; init; } = [];

    public int TempUseMinutes { get; init; }
    public int TempUsePerDay { get; init; }
    public int TempUsedToday { get; init; }
    public string[] TempReasons { get; init; } = [];

    /// <summary>인터넷이 끊긴 동안의 하루 한도(회). <b>0이면 오프라인 확장 없음</b>(옛 서버 포함).</summary>
    public int OfflineTempUsePerDay { get; init; }

    /// <summary>서버가 센 "오늘 오프라인 사용 횟수". 앱이 스스로 센 값과 <b>큰 쪽</b>을 쓴다(우회 차단).</summary>
    public int OfflineTempUsedToday { get; init; }

    /// <summary>
    /// [일시사용]을 지금 더 쓸 수 있는가(서버가 준 값만 본 <b>거친 계산</b>).
    ///  · ⚠️ <b>화면·판정에 쓰지 말 것.</b> 아직 서버에 닿지 않은 사용분과 <b>인터넷이 끊긴 동안의 별도 한도</b>를
    ///    모르기 때문에 실제와 어긋난다. 정답은 <c>PolicyService.TempUseLeft</c> 하나뿐이다.
    ///  · 지금 쓰는 곳은 없다(2026-07-27 확인).
    /// </summary>
    public bool TempUseAvailable => TempUseMinutes > 0 && TempUsedToday < TempUsePerDay;

    public long PolicyVersion { get; init; }

    /// <summary>날짜로 그 날 규칙을 찾는다. 서버가 주지 않은 날이면 <c>null</c>.</summary>
    public DayRule? FindDay(DateOnly date)
    {
        foreach (var d in Days)
        {
            if (d.Date == date) return d;
        }
        return null;
    }
}

/// <summary>하루 규칙. <paramref name="IsWorkday"/> = 근무요일이면서 쉬는 날이 아님(서버가 이미 판단해서 준다).</summary>
internal readonly record struct DayRule(DateOnly Date, bool IsWorkday, string? OffDayName);

/// <summary>절대 시각 구간 [Start, End). 승인된 연장근무·일시사용에 쓴다.</summary>
internal readonly record struct TimeWindow(DateTimeOffset Start, DateTimeOffset End)
{
    public bool Contains(DateTimeOffset t) => t >= Start && t < End;
}
