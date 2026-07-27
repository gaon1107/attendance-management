using System;
using System.Collections.Generic;
using System.Globalization;
using NewgaonPcOff.Api;
using NewgaonPcOff.Diagnostics;

namespace NewgaonPcOff.Core;

/// <summary>
/// 정책 검증기 — 서버 JSON을 판정기에 넣기 <b>직전 단 한 곳</b>에서 걸러낸다.
///
/// 왜 필요한가 (2-A 검수에서 약속한 항목)
///  · 값이 이상하면(음수 유예, 목록 속 빈 칸) 판정기가 예외로 멈추고 → 잠금·해제가 통째로 안 돈다.
///  · <c>PolicyModels.cs</c>의 <c>??=</c> 패턴은 "목록 자체가 null"인 것만 막는다.
///    <c>[null, {...}]</c> 처럼 <b>목록 안의 빈 칸</b>은 막지 못한다(실측 확인). 여기서 걸러낸다.
///
/// 판정 불가로 볼 때는 <c>null</c>을 돌려준다 → 호출부는 <b>잠그지 않는다</b>(fail-open).
/// 값이 조금 이상한 정도는 안전한 쪽으로 낮춰서 통과시킨다(기록을 남긴다).
/// </summary>
internal static class PolicySanitizer
{
    /// <summary>
    /// 유예 상한(분). <b>서버(웹 설정 화면)가 허용하는 최대값과 같게 맞춘다</b> — <c>webapp/lib/pcoff.ts</c>의 240분.
    ///  · 앱 상한이 서버보다 넓으면, 서버가 막는 값(예: 700분)이 앱에서는 통과해
    ///    "사용 종료 05:40 · 새벽 넘침 340분" = <b>그 회사는 사실상 하루도 안 잠김</b>이 된다.
    /// </summary>
    private const int MaxDelayMin = 240;

    /// <summary>사전알림 상한(분).</summary>
    private const int MaxNotifyMin = 12 * 60;

    /// <summary>
    /// [일시사용] 1회 길이 상한(분) — 유예와 <b>같은 이유</b>로 둔다.
    ///  · 서버 설정 화면은 5~240분으로 막지만(<c>webapp/lib/pcoff.ts</c>), DB를 직접 고치거나
    ///    기본값이 바뀌면 그 방어가 뚫린다. 앱에도 같은 선을 둬야 "한 번 누르면 며칠간 안 잠김"이 안 된다.
    /// </summary>
    private const int MaxTempUseMin = 240;

    /// <summary>[일시사용] 하루 허용 횟수 상한 — 서버(<c>PCOFF_LIMITS.tempUsePerDay</c>)와 같은 10.</summary>
    private const int MaxTempUsePerDay = 10;

    /// <summary>
    /// [일시사용] 사유 목록의 개수·글자 상한 — 서버(<c>MAX_TEMP_REASONS</c>·<c>MAX_TEMP_REASON_LEN</c>)와 같은 값.
    ///  · ⚠️ 상한을 넘는 사유는 <b>자르지 않고 버린다.</b> 잘라서 보내면 서버가 회사 목록과 글자로
    ///    비교할 때 어긋나 <c>meta=null</c>("사유 미확인")로 저장된다 —
    ///    직원은 분명히 골랐는데 기록에는 사유가 없는 상태가 된다(재검수 중간 M-6).
    /// </summary>
    private const int MaxTempReasons = 10;
    private const int MaxTempReasonLen = 20;

