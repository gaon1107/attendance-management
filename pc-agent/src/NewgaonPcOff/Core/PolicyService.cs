using System;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Threading;
using NewgaonPcOff.Api;
using NewgaonPcOff.Config;
using NewgaonPcOff.Diagnostics;
using NewgaonPcOff.Security;

namespace NewgaonPcOff.Core;

/// <summary>
/// 판정기를 <b>계속 돌리는</b> 부분. 이 앱에서 시간에 따라 스스로 움직이는 유일한 곳이다.
///
/// 하는 일 3가지
///  ① 주기적으로 서버에서 회사 설정을 받아온다(보통 5분, 잠금 중·잠금 임박·실패 시 1분).
///  ② 받은 설정을 <b>암호화해 저장</b>한다 → 인터넷이 끊겨도, 껐다 켜도 판정이 이어진다.
///  ③ 10초마다 판정을 다시 계산해 상태가 바뀌면 알린다(<see cref="Changed"/>).
///
/// 지키는 것
///  · <b>fail-open</b>: 정책을 모르면 잠그지 않는다. 서버가 죽어도 직원 업무를 막지 않는다.
///  · <b>2-B는 판단만 한다</b> — 실제로 화면을 덮는 잠금창·사전알림·이벤트 전송은 2-C의 일이다.
///  · 화면 갱신을 위해 UI 시계(<see cref="DispatcherTimer"/>)로 돈다 → 알림이 화면 스레드에서 오므로
///    받는 쪽이 스레드를 신경 쓸 필요가 없다.
/// </summary>
internal sealed class PolicyService : IDisposable
{
    /// <summary>판정을 다시 계산하는 주기. 서버를 부르지 않는 순수 계산이라 가볍다.</summary>
    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(10);

    /// <summary>평상시 서버 확인 주기(지시서 §5).</summary>
    private static readonly TimeSpan PollNormal = TimeSpan.FromMinutes(5);

    /// <summary>잠금 중·잠금 임박·직전 실패 때의 확인 주기(지시서 §5).</summary>
    private static readonly TimeSpan PollFast = TimeSpan.FromMinutes(1);

    /// <summary>상태 변화가 이 시간 안으로 다가오면 빠른 주기로 바꾼다(설정 변경이 늦게 반영돼 억울하게 잠기지 않게).</summary>
    private static readonly TimeSpan SoonWindow = TimeSpan.FromMinutes(10);

    /// <summary>서버가 이 기기를 거부한 뒤에도 이 주기로 한 번씩 다시 물어본다(관리자가 되살렸을 때 스스로 복구).</summary>
    private static readonly TimeSpan RevokedRetry = TimeSpan.FromMinutes(30);

    /// <summary>연결 여부(암호해제) 결과를 재사용하는 시간.</summary>
    private static readonly TimeSpan PairedCacheFor = TimeSpan.FromSeconds(30);

    private readonly DispatcherTimer _timer = new() { Interval = Tick };
    private readonly ServerClock _clock = new();

    private AgentConfig _config;
    private SafePolicy? _policy;
    private string? _policyProblem;
    private bool _fromCache;
    private bool _revoked;
    private bool _polling;
    private bool _disposed;

    /// <summary>연속 인증 거부(401) 횟수. 중간 장비의 401 한 번으로 연결을 포기하지 않기 위해 센다.</summary>
    private int _authFailCount;

    private bool _pairedCache;
    private long _pairedCheckedTick = long.MinValue;

    private DateTimeOffset? _lastServerOkAt;
    private DateTimeOffset? _lastTryAt;
    private DateTimeOffset? _nextPollAt;
    private string? _lastError;

    /// <summary>상태가 달라졌다(화면·트레이가 다시 그릴 때). 화면 스레드에서 온다.</summary>
    public event Action? Changed;

    /// <summary>지금 상태. 화면은 이 값만 읽는다.</summary>
    public AgentStatus Status { get; private set; } = new();

