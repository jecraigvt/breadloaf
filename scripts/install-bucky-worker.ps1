[CmdletBinding()]
param(
  [string]$Repository,
  [string]$CodexPath,
  [switch]$EnableDevelopment,
  [switch]$StartNow
)
$ErrorActionPreference = 'Stop'
if (-not $Repository) { $Repository = Split-Path -Parent $PSScriptRoot }
$taskName = 'Breadloaf Bucky Worker'
$workerRoot = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.breadloaf-worker'))
$repositoryPath = (Resolve-Path -LiteralPath $Repository).Path
$nodePath = (Get-Command node -ErrorAction Stop).Source
if (-not $CodexPath) { $CodexPath = (Get-Command codex -ErrorAction Stop).Source }
$codexExecutable = (Resolve-Path -LiteralPath $CodexPath).Path
if ([IO.Path]::GetExtension($codexExecutable) -ne '.exe') { throw 'CodexPath must name the native codex.exe executable.' }
$tsxPath = Join-Path $repositoryPath 'node_modules/tsx/dist/cli.mjs'
$workerScript = Join-Path $repositoryPath 'scripts/bucky-worker.ts'
foreach ($pathToCheck in @($repositoryPath, $nodePath, $codexExecutable, $tsxPath, $workerScript, $workerRoot)) {
  if ($pathToCheck.Contains('"') -or $pathToCheck.Contains("`n") -or $pathToCheck.Contains("`r")) { throw 'Unsupported quote or newline in a worker path.' }
}
if (-not (Test-Path -LiteralPath $tsxPath)) { throw 'Run npm install before installing the worker.' }
$configPath = Join-Path $workerRoot 'config.json'
$tokenPath = Join-Path $workerRoot 'token'
if (-not (Test-Path -LiteralPath $configPath) -or -not (Test-Path -LiteralPath $tokenPath)) {
  throw 'First register this worker using npm run worker:register. See docs/bucky-worker-local.md.'
}
$workerConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$workerConfig | Add-Member -NotePropertyName codexPath -NotePropertyValue $codexExecutable -Force
$workerConfig | Add-Member -NotePropertyName repository -NotePropertyValue $repositoryPath -Force
$workerConfig | Add-Member -NotePropertyName mode -NotePropertyValue 'local' -Force
$workerConfig | Add-Member -NotePropertyName paused -NotePropertyValue $false -Force
$capabilities = @('document_analysis', 'archive_review')
if ($EnableDevelopment) { $capabilities += 'site_improvement' }
$workerConfig | Add-Member -NotePropertyName capabilities -NotePropertyValue $capabilities -Force
$workerConfig | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configPath -Encoding utf8

# Only this Windows user and SYSTEM can read the credential and job directories.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$propagation = [Security.AccessControl.PropagationFlags]::None
$allowedSids = @($identity.User.Value, 'S-1-5-18')
$currentAcl = Get-Acl -LiteralPath $workerRoot
$currentRules = @($currentAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
$aclMatches = $currentAcl.AreAccessRulesProtected -and $currentRules.Count -eq 2
foreach ($rule in $currentRules) {
  if ($rule.IdentityReference.Value -notin $allowedSids -or $rule.AccessControlType -ne 'Allow' -or
      $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
      $rule.InheritanceFlags -ne $inheritance -or $rule.PropagationFlags -ne $propagation) { $aclMatches = $false }
}
if (-not $aclMatches) {
  # Change only the DACL. Rewriting an unchanged owner/security descriptor on a
  # protected directory can require SeSecurityPrivilege under Windows PS 5.1.
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sidValue in $allowedSids) {
    $sid = New-Object Security.Principal.SecurityIdentifier $sidValue
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inheritance, $propagation, 'Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $workerRoot -AclObject $acl
}
foreach ($secretPath in @($tokenPath, $configPath)) {
  $fileAcl = Get-Acl -LiteralPath $secretPath
  $explicitRules = @($fileAcl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
  if ($fileAcl.AreAccessRulesProtected -or $explicitRules.Count -gt 0) {
    foreach ($rule in $explicitRules) { $fileAcl.RemoveAccessRuleSpecific($rule) }
    $fileAcl.SetAccessRuleProtection($false, $false)
    Set-Acl -LiteralPath $secretPath -AclObject $fileAcl
  }
}

function ConvertTo-PowerShellLiteral([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }
$launcherPath = Join-Path $workerRoot 'launch.ps1'
$launcher = @(
  '$ErrorActionPreference = ''Stop''',
  ('Set-Location -LiteralPath ' + (ConvertTo-PowerShellLiteral $repositoryPath)),
  ('$env:BUCKY_WORKER_HOME = ' + (ConvertTo-PowerShellLiteral $workerRoot)),
  ('& ' + (ConvertTo-PowerShellLiteral $nodePath) + ' ' + (ConvertTo-PowerShellLiteral $tsxPath) + ' ' + (ConvertTo-PowerShellLiteral $workerScript) + ' --run'),
  'exit $LASTEXITCODE'
) -join [Environment]::NewLine
Set-Content -LiteralPath $launcherPath -Value $launcher -Encoding utf8
$powershellPath = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$taskAction = New-ScheduledTaskAction -Execute $powershellPath -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "' + $launcherPath + '"') -WorkingDirectory $repositoryPath
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -Hidden -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description 'Processes Breadloaf background work when this user is signed in; no incoming network listener and no wake timer.' -Force | Out-Null
if ($StartNow) { Start-ScheduledTask -TaskName $taskName }
Write-Output 'Bucky worker installed for this user at sign-in. Run npm run worker -- --doctor to check readiness. Pause/resume with npm run worker -- --pause / --resume.'
