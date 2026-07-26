namespace NewgaonPcOff;

/// <summary>앱 이름·버전 한 곳. 서버에 보내는 agentVersion도 여기서 나온다.</summary>
internal static class AppInfo
{
    public const string Name = "PC-OFF";
    public const string FullName = "뉴가온 PC-OFF";

    /// <summary>
    /// 서버 <c>agentVersion</c>은 20자 제한이라 짧게 유지한다.
    ///
    /// 🔴 <b>이 값은 서버의 미보고 감시와 짝을 이룬다.</b>
    ///    <c>webapp/lib/pcoff-alert.ts</c>의 <c>MIN_REPORTING_AGENT_VERSION</c>(0.3.0) 이상만 감시 대상이다.
    ///    · 기록 전송 없이 이 값만 올리면 → 정상 PC가 전부 "미보고"로 뜬다(거짓 경고).
    ///    · 기록 전송을 만들고 이 값을 안 올리면 → 감시 장치가 영원히 침묵한다.
    ///    2-C에서 잠금·해제 기록 전송을 붙이면서 0.3.0으로 올렸다.
    /// </summary>
    public const string Version = "0.3.0";

    public const string UserAgent = "NewgaonPcOff/" + Version + " (Windows)";
}
