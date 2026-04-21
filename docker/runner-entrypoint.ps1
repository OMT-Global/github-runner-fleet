$ErrorActionPreference = "Stop"

function Write-RunnerLog {
  param([string]$Message)
  $timestamp = Get-Date -Format o
  Write-Host "[$timestamp] $Message"
}

function Require-Env {
  param([string]$Name)
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($Name))) {
    throw "$Name is required"
  }
}

function Request-RunnerToken {
  param([ValidateSet("registration", "remove")][string]$Kind)

  $endpointKind = if ($Kind -eq "registration") { "registration-token" } else { "remove-token" }
  $uri = "$env:GITHUB_API_URL/orgs/$env:GITHUB_ORG/actions/runners/$endpointKind"
  $headers = @{
    Authorization = "Bearer $env:GITHUB_PAT"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
  }
  $response = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers
  return $response.token
}

function Clear-RunnerState {
  Remove-Item -Force -ErrorAction SilentlyContinue `
    (Join-Path $env:RUNNER_HOME ".runner"), `
    (Join-Path $env:RUNNER_HOME ".credentials"), `
    (Join-Path $env:RUNNER_HOME ".credentials_rsaparams")
  New-Item -ItemType Directory -Force -Path $env:RUNNER_WORK_DIR, $env:RUNNER_TEMP | Out-Null
  Get-ChildItem -Force -ErrorAction SilentlyContinue $env:RUNNER_WORK_DIR | Remove-Item -Recurse -Force
  Get-ChildItem -Force -ErrorAction SilentlyContinue $env:RUNNER_TEMP | Remove-Item -Recurse -Force
}

function Prepare-RunnerHome {
  New-Item -ItemType Directory -Force -Path $env:RUNNER_STATE_DIR, $env:RUNNER_LOG_DIR, $env:RUNNER_WORK_DIR, $env:RUNNER_TEMP, $env:RUNNER_TOOL_CACHE | Out-Null
  if (Test-Path $env:RUNNER_HOME) {
    Remove-Item -Recurse -Force $env:RUNNER_HOME
  }
  New-Item -ItemType Directory -Force -Path $env:RUNNER_HOME | Out-Null
  Copy-Item -Recurse -Force (Join-Path $env:RUNNER_SOURCE_HOME "*") $env:RUNNER_HOME
}

function Remove-RunnerRegistration {
  if ($script:RunnerConfigured -ne $true) {
    return
  }

  try {
    $removeToken = Request-RunnerToken -Kind remove
    if (-not [string]::IsNullOrWhiteSpace($removeToken)) {
      Push-Location $env:RUNNER_HOME
      try {
        & .\config.cmd remove --token $removeToken
      } finally {
        Pop-Location
      }
    }
  } catch {
    Write-RunnerLog "runner removal failed: $($_.Exception.Message)"
  }
}

Require-Env GITHUB_PAT
Require-Env GITHUB_ORG
Require-Env RUNNER_NAME
Require-Env RUNNER_LABELS
Require-Env RUNNER_STATE_DIR
Require-Env RUNNER_LOG_DIR
Require-Env RUNNER_WORK_DIR

if ([string]::IsNullOrWhiteSpace($env:GITHUB_API_URL)) { $env:GITHUB_API_URL = "https://api.github.com" }
if ([string]::IsNullOrWhiteSpace($env:RUNNER_SCOPE)) { $env:RUNNER_SCOPE = "organization" }
if ([string]::IsNullOrWhiteSpace($env:RUNNER_EPHEMERAL)) { $env:RUNNER_EPHEMERAL = "true" }
if ([string]::IsNullOrWhiteSpace($env:RUNNER_DISABLE_UPDATE)) { $env:RUNNER_DISABLE_UPDATE = "true" }
if ([string]::IsNullOrWhiteSpace($env:RUNNER_REPOSITORY_ACCESS)) { $env:RUNNER_REPOSITORY_ACCESS = "selected" }
if ([string]::IsNullOrWhiteSpace($env:RUNNER_SOURCE_HOME)) { $env:RUNNER_SOURCE_HOME = "C:\actions-runner" }
if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) { $env:RUNNER_TEMP = "C:\github-runner-temp" }
if ([string]::IsNullOrWhiteSpace($env:RUNNER_TOOL_CACHE)) { $env:RUNNER_TOOL_CACHE = "C:\hostedtoolcache" }
if ([string]::IsNullOrWhiteSpace($env:AGENT_TOOLSDIRECTORY)) { $env:AGENT_TOOLSDIRECTORY = $env:RUNNER_TOOL_CACHE }
if ([string]::IsNullOrWhiteSpace($env:RUNNER_HOME)) { $env:RUNNER_HOME = Join-Path $env:RUNNER_STATE_DIR "runner-home" }

if ($env:RUNNER_SCOPE -ne "organization") {
  throw "RUNNER_SCOPE=$env:RUNNER_SCOPE is unsupported in v1; only organization runners are implemented"
}

$script:RunnerConfigured = $false
try {
  Prepare-RunnerHome
  $registrationToken = Request-RunnerToken -Kind registration
  if ([string]::IsNullOrWhiteSpace($registrationToken)) {
    throw "registration token response was empty"
  }

  $configArgs = @(
    "--unattended",
    "--url", "https://github.com/$env:GITHUB_ORG",
    "--token", $registrationToken,
    "--name", $env:RUNNER_NAME,
    "--work", $env:RUNNER_WORK_DIR,
    "--labels", $env:RUNNER_LABELS,
    "--replace"
  )
  if (-not [string]::IsNullOrWhiteSpace($env:RUNNER_GROUP)) {
    $configArgs += @("--runnergroup", $env:RUNNER_GROUP)
  }
  if ($env:RUNNER_EPHEMERAL -eq "true") {
    $configArgs += "--ephemeral"
  }
  if ($env:RUNNER_DISABLE_UPDATE -eq "true") {
    $configArgs += "--disableupdate"
  }

  Clear-RunnerState

  Write-RunnerLog "configuring runner $env:RUNNER_NAME in group $env:RUNNER_GROUP"
  Write-RunnerLog "repository access: $env:RUNNER_REPOSITORY_ACCESS"
  if ($env:RUNNER_REPOSITORY_ACCESS -eq "all") {
    Write-RunnerLog "allowed repositories: all repositories in $env:GITHUB_ORG"
  } else {
    Write-RunnerLog "allowed repositories: $env:RUNNER_ALLOWED_REPOSITORIES"
  }

  Push-Location $env:RUNNER_HOME
  try {
    & .\config.cmd @configArgs
    $script:RunnerConfigured = $true
    Write-RunnerLog "starting runner $env:RUNNER_NAME"
    & .\run.cmd 2>&1 | Tee-Object -FilePath (Join-Path $env:RUNNER_LOG_DIR "runner.log") -Append
    exit $LASTEXITCODE
  } finally {
    Pop-Location
  }
} finally {
  Remove-RunnerRegistration
}
