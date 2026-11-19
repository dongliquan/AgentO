/**
 * Keep the computer from going to sleep while sessions work. A locked screen or a switched-off display does not stop
 * anything — only the system sleeping does (the CLIs are frozen, network calls time out, the daemon misses its timers).
 * While at least one session works (and for a few minutes after), the system is asked to stay awake; the display may
 * still turn off. Nothing is held while everything rests, so the normal sleep timers apply then.
 *
 * Windows: a small PowerShell process holds ES_SYSTEM_REQUIRED (SetThreadExecutionState) and ends when the daemon does.
 * macOS: `caffeinate -i` on the daemon's pid. Others: nothing. AGENTO_KEEP_AWAKE=0 turns it off.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { log } from './log';

const ENABLED = process.env['AGENTO_KEEP_AWAKE'] !== '0';
/** how long after the last busy moment the hold stays (brief gaps between turns must not let the computer sleep) */
const GRACE_MS = 3 * 60_000;

function psScript(parent: number): string {
  return [
    `Add-Type -Namespace W -Name P -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'`,
    // ES_CONTINUOUS | ES_SYSTEM_REQUIRED
    `[void][W.P]::SetThreadExecutionState(0x80000001)`,
    `while (Get-Process -Id ${parent} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 5 }`
  ].join('; ');
}

export class KeepAwake {
  private child: ChildProcess | null = null;
  private lastBusy = 0;
  private timer: NodeJS.Timeout | null = null;

  /** call with "is any session working now" whenever it may have changed (and on a timer: the grace ends by itself) */
  update(busy: boolean): void {
    if (!ENABLED) return;
    const now = Date.now();
    if (busy) this.lastBusy = now;
    const want = busy || now - this.lastBusy < GRACE_MS;
    if (want && !this.child) this.start();
    else if (!want && this.child) this.stop();
    if (this.child && !this.timer) this.timer = setInterval(() => this.update(false), 30_000);
    if (!this.child && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private start(): void {
    try {
      let child: ChildProcess;
      if (process.platform === 'win32') {
        const encoded = Buffer.from(psScript(process.pid), 'utf16le').toString('base64');
        child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { stdio: 'ignore', windowsHide: true });
      } else if (process.platform === 'darwin') {
        child = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
      } else return;
      child.on('exit', () => {
        if (this.child === child) this.child = null;
      });
      child.on('error', (e) => {
        log.warn('keep-awake: could not start', e);
        if (this.child === child) this.child = null;
      });
      child.unref();
      this.child = child;
      log.info('keep-awake: on (a session is working)');
    } catch (e) {
      log.warn('keep-awake: could not start', e);
    }
  }

  private stop(): void {
    const c = this.child;
    this.child = null;
    try {
      c?.kill();
    } catch {
      /* ignore */
    }
    log.info('keep-awake: off (everything rests)');
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.child) this.stop();
  }
}
