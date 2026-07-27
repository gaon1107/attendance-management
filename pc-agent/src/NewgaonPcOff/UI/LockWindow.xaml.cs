using System;
using System.ComponentModel;
using System.Globalization;
using System.Windows;
using System.Windows.Threading;
using NewgaonPcOff.Config;
using NewgaonPcOff.Core;
using NewgaonPcOff.Diagnostics;

namespace NewgaonPcOff.UI;

/// <summary>
/// 잠금화면. 화면 전체를 덮고, 직원이 <b>스스로 풀 수 있는 두 가지 길</b>을 함께 준다.
///  · [연장근무 신청] — 관리자가 승인하면 자동으로 풀린다(웹 신청과 같은 결재선).
///  · [일시사용] — 회사가 정한 시간만큼 잠깐 푼다(횟수는 서버가 센다).
///
/// 지키는 것
///  · 이 창은 <b>덮기만</b> 한다. 화면 내용·입력·앱 목록을 읽지 않는다.
///  · 판단은 하지 않는다 — 잠글지 말지는 <see cref="PolicyService"/>가 정하고, 이 창은 그 결과를 보여준다.
///  · 알림창(MessageBox)을 띄우지 않는다 — 이 창이 포커스를 되찾는 동작과 부딪혀 알림창을 못 누르게 된다.
///    안내는 전부 창 안의 글줄로 보여준다.
/// </summary>
// ⚠️ XAML이 만들어 주는 짝(partial)이 public이라 여기도 public이어야 한다(PairWindow와 같은 형태).
//    바깥에서 쓸 일이 없는 생성자·기능은 internal로 좁혀 둔다.
public partial class LockWindow : Window
{
    /// <summary>연장근무 종료 시각 후보 간격(분)과 최대 길이.</summary>
    private const int EndStepMin = 30;
    private const int EndMaxMin = 6 * 60;

