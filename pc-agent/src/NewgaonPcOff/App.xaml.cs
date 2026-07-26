using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;
using NewgaonPcOff.Config;
using NewgaonPcOff.Diagnostics;
using NewgaonPcOff.UI;

namespace NewgaonPcOff;

public partial class App : Application
{
    /// <summary>
    /// 같은 사용자가 앱을 두 번 켜는 것을 막는 자물쇠.
    ///  · 두 개가 돌면 잠금창이 겹치고 [일시사용] 횟수가 두 배로 올라간다.
    ///  · Local\ 범위 = 사용자별. 한 PC를 여러 사람이 쓰면 사람마다 하나씩 돌 수 있다(정상).
    /// </summary>
    private static Mutex? _singleInstance;

    private TrayApp? _tray;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // ⚠️ 시작 과정 전체를 감싼다.
        //  이 앱은 "항상 켜져 있어야" 의미가 있는데, 시작하다 조용히 죽으면 아무도 그 사실을 모른다
        //  (관리자 화면엔 그냥 "꺼짐"으로 보인다). 그래서 시작 실패는 반드시 기록하고 알린다.
        //  WPF의 DispatcherUnhandledException은 이 메서드 안의 예외를 잡지 못하므로 직접 try로 감싼다.
        try
        {
            // 처리되지 않은 오류를 놓치지 않도록 **먼저** 등록한다.
            DispatcherUnhandledException += OnDispatcherUnhandledException;
            AppDomain.CurrentDomain.UnhandledException += OnDomainUnhandledException;
            TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;

            if (!TryTakeSingleInstanceLock())
            {
                // 이미 돌고 있으면 조용히 물러난다(사용자에게 경고창을 띄우면 오히려 혼란).
                Log.Info("이미 실행 중이라 새 인스턴스를 종료합니다.");
                Shutdown();
                return;
            }

            AgentPaths.EnsureDirs();
            Log.Info($"{AppInfo.FullName} {AppInfo.Version} 시작");

            _tray = new TrayApp();
            _tray.Start();
        }
        catch (Exception ex)
        {
            Log.Error("프로그램을 시작하지 못했습니다.", ex);
            MessageBox.Show(
                $"{AppInfo.Name} 프로그램을 시작하지 못했습니다.\n\n" +
                $"오류 종류: {ex.GetType().Name}\n" +
                "관리자에게 알려주세요. 자세한 내용은 아래 폴더의 기록 파일에 있습니다.\n" +
                AgentPaths.LogDir,
                AppInfo.Name, MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown();
        }
    }

    /// <summary>
    /// 중복 실행 자물쇠를 잡는다.
    ///  · 자물쇠를 <b>만드는 것 자체가 실패</b>할 수 있다(같은 이름의 다른 종류 커널 객체가 이미 있거나 권한 문제).
    ///    그때는 중복 실행 차단을 포기하고 <b>그냥 실행한다</b> — 실행되지 않는 것보다 안전하다.
    /// </summary>
    private static bool TryTakeSingleInstanceLock()
    {
        try
        {
            _singleInstance = new Mutex(true, @"Local\NewgaonPcOff.Agent", out var isFirst);
            if (isFirst) return true;

            _singleInstance.Dispose();
            _singleInstance = null;
            return false;
        }
        catch (Exception ex)
        {
            Log.Warn($"중복 실행 차단 장치를 만들지 못해 건너뜁니다: {ex.GetType().Name}");
            _singleInstance = null;
            return true; // 차단 실패 < 미실행. 계속 진행한다.
        }
    }

    /// <summary>
    /// 같은 오류가 반복될 때 알림창이 무한히 쌓이지 않도록 두는 간격.
    ///  · 앞으로 붙을 폴링 타이머(2-B)가 같은 예외를 5분마다 던지면, 간격이 없으면 창이 계속 늘어난다.
    /// </summary>
    private static readonly TimeSpan NoticeCooldown = TimeSpan.FromMinutes(10);
    private static DateTime _lastNoticeAt = DateTime.MinValue;

    private static void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        // ⚠️ 예외 메시지에는 값이 실릴 수 있어(토큰 등) 기록·화면에 그대로 쓰지 않는다. 종류만 알린다.
        Log.Error($"처리되지 않은 화면 오류: {e.Exception.GetType().FullName}");
        e.Handled = true; // 앱을 죽이지 않는다

        // 기록은 매번, 알림창은 10분에 한 번만.
        var now = DateTime.Now;
        if (now - _lastNoticeAt < NoticeCooldown) return;
        _lastNoticeAt = now;

        MessageBox.Show(
            $"예상하지 못한 오류가 발생했습니다. ({e.Exception.GetType().Name})\n\n" +
            "프로그램은 계속 동작합니다. 반복되면 관리자에게 알려주세요.",
            AppInfo.Name, MessageBoxButton.OK, MessageBoxImage.Warning);
    }

    private static void OnDomainUnhandledException(object sender, UnhandledExceptionEventArgs e)
    {
        Log.Error($"처리되지 않은 오류(치명): {(e.ExceptionObject as Exception)?.GetType().FullName ?? "알 수 없음"}");
    }

    /// <summary>기다리지 않고 띄운 작업(fire-and-forget)에서 난 오류. 놓치면 원인 없이 기능만 먹통이 된다.</summary>
    private static void OnUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs e)
    {
        Log.Error($"확인되지 않은 작업 오류: {e.Exception.GetType().FullName}");
        e.SetObserved(); // 프로세스를 죽이지 않는다
    }

    protected override void OnExit(ExitEventArgs e)
    {
        Log.Info("종료");
        try { _tray?.Dispose(); } catch (Exception ex) { Log.Warn($"트레이 정리 실패: {ex.GetType().Name}"); }

        if (_singleInstance != null)
        {
            try { _singleInstance.ReleaseMutex(); } catch (ApplicationException) { /* 이미 풀림 */ }
            _singleInstance.Dispose();
            _singleInstance = null;
        }
        base.OnExit(e);
    }
}
