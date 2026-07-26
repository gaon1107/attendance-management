using System;
using System.Collections.Generic;
using NewgaonPcOff.Config;
using NewgaonPcOff.Core;
using NewgaonPcOff.Diagnostics;

namespace NewgaonPcOff.UI;

/// <summary>
/// 판정 결과를 <b>실제 동작</b>으로 옮기는 유일한 곳.
///  ① 잠글 시간이 되면 잠금화면을 띄우고, 풀릴 시간이 되면 닫는다.
///  ② 잠기기 전에 사전알림 토스트를 띄운다.
///  ③ 잠금·해제·사전알림을 <b>기록으로 남긴다</b> — 서버가 "앱을 끈 PC"를 알아채는 근거다.
///
/// 왜 판정기(<see cref="PolicyService"/>)와 나누는가
///  · 판정기는 "지금 잠겨야 하는가"만 계산한다(순수 계산 → 시나리오 표로 전수 검증 가능).
///  · 실제로 창을 띄우는 것은 화면 사정(테스트 모드 유예 등)이 섞이므로 여기서 따로 맡는다.
///  · ⚠️ 기록(<c>lock</c>)은 <b>실제로 덮었을 때만</b> 남긴다. 판정만 보고 남기면
///    테스트 유예로 덮지 않은 순간까지 "잠갔다"고 서버에 보고하는 거짓말이 된다.
/// </summary>
internal sealed class LockController : IDisposable
{
    private readonly PolicyService _service;
    private readonly Func<AgentConfig> _config;

    private LockWindow? _window;
    private ToastWindow? _toast;

    /// <summary>
    /// 닫는 데 실패해 <b>화면에서 치워만 둔</b> 잠금창. 다음 주기에 다시 닫아 본다.
    ///  · ⚠️ 이것을 "지금 잠겨 있다"와 <b>같은 값으로 다루면 안 된다</b>. 닫기에 실패한 창은
    ///    이미 숨겨져 화면을 덮고 있지 않은데, 잠금 상태로 취급하면 다시 잠글 시간이 와도
    ///    "이미 잠겨 있다"고 판단해 <b>그 실행 내내 두 번 다시 잠기지 않는다</b>(재검수 치명 C-1).
    /// </summary>
    private LockWindow? _zombie;

    /// <summary>지금 실제로 화면을 덮고 있는가(기록의 기준).</summary>
    private bool _locked;

    /// <summary>
    /// 테스트 모드에서 <b>저절로 잠기는 것</b>을 이미 한 번 보여 줬는가.
    ///  · ⚠️ 이 장치가 없으면 잠금 시간대(예: 새벽)에 테스트 모드로 켠 PC가
    ///    "60초 덮기 → 풀기 → 다시 덮기"를 되풀이해 쓸 수 없게 된다.
    ///  · 다시 보려면 트레이의 [테스트] 잠금화면 미리보기를 누른다.
    /// </summary>
    private bool _testAutoLockUsed;

    /// <summary>어느 "잠길 시각"에 대해 알렸는지(그 시각이 바뀌면 알림을 처음부터 다시 센다).</summary>
    private DateTimeOffset? _notifyTarget;
    private readonly HashSet<int> _notified = [];

    /// <summary>
    /// [테스트] 미리보기로 띄운 창인가.
    ///  · 미리보기는 "잠길 시각이 아닐 때" 확인용으로 띄우므로, 다음 판정(10초 이내)이
    ///    이 창을 강제로 닫고 <b>짝 없는 해제 기록</b>을 서버로 보내면 안 된다(검수 중간 M-4).
    /// </summary>
    private bool _preview;

    private bool _disposed;

    public LockController(PolicyService service, Func<AgentConfig> config)
    {
        _service = service ?? throw new ArgumentNullException(nameof(service));
        _config = config ?? throw new ArgumentNullException(nameof(config));
    }

    /// <summary>지금 화면을 덮고 있는가(트레이가 [종료]를 막을지 판단할 때 쓴다).</summary>
    public bool IsLocked => _locked;

    /// <summary>
    /// 이 프로그램이 지금 화면을 덮고 있는가(어디서나 값싸게 확인).
    ///  · 잠금 중에는 알림창(MessageBox)을 띄우면 안 된다 — 잠금화면 뒤에 가려져
    ///    닫을 수 없게 되고, 기다리는 쪽은 영영 멈춘다(검수 중간 M-5).
    /// </summary>
    public static bool AnyLocked { get; private set; }

    public void Start()
    {
        _service.Changed += OnChanged;
        OnChanged(); // 켜자마자 한 번 맞춘다(퇴근 후에 PC를 켠 경우)
    }

    // ── 판정이 바뀔 때마다 ──────────────────────────────────────────────────

    private void OnChanged()
    {
        if (_disposed) return;

        try
        {
            Apply();
        }
        catch (Exception ex)
        {
            // 여기서 예외가 새어 나가면 판정기의 알림 고리가 끊겨 잠금이 통째로 멈춘다.
            Log.Error("잠금 처리 중 오류", ex);
        }
    }

