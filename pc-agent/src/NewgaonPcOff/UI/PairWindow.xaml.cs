using System;
using System.ComponentModel;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using NewgaonPcOff.Api;
using NewgaonPcOff.Config;
using NewgaonPcOff.Diagnostics;
using NewgaonPcOff.Security;

namespace NewgaonPcOff.UI;

/// <summary>
/// 이 PC의 연결을 다루는 창. 상황에 따라 <b>두 가지 모습</b>을 갖는다(<see cref="ApplyMode"/>).
///  · <b>연결됨</b> → 작은 "상태 창". 열 때 서버에 한 번 물어 지금 상태를 보여준다.
///  · <b>미연결 / [다시 연결]</b> → 연결코드 입력 폼.
///
/// 규칙
///  · 기기 토큰은 화면·로그에 절대 표시하지 않는다(사규 8조).
///  · 서버 주소·컴퓨터 이름은 <b>연결이 성공했을 때만</b> 저장한다.
///    (실패한 값을 저장하면 이미 연결된 다른 서버 주소를 잘못 덮어써 앱이 엉뚱한 곳을 보게 된다)
///  · 연결 중에는 창을 닫을 수 없다 — 닫힌 창에 결과를 쓰면 사용자는 성공·실패를 영원히 알 수 없고,
///    그 사이 새로 연 창과 설정 파일을 서로 덮어쓰는 사고가 난다.
///  · "몇 시에 잠긴다" 같은 판단은 하지 않는다 — 그건 판정기(2-B)의 일이다.
///    여기서는 서버가 내려준 값을 글자로 옮기기만 한다.
/// </summary>
public partial class PairWindow : Window
{
    private const double SetupWidth = 470;
    private const double StatusWidth = 430;

    private readonly Action _onChanged;
    private readonly Action _openInfo;
    private readonly AgentConfig _config;
    private readonly CancellationTokenSource _closing = new();
    private bool _sanitizing;
    private bool _busy;

    /// <summary>[다시 연결]을 눌러 일부러 설정 폼을 펼친 상태.</summary>
    private bool _forceSetup;

    /// <summary>
    /// 지금 서버와 연결하는 중인지. 트레이 [종료]가 이 값을 보고 막는다.
    ///  · <c>Application.Shutdown()</c>은 창의 Closing을 발생시키지 않아 이 창의 가드를 지나쳐 버린다.
    ///    그 상태로 종료하면 서버는 코드를 소진하고 토큰까지 새로 발급했는데
    ///    이 PC에는 아무것도 저장되지 않는다(재연결이었다면 기존 연결까지 끊긴다).
    /// </summary>
    internal bool IsBusy => _busy;

    internal PairWindow(AgentConfig config, Action onChanged, Action openInfo)
    {
        InitializeComponent();
        _config = config;
        _onChanged = onChanged;
        _openInfo = openInfo;

        ServerUrlBox.Text = _config.ServerUrl;
        DeviceNameBox.Text = _config.DeviceName;
        RefreshInsecureNote();
        ApplyMode(checkServer: true);
    }

    // ── 두 모습 전환 ────────────────────────────────────────────────────────

    /// <summary>지금 연결 상태에 맞는 모습으로 창을 바꾼다.</summary>
    private void ApplyMode(bool checkServer)
    {
        // 파일 존재가 아니라 "열 수 있는지"로 판단한다(못 푸는 파일이 남아 있으면
        // "연결됨"으로 보이는데 실제로는 미연결인 상태가 된다).
        var paired = TokenStore.IsUsable();
        var showStatus = paired && !_forceSetup;

        StatusPanel.Visibility = showStatus ? Visibility.Visible : Visibility.Collapsed;
        SetupPanel.Visibility = showStatus ? Visibility.Collapsed : Visibility.Visible;
        Width = showStatus ? StatusWidth : SetupWidth;
        Title = showStatus ? "PC-OFF 연결 상태" : "PC-OFF 연결 설정";

        // 설정 폼 쪽 부속들
        PairedPanel.Visibility = paired ? Visibility.Visible : Visibility.Collapsed;
        ClearButton.Visibility = paired ? Visibility.Visible : Visibility.Collapsed;
        BackToStatusButton.Visibility = paired ? Visibility.Visible : Visibility.Collapsed;
        if (paired) PairedText.Text = $"이미 연결되어 있습니다 — {WhoText()}{PairedAtText(" (", " 연결)")}";

        if (showStatus)
        {
            StatusWho.Text = WhoText();
            ValDevice.Text = _config.DeviceName;
            ValServer.Text = _config.ServerUrl;
            ValPairedAt.Text = PairedAtText("", "");
            SetBadge("연결됨", "Success");
            if (checkServer) _ = RunServerCheck();
        }
        else
        {
            CodeBox.Focus();
        }
    }

