using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using NewgaonPcOff.Diagnostics;

namespace NewgaonPcOff.Config;

/// <summary>
/// 비밀이 아닌 설정만 담는다(서버 주소·컴퓨터 이름·연결된 회사/이름 표시용).
///  · ⚠️ 기기 토큰은 여기에 넣지 않는다 — <see cref="Security.TokenStore"/>가 암호화해서 따로 보관한다.
///  · ⚠️ 잠금을 풀거나 약하게 만드는 스위치는 이 파일에 두지 않는다.
///    직원이 메모장으로 고칠 수 있는 파일이므로, 그런 값이 있으면 그게 곧 우회 통로가 된다.
///    (검증용 테스트 모드는 실행 인자 <c>--test-mode</c>로만 켠다 — 2-C에서 구현)
/// </summary>
internal sealed class AgentConfig
{
    /// <summary>근태관리 서버 주소. 예: https://근태.회사.co.kr — 끝의 / 는 저장할 때 떼어낸다.</summary>
    public string ServerUrl { get; set; } = "http://localhost:3000";

    /// <summary>[PC관리] 화면에 뜰 이 컴퓨터 이름. 기본값은 윈도우 컴퓨터 이름.</summary>
    public string DeviceName { get; set; } = Environment.MachineName;

    // ── 아래 3개는 연결 후 화면에 "누구/어디에 연결됐는지" 보여주기 위한 표시용 값(비밀 아님) ──
    public string? PairedUserName { get; set; }
    public string? PairedCompanyName { get; set; }
    public DateTimeOffset? PairedAt { get; set; }

    // ── 읽기·쓰기 ────────────────────────────────────────────────────────────

    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        // 사람이 손으로 고칠 수 있는 파일이라 대소문자를 따지지 않는다(디버깅 혼란 방지).
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>설정 파일을 읽는다. 없거나 깨졌으면 기본값을 돌려준다(앱이 죽지 않게).</summary>
    public static AgentConfig Load()
    {
        try
        {
            if (File.Exists(AgentPaths.ConfigFile))
            {
                var text = File.ReadAllText(AgentPaths.ConfigFile);
                var cfg = JsonSerializer.Deserialize<AgentConfig>(text, Json);
                if (cfg != null) return cfg.Normalized();
            }
        }
        catch (Exception ex)
        {
            Log.Error("설정 파일을 읽지 못해 기본값을 사용합니다.", ex);
        }
        return new AgentConfig().Normalized();
    }

    /// <summary>
    /// 저장. <b>성공 여부를 돌려준다</b> — 호출부는 실패를 성공으로 표시하면 안 된다.
    ///  · 실패를 조용히 삼키면 "화면은 연결됨인데 서버 주소가 저장되지 않아 통신이 전부 실패"하는
    ///    원인 불명 상태가 만들어진다.
    ///  · 임시 파일에 먼저 쓴 뒤 바꿔치기한다 — 쓰다가 중단돼도 기존 설정이 깨지지 않게.
    /// </summary>
    public bool Save()
    {
        var tmp = AgentPaths.ConfigFile + ".tmp";
        try
        {
            AgentPaths.EnsureDirs();
            var me = Normalized();
            File.WriteAllText(tmp, JsonSerializer.Serialize(me, Json));

            if (File.Exists(AgentPaths.ConfigFile)) File.Replace(tmp, AgentPaths.ConfigFile, null);
            else File.Move(tmp, AgentPaths.ConfigFile);
            return true;
        }
        catch (Exception ex)
        {
            Log.Error("설정 파일을 저장하지 못했습니다.", ex);
            try { if (File.Exists(tmp)) File.Delete(tmp); } catch { /* 임시파일 정리 실패는 무시 */ }
            return false;
        }
    }

    /// <summary>값 다듬기 — 서버 주소 끝의 /·앞뒤 공백 제거, 컴퓨터 이름 빈 값 방지·길이 제한(서버 80자).</summary>
    public AgentConfig Normalized()
    {
        ServerUrl = (ServerUrl ?? "").Trim().TrimEnd('/');
        if (ServerUrl.Length == 0) ServerUrl = "http://localhost:3000";

        DeviceName = (DeviceName ?? "").Trim();
        if (DeviceName.Length == 0) DeviceName = Environment.MachineName;
        if (DeviceName.Length > 80) DeviceName = DeviceName[..80];

        return this;
    }

    /// <summary>
    /// 서버 주소가 쓸 수 있는 형태인지 확인한다.
    ///  · http/https + 호스트만 허용한다. 경로·물음표(질의)·#(조각)·아이디:비번이 붙으면 거부한다.
    ///    이유: 주소를 글자로 이어 붙여 <c>/api/agent/...</c>를 만들기 때문에, 그런 게 섞이면
    ///    엉뚱한 곳으로 연결코드를 보내게 되고(#조각이면 서버 루트로 POST), 아이디:비번은
    ///    설정 파일에 비밀번호를 평문으로 남긴다(사규 8조).
    /// </summary>
    public static bool IsValidServerUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return false;
        if (!Uri.TryCreate(url.Trim().TrimEnd('/'), UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return false;
        if (uri.UserInfo.Length > 0) return false;               // http://아이디:비번@... 금지
        if (uri.Query.Length > 0 || uri.Fragment.Length > 0) return false;
        if (uri.AbsolutePath != "/") return false;               // 경로가 붙은 주소 금지
        return uri.Host.Length > 0;
    }

    /// <summary>
    /// 암호화되지 않은(http) 주소인지. 사내망 개발·시험에는 필요하지만, 실제 배포에는 https를 써야 한다.
    ///  · http면 연결코드 응답의 <b>평문 토큰</b>과 이후 모든 인증 헤더가 같은 네트워크에서 엿보일 수 있다.
    ///  · localhost는 자기 PC 안이라 예외로 둔다.
    /// </summary>
    public static bool IsInsecureUrl(string? url)
    {
        if (!IsValidServerUrl(url)) return false;
        var uri = new Uri(url!.Trim().TrimEnd('/'), UriKind.Absolute);
        if (uri.Scheme != Uri.UriSchemeHttp) return false;
        return !uri.IsLoopback;
    }
}
