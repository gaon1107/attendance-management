using System.Text.Json.Serialization;

namespace NewgaonPcOff.Api;

// 서버(webapp)가 내려주는 JSON을 그대로 담는 그릇들.
//  · 원본 정의: webapp/lib/pcoff-policy.ts 의 PcOffPolicy 타입. 서버가 바뀌면 여기도 함께 맞춘다.
//  · ⚠️ 여기에 없는 항목은 앱이 알 수도, 저장할 수도 없다. "수집 범위"를 이 파일이 못박는다.
//  · ⚠️ 목록·객체 항목은 **읽을 때 빈 값으로 메꾼다**(아래 `??=` 패턴).
//    이유: JSON에 `"notifyMins": null` 처럼 명시적 null이 오면 C#의 초기값(`[]`)이 null로 덮인다.
//    그 상태로 판정기가 읽으면 앱이 예외로 멈추고 = 잠금·해제가 통째로 안 도는 사고가 된다.

internal sealed class PcOffPolicy
{
    private string? _serverTime;
    private string? _mode;
    private int[]? _notifyMins;
    private TempUseInfo? _tempUse;
    private WorkInfo? _work;
    private DayInfo[]? _days;
    private OvertimeWindow[]? _approvedOvertime;

    /// <summary>서버 현재 시각(ISO). 앱은 PC 시계가 아니라 이 값을 기준으로 판단한다(시계 조작 방어).</summary>
    [JsonPropertyName("serverTime")]
    public string ServerTime { get => _serverTime ??= ""; set => _serverTime = value; }

    /// <summary>이 PC를 잠금 대상으로 볼지. false면 앱은 완전히 쉰다.</summary>
    [JsonPropertyName("enabled")] public bool Enabled { get; set; }

    /// <summary>enabled=false인 이유: company_off / user_exempt / no_worktime / shift_unsupported / unknown</summary>
    [JsonPropertyName("disabledReason")] public string? DisabledReason { get; set; }

    [JsonPropertyName("mode")]
    public string Mode { get => _mode ??= "lock"; set => _mode = value; }

    /// <summary>퇴근 기준시각 이후 유예(분).</summary>
    [JsonPropertyName("delayMin")] public int DelayMin { get; set; }

    /// <summary>잠금 몇 분 전에 미리 알릴지(예: [10, 5]).</summary>
    [JsonPropertyName("notifyMins")]
    public int[] NotifyMins { get => _notifyMins ??= []; set => _notifyMins = value; }

    [JsonPropertyName("tempUse")]
    public TempUseInfo TempUse { get => _tempUse ??= new TempUseInfo(); set => _tempUse = value; }

    [JsonPropertyName("work")]
    public WorkInfo Work { get => _work ??= new WorkInfo(); set => _work = value; }

    /// <summary>오늘·내일 이틀치(자정 넘김 야근·다음 근무일 해제 계산용).</summary>
    [JsonPropertyName("days")]
    public DayInfo[] Days { get => _days ??= []; set => _days = value; }

    /// <summary>승인된 연장근무만. 이 시간대에는 잠그지 않는다.</summary>
    [JsonPropertyName("approvedOvertime")]
    public OvertimeWindow[] ApprovedOvertime { get => _approvedOvertime ??= []; set => _approvedOvertime = value; }

    /// <summary>설정이 바뀌면 값이 달라지는 지문(캐시 갱신 판단용). 서버는 32비트 양수를 준다.</summary>
    [JsonPropertyName("policyVersion")] public long PolicyVersion { get; set; }
}

internal sealed class TempUseInfo
{
    private string[]? _reasons;

    /// <summary>[일시사용] 1회 길이(분).</summary>
    [JsonPropertyName("minutes")] public int Minutes { get; set; }

    /// <summary>하루 허용 횟수.</summary>
    [JsonPropertyName("perDay")] public int PerDay { get; set; }

    /// <summary>오늘 이미 쓴 횟수 — <b>서버가 센다</b>(앱을 다시 깔아도 초기화되지 않는다).</summary>
    [JsonPropertyName("usedToday")] public int UsedToday { get; set; }

