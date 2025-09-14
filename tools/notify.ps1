param(
  [Parameter(Mandatory=$true)][string]$Title,
  [Parameter(Mandatory=$true)][string]$Message
)

$ErrorActionPreference = 'SilentlyContinue'

function Toast-Burnt($Title, $Message){
  try {
    Import-Module BurntToast -ErrorAction Stop | Out-Null
    New-BurntToastNotification -Text $Title, $Message | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Toast-Fallback($Title, $Message){
  try {
    Add-Type -AssemblyName PresentationFramework | Out-Null
    [System.Windows.MessageBox]::Show($Message, $Title, 'OK', 'Information') | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not (Toast-Burnt -Title $Title -Message $Message)) {
  if (-not (Toast-Fallback -Title $Title -Message $Message)) {
    Write-Host "[NOTIFY] $Title - $Message"
  }
}