    private void Apply()
    {
        RetryCloseZombie();

        var s = _service.Status;
        var now = s.Decision.At ?? DateTimeOffset.Now;

        // 잠글 조건: 연결돼 있고, 서버가 이 PC를 잠금 대상으로 보고, 판정이 "잠금"일 것.
        //  · 하나라도 아니면 덮지 않는다(fail-open — 확신이 없으면 업무를 막지 않는다).
        var want = s.Paired && !s.Revoked && s.Policy is { Enabled: true } && s.Decision.ShouldLock;

        // 테스트 모드에서는 저절로 잠기는 것을 한 번만 보여 준다(되풀이해 덮어 PC를 못 쓰게 하지 않는다).
        if (want && AppMode.TestMode && _testAutoLockUsed) want = false;

        // [테스트] 미리보기로 띄운 창은 판정이 건드리지 않는다(스스로 60초 뒤에 닫힌다).
        if (_preview)
        {
            _window?.Render();
            return;
        }

        if (want && !_locked)
        {
            // 창을 띄우지 못했으면 "잠기지 않은 것"이다 → 사전알림은 계속 돌아야 한다.
            if (!ShowLock(now)) CheckNotify(s, now);
            return;
        }

        if (!want && _locked) HideLock(now, "판정 해제");
        else if (_locked) _window?.Render();

        // 아직 안 잠긴 상태에서만 "곧 잠깁니다"를 알린다.
        if (!want) CheckNotify(s, now);
    }

    // ── 잠금화면 ────────────────────────────────────────────────────────────

    /// <summary>화면을 덮는다. 실제로 덮는 데 성공하면 <c>true</c>.</summary>
    private bool ShowLock(DateTimeOffset now)
    {
        CloseToast();

        // ⚠️ 창을 띄우는 데 실패하면 **잠기지 않은 것**이다.
        //    그런데도 잠갔다고 표시하면 ① 화면은 안 덮이고 ② 트레이 [종료]는 막히고
        //    ③ 기록이 없어 서버가 "앱을 끈 PC"로 신고한다 — 최악의 조합(검수 중간 M-1).
        LockWindow window;
        try
        {
            window = new LockWindow(_config(), _service);
            window.TestUnlockRequested += () =>
            {
                // 테스트 모드에서만 온다. 한 번 보여 줬으므로 이 실행에서는 더 이상 저절로 잠그지 않는다.
                _testAutoLockUsed = true;
                HideLock(_service.Status.Decision.At ?? DateTimeOffset.Now, "테스트 해제");
            };

            _window = window;
            _locked = true;
            AnyLocked = true;

            window.Show();
            window.Activate();
        }
        catch (Exception ex)
        {
            Log.Error("잠금화면을 띄우지 못했습니다 — 잠그지 않은 것으로 처리하고 다음 주기에 다시 시도합니다", ex);
            Release(_window);
            return false;
        }

        Log.Info($"화면을 잠갔습니다 ({_service.Status.Decision.Reason}).");

        // ⚠️ 이 기록이 서버의 미보고 감시(webapp/lib/pcoff-alert.ts)가 보는 값이다.
        //    **실제로 덮은 뒤에만** 남긴다.
        _service.EnqueueEvent("lock", now);
        return true;
    }

    private void HideLock(DateTimeOffset now, string why)
    {
        // ⚠️ 닫기에 실패해도 **잠금 상태는 반드시 내린다.**
        //    닫기에 실패한 창은 이미 화면에서 치워졌으므로(숨김) 덮고 있지 않다.
        //    그런데도 "잠겨 있다"로 남기면, 다시 잠글 시간이 와도 "이미 잠겼다"고 판단해
        //    그 실행 내내 두 번 다시 잠기지 않는다(재검수 치명 C-1).
        Release(_window);

        Log.Info($"화면 잠금을 풀었습니다 ({why}).");
        _service.EnqueueEvent("unlock", now);
    }

    /// <summary>잠금 상태를 내리고 창을 정리한다. 닫기에 실패하면 다음 주기에 다시 닫을 목록에 넣는다.</summary>
    private void Release(LockWindow? window)
    {
        _window = null;
        _locked = false;
        _preview = false;
        AnyLocked = false;

        if (window == null) return;

        try
        {
            if (!window.AllowCloseAndClose())
            {
                _zombie = window;
                Log.Warn("잠금화면을 닫지 못해 화면에서 치우고 다음 주기에 다시 정리합니다.");
            }
        }
        catch (Exception ex)
        {
            _zombie = window;
            Log.Error($"잠금화면 정리 중 오류 — 다음 주기에 다시 시도합니다: {ex.GetType().FullName}");
        }
    }

    /// <summary>닫지 못했던 창을 다시 닫아 본다(화면에는 안 보이지만 남아 있는 창을 정리한다).</summary>
    private void RetryCloseZombie()
    {
        var z = _zombie;
        if (z == null) return;

        try
        {
            if (z.AllowCloseAndClose())
            {
                _zombie = null;
                Log.Info("닫지 못했던 잠금화면을 정리했습니다.");
            }
        }
        catch (Exception ex)
        {
            Log.Warn($"남은 잠금화면 정리 실패(계속 시도합니다): {ex.GetType().Name}");
        }
    }

