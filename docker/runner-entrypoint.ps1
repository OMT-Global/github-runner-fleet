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

function Require-GitHubAuth {
  if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_PAT)) {
    return
  }
  if (
    -not [string]::IsNullOrWhiteSpace($env:GITHUB_APP_ID) -and
    -not [string]::IsNullOrWhiteSpace($env:GITHUB_APP_INSTALLATION_ID) -and
    -not [string]::IsNullOrWhiteSpace($env:GITHUB_APP_PRIVATE_KEY)
  ) {
    return
  }
  throw "GitHub auth is required: set GITHUB_PAT or GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, and GITHUB_APP_PRIVATE_KEY"
}

function ConvertTo-Base64Url {
  param([byte[]]$Bytes)
  return [Convert]::ToBase64String($Bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Get-GitHubBearerToken {
  if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_PAT)) {
    return $env:GITHUB_PAT
  }

  $privateKeyText = $env:GITHUB_APP_PRIVATE_KEY.Replace("\n", "`n")
  if (-not $privateKeyText.Contains("-----BEGIN")) {
    $privateKeyText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:GITHUB_APP_PRIVATE_KEY)).Replace("\n", "`n")
  }
  $rsa = [System.Security.Cryptography.RSA]::Create()
  $rsa.ImportFromPem($privateKeyText)
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $header = ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes('{"alg":"RS256","typ":"JWT"}'))
  $payloadJson = "{`"iat`":$($now - 60),`"exp`":$($now + 540),`"iss`":`"$env:GITHUB_APP_ID`"}"
  $payload = ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes($payloadJson))
  $signingInput = "$header.$payload"
  $signature = ConvertTo-Base64Url ($rsa.SignData([Text.Encoding]::UTF8.GetBytes($signingInput), [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1))
  $jwt = "$signingInput.$signature"
  $headers = @{
    Authorization = "Bearer $jwt"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
  }
  $response = Invoke-RestMethod -Method Post -Uri "$env:GITHUB_API_URL/app/installations/$env:GITHUB_APP_INSTALLATION_ID/access_tokens" -Headers $headers
  return $response.token
}

function Request-RunnerToken {
  param([ValidateSet("registration", "remove")][string]$Kind)

  $endpointKind = if ($Kind -eq "registration") { "registration-token" } else { "remove-token" }
  $uri = "$env:GITHUB_API_URL/orgs/$env:GITHUB_ORG/actions/runners/$endpointKind"
  $bearerToken = Get-GitHubBearerToken
  $headers = @{
    Authorization = "Bearer $bearerToken"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
  }
  $response = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers
  return $response.token
}


function Invoke-ActionsRunner {
  $credentialNames = @(
    "GITHUB_PAT",
    "GITHUB_APP_ID",
    "GITHUB_APP_INSTALLATION_ID",
    "GITHUB_APP_PRIVATE_KEY"
  )
  $savedCredentials = @{}

  foreach ($name in $credentialNames) {
    $savedCredentials[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    [Environment]::SetEnvironmentVariable($name, $null, "Process")
  }

  try {
    & .\run.cmd 2>&1 | Tee-Object -FilePath (Join-Path $env:RUNNER_LOG_DIR "runner.log") -Append
    return $LASTEXITCODE
  } finally {
    foreach ($name in $credentialNames) {
      [Environment]::SetEnvironmentVariable($name, $savedCredentials[$name], "Process")
    }
  }
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

Require-GitHubAuth
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
    exit (Invoke-ActionsRunner)
  } finally {
    Pop-Location
  }
} finally {
  Remove-RunnerRegistration
}