    /// <summary>
    /// 서버 시각에서 이 일수보다 멀리 떨어진 날짜는 버린다.
    ///  · 서버는 <b>오늘부터 31일치</b>를 주므로 정상값은 0~30일이다(<c>webapp/lib/pcoff.ts</c>의 <c>POLICY_DAYS</c>).
    ///    🔴 <b>서버의 POLICY_DAYS와 반드시 짝이다.</b> 이 값이 서버보다 작으면 앞쪽 며칠만 남기고
    ///    나머지를 조용히 버려, 서버를 고쳐도 <b>오프라인 잠금이 그대로 사라진다</b>(고친 효과가 0).
    ///  · 여유 5일을 더 둔 이유: 서버·PC의 시간대나 자정 경계 때문에 하루 이틀 어긋나 보일 수 있는데,
    ///    그때 정상 데이터를 버리면 안 되기 때문이다.
    ///  · ⚠️ 상한 자체가 필요한 이유: <c>9999-12-31</c> 같은 값이 들어오면 날짜+분 계산이 넘쳐서
    ///    판정기가 예외로 죽는다. 그 값이 캐시에 한 번 들어가면 앱이 켜지지도 않는다(실측 확인).
    /// </summary>
    private const int MaxDayDistance = 35;

    /// <summary>
    /// 검증. 통과하면 <see cref="SafePolicy"/>, 판정할 수 없으면 <c>null</c>(→ 잠그지 않는다).
    /// </summary>
    /// <param name="why">판정 불가 사유(기록·화면용). 통과했으면 <c>null</c>.</param>
    public static SafePolicy? Sanitize(PcOffPolicy? p, out string? why)
    {
        why = null;

        if (p == null)
        {
            why = "정책이 없습니다";
            return null;
        }

        // 서버 시각은 모든 계산의 뿌리다. 못 읽으면 아무것도 판단할 수 없다.
        //  · ⚠️ AssumeUniversal: 표기에 시간대가 없으면 **UTC로 확정**한다. 그러지 않으면 .NET이
        //    "이 PC의 시간대"로 해석해, 직원이 시간대를 바꾸면 같은 문자열이 다른 순간이 된다
        //    ("PC를 믿지 않는다"는 이 앱의 원칙에 구멍이 생긴다).
        if (!DateTimeOffset.TryParse(p.ServerTime, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var serverTime))
        {
            why = "서버 시각을 읽을 수 없습니다";
            Log.Warn("정책 검증 실패: 서버 시각 형식이 올바르지 않습니다.");
            return null;
        }
        // ⚠️ 시간대는 서버가 준 **표기**에서 읽지 않는다 — 서버는 UTC(Z)로 보내므로 그대로 쓰면 9시간 어긋난다.
        //    정책의 날짜·시각은 회사 지역 기준이므로 Hm.CompanyOffset을 쓴다(그 파일의 설명 참조).
        var offset = Hm.CompanyOffset;

        // 회사 기준으로 본 "서버의 오늘". 아래 날짜 검증의 기준점이 된다.
        var serverDate = DateOnly.FromDateTime(serverTime.ToOffset(offset).DateTime);

        // 잠금 대상이 아니면 나머지 값은 볼 필요가 없다(사유만 전달).
        if (!p.Enabled)
        {
            return new SafePolicy
            {
                Enabled = false,
                DisabledReason = string.IsNullOrWhiteSpace(p.DisabledReason) ? "unknown" : p.DisabledReason,
                Offset = offset,
                PolicyVersion = p.PolicyVersion,
            };
        }

        // ── 여기부터는 "잠금 대상"이므로 값이 모두 성립해야 한다 ────────────────

        // 모드: 지금 아는 것은 화면 잠금뿐. 모르는 모드로 잠그면 무슨 일이 일어날지 알 수 없다.
        if (p.Mode != "lock")
        {
            why = $"모르는 잠금 방식입니다({Safe(p.Mode)})";
            Log.Warn($"정책 검증 실패: 모르는 mode='{Safe(p.Mode)}' → 잠그지 않습니다.");
            return null;
        }

        var endMin = Hm.ToMinutes(p.Work.EndTime);
        if (endMin == Hm.Invalid)
        {
            why = "퇴근 기준시각이 올바르지 않습니다";
            Log.Warn("정책 검증 실패: 퇴근 기준시각을 읽을 수 없습니다 → 잠그지 않습니다.");
            return null;
        }

        if (p.DelayMin < 0 || p.DelayMin > MaxDelayMin)
        {
            why = $"유예 시간이 올바르지 않습니다({p.DelayMin}분)";
            Log.Warn($"정책 검증 실패: 유예 {p.DelayMin}분은 허용 범위(0~{MaxDelayMin}) 밖 → 잠그지 않습니다.");
            return null;
        }

        // 출근 기준시각은 "있으면 쓰고, 이상하면 안 쓴다".
        //  · 여기서 판정 불가로 처리하면 출근시각을 안 정한 회사는 퇴근 잠금까지 못 하게 된다(과도한 조치).
        //  · 안 쓰면 "출근 전 잠금"만 생략된다 = 잠그지 않는 쪽 = 안전한 방향.
        var startMin = Hm.ToMinutes(p.Work.StartTime);
        if (startMin != Hm.Invalid && startMin >= endMin)
        {
            Log.Warn($"출근({Hm.ToText(startMin)})이 퇴근({Hm.ToText(endMin)})보다 늦거나 같습니다 → 출근 전 잠금을 적용하지 않습니다.");
            startMin = Hm.Invalid;
        }

        // 날짜 목록: null 원소·못 읽는 날짜를 버린다. 하나도 안 남으면 판정 불가.
        var days = new List<DayRule>();
        var droppedDays = 0;
        var hasToday = false;
        foreach (var d in p.Days)
        {
            if (d == null) { droppedDays++; continue; }
            var date = Hm.ToDate(d.Date);
            if (date == null) { droppedDays++; continue; }

            // 서버 시각과 너무 먼 날짜는 버린다(날짜 계산이 넘쳐 판정기가 죽는 것을 막는다).
            if (Math.Abs(date.Value.DayNumber - serverDate.DayNumber) > MaxDayDistance) { droppedDays++; continue; }

            if (date.Value == serverDate) hasToday = true;
            var name = string.IsNullOrWhiteSpace(d.OffDayName) ? null : d.OffDayName!.Trim();
            days.Add(new DayRule(date.Value, d.IsWorkday, name));
        }
        if (droppedDays > 0) Log.Warn($"정책의 날짜 {droppedDays}건을 읽을 수 없어 건너뜁니다.");
        if (days.Count == 0)
        {
            why = "근무일 정보가 없습니다";
            Log.Warn("정책 검증 실패: 쓸 수 있는 날짜가 하나도 없습니다 → 잠그지 않습니다.");
            return null;
        }

        // ⚠️ 서버가 말하는 "지금"의 날짜가 근무일 목록에 없다 = 서버와 앱이 서로 다른 날을 보고 있다.
        //    가장 흔한 원인은 **서버를 다른 시간대(UTC 등)에 배포한 것**이다. 그러면 날짜·공휴일 판정이
        //    하루씩 어긋나는데 앱은 그것을 알 방법이 없다. 그래서 여기서 멈춘다 —
        //    "9시간 어긋난 채로 잠그기"보다 "안 잠그고 기록 남기기"가 언제나 낫다.
        if (!hasToday)
        {
            why = "서버 날짜와 근무일 정보가 맞지 않습니다";
            Log.Warn($"정책 검증 실패: 서버가 말하는 오늘({serverDate:yyyy-MM-dd})이 근무일 목록에 없습니다. " +
                     "서버 시간대 설정을 확인해야 합니다 → 잠그지 않습니다.");
            return null;
        }

        // 승인된 연장근무: 절대 시각 구간으로 펼친다. 0건인 것은 정상이다.
        var windows = new List<TimeWindow>();
        var droppedOt = 0;
        foreach (var o in p.ApprovedOvertime)
        {
            if (o == null) { droppedOt++; continue; }

            var date = Hm.ToDate(o.Date);
            var s = Hm.ToMinutes(o.StartTime);
            var e = Hm.ToMinutes(o.EndTime);
            if (date == null || s == Hm.Invalid || e == Hm.Invalid) { droppedOt++; continue; }

            // 먼 날짜는 버린다(위 날짜 검증과 같은 이유 — 계산 넘침 방지).
            if (Math.Abs(date.Value.DayNumber - serverDate.DayNumber) > MaxDayDistance) { droppedOt++; continue; }

            // 시작과 끝이 같은 신청은 버린다.
            //  · 아래 "종료 ≤ 시작 = 자정 넘김" 규칙에 걸려 **24시간 통째로 해제**되어 버린다.
            //    서버가 이미 막고 있지만(start==end 금지) 마지막 방어선을 여기 둔다.
            if (e == s) { droppedOt++; continue; }

            // 종료가 시작보다 작으면 자정을 넘긴다는 뜻(서버 규칙과 동일).
            var endOfDay = e < s ? e + Hm.Day : e;
            windows.Add(new TimeWindow(
                Hm.At(date.Value, s, offset),
                Hm.At(date.Value, endOfDay, offset)));
        }
        if (droppedOt > 0) Log.Warn($"승인된 연장근무 {droppedOt}건을 읽을 수 없어 건너뜁니다(그 시간대는 잠금 해제되지 않습니다).");

        // 사전알림: 범위 밖·중복을 버리고 큰 값부터 정렬(2-C가 순서대로 쓴다).
        var notify = new List<int>();
        foreach (var n in p.NotifyMins)
        {
            if (n <= 0 || n > MaxNotifyMin) continue;
            if (!notify.Contains(n)) notify.Add(n);
        }
        notify.Sort((a, b) => b.CompareTo(a));

        // 일시사용 사유 목록: 빈 값 제거 + 개수·길이 상한(가짜 서버가 거대한 문자열을 화면에 밀어 넣지 못하게).
        var tempReasons = new List<string>();
        foreach (var r in p.TempUse.Reasons)
        {
            if (string.IsNullOrWhiteSpace(r)) continue;
            if (tempReasons.Count >= MaxTempReasons) break;

            var text = r.Trim();
            if (text.Length > MaxTempReasonLen) continue; // 자르지 않고 버린다(위 설명 참조)
            tempReasons.Add(text);
        }

        var safe = new SafePolicy
        {
            Enabled = true,
            Offset = offset,
            StartMin = startMin,
            EndMin = endMin,
            DelayMin = p.DelayMin,
            NotifyMins = [.. notify],
            WorkDaysCsv = p.Work.WorkDays,   // 표시용만(판정은 Days로 한다)
            Days = [.. days],
            Overtime = [.. windows],
            TempUseMinutes = Clamp(p.TempUse.Minutes, MaxTempUseMin),
            TempUsePerDay = Clamp(p.TempUse.PerDay, MaxTempUsePerDay),
            TempUsedToday = Math.Max(0, p.TempUse.UsedToday),
            // 오프라인 한도도 같은 상한으로 자른다 — 가짜 서버가 "하루 9999회"를 내려보내
            // 사실상 잠금을 없애는 길을 막는다(온라인 한도와 같은 방어).
            OfflineTempUsePerDay = Clamp(p.TempUse.OfflinePerDay, MaxTempUsePerDay),
            OfflineTempUsedToday = Math.Max(0, p.TempUse.OfflineUsedToday),
            TempReasons = [.. tempReasons],
            PolicyVersion = p.PolicyVersion,
        };

        if (safe.SpillMin > 0)
        {
            Log.Info($"퇴근+유예가 자정을 넘습니다({Hm.ToText(safe.EndWithDelayMin)}). " +
                     $"새벽 00:00~{Hm.ToText(safe.SpillMin)}은 어제 근무일 여부를 알 수 없어 잠그지 않습니다.");
        }

        return safe;
    }

    /// <summary>0 미만은 0으로, 상한을 넘으면 상한으로(잠그는 쪽이 아니라 <b>안전한 쪽</b>으로 자른다).</summary>
    private static int Clamp(int value, int max)
    {
        if (value < 0) return 0;
        return value > max ? max : value;
    }

    /// <summary>기록에 남길 짧은 문자열로 다듬는다(서버가 보낸 값이 아주 길 수 있다).</summary>
    private static string Safe(string? s)
    {
        var v = (s ?? "").Trim();
        if (v.Length == 0) return "(빈 값)";
        return v.Length <= 20 ? v : v[..20] + "...";
    }
}
