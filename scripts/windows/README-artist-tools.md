# Windows artist.tools fallback

Apply `supabase/migrations/20261010175831_add_artist_tools_source.sql` first. Install Python 3.12 with
`python` on PATH and `python -m pip install requests`. The wrapper loads only the
Supabase configuration from `web/.env.local`, using `NEXT_PUBLIC_SUPABASE_URL`
when `SUPABASE_URL` is absent, and never echoes credentials. It does not remove
any tracks from the owner's folder.

Authorize once from PowerShell (also use this command after revocation,
`invalid_grant`, or expiry of the 90-day refresh token):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\StreamBase\scripts\windows\artist_tools_fallback.ps1" -Authorize
```

Complete the browser prompt within five minutes. The loopback callback uses a
free port. Tokens live only in the service-role Supabase table. The direct command,
when Supabase environment variables are already set, is
`python scripts/artist_tools_mcp.py authorize` from the repository root.

Register the fallback yourself, in PowerShell as your normal Windows account:

```powershell
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\StreamBase\scripts\windows\artist_tools_fallback.ps1"' -WorkingDirectory 'C:\StreamBase'
$triggers = @((New-ScheduledTaskTrigger -Daily -At '19:00'), (New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'StreamBase Artist Tools Fallback' -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'Daily artist.tools fallback at 19:00 local; catch up on logon'
```

This runs at 19:00 local time, catches a missed schedule when available, and
checks again on logon. A successful UTC-date run exits immediately; no historical
counts are backfilled on logon. The account must be logged on for this interactive
task. Logs: `%LOCALAPPDATA%\StreamBase\artist-tools.log`. No task is registered by
the agent or the wrapper. GitHub/PC overlap is protected by the database lease;
a contending runner aborts without changing the other runner's run row.
