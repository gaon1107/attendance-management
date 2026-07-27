using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using NewgaonPcOff.Config;
using NewgaonPcOff.Diagnostics;
using NewgaonPcOff.Security;

namespace NewgaonPcOff.Core;

/// <summary>서버로 보낼 사건 한 건.</summary>
internal sealed class QueuedEvent
{
    /// <summary>이 사건의 고유번호. 재전송해도 서버가 <b>두 번 세지 않게</b> 하는 열쇠다.</summary>
    [JsonPropertyName("id")] public string Id { get; set; } = "";

    /// <summary>lock / unlock / temp_use / temp_use_offline / notify — 서버가 받는 종류만 쓴다(서버 ALLOWED_TYPES와 짝).</summary>
    [JsonPropertyName("type")] public string Type { get; set; } = "";

    /// <summary>일어난 시각(회사 기준). ⚠️ PC 시계가 아니라 <b>서버 시각 기준</b>으로 계산된 값이다.</summary>
    [JsonPropertyName("at")] public DateTimeOffset At { get; set; }

    /// <summary>[일시사용] 사유(회사가 정한 목록의 값)만 담는다. 다른 종류는 항상 비어 있다.</summary>
    [JsonPropertyName("meta")] public string? Meta { get; set; }
}

/// <summary>
/// 아직 서버로 보내지 못한 사건을 <b>줄 세워 보관</b>한다(오프라인 대비).
///
/// 왜 필요한가
///  · 서버의 미보고 감시(<c>webapp/lib/pcoff-alert.ts</c>)가 보는 것은 <c>lock</c> 사건이다.
///    인터넷이 끊긴 동안 잠긴 사실을 잃어버리면, 정상 동작한 PC가 <b>"안 잠갔다"고 오해</b>받는다.
///  · 그래서 못 보낸 사건은 파일에 남겨 두었다가 통신이 되면 한 번에 올린다(지시서 §5 시나리오 ④).
///
/// 지키는 것
///  · <b>암호화 저장</b>(DPAPI). 자물쇠는 토큰·정책 캐시와 <b>또 다른 값</b>을 쓴다(용도별 분리).
///  · 보내기 <b>성공한 뒤에만</b> 지운다. 실패하면 그대로 두고 다음에 다시 보낸다.
///  · 무한히 쌓이지 않게 상한을 둔다. 넘치면 <b>오래된 것부터</b> 버린다
///    (최근 것이 더 중요하다 — 오늘 잠갔는지가 어제 잠갔는지보다 쓸모 있다).
/// </summary>
internal sealed class EventQueue
{
    /// <summary>
    /// 사건 대기줄 전용 자물쇠.
    ///  · 🔒 한 번 정한 뒤에는 바꾸지 않는다. 바꾸면 저장된 대기줄을 못 열어 <b>못 보낸 기록이 사라진다</b>.
    /// </summary>
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("NewgaonPcOff/event-queue/v1");

    /// <summary>파일 형식 번호. 형식을 바꾸면 올린다(옛 파일은 조용히 버려진다).</summary>
    private const int CurrentVersion = 1;

    /// <summary>
    /// 보관 상한.
    ///  · 계산 근거(2026-07-27): 하루 최대 = 잠금 1 + 해제 1 + 사전알림 5 + 일시사용 1회당 3건.
    ///    일시사용을 하루 6회 쓰면 ≈ 25건 → 한 달(31일) 오프라인이면 ≈ 775건.
    ///  · 🔴 예전 값(300)으로 두면 <b>가장 먼저 잠긴 날의 기록부터 사라진다</b> — 근로시간 근거(3년 보존 대상)다.
    ///    오프라인 보장 기간을 이틀 → 한 달로 늘렸으므로 이 값도 함께 올려야 한다(검수 지적 M-3).
    /// </summary>
    private const int MaxKeep = 1200;

