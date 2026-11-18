import {
  createHash, randomBytes, scryptSync, timingSafeEqual,
} from 'crypto';
import { readFile } from 'fs/promises';
import { IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';
import { validateStoredWebhooks } from './webhook';

const PREFIX = '/multikit-settings';
const PASSWORD_KEY = 'browserSettingsPassword';
const READABLE = new Set([
  'serverPort', 'corsStatus', 'corsAcao', 'authEnabled', 'apiToken', 'gmailAddress',
  'icalCalendars', 'icalSyncInterval', 'icalSyncDays', 'icalAutoSync', 'countdownTimerNames',
  'countdownTimerDurations', 'countdownTimerStates', 'emailDailyUsage', 'webhooks',
]);
const WRITABLE = new Set([...READABLE, 'gmailAppPassword']);
WRITABLE.delete('countdownTimerStates');
WRITABLE.delete('emailDailyUsage');

interface BrowserSettingsApp {
  homey: {
    settings: {
      get(key: string): unknown;
      set(key: string, value: unknown): void;
      unset(key: string): void;
    };
  };
  sendTestEmail(): Promise<void>;
  syncCalendars(): Promise<unknown>;
  setCountdownRemaining(name: unknown, seconds: unknown): Promise<void>;
  getStatus(): object;
  getICalEventList(): unknown[];
  error(...args: unknown[]): void;
}

function validValue(key: string, value: unknown): boolean {
  if (key === 'webhooks') {
    try {
      validateStoredWebhooks(value);
      return true;
    } catch {
      return false;
    }
  }
  if (key === 'serverPort') return typeof value === 'string' && /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;
  if (key === 'corsStatus' || key === 'authEnabled') return value === 'true' || value === 'false';
  if (['corsAcao', 'apiToken', 'gmailAddress', 'gmailAppPassword'].includes(key)) return typeof value === 'string' && value.length <= 4096;
  if (key === 'icalSyncInterval') return Number.isSafeInteger(value) && Number(value) >= 5 && Number(value) <= 1440;
  if (key === 'icalSyncDays') return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 365;
  if (key === 'icalAutoSync') return typeof value === 'boolean';
  if (key === 'countdownTimerNames') {
    return Array.isArray(value) && value.every((name) => typeof name === 'string' && name.trim() === name && name.length > 0 && name.length <= 80)
      && new Set(value.map((name: string) => name.toLowerCase())).size === value.length;
  }
  if (key === 'countdownTimerDurations') {
    return !!value && typeof value === 'object' && !Array.isArray(value)
      && Object.entries(value).every(([name, seconds]) => name.length > 0 && name.length <= 80
        && Number.isSafeInteger(seconds) && Number(seconds) >= 1 && Number(seconds) <= 8640000000000);
  }
  if (key === 'icalCalendars') {
    if (!Array.isArray(value)) return false;
    const names = new Set<string>();
    return value.every((calendar: unknown) => {
      if (!calendar || typeof calendar !== 'object' || !('name' in calendar) || !('url' in calendar)
        || typeof calendar.name !== 'string' || typeof calendar.url !== 'string'
        || !calendar.name.trim() || calendar.name.length > 80 || calendar.name !== calendar.name.trim()) return false;
      try {
        const url = new URL(calendar.url);
        const name = calendar.name.toLowerCase();
        if (!['http:', 'https:'].includes(url.protocol) || names.has(name)) return false;
        names.add(name);
        return true;
      } catch {
        return false;
      }
    });
  }
  return false;
}

export default class BrowserSettings {
  private readonly app: BrowserSettingsApp;
  private readonly assetRoot: string;
  private failures: number[] = [];
  private cachedAuth = '';
  private cachedUntil = 0;

  constructor(app: BrowserSettingsApp, assetRoot = join(__dirname, '..')) {
    this.app = app;
    this.assetRoot = assetRoot;
  }

  getUsername(): string {
    const stored = this.app.homey.settings.get(PASSWORD_KEY);
    if (typeof stored !== 'string' || !stored) return 'admin';
    const parts = stored.split(':');
    if (parts.length === 2) return 'admin';
    if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[2])) {
      throw new Error('Saved browser credentials are invalid.');
    }
    return Buffer.from(parts[2], 'base64url').toString('utf8');
  }

  setPassword(password: unknown, username: unknown = 'admin'): void {
    if (typeof password !== 'string' || (password !== '' && (password.length < 6 || Buffer.byteLength(password) > 1024))) {
      throw new Error('The browser settings password must contain at least 6 characters and at most 1024 bytes.');
    }
    if (password === '') {
      this.app.homey.settings.unset(PASSWORD_KEY);
    } else {
      if (typeof username !== 'string' || !username.trim() || username !== username.trim()
        // Control characters are explicitly forbidden in browser usernames.
        // eslint-disable-next-line no-control-regex
        || username.length > 64 || /[:\x00-\x1f\x7f]/.test(username)) {
        throw new Error('The username must contain 1 to 64 characters, without colons or control characters.');
      }
      const salt = randomBytes(16).toString('hex');
      const hash = scryptSync(password, salt, 32).toString('hex');
      this.app.homey.settings.set(PASSWORD_KEY, `${salt}:${hash}:${Buffer.from(username, 'utf8').toString('base64url')}`);
    }
    this.cachedAuth = '';
    this.cachedUntil = 0;
    this.failures = [];
  }

  private authenticate(req: IncomingMessage, stored: string): boolean {
    const authorization = req.headers.authorization || '';
    const cacheKey = createHash('sha256').update(stored).update('\0').update(authorization)
      .digest('hex');
    if (this.cachedAuth === cacheKey && Date.now() < this.cachedUntil) return true;
    const parts = stored.split(':');
    if ((parts.length !== 2 && parts.length !== 3) || !/^[a-f0-9]{32}$/.test(parts[0])
      || !/^[a-f0-9]{64}$/.test(parts[1])) return false;
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
    if (!match || authorization.length > 2048) return false;
    const credentials = Buffer.from(match[1], 'base64').toString('utf8');
    const separator = credentials.indexOf(':');
    if (separator < 0 || credentials.slice(0, separator) !== this.getUsername()) return false;
    const supplied = scryptSync(credentials.slice(separator + 1), parts[0], 32);
    const expected = Buffer.from(parts[1], 'hex');
    if (!timingSafeEqual(supplied, expected)) return false;
    this.cachedAuth = cacheKey;
    this.cachedUntil = Date.now() + 60000;
    return true;
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = (req.url || '/').split('?')[0];
    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
    const stored = this.app.homey.settings.get(PASSWORD_KEY);
    if (typeof stored !== 'string' || !stored) return false;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const reply = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };
    this.failures = this.failures.filter((time) => Date.now() - time < 60000);
    if (this.failures.length >= 8) {
      reply(429, { error: 'Too many authentication attempts. Try again in one minute.' });
      return true;
    }
    if (!this.authenticate(req, stored)) {
      this.failures.push(Date.now());
      res.setHeader('WWW-Authenticate', 'Basic realm="Homey Multikit Settings", charset="UTF-8"');
      reply(401, { error: 'Browser settings authentication required.' });
      return true;
    }
    try {
      if (req.method === 'GET') {
        const widgetImages = [
          'active-timers', 'saved-webhooks', 'virtual-value', 'timer-control', 'email-quota', 'calendar-stats',
        ];
        const files: Record<string, string> = {
          [PREFIX]: 'settings/browser.html',
          [`${PREFIX}/`]: 'settings/browser.html',
          [`${PREFIX}/browser.js`]: 'settings/browser-client.txt',
          [`${PREFIX}/en.json`]: 'locales/en.json',
          [`${PREFIX}/nl.json`]: 'locales/nl.json',
          [`${PREFIX}/de.json`]: 'locales/de.json',
          ...Object.fromEntries(widgetImages.map((widget) => (
            [`${PREFIX}/widget-images/${widget}.png`, `widgets/${widget}/public/art.png`]
          ))),
        };
        const file = files[path];
        if (!file) {
          reply(404, { error: 'Not found.' });
          return true;
        }
        const isImage = file.endsWith('.png');
        let content: string | Buffer = await readFile(join(this.assetRoot, file), isImage ? undefined : 'utf8');
        if (file === 'settings/browser.html') {
          content = (content as string).replace('<html lang="en">', '<html lang="en" class="browser-settings">');
          content = (content as string).replace(/<script\s+type="text\/javascript"\s+src="\/homey\.js"\s+data-origin="settings"\s*><\/script>/, `<script src="${PREFIX}/browser.js"></script>`);
        }
        let contentType = 'application/json';
        if (file.endsWith('.html')) contentType = 'text/html';
        if (file.endsWith('.txt')) contentType = 'application/javascript';
        if (isImage) contentType = 'image/png';
        res.writeHead(200, {
          'Content-Type': isImage ? contentType : `${contentType}; charset=utf-8`,
        });
        res.end(content);
        return true;
      }
      if (req.method !== 'POST' || req.headers['x-multikit-settings'] !== '1'
        || req.headers['content-type'] !== 'application/json'
        || req.headers.origin !== `http://${req.headers.host}`) {
        reply(403, { error: 'Invalid browser settings request.' });
        return true;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > 1024 * 1024) {
          reply(413, { error: 'Request body too large.' });
          return true;
        }
        chunks.push(buffer);
      }
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected object');
        body = parsed as Record<string, unknown>;
      } catch {
        reply(400, { error: 'Invalid JSON request.' });
        return true;
      }
      if (path === `${PREFIX}/get` && body.key === 'browserSettingsUsername') {
        reply(200, { value: this.getUsername() });
      } else if (path === `${PREFIX}/get` && typeof body.key === 'string' && READABLE.has(body.key)) {
        reply(200, { value: this.app.homey.settings.get(body.key) ?? null });
      } else if (path === `${PREFIX}/set` && typeof body.key === 'string' && WRITABLE.has(body.key) && validValue(body.key, body.value)) {
        this.app.homey.settings.set(body.key, body.value);
        reply(200, { success: true });
      } else if (path === `${PREFIX}/api/test-email`) {
        await this.app.sendTestEmail();
        reply(200, { success: true });
      } else if (path === `${PREFIX}/api/status`) {
        reply(200, this.app.getStatus());
      } else if (path === `${PREFIX}/api/calendar-events`) {
        reply(200, { events: this.app.getICalEventList() });
      } else if (path === `${PREFIX}/api/sync-calendars`) {
        reply(200, await this.app.syncCalendars());
      } else if (path === `${PREFIX}/api/countdown-remaining`) {
        await this.app.setCountdownRemaining(body.name, body.seconds);
        reply(200, { success: true });
      } else if (path === `${PREFIX}/api/browser-password`) {
        this.setPassword(body.password, body.username);
        reply(200, { success: true });
      } else {
        reply(400, { error: 'Unknown operation or invalid setting value.' });
      }
    } catch (error) {
      this.app.error('Browser settings request failed', error);
      reply(500, { error: error instanceof Error ? error.message : 'Browser settings request failed.' });
    }
    return true;
  }
}
