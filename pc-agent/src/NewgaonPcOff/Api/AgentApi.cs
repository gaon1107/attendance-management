using System;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using NewgaonPcOff.Diagnostics;

namespace NewgaonPcOff.Api;

/// <summary>API 호출 결과. 성공이면 <see cref="Value"/>, 실패면 <see cref="Error"/>(사람이 읽을 한국어)를 본다.</summary>
internal sealed class ApiResult<T>
{
    public bool Ok { get; private init; }
    public T? Value { get; private init; }
    public string? Error { get; private init; }

    /// <summary>HTTP 상태(통신 자체가 실패했으면 0). 401은 "연결이 해제됨"으로 처리해야 한다.</summary>
    public int Status { get; private init; }

    /// <summary>
    /// 시간 초과로 끝났는지. <b>중요</b>: 이 경우 서버가 요청을 이미 처리했을 수 있다
    /// (연결코드는 서버가 먼저 소진하므로, 응답만 유실되면 코드는 이미 쓴 상태가 된다).
    /// </summary>
    public bool TimedOut { get; private init; }

    public bool Unauthorized => Status == 401;

    public static ApiResult<T> Success(T value) => new() { Ok = true, Value = value, Status = 200 };

    public static ApiResult<T> Fail(string error, int status = 0, bool timedOut = false)
        => new() { Ok = false, Error = error, Status = status, TimedOut = timedOut };
}

/// <summary>
/// 서버(webapp)와 이야기하는 유일한 통로.
///  · 쓰는 창구는 Phase 1에서 이미 열어둔 4개뿐: pair / policy / events / overtime.
///    (2-A에서는 pair·policy만 쓴다. events·overtime은 각 단계에서 추가한다.)
///  · ⚠️ 토큰은 Authorization 헤더로만 보낸다. 주소·로그에 남기지 않는다.
///  · ⚠️ 예외 메시지를 그대로 쓰지 않는다 — .NET 예외는 문제가 된 **값**을 메시지에 넣는 관례가 있어
///    토큰이 로그·화면으로 새는 통로가 된다. 종류(GetType().Name)만 남긴다.
/// </summary>
internal static class AgentApi
{
    /// <summary>보통 호출(정책 조회 등) 제한 시간.</summary>
    private static readonly TimeSpan NormalTimeout = TimeSpan.FromSeconds(15);

    /// <summary>
    /// 연결(페어링)은 넉넉히 준다. 서버를 막 켠 직후 첫 요청은 화면을 처음 만드는 시간이 붙어 느리고,
    /// 여기서 시간이 초과되면 <b>연결코드가 소진된 채</b> 실패하기 때문이다(사용자가 같은 코드를 다시 넣으면 계속 실패).
    /// </summary>
    private static readonly TimeSpan PairTimeout = TimeSpan.FromSeconds(40);

    private static readonly HttpClient Http = CreateClient();

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private static HttpClient CreateClient()
    {
        var handler = new SocketsHttpHandler
        {
            // 24시간 켜져 있는 프로그램이다. 연결을 무한정 재사용하면 서버 주소(IP)가 바뀌어도
            // 옛 연결을 계속 써서 통신이 안 되는 상태가 오래 이어진다.
            PooledConnectionLifetime = TimeSpan.FromMinutes(5),
            AutomaticDecompression = DecompressionMethods.All,
            // ⚠️ 이 값이 아래 제한 시간(15초·40초)보다 **짧아야** 한다.
            //  그러면 "서버에 닿지도 못한 것"과 "닿았는데 응답이 없는 것"을 구분할 수 있다
            //  (아래 SendAsync의 timer.IsCancellationRequested 판정). 구분하지 못하면
            //  서버 주소 오타를 "연결코드가 소진됐다"고 잘못 안내해, 멀쩡한 코드를 버리게 만든다.
            ConnectTimeout = TimeSpan.FromSeconds(10),
        };

        var client = new HttpClient(handler)
        {
            // 제한 시간은 호출마다 따로 건다(아래 SendAsync). 전체 기본값은 끈다.
            Timeout = Timeout.InfiniteTimeSpan,
            // 주소를 잘못 적어 엉뚱한(대용량) 서버를 가리켜도 메모리를 먹지 않게 1MB로 제한.
            MaxResponseContentBufferSize = 1024 * 1024,
        };
        client.DefaultRequestHeaders.UserAgent.ParseAdd(AppInfo.UserAgent);
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return client;
    }

