[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$taskName = 'Breadloaf Bucky Worker'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
# Keep credentials/configuration for deliberate rotation or later reinstall.
# Removing the scheduler is enough to stop new work; leases recover interrupted work.
Write-Output 'Bucky worker sign-in task removed. Local configuration remains in ~/.breadloaf-worker. Revoke its worker credential on the website if it is no longer needed.'