    public PolicyService(AgentConfig config)
    {
        _config = config ?? throw new ArgumentNullException(nameof(config));
        _timer.Tick += (_, _) => OnTick();
    }

    // ── 시작·정지 ───────────────────────────────────────────────────────────

    public void Start()
    {
        // 켜자마자 저장된 설정으로 판정을 시작한다(서버 응답을 기다리는 몇 초 동안 "모름"으로 비어 있지 않게).
        //  ⚠️ 여기서 예외가 올라가면 App.OnStartup의 catch로 떨어져 **앱이 아예 켜지지 않는다**.
        //     이상한 값이 캐시에 한 번 들어가면 손으로 파일을 지울 때까지 영구 부팅 불가가 된다.
        try
        {
            LoadFromCache();
        }
        catch (Exception ex)
        {
            Log.Error("저장된 설정을 불러오지 못했습니다 — 잠그지 않고 시작합니다", ex);
            SetPolicy(null, "저장된 설정을 읽지 못했습니다", fromCache: false);
            PolicyCache.Clear();
        }

        try { Recompute(); }
        catch (Exception ex) { Log.Error("첫 판정 계산 실패 — 잠그지 않고 시작합니다", ex); }

        _timer.Start();
        _ = PollAsync("시작"); // 곧바로 서버에도 물어본다
    }

    public void Stop() => _timer.Stop();

    /// <summary>
    /// 설정 파일을 다시 읽었을 때 같은 값을 쓰도록 맞춘다(서버 주소가 밖에서 바뀌었을 수 있다).
    ///  · 연결 자체가 바뀐 것이 아니므로 서버를 새로 부르지 않는다.
    /// </summary>
    public void UpdateConfig(AgentConfig config)
        => _config = config ?? throw new ArgumentNullException(nameof(config));

    /// <summary>
    /// 연결이 바뀌었다(새로 연결·연결 정보 지움). 상태를 <b>처음부터</b> 다시 잡는다.
    ///
    /// ⚠️ 이 함수의 핵심은 "<b>먼저 전부 비운다</b>"이다.
    ///    같은 윈도우 계정에서 A직원 → B직원으로 다시 연결하는 것은 흔한 일이다(공용 PC).
    ///    비우지 않으면 <b>A의 근무시간·A의 휴무일·A의 승인된 연장근무로 B를 판정</b>하고,
    ///    [서버 연결 확인] 창이 A의 근로 정보를 B에게 그대로 보여준다.
    ///    서버 응답이 오면 교정되지만, 네트워크가 안 되면 교정 시점이 아예 없다.
    ///    비운 직후는 "정책 모름 → 잠그지 않음"이므로 안전한 방향이다(fail-open).
    /// </summary>
    public void NotifyPairingChanged(AgentConfig config)
    {
        _config = config ?? throw new ArgumentNullException(nameof(config));

        _revoked = false;
        _authFailCount = 0;
        _lastError = null;
        _lastServerOkAt = null;
        SetPolicy(null, null, fromCache: false);
        _clock.Reset();
        PolicyCache.Clear();          // 남의 회사 설정을 이 PC에 남겨두지 않는다
        InvalidatePairedCache();

        Recompute();
        if (IsPaired()) _ = PollAsync("연결 변경");
    }

    /// <summary>
    /// 사용자가 [서버 다시 확인]을 눌렀다.
    ///  · 이미 확인 중이면 <c>false</c>를 돌려준다 — 화면이 "먹통"으로 보이지 않게 알려주기 위해서다.
    /// </summary>
    public async Task<bool> RefreshAsync()
    {
        if (_polling) return false;
        await PollAsync("사용자 요청");
        return true;
    }

    // ── 매 10초 ─────────────────────────────────────────────────────────────

