using System;
using System.IO;
using System.Text;
using NewgaonPcOff.Config;
using NewgaonPcOff.Diagnostics;

namespace NewgaonPcOff.Security;

/// <summary>
/// 기기 토큰 보관소.
///  · 토큰 = 이 PC가 서버에 "나는 홍길동의 PC입니다"라고 증명하는 열쇠. 서버는 <b>해시만</b> 갖고 있어
///    이 파일을 잃으면 웹에서 새 연결코드를 받아 다시 연결해야 한다(그게 정상 동작이다).
///  · ⚠️ 절대 규칙: 토큰 값을 로그·화면·예외 메시지에 쓰지 않는다(사규 8조).
/// </summary>
internal static class TokenStore
{
    /// <summary>토큰을 암호화해서 저장한다.</summary>
    public static void Save(string token)
    {
        if (string.IsNullOrWhiteSpace(token)) throw new ArgumentException("빈 토큰은 저장할 수 없습니다.", nameof(token));

        AgentPaths.EnsureDirs();
        var bytes = Encoding.UTF8.GetBytes(token);
        var locked = Dpapi.Protect(bytes);
        Array.Clear(bytes); // 평문 흔적 지우기
        File.WriteAllBytes(AgentPaths.TokenFile, locked);
        Log.Info("기기 토큰을 저장했습니다."); // 값은 남기지 않는다
    }

    /// <summary>저장된 토큰을 읽는다. 없거나 풀 수 없으면 <c>null</c>(→ 다시 연결 안내).</summary>
    public static string? TryLoad()
    {
        try
        {
            if (!File.Exists(AgentPaths.TokenFile)) return null;
            var raw = File.ReadAllBytes(AgentPaths.TokenFile);
            if (raw.Length == 0) return null;

            var plain = Dpapi.Unprotect(raw);
            var token = Encoding.UTF8.GetString(plain);
            Array.Clear(plain);
            return string.IsNullOrWhiteSpace(token) ? null : token;
        }
        catch (Exception ex)
        {
            // 다른 계정·다른 PC로 파일을 옮긴 경우 여기로 온다(설계된 동작).
            Log.Warn("저장된 기기 토큰을 풀 수 없습니다(다시 연결이 필요합니다). " + ex.GetType().Name);
            return null;
        }
    }

    public static bool Exists => File.Exists(AgentPaths.TokenFile);

    /// <summary>
    /// 이 PC에서 연결 정보를 지운다(서버 쪽 기기 해제는 웹 [계정]·[PC관리]에서 한다).
    ///  · <b>성공 여부를 돌려준다.</b> 지우지 못했는데 "지웠습니다"라고 표시하면
    ///    직원은 해제됐다고 믿는데 PC는 계속 잠기는(또는 그 반대) 어긋난 상태가 된다.
    /// </summary>
    public static bool Clear()
    {
        try
        {
            if (File.Exists(AgentPaths.TokenFile)) File.Delete(AgentPaths.TokenFile);

            // 지웠다고 믿지 말고 실제로 사라졌는지 확인한다(파일 잠금·권한 문제 대비).
            if (File.Exists(AgentPaths.TokenFile))
            {
                Log.Warn("기기 토큰 파일이 여전히 남아 있습니다.");
                return false;
            }
            Log.Info("기기 토큰을 삭제했습니다.");
            return true;
        }
        catch (Exception ex)
        {
            Log.Error("기기 토큰 삭제 실패", ex);
            return false;
        }
    }
}