    private readonly AgentConfig _config;
    private readonly PolicyService _service;
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(1) };

    /// <summary>테스트 모드 자동 해제 기한(<see cref="Environment.TickCount64"/> 기준 — 시계를 바꿔도 흔들리지 않는다).</summary>
    private readonly long _testUnlockAtTick;

    private bool _allowClose;
    private bool _busy;

    /// <summary>연장근무 종료시각 목록을 어느 "분"으로 만들었는지(분이 바뀔 때만 다시 만든다).</summary>
    private DateTimeOffset _optionsBuiltAt;

    /// <summary>테스트 모드에서 "이제 그만 풀어라"(자동 해제 또는 [테스트 종료]).</summary>
    internal event Action? TestUnlockRequested;

    internal LockWindow(AgentConfig config, PolicyService service)
    {
        _config = config ?? throw new ArgumentNullException(nameof(config));
        _service = service ?? throw new ArgumentNullException(nameof(service));

        InitializeComponent();

        _testUnlockAtTick = Environment.TickCount64 + (long)AppMode.TestAutoUnlock.TotalMilliseconds;

        if (AppMode.TestMode)
        {
            TestBadge.Visibility = Visibility.Visible;
            TestExitButton.Visibility = Visibility.Visible;
        }

        Loaded += (_, _) =>
        {
            ApplyBounds();
            Render();
            Activate();
        };

        // ⚠️ Win+D(바탕화면 보기)·Win+M·창 흔들기는 **최상위 창까지 최소화**시킨다.
        //    최소화되면 화면이 그대로 열리는데, Activate()는 최소화된 창을 복원하지 못한다
        //    (그래서 "포커스 되찾기"만으로는 못 막는다). 여기서 곧바로 되돌린다.
        StateChanged += (_, _) => RestoreIfMinimized();

        _timer.Tick += (_, _) => OnTick();
        _timer.Start();
    }

    // ── 창 크기·위치 ────────────────────────────────────────────────────────

    /// <summary>모든 모니터를 덮되, 카드는 <b>주 모니터 한가운데</b>에 놓는다.</summary>
    private void ApplyBounds()
    {
        Left = SystemParameters.VirtualScreenLeft;
        Top = SystemParameters.VirtualScreenTop;
        Width = SystemParameters.VirtualScreenWidth;
        Height = SystemParameters.VirtualScreenHeight;

        // 주 모니터의 왼쪽 위는 가상 화면 좌표에서 항상 (0,0)이다 → 창 안에서의 위치는 (-Left, -Top).
        CardHost.Margin = new Thickness(-Left, -Top, 0, 0);
        CardHost.Width = SystemParameters.PrimaryScreenWidth;
        CardHost.Height = SystemParameters.PrimaryScreenHeight;
    }

    /// <summary>
    /// 최소화·숨김·최상위 해제를 되돌린다(잠금이 화면에서 사라지는 것을 막는 자가 치유).
    ///  · ⚠️ 이 함수가 없으면 <b>Win+D 한 번으로 잠금이 완전히 풀린다</b> — 그리고 서버에는 이미
    ///    "잠갔다"는 기록이 가 있어 미보고 감시에도 걸리지 않는다(검수 치명 C-1).
    /// </summary>
    private void RestoreIfMinimized()
    {
        if (_allowClose) return;

        try
        {
            if (WindowState != WindowState.Normal) WindowState = WindowState.Normal;
            if (!IsVisible) Show();
            if (!Topmost) Topmost = true;
        }
        catch (Exception ex)
        {
            Log.Warn($"잠금화면을 되돌리지 못했습니다: {ex.GetType().Name}");
        }
    }

    private bool BoundsChanged()
        => Math.Abs(Width - SystemParameters.VirtualScreenWidth) > 1
        || Math.Abs(Height - SystemParameters.VirtualScreenHeight) > 1
        || Math.Abs(Left - SystemParameters.VirtualScreenLeft) > 1
        || Math.Abs(Top - SystemParameters.VirtualScreenTop) > 1;

    // ── 1초마다 ─────────────────────────────────────────────────────────────

    private void OnTick()
    {
        try
        {
            // 모니터를 꽂거나 빼면 화면 크기가 바뀐다 → 덮지 못한 자리가 생기지 않게 맞춘다.
            if (BoundsChanged()) ApplyBounds();

            // 1초마다 스스로 점검한다 — 최소화됐거나·숨겨졌거나·맨 위가 아니게 됐으면 되돌린다.
            //  · StateChanged만 믿지 않는 이유: 다른 프로그램이 창 상태를 바꾸는 방법이 여러 가지라
            //    한 군데서 놓치면 화면이 열린 채로 남는다(= 잠금이 통째로 무력화된다).
            RestoreIfMinimized();

            if (AppMode.TestMode)
            {
                var leftMs = _testUnlockAtTick - Environment.TickCount64;
                if (leftMs <= 0)
                {
                    TestBadgeText.Text = "테스트 모드 — 자동으로 풉니다.";
                    RequestTestUnlock("시간 만료");
                    return;
                }
                TestBadgeText.Text =
                    $"테스트 모드입니다 — {Math.Ceiling(leftMs / 1000.0):0}초 뒤 자동으로 풀립니다. " +
                    "그 뒤로는 저절로 잠기지 않습니다(트레이의 [테스트] 잠금화면 미리보기로만 다시 볼 수 있습니다).";
            }

            RenderTimes(); // 남은 시간만 갱신(전체 다시 그리기는 판정이 바뀔 때만)
        }
        catch (Exception ex)
        {
            Log.Error("잠금화면 갱신 중 오류", ex);
        }
    }

    // ── 화면 그리기 ─────────────────────────────────────────────────────────

    /// <summary>판정 상태가 바뀌었을 때 전체를 다시 그린다(<see cref="LockController"/>가 부른다).</summary>
    internal void Render()
    {
        var s = _service.Status;
        var p = s.Policy;

        HeadText.Text = s.Decision.Reason switch
        {
            LockReason.OffDay => s.Decision.OffDayName is { Length: > 0 } name
                ? $"오늘은 휴무일입니다 ({name})"
                : "오늘은 근무일이 아닙니다",
            LockReason.BeforeWork => "아직 출근 기준시각 전입니다",
            _ => "퇴근 시간이 지났습니다",
        };

        WhoText.Text = Join(_config.PairedCompanyName, _config.PairedUserName);
        RuleText.Text = p == null ? "-" : $"근무 기준 {StatusWording.Rule(s)}";

        // 일시사용: 회사가 허용했고 남은 횟수가 있어야 쓸 수 있다.
        var canTemp = _service.CanUseTemp;
        TempButton.IsEnabled = canTemp;
        TempButton.Content = canTemp && p != null ? $"일시사용 ({s.TempUseLeft}회 남음)" : "일시사용";

        if (p != null)
        {
            // ⚠️ 한도는 **회사 설정값(p.TempUsePerDay)이 아니라 지금 기준의 한도**를 쓴다.
            //    인터넷이 끊기면 한도가 넓어지는데(갇히지 않게), 회사 설정값을 그대로 쓰면
            //    "오늘 2회 중 6회 남았습니다" 같은 앞뒤가 안 맞는 문장이 된다.
            var perDayNow = _service.TempUsePerDayNow;
            // ⚠️ "허용하지 않음" 판정은 1회 시간(TempUseMinutes)만이 아니라 **하루 횟수**도 함께 본다.
            //    횟수가 0인 회사에서 "오늘 0회 중 0회 남았습니다"라는 이상한 문장이 나오던 것을 막는다(검수 지적 M-6).
            TempInfoText.Text = p.TempUseMinutes > 0 && p.TempUsePerDay > 0
                ? s.UsingOfflineQuota
                    ? $"{p.TempUseMinutes}분 동안 잠금을 풉니다. 인터넷이 끊긴 동안에는 {perDayNow}회까지 쓸 수 있고, {s.TempUseLeft}회 남았습니다."
                    : $"{p.TempUseMinutes}분 동안 잠금을 풉니다. 오늘 {perDayNow}회 중 {s.TempUseLeft}회 남았습니다."
                : "회사가 일시사용을 허용하지 않았습니다.";

            // ⚠️ 목록이 **실제로 달라졌을 때만** 다시 채운다.
            //    이 함수는 잠금 중 10초마다 불린다. 매번 지웠다 채우면 직원이 고른 사유가 첫 항목으로
            //    되돌아가, 고르지 않은 사유가 기록에 남는다(검수 중간 M-3).
            if (!SameItems(TempReasonBox, p.TempReasons))
            {
                var keep = TempReasonBox.SelectedItem as string;
                TempReasonBox.Items.Clear();
                foreach (var r in p.TempReasons) TempReasonBox.Items.Add(r);
                if (keep != null && TempReasonBox.Items.Contains(keep)) TempReasonBox.SelectedItem = keep;
            }
            if (TempReasonBox.Items.Count > 0 && TempReasonBox.SelectedIndex < 0) TempReasonBox.SelectedIndex = 0;

            // 사유 목록이 비어 있으면 쓸 수 없다(지시서 §5: 일시사용은 사유 필수).
            //  · 직접 적는 칸은 만들지 않는다 — 개인 사정이 기록에 남는 통로가 되기 때문이다.
            if (p.TempReasons.Length == 0)
            {
                TempInfoText.Text = "회사가 일시사용 사유 목록을 정하지 않아 사용할 수 없습니다. 관리자에게 문의해주세요.";
            }

            // ⚠️ 보내는 중이거나 남은 횟수가 없으면 눌리면 안 된다.
            //    무조건 켜면 화면이 거짓말을 한다(누를 수 있어 보이는데 아무 일도 안 일어난다).
            TempSubmitButton.IsEnabled = !_busy && canTemp && p.TempReasons.Length > 0;
        }

        BuildOvertimeOptions();
        RenderTimes();
    }

    /// <summary>해제 시각·남은 시간처럼 1초마다 달라지는 부분만.</summary>
    private void RenderTimes()
    {
        var s = _service.Status;
        SubText.Text = StatusWording.LockScreen(s);

        // ⚠️ 오프라인일 때 "신청은 연결이 되면 보내집니다"는 **사실이 아니다** —
        //    연장근무 신청은 서버가 있어야 하고, 실패하면 그 자리에서 오류로 끝난다(쌓아두지 않는다).
        //    잠긴 채 인터넷이 없는 직원에게 실제로 남은 길은 [일시사용]뿐이므로 그쪽을 안내한다.
        //    단, 남은 횟수가 0이면 그 길도 없다 — 있다고 말하지 않는다(검수 지적 M-6).
        if (s.FromCache || s.LastError != null)
        {
            // ⚠️ 문구는 "인터넷"이 아니라 "서버 연결"로 적는다 — 이 분기는 인터넷이 멀쩡한데
            //    서버가 거부·장애인 경우(401·5xx)에도 들어온다. 두 경우 모두에 맞는 말이어야 한다(재검수 N-7).
            var head = "지금 서버와 연결되지 않아, 마지막으로 받은 회사 설정으로 판단하고 있습니다. "
                     + "연장근무 신청은 서버에 연결되어야 보낼 수 있습니다. ";
            GuideText.Text = head + (s.TempUseLeft > 0
                ? "급하면 아래 [일시사용]으로 잠깐 풀 수 있습니다."
                : "지금은 스스로 풀 수 있는 수단이 없습니다. 관리자에게 연락해주세요.");
        }
        else
        {
            GuideText.Text = "업무가 남았다면 아래에서 연장근무를 신청해주세요. 관리자가 승인하면 1분 안에 자동으로 풀립니다.";
        }
    }

    /// <summary>
    /// 연장근무 종료 시각 후보(30분 단위)를 <b>지금 시각 기준</b>으로 만든다.
    ///  · ⚠️ 목록을 한 번만 만들면 안 된다. 잠금화면을 40분 방치했다가 신청하면
    ///    화면에는 "19:10까지"라고 적혀 있는데 실제로는 19:50까지로 신청된다
    ///    (신청 시각은 누르는 순간 기준으로 다시 계산하기 때문 — 검수 중간 M-6).
    ///    그래서 매번 다시 그리되, 고르던 <b>길이</b>는 그대로 지킨다.
    /// </summary>
    private void BuildOvertimeOptions()
    {
        var now = NowCompany();

        OvertimeWhenText.Text =
            $"{now:yyyy-MM-dd}(오늘) {now:HH:mm}부터 신청합니다. 관리자 승인 후 자동으로 풀립니다.";

        // ⚠️ 매번 다시 그리면 안 된다 — 직원이 드롭다운을 펼쳐 훑는 중에도 목록이 통째로 갈려
        //    고르려던 항목에서 튕겨 나간다(재검수 중간 M-9).
        //    ① 분이 바뀌었을 때만 ② 드롭다운이 닫혀 있을 때만 다시 만든다.
        var minute = new DateTimeOffset(now.Year, now.Month, now.Day, now.Hour, now.Minute, 0, now.Offset);
        if (OvertimeEndBox.Items.Count > 0 && (minute == _optionsBuiltAt || OvertimeEndBox.IsDropDownOpen)) return;
        _optionsBuiltAt = minute;

        var keep = (OvertimeEndBox.SelectedItem as EndOption)?.Minutes ?? 60; // 기본 1시간

        OvertimeEndBox.Items.Clear();
        var selected = -1;
        for (var m = EndStepMin; m <= EndMaxMin; m += EndStepMin)
        {
            var end = now.AddMinutes(m);
            var index = OvertimeEndBox.Items.Add(
                new EndOption(m, $"{end:HH:mm}  ({Hm.Remaining(TimeSpan.FromMinutes(m))})"));
            if (m == keep) selected = index;
        }
        OvertimeEndBox.SelectedIndex = selected >= 0 ? selected : 0;
    }

    /// <summary>콤보박스에 담긴 항목이 주어진 목록과 같은가(불필요한 다시 그리기를 막는다).</summary>
    private static bool SameItems(System.Windows.Controls.ComboBox box, string[] items)
    {
        if (box.Items.Count != items.Length) return false;
        for (var i = 0; i < items.Length; i++)
        {
            if (!string.Equals(box.Items[i] as string, items[i], StringComparison.Ordinal)) return false;
        }
        return true;
    }

    /// <summary>지금 시각(회사 기준). 서버 기준을 모르면 이 PC 시계로 대신한다(표시·신청용).</summary>
    private DateTimeOffset NowCompany()
        => (_service.Status.Decision.At ?? DateTimeOffset.Now).ToOffset(Hm.CompanyOffset);

    private sealed record EndOption(int Minutes, string Text)
    {
        public override string ToString() => Text;
    }

    // ── 버튼 ────────────────────────────────────────────────────────────────

    private void OvertimeButton_Click(object sender, RoutedEventArgs e)
    {
        TempPanel.Visibility = Visibility.Collapsed;
        OvertimePanel.Visibility = OvertimePanel.Visibility == Visibility.Visible
            ? Visibility.Collapsed : Visibility.Visible;
        HideMessage();
    }

    private void TempButton_Click(object sender, RoutedEventArgs e)
    {
        OvertimePanel.Visibility = Visibility.Collapsed;
        TempPanel.Visibility = TempPanel.Visibility == Visibility.Visible
            ? Visibility.Collapsed : Visibility.Visible;
        HideMessage();
    }

    private void ClosePanels_Click(object sender, RoutedEventArgs e)
    {
        OvertimePanel.Visibility = Visibility.Collapsed;
        TempPanel.Visibility = Visibility.Collapsed;
        HideMessage();
    }

    private async void RefreshButton_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;
        SetBusy(true, "서버에 다시 물어보는 중입니다...");
        try
        {
            await _service.RefreshAsync();
            Render();
            ShowMessage(_service.Status.LastError == null
                ? "서버에서 최신 설정을 받았습니다."
                : $"서버에 연결하지 못했습니다. {_service.Status.LastError}", warn: _service.Status.LastError != null);
        }
        catch (Exception ex)
        {
            Log.Error("잠금화면에서 서버 확인 중 오류", ex);
            ShowMessage($"확인 중 오류가 발생했습니다. ({ex.GetType().Name})", warn: true);
        }
        finally
        {
            SetBusy(false, null);
        }
    }

    private async void OvertimeSubmit_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;
        if (OvertimeEndBox.SelectedItem is not EndOption option)
        {
            ShowMessage("종료 시각을 골라주세요.", warn: true);
            return;
        }

        var now = NowCompany();
        var targetDate = now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var startTime = now.ToString("HH:mm", CultureInfo.InvariantCulture);
        var endTime = now.AddMinutes(option.Minutes).ToString("HH:mm", CultureInfo.InvariantCulture);
        var reason = OvertimeReasonBox.Text.Trim();

        SetBusy(true, "신청하는 중입니다...");
        try
        {
            var (ok, message) = await _service.SubmitOvertimeAsync(
                targetDate, startTime, endTime, reason.Length == 0 ? null : reason);

            ShowMessage(message, warn: !ok);
            if (ok)
            {
                OvertimePanel.Visibility = Visibility.Collapsed;
                OvertimeReasonBox.Text = "";
            }
        }
        finally
        {
            SetBusy(false, null);
        }
    }

    private void TempSubmit_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;

        var reason = TempReasonBox.SelectedItem as string;
        if (string.IsNullOrWhiteSpace(reason))
        {
            ShowMessage("사유를 골라주세요.", warn: true);
            return;
        }

        if (!_service.TryStartTempUse(reason, out var error))
        {
            ShowMessage(error, warn: true);
            Render();
            return;
        }

        // 판정이 "일시사용 중"으로 바뀌면 LockController가 이 창을 닫는다.
        ShowMessage("일시사용을 시작했습니다.", warn: false);
    }

    private void TestExit_Click(object sender, RoutedEventArgs e) => RequestTestUnlock("사용자 요청");

    private void RequestTestUnlock(string why)
    {
        if (!AppMode.TestMode) return;
        _timer.Stop();
        Log.Info($"테스트 모드 잠금 해제({why}).");
        TestUnlockRequested?.Invoke();
    }

    // ── 창 동작 ─────────────────────────────────────────────────────────────

    /// <summary>
    /// 포커스를 잃으면 되찾는다(지시서 §0의 "포커스 되찾기").
    ///  · ⚠️ 완전한 차단이 아니다 — Alt+Tab으로 뒤 화면이 잠깐 보일 수 있고,
    ///    작업관리자로 프로그램을 끄면 풀린다. 그 한계는 서버의 미보고 감시가 메꾼다.
    /// </summary>
    private void Window_Deactivated(object sender, EventArgs e)
    {
        if (_allowClose) return;

        // 지금 이 순간에 바로 Activate()를 부르면 창 전환이 끝나기 전이라 무시된다 → 한 박자 뒤에 부른다.
        Dispatcher.BeginInvoke(new Action(() =>
        {
            if (_allowClose || !IsLoaded) return;
            try
            {
                Topmost = true;
                Activate();
            }
            catch (Exception ex)
            {
                Log.Warn($"잠금화면 포커스 되찾기 실패: {ex.GetType().Name}");
            }
        }), DispatcherPriority.Background);
    }

    /// <summary>Alt+F4나 창 닫기로는 풀 수 없다. 닫는 것은 판정기(LockController)만 할 수 있다.</summary>
    private void Window_Closing(object sender, CancelEventArgs e)
    {
        if (_allowClose) { _timer.Stop(); return; }
        e.Cancel = true;
    }

    /// <summary>
    /// 판정이 "사용 가능"으로 바뀌었다 → 이제 닫아도 된다. 닫는 데 성공하면 <c>true</c>.
    ///
    /// ⚠️ 닫기가 실패하면 <b>사람이 PC에 갇힌다</b>(화면 전체를 덮은 창이 그대로 남는다).
    ///    그래서 실패하면 최소한 <b>화면에서 치우고</b>(숨기기·최상위 해제) 실패를 알린다.
    ///    부르는 쪽은 <c>false</c>를 받으면 창을 버리지 말고 다음 주기에 다시 시도한다(검수 치명 C-3).
    /// </summary>
    internal bool AllowCloseAndClose()
    {
        _allowClose = true;
        _timer.Stop();

        try
        {
            Close();
            return true;
        }
        catch (Exception ex)
        {
            Log.Error($"잠금화면을 닫지 못했습니다 — 화면에서 치우고 다시 시도합니다: {ex.GetType().FullName}");
            try
            {
                Topmost = false;
                Hide();
            }
            catch (Exception ex2)
            {
                Log.Error($"잠금화면을 화면에서 치우지도 못했습니다: {ex2.GetType().FullName}");
            }
            return false;
        }
    }

    // ── 도우미 ──────────────────────────────────────────────────────────────

    private void SetBusy(bool busy, string? message)
    {
        _busy = busy;
        OvertimeSubmitButton.IsEnabled = !busy;
        TempSubmitButton.IsEnabled = !busy && _service.CanUseTemp;
        RefreshButton.IsEnabled = !busy;
        if (message != null) ShowMessage(message, warn: false);
    }

    private void ShowMessage(string text, bool warn)
    {
        MessageText.Text = text;
        MessageText.Foreground = warn
            ? (System.Windows.Media.Brush)FindResource("Danger")
            : (System.Windows.Media.Brush)FindResource("Success");
        MessageText.Visibility = Visibility.Visible;
    }

    private void HideMessage() => MessageText.Visibility = Visibility.Collapsed;

    private static string Join(string? a, string? b)
    {
        var left = (a ?? "").Trim();
        var right = (b ?? "").Trim();
        if (left.Length > 0 && right.Length > 0) return $"{left} · {right}";
        if (left.Length > 0) return left;
        return right.Length > 0 ? right : "-";
    }
}