    /// <summary>
    /// 상한을 넘겼을 때 <b>먼저 버리는</b> 종류(장비 상태 기록 — 임금과 무관).
    ///  · 잠금·해제·일시사용은 근로시간 근거라 마지막까지 지킨다.
    /// </summary>
    private static readonly string[] LowPriorityTypes = ["notify", "offline", "paired"];

    /// <summary>한 번에 보내는 최대 건수. ⚠️ 서버 상한(100건)을 넘으면 통째로 거부당한다.</summary>
    public const int BatchSize = 50;

    private readonly List<QueuedEvent> _items = [];

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    private sealed class Envelope
    {
        [JsonPropertyName("v")] public int Version { get; set; }
        [JsonPropertyName("items")] public List<QueuedEvent>? Items { get; set; }
    }

    public EventQueue()
    {
        Load();
    }

    public int Count => _items.Count;

    /// <summary>사건 하나를 줄에 세운다. 곧바로 파일에도 남긴다(지금 전원이 꺼져도 잃지 않게).</summary>
    public void Enqueue(string type, DateTimeOffset at, string? meta = null)
    {
        if (string.IsNullOrWhiteSpace(type)) return;

        _items.Add(new QueuedEvent
        {
            Id = Guid.NewGuid().ToString("N"), // 서버의 중복 방지 열쇠(clientEventId)
            Type = type,
            At = at,
            Meta = meta,
        });

        if (_items.Count > MaxKeep)
        {
            var over = _items.Count - MaxKeep;

            // ① 먼저 "장비 상태 기록"을 오래된 것부터 버린다(사전알림·오프라인·연결).
            var droppedLow = 0;
            for (var i = 0; i < _items.Count && droppedLow < over; )
            {
                if (Array.IndexOf(LowPriorityTypes, _items[i].Type) >= 0)
                {
                    _items.RemoveAt(i);
                    droppedLow++;
                    continue;
                }
                i++;
            }

            // ② 그래도 넘치면 어쩔 수 없이 오래된 것부터 버린다(근로 기록이 포함될 수 있다 → 경고를 나눠 남긴다).
            var droppedWork = over - droppedLow;
            if (droppedWork > 0) _items.RemoveRange(0, droppedWork);

            Log.Warn($"보내지 못한 기록이 {MaxKeep}건을 넘어 {over}건을 버렸습니다" +
                     $"(장비기록 {droppedLow}건{(droppedWork > 0 ? $" · ⚠️ 근로기록 포함 {droppedWork}건" : "")}).");
        }

        Save();
    }

    /// <summary>
    /// 아직 못 보낸 기록 중 <b>그 날짜(회사 기준)</b>의 특정 종류가 몇 건인지.
    ///  · [일시사용] 횟수를 앱이 스스로 세기 위해 쓴다. 서버가 센 횟수(<c>usedToday</c>)는
    ///    기록이 서버에 <b>닿아야</b> 오르므로, 오프라인에서 앱을 껐다 켜면 그 사이의 사용이
    ///    없던 일이 되어 하루 제한을 무한히 넘길 수 있다(검수 치명 C-2).
    /// </summary>
    public int CountOn(string type, DateOnly date, TimeSpan offset)
    {
        var n = 0;
        foreach (var e in _items)
        {
            if (!string.Equals(e.Type, type, StringComparison.Ordinal)) continue;
            if (DateOnly.FromDateTime(e.At.ToOffset(offset).DateTime) != date) continue;
            n++;
        }
        return n;
    }

    /// <summary>보낼 묶음을 꺼내 본다(아직 지우지 않는다 — 보내기에 성공해야 지운다).</summary>
    public QueuedEvent[] Peek(int max = BatchSize)
    {
        if (_items.Count == 0) return [];
        var take = Math.Min(max, _items.Count);
        return _items.GetRange(0, take).ToArray();
    }

