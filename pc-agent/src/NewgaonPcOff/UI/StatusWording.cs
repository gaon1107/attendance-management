using System;
using NewgaonPcOff.Core;

namespace NewgaonPcOff.UI;

/// <summary>
/// 판정 결과를 <b>사람이 읽는 한국어</b>로 바꾸는 유일한 곳.
///  · 트레이와 상태 창이 각자 문장을 만들면 같은 상태를 다르게 말하게 된다 → 여기 한 곳에 모은다.
///  · ⚠️ 여기서는 <b>계산하지 않는다.</b> <see cref="AgentStatus"/>에 있는 값만 글자로 옮긴다
///    (사규: 화면에 가짜 데이터 금지).
/// </summary>
internal static class StatusWording
{
    /// <summary>색 이름(Theme.xaml의 브러시 키). 화면이 이 값으로 색을 고른다.</summary>
    public const string Ok = "Success";
    public const string Warn = "Warning";
    public const string Bad = "Danger";
    public const string Plain = "TextSub";

    // ── 상태 배지 (연결됨 / 확인 실패 / 해제됨) ─────────────────────────────

    public static (string text, string color) Badge(AgentStatus s)
    {
        if (!s.Paired) return ("연결되지 않았습니다", Bad);
        if (s.Revoked) return ("연결이 해제되었습니다", Bad);
        if (s.Checking && !s.HasPolicy) return ("확인 중...", Plain);
        if (s.LastError != null) return ("연결됨 · 서버 확인 실패", Warn);
        if (s.FromCache) return ("연결됨 · 저장된 설정으로 판단 중", Warn);
        return ("연결됨", Ok);
    }

    // ── "잠금" 줄 ───────────────────────────────────────────────────────────

    /// <summary>지금 잠금이 어떤 상태인지 한 줄로.</summary>
    public static string Lock(AgentStatus s)
    {
        if (!s.Paired) return "연결되지 않아 잠그지 않습니다";
        if (s.Revoked) return "연결이 해제되어 잠그지 않습니다";

        var p = s.Policy;
        if (p == null)
        {
            return s.PolicyProblem != null
                ? $"회사 설정을 판단할 수 없어 잠그지 않습니다 ({s.PolicyProblem})"
                : "회사 설정을 받지 못해 잠그지 않습니다";
        }

        if (!p.Enabled) return DisabledText(p.DisabledReason);

        var d = s.Decision;
        var now = d.At;

        // 잠금 시간대
        if (d.ShouldLock)
        {
            var head = d.Reason switch
            {
                LockReason.OffDay => d.OffDayName is { Length: > 0 } name ? $"휴무일({name})입니다" : "근무일이 아닙니다",
                LockReason.BeforeWork => "출근 기준시각 전입니다",
                _ => "퇴근 시간이 지났습니다",
            };

            // 해제 시각을 아는 경우와 모르는 경우를 정직하게 나눈다.
            //  · 서버는 오늘·내일 이틀치만 준다 → 금요일 밤에는 월요일 해제 시각을 알 수 없다.
            //    그때는 날짜를 **추측하지 않고** "다음 근무일"이라고만 말한다.
            if (d.ChangeAt.HasValue && now.HasValue)
            {
                return $"{head} — {When(d.ChangeAt.Value, now.Value)} 해제 (남은 시간 {Hm.Remaining(d.ChangeAt.Value - now.Value)})";
            }
            return p.StartMin != Hm.Invalid
                ? $"{head} — 다음 근무일 {Hm.ToText(p.StartMin)}에 해제"
                : $"{head} — 다음 근무일에 해제";
        }

        // 사용 가능
        var why = d.Reason switch
        {
            LockReason.Overtime => "승인된 연장근무 중입니다",
            LockReason.TempUse => "일시사용 중입니다",
            LockReason.Spill => "어제 유예 시간입니다",
            LockReason.NoDayInfo => "오늘 근무일 정보가 없어 잠그지 않습니다",
            _ => "근무시간입니다",
        };

        if (d.Reason == LockReason.NoDayInfo) return why;

        if (d.ChangeAt.HasValue && now.HasValue)
        {
            return $"{why} — {When(d.ChangeAt.Value, now.Value)}에 잠김 (남은 시간 {Hm.Remaining(d.ChangeAt.Value - now.Value)})";
        }
        return why;
    }

