using System;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using NewgaonPcOff.Api;
using NewgaonPcOff.Config;
using NewgaonPcOff.Diagnostics;
using NewgaonPcOff.Security;
using WinForms = System.Windows.Forms;

namespace NewgaonPcOff.UI;

/// <summary>
/// 트레이(작업표시줄 오른쪽 알림영역)에 사는 본체.
///  · 이 앱은 창이 주인이 아니라 트레이가 주인이다 — 창을 다 닫아도 계속 살아 있어야 하기 때문.
///  · ⚠️ WPF와 WinForms를 함께 쓰므로 WinForms 쪽은 <c>WinForms.</c> 별칭으로만 부른다(이름 충돌 방지).
/// </summary>
internal sealed class TrayApp : IDisposable
{
    private readonly WinForms.NotifyIcon _tray = new();
    private readonly WinForms.ToolStripMenuItem _statusItem = new() { Enabled = false };
    private readonly System.Drawing.Icon _iconOn;
    private readonly System.Drawing.Icon _iconOff;

    private AgentConfig _config;
    private PairWindow? _pairWindow;
    private InfoWindow? _infoWindow;
    private bool _checking;

    public TrayApp()
    {
        // 트레이 메뉴가 요즘 윈도우 모양으로 그려지게 한다(안 하면 옛 회색 메뉴로 보인다).
        WinForms.Application.EnableVisualStyles();

        _config = AgentConfig.Load();
        _iconOn = LoadIcon("app.ico");
        _iconOff = LoadIcon("app-idle.ico");

        BuildMenu();
    }

    public void Start()
    {
        _tray.Visible = true;
        RefreshStatus();

        // 아직 연결되지 않았으면(설치 직후) 바로 연결창을 띄워준다 — 직원이 무엇을 해야 할지 알 수 있게.
        if (!TokenStore.Exists) OpenPairWindow();
    }

    // ── 트레이 메뉴 ─────────────────────────────────────────────────────────

    private void BuildMenu()
    {
        var menu = new WinForms.ContextMenuStrip();
        menu.Items.Add(_statusItem);
        menu.Items.Add(new WinForms.ToolStripSeparator());
        menu.Items.Add(MenuItem("연결 설정...", OpenPairWindow));
        menu.Items.Add(MenuItem("서버 연결 확인", RunCheckServer));
        menu.Items.Add(MenuItem("수집하는 정보", OpenInfoWindow));
        menu.Items.Add(new WinForms.ToolStripSeparator());
        menu.Items.Add(MenuItem("종료", () => Application.Current.Shutdown()));

        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => OpenPairWindow();
    }

    /// <summary>메뉴 항목 하나. 눌렀을 때 오류가 나도 앱이 죽지 않게 감싼다.</summary>
    private static WinForms.ToolStripMenuItem MenuItem(string text, Action onClick)
    {
        var item = new WinForms.ToolStripMenuItem(text);
        item.Click += (_, _) =>
        {
            try { onClick(); }
            catch (Exception ex) { Log.Error($"트레이 메뉴 '{text}' 처리 중 오류", ex); }
        };
        return item;
    }

    private void RefreshStatus()
    {
        var paired = TokenStore.Exists;
        _tray.Icon = paired ? _iconOn : _iconOff;

        var who = Join(_config.PairedCompanyName, _config.PairedUserName);
        _statusItem.Text = paired
            ? (who.Length > 0 ? $"연결됨 — {who}" : "연결됨")
            : "아직 연결되지 않았습니다";

        // 트레이 풍선 도움말은 길이 제한이 있어 짧게 자른다.
        _tray.Text = Truncate(paired && who.Length > 0 ? $"{AppInfo.Name} — {who}" : $"{AppInfo.Name} — 연결 안 됨", 60);
    }

    // ── 창 열기 ─────────────────────────────────────────────────────────────

    private void OpenPairWindow()
    {
        if (_pairWindow != null) { _pairWindow.Activate(); return; }

        // 설정 파일이 밖에서 바뀌었을 수도 있어 열 때 다시 읽는다.
        _config = AgentConfig.Load();

        var window = new PairWindow(_config, RefreshStatus, OpenInfoWindow);
        window.Closed += (_, _) => _pairWindow = null;
        _pairWindow = window;
        window.Show();
        window.Activate();
    }

