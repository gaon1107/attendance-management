using System;
using System.IO;
using System.Text;
using NewgaonPcOff.Config;

namespace NewgaonPcOff.Diagnostics;

/// <summary>
/// 아주 단순한 파일 기록기(문제가 났을 때 원인을 찾기 위한 것).
///  · ⚠️ 기기 토큰·연결코드 같은 비밀값은 **절대 넣지 않는다**(사규 8조). 넣는 코드가 없도록 호출부에서 지킨다.
///  · 기록은 이 PC 안에만 남고 서버로 보내지 않는다. 14일이 지난 파일은 스스로 지운다(오래 쌓아두지 않는다).
/// </summary>
internal static class Log
{
    private const int KeepDays = 14;

    /// <summary>파일 하나가 이 크기를 넘으면 한 번 밀어놓고 새로 쓴다(서버가 죽어 같은 오류가 쏟아질 때 대비).</summary>
    private const long MaxFileBytes = 2 * 1024 * 1024;

    private static readonly object Gate = new();
    private static bool _purged;

    public static void Info(string message) => Write("INFO", message);
    public static void Warn(string message) => Write("WARN", message);

    public static void Error(string message, Exception? ex = null)
        => Write("ERROR", ex == null ? message : $"{message} :: {ex.GetType().Name}: {ex.Message}");

    private static void Write(string level, string message)
    {
        try
        {
            lock (Gate)
            {
                AgentPaths.EnsureDirs();
                if (!_purged) { _purged = true; PurgeOld(); }

                var now = DateTime.Now;
                var file = Path.Combine(AgentPaths.LogDir, $"agent-{now:yyyy-MM-dd}.log");

                // 크기 상한 — 넘으면 .1 로 한 번 밀어놓고 새로 쓴다(디스크를 채우지 않게).
                var info = new FileInfo(file);
                if (info.Exists && info.Length > MaxFileBytes)
                {
                    var rolled = file + ".1";
                    if (File.Exists(rolled)) File.Delete(rolled);
                    File.Move(file, rolled);
                }

                var line = $"{now:HH:mm:ss} [{level}] {message}{Environment.NewLine}";
                File.AppendAllText(file, line, Encoding.UTF8);
            }
        }
        catch
        {
            // 기록 실패로 앱이 멈추면 안 된다 — 기록은 "있으면 좋은 것"이다.
        }
    }

    private static void PurgeOld()
    {
        try
        {
            var limit = DateTime.Now.AddDays(-KeepDays);
            // "agent-*.log" 뿐 아니라 크기 초과로 밀어놓은 "agent-*.log.1" 까지 함께 지운다.
            foreach (var f in Directory.GetFiles(AgentPaths.LogDir, "agent-*.log*"))
            {
                if (File.GetLastWriteTime(f) < limit) File.Delete(f);
            }
        }
        catch { /* 지우지 못해도 그냥 넘어간다 */ }
    }
}
