using System;
using System.Globalization;

namespace NewgaonPcOff.Core;

/// <summary>
/// 시각·날짜를 <b>숫자로</b> 다루는 도구.
///  · ⚠️ 왜 필요한가: 시각을 글자로 비교하면 <c>"9:00" &gt; "10:00"</c> 이 되어 앞뒤가 뒤집힌다.
///    그 한 줄이 "근무 중인데 잠기는" 사고로 직결되므로, 시각 비교는 <b>반드시 분(정수)</b>으로만 한다.
///  · 이 파일은 순수 계산만 한다(파일·네트워크·시계를 만지지 않는다) → 표로 전수 검증할 수 있다.
/// </summary>
internal static class Hm
{
    /// <summary>읽을 수 없는 시각.</summary>
    public const int Invalid = -1;

    /// <summary>하루 = 1440분.</summary>
    public const int Day = 24 * 60;

    /// <summary>
    /// 회사(서버) 기준 시간대 — <b>한국 시간(+09:00) 고정</b>. 정책의 날짜·시각은 모두 이 기준이다.
    ///
    /// 왜 서버가 준 표기에서 읽지 않는가 (실기기 검증에서 잡은 버그)
    ///  · 서버는 시각을 <c>"2026-07-26T14:22:22.076Z"</c> 처럼 <b>UTC 표기</b>로 보낸다.
    ///    그 표기의 시간대(+00:00)를 그대로 쓰면 <c>"09:00"</c> 같은 회사 설정이 UTC 09시로 해석되어
    ///    <b>모든 판정이 9시간 어긋난다</b>(월요일 해제가 09:00 대신 18:00으로 나왔다).
    ///  · 정책의 <c>workStartTime "09:00"</c>·<c>days[].date</c>는 서버가 <b>자기 지역 시각</b>으로 만든 값이다
    ///    (webapp은 "서버 TZ = Asia/Seoul" 전제로 전체가 짜여 있다). 그래서 여기서도 같은 기준을 쓴다.
    ///  · 서버가 준 시각은 "그 순간이 언제인가"에만 쓴다(<see cref="ServerClock"/>). 시간대는 여기서 정한다.
    ///
    /// ⚠️ 해외 지사를 지원하려면 서버가 회사 시간대를 함께 내려줘야 한다(= webapp API 확장 → 별도 승인 사항).
    ///    PC의 시간대 설정을 쓰지 않는 이유: 직원이 시간대를 바꿔 판정을 밀어버릴 수 있다.
    /// </summary>
    public static readonly TimeSpan CompanyOffset = TimeSpan.FromHours(9);

    /// <summary>"HH:MM" → 자정부터의 분(0~1439). 읽을 수 없으면 <see cref="Invalid"/>.</summary>
    public static int ToMinutes(string? hm)
    {
        if (string.IsNullOrWhiteSpace(hm)) return Invalid;

        // ⚠️ 문화권(Culture)을 고정한다 — PC의 지역 설정에 따라 숫자 해석이 달라지지 않게.
        var parts = hm.Split(':');
        if (parts.Length != 2) return Invalid;
        if (!int.TryParse(parts[0].Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var h)) return Invalid;
        if (!int.TryParse(parts[1].Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var m)) return Invalid;
        if (h is < 0 or > 23 || m is < 0 or > 59) return Invalid;

        return h * 60 + m;
    }

    /// <summary>분 → "HH:MM". 하루를 넘는 값(예: 1470 = 다음날 00:30)도 시:분으로 접어서 보여준다.</summary>
    public static string ToText(int minutes)
    {
        if (minutes < 0) return "--:--";
        var m = minutes % Day;
        return $"{m / 60:00}:{m % 60:00}";
    }

    /// <summary>"YYYY-MM-DD" → 날짜. 읽을 수 없으면 <c>null</c>.</summary>
    public static DateOnly? ToDate(string? ymd)
    {
        if (string.IsNullOrWhiteSpace(ymd)) return null;
        return DateOnly.TryParseExact(ymd.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture,
            DateTimeStyles.None, out var d) ? d : null;
    }

    /// <summary>
    /// 날짜 + 자정부터의 분 → 절대 시각.
    ///  · <paramref name="offset"/>은 <b>서버가 알려준 시간대</b>를 쓴다(회사 기준 시간대).
    ///    PC의 시간대 설정을 쓰면 직원이 시간대를 바꿔 잠금을 피할 수 있다.
    ///  · <paramref name="minuteOfDay"/>가 1440을 넘어도 된다 — 다음 날로 자연히 넘어간다
    ///    (퇴근 23:30 + 유예 60분처럼 자정을 넘는 계산에 필요).
    /// </summary>
    public static DateTimeOffset At(DateOnly date, int minuteOfDay, TimeSpan offset)
        => new DateTimeOffset(date.Year, date.Month, date.Day, 0, 0, 0, offset).AddMinutes(minuteOfDay);

    /// <summary>남은 시간을 사람이 읽는 말로. 예) "4시간 12분", "7분", "곧".</summary>
    public static string Remaining(TimeSpan span)
    {
        if (span <= TimeSpan.Zero) return "곧";

        var total = (int)Math.Round(span.TotalMinutes, MidpointRounding.AwayFromZero);
        if (total <= 0) return "곧";
        if (total < 60) return $"{total}분";

        var days = total / (24 * 60);
        var hours = total % (24 * 60) / 60;
        var mins = total % 60;

        if (days > 0) return hours > 0 ? $"{days}일 {hours}시간" : $"{days}일";
        return mins > 0 ? $"{hours}시간 {mins}분" : $"{hours}시간";
    }
}