    private void OpenInfoWindow()
    {
        if (_infoWindow != null) { _infoWindow.Activate(); return; }

        var window = new InfoWindow();
        window.Closed += (_, _) => _infoWindow = null;
        _infoWindow = window;
        window.Show();
        window.Activate();
    }

    // ── 서버 연결 확인 ──────────────────────────────────────────────────────

    /// <summary>
    /// 메뉴에서 부르는 겉껍데기.
    ///  · ⚠️ 기다리지 않고 띄우는 작업(fire-and-forget)의 오류는 아무 데도 도달하지 않는다
    ///    → 사용자에게는 "메뉴가 먹통"으로 보이고 기록도 남지 않는다. 그래서 여기서 반드시 붙잡는다.
    /// </summary>
    private async void RunCheckServer()
    {
        try
        {
            await CheckServerAsync();
        }
        catch (Exception ex)
        {
            Log.Error($"서버 연결 확인 중 오류: {ex.GetType().FullName}");
            Notice($"확인 중 오류가 발생했습니다. ({ex.GetType().Name})\n\n잠시 후 다시 시도해주세요.", MessageBoxImage.Warning);
        }
    }

    /// <summary>
    /// 지금 상태로 서버에서 정책을 한 번 받아와 사람이 읽을 수 있게 보여준다.
    ///  · 연결이 실제로 되는지, 회사 설정이 어떻게 내려오는지 확인하는 용도(2-A의 검증 수단).
    /// </summary>
    private async Task CheckServerAsync()
    {
        if (_checking) return;
        _checking = true;
        try
        {
            var token = TokenStore.TryLoad();
            if (token == null)
            {
                Notice("아직 이 PC가 연결되지 않았습니다.\n\n웹 [계정] → \"내 PC 연결\"에서 연결코드를 받아 입력해주세요.",
                    MessageBoxImage.Information);
                OpenPairWindow();
                return;
            }

            var res = await AgentApi.GetPolicyAsync(_config.ServerUrl, token);
            if (!res.Ok || res.Value == null)
            {
                if (res.Unauthorized)
                {
                    Notice("이 PC의 연결이 해제되었거나 만료되었습니다.\n\n웹에서 새 연결코드를 받아 다시 연결해주세요.",
                        MessageBoxImage.Warning);
                    OpenPairWindow();
                }
                else
                {
                    Notice($"서버에 연결하지 못했습니다.\n\n{res.Error}", MessageBoxImage.Warning);
                }
                return;
            }

            Log.Info($"서버 연결 확인 성공 (enabled={res.Value.Enabled}, policyVersion={res.Value.PolicyVersion})");
            Notice(Describe(res.Value), MessageBoxImage.Information);
        }
        finally
        {
            _checking = false;
        }
    }

    /// <summary>받아온 정책을 사람이 읽을 문장으로 바꾼다.</summary>
    private string Describe(PcOffPolicy p)
    {
        var sb = new StringBuilder();
        sb.AppendLine("서버와 정상적으로 통신했습니다.");
        sb.AppendLine();
        sb.AppendLine($"· 서버: {_config.ServerUrl}");
        sb.AppendLine($"· 이 PC 이름: {_config.DeviceName}");

        if (DateTimeOffset.TryParse(p.ServerTime, out var serverTime))
        {
            var gapSec = (int)Math.Round((DateTimeOffset.Now - serverTime).TotalSeconds);
            sb.AppendLine($"· 서버 시각: {serverTime.LocalDateTime:yyyy-MM-dd HH:mm:ss} (이 PC 시계와 {gapSec:+0;-0;0}초 차이)");
        }

        sb.AppendLine(p.Enabled
            ? "· 잠금: 사용 중 (이 PC는 잠금 대상입니다)"
            : $"· 잠금: 사용 안 함 — {ReasonText(p.DisabledReason)}");

        sb.AppendLine($"· 퇴근 기준시각: {p.Work.EndTime ?? "미설정"} · 유예 {p.DelayMin}분");
        sb.AppendLine($"· 근무요일: {WorkDaysText(p.Work.WorkDays)}");
        sb.AppendLine(p.NotifyMins.Length == 0
            ? "· 사전 알림: 없음"
            : $"· 사전 알림: {string.Join("분 전 · ", p.NotifyMins)}분 전");
        sb.AppendLine($"· 일시사용: {p.TempUse.Minutes}분 × 하루 {p.TempUse.PerDay}회 (오늘 {p.TempUse.UsedToday}회 사용)");
        sb.AppendLine(p.TempUse.Reasons.Length == 0
            ? "· 일시사용 사유 목록: 없음"
            : $"· 일시사용 사유: {string.Join(" / ", p.TempUse.Reasons)}");

        foreach (var d in p.Days)
        {
            var kind = d.IsWorkday ? "근무일" : d.OffDayName is { Length: > 0 } ? $"휴무 ({d.OffDayName})" : "휴무";
            sb.AppendLine($"· {d.Date}: {kind}");
        }

        sb.AppendLine($"· 승인된 연장근무: {p.ApprovedOvertime.Length}건");
        foreach (var o in p.ApprovedOvertime)
        {
            var start = HmToMinutes(o.StartTime);
            var end = HmToMinutes(o.EndTime);
            // 종료가 시작보다 작거나 같으면 자정을 넘긴 야근이라는 뜻(서버 규칙과 동일).
            var overnight = start >= 0 && end >= 0 && end <= start ? " (다음 날까지)" : "";
            sb.AppendLine($"   - {o.Date} {o.StartTime}~{o.EndTime}{overnight}");
        }

        return sb.ToString();
    }

