using System;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using NewgaonPcOff.Config;
using NewgaonPcOff.Core;
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
    private PolicyService _service;
    private PairWindow? _pairWindow;
    private InfoWindow? _infoWindow;
    private bool _checking;

    /// <summary>"닫아도 계속 돕니다" 풍선 안내를 이미 보여줬는지(앱을 켠 뒤 딱 한 번만).</summary>
    private bool _closeHintShown;

    /// <summary>[종료]를 눌러 정말 끄는 중인지. 이때는 "계속 실행 중" 안내를 띄우면 안 된다.</summary>
    private bool _exiting;

    public TrayApp()
    {
        // 트레이 메뉴가 요즘 윈도우 모양으로 그려지게 한다(안 하면 옛 회색 메뉴로 보인다).
        WinForms.Application.EnableVisualStyles();

        _config = AgentConfig.Load();
        _iconOn = LoadIcon("app.ico");
        _iconOff = LoadIcon("app-idle.ico");

        // 판정기. 이 앱에서 시간에 따라 스스로 움직이는 유일한 부분이다.
        _service = new PolicyService(_config);
        _service.Changed += RefreshStatus;

        BuildMenu();
    }

    public void Start()
    {
        _tray.Visible = true;
        _service.Start();   // 저장된 설정으로 즉시 판정 시작 + 서버에 물어보기
        RefreshStatus();

        // 아직 연결되지 않았으면(설치 직후) 바로 연결창을 띄워준다 — 직원이 무엇을 해야 할지 알 수 있게.
        //  · 파일 존재가 아니라 **열 수 있는지**로 판단한다(못 푸는 파일이 남아 있으면 연결창이 안 떠서
        //    직원은 할 일이 없다고 믿고 PC는 잠기지 않는 상태가 된다).
        if (!TokenStore.IsUsable()) OpenPairWindow();
    }

    // ── 트레이 메뉴 ─────────────────────────────────────────────────────────

    private void BuildMenu()
    {
        var menu = new WinForms.ContextMenuStrip();
        menu.Items.Add(_statusItem);
        menu.Items.Add(new WinForms.ToolStripSeparator());
        menu.Items.Add(MenuItem("상태 · 연결 설정...", OpenPairWindow));
        menu.Items.Add(MenuItem("서버 연결 확인", RunCheckServer));
        menu.Items.Add(MenuItem("수집하는 정보", OpenInfoWindow));
        menu.Items.Add(new WinForms.ToolStripSeparator());
        menu.Items.Add(MenuItem("종료", RequestExit));

        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => OpenPairWindow();
    }

    /// <summary>
    /// 종료 요청. 연결하는 중이면 막는다.
    ///  · <c>Application.Shutdown()</c>은 창의 Closing을 발생시키지 않아 연결창의 "연결 중 닫기 금지"를
    ///    그냥 지나쳐 버린다. 그러면 서버는 코드를 소진하고 토큰을 새로 발급했는데
    ///    이 PC에는 아무것도 저장되지 않은 채 프로그램이 사라진다.
    /// </summary>
    private void RequestExit()
    {
        if (_pairWindow is { IsBusy: true } busyWindow)
        {
            busyWindow.Activate();
            Notice("서버와 연결하는 중입니다. 끝난 뒤에 종료해주세요.\n\n" +
                   "지금 종료하면 연결코드가 사용된 채로 연결이 완료되지 않습니다.",
                MessageBoxImage.Warning);
            return;
        }
        _exiting = true; // 창이 닫힐 때 "계속 실행 중" 안내가 뜨지 않게
        Application.Current.Shutdown();
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

    /// <summary>
    /// 트레이 아이콘·도움말·메뉴 첫 줄을 지금 상태에 맞춘다.
    ///  · 판정기가 상태를 바꿀 때마다(10초 주기) 불린다 → 무거운 일을 하지 않는다.
    ///  · 문장은 <see cref="StatusWording"/> 한 곳에서만 만든다(창과 트레이가 다른 말을 하지 않게).
    /// </summary>
    private void RefreshStatus()
    {
        try
        {
            var s = _service.Status;

            // 잠금 대상임을 **확인했을 때만** 켜진 아이콘.
            //  · 회사가 끔·예외자·정책 모름은 모두 "이 PC는 지금 잠기지 않는다"이므로 회색이 맞다.
            var active = s.Paired && !s.Revoked && s.Policy is { Enabled: true };
            _tray.Icon = active ? _iconOn : _iconOff;

            var who = Join(_config.PairedCompanyName, _config.PairedUserName);
            var brief = StatusWording.Short(s);

            _statusItem.Text = s.Paired && who.Length > 0 ? $"{who} — {brief}" : brief;

            // 트레이 풍선 도움말은 길이 제한이 있어 짧게 자른다.
            _tray.Text = Truncate($"{AppInfo.Name} — {brief}", 60);
        }
        catch (Exception ex)
        {
            // 트레이 갱신이 예외로 죽으면 판정기의 알림 고리가 끊긴다. 반드시 붙잡는다.
            Log.Error("트레이 상태 갱신 중 오류", ex);
        }
    }

    // ── 창 열기 ─────────────────────────────────────────────────────────────

    private void OpenPairWindow()
    {
        if (_pairWindow != null) { _pairWindow.Activate(); return; }

        // 설정 파일이 밖에서 바뀌었을 수도 있어 열 때 다시 읽는다.
        _config = AgentConfig.Load();
        _service.UpdateConfig(_config); // 판정기도 같은 설정을 보게 맞춘다

        var window = new PairWindow(_config, _service, RefreshStatus, OpenInfoWindow);
        window.Closed += (_, _) =>
        {
            _pairWindow = null;
            ShowCloseHintOnce();
        };
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

    /// <summary>
    /// 창을 닫았을 때 "프로그램은 계속 돕니다"를 트레이 풍선으로 <b>한 번만</b> 알린다.
    ///  · 왜 한 번만인가: 매번 뜨면 그 자체가 업무 방해다. 한 번 알면 그 다음부터는 아는 사실이다.
    ///  · 왜 필요한가: 창을 닫으면 프로그램이 꺼진 것처럼 보여, 직원이 매번 트레이를 확인하거나
    ///    "내가 꺼버린 건 아닌가" 불안해한다.
    ///  · 풍선 알림은 윈도우 알림 설정에 따라 안 보일 수 있다(있으면 좋은 것). 실패해도 무시한다.
    /// </summary>
    private void ShowCloseHintOnce()
    {
        if (_exiting || _closeHintShown) return;
        _closeHintShown = true;

        try
        {
            _tray.BalloonTipTitle = $"{AppInfo.Name} 실행 중";
            _tray.BalloonTipText = "창을 닫아도 계속 실행됩니다. 이 아이콘을 눌러 다시 열 수 있습니다.";
            _tray.BalloonTipIcon = WinForms.ToolTipIcon.Info;
            _tray.ShowBalloonTip(5000);
        }
        catch (Exception ex)
        {
            Log.Warn($"트레이 안내 표시 실패: {ex.GetType().Name}");
        }
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
    /// 서버에 지금 한 번 물어본 뒤, 판정기가 들고 있는 상태를 사람이 읽을 수 있게 보여준다.
    ///  · ⚠️ 여기서 서버를 직접 부르지 않는다 — 판정기의 폴링과 겹치면 같은 순간에 서로 다른 결과를
    ///    트레이와 창에 쓰게 된다. 통신 창구는 <see cref="PolicyService"/> 하나로 둔다.
    /// </summary>
    private async Task CheckServerAsync()
    {
        if (_checking) return;
        _checking = true;
        try
        {
            if (!TokenStore.IsUsable())
            {
                Notice("아직 이 PC가 연결되지 않았습니다.\n\n웹 [계정] → \"내 PC 연결\"에서 연결코드를 받아 입력해주세요.",
                    MessageBoxImage.Information);
                OpenPairWindow();
                return;
            }

            await _service.RefreshAsync();

            var s = _service.Status;
            if (s.Revoked)
            {
                Notice("이 PC의 연결이 해제되었거나 만료되었습니다.\n\n웹에서 새 연결코드를 받아 다시 연결해주세요.",
                    MessageBoxImage.Warning);
                OpenPairWindow();
                return;
            }

            var icon = s.LastError != null || s.PolicyProblem != null ? MessageBoxImage.Warning : MessageBoxImage.Information;
            Notice(Describe(s), icon);
        }
        finally
        {
            _checking = false;
        }
    }

    /// <summary>지금 상태를 사람이 읽을 문장으로 바꾼다(문제를 찾을 때 쓰는 확인용 화면).</summary>
    private string Describe(AgentStatus s)
    {
        var sb = new StringBuilder();

        if (s.LastError != null) sb.AppendLine($"서버에 연결하지 못했습니다.\n{s.LastError}");
        else sb.AppendLine("서버와 정상적으로 통신했습니다.");

        sb.AppendLine();
        sb.AppendLine($"· 서버: {_config.ServerUrl}");
        sb.AppendLine($"· 이 PC 이름: {_config.DeviceName}");

        if (s.Decision.At is { } t)
        {
            // 회사 기준으로 찍는다(화면의 잠금 시각과 같은 기준이라야 사용자가 비교할 수 있다).
            var gapSec = (int)Math.Round((DateTimeOffset.Now - t).TotalSeconds);
            sb.AppendLine($"· 판정 기준 시각: {t.ToOffset(Hm.CompanyOffset):yyyy-MM-dd HH:mm:ss} (이 PC 시계와 {gapSec:+0;-0;0}초 차이)");
        }
        if (s.FromCache) sb.AppendLine("· ⚠️ 서버에 못 붙어 마지막으로 받은 설정으로 판단 중입니다.");

        var p = s.Policy;
        if (p == null)
        {
            sb.AppendLine($"· 잠금: {StatusWording.Lock(s)}");
            return sb.ToString();
        }

        if (!p.Enabled)
        {
            sb.AppendLine($"· 잠금: 사용 안 함 — {StatusWording.DisabledText(p.DisabledReason)}");
            return sb.ToString();
        }

        sb.AppendLine($"· 지금: {StatusWording.Lock(s)}");
        sb.AppendLine($"· 근무 기준: {StatusWording.Rule(s)}");
        sb.AppendLine($"· 근무요일: {WorkDaysText(p.WorkDaysCsv)}");
        sb.AppendLine(p.NotifyMins.Length == 0
            ? "· 사전 알림: 없음"
            : $"· 사전 알림: {string.Join("분 전 · ", p.NotifyMins)}분 전");
        sb.AppendLine($"· 일시사용: {p.TempUseMinutes}분 × 하루 {p.TempUsePerDay}회 (오늘 {p.TempUsedToday}회 사용)");
        sb.AppendLine(p.TempReasons.Length == 0
            ? "· 일시사용 사유 목록: 없음"
            : $"· 일시사용 사유: {string.Join(" / ", p.TempReasons)}");

        foreach (var d in p.Days)
        {
            var kind = d.IsWorkday ? "근무일" : d.OffDayName is { Length: > 0 } name ? $"휴무 ({name})" : "휴무";
            sb.AppendLine($"· {d.Date:yyyy-MM-dd}: {kind}");
        }

        sb.AppendLine($"· 승인된 연장근무: {p.Overtime.Length}건");
        foreach (var w in p.Overtime)
        {
            sb.AppendLine($"   - {w.Start:MM-dd HH:mm} ~ {w.End:MM-dd HH:mm}"); // 이미 회사 기준 시각이다
        }

        return sb.ToString();
    }

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
        _service.Changed -= RefreshStatus;
        _service.Dispose();

        // 아이콘은 Dispose하지 않는다 — 기본 아이콘(SystemIcons)은 윈도우가 여러 곳에서 공유하는 것이라
        // 여기서 해제하면 다른 곳에 영향이 갈 수 있다. 프로세스가 끝나면 어차피 정리된다.
        _tray.Visible = false;
        _tray.Dispose();
    }
}
