using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using NewgaonPcOff.Config;
using NewgaonPcOff.Diagnostics;
using NewgaonPcOff.Security;

namespace NewgaonPcOff.Core;

/// <summary>
/// 오늘 <b>인터넷이 끊긴 동안</b> 쓴 [일시사용] 횟수만 보관하는 아주 작은 저장소.
///
/// 왜 따로 두나 (재검수 치명 N-2)
///  · 이 횟수를 "아직 못 보낸 기록 수"로 세면, 기록이 서버로 <b>올라가는 순간 지워져</b> 셀 근거가 사라진다.
///    그 틈(재연결 직후 1~5분)에 앱을 껐다 켜면 한도가 통째로 되살아난다 — 반복하면 하루 제한이 없어진다.
///  · 그래서 대기줄과 <b>수명이 다른</b> 자리에 {날짜, 횟수}만 남긴다.
///
/// 지키는 것
///  · <b>암호화 저장</b>(DPAPI). 자물쇠는 토큰·정책·대기줄과 <b>또 다른 값</b>을 쓴다(용도별 분리).
///  · 날짜가 함께 들어간다 — 날이 바뀌면 어제 숫자를 쓰지 않는다.
///  · 이 파일을 지우면 0이 되지만, 그때는 <b>서버가 센 값</b>이 막는다(두 출처 설계의 나머지 반쪽).
///  · 저장·읽기에 실패해도 앱은 계속 돈다(메모리 값으로 이어서 센다) — 잠금이 멈추는 것보다 낫다.
/// </summary>
internal static class OfflineUsageStore
{
    /// <summary>🔒 이 값은 바꾸지 않는다. 바꾸면 저장된 횟수를 못 읽어 한도가 되살아난다.</summary>
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("NewgaonPcOff/offline-usage/v1");

    private const int CurrentVersion = 1;

    private sealed class Envelope
    {
        [JsonPropertyName("v")] public int Version { get; set; }

        /// <summary>"yyyy-MM-dd"(회사 기준).</summary>
        [JsonPropertyName("date")] public string? Date { get; set; }

        [JsonPropertyName("count")] public int Count { get; set; }
    }

    /// <summary>저장된 값을 읽는다. 그 날짜 것이 아니거나 읽을 수 없으면 <c>0</c>.</summary>
    public static int Load(DateOnly today)
    {
        try
        {
            if (!File.Exists(AgentPaths.UsageFile)) return 0;

            var raw = File.ReadAllBytes(AgentPaths.UsageFile);
            if (raw.Length == 0) return 0;

            var json = Dpapi.Unprotect(raw, Entropy);
            var env = JsonSerializer.Deserialize<Envelope>(json);
            Array.Clear(json);

            if (env == null || env.Version != CurrentVersion) return 0;
            if (Hm.ToDate(env.Date) != today) return 0; // 어제 것은 쓰지 않는다

            return env.Count > 0 ? env.Count : 0;
        }
        catch (Exception ex)
        {
            // 다른 계정·다른 PC로 옮김 / 손상 — 못 읽으면 0으로 본다(서버 값이 남은 방어선이다).
            Log.Warn($"오프라인 사용 횟수를 읽지 못했습니다: {ex.GetType().Name}");
            return 0;
        }
    }

    /// <summary>지금 값을 저장한다(일시사용을 한 번 쓸 때마다 부른다).</summary>
    public static void Save(DateOnly date, int count)
    {
        var tmp = AgentPaths.UsageFile + ".tmp";
        try
        {
            AgentPaths.EnsureDirs();

            var json = JsonSerializer.SerializeToUtf8Bytes(new Envelope
            {
                Version = CurrentVersion,
                Date = date.ToString("yyyy-MM-dd"),
                Count = Math.Max(0, count),
            });
            var locked = Dpapi.Protect(json, Entropy);
            Array.Clear(json);

            // 임시 파일 → 바꿔치기(쓰다 끊겨 반쪽 파일이 남는 것을 막는다 — 다른 저장소와 같은 방식).
            File.WriteAllBytes(tmp, locked);
            File.Move(tmp, AgentPaths.UsageFile, overwrite: true);
        }
        catch (Exception ex)
        {
            // 저장에 실패해도 이번 실행 동안은 메모리 값으로 센다.
            Log.Warn($"오프라인 사용 횟수를 저장하지 못했습니다: {ex.GetType().Name}");
            try { if (File.Exists(tmp)) File.Delete(tmp); } catch { /* 임시파일 정리 실패는 무시 */ }
        }
    }

    /// <summary>연결이 바뀌었다(다른 직원으로 재연결) → 남의 사용 횟수를 물려주지 않는다.</summary>
    public static void Clear()
    {
        try
        {
            if (File.Exists(AgentPaths.UsageFile)) File.Delete(AgentPaths.UsageFile);
        }
        catch (Exception ex)
        {
            Log.Warn($"오프라인 사용 횟수 파일을 지우지 못했습니다: {ex.GetType().Name}");
        }
    }
}