    private string WhoText()
    {
        var company = (_config.PairedCompanyName ?? "").Trim();
        var user = (_config.PairedUserName ?? "").Trim();
        if (company.Length > 0 && user.Length > 0) return $"{company} · {user}";
        return company.Length > 0 ? company : user.Length > 0 ? user : "연결됨";
    }

    private string PairedAtText(string prefix, string suffix)
        => _config.PairedAt.HasValue
            ? $"{prefix}{_config.PairedAt.Value.LocalDateTime:yyyy-MM-dd HH:mm}{suffix}"
            : "-";

    // ── 서버 상태 한 번 확인 ────────────────────────────────────────────────

    /// <summary>
    /// 창을 열 때(그리고 [서버 다시 확인]을 눌렀을 때) 서버에 한 번 물어본다.
    ///  · ⚠️ 기다리지 않고 띄우는 작업이라 오류를 여기서 반드시 붙잡는다 —
    ///    놓치면 "확인 중..."에서 멈춘 채 아무 설명도 나오지 않는다.
    /// </summary>
    private async Task RunServerCheck()
    {
        if (_busy) return;

        SetBusy(true);
        SetBadge("확인 중...", "TextSub");
        ValLock.Text = "확인 중...";
        StatusNote.Visibility = Visibility.Collapsed;

        try
        {
            var token = TokenStore.TryLoad();
            if (token == null)
            {
                // 확인하는 사이에 연결 정보가 사라졌다(다른 곳에서 지웠거나 못 푸는 파일이 정리됨).
                _forceSetup = false;
                ApplyMode(checkServer: false);
                ShowStatus("이 PC의 연결 정보가 없습니다. 새 연결코드로 다시 연결해주세요.", isError: true);
                _onChanged();
                return;
            }

            var res = await AgentApi.GetPolicyAsync(_config.ServerUrl, token, _closing.Token);
            ValCheckedAt.Text = DateTime.Now.ToString("HH:mm:ss");

            if (res.Unauthorized)
            {
                SetBadge("연결이 해제되었습니다", "Danger");
                ValLock.Text = "-";
                ShowNote("관리자가 이 PC의 연결을 해제했거나 연결이 만료되었습니다.\n" +
                         "웹 [계정]에서 새 연결코드를 받아 [다시 연결]을 눌러주세요.", "Danger");
                return;
            }
            if (!res.Ok || res.Value == null)
            {
                SetBadge("연결됨 · 서버 확인 실패", "Warning");
                ValLock.Text = "확인하지 못했습니다";
                ShowNote(res.Error ?? "서버에 연결하지 못했습니다.", "Warning");
                return;
            }

            SetBadge("연결됨", "Success");
            ValLock.Text = LockText(res.Value);
            Log.Info($"상태 확인 성공 (enabled={res.Value.Enabled})");
        }
        catch (Exception ex)
        {
            Log.Error($"상태 확인 중 오류: {ex.GetType().FullName}");
            SetBadge("연결됨 · 서버 확인 실패", "Warning");
            ValLock.Text = "확인하지 못했습니다";
            ShowNote($"상태를 확인하는 중 오류가 발생했습니다. ({ex.GetType().Name})", "Warning");
        }
        finally
        {
            SetBusy(false);
        }
    }

    /// <summary>
    /// 서버가 내려준 값을 글자로 옮긴다. <b>계산하지 않는다</b>(잠금 시각 판단은 2-B 판정기의 일).
    /// </summary>
    private static string LockText(PcOffPolicy p)
    {
        if (!p.Enabled)
        {
            return p.DisabledReason switch
            {
                "company_off" => "회사가 PC-OFF를 사용하지 않습니다",
                "user_exempt" => "잠금 예외자로 지정돼 있습니다",
                "no_worktime" => "회사 퇴근 기준시각이 설정되지 않았습니다",
                "shift_unsupported" => "교대근무 회사는 아직 지원하지 않습니다",
                _ => "회사 설정을 확인할 수 없습니다",
            };
        }
        var end = string.IsNullOrWhiteSpace(p.Work.EndTime) ? "미설정" : p.Work.EndTime!;
        return $"사용 중 — 퇴근 {end} + 유예 {p.DelayMin}분";
    }