    /// <summary>
    /// "HH:MM" → 자정부터의 분. 못 읽으면 -1.
    ///  · ⚠️ 글자 그대로 크기를 비교하면 안 된다("9:00"과 "10:00"이 뒤집힌다). 반드시 숫자로 바꿔 비교한다.
    /// </summary>
    private static int HmToMinutes(string? hm)
    {
        if (string.IsNullOrWhiteSpace(hm)) return -1;
        var parts = hm.Split(':');
        if (parts.Length != 2) return -1;
        if (!int.TryParse(parts[0], out var h) || !int.TryParse(parts[1], out var m)) return -1;
        if (h is < 0 or > 23 || m is < 0 or > 59) return -1;
        return h * 60 + m;
    }

    private static string ReasonText(string? reason) => reason switch
    {
        "company_off" => "회사가 PC-OFF를 사용하지 않습니다",
        "user_exempt" => "회원님은 잠금 예외자로 지정돼 있습니다",
        "no_worktime" => "회사 퇴근 기준시각이 설정되지 않았습니다",
        "shift_unsupported" => "교대근무 회사는 아직 지원하지 않습니다",
        _ => "회사 설정을 확인할 수 없습니다",
    };

    /// <summary>근무요일 CSV("1,2,3,4,5")를 "월·화·수·목·금"으로.</summary>
    private static string WorkDaysText(string csv)
    {
        if (string.IsNullOrWhiteSpace(csv)) return "미설정";

        string[] names = ["일", "월", "화", "수", "목", "금", "토"];
        var parts = new System.Collections.Generic.List<string>();
        foreach (var piece in csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (int.TryParse(piece, out var n) && n >= 0 && n <= 6) parts.Add(names[n]);
        }
        return parts.Count == 0 ? "미설정" : string.Join("·", parts);
    }

    // ── 도우미 ──────────────────────────────────────────────────────────────

    private static void Notice(string message, MessageBoxImage icon)
        => MessageBox.Show(message, AppInfo.Name, MessageBoxButton.OK, icon);

    private static string Join(string? a, string? b)
    {
        var left = (a ?? "").Trim();
        var right = (b ?? "").Trim();
        if (left.Length > 0 && right.Length > 0) return $"{left} · {right}";
        return left.Length > 0 ? left : right;
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];

    private static System.Drawing.Icon LoadIcon(string fileName)
    {
        try
        {
            var uri = new Uri($"pack://application:,,,/Assets/{fileName}", UriKind.Absolute);
            var info = Application.GetResourceStream(uri);
            if (info?.Stream != null)
            {
                using var stream = info.Stream;
                return new System.Drawing.Icon(stream);
            }
        }
        catch (Exception ex)
        {
            Log.Warn($"트레이 아이콘({fileName})을 불러오지 못해 기본 아이콘을 씁니다: {ex.GetType().Name}");
        }
        return System.Drawing.SystemIcons.Application;
    }

    public void Dispose()
    {
        // 아이콘은 Dispose하지 않는다 — 기본 아이콘(SystemIcons)은 윈도우가 여러 곳에서 공유하는 것이라
        // 여기서 해제하면 다른 곳에 영향이 갈 수 있다. 프로세스가 끝나면 어차피 정리된다.
        _tray.Visible = false;
        _tray.Dispose();
    }
}
