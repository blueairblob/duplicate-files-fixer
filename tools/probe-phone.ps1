# probe-phone.ps1 — trial for "Import from device" on phones (Windows).
#
# Phones don't get a drive letter: Windows exposes them as portable devices
# (MTP/WPD) under "This PC". This script checks whether Holdfast could reach
# their photos the same way Explorer does, via the Shell COM interface.
#
# Plug in and unlock the phone (iPhone: tap "Trust"; Android: choose "File
# transfer"), then run from PowerShell:
#   powershell -ExecutionPolicy Bypass -File tools\probe-phone.ps1
# It only lists — it doesn't copy or change anything.

$shell = New-Object -ComObject Shell.Application
$thisPC = $shell.NameSpace(17)
$devices = @($thisPC.Items() | Where-Object { -not $_.IsFileSystem })
if ($devices.Count -eq 0) { Write-Output "No portable devices found. Is the phone connected, unlocked and trusted?"; exit 1 }

function Count-Media($folder, $depth) {
  $n = 0; $samples = @()
  foreach ($i in @($folder.Items())) {
    if ($i.IsFolder -and $depth -lt 3) {
      $sub = Count-Media $i.GetFolder ($depth + 1); $n += $sub[0]; $samples += $sub[1]
    } elseif (-not $i.IsFolder) {
      $n++; if ($samples.Count -lt 3) { $samples += "$($i.Name) ($($folder.GetDetailsOf($i, 2)))" }
    }
  }
  return @($n, $samples)
}

foreach ($d in $devices) {
  Write-Output "Device: $($d.Name)  [$($d.Type)]"
  foreach ($storage in @($d.GetFolder.Items())) {
    Write-Output "  Storage: $($storage.Name)"
    $dcim = @($storage.GetFolder.Items()) | Where-Object { $_.Name -eq 'DCIM' } | Select-Object -First 1
    if ($dcim) {
      $t = Get-Date
      $r = Count-Media $dcim.GetFolder 0
      Write-Output ("    DCIM: {0} files, listed in {1:N1}s. Samples: {2}" -f $r[0], ((Get-Date) - $t).TotalSeconds, ($r[1] -join '; '))
    } else {
      Write-Output "    No DCIM folder visible (locked phone, or the phone isn't in file-transfer mode)."
    }
  }
}
Write-Output "Done. Paste this output back to Claude."