    /// <summary>잠금화면에서 <b>고르기만</b> 하는 사유 목록. ⚠️ 자유입력 칸은 만들지 않는다(민감정보 유입 차단).</summary>
    [JsonPropertyName("reasons")]
    public string[] Reasons { get => _reasons ??= []; set => _reasons = value; }
}

internal sealed class WorkInfo
{
    private string? _workDays;

    /// <summary>"HH:MM" 회사 표준 출근 기준시각.</summary>
    [JsonPropertyName("startTime")] public string? StartTime { get; set; }

    /// <summary>"HH:MM" 회사 표준 퇴근 기준시각 — 잠금 기준선.</summary>
    [JsonPropertyName("endTime")] public string? EndTime { get; set; }

    /// <summary>이 직원의 근무요일 CSV(예: "1,2,3,4,5" — 0=일요일).</summary>
    [JsonPropertyName("workDays")]
    public string WorkDays { get => _workDays ??= ""; set => _workDays = value; }
}

internal sealed class DayInfo
{
    private string? _date;

    [JsonPropertyName("date")]
    public string Date { get => _date ??= ""; set => _date = value; }

    [JsonPropertyName("isWorkday")] public bool IsWorkday { get; set; }

    /// <summary>공휴일·회사 휴무일이면 이름(잠금화면 안내 문구용).</summary>
    [JsonPropertyName("offDayName")] public string? OffDayName { get; set; }
}

internal sealed class OvertimeWindow
{
    private string? _date;
    private string? _startTime;
    private string? _endTime;

    [JsonPropertyName("date")]
    public string Date { get => _date ??= ""; set => _date = value; }

    [JsonPropertyName("startTime")]
    public string StartTime { get => _startTime ??= ""; set => _startTime = value; }

    /// <summary>"HH:MM". startTime보다 작거나 같으면 <b>다음 날</b>까지라는 뜻(자정 넘김 야근).</summary>
    [JsonPropertyName("endTime")]
    public string EndTime { get => _endTime ??= ""; set => _endTime = value; }
}

// ── 연결(페어링) 응답 ────────────────────────────────────────────────────────

internal sealed class PairResponse
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }

    /// <summary>⚠️ 평문 토큰. 서버가 <b>이 응답 한 번만</b> 준다. 받은 즉시 암호화 보관하고 어디에도 출력하지 않는다.</summary>
    [JsonPropertyName("token")] public string? Token { get; set; }

    [JsonPropertyName("deviceId")] public string? DeviceId { get; set; }
    [JsonPropertyName("userName")] public string? UserName { get; set; }
    [JsonPropertyName("companyName")] public string? CompanyName { get; set; }

    /// <summary>같은 이름의 PC를 다시 연결한 경우 true(앱 재설치 등).</summary>
    [JsonPropertyName("reconnected")] public bool Reconnected { get; set; }
}

internal sealed class ErrorResponse
{
    [JsonPropertyName("error")] public string? Error { get; set; }
}

// ── 사건 기록·연장근무 신청 응답 (2-C) ───────────────────────────────────────

/// <summary>사건 묶음 전송 결과. <c>saved</c>+<c>duplicated</c>는 "서버가 받아들였다"는 뜻이다.</summary>
internal sealed class EventsResponse
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("saved")] public int Saved { get; set; }

    /// <summary>서버가 버린 건수(모르는 종류·말이 안 되는 시각). 버려도 다시 보내지 않는다.</summary>
    [JsonPropertyName("dropped")] public int Dropped { get; set; }

    /// <summary>이미 저장돼 있던 건수(재전송). 성공으로 본다.</summary>
    [JsonPropertyName("duplicated")] public int Duplicated { get; set; }
}

/// <summary>잠금화면에서 낸 연장근무 신청 결과.</summary>
internal sealed class OvertimeResponse
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("id")] public string? Id { get; set; }

    /// <summary>항상 "pending"(대기). 승인은 웹에서 관리자가 한다.</summary>
    [JsonPropertyName("status")] public string? Status { get; set; }

    /// <summary>같은 신청이 이미 있었다(버튼 연타 등). 사용자에게는 성공으로 안내한다.</summary>
    [JsonPropertyName("duplicated")] public bool Duplicated { get; set; }
}