    // ── 연결(페어링) ────────────────────────────────────────────────────────
    /// <summary>
    /// 웹 [계정]에서 발급받은 6자리 코드로 이 PC를 연결한다. 성공하면 기기 토큰이 딱 한 번 내려온다.
    /// </summary>
    public static async Task<ApiResult<PairResponse>> PairAsync(
        string serverUrl, string code, string deviceName, CancellationToken ct = default)
    {
        if (!TryBuildUrl(serverUrl, "api/agent/pair", out var url))
        {
            return ApiResult<PairResponse>.Fail("서버 주소가 올바르지 않습니다. http:// 또는 https:// 로 시작하는 주소만 입력해주세요.");
        }

        var body = JsonSerializer.Serialize(new
        {
            code,
            deviceName,
            agentVersion = AppInfo.Version,
        });

        using var req = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        return await SendAsync<PairResponse>(req, "연결", PairTimeout, ct).ConfigureAwait(false);
    }

    // ── 정책 받기 ───────────────────────────────────────────────────────────
    /// <summary>
    /// "지금 잠가야 하나"를 계산할 재료를 받아온다. 이 호출 자체가 [PC관리]의 "켜짐" 표시 근거가 된다.
    /// </summary>
    public static async Task<ApiResult<PcOffPolicy>> GetPolicyAsync(
        string serverUrl, string token, CancellationToken ct = default)
    {
        if (!TryBuildUrl(serverUrl, $"api/agent/policy?v={Uri.EscapeDataString(AppInfo.Version)}", out var url))
        {
            return ApiResult<PcOffPolicy>.Fail("서버 주소가 올바르지 않습니다. [연결 설정]에서 주소를 다시 확인해주세요.");
        }

        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await SendAsync<PcOffPolicy>(req, "정책 조회", NormalTimeout, ct).ConfigureAwait(false);
    }

    // ── 사건 기록 보내기 ────────────────────────────────────────────────────
    /// <summary>
    /// 잠금·해제·일시사용 같은 "일어난 일"을 묶어서 보낸다.
    ///  · ⚠️ 보내는 것은 <b>종류·시각·[일시사용] 사유</b>뿐이다. 화면·입력 내용·앱 목록은 보내지 않는다
    ///    (그럴 통로가 아예 없다 — <see cref="Core.QueuedEvent"/>가 수집 범위를 못박는다).
    ///  · 서버는 같은 <c>clientEventId</c>를 두 번 세지 않는다 → 실패하면 그대로 다시 보내면 된다.
    /// </summary>
    public static async Task<ApiResult<EventsResponse>> PostEventsAsync(
        string serverUrl, string token, Core.QueuedEvent[] events, CancellationToken ct = default)
    {
        if (events == null || events.Length == 0)
        {
            return ApiResult<EventsResponse>.Fail("보낼 기록이 없습니다.");
        }
        if (!TryBuildUrl(serverUrl, "api/agent/events", out var url))
        {
            return ApiResult<EventsResponse>.Fail("서버 주소가 올바르지 않습니다. [연결 설정]에서 주소를 다시 확인해주세요.");
        }

        var items = new object[events.Length];
        for (var i = 0; i < events.Length; i++)
        {
            var e = events[i];
            items[i] = new
            {
                type = e.Type,
                // "o" 형식은 시간대를 함께 담는다(예: 2026-07-27T18:10:00.0000000+09:00).
                // 시간대를 빼면 서버가 자기 시간대로 해석해 기록이 9시간 어긋난다.
                at = e.At.ToString("o", CultureInfo.InvariantCulture),
                meta = e.Meta,
                clientEventId = e.Id,
            };
        }

        var body = JsonSerializer.Serialize(new { events = items, agentVersion = AppInfo.Version });

        using var req = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await SendAsync<EventsResponse>(req, "기록 전송", NormalTimeout, ct).ConfigureAwait(false);
    }

