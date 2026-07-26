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

    /// <summary>
    /// 마지막으로 받은 회사 설정(정책) 보관 — <b>암호화</b>해서 저장한다.
    ///  · 인터넷이 끊겨도 이 값으로 잠금 여부를 판단한다(지시서 §5 오프라인 요구사항).
    ///  · ⚠️ 암호화가 필수인 이유: [수집하는 정보] 화면이 근로자에게 "암호화해 보관합니다"라고
    ///    이미 고지하고 있다. 평문으로 두면 그 고지가 <b>허위</b>가 된다.
    /// </summary>
    public static string PolicyFile => Path.Combine(Root, "policy.bin");

    /// <summary>
    /// 아직 서버로 보내지 못한 사건(잠금·해제·일시사용) 대기줄 — <b>암호화</b>해서 저장한다.
    ///  · 인터넷이 끊긴 동안 일어난 잠금·해제를 잃지 않기 위해 파일로 남긴다(지시서 §5 시나리오 ④).
    ///  · ⚠️ 암호화하는 이유: 이 파일에는 "이 사람이 몇 시에 PC를 껐다 켰다"가 시각별로 남는다.
    ///    근로시간 근거가 되는 값이므로 평문으로 두면 안 된다(정책 캐시와 같은 기준).
    /// </summary>
    public static string EventsFile => Path.Combine(Root, "events.bin");

    /// <summary>진단 기록 폴더(이 PC 안에만 남는다. 서버로 보내지 않는다).</summary>
    public static string LogDir => Path.Combine(Root, "logs");

    public static void EnsureDirs()
    {
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(LogDir);
    }
}
