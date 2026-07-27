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

    /// <summary>사건이 생기면 이만큼 뒤에 서버로 보낸다(잠금·해제가 5분 늦게 보고되지 않게).</summary>
    private static readonly TimeSpan EventSendSoon = TimeSpan.FromSeconds(15);

    // 인터넷이 끊긴 동안의 [일시사용] 하루 한도는 **서버가 정해서 내려준다**(SafePolicy.OfflineTempUsePerDay).
    //  · 여기에 숫자를 적어 두지 않는 이유: 같은 값을 두 곳에 적으면 언젠가 어긋나고, 어긋나도 아무도 모른다.
    //  · 왜 넉넉하게 주나(사장님 결정 2026-07-27 B): 인터넷이 없으면 [연장근무 신청]을 할 수 없어
    //    회사 한도(예: 2회)를 다 쓴 순간 직원이 다음 근무일까지 PC에 갇힌다(외근·출장).
    //  · 왜 무제한이 아닌가: 무제한이면 랜선을 뽑는 것만으로 잠금이 사실상 없어진다.

    /// <summary>[일시사용] 기록 종류 — 서버의 <c>ALLOWED_TYPES</c>와 같은 글자여야 한다(다르면 기록이 버려진다).</summary>
    private const string TempUseType = "temp_use";
    private const string TempUseOfflineType = "temp_use_offline";

    private readonly DispatcherTimer _timer = new() { Interval = Tick };
    private readonly ServerClock _clock = new();

    /// <summary>아직 서버로 보내지 못한 사건(잠금·해제·일시사용) 대기줄.</summary>
    private readonly EventQueue _events = new();

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

    /// <summary>
    /// [일시사용]이 끝나는 시각. 쓰는 중이 아니면 <c>null</c>.
    ///  · ⚠️ <b>메모리에만</b> 둔다(파일에 저장하지 않는다). 앱을 껐다 켜면 일시사용은 사라지고 다시 잠긴다.
    ///    파일에 두면 직원이 그 파일을 고쳐 잠금을 영구히 푸는 통로가 되기 때문이다.
    ///    "다시 잠기는 쪽"이 안전한 방향이고, 쓴 횟수는 서버가 세므로 껐다 켜도 되돌려지지 않는다.
    /// </summary>
    private DateTimeOffset? _tempUseUntil;

    /// <summary>
    /// 쓴 [일시사용] 횟수 중 <b>서버가 아직 세지 못한</b> 것.
    ///  · 서버의 <c>usedToday</c>는 사건이 서버에 닿아야 올라간다. 그 사이에 다시 누르면
    ///    하루 1회 제한이 2회가 되어 버리므로, 도착이 확인될 때까지 여기서 함께 센다.
    ///  · ⚠️ 앱을 껐다 켜도 이어져야 한다 — 아니면 랜선을 뽑고 재시작하는 것만으로
    ///    하루 제한을 무한히 넘길 수 있다(검수 치명 C-2). 그래서 시작할 때
    ///    <b>아직 못 보낸 기록</b>에서 오늘치를 세어 채운다(새 파일 없이 이미 있는 대기줄을 쓴다).
    /// </summary>
    private int _tempUsedLocal;

    /// <summary>
    /// 오늘 <b>인터넷이 끊긴 동안</b> 쓴 [일시사용] 횟수.
    ///  · 서버는 이 사용분을 <b>세지 않는다</b>(일부러 그렇게 뒀다 — 그래야 금요일 밤 사용분이
    ///    월요일 몫을 잡아먹지 않는다). 그래서 하루 한도는 <b>앱이 끝까지 센다</b>.
    ///  · <see cref="_tempUsedLocal"/>과 달리 서버 응답으로 <b>줄어들지 않는다</b>.
    ///    줄이면 랜선을 뽑았다 꽂기를 반복하는 것만으로 한도를 계속 새로 받게 된다.
    ///  · 앱을 껐다 켤 때는 아직 못 보낸 기록에서 이어서 센다(<see cref="Start"/>).
    /// </summary>
    private int _tempUsedOfflineLocal;

    /// <summary>위 두 횟수가 어느 날짜의 값인지(날이 바뀌면 0으로 되돌린다).</summary>
    private DateOnly _tempUsedDate;

    private bool _flushing;

    /// <summary>연속 전송 실패 횟수(계속 실패하는데 1분마다 두드리지 않기 위해 센다).</summary>
    private int _flushFailCount;

    /// <summary>
    /// 지금은 사건을 기록하지 않는다(연결이 바뀌는 중).
    ///  · A직원 → B직원으로 다시 연결하면 A의 잠금을 푸는 "해제" 기록이 <b>B의 근로기록</b>으로
    ///    올라간다(B는 잠긴 적이 없다). 전환 중에는 아예 남기지 않는다(검수 중간 M-2).
    /// </summary>
    private bool _suppressEvents;

    /// <summary>
    /// 마지막 서버 확인이 <b>통신 자체가 안 돼서</b> 실패했는가(HTTP 상태 0 = 연결 불가·응답 없음).
    ///  · ⚠️ 이 구분이 중요하다: 401·403·5xx는 <b>서버가 대답한 것</b>이므로 인터넷은 멀쩡하다.
    ///    그것까지 "오프라인"으로 보면, 사무실 책상에서 누른 [일시사용]이 <b>"오프라인 사용"으로 기록</b>되고
    ///    (없는 사실을 만드는 것), 서버 장애 때 전 직원의 오프라인 한도가 한꺼번에 열린다(검수 지적 M-1).
    /// </summary>
    private bool _noContact;

    /// <summary>서버·앱의 날짜가 어긋난다는 경고를 이미 남겼는가(5분마다 같은 줄을 쌓지 않기 위해).</summary>
    private bool _dateMismatchLogged;

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

        // 아직 못 보낸 기록에서 오늘 쓴 [일시사용] 횟수를 이어받는다(껐다 켜기로 우회하지 못하게).
        try
        {
            _tempUsedDate = CompanyToday();
            _tempUsedLocal = _events.CountOn(TempUseType, _tempUsedDate, Hm.CompanyOffset);
            // ⚠️ 오프라인 횟수는 대기줄만 세면 안 된다 — 서버로 보낸 순간 지워져 한도가 되살아난다(재검수 N-2).
            //    따로 보관해 둔 값과 대기줄 값 중 **큰 쪽**을 쓴다(둘 중 하나만 남아 있어도 이어서 센다).
            _tempUsedOfflineLocal = Math.Max(
                OfflineUsageStore.Load(_tempUsedDate),
                _events.CountOn(TempUseOfflineType, _tempUsedDate, Hm.CompanyOffset));
            if (_tempUsedLocal + _tempUsedOfflineLocal > 0)
            {
                Log.Info($"아직 서버에 닿지 않은 오늘 일시사용 {_tempUsedLocal}회(오프라인 {_tempUsedOfflineLocal}회)를 이어서 셉니다.");
            }
        }
        catch (Exception ex)
        {
            Log.Warn($"일시사용 사용 횟수를 이어받지 못했습니다: {ex.GetType().Name}");
        }

        try { Recompute(); }
        catch (Exception ex) { Log.Error("첫 판정 계산 실패 — 잠그지 않고 시작합니다", ex); }

        _timer.Start();
        _ = PollAsync("시작"); // 곧바로 서버에도 물어본다
    }

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
        _noContact = false;
        _lastServerOkAt = null;
        _tempUseUntil = null;         // A직원이 받은 일시사용이 B직원에게 이어지면 안 된다
        _tempUsedLocal = 0;
        _tempUsedOfflineLocal = 0;
        _tempUsedDate = default;
        SetPolicy(null, null, fromCache: false);
        _clock.Reset();
        PolicyCache.Clear();          // 남의 회사 설정을 이 PC에 남겨두지 않는다
        _events.Clear();              // 남의 계정으로 남의 기록을 올리지 않는다
        InvalidatePairedCache();

        // ⚠️ 아래 Recompute()는 잠금화면을 닫게 만들고, 그 과정에서 "해제" 기록이 생긴다.
        //    방금 비운 대기줄에 그 기록이 들어가면 **A의 해제가 B의 근로기록으로** 올라간다.
        //    전환이 끝날 때까지 기록을 막는다(검수 중간 M-2).
        //    ⚠️ 여기서 예외가 새어 나가면 아래 첫 확인(PollAsync)이 건너뛰어져, 방금 연결한 PC가
        //       모든 것이 비워진 반쪽 상태로 남는다. 다른 Recompute 호출부와 같게 붙잡는다.
        _suppressEvents = true;
        try { Recompute(); }
        catch (Exception ex) { Log.Error("연결 변경 후 판정 계산 실패 — 잠그지 않고 계속합니다", ex); }
        finally { _suppressEvents = false; }

        // ⚠️ 오프라인 사용 횟수 파일은 **Recompute 뒤에** 지운다.
        //    앞에서 지우면 Recompute의 날짜 정리(EnsureToday)가 곧바로 파일을 다시 만들어,
        //    "연결을 바꾸면 지워진다"는 말이 거짓이 된다(재검수 R-4).
        //    A직원이 쓴 오프라인 횟수를 B직원이 물려받지 않게 하는 것이 목적이다.
        OfflineUsageStore.Clear();

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

    // ── 사건 기록 (잠금·해제·사전알림·일시사용) ─────────────────────────────

    /// <summary>
    /// 일어난 일을 기록해 둔다(보내기는 이 함수가 하지 않는다 — 대기줄에 세우기만 한다).
    ///  · ⚠️ 서버가 <b>이 기록이 오는지</b>로 "앱을 끈 PC"를 찾아낸다(webapp/lib/pcoff-alert.ts).
    ///    그래서 기록을 남기는 일은 화면을 잠그는 일만큼 중요하다.
    /// </summary>
    public void EnqueueEvent(string type, DateTimeOffset at, string? meta = null)
    {
        if (_suppressEvents)
        {
            Log.Info($"연결이 바뀌는 중이라 기록({type})을 남기지 않습니다.");
            return;
        }

        try
        {
            _events.Enqueue(type, at, meta);

            // 평상시 확인 주기는 5분이다. 그대로 두면 방금 잠근 사실이 최대 5분 뒤에야 서버에 닿는다.
            //  · 서버 감시가 "퇴근+유예+여유 30분"으로 판단하므로 5분이 치명적이진 않지만,
            //    관리자가 [PC관리]를 열었을 때 방금 일을 못 보는 것은 이상하다 → 곧 보내도록 당긴다.
            var soon = DateTimeOffset.Now + EventSendSoon;
            if (_nextPollAt == null || _nextPollAt.Value > soon) _nextPollAt = soon;
        }
        catch (Exception ex)
        {
            // 기록에 실패해도 잠금은 계속돼야 한다.
            Log.Error($"기록을 남기지 못했습니다({type})", ex);
        }
    }

    /// <summary>대기줄에 쌓인 것을 지금 보낸다(성공한 것만 지운다).</summary>
    private async Task FlushEventsAsync(string token)
    {
        if (_flushing || _events.Count == 0) return;
        _flushing = true;
        try
        {
            // 한 번에 다 보내지 않고 묶음 단위로 보낸다(서버 상한 100건 · 본문 크기 제한).
            //  · 여러 묶음이 밀려 있으면 다음 주기에 이어서 보낸다 — 한 번에 몰아치지 않는다.
            var batch = _events.Peek();
            if (batch.Length == 0) return;

            // ⚠️ ConfigureAwait(false) 금지 — 이 뒤의 처리가 화면 스레드로 돌아와야 한다(위 설명 참조).
            var res = await AgentApi.PostEventsAsync(_config.ServerUrl, token, batch);
            if (!res.Ok || res.Value == null)
            {
                _flushFailCount++;

                // ⚠️ 여기서 "4xx면 버린다"로 넓게 잡으면 **정상 기록이 대량으로 사라진다.**
                //    사내 프록시(407)·공용 와이파이 로그인 페이지(403)·서버 주소 오타(404)는
                //    전부 4xx인데, 그 순간 며칠치 잠금 기록이 영구 소실된다(재검수 치명 C-3).
                //    그래서 **400(형식 오류)만**, 그것도 **세 번 연속 같은 실패일 때만** 버린다.
                //    그리고 묶음 전체가 아니라 **맨 앞 한 건만** 버린다 — 나머지 멀쩡한 기록을 지키기 위해서다.
                if (res.Status == 400 && _flushFailCount >= 3)
                {
                    _events.Remove([batch[0]]);
                    _flushFailCount = 0;
                    Log.Error($"서버가 기록 1건을 계속 거부해(HTTP 400) 그 한 건만 버립니다 — 나머지는 그대로 다시 보냅니다.");
                    return;
                }

                Log.Warn($"기록 {batch.Length}건을 보내지 못했습니다({_flushFailCount}번째, HTTP {res.Status}) — 다음에 다시 보냅니다.");
                return;
            }

            // 서버가 받아들였다(저장·중복·버림 모두 "처리됨"이다) → 지운다.
            //  · 버려진 건(모르는 종류·말이 안 되는 시각)을 남겨두면 영원히 다시 보내게 된다.
            _flushFailCount = 0;
            _events.Remove(batch);
            var v = res.Value;
            Log.Info($"기록 {batch.Length}건 전송 (저장 {v.Saved} · 중복 {v.Duplicated} · 제외 {v.Dropped}).");

            // 방금 보낸 기록은 **이번 정책 응답에는 반영돼 있지 않다**(서버가 답할 때는 아직 도착 전이었다).
            //  · 그대로 두면 다음 확인(최대 5분)까지 서버가 센 오프라인 횟수가 옛 값(대개 0)으로 남는다.
            //    그 틈에 앱을 껐다 켜면 한도가 되살아난다(재검수 N-2). 곧바로 다시 물어 최신 값을 받아 둔다.
            //  · ⚠️ **오프라인 일시사용이 들어 있는 묶음일 때만** 당긴다. 모든 묶음에 걸면 한 달치 백로그를
            //    비울 때 정책 조회가 수십 번 몰린다(연휴 뒤 아침에 여러 대가 동시에 돌아오면 부담 — 재검수 R-5).
            if (Array.Exists(batch, e => string.Equals(e.Type, TempUseOfflineType, StringComparison.Ordinal)))
            {
                var soon = DateTimeOffset.Now + TimeSpan.FromSeconds(5);
                if (_nextPollAt == null || _nextPollAt.Value > soon) _nextPollAt = soon;
            }

            // ⚠️ "제외"는 서버가 그 기록을 **버렸다**는 뜻이고, 우리는 방금 그것을 지웠다 = 영원히 사라졌다.
            //    옛 서버로 되돌아갔거나(모르는 종류) 시각이 너무 오래된 경우인데, 잠금·해제는 근로시간 근거다.
            //    조용히 넘기면 아무도 모르므로 경고로 남긴다(검수 지적 M-8).
            if (v.Dropped > 0)
            {
                Log.Warn($"서버가 기록 {v.Dropped}건을 받지 않았습니다(되돌릴 수 없음). " +
                         "서버 버전이 앱보다 낮거나, 기록이 너무 오래됐을 수 있습니다.");
            }
        }
        catch (Exception ex)
        {
            Log.Error("기록 전송 중 오류", ex);
        }
        finally
        {
            _flushing = false;
        }
    }

    // ── [일시사용] ──────────────────────────────────────────────────────────

    /// <summary>[일시사용]을 지금 더 쓸 수 있는가(서버가 센 횟수 + 아직 못 보낸 횟수).</summary>
    public bool CanUseTemp => TempUseLeft > 0;

    /// <summary>
    /// 지금 <b>인터넷이 끊긴 상태</b>인가(= 서버에 닿지도 못한다).
    ///  · 판단: 저장된 설정으로 버티는 중(<see cref="_fromCache"/>) <b>그리고</b> 마지막 확인이 통신 실패(<see cref="_noContact"/>).
    ///  · ⚠️ <c>_fromCache</c>만 보면 안 된다 — 앱을 막 켠 순간(첫 확인의 응답을 기다리는 몇 초)에도 참이다.
    ///  · ⚠️ "실패했다"만 봐도 안 된다 — 401·5xx는 서버가 대답한 것이라 인터넷은 멀쩡하다(위 <see cref="_noContact"/> 설명).
    /// </summary>
    public bool IsOffline => _fromCache && _noContact;

    /// <summary>
    /// 오프라인일 때 이 회사가 허용한 하루 한도(회). 0이면 오프라인 확장 없음.
    ///  · 값은 <b>서버가 정해서 내려준다</b>. 옛 서버는 이 값을 주지 않으므로 0 → 옛 동작 그대로 간다.
    /// </summary>
    private int OfflinePerDay => _policy?.OfflineTempUsePerDay ?? 0;

    /// <summary>
    /// 오늘 오프라인에서 쓴 횟수. <b>서버가 센 값과 앱이 센 값 중 큰 쪽</b>을 쓴다.
    ///  · 🔴 앱이 센 값만 쓰면, 기록을 서버로 보낸 뒤 앱을 껐다 켜는 것만으로 한도가 되살아난다
    ///    (검수 치명 C-1). 그래서 서버가 함께 센다.
    ///  · 서버 값만 쓰면 오프라인 중에는 갱신이 없어 무제한이 된다. 그래서 <b>큰 쪽</b>이다.
    ///  · 🔴 서버 값은 <b>그 날짜가 오늘일 때만</b> 쓴다. 인터넷이 끊긴 채 자정을 넘기면 서버 값은
    ///    어제 것으로 굳어 있는데, 그걸 오늘 것으로 알고 깎으면 <b>한 번도 안 쓴 날에 "다 썼습니다"</b>가 되어
    ///    직원이 최대 한 달간 갇힌다(재검수 치명 N-1).
    /// </summary>
    private int OfflineUsedToday
    {
        get
        {
            var p = _policy;
            var serverSaysToday = p != null && p.OfflineTempUsedDate == CompanyToday();
            var server = serverSaysToday ? p!.OfflineTempUsedToday : 0;
            return Math.Max(server, _tempUsedOfflineLocal);
        }
    }

    /// <summary>
    /// 지금 <b>오프라인 몫</b>을 쓰는 상황인가.
    ///  · 인터넷이 끊겼고, <b>서버가 오프라인 한도를 내려준 경우</b>에만 참이다.
    ///  · ⚠️ 서버가 안 내려주면(옛 서버로 되돌아갔을 때) 오프라인이어도 <b>기존 방식(온라인 몫)</b>으로 간다.
    ///    그래야 ①옛 서버에서도 직원이 갇히지 않고 ②옛 서버가 모르는 기록 종류를 보내
    ///    <b>조용히 버려지는 일</b>이 없다(검수 지적 M-8).
    /// </summary>
    public bool UsingOfflineQuota => IsOffline && OfflinePerDay > 0;

    /// <summary>지금 기준의 [일시사용] 하루 한도(화면 표시용). 오프라인이면 회사가 허용한 오프라인 한도.</summary>
    public int TempUsePerDayNow
    {
        get
        {
            var p = _policy;
            if (p == null || !p.Enabled || p.TempUseMinutes <= 0 || p.TempUsePerDay <= 0) return 0;
            return UsingOfflineQuota ? OfflinePerDay : p.TempUsePerDay;
        }
    }

    /// <summary>
    /// 오늘 남은 [일시사용] 횟수.
    ///
    /// <b>지갑이 두 개다</b>(온라인 몫 / 오프라인 몫). 나눈 이유는 서버의 "오늘 쓴 횟수"가 오프라인분을 빼고 세기 때문이다
    /// (같이 세면 뒤늦게 올라온 기록이 다음 날 몫을 잡아먹는다). 그래서 각자 자기 한도 안에서만 쓴다.
    ///  · 온라인 몫 = 회사 설정 − 서버가 센 오늘 사용 − 아직 못 보낸 온라인 사용
    ///  · 오프라인 몫 = 서버가 허용한 오프라인 한도 − <see cref="OfflineUsedToday"/>(서버·앱 중 큰 쪽)
    /// ⚠️ 회사가 일시사용을 아예 안 쓰기로 했으면(<c>TempUsePerDay = 0</c>) 오프라인에서도 주지 않는다 —
    ///    회사 정책을 앱이 뒤집으면 안 된다. 그 경우 잠금은 [연장근무 신청]으로만 풀린다.
    /// </summary>
    public int TempUseLeft
    {
        get
        {
            var p = _policy;
            if (p == null || !p.Enabled || p.TempUseMinutes <= 0 || p.TempUsePerDay <= 0) return 0;

            var left = UsingOfflineQuota
                ? OfflinePerDay - OfflineUsedToday
                : p.TempUsePerDay - p.TempUsedToday - _tempUsedLocal;

            return left > 0 ? left : 0;
        }
    }

    /// <summary>
    /// [일시사용]을 시작한다. 성공하면 그 시간 동안 잠기지 않는다.
    ///  · 사유는 <b>회사가 정한 목록의 값</b>만 받는다(자유입력 금지 — 민감정보 유입 차단).
    /// </summary>
    public bool TryStartTempUse(string? reason, out string error)
    {
        error = "";

        // 자정을 막 넘겼을 수 있다 — 아래 판정과 저장이 **같은 날짜**를 쓰도록 먼저 맞춘다(재검수 R-3).
        EnsureToday();
        var p = _policy;
        if (p == null || !p.Enabled)
        {
            error = "회사 설정을 받지 못해 지금은 사용할 수 없습니다.";
            return false;
        }
        if (p.TempUseMinutes <= 0)
        {
            error = "회사가 일시사용을 허용하지 않았습니다.";
            return false;
        }
        if (TempUseLeft <= 0)
        {
            // ⚠️ 회사 설정값이 아니라 **지금 기준의 한도**를 말한다(오프라인이면 넉넉한 쪽).
            //    그러지 않으면 "2회를 다 썼습니다"라고 하면서 실제로는 6회까지 되던 상태가 되어 화면이 거짓말을 한다.
            error = UsingOfflineQuota
                ? $"인터넷이 끊긴 동안 쓸 수 있는 횟수({TempUsePerDayNow}회)를 모두 썼습니다."
                : $"오늘 사용할 수 있는 횟수({TempUsePerDayNow}회)를 모두 썼습니다.";
            return false;
        }

        var now = _clock.Now;
        if (now == null)
        {
            // 기준 시각을 모르면 언제 끝나는지도 정할 수 없다 → 시작하지 않는다.
            error = "서버 시각을 확인하지 못했습니다. [서버 다시 확인]을 눌러주세요.";
            return false;
        }

        // 사유는 **회사가 정한 목록의 값**만 받는다(지시서 §5: 일시사용은 사유 필수).
        //  · 목록에 없는 값이면 시작하지 않는다 — 서버는 그런 값을 저장하지 않으므로,
        //    그대로 진행하면 "사유 없는 일시사용"이 만들어진다.
        var picked = reason;
        if (p.TempReasons.Length > 0 && (picked == null || Array.IndexOf(p.TempReasons, picked) < 0))
        {
            error = "회사가 정한 사유 중에서 골라주세요.";
            return false;
        }
        if (p.TempReasons.Length == 0)
        {
            error = "회사가 일시사용 사유 목록을 정하지 않아 사용할 수 없습니다. 관리자에게 문의해주세요.";
            return false;
        }

        // ⚠️ 지갑을 고르는 이 한 줄이 "다음 날 몫 보호"의 전부다 —
        //    종류를 나눠 기록하면 서버가 오프라인분을 세지 않으므로, 뒤늦게 올라와도 다음 날 한도를 깎지 않는다.
        //    (여기서 IsOffline을 한 번만 읽는다: 아래 기록과 카운터가 서로 다른 지갑을 가리키면 한도가 새 버린다.)
        var offline = UsingOfflineQuota;
        _tempUseUntil = now.Value.AddMinutes(p.TempUseMinutes);
        if (offline)
        {
            _tempUsedOfflineLocal++;
            // 대기줄과 별개로 즉시 남긴다 — 전송에 성공해 대기줄이 비어도 오늘 쓴 횟수는 남아야 한다.
            OfflineUsageStore.Save(_tempUsedDate, _tempUsedOfflineLocal);
        }
        else _tempUsedLocal++;
        EnqueueEvent(offline ? TempUseOfflineType : TempUseType, now.Value, picked);

        Log.Info($"일시사용 시작 — {p.TempUseMinutes}분{(offline ? " (인터넷 끊김 상태)" : "")} (남은 횟수 {TempUseLeft}회).");
        Recompute();

        // 서버에 곧바로 알린다(횟수를 서버가 세야 앱을 다시 깔아도 우회되지 않는다).
        _ = PollAsync("일시사용");
        return true;
    }

    // ── 연장근무 신청 (잠금화면에서) ────────────────────────────────────────

    /// <summary>
    /// 잠금화면에서 낸 연장근무 신청을 서버로 보낸다.
    ///  · 승인은 웹에서 관리자가 한다. 승인되면 다음 확인(최대 1분) 때 자동으로 풀린다.
    /// </summary>
    public async Task<(bool ok, string message)> SubmitOvertimeAsync(
        string targetDate, string startTime, string endTime, string? reason)
    {
        var token = TokenStore.TryLoad();
        if (token == null) return (false, "이 PC가 연결되어 있지 않습니다.");

        try
        {
            var res = await AgentApi.PostOvertimeAsync(_config.ServerUrl, token, targetDate, startTime, endTime, reason)
                .ConfigureAwait(true);

            if (!res.Ok || res.Value == null)
            {
                return (false, res.Error ?? "신청하지 못했습니다. 잠시 후 다시 시도해주세요.");
            }

            // 승인되면 빨리 풀리도록 곧바로 다시 확인한다.
            _ = PollAsync("연장근무 신청");

            return res.Value.Duplicated
                ? (true, "이미 같은 신청이 접수돼 있습니다. 관리자 승인을 기다려주세요.")
                : (true, "신청했습니다. 관리자가 승인하면 1분 안에 자동으로 풀립니다.");
        }
        catch (Exception ex)
        {
            Log.Error("연장근무 신청 중 오류", ex);
            return (false, $"신청 중 오류가 발생했습니다. ({ex.GetType().Name})");
        }
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

        // ⚠️ 서버가 세는 [일시사용] 횟수(usedToday)는 **이 요청보다 먼저 도착한 사건**만 반영한다.
        //    그래서 "지금 대기줄이 비어 있었다"는 사실과 **그때까지 따로 세던 횟수**를 함께 기억해 둔다.
        //    응답이 오면 그 횟수만큼만 뺀다 — 통째로 0으로 만들면, 서버를 기다리는 사이(최대 15초)에
        //    직원이 누른 [일시사용] 한 번이 없던 일이 되어 하루 제한이 한 번 늘어난다(재검수 중간 M-1).
        var queueWasEmpty = _events.Count == 0;
        var tempUsedAtRequest = _tempUsedLocal;

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
                // 상태 0 = 서버에 닿지도 못했다(연결 불가) = 진짜 오프라인.
                //  · 4xx·5xx는 서버가 대답한 것이므로 오프라인이 아니다(그때 오프라인 한도를 열면 안 된다).
                //  · ⚠️ **시간 초과는 제외한다** — "서버에 닿았는데 느린 것"이므로 인터넷은 멀쩡하다.
                //    이걸 오프라인으로 보면 서버가 무거운 날 사무실 PC들이 일제히 오프라인 판정이 되어,
                //    책상에서 누른 일시사용이 "오프라인 사용"으로 기록된다(재검수 N-3).
                _noContact = res.Status == 0 && !res.TimedOut;

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
            _noContact = false; // 방금 서버와 통했다
            _lastServerOkAt = DateTimeOffset.Now;
            _authFailCount = 0;
            // 서버가 이미 세어 준 만큼만 뺀다(그 사이에 새로 누른 것은 그대로 남긴다).
            if (queueWasEmpty) _tempUsedLocal = Math.Max(0, _tempUsedLocal - tempUsedAtRequest);

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

            // ⚠️ 서버가 말하는 "오늘"과 앱이 보는 "오늘"이 다르면, 오프라인 사용 횟수 방어가 조용히 꺼진다
            //    (그 숫자는 날짜가 오늘일 때만 쓰기 때문). 가장 흔한 원인은 **서버를 UTC로 배포한 것**이다.
            //    강제로 고칠 수는 없으니, 무증상으로 넘어가지 않게 한 번은 남긴다(재검수 R-2).
            if (safe != null && safe.OfflineTempUsedDate != null && safe.OfflineTempUsedDate != CompanyToday()
                && !_dateMismatchLogged)
            {
                _dateMismatchLogged = true;
                Log.Warn($"서버가 말하는 날짜({safe.OfflineTempUsedDate:yyyy-MM-dd})와 앱이 보는 날짜({CompanyToday():yyyy-MM-dd})가 다릅니다. " +
                         "서버 시간대(Asia/Seoul) 설정을 확인해야 합니다.");
            }

            // 판정에 쓸 수 없는 정책이면 캐시에 넣지 않는다 — 못 쓰는 값을 오프라인에서 다시 꺼내도 소용없다.
            if (safe != null)
            {
                PolicyCache.Save(policy);
                if (before != safe.PolicyVersion)
                {
                    Log.Info($"회사 설정을 받았습니다 (버전 {safe.PolicyVersion}, 잠금대상={safe.Enabled}).");
                }
            }

            // 서버와 통신이 되는 것을 방금 확인했다 → 못 보낸 기록을 이 기회에 올린다.
            //  · 통신이 안 될 때는 시도하지 않는다(같은 실패를 두 번 겪을 필요가 없다).
            //  · ⚠️ 여기서 ConfigureAwait(false)를 쓰면 안 된다 — 아래 finally의 Recompute()가
            //    화면 스레드 밖에서 돌게 되어, 이 값을 받아 그리는 트레이·잠금화면이 통째로 예외로 죽는다
            //    (실기기 검증에서 실제로 발생: "잠금 처리 중 오류 :: InvalidOperationException").
            await FlushEventsAsync(token);
        }
        catch (Exception ex)
        {
            _lastError = $"확인 중 오류가 발생했습니다. ({ex.GetType().Name})";
            // ⚠️ 여기 오는 것은 통신 실패가 아니다 — AgentApi가 통신 예외를 이미 다 처리하므로,
            //    이 catch는 **응답을 받은 뒤** 처리(검증·시계·캐시)에서 터진 경우다. 오프라인이 아니다(재검수 N-3).
            _noContact = false;
            Log.Error($"정책 받기 중 오류({why})", ex);
            if (_policy == null) LoadFromCache();
            else SetPolicy(_policy, _policyProblem, fromCache: true);
        }
        finally
        {
            _polling = false;

            // ⚠️ 주기는 **방금 받은 정책**으로 정해야 한다. Status는 아직 이전 판정이므로 직접 계산한다
            //    (그러지 않으면 잠금 상태로 막 바뀐 순간에도 5분을 기다려 해제 승인이 늦게 반영된다).
            var next = DateTimeOffset.Now + ChoosePollInterval(SafeDecide());

            // ⚠️ 이 폴링이 도는 사이에 사건이 생겨 "15초 뒤에 보내자"고 당겨 놨을 수 있다.
            //    여기서 그냥 덮어쓰면 그 약속이 1분·5분으로 밀린다(재검수 중간 M-10). 더 이른 쪽을 남긴다.
            _nextPollAt = _nextPollAt is { } pending && pending > DateTimeOffset.Now && pending < next
                ? pending
                : next;
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
        _noContact = false; // 서버가 401로 **대답한 것** — 인터넷은 멀쩡하다(오프라인 한도를 열면 안 된다)

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
        // 못 보낸 기록이 남았다 → 빨리 마저 보낸다.
        //  · 다만 계속 실패하는 중이라면 1분마다 두드리지 않는다(하루 1,440번 헛수고 방지).
        if (_events.Count > 0) return _flushFailCount >= 5 ? PollNormal : PollFast;
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
            return LockDecider.Decide(_policy, _clock.Now, _tempUseUntil);
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

    /// <summary>회사 기준 오늘 날짜(서버 시각 기준을 알면 그것으로, 모르면 이 PC 시계로).</summary>
    private DateOnly CompanyToday()
        => DateOnly.FromDateTime((_clock.Now ?? DateTimeOffset.Now).ToOffset(Hm.CompanyOffset).DateTime);

    /// <summary>
    /// 날이 바뀌었으면 오늘치 사용 횟수를 0으로 되돌린다(새 날 = 새 허용량).
    ///  · ⚠️ 판정(<see cref="Recompute"/>)과 실제 사용(<see cref="TryStartTempUse"/>) <b>양쪽 첫머리</b>에서 부른다.
    ///    한쪽만 부르면 자정 직후 10초 사이에 "판정은 새 날, 저장은 어제 날짜"로 갈려
    ///    방금 쓴 1회가 파일에서 사라진다(재검수 R-3).
    ///  · 저장된 값도 오늘 날짜로 0을 남겨, 껐다 켰을 때 어제 숫자를 다시 읽지 않게 한다
    ///    (저장에 실패해도 <see cref="OfflineUsageStore.Load"/>가 날짜로 한 번 더 걸러낸다).
    /// </summary>
    private void EnsureToday()
    {
        var today = CompanyToday();
        if (today == _tempUsedDate) return;

        _tempUsedDate = today;
        _tempUsedLocal = 0;
        _tempUsedOfflineLocal = 0;
        OfflineUsageStore.Save(today, 0);

        // 날짜 어긋남 경고를 하루 한 번으로 되돌린다.
        //  · ⚠️ 이 줄이 없으면 자정 직전에 만들어진 응답을 자정 직후에 받는 **정상 상황 한 번**으로
        //    경고가 소진되어, 그 뒤로는 진짜 서버 시간대 오배포가 생겨도 영영 알리지 않는다(3차 검수 F-1).
        _dateMismatchLogged = false;
    }

    // ── 판정 다시 계산 ──────────────────────────────────────────────────────

    private void Recompute()
    {
        // ⚠️ 이 함수는 반드시 **화면 스레드**에서 돌아야 한다. 여기서 알리는 값(Changed)을 받아
        //    트레이·잠금화면이 곧바로 그리기 때문이다. 다른 스레드에서 부르면 화면 갱신이 통째로
        //    예외로 죽는다(2-C 실기기 검증에서 실제로 발생). 전제를 코드로 못박아 재발을 막는다.
        _timer.Dispatcher.VerifyAccess();

        EnsureToday();

        var paired = IsPaired();

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
            TempUseUntil = _tempUseUntil,
            TempUseLeft = TempUseLeft,
            Offline = IsOffline,
            UsingOfflineQuota = UsingOfflineQuota,
            PendingEvents = _events.Count,
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
