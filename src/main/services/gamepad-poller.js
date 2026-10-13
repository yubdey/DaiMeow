const { spawn, execSync } = require('child_process');

// XInput 的 P/Invoke 声明。常驻轮询和一次性探测共用同一份，避免两处各写一遍 C#。
const XINPUT_DECL = `Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)]
public struct XINPUT_GAMEPAD {
    public ushort wButtons;
    public byte bLeftTrigger, bRightTrigger;
    public short sThumbLX, sThumbLY, sThumbRX, sThumbRY;
}
[StructLayout(LayoutKind.Sequential)]
public struct XINPUT_STATE {
    public uint dwPacketNumber;
    public XINPUT_GAMEPAD Gamepad;
}
public class XI {
    [DllImport("xinput1_4.dll")]
    public static extern int XInputGetState(int i, ref XINPUT_STATE s);
}
"@
`;

// 一次性探测：查一遍 4 个槽位就退出，不常驻。启动时用它决定要不要起常驻轮询。
// 这一步不能交给渲染层的 Chromium Gamepad API —— 见 GamepadPoller.probeOnce 的说明。
const PS_PROBE_ONCE = `${XINPUT_DECL}
$state = New-Object XINPUT_STATE
for ($i = 0; $i -lt 4; $i++) {
    if ([XI]::XInputGetState($i, [ref]$state) -eq 0) { [Console]::Out.WriteLine('found'); exit }
}
[Console]::Out.WriteLine('none')
`;

// PowerShell script that polls XInput right stick in a loop
const PS_SCRIPT = `${XINPUT_DECL}
$state = New-Object XINPUT_STATE
while ($true) {
    $found = $false
    for ($i = 0; $i -lt 4; $i++) {
        $r = [XI]::XInputGetState($i, [ref]$state)
        if ($r -eq 0) {
            $rx = $state.Gamepad.sThumbRX / 32767.0
            $ry = $state.Gamepad.sThumbRY / 32767.0
            $rxText = $rx.ToString([System.Globalization.CultureInfo]::InvariantCulture)
            $ryText = $ry.ToString([System.Globalization.CultureInfo]::InvariantCulture)
            [Console]::Out.WriteLine("$rxText $ryText")
            [Console]::Out.Flush()
            $found = $true
            break
        }
    }
    if (-not $found) {
        [Console]::Out.WriteLine("none")
        [Console]::Out.Flush()
    }
    Start-Sleep -Milliseconds 50
}
`;

class GamepadPoller {
  constructor(petWindow) {
    this.petWindow = petWindow;
    this.proc = null;
    this.running = false;
  }

  /**
   * 一次性探测：现在有没有能被 XInput 读到的手柄（查完就退出，不常驻）。
   *
   * 为什么不用渲染层的 Chromium Gamepad API 判断：实测（Windows + XInput 手柄）
   * 「启动程序前就已经插好」的手柄不会出现在 navigator.getGamepads() 里，永远是
   * [null,null,null,null] —— 哪怕用户在桌宠窗口上点过、userActivation.hasBeenActive
   * 已经是 true，也照样看不到；只有拔掉再插一次、产生「设备到达」事件之后，
   * Chromium 才会把它枚举出来。XInput 读的是驱动，没有这个限制。
   *
   * 超时 / 出错一律按「没有手柄」处理：宁可少起一个常驻进程，也不要卡住启动流程。
   */
  static probeOnce(timeoutMs = 5000) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
      let proc;
      try {
        proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS_PROBE_ONCE], {
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        });
      } catch (err) {
        finish(false);
        return;
      }
      let out = '';
      const timer = setTimeout(() => {
        try { proc.kill(); } catch { /* 可能已退出 */ }
        finish(false);
      }, timeoutMs);
      proc.stdout.on('data', (chunk) => {
        out += chunk.toString();
        if (out.includes('found')) {
          clearTimeout(timer);
          try { proc.kill(); } catch { /* 可能已退出 */ }
          finish(true);
        }
      });
      proc.on('error', () => { clearTimeout(timer); finish(false); });
      proc.on('exit', () => { clearTimeout(timer); finish(out.includes('found')); });
    });
  }

  start() {
    if (this.running) return;
    this.running = true;

    try {
      this.proc = spawn('powershell', [
        '-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT
      ], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });

      let buffer = '';
      this.proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'none') continue;
          const parts = trimmed.split(' ');
          if (parts.length < 2) continue;
          const rx = parseFloat(parts[0]);
          const ry = parseFloat(parts[1]);
          if (isNaN(rx) || isNaN(ry)) continue;

          const DEADZONE = 0.15;
          const relX = Math.abs(rx) > DEADZONE ? rx : 0;
          const relY = Math.abs(ry) > DEADZONE ? ry : 0;

          if (this.petWindow && !this.petWindow.isDestroyed()) {
            this.petWindow.webContents.send('pet:gamepad-pos', { relX, relY });
          }
        }
      });

      this.proc.on('error', (err) => {
        console.error('[GamepadPoller] PowerShell error:', err.message);
        // spawn 失败（如找不到 powershell）不会触发 exit，
        // 这里必须复位状态，否则停止后无法再次启动轮询。
        this.running = false;
        this.proc = null;
      });

      // PowerShell 进程退出时重置状态（崩溃后允许重启）
      this.proc.on('exit', () => {
        this.proc = null;
        this.running = false;
      });
    } catch (err) {
      console.error('[GamepadPoller] Failed to start:', err.message);
    }
  }

  stop() {
    this.running = false;
    if (this.proc) {
      try {
        // force kill 整个进程树，避免 PowerShell 在 Start-Sleep 中不响应 kill
        execSync(`taskkill /F /T /PID ${this.proc.pid}`, { windowsHide: true, stdio: 'ignore' });
      } catch {
        // 进程可能已退出，忽略
      }
      this.proc = null;
    }
  }
}

module.exports = { GamepadPoller };
