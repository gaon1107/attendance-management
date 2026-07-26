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
    /// <summary>
    /// 이 파일 전용 추가 자물쇠.
    ///  · 🔒 <b>이 문자열은 절대 바꾸지 않는다.</b> 한 글자만 달라져도 이미 저장된 <c>device.bin</c>이
    ///    열리지 않고, 그러면 "연결됨으로 보이는데 실제로는 미연결"이 되어 PC가 조용히 잠기지 않는다
    ///    (2-A 재검수에서 실제로 잡힌 치명 사고 N-1).
    ///  · 정책 캐시는 <see cref="Core.PolicyCache"/>가 <b>다른</b> 값을 쓴다(용도별 분리).
    /// </summary>
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("NewgaonPcOff/device-token/v1");

    /// <summary>
    /// 연속으로 몇 번 못 풀었을 때 파일을 지울지.
    ///  · ⚠️ 왜 한 번에 지우지 않는가: 2-B부터 판정기가 이 함수를 <b>수시로</b> 부른다.
    ///    로그오프 직전처럼 윈도우 암호해제가 일시적으로 실패하는 순간이 한 번만 걸려도
    ///    멀쩡한 연결이 끊기고 직원은 새 연결코드를 받아야 한다(그 사이 PC는 잠기지 않는다).
    ///  · 그래도 <b>결국은 지운다</b> — 못 푸는 파일을 남기면 "연결됨으로 보이는데 미연결"이 되기 때문이다
    ///    (2-A 재검수 치명 N-1). 늦추기만 하고 없애지는 않는다.
    /// </summary>
    private const int DeleteAfterFailures = 3;

    private static int _decryptFailures;

    /// <summary>
    /// 토큰을 암호화해서 저장한다.
    ///  · 임시 파일에 먼저 쓴 뒤 바꿔치기한다 — 쓰다가 끊겨 <b>반쪽 파일</b>이 남으면
    ///    "파일은 있는데 열 수 없는" 상태가 되고, 그건 화면과 실제가 어긋나는 사고로 이어진다.
    /// </summary>
    public static void Save(string token)
    {
        if (string.IsNullOrWhiteSpace(token)) throw new ArgumentException("빈 토큰은 저장할 수 없습니다.", nameof(token));

        AgentPaths.EnsureDirs();
        var bytes = Encoding.UTF8.GetBytes(token);
        var locked = Dpapi.Protect(bytes, Entropy);
        Array.Clear(bytes); // 평문 흔적 지우기

        var tmp = AgentPaths.TokenFile + ".tmp";
        try
        {
            File.WriteAllBytes(tmp, locked);
            File.Move(tmp, AgentPaths.TokenFile, overwrite: true);
        }
        catch
        {
            try { if (File.Exists(tmp)) File.Delete(tmp); } catch { /* 임시파일 정리 실패는 무시 */ }
            throw;
        }
        _decryptFailures = 0; // 새로 저장했으니 앞의 실패 기록은 의미가 없다
        Log.Info("기기 토큰을 저장했습니다."); // 값은 남기지 않는다
    }

    /// <summary>
    /// 저장된 토큰을 읽는다. 없거나 풀 수 없으면 <c>null</c>.
    ///  · ⚠️ <b>풀 수 없는 파일은 지운다.</b> 그러지 않으면 <see cref="Exists"/>(파일 있음)와
    ///    이 함수(열 수 있음)의 답이 갈려서, 트레이는 "연결됨"인데 실제로는 미연결인 상태가 된다.
    ///    그 상태에서는 연결창도 자동으로 뜨지 않아 <b>직원은 할 일이 없다고 믿고, PC는 잠기지 않는다.</b>
    ///  · 다만 파일을 읽지 못한 것(잠김·권한)과 못 푼 것을 구분한다 — 잠깐의 파일 잠금으로
    ///    멀쩡한 연결 정보를 날리면 안 되기 때문이다.
    /// </summary>
    public static string? TryLoad()
    {
        byte[] raw;
        try
        {
            if (!File.Exists(AgentPaths.TokenFile)) return null;
            raw = File.ReadAllBytes(AgentPaths.TokenFile);
        }
        catch (Exception ex)
        {
            // 읽기 실패(다른 프로그램이 잠금·권한) — 파일은 멀쩡할 수 있으니 지우지 않는다.
            Log.Warn($"기기 토큰 파일을 읽지 못했습니다(파일은 그대로 둡니다): {ex.GetType().Name}");
            return null;
        }

        try
        {
            if (raw.Length == 0) throw new InvalidDataException("빈 파일");

            var plain = Dpapi.Unprotect(raw, Entropy);
            var token = Encoding.UTF8.GetString(plain);
            Array.Clear(plain);
            if (string.IsNullOrWhiteSpace(token)) throw new InvalidDataException("빈 토큰");

            _decryptFailures = 0; // 한 번 풀렸으면 앞의 실패는 일시적인 것이었다
            return token;
        }
        catch (Exception ex)
        {
            // 여기로 오는 경우: 다른 계정·다른 PC로 파일을 옮김 / 프로그램이 바뀜 / 파일 손상
            //                 / 일시적인 암호해제 실패(로그오프·세션 전환 등).
            _decryptFailures++;

            if (_decryptFailures < DeleteAfterFailures)
            {
                Log.Warn($"기기 토큰을 풀지 못했습니다({_decryptFailures}/{DeleteAfterFailures}회) — " +
                         $"일시적인 문제일 수 있어 파일은 그대로 둡니다: {ex.GetType().Name}");
                return null;
            }

            // 계속 못 푼다 = 정말 쓸 수 없는 파일이다. 지워서 "연결 안 됨" 상태로 일치시킨다(→ 연결창이 뜬다).
            Log.Warn($"기기 토큰을 {_decryptFailures}회 연속 풀 수 없어 삭제합니다(다시 연결이 필요합니다): {ex.GetType().Name}");
            try { File.Delete(AgentPaths.TokenFile); }
            catch (Exception delEx) { Log.Warn($"쓸 수 없는 토큰 파일 삭제 실패: {delEx.GetType().Name}"); }
            return null;
        }
    }

    /// <summary>파일이 있는지만 본다. ⚠️ 화면 표시에는 쓰지 말 것 — <see cref="IsUsable"/>을 쓴다.</summary>
    public static bool Exists => File.Exists(AgentPaths.TokenFile);

    /// <summary>
    /// 이 PC가 <b>실제로 연결된 상태인지</b>. 파일 존재가 아니라 "열 수 있는지"로 판단한다.
    ///  · 화면·자동 연결창·앞으로의 폴링은 모두 이 값을 기준으로 해야 한다.
    ///    파일 존재만 보면 "연결됨으로 보이는데 아무 일도 안 하는" 상태가 만들어진다.
    ///  · 못 푸는 파일은 <see cref="TryLoad"/>가 이 호출 중에 정리한다.
    /// </summary>
    public static bool IsUsable() => TryLoad() != null;

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
