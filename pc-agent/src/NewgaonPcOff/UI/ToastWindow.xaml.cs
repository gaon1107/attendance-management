using System;
using System.Windows;
using System.Windows.Threading;
using NewgaonPcOff.Diagnostics;

namespace NewgaonPcOff.UI;

/// <summary>
/// 사전알림 토스트 — "몇 분 뒤 잠깁니다"를 화면 오른쪽 아래에 잠깐 띄운다.
///  · 포커스를 빼앗지 않는다(<c>ShowActivated=False</c>) — 타이핑 중에 글자를 가로채면 그 자체가 업무 방해다.
///  · 스스로 사라진다. 사용자가 아무것도 하지 않아도 화면에 남지 않는다.
/// </summary>
// ⚠️ XAML이 만들어 주는 짝(partial)이 public이라 여기도 public이어야 한다(PairWindow와 같은 형태).
public partial class ToastWindow : Window
{
    /// <summary>화면에 머무는 시간.</summary>
    private static readonly TimeSpan ShowFor = TimeSpan.FromSeconds(12);

    /// <summary>화면 가장자리에서 띄우는 간격(창의 Margin 속성과 이름이 겹치지 않게 Gap으로 둔다).</summary>
    private const double Gap = 8;

    private readonly DispatcherTimer _timer = new() { Interval = ShowFor };

    internal ToastWindow(string body)
    {
        InitializeComponent();

        BodyText.Text = body ?? "";

        Loaded += (_, _) => PlaceBottomRight();
        SizeChanged += (_, _) => PlaceBottomRight();

        _timer.Tick += (_, _) =>
        {
            _timer.Stop();
            SafeClose();
        };
        _timer.Start();
    }

    /// <summary>주 모니터 작업영역(작업표시줄을 제외한 영역)의 오른쪽 아래.</summary>
    private void PlaceBottomRight()
    {
        try
        {
            var area = SystemParameters.WorkArea;
            Left = area.Right - Width - Gap;
            Top = area.Bottom - ActualHeight - Gap;
        }
        catch (Exception ex)
        {
            Log.Warn($"알림 위치를 정하지 못했습니다: {ex.GetType().Name}");
        }
    }

    private void CloseButton_Click(object sender, RoutedEventArgs e) => CloseNow();

    /// <summary>지금 닫는다(시계도 함께 멈춘다 — 닫힌 창의 시계가 계속 도는 것을 막는다).</summary>
    internal void CloseNow()
    {
        _timer.Stop();
        SafeClose();
    }

    private void SafeClose()
    {
        try { Close(); }
        catch (Exception ex) { Log.Warn($"알림을 닫지 못했습니다: {ex.GetType().Name}"); }
    }
}