    private void OnTick()
    {
        try
        {
            Recompute();

            var due = _nextPollAt == null || DateTimeOffset.Now >= _nextPollAt.Value;

            // 시계가 크게 어긋났다(절전 복귀·시계 조작) → 기다리지 않고 곧바로 기준을 다시 받는다.
            //  · ConsumeDriftSignal은 "읽으면 내려가는" 신호다. 계속 켜져 있으면 폴링이 영구히
            //    10초 주기로 좁혀져 서버를 두드리고 기록이 잡음으로 찬다.
            if (_clock.ConsumeDriftSignal())
            {
                Log.Warn("시각 기준이 어긋나 서버에 다시 물어봅니다(절전 복귀 또는 시계 변경).");
                due = true;
            }

            if (due) _ = PollAsync("주기");
        }
        catch (Exception ex)
        {
            // 시계가 예외로 멈추면 판정이 통째로 죽는다(=아무것도 안 잠긴다). 반드시 붙잡는다.
            Log.Error("판정 주기 처리 중 오류", ex);
        }
    }

    // ── 서버에서 정책 받기 ──────────────────────────────────────────────────

    private async Task PollAsync(string why)
    {
        if (_disposed || _polling) return;

        var token = TokenStore.TryLoad();
        if (token == null)
        {
            // 연결되지 않았거나 열 수 없는 상태 → 서버에 물어볼 수 없다. 잠그지도 않는다.
            SetPolicy(null, null, fromCache: false);
            InvalidatePairedCache();
            _nextPollAt = DateTimeOffset.Now + PollNormal;
            Recompute();
            return;
        }

        _polling = true;
        _lastTryAt = DateTimeOffset.Now;
        Recompute();

        try
        {
            var res = await AgentApi.GetPolicyAsync(_config.ServerUrl, token);

            if (res.Unauthorized)
            {
                HandleUnauthorized();
                return;
            }

            if (!res.Ok || res.Value == null)
            {
                _lastError = Trim(res.Error) ?? "서버에 연결하지 못했습니다.";

                // 서버에 못 붙었을 뿐이다 → 저장된 설정으로 계속 판정한다(오프라인 요구사항).
                //  ⚠️ 이미 유효한 정책을 들고 있어도 **"저장된 설정으로 판단 중"으로 표시**해야 한다.
                //     그러지 않으면 화면이 "퇴근 시간이 지났습니다"와
                //     "설정을 받지 못해 이 PC는 잠기지 않습니다"를 동시에 말하는 거짓말이 된다(검수 지적).
                if (_policy == null) LoadFromCache();
                else SetPolicy(_policy, _policyProblem, fromCache: true);

                Log.Warn($"정책 받기 실패({why}) — 저장된 설정으로 계속 판정합니다.");
                return;
            }

            var policy = res.Value;
            _lastError = null;
            _lastServerOkAt = DateTimeOffset.Now;
            _authFailCount = 0;

            if (_revoked)
            {
                // 관리자가 기기를 되살렸거나, 중간 장비가 내던 401이 사라졌다 → 정상 복귀.
                _revoked = false;
                Log.Info("서버가 이 기기를 다시 받아들였습니다(재연결 없이 복구).");
            }

            if (DateTimeOffset.TryParse(policy.ServerTime, CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var serverTime))
            {
                _clock.Sync(serverTime);
            }

            var before = _policy?.PolicyVersion;
            var safe = PolicySanitizer.Sanitize(policy, out var problem);
            SetPolicy(safe, problem, fromCache: false);

            // 판정에 쓸 수 없는 정책이면 캐시에 넣지 않는다 — 못 쓰는 값을 오프라인에서 다시 꺼내도 소용없다.
            if (safe != null)
            {
                PolicyCache.Save(policy);
                if (before != safe.PolicyVersion)
                {
                    Log.Info($"회사 설정을 받았습니다 (버전 {safe.PolicyVersion}, 잠금대상={safe.Enabled}).");
                }
            }
        }
        catch (Exception ex)
        {
            _lastError = $"확인 중 오류가 발생했습니다. ({ex.GetType().Name})";
            Log.Error($"정책 받기 중 오류({why})", ex);
            if (_policy == null) LoadFromCache();
            else SetPolicy(_policy, _policyProblem, fromCache: true);
        }
        finally
        {
            _polling = false;

            // ⚠️ 주기는 **방금 받은 정책**으로 정해야 한다. Status는 아직 이전 판정이므로 직접 계산한다
            //    (그러지 않으면 잠금 상태로 막 바뀐 순간에도 5분을 기다려 해제 승인이 늦게 반영된다).
            _nextPollAt = DateTimeOffset.Now + ChoosePollInterval(SafeDecide());
            Recompute();
        }
    }

