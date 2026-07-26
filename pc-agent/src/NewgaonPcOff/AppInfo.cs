namespace NewgaonPcOff;

/// <summary>앱 이름·버전 한 곳. 서버에 보내는 agentVersion도 여기서 나온다.</summary>
internal static class AppInfo
{
    public const string Name = "PC-OFF";
    public const string FullName = "뉴가온 PC-OFF";

    /// <summary>서버 <c>agentVersion</c>은 20자 제한이라 짧게 유지한다.</summary>
    public const string Version = "0.2.0";

    public const string UserAgent = "NewgaonPcOff/" + Version + " (Windows)";
}
