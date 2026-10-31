# Sampled foreground-window info for Lumen's activity tracker. Prints one JSON
# line per sample to stdout and sleeps 5 s between samples; the tracker reads the
# lines and restarts this process if it dies.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class LumenWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@

while ($true) {
  $hwnd = [LumenWin]::GetForegroundWindow()
  if ($hwnd -ne [IntPtr]::Zero) {
    $pid2 = 0
    [LumenWin]::GetWindowThreadProcessId($hwnd, [ref]$pid2) | Out-Null
    $proc = Get-Process -Id $pid2 -ErrorAction SilentlyContinue

    $sb = New-Object System.Text.StringBuilder 512
    [LumenWin]::GetWindowText($hwnd, $sb, 512) | Out-Null
    $title = $sb.ToString()

    if ($proc) {
      $app = $proc.ProcessName
      $exe = $proc.ProcessName + '.exe'
      try {
        $desc = $proc.MainModule.FileVersionInfo.FileDescription
        if ($desc) { $app = $desc }
      } catch {}
    } else {
      $app = ''
      $exe = ''
    }

    $o = [ordered]@{ app = $app; exe = $exe; title = $title }
    Write-Output ($o | ConvertTo-Json -Compress)
  }
  Start-Sleep -Seconds 5
}
