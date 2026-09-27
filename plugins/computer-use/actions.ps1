param (
    [string]$Action,
    [int]$X = -1,
    [int]$Y = -1,
    [int]$StartX = -1,
    [int]$StartY = -1,
    [int]$EndX = -1,
    [int]$EndY = -1,
    [string]$Button = "left",
    [switch]$DoubleClick,
    [int]$ScrollDelta = 0,
    [string]$Path = "",
    [string]$Base64Text = "",
    [string]$Key = ""
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$win32Code = @'
using System;
using System.Runtime.InteropServices;

public class NativeMethods {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    public const uint MOUSEEVENTF_LEFTDOWN   = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP     = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN  = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP    = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP   = 0x0040;
    public const uint MOUSEEVENTF_WHEEL      = 0x0800;

    public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    public const uint KEYEVENTF_KEYUP       = 0x0002;
}
'@

if (-not ([System.Management.Automation.PSTypeName]'NativeMethods').Type) {
    Add-Type -TypeDefinition $win32Code
}

function Get-ScreenInfo {
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $pos = [System.Windows.Forms.Cursor]::Position
    return @{
        width = $screen.Width
        height = $screen.Height
        cursorX = $pos.X
        cursorY = $pos.Y
    }
}

switch ($Action.ToLower()) {
    "screen-info" {
        $info = Get-ScreenInfo
        $info | ConvertTo-Json -Compress
    }

    "screenshot" {
        if (-not $Path) {
            $tempDir = [System.IO.Path]::GetTempPath()
            $fileName = "cyrene_shot_" + [System.DateTime]::Now.ToString("yyyyMMdd_HHmmssfff") + ".png"
            $Path = [System.IO.Path]::Combine($tempDir, $fileName)
        }
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
        $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose()
        $bmp.Dispose()
        @{
            success = $true
            path = $Path
            width = $screen.Width
            height = $screen.Height
        } | ConvertTo-Json -Compress
    }

    "move" {
        [NativeMethods]::SetCursorPos($X, $Y) | Out-Null
        @{ success = $true; x = $X; y = $Y } | ConvertTo-Json -Compress
    }

    "click" {
        if ($X -ge 0 -and $Y -ge 0) {
            [NativeMethods]::SetCursorPos($X, $Y) | Out-Null
            Start-Sleep -Milliseconds 40
        }
        $down = [NativeMethods]::MOUSEEVENTF_LEFTDOWN
        $up = [NativeMethods]::MOUSEEVENTF_LEFTUP
        if ($Button -eq "right") {
            $down = [NativeMethods]::MOUSEEVENTF_RIGHTDOWN
            $up = [NativeMethods]::MOUSEEVENTF_RIGHTUP
        } elseif ($Button -eq "middle") {
            $down = [NativeMethods]::MOUSEEVENTF_MIDDLEDOWN
            $up = [NativeMethods]::MOUSEEVENTF_MIDDLEUP
        }

        [NativeMethods]::mouse_event($down, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 25
        [NativeMethods]::mouse_event($up, 0, 0, 0, 0)

        if ($DoubleClick) {
            Start-Sleep -Milliseconds 90
            [NativeMethods]::mouse_event($down, 0, 0, 0, 0)
            Start-Sleep -Milliseconds 25
            [NativeMethods]::mouse_event($up, 0, 0, 0, 0)
        }
        $pos = [System.Windows.Forms.Cursor]::Position
        @{ success = $true; button = $Button; x = $pos.X; y = $pos.Y; double = [bool]$DoubleClick } | ConvertTo-Json -Compress
    }

    "drag" {
        [NativeMethods]::SetCursorPos($StartX, $StartY) | Out-Null
        Start-Sleep -Milliseconds 50
        [NativeMethods]::mouse_event([NativeMethods]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 50

        # 平滑过渡几步
        $steps = 10
        for ($i = 1; $i -le $steps; $i++) {
            $curX = [int]($StartX + ($EndX - $StartX) * ($i / $steps))
            $curY = [int]($StartY + ($EndY - $StartY) * ($i / $steps))
            [NativeMethods]::SetCursorPos($curX, $curY) | Out-Null
            Start-Sleep -Milliseconds 15
        }
        [NativeMethods]::SetCursorPos($EndX, $EndY) | Out-Null
        Start-Sleep -Milliseconds 40
        [NativeMethods]::mouse_event([NativeMethods]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        @{ success = $true; from = @{ x = $StartX; y = $StartY }; to = @{ x = $EndX; y = $EndY } } | ConvertTo-Json -Compress
    }

    "scroll" {
        # $ScrollDelta 通常为 120 的倍数，正为向上，负为向下
        [NativeMethods]::mouse_event([NativeMethods]::MOUSEEVENTF_WHEEL, 0, 0, [uint32]$ScrollDelta, 0)
        @{ success = $true; delta = $ScrollDelta } | ConvertTo-Json -Compress
    }

    "type" {
        if ($Base64Text) {
            $rawBytes = [System.Convert]::FromBase64String($Base64Text)
            $text = [System.Text.Encoding]::UTF8.GetString($rawBytes)
            # 通过剪贴板粘贴能完美支持 Unicode、中文和符号
            [System.Windows.Forms.Clipboard]::SetText($text)
            Start-Sleep -Milliseconds 50
            [System.Windows.Forms.SendKeys]::SendWait("^v")
            @{ success = $true; length = $text.Length } | ConvertTo-Json -Compress
        } else {
            @{ success = $false; error = "Empty text" } | ConvertTo-Json -Compress
        }
    }

    "key" {
        # 支持常见快捷键解析或标准 SendKeys
        # 预设特殊别名
        $mapped = switch ($Key.ToLower()) {
            "enter"     { "{ENTER}" }
            "return"    { "{ENTER}" }
            "esc"       { "{ESC}" }
            "escape"    { "{ESC}" }
            "backspace" { "{BACKSPACE}" }
            "tab"       { "{TAB}" }
            "up"        { "{UP}" }
            "down"      { "{DOWN}" }
            "left"      { "{LEFT}" }
            "right"     { "{RIGHT}" }
            "delete"    { "{DELETE}" }
            "home"      { "{HOME}" }
            "end"       { "{END}" }
            "pageup"    { "{PGUP}" }
            "pagedown"  { "{PGDN}" }
            "space"     { " " }
            default     { $Key }
        }
        [System.Windows.Forms.SendKeys]::SendWait($mapped)
        @{ success = $true; key = $Key } | ConvertTo-Json -Compress
    }

    default {
        @{ success = $false; error = "Unknown action: $Action" } | ConvertTo-Json -Compress
    }
}
