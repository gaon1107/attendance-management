using System;
using System.IO;

namespace NewgaonPcOff.Config;

/// <summary>
/// 앱이 쓰는 파일 위치 한 곳.
///  · 프로그램 설치 폴더가 아니라 **사용자 폴더**에 둔다 — 관리자 권한 없이 쓸 수 있고,
///    같은 PC를 여러 사람이 쓰면 사람마다 따로 보관된다(남의 연결 정보를 볼 수 없다).
/// </summary>
internal static class AgentPaths
{
    /// <summary>%LOCALAPPDATA%\NewgaonPcOff</summary>
    public static string Root { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "NewgaonPcOff");

    /// <summary>서버 주소·컴퓨터 이름 등 비밀이 아닌 설정.</summary>
    public static string ConfigFile => Path.Combine(Root, "config.json");

    /// <summary>기기 토큰(암호화 보관). ⚠️ 이 파일 내용을 로그·화면에 절대 출력하지 않는다.</summary>
    public static string TokenFile => Path.Combine(Root, "device.bin");

    /// <summary>진단 기록 폴더(이 PC 안에만 남는다. 서버로 보내지 않는다).</summary>
    public static string LogDir => Path.Combine(Root, "logs");

    public static void EnsureDirs()
    {
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(LogDir);
    }
}