    // ── 연장근무 신청 ───────────────────────────────────────────────────────
    /// <summary>
    /// 잠금화면에서 바로 연장근무를 신청한다(PC가 잠겨 브라우저를 열 수 없으므로 필요하다).
    ///  · 서버가 웹 신청과 <b>같은 규칙·같은 결재선</b>으로 만든다(webapp/app/api/agent/overtime).
    /// </summary>
    public static async Task<ApiResult<OvertimeResponse>> PostOvertimeAsync(
        string serverUrl, string token, string targetDate, string startTime, string endTime, string? reason,
        CancellationToken ct = default)
    {
        if (!TryBuildUrl(serverUrl, "api/agent/overtime", out var url))
        {
            return ApiResult<OvertimeResponse>.Fail("서버 주소가 올바르지 않습니다. [연결 설정]에서 주소를 다시 확인해주세요.");
        }

        var body = JsonSerializer.Serialize(new { targetDate, startTime, endTime, reason });

        using var req = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await SendAsync<OvertimeResponse>(req, "연장근무 신청", NormalTimeout, ct).ConfigureAwait(false);
    }

    // ── 주소 만들기 ─────────────────────────────────────────────────────────

    /// <summary>
    /// 서버 주소 + 경로를 <b>글자 이어붙이기가 아니라 Uri 규칙</b>으로 합친다.
    ///  · 글자로 붙이면 <c>http://a.com/#</c> 같은 값이 들어올 때 조각(#) 뒤로 붙어
    ///    엉뚱한 곳으로 연결코드를 보내게 된다. 그래서 형태 검사부터 한다.
    /// </summary>
    private static bool TryBuildUrl(string serverUrl, string relative, out Uri? url)
    {
        url = null;
        if (!Config.AgentConfig.IsValidServerUrl(serverUrl)) return false;
        var baseUri = new Uri(serverUrl.Trim().TrimEnd('/') + "/", UriKind.Absolute);
        return Uri.TryCreate(baseUri, relative, out url);
    }

    // ── 공통 전송·오류 번역 ─────────────────────────────────────────────────

