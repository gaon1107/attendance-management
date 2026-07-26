using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using NewgaonPcOff.Api;
using NewgaonPcOff.Config;
using NewgaonPcOff.Diagnostics;
using NewgaonPcOff.Security;

namespace NewgaonPcOff.Core;

/// <summary>
/// 마지막으로 받은 회사 설정을 <b>암호화해서</b> 이 PC에 보관한다.
///
/// 왜 필요한가
///  · 인터넷이 끊기거나 서버가 잠깐 죽어도 잠금 판정이 이어져야 한다(지시서 §5 오프라인 요구사항).
///  · 앱을 껐다 켜도 곧바로 판정할 수 있다(켤 때마다 몇 초씩 "확인 중"으로 비어 있지 않게).
///
/// 지키는 것
///  · <b>암호화 필수</b> — [수집하는 정보] 화면이 근로자에게 "암호화해 보관합니다"라고 고지했다.
///  · 자물쇠(entropy)는 기기 토큰과 <b>다른 값</b>을 쓴다(용도별 분리).
///  · 저장 시점의 PC 시계를 함께 담는다 — 재부팅 후에도 "그 뒤 얼마나 흘렀는지" 계산하기 위해서다
///    (<see cref="ServerClock.SyncFromCache"/> 참조).
///  · 못 푸는 파일은 <b>지운다</b>. 남겨두면 매번 실패 기록만 쌓이고 아무 도움이 안 된다.
/// </summary>
internal static class PolicyCache
{
    /// <summary>
    /// 정책 캐시 전용 자물쇠.
    ///  · 🔒 한 번 정한 뒤에는 바꾸지 않는다. 바꾸면 저장된 캐시를 못 열어
    ///    "오프라인인데 판정 불가"(=잠기지 않음)가 된다. 다만 기기 토큰과 달리 다시 받으면 복구되므로
    ///    사고의 무게는 가볍다.
    /// </summary>
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("NewgaonPcOff/policy-cache/v1");

    /// <summary>이 앱이 쓰는 캐시 형식 번호. 형식을 바꾸면 올린다(옛 캐시는 조용히 버려진다).</summary>
    private const int CurrentVersion = 1;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    /// <summary>캐시에 담는 내용.</summary>
    private sealed class Envelope
    {
        [JsonPropertyName("v")] public int Version { get; set; }

        /// <summary>서버가 준 정책 원본(그대로 다시 담은 것).</summary>
        [JsonPropertyName("policy")] public PcOffPolicy? Policy { get; set; }

        /// <summary>저장한 시점의 PC 시계(UTC). 재부팅 후 경과 시간을 추정하는 데 쓴다.</summary>
        [JsonPropertyName("savedWallUtc")] public DateTimeOffset SavedWallUtc { get; set; }
    }

    /// <summary>저장. 성공 여부를 돌려준다(실패해도 앱은 계속 돈다 — 서버로 다시 받으면 되니까).</summary>
    public static bool Save(PcOffPolicy policy)
    {
        ArgumentNullException.ThrowIfNull(policy);

        var tmp = AgentPaths.PolicyFile + ".tmp";
        try
        {
            AgentPaths.EnsureDirs();

            var envelope = new Envelope
            {
                Version = CurrentVersion,
                Policy = policy,
                SavedWallUtc = DateTimeOffset.UtcNow,
            };
            var json = JsonSerializer.SerializeToUtf8Bytes(envelope, JsonOpts);
            var locked = Dpapi.Protect(json, Entropy);
            Array.Clear(json);

            // 임시 파일 → 바꿔치기. 쓰다가 끊겨 반쪽 파일이 남는 것을 막는다(TokenStore와 같은 방식).
            File.WriteAllBytes(tmp, locked);
            File.Move(tmp, AgentPaths.PolicyFile, overwrite: true);
            return true;
        }
        catch (Exception ex)
        {
            Log.Warn($"회사 설정을 이 PC에 저장하지 못했습니다: {ex.GetType().Name}");
            try { if (File.Exists(tmp)) File.Delete(tmp); } catch { /* 임시파일 정리 실패는 무시 */ }
            return false;
        }
    }

    /// <summary>저장된 정책을 읽는다. 없거나 쓸 수 없으면 <c>null</c>.</summary>
    public static CachedPolicy? TryLoad()
    {
        byte[] raw;
        try
        {
            if (!File.Exists(AgentPaths.PolicyFile)) return null;
            raw = File.ReadAllBytes(AgentPaths.PolicyFile);
        }
        catch (Exception ex)
        {
            // 읽기 실패(잠김·권한)는 파일 탓이 아닐 수 있으니 지우지 않는다.
            Log.Warn($"저장된 회사 설정을 읽지 못했습니다(파일은 그대로 둡니다): {ex.GetType().Name}");
            return null;
        }

        try
        {
            if (raw.Length == 0) throw new InvalidDataException("빈 파일");

            var json = Dpapi.Unprotect(raw, Entropy);
            var envelope = JsonSerializer.Deserialize<Envelope>(json, JsonOpts);
            Array.Clear(json);

            if (envelope == null) throw new InvalidDataException("내용 없음");
            if (envelope.Version != CurrentVersion) throw new InvalidDataException($"형식 번호 {envelope.Version}");
            if (envelope.Policy == null) throw new InvalidDataException("정책 없음");
            if (envelope.SavedWallUtc == default) throw new InvalidDataException("저장 시각 없음");

            return new CachedPolicy(envelope.Policy, envelope.SavedWallUtc);
        }
        catch (Exception ex)
        {
            // 다른 계정·다른 PC로 옮김 / 형식 변경 / 손상. 어차피 못 쓰므로 지운다.
            Log.Warn($"저장된 회사 설정을 쓸 수 없어 삭제합니다: {ex.GetType().Name}");
            Clear();
            return null;
        }
    }

    /// <summary>캐시를 버린다(연결을 지웠을 때 — 남의 회사 설정이 남아 있으면 안 된다).</summary>
    public static bool Clear()
    {
        try
        {
            if (File.Exists(AgentPaths.PolicyFile)) File.Delete(AgentPaths.PolicyFile);
            return !File.Exists(AgentPaths.PolicyFile);
        }
        catch (Exception ex)
        {
            Log.Warn($"저장된 회사 설정을 지우지 못했습니다: {ex.GetType().Name}");
            return false;
        }
    }
}

/// <summary>캐시에서 읽어온 정책과 "언제 저장했는지".</summary>
internal sealed record CachedPolicy(PcOffPolicy Policy, DateTimeOffset SavedWallUtc);
