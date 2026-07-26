using System;
using System.ComponentModel;
using System.Linq;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using NewgaonPcOff.Api;
using NewgaonPcOff.Config;
using NewgaonPcOff.Diagnostics;
using NewgaonPcOff.Security;

namespace NewgaonPcOff.UI;

/// <summary>
/// 이 PC를 직원 계정에 연결하는 창.
///  · 여기서 받는 기기 토큰은 화면·로그에 절대 표시하지 않는다(사규 8조).
///  · 서버 주소·컴퓨터 이름은 <b>연결이 성공했을 때만</b> 저장한다.
///    (실패한 값을 저장하면, 이미 연결된 다른 서버 주소를 잘못 덮어써 앱이 엉뚱한 곳을 보게 된다)
///  · 연결 중에는 창을 닫을 수 없다 — 닫힌 창에 결과를 쓰면 사용자는 성공·실패를 영원히 알 수 없고,
///    그 사이 새로 연 창과 설정 파일을 서로 덮어쓰는 사고가 난다.
/// </summary>
public partial class PairWindow : Window
{
    private readonly Action _onChanged;
    private readonly Action _openInfo;
    private readonly AgentConfig _config;
    private readonly CancellationTokenSource _closing = new();
    private bool _sanitizing;
    private bool _busy;

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
        RefreshPairedPanel();
        RefreshInsecureNote();
        CodeBox.Focus();
    }

    private void RefreshPairedPanel()
    {
        var paired = TokenStore.IsUsable(); // 파일 존재가 아니라 "열 수 있는지"
        PairedPanel.Visibility = paired ? Visibility.Visible : Visibility.Collapsed;
        ClearButton.Visibility = paired ? Visibility.Visible : Visibility.Collapsed;

        if (paired)
        {
            var who = string.IsNullOrWhiteSpace(_config.PairedUserName) ? "연결됨" : _config.PairedUserName!;
            var company = string.IsNullOrWhiteSpace(_config.PairedCompanyName) ? "" : $"{_config.PairedCompanyName} · ";
            var when = _config.PairedAt.HasValue ? $" ({_config.PairedAt.Value.LocalDateTime:yyyy-MM-dd HH:mm} 연결)" : "";
            PairedText.Text = $"이미 연결되어 있습니다 — {company}{who}{when}";
        }
    }

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

    private void InfoLink_Click(object sender, RoutedEventArgs e) => _openInfo();

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

            var head = pair.Reconnected ? "다시 연결되었습니다" : "연결되었습니다";
            if (!savedConfig)
            {
                // 토큰은 저장됐지만 서버 주소가 저장되지 않았다 → 다음 실행에서 엉뚱한 주소를 보게 된다.
                ShowStatus($"{head} — {pair.CompanyName} · {pair.UserName}\n" +
                           "다만 설정 파일을 저장하지 못했습니다. 프로그램을 다시 켜면 서버 주소를 다시 입력해야 합니다.",
                    isError: true);
            }
            else
            {
                ShowStatus($"{head} — {pair.CompanyName} · {pair.UserName}", isError: false, isSuccess: true);
            }

            if (nameClashLikely)
            {
                MessageBox.Show(
                    $"\"{deviceName}\" 이름으로 이미 연결된 PC가 있었습니다.\n\n" +
                    "같은 이름은 한 대만 연결할 수 있어, 먼저 연결돼 있던 PC는 이 순간부터 동작하지 않습니다.\n" +
                    "두 대를 함께 쓰려면 컴퓨터 이름을 다르게 정해 다시 연결해주세요. (예: 사무실-PC, 노트북)",
                    "컴퓨터 이름이 겹칩니다", MessageBoxButton.OK, MessageBoxImage.Warning);
            }

            // 다 쓴 코드는 칸에서 지운다 — 남겨두면 성공 후 한 번 더 눌러 401 오류가
            // 초록 성공 메시지를 덮어쓰고, 서버의 실패 횟수(IP 차단 한도)까지 잠식한다.
            CodeBox.Clear();

            RefreshPairedPanel();
            _onChanged();
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
    }

    private void ClearButton_Click(object sender, RoutedEventArgs e)
    {
        var answer = MessageBox.Show(
            "이 PC에 저장된 연결 정보를 지웁니다.\n\n" +
            "이 PC는 더 이상 잠기지 않고, 다시 쓰려면 웹에서 새 연결코드를 받아야 합니다.\n" +
            "관리자 화면의 기기 목록에서도 지우려면 웹 [계정] 또는 [PC관리]에서 [연결 해제]를 눌러주세요.",
            "연결 정보 지우기", MessageBoxButton.OKCancel, MessageBoxImage.Warning);
        if (answer != MessageBoxResult.OK) return;

        if (!TokenStore.Clear())
        {
            // 지우지 못했는데 지웠다고 말하면 안 된다(화면과 실제가 어긋난다).
            ShowStatus("연결 정보를 지우지 못했습니다. 다른 프로그램이 파일을 쓰고 있을 수 있으니 잠시 후 다시 시도해주세요.", isError: true);
            RefreshPairedPanel();
            return;
        }

        _config.PairedUserName = null;
        _config.PairedCompanyName = null;
        _config.PairedAt = null;
        var saved = _config.Save();

        RefreshPairedPanel();
        ShowStatus(saved
            ? "이 PC의 연결 정보를 지웠습니다."
            : "연결 정보는 지웠지만 설정 파일 정리에 실패했습니다(동작에는 문제가 없습니다).", isError: !saved);
        _onChanged();
    }

    private void CloseButton_Click(object sender, RoutedEventArgs e) => Close();

    /// <summary>연결 중에는 닫지 못하게 막는다(Esc·✕ 포함).</summary>
    private void Window_Closing(object sender, CancelEventArgs e)
    {
        if (_busy)
        {
            e.Cancel = true;
            ShowStatus("연결하는 중입니다. 잠시만 기다려주세요.", isError: false);
            return;
        }
        _closing.Cancel();
        _closing.Dispose();
    }

    // ── 화면 상태 표시 ───────────────────────────────────────────────────────

    private void SetBusy(bool busy)
    {
        _busy = busy;
        ConnectButton.IsEnabled = !busy;
        ConnectButton.Content = busy ? "연결 중..." : "연결하기";
        ServerUrlBox.IsEnabled = !busy;
        DeviceNameBox.IsEnabled = !busy;
        CodeBox.IsEnabled = !busy;
        ClearButton.IsEnabled = !busy;
        CloseButton.IsEnabled = !busy;
    }

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
