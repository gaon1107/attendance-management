using System;
using System.Collections.Generic;

namespace NewgaonPcOff.Core;

/// <summary>
/// 판정기 — "<b>지금 잠겨 있어야 하는가</b>"만 계산한다.
///
/// 확정된 규칙 (사장님 결정 2026-07-26)
/// <code>
/// 사용 가능 = 근무일 ∧ 출근시각 ≤ 지금 &lt; 퇴근시각 + 유예
///           ∨ 승인된 연장근무 시간대
///           ∨ [일시사용] 중
/// 그 외 전부 = 잠금
/// </code>
///  · 출근 기준시각 <b>전</b>에도 잠근다 → 규칙이 "근무일 09:00~18:10만 사용" 한 문장으로 끝나고,
///    지시서의 "다음 근무일 해제"와 정확히 일치한다.
///  · 주말·공휴일은 <b>온종일</b> 잠근다 → 휴일근무 지시 없이 일하는 것을 막는다.
///    필요하면 연장근무 승인이나 [일시사용]으로 푼다.
///
/// 안전 원칙 (절대)
///  · 확신이 없으면 <b>잠그지 않는다</b>(fail-open). 정책을 모름 / 오늘 날짜 정보 없음 /
///    어제 유예가 새벽으로 넘어온 구간 — 전부 잠그지 않는다.
///  · 시각 비교는 <b>분(정수)</b>으로만 한다. 초는 버린다.
///  · 이 파일은 순수 계산이다(파일·네트워크·시계를 만지지 않는다) → 시나리오 표로 전수 검증한다.
/// </summary>
internal static class LockDecider
{
    /// <summary>다음 상태 변화를 이 시간 안에서만 찾는다(서버가 주는 날짜가 오늘·내일 이틀치이므로 충분).</summary>
    private static readonly TimeSpan Horizon = TimeSpan.FromHours(48);

    /// <summary>
    /// 판정.
    /// </summary>
    /// <param name="policy">검증을 통과한 정책. <c>null</c>이면 잠그지 않는다.</param>
    /// <param name="now">서버 기준 현재 시각. <c>null</c>이면(기준을 모르면) 잠그지 않는다.</param>
    /// <param name="tempUseUntil">[일시사용]이 끝나는 시각. 없으면 <c>null</c>. (2-C에서 채워진다)</param>
    public static LockDecision Decide(SafePolicy? policy, DateTimeOffset? now, DateTimeOffset? tempUseUntil = null)
    {
        if (now == null) return LockDecision.NoLock(LockReason.PolicyUnknown);
        if (policy == null) return LockDecision.NoLock(LockReason.PolicyUnknown, now);
        if (!policy.Enabled) return LockDecision.NoLock(LockReason.Disabled, now);

        // ⚠️ 들어온 시각을 **회사 기준 시간대로 맞춘 뒤** 판단한다.
        //    같은 순간이라도 시간대가 다르면 "몇 시 몇 분"이 달라져 판정이 뒤집힌다
        //    (UTC로 들어오면 한국 09:30이 00:30으로 읽혀 "출근 전 잠금"이 된다 — 검증기에서 실제로 재현했다).
        //    호출자가 무엇을 넘겨도 안전하도록 판정기 안에서 정리한다.
        var t = now.Value.ToOffset(policy.Offset);
        var reason = Evaluate(policy, t, tempUseUntil);
        var locking = IsLocking(reason);

        return new LockDecision
        {
            ShouldLock = locking,
            Reason = reason,
            At = t,
            ChangeAt = FindChange(policy, t, tempUseUntil, locking),
            OffDayName = policy.FindDay(DateOnly.FromDateTime(t.DateTime))?.OffDayName,
        };
    }