    // ── 사전알림 ────────────────────────────────────────────────────────────

    private void CheckNotify(AgentStatus s, DateTimeOffset now)
    {
        var p = s.Policy;
        if (p == null || !p.Enabled || p.NotifyMins.Length == 0) return;
        if (!s.Paired || s.Revoked) return;

        var target = s.Decision.ChangeAt;
        if (target == null)
        {
            // 잠길 시각을 모른다(서버가 준 이틀치를 넘어감) → 알릴 것이 없다.
            _notifyTarget = null;
            _notified.Clear();
            return;
        }

        // 잠길 시각이 달라졌다(설정 변경·연장근무 승인 등) → 처음부터 다시 센다.
        if (_notifyTarget != target)
        {
            _notifyTarget = target;
            _notified.Clear();
        }

        var leftMin = (target.Value - now).TotalMinutes;
        if (leftMin <= 0) return;

        // NotifyMins는 내림차순이다. 여러 개가 한꺼번에 걸리면(예: 앱을 6분 전에 켬)
        // 토스트는 **가장 큰 것 하나만** 띄우고 나머지는 알린 것으로 처리한다(알림 폭탄 방지).
        int? fire = null;
        foreach (var m in p.NotifyMins)
        {
            if (_notified.Contains(m)) continue;
            if (leftMin > m) continue;
            fire ??= m;
            _notified.Add(m);
        }
        if (fire == null) return;

        ShowToast(StatusWording.NotifySoon(fire.Value, target.Value));
        _service.EnqueueEvent("notify", now);
        Log.Info($"사전알림: {fire.Value}분 전 (잠금 {target.Value:HH:mm}).");
    }

    private void ShowToast(string body)
    {
        CloseToast();
        try
        {
            var toast = new ToastWindow(body);
            toast.Closed += (_, _) => { if (ReferenceEquals(_toast, toast)) _toast = null; };
            _toast = toast;
            toast.Show(); // ShowActivated=False — 포커스를 빼앗지 않는다
        }
        catch (Exception ex)
        {
            // 알림은 "있으면 좋은 것"이다. 실패해도 잠금은 그대로 진행된다.
            Log.Warn($"사전알림을 띄우지 못했습니다: {ex.GetType().Name}");
        }
    }

    private void CloseToast()
    {
        var toast = _toast;
        _toast = null;
        if (toast == null) return;
        try { toast.CloseNow(); } catch (Exception ex) { Log.Warn($"알림을 닫지 못했습니다: {ex.GetType().Name}"); }
    }

    // ── 테스트 모드 전용 ────────────────────────────────────────────────────

    /// <summary>
    /// [테스트] 잠금화면 미리보기 — 지금 바로 덮어 본다.
    ///  · ⚠️ 테스트 모드(<c>--test-mode</c>)로 켰을 때만 동작한다. 평소 실행에서는 아무 일도 하지 않는다.
    ///  · 기록(<c>lock</c>)을 남기지 않는다 — 실제로 잠길 시간이 아닌데 잠갔다고 보고하면 거짓 기록이 된다.
    /// </summary>
    public bool TryPreviewLock()
    {
        if (!AppMode.TestMode || _locked) return false;

        CloseToast();

        try
        {
            var window = new LockWindow(_config(), _service);
            window.TestUnlockRequested += () =>
            {
                // ⚠️ 닫기에 실패해도 상태는 반드시 내린다 — 안 그러면 _preview가 켜진 채 굳어
                //    그 실행 내내 실제 잠금이 통째로 멈춘다(재검수 중간 M-3).
                Release(_window);
                Log.Info("테스트 미리보기 잠금을 풀었습니다.");
            };

            _window = window;
            _locked = true;
            _preview = true;   // 판정이 이 창을 건드리지 않게 한다(짝 없는 해제 기록 방지)
            AnyLocked = true;

            // 미리보기를 본 뒤에는 저절로 또 잠기지 않게 한다(확인은 이미 끝났다).
            _testAutoLockUsed = true;

            window.Show();
            window.Activate();
        }
        catch (Exception ex)
        {
            Log.Error("미리보기 창을 띄우지 못했습니다", ex);
            Release(_window);
            return false;
        }

        Log.Warn("테스트 미리보기로 화면을 덮었습니다(기록은 남기지 않습니다).");
        return true;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        _service.Changed -= OnChanged;
        CloseToast();

        // 앱이 끝날 때는 잠금화면이 닫히는 것을 막지 않는다(창이 남아 종료가 멈추는 것을 방지).
        var window = _window;
        var zombie = _zombie;
        _window = null;
        _zombie = null;
        _locked = false;
        _preview = false;
        AnyLocked = false;

        try { window?.AllowCloseAndClose(); } catch (Exception ex) { Log.Warn($"잠금화면 정리 실패: {ex.GetType().Name}"); }
        try { zombie?.AllowCloseAndClose(); } catch (Exception ex) { Log.Warn($"남은 잠금화면 정리 실패: {ex.GetType().Name}"); }
    }
}