    /// <summary>
    /// 서버가 401을 돌려줬다.
    ///
    /// ⚠️ <b>한 번으로는 확정하지 않는다.</b> 호텔·공항의 로그인 페이지나 사내 프록시 같은 중간 장비가
    ///    아무 요청에나 401을 돌려주는 일이 있다. 한 번에 확정하면 그 순간
    ///    "재연결 필요"로 굳어 <b>사무실에 돌아와도 영원히 잠기지 않는</b> PC가 된다.
    ///  · 그래서 <b>1분 이상 간격으로 두 번</b> 연속 401일 때만 확정한다(실패 시 주기가 1분이므로 자연히 맞다).
    ///  · 확정해도 <b>저장된 설정 파일은 지우지 않는다</b> — 관리자가 기기를 되살리면
    ///    재연결 없이 스스로 복구되어야 하기 때문이다(30분마다 한 번씩 다시 물어본다).
    /// </summary>
    private void HandleUnauthorized()
    {
        _authFailCount++;
        _lastError = "이 PC의 연결이 해제되었거나 만료되었습니다.";

        if (_authFailCount < 2)
        {
            Log.Warn("서버가 인증을 거부했습니다(401). 한 번 더 확인한 뒤 판단합니다.");
            if (_policy != null) SetPolicy(_policy, _policyProblem, fromCache: true);
            return;
        }

        if (!_revoked)
        {
            _revoked = true;
            Log.Warn("서버가 이 기기를 거부했습니다(401 연속). 다시 연결이 필요합니다.");
        }

        // ⚠️ 잠그지 않는 쪽으로 정리한다 — 서버가 "너를 모른다"고 한 이상 판정 근거가 없다.
        SetPolicy(null, null, fromCache: false);
        _clock.Reset();
    }

    /// <summary>다음 확인까지 얼마나 기다릴지. 잠금 중·잠금 임박·실패 상태면 빠르게 확인한다.</summary>
    private TimeSpan ChoosePollInterval(LockDecision decision)
    {
        if (_revoked) return RevokedRetry;         // 거부된 기기 → 드물게, 그래도 포기하지 않는다
        if (_lastError != null) return PollFast;   // 실패 → 빨리 복구
        if (decision.ShouldLock) return PollFast;  // 잠금 중 → 해제(승인)를 빨리 반영
        if (_fromCache) return PollFast;           // 저장된 설정으로 버티는 중

        var remaining = decision.Remaining;
        if (remaining.HasValue && remaining.Value <= SoonWindow) return PollFast; // 잠금 임박

        return PollNormal;
    }

    /// <summary>정책·문제·출처를 <b>한 번에</b> 정한다(따로 바꾸면 화면이 서로 어긋난 말을 하게 된다).</summary>
    private void SetPolicy(SafePolicy? policy, string? problem, bool fromCache)
    {
        _policy = policy;
        _policyProblem = policy == null ? problem : null; // 쓸 수 있는 정책이 있으면 "이상 있음"이라고 말하지 않는다
        _fromCache = policy != null && fromCache;
    }

    /// <summary>판정. 어떤 값이 들어와도 예외로 죽지 않게 감싼다(죽으면 아무것도 잠기지 않는다).</summary>
    private LockDecision SafeDecide()
    {
        try
        {
            return LockDecider.Decide(_policy, _clock.Now);
        }
        catch (Exception ex)
        {
            Log.Error("판정 계산 중 오류 — 잠그지 않습니다", ex);
            return LockDecision.NoLock(LockReason.PolicyUnknown);
        }
    }