    /// <summary>보내기에 성공한 것들을 줄에서 지운다.</summary>
    public void Remove(QueuedEvent[] sent)
    {
        if (sent == null || sent.Length == 0) return;

        var ids = new HashSet<string>();
        foreach (var e in sent) ids.Add(e.Id);

        _items.RemoveAll(x => ids.Contains(x.Id));
        Save();
    }

    /// <summary>줄을 통째로 비운다(연결이 바뀌었을 때 — 남의 회사로 남의 기록을 보내면 안 된다).</summary>
    public void Clear()
    {
        _items.Clear();
        try
        {
            if (File.Exists(AgentPaths.EventsFile)) File.Delete(AgentPaths.EventsFile);
        }
        catch (Exception ex)
        {
            Log.Warn($"보내지 못한 기록 파일을 지우지 못했습니다: {ex.GetType().Name}");
        }
    }

    // ── 파일 ────────────────────────────────────────────────────────────────

    private void Save()
    {
        var tmp = AgentPaths.EventsFile + ".tmp";
        try
        {
            if (_items.Count == 0) { Clear(); return; }

            AgentPaths.EnsureDirs();

            var json = JsonSerializer.SerializeToUtf8Bytes(
                new Envelope { Version = CurrentVersion, Items = _items }, JsonOpts);
            var locked = Dpapi.Protect(json, Entropy);
            Array.Clear(json);

            // 임시 파일 → 바꿔치기(쓰다 끊겨 반쪽 파일이 남는 것을 막는다 — 토큰·정책 캐시와 같은 방식).
            File.WriteAllBytes(tmp, locked);
            File.Move(tmp, AgentPaths.EventsFile, overwrite: true);
        }
        catch (Exception ex)
        {
            // 저장 실패해도 앱은 계속 돈다 — 메모리에는 남아 있으므로 이번 실행 동안은 보낼 수 있다.
            Log.Warn($"보내지 못한 기록을 저장하지 못했습니다: {ex.GetType().Name}");
            try { if (File.Exists(tmp)) File.Delete(tmp); } catch { /* 임시파일 정리 실패는 무시 */ }
        }
    }

    private void Load()
    {
        byte[] raw;
        try
        {
            if (!File.Exists(AgentPaths.EventsFile)) return;
            raw = File.ReadAllBytes(AgentPaths.EventsFile);
        }
        catch (Exception ex)
        {
            // 읽기 실패(잠김·권한)는 파일 탓이 아닐 수 있으니 지우지 않는다.
            Log.Warn($"보내지 못한 기록을 읽지 못했습니다(파일은 그대로 둡니다): {ex.GetType().Name}");
            return;
        }

        try
        {
            if (raw.Length == 0) throw new InvalidDataException("빈 파일");

            var json = Dpapi.Unprotect(raw, Entropy);
            var envelope = JsonSerializer.Deserialize<Envelope>(json, JsonOpts);
            Array.Clear(json);

            if (envelope == null) throw new InvalidDataException("내용 없음");
            if (envelope.Version != CurrentVersion) throw new InvalidDataException($"형식 번호 {envelope.Version}");

            foreach (var e in envelope.Items ?? [])
            {
                // 목록 안의 빈 칸(null)·망가진 항목은 여기서 걸러낸다.
                //  (그대로 두면 전송할 때 예외가 나 대기줄 전체가 영영 안 나간다)
                if (e == null || string.IsNullOrWhiteSpace(e.Type) || string.IsNullOrWhiteSpace(e.Id)) continue;
                _items.Add(e);
            }

            if (_items.Count > 0) Log.Info($"보내지 못한 기록 {_items.Count}건을 이어서 보냅니다.");
        }
        catch (Exception ex)
        {
            // 다른 계정·다른 PC로 옮김 / 형식 변경 / 손상 — 어차피 못 쓰므로 버린다.
            Log.Warn($"보내지 못한 기록을 쓸 수 없어 버립니다: {ex.GetType().Name}");
            Clear();
        }
    }
}
