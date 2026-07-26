using System.Windows;

namespace NewgaonPcOff.UI;

/// <summary>근로자 고지 화면(트레이 → "수집하는 정보"). 내용은 XAML에 고정 문구로 둔다.</summary>
public partial class InfoWindow : Window
{
    public InfoWindow() => InitializeComponent();

    private void CloseButton_Click(object sender, RoutedEventArgs e) => Close();
}