    /// <summary>서버가 보낸 문구를 화면에 쓸 만큼만 자른다(가짜 서버가 긴 안내문을 띄우는 것을 막는다).</summary>
    private static string? Trim(string? s)
    {
        var v = (s ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
        if (v.Length == 0) return null;
        return v.Length <= 200 ? v : v[..200] + "...";
    }

    // ── 저장된 설정 불러오기 ────────────────────────────────────────────────

    private void LoadFromCache()
    {
        var cached = PolicyCache.TryLoad();
        if (cached == null)
        {
            SetPolicy(null, null, fromCache: false);
            return;
        }

        var safe = PolicySanitizer.Sanitize(cached.Policy, out var problem);
        if (safe == null)
        {
            // 저장된 값도 못 쓴다 → 지운다(계속 실패 기록만 쌓이는 것을 막는다).
            SetPolicy(null, problem, fromCache: false);
            PolicyCache.Clear();
            return;
        }

        SetPolicy(safe, null, fromCache: true);

        if (DateTimeOffset.TryParse(cached.Policy.ServerTime, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var serverTime))
        {
            _clock.SyncFromCache(serverTime, cached.SavedWallUtc);
        }
    }

    // ── 연결 여부 (값싸게 확인) ─────────────────────────────────────────────

    /// <summary>
    /// 이 PC가 연결되어 있는지. 결과를 <see cref="PairedCacheFor"/> 동안 재사용한다.
    ///  · ⚠️ 왜 캐시하는가: 확인 한 번마다 윈도우 암호해제(DPAPI)가 돌고, 실패하면
    ///    <see cref="TokenStore"/>가 토큰 파일을 지운다. 10초마다 그대로 부르면 하루 8,600번이 되어
    ///    로그오프 같은 순간의 일시적 실패 한 번으로 <b>연결이 끊기는</b> 사고 확률이 그만큼 커진다.
    /// </summary>
    private bool IsPaired()
    {
        var now = Environment.TickCount64;
        if (_pairedCheckedTick != long.MinValue && now - _pairedCheckedTick < PairedCacheFor.TotalMilliseconds)
        {
            return _pairedCache;
        }

        _pairedCache = TokenStore.IsUsable();
        _pairedCheckedTick = now;
        return _pairedCache;
    }

    /// <summary>다음 확인 때 실제로 파일을 다시 보게 한다(연결이 바뀐 직후에 부른다).</summary>
    private void InvalidatePairedCache() => _pairedCheckedTick = long.MinValue;

    // ── 판정 다시 계산 ──────────────────────────────────────────────────────

    private void Recompute()
    {
        var paired = IsPaired();

        // 일시사용은 2-C에서 채워진다. 지금은 항상 null(=쓰는 중이 아님).
        var decision = paired
            ? SafeDecide()
            : LockDecision.NoLock(LockReason.NotPaired, _clock.Now);

        var before = Status;
        Status = new AgentStatus
        {
            Paired = paired,
            Revoked = _revoked,
            FromCache = _fromCache,
            Policy = _policy,
            Decision = decision,
            LastServerOkAt = _lastServerOkAt,
            LastTryAt = _lastTryAt,
            LastError = _lastError,
            PolicyProblem = _policyProblem,
            NextPollAt = _nextPollAt,
            Checking = _polling,
        };

        // 판정이 실제로 바뀐 순간만 기록에 남긴다(10초마다 같은 줄을 쌓지 않게).
        if (!decision.SameStateAs(before.Decision))
        {
            var changeText = decision.ChangeAt.HasValue
                ? $" (다음 변화 {decision.ChangeAt.Value.LocalDateTime:MM-dd HH:mm})"
                : "";
            Log.Info($"판정: {(decision.ShouldLock ? "잠금" : "사용 가능")} — {decision.Reason}{changeText}");
        }

        Changed?.Invoke();
    }

    public void Dispose()
    {
        _disposed = true;
        _timer.Stop();
    }
}