    private static async Task<ApiResult<T>> SendAsync<T>(
        HttpRequestMessage req, string what, TimeSpan timeout, CancellationToken ct)
    {
        using var timer = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timer.CancelAfter(timeout);

        try
        {
            using var res = await Http.SendAsync(req, timer.Token).ConfigureAwait(false);

            if (!res.IsSuccessStatusCode)
            {
                var text = await ReadTextAsync(res, timer.Token).ConfigureAwait(false);
                var message = ReadServerError(text) ?? HttpMessage(res.StatusCode);
                Log.Warn($"{what} 실패: HTTP {(int)res.StatusCode}");
                return ApiResult<T>.Fail(message, (int)res.StatusCode);
            }

            // 글자로 바꾸지 않고 바로 읽는다 — 응답의 글자 인코딩을 추측할 필요가 없어진다.
            await using var stream = await res.Content.ReadAsStreamAsync(timer.Token).ConfigureAwait(false);
            var value = await JsonSerializer.DeserializeAsync<T>(stream, Json, timer.Token).ConfigureAwait(false);
            if (value == null)
            {
                Log.Warn($"{what} 응답이 비어 있습니다.");
                return ApiResult<T>.Fail("서버 응답을 이해할 수 없습니다. 서버 주소가 근태관리 서버인지 확인해주세요.", (int)res.StatusCode);
            }
            return ApiResult<T>.Success(value);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            // ⚠️ 여기 오는 이유가 두 가지다. 반드시 구분해야 한다.
            //  ① 우리가 건 제한 시간이 끝남(timer가 취소됨) = 서버에 **닿았는데** 응답이 없다
            //     → 서버가 요청을 처리했을 수 있다(연결코드는 서버가 먼저 소진한다).
            //  ② ConnectTimeout이 먼저 끝남(timer는 아직 안 취소됨) = TCP 연결 자체를 못 했다
            //     → 요청이 서버로 나가지도 않았으므로 연결코드는 **그대로 살아 있다**.
            if (!timer.IsCancellationRequested)
            {
                Log.Warn($"{what} 서버 접속 실패(연결 제한시간)");
                return ApiResult<T>.Fail("서버에 연결할 수 없습니다. 서버 주소와 네트워크를 확인해주세요.");
            }

            Log.Warn($"{what} 응답 시간 초과({timeout.TotalSeconds:0}초)");
            return ApiResult<T>.Fail("서버에 연결은 됐지만 응답이 오지 않았습니다(시간 초과).", timedOut: true);
        }
        catch (OperationCanceledException)
        {
            return ApiResult<T>.Fail("취소되었습니다.");
        }
        catch (HttpRequestException ex)
        {
            Log.Warn($"{what} 통신 실패: {ex.GetType().Name} / {ex.HttpRequestError}");
            return ApiResult<T>.Fail("서버에 연결할 수 없습니다. 서버 주소와 네트워크를 확인해주세요.");
        }
        catch (JsonException)
        {
            Log.Warn($"{what} 응답 형식 오류");
            return ApiResult<T>.Fail("서버 응답 형식이 올바르지 않습니다. 서버 주소를 확인해주세요.");
        }
        catch (Exception ex)
        {
            // ⚠️ ex.Message를 쓰지 않는다(토큰 등 값이 메시지에 실려 로그로 새는 것을 막기 위해).
            Log.Error($"{what} 중 예상치 못한 오류: {ex.GetType().FullName}");
            return ApiResult<T>.Fail("알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
        }
    }

    /// <summary>오류 본문만 글자로 읽는다(정상 응답은 스트림으로 바로 처리한다).</summary>
    private static async Task<string> ReadTextAsync(HttpResponseMessage res, CancellationToken ct)
    {
        try
        {
            await using var stream = await res.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
            using var reader = new StreamReader(stream, Encoding.UTF8);
            var buffer = new char[4096]; // 오류 문구는 짧다. HTML 오류 페이지를 통째로 읽지 않는다.
            var read = await reader.ReadAsync(buffer, ct).ConfigureAwait(false);
            return new string(buffer, 0, read);
        }
        catch
        {
            return "";
        }
    }

    /// <summary>서버가 준 <c>{"error":"..."}</c> 문구를 그대로 쓴다(이미 한국어 안내문이다).</summary>
    private static string? ReadServerError(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        try
        {
            var e = JsonSerializer.Deserialize<ErrorResponse>(text, Json);
            return string.IsNullOrWhiteSpace(e?.Error) ? null : e!.Error;
        }
        catch
        {
            return null; // HTML 오류 페이지 등 — 아래 기본 문구로 대체
        }
    }

    private static string HttpMessage(HttpStatusCode code) => code switch
    {
        HttpStatusCode.Unauthorized => "연결이 해제되었거나 만료되었습니다. 웹에서 새 연결코드를 받아 다시 연결해주세요.",
        HttpStatusCode.Forbidden => "사용할 수 없는 계정입니다. 관리자에게 문의해주세요.",
        HttpStatusCode.NotFound => "서버에서 해당 기능을 찾을 수 없습니다. 서버 주소를 확인해주세요.",
        HttpStatusCode.TooManyRequests => "시도가 너무 많습니다. 잠시 후 다시 시도해주세요.",
        _ => $"서버 오류가 발생했습니다. (코드 {(int)code})",
    };
}