    /// <summary>
    /// 잠금화면 부제 — "언제 풀리는지".
    ///  · 서버는 오늘·내일 이틀치만 준다 → 금요일 밤에는 월요일 시각을 알 수 없다.
    ///    그때는 날짜를 <b>추측하지 않고</b> "다음 근무일"이라고만 말한다.
    /// </summary>
    public static string LockScreen(AgentStatus s)
    {
        var d = s.Decision;

        if (d.ChangeAt.HasValue && d.At.HasValue)
        {
            return $"{When(d.ChangeAt.Value, d.At.Value)}에 자동으로 풀립니다. " +
                   $"(남은 시간 {Hm.Remaining(d.ChangeAt.Value - d.At.Value)})";
        }

        var p = s.Policy;
        return p != null && p.StartMin != Hm.Invalid
            ? $"다음 근무일 {Hm.ToText(p.StartMin)}에 자동으로 풀립니다."
            : "다음 근무일에 자동으로 풀립니다.";
    }

    /// <summary>사전알림 문구 — "몇 분 뒤 잠깁니다".</summary>
    public static string NotifySoon(int minutes, DateTimeOffset lockAt)
        => $"{minutes}분 뒤({lockAt:HH:mm}) PC 화면이 잠깁니다.";

    /// <summary>퇴근·유예 같은 회사 설정을 한 줄로(참고 표시용).</summary>
    public static string Rule(AgentStatus s)
    {
        var p = s.Policy;
        if (p == null || !p.Enabled) return "-";

        var start = p.StartMin == Hm.Invalid ? "미설정" : Hm.ToText(p.StartMin);
        return $"{start} ~ {Hm.ToText(p.EndMin)} · 유예 {p.DelayMin}분";
    }

    /// <summary>
    /// 마지막 확인 시각 + 다음 확인 안내.
    ///  · ⚠️ 시각은 <b>회사 기준</b>으로 찍는다 — 잠금 시각도 회사 기준이므로 같은 화면에서
    ///    두 가지 시간대가 섞이면 사용자가 비교할 수 없다.
    /// </summary>
    public static string Checked(AgentStatus s)
    {
        if (s.Checking) return "확인 중...";
        if (s.LastServerOkAt == null) return s.LastTryAt == null ? "-" : "아직 받지 못했습니다";

        var text = s.LastServerOkAt.Value.ToOffset(Hm.CompanyOffset).ToString("HH:mm:ss");
        if (s.NextPollAt.HasValue)
        {
            var left = s.NextPollAt.Value - DateTimeOffset.Now;
            if (left > TimeSpan.Zero) return $"{text} · 다음 확인 {Hm.Remaining(left)} 뒤";
        }
        return text;
    }

    /// <summary>화면 아래에 굵게 띄울 안내(없으면 <c>null</c>).</summary>
    public static (string text, string color)? Note(AgentStatus s)
    {
        if (s.Revoked)
        {
            return ("관리자가 이 PC의 연결을 해제했거나 연결이 만료되었습니다.\n" +
                    "웹 [계정]에서 새 연결코드를 받아 [다시 연결]을 눌러주세요.", Bad);
        }
        if (s.LastError != null)
        {
            var tail = s.FromCache
                ? "\n마지막으로 받은 설정으로 판단하고 있습니다." + OfflineTempUseHint(s)
                : "\n설정을 받지 못해 이 PC는 잠기지 않습니다.";
            return (s.LastError + tail, Warn);
        }
        if (s.PolicyProblem != null)
        {
            return ($"회사 설정에 이상이 있어 잠그지 않습니다 ({s.PolicyProblem}).\n관리자에게 알려주세요.", Warn);
        }
        if (s.FromCache)
        {
            return ("서버에 연결되지 않아 마지막으로 받은 설정으로 판단하고 있습니다." + OfflineTempUseHint(s), Warn);
        }
        return null;
    }

