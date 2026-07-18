# Design-rule reminder hook (PreToolUse: Edit|Write|MultiEdit)
#  - Fires ONLY when editing webapp/app/**/*.tsx (UI pages/components).
#  - Non-blocking (exit 0): injects a reminder into the model context.
#  - Message kept ASCII-only on purpose (Windows PowerShell 5.1 mangles non-BOM UTF-8 Korean).
$ErrorActionPreference = "SilentlyContinue"
try {
  $raw = [Console]::In.ReadToEnd()
  if (-not $raw) { exit 0 }
  $j = $raw | ConvertFrom-Json
  $fp = $j.tool_input.file_path
  if (-not $fp) { exit 0 }
  # webapp/app 아래 .tsx 파일만 대상(백슬래시/슬래시 모두 허용)
  if ($fp -match 'webapp[\\/]app[\\/].*\.tsx$') {
    $msg = "DESIGN-RULE (webapp UI edit): follow the webapp-design-rules skill. " +
           "Use ONLY the shared components (do NOT hand-roll): period range=RangeCalendar/RangeCalendarNav, single date=DatePicker, time=TimePicker, search=SearchBox (left-aligned). " +
           "NO native <input type=date> / type=time. Colors=CSS vars var(--...). Tables wrapped in overflowX:auto + minWidth. Two-column=.split-2, card grid=.kpi-grid (no inline grid). Full width (no narrow)."
    $out = @{ hookSpecificOutput = @{ hookEventName = "PreToolUse"; additionalContext = $msg } } | ConvertTo-Json -Compress
    Write-Output $out
  }
} catch { }
exit 0
