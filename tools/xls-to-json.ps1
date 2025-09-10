param(
  [string]$Source = (Join-Path $PSScriptRoot '..\data\data_j.xls'),
  [string]$Dest = (Join-Path $PSScriptRoot '..\data\jp-stocks.json')
)

function Normalize-Code($v) {
  if ($null -eq $v) { return $null }
  $s = ("$v").Trim() -replace '[^0-9]', ''
  if ($s.Length -ne 4) { return $null }
  return $s.PadLeft(4,'0')
}

$excel = $null
$wb = $null
try {
  if (-not (Test-Path $Source)) { throw "Source not found: $Source" }
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $wb = $excel.Workbooks.Open($Source)
  $ws = $wb.Worksheets.Item(1)

  # Detect header row and columns
  $headerRow = 1
  $codeCol = $null
  $nameCol = $null
  for ($r=1; $r -le 20; $r++) {
    for ($c=1; $c -le 20; $c++) {
      $v = $ws.Cells.Item($r,$c).Text
      if (-not [string]::IsNullOrWhiteSpace($v)) {
        if ($null -eq $codeCol -and ($v -like '*コード*' -or $v -like '*証券コード*' -or $v -like '*銘柄コード*')) { $codeCol = $c; $headerRow = $r }
        if ($null -eq $nameCol -and ($v -like '*銘柄名*' -or $v -like '*名称*' -or $v -like '*会社名*' -or $v -like '*企業名*')) { $nameCol = $c; $headerRow = $r }
      }
    }
  }
  if ($null -eq $codeCol -or $null -eq $nameCol) {
    # Fallback: detect by content sampling in first 100 rows, 30 columns
    function Test-Code($s) { if ($null -eq $s) { return $false }; $t = ("$s").Trim() -replace '[^0-9]', ''; return ($t.Length -eq 4) }
    function Test-JP($s) { if ([string]::IsNullOrWhiteSpace($s)) { return $false }; return [bool]([regex]::IsMatch(("$s"), "[\u3040-\u30FF\u4E00-\u9FFF]")) }
    $maxCols = [Math]::Min(30, $ws.UsedRange.Columns.Count)
    $maxRows = [Math]::Min(100, $ws.UsedRange.Rows.Count)
    $bestCode = @{ idx = $null; score = -1.0 }
    $bestName = @{ idx = $null; score = -1.0 }
    for ($c = 1; $c -le $maxCols; $c++) {
      $hitsCode = 0; $total = 0
      $hitsJP = 0
      for ($r = 1; $r -le $maxRows; $r++) {
        $v = $ws.Cells.Item($r,$c).Text
        if (-not [string]::IsNullOrWhiteSpace($v)) { $total++ }
        if (Test-Code $v) { $hitsCode++ }
        if (Test-JP $v) { $hitsJP++ }
      }
      if ($total -gt 0) {
        $scoreCode = $hitsCode / $total
        $scoreJP = $hitsJP / $total
        if ($scoreCode -gt $bestCode.score) { $bestCode.idx = $c; $bestCode.score = $scoreCode }
        if ($scoreJP -gt $bestName.score) { $bestName.idx = $c; $bestName.score = $scoreJP }
      }
    }
    if ($null -eq $codeCol) { $codeCol = $bestCode.idx }
    if ($null -eq $nameCol) { $nameCol = $bestName.idx }
    if ($null -eq $codeCol -or $null -eq $nameCol) { throw "Failed to detect 'コード' and '銘柄名' columns" }
  }

  $rows = @()
  for ($r = $headerRow + 1; $r -le ($ws.UsedRange.Rows.Count + 2); $r++) {
    $cval = $ws.Cells.Item($r, $codeCol).Text
    $nval = $ws.Cells.Item($r, $nameCol).Text
    if ([string]::IsNullOrWhiteSpace($cval) -and [string]::IsNullOrWhiteSpace($nval)) { continue }
    $code = Normalize-Code $cval
    if ($null -eq $code) { continue }
    $name = ($nval).Trim()
    if ([string]::IsNullOrWhiteSpace($name)) { continue }
    $rows += [PSCustomObject]@{ code = $code; name = $name }
  }

  # De-dup and sort
  $uniq = $rows | Group-Object code | ForEach-Object { $_.Group[0] } | Sort-Object code
  $json = $uniq | ConvertTo-Json -Depth 3 -Compress:$false
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Dest, $json, $enc)
  Write-Host ("Wrote {0} entries to {1}" -f $uniq.Count, $Dest)
}
catch {
  Write-Error $_.Exception.Message
  exit 1
}
finally {
  if ($wb) { $wb.Close($false) | Out-Null }
  if ($excel) { $excel.Quit() | Out-Null }
  [System.GC]::Collect() | Out-Null
  [System.GC]::WaitForPendingFinalizers() | Out-Null
}