    /// <summary>
    /// 인터넷이 끊긴 동안 쓸 수 있는 [일시사용]이 남아 있으면 알려준다(없으면 빈 글자).
    ///  · 왜 필요한가: 외근·출장지에서 잠겼을 때 <b>[연장근무 신청]은 서버가 없어 되지 않는다</b>.
    ///    이때 스스로 풀 수 있는 유일한 길이 [일시사용]인데, 그 사실을 모르면 갇혔다고 느낀다.
    ///  · ⚠️ 여기서 계산하지 않는다 — 남은 횟수는 <see cref="AgentStatus.TempUseLeft"/>가 이미 정한 값이다.
    /// </summary>
    private static string OfflineTempUseHint(AgentStatus s)
    {
        // ⚠️ 조건은 FromCache가 아니라 **Offline**이다. 401·서버 장애로 저장된 설정을 쓰는 중일 때
        //    "인터넷이 없는 동안"이라고 말하면 사실과 다르다(검수 지적 M-1·m-1).
        if (!s.Offline) return "";
        if (s.TempUseLeft <= 0) return "\n지금은 [일시사용]을 더 쓸 수 없습니다. 관리자에게 연락해주세요.";
        return s.UsingOfflineQuota
            ? $"\n인터넷이 없는 동안에도 [일시사용]을 {s.TempUseLeft}회 더 쓸 수 있습니다."
            : $"\n[일시사용]은 오늘 {s.TempUseLeft}회 더 쓸 수 있습니다.";
    }

    /// <summary>
    /// 트레이 도움말·메뉴에 쓰는 아주 짧은 한 줄.
    ///  · 트레이 도움말은 길이 제한이 있어 짧게 만든다.
    /// </summary>
    public static string Short(AgentStatus s)
    {
        if (!s.Paired) return "연결 안 됨";
        if (s.Revoked) return "재연결 필요";

        var p = s.Policy;
        if (p == null) return s.Checking ? "설정 확인 중" : "설정 없음 · 잠그지 않음";
        if (!p.Enabled) return "잠금 사용 안 함";

        var d = s.Decision;
        if (d.ShouldLock)
        {
            return d.ChangeAt.HasValue
                ? $"잠금 시간대 · {d.ChangeAt.Value:HH:mm} 해제"
                : "잠금 시간대";
        }

        // ⚠️ "모름"을 "근무시간"이라고 말하지 않는다 — 짧은 문장이라도 사실과 달라선 안 된다.
        //    (오프라인이 길어져 오늘 정보가 없는 상태를 "근무시간"으로 보이면 이상을 아무도 못 알아챈다)
        var why = d.Reason switch
        {
            LockReason.NoDayInfo => "오늘 정보 없음 · 잠그지 않음",
            LockReason.Spill => "어제 유예 시간",
            LockReason.Overtime => "승인 연장근무 중",
            LockReason.TempUse => "일시사용 중",
            _ => "근무시간",
        };

        return d.ChangeAt.HasValue ? $"{why} · {d.ChangeAt.Value:HH:mm} 잠금" : why;
    }

    // ── 도우미 ──────────────────────────────────────────────────────────────

    public static string DisabledText(string? reason) => reason switch
    {
        "company_off" => "회사가 PC-OFF를 사용하지 않습니다",
        "user_exempt" => "잠금 예외자로 지정돼 있습니다",
        "no_worktime" => "회사 퇴근 기준시각이 설정되지 않았습니다",
        "shift_unsupported" => "교대근무 회사는 아직 지원하지 않습니다",
        _ => "회사 설정을 확인할 수 없습니다",
    };

    /// <summary>"오늘 18:10" / "내일 09:00" / "07-29(수) 09:00".</summary>
    private static string When(DateTimeOffset target, DateTimeOffset now)
    {
        var day = DateOnly.FromDateTime(target.DateTime);
        var today = DateOnly.FromDateTime(now.DateTime);
        var hhmm = target.ToString("HH:mm");

        if (day == today) return $"오늘 {hhmm}";
        if (day == today.AddDays(1)) return $"내일 {hhmm}";
        return $"{day:MM-dd}({Weekday(day)}) {hhmm}";
    }

    private static string Weekday(DateOnly d) => "일월화수목금토"[(int)d.DayOfWeek].ToString();
}