    // ── 버튼 ────────────────────────────────────────────────────────────────

    private async void RecheckButton_Click(object sender, RoutedEventArgs e) => await RunServerCheck();

    private void ReconnectButton_Click(object sender, RoutedEventArgs e)
    {
        _forceSetup = true;
        HideStatusText();
        ApplyMode(checkServer: false);
    }

    private void BackToStatusButton_Click(object sender, RoutedEventArgs e)
    {
        _forceSetup = false;
        HideStatusText();
        CodeBox.Clear();
        ApplyMode(checkServer: true);
    }

    private void InfoLink_Click(object sender, RoutedEventArgs e) => _openInfo();

    private void CloseButton_Click(object sender, RoutedEventArgs e) => Close();

    /// <summary>Esc로 닫기. 연결 중이면 <see cref="Window_Closing"/>이 막는다.</summary>
    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape) return;
        e.Handled = true;
        Close();
    }

    /// <summary>연결 중에는 닫지 못하게 막는다(Esc·✕ 포함).</summary>
    private void Window_Closing(object sender, CancelEventArgs e)
    {
        if (_busy)
        {
            e.Cancel = true;
            ShowStatus("서버와 이야기하는 중입니다. 잠시만 기다려주세요.", isError: false);
            return;
        }
        _closing.Cancel();
        _closing.Dispose();
    }

    // ── 입력 다듬기 ─────────────────────────────────────────────────────────

    /// <summary>https가 아닌 주소면 경고를 보여준다(연결 정보가 네트워크에서 엿보일 수 있다).</summary>
    private void RefreshInsecureNote()
    {
        var url = (ServerUrlBox.Text ?? "").Trim();
        InsecureNote.Visibility = AgentConfig.IsInsecureUrl(url) ? Visibility.Visible : Visibility.Collapsed;
    }

    private void ServerUrlBox_TextChanged(object sender, TextChangedEventArgs e) => RefreshInsecureNote();

    /// <summary>연결코드 칸은 숫자만 남긴다(붙여넣기·한글 입력기로 들어온 글자도 걸러낸다).</summary>
    private void CodeBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_sanitizing) return;

        var raw = CodeBox.Text ?? "";
        var digits = new string(raw.Where(char.IsAsciiDigit).ToArray());
        if (digits.Length > 6) digits = digits[..6];
        if (digits == raw) return;

        _sanitizing = true;
        CodeBox.Text = digits;
        CodeBox.CaretIndex = digits.Length;
        _sanitizing = false;
    }

    // ── 연결하기 ────────────────────────────────────────────────────────────

    private async void ConnectButton_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;

        var url = (ServerUrlBox.Text ?? "").Trim().TrimEnd('/');
        var deviceName = (DeviceNameBox.Text ?? "").Trim();
        var code = (CodeBox.Text ?? "").Trim();

        if (!AgentConfig.IsValidServerUrl(url))
        {
            ShowStatus("서버 주소는 http:// 또는 https:// 로 시작하는 주소만 넣어주세요. (뒤에 경로·물음표·#은 붙이지 않습니다)", isError: true);
            ServerUrlBox.Focus();
            return;
        }
        if (deviceName.Length == 0)
        {
            ShowStatus("이 컴퓨터 이름을 입력해주세요.", isError: true);
            DeviceNameBox.Focus();
            return;
        }
        if (code.Length != 6)
        {
            ShowStatus("연결코드는 숫자 6자리입니다.", isError: true);
            CodeBox.Focus();
            return;
        }

        SetBusy(true);
        ShowStatus("서버에 연결하고 있습니다...", isError: false);

        // 성공하면 "상태 창"으로 바꾼다. 단 전환은 아래 finally가 끝난 **뒤에** 해야 한다 —
        // 전환이 시작하는 서버 확인(RunServerCheck)이 먼저 시작되면 finally의 SetBusy(false)가
        // 확인 중인 상태를 성급히 풀어버린다.
        var switchToStatus = false;

        try
        {
            var res = await AgentApi.PairAsync(url, code, deviceName, _closing.Token);
            var pair = res.Value;
            var token = pair?.Token?.Trim(); // 앞뒤 공백이 섞이면 이후 모든 인증이 영구 401이 된다

            if (!res.Ok || pair == null || string.IsNullOrWhiteSpace(token))
            {
                // 시간 초과는 특별히 다룬다: 서버가 코드를 **먼저** 소진하므로, 응답만 유실되면
                // 같은 코드를 다시 넣어도 계속 실패한다. 새 코드를 받으라고 분명히 안내한다.
                //  · TimedOut은 "서버에 닿았는데 응답이 없었다"는 뜻만 갖는다(주소 오타는 별도 문구).
                //    구분은 AgentApi.SendAsync가 한다.
                var message = res.TimedOut
                    ? "서버에 연결은 됐지만 응답이 오지 않아 연결을 마치지 못했습니다.\n" +
                      "이 연결코드는 이미 사용됐을 수 있으니, 웹에서 새 코드를 발급받아 다시 시도해주세요."
                    : res.Error ?? "연결에 실패했습니다. 웹에서 새 연결코드를 받아 다시 시도해주세요.";
                ShowStatus(message, isError: true);

                // 코드는 "정말 못 쓰게 됐을 때"만 비운다.
                //  · 401 = 서버가 거부(만료·사용됨) / 시간초과 = 소진됐을 수 있음 → 비운다.
                //  · 주소 오타·429·형식 오류 등은 코드가 살아 있으므로 지우면 사용자가 다시 발급받는 헛수고를 한다.
                if (res.TimedOut || res.Unauthorized) CodeBox.Clear();
                else CodeBox.SelectAll();
                CodeBox.Focus();
                return;
            }

            TokenStore.Save(token);

            // 같은 이름의 PC가 이미 있었는데 이 PC는 처음 연결하는 경우 = 이름이 겹쳤을 가능성.
            //  서버는 (직원 + 컴퓨터 이름)으로 기기를 찾으므로, 이름이 같으면 **먼저 연결된 PC가 끊긴다.**
            var nameClashLikely = pair.Reconnected && _config.PairedAt == null;

            _config.ServerUrl = url;
            _config.DeviceName = deviceName;
            _config.PairedUserName = pair.UserName;
            _config.PairedCompanyName = pair.CompanyName;
            _config.PairedAt = DateTimeOffset.Now;
            var savedConfig = _config.Save();

            Log.Info($"연결 완료 (다시연결={pair.Reconnected}, 설정저장={savedConfig})"); // 토큰·코드는 남기지 않는다

            // 다 쓴 코드는 칸에서 지운다 — 남겨두면 성공 후 한 번 더 눌러 401 오류가
            // 초록 성공 메시지를 덮어쓰고, 서버의 실패 횟수(IP 차단 한도)까지 잠식한다.
            CodeBox.Clear();

            if (nameClashLikely)
            {
                MessageBox.Show(
                    $"\"{deviceName}\" 이름으로 이미 연결된 PC가 있었습니다.\n\n" +
                    "같은 이름은 한 대만 연결할 수 있어, 먼저 연결돼 있던 PC는 이 순간부터 동작하지 않습니다.\n" +
                    "두 대를 함께 쓰려면 컴퓨터 이름을 다르게 정해 다시 연결해주세요. (예: 사무실-PC, 노트북)",
                    "컴퓨터 이름이 겹칩니다", MessageBoxButton.OK, MessageBoxImage.Warning);
            }

            _onChanged();

            if (!savedConfig)
            {
                // 토큰은 저장됐지만 서버 주소가 저장되지 않았다 → 다음 실행에서 엉뚱한 주소를 보게 된다.
                //  상태 창으로 넘기지 않고 이 자리에서 분명히 알린다.
                ShowStatus("연결은 됐지만 설정 파일을 저장하지 못했습니다.\n" +
                           "프로그램을 다시 켜면 서버 주소를 다시 입력해야 합니다.", isError: true);
                return;
            }

            // 연결이 끝났으니 작은 "상태 창"으로 바꾼다(전환은 finally 뒤에).
            switchToStatus = true;
        }
        catch (Exception ex)
        {
            // 여기 오는 대표 경우: 토큰 저장 실패(디스크·권한).
            //  ⚠️ 이 시점에 서버는 **이미 코드를 소진하고 토큰을 새로 발급**했다.
            //     같은 코드로는 절대 다시 성공할 수 없으므로 "새 코드"를 받으라고 안내해야 한다.
            Log.Error($"연결 처리 중 오류: {ex.GetType().FullName}");
            ShowStatus("연결 정보를 이 PC에 저장하지 못했습니다.\n" +
                       "이 연결코드는 이미 사용됐으니, 웹에서 새 코드를 발급받아 다시 시도해주세요.", isError: true);
            CodeBox.Clear();
        }
        finally
        {
            SetBusy(false);
        }

        if (switchToStatus)
        {
            _forceSetup = false;
            HideStatusText();
            ApplyMode(checkServer: true);
        }
    }

    // ── 연결 정보 지우기 ────────────────────────────────────────────────────

    private void ClearButton_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;

        var answer = MessageBox.Show(
            "이 PC에 저장된 연결 정보를 지웁니다.\n\n" +
            "이 PC는 더 이상 잠기지 않고, 다시 쓰려면 웹에서 새 연결코드를 받아야 합니다.\n" +
            "관리자 화면의 기기 목록에서도 지우려면 웹 [계정] 또는 [PC관리]에서 [연결 해제]를 눌러주세요.",
            "연결 정보 지우기", MessageBoxButton.OKCancel, MessageBoxImage.Warning);
        if (answer != MessageBoxResult.OK) return;

        if (!TokenStore.Clear())
        {
            // 지우지 못했는데 지웠다고 말하면 안 된다(화면과 실제가 어긋난다).
            ShowNote("연결 정보를 지우지 못했습니다. 다른 프로그램이 파일을 쓰고 있을 수 있으니 잠시 후 다시 시도해주세요.", "Danger");
            ShowStatus("연결 정보를 지우지 못했습니다. 잠시 후 다시 시도해주세요.", isError: true);
            return;
        }

        _config.PairedUserName = null;
        _config.PairedCompanyName = null;
        _config.PairedAt = null;
        var saved = _config.Save();

        _forceSetup = false;
        ApplyMode(checkServer: false); // 이제 미연결 → 설정 폼으로 돌아간다
        ShowStatus(saved
            ? "이 PC의 연결 정보를 지웠습니다."
            : "연결 정보는 지웠지만 설정 파일 정리에 실패했습니다(동작에는 문제가 없습니다).", isError: !saved);
        _onChanged();
    }

    // ── 화면 상태 표시 ───────────────────────────────────────────────────────

    private void SetBusy(bool busy)
    {
        _busy = busy;

        // 설정 폼
        ConnectButton.IsEnabled = !busy;
        ConnectButton.Content = busy ? "연결 중..." : "연결하기";
        ServerUrlBox.IsEnabled = !busy;
        DeviceNameBox.IsEnabled = !busy;
        CodeBox.IsEnabled = !busy;
        ClearButton.IsEnabled = !busy;
        BackToStatusButton.IsEnabled = !busy;
        CloseButton.IsEnabled = !busy;

        // 상태 창
        RecheckButton.IsEnabled = !busy;
        RecheckButton.Content = busy ? "확인 중..." : "서버 다시 확인";
        ReconnectButton.IsEnabled = !busy;
        ClearButton2.IsEnabled = !busy;
    }

    private void SetBadge(string text, string brushKey)
    {
        StatusBadgeText.Text = text;
        var brush = (Brush)FindResource(brushKey);
        StatusBadgeText.Foreground = brush;
        StatusDot.Fill = brush;
    }

    private void ShowNote(string message, string brushKey)
    {
        StatusNote.Text = message;
        StatusNote.Foreground = (Brush)FindResource(brushKey);
        StatusNote.FontWeight = FontWeights.Bold;
        StatusNote.Visibility = Visibility.Visible;
    }

    private void HideStatusText() => StatusText.Visibility = Visibility.Collapsed;

    private void ShowStatus(string message, bool isError, bool isSuccess = false)
    {
        StatusText.Text = message;
        StatusText.Visibility = Visibility.Visible;
        StatusText.FontWeight = isError || isSuccess ? FontWeights.Bold : FontWeights.Normal;
        StatusText.Foreground = isError
            ? (Brush)FindResource("Danger")
            : isSuccess ? (Brush)FindResource("Success") : (Brush)FindResource("TextSub");
    }
}