    /// <summary>그 시각의 상태 하나를 판정한다. 순서가 곧 우선순위다.</summary>
    private static LockReason Evaluate(SafePolicy p, DateTimeOffset t, DateTimeOffset? tempUseUntil)
    {
        // ① [일시사용] — 직원이 방금 허락받은 시간이므로 무엇보다 앞선다.
        if (tempUseUntil.HasValue && t < tempUseUntil.Value) return LockReason.TempUse;

        // ② 승인된 연장근무 — "승인분만 해제"가 원칙. 대기·반려는 서버가 애초에 내려주지 않는다.
        foreach (var w in p.Overtime)
        {
            if (w.Contains(t)) return LockReason.Overtime;
        }

        var date = DateOnly.FromDateTime(t.DateTime);
        var minute = t.Hour * 60 + t.Minute; // 초는 버린다 — 분 단위 판정

        // ③ 어제 유예가 새벽으로 넘어온 구간(퇴근 23:30 + 유예 60분 같은 설정).
        //    서버는 어제가 근무일이었는지 알려주지 않으므로 판단할 수 없다 → 잠그지 않는다.
        if (p.SpillMin > 0 && minute < p.SpillMin) return LockReason.Spill;

        // ④ 그 날 규칙
        var day = p.FindDay(date);
        if (day == null) return LockReason.NoDayInfo;   // 서버가 안 준 날 → 잠그지 않는다
        if (!day.Value.IsWorkday) return LockReason.OffDay;

        // ⑤ 근무일 안에서의 시각
        if (p.StartMin != Hm.Invalid && minute < p.StartMin) return LockReason.BeforeWork;
        if (minute >= p.EndWithDelayMin) return LockReason.AfterWork;
        return LockReason.WorkHours;
    }

    /// <summary>잠그는 사유인가. (여기 없는 사유는 모두 "잠그지 않음")</summary>
    private static bool IsLocking(LockReason r)
        => r is LockReason.AfterWork or LockReason.BeforeWork or LockReason.OffDay;

    /// <summary>
    /// 지금 상태가 바뀌는 첫 시각을 찾는다. 못 찾으면 <c>null</c>.
    ///
    /// 왜 이렇게 찾는가: 경계 조건을 손으로 따지면(자정 넘김·연장근무 겹침·유예 넘침) 반드시 빠뜨린다.
    /// 그래서 "상태가 바뀔 수 있는 후보 시각"을 모두 모은 뒤 <b>각 후보에서 판정을 다시 돌려</b>
    /// 처음으로 달라지는 지점을 고른다. 규칙이 바뀌어도 이 함수는 고칠 필요가 없다.
    ///
    /// ⚠️ 서버는 오늘·내일 이틀치만 준다. 그래서 금요일 밤에는 "월요일 해제 시각"을 알 수 없어
    ///    <c>null</c>이 나온다. 화면은 그 경우 <b>추측하지 말고</b> "다음 근무일에 풀립니다"로만 안내한다.
    /// </summary>
    private static DateTimeOffset? FindChange(SafePolicy p, DateTimeOffset t, DateTimeOffset? tempUseUntil, bool lockingNow)
    {
        var limit = t + Horizon;
        var candidates = new List<DateTimeOffset>();

        void Add(DateTimeOffset x)
        {
            if (x > t && x <= limit) candidates.Add(x);
        }

        foreach (var d in p.Days)
        {
            Add(Hm.At(d.Date, 0, p.Offset));                              // 날이 바뀌는 순간
            if (p.SpillMin > 0) Add(Hm.At(d.Date, p.SpillMin, p.Offset)); // 어제 유예가 끝나는 순간
            if (p.StartMin != Hm.Invalid) Add(Hm.At(d.Date, p.StartMin, p.Offset));
            Add(Hm.At(d.Date, p.EndWithDelayMin, p.Offset));              // 퇴근 + 유예
        }
        foreach (var w in p.Overtime)
        {
            Add(w.Start);
            Add(w.End);
        }
        if (tempUseUntil.HasValue) Add(tempUseUntil.Value);

        candidates.Sort();

        foreach (var c in candidates)
        {
            var r = Evaluate(p, c, tempUseUntil);

            // ⚠️ "모름"에 닿으면 그 뒤는 알 수 없다 → **추측하지 않고 비워둔다.**
            //    이 검사가 없으면 서버가 안 준 날로 넘어가는 순간을 "상태가 바뀌는 시각"으로 착각해,
            //    아무 근거 없는 해제 시각을 화면에 띄운다(검수에서 실제로 재현됨:
            //    화요일 아침에 "휴무일 — 수요일 00:30 해제"라는 존재하지 않는 시각이 나왔다).
            if (r is LockReason.NoDayInfo or LockReason.PolicyUnknown) return null;

            if (IsLocking(r) != lockingNow) return c;
        }
        return null;
    }
}
