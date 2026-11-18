interface TestEmailRequest {
  homey: {
    app: {
      sendTestEmail(): Promise<void>;
    };
  };
}

interface BrowserPasswordRequest {
  homey: {
    cloud: {
      getLocalAddress(): Promise<string>;
    };
    app: {
      setBrowserSettingsPassword(password: unknown, username: unknown): void;
      getBrowserSettingsUsername(): string;
    };
  };
  body: {
    password: unknown;
    username: unknown;
  };
}

export async function setBrowserPassword({ homey, body }: BrowserPasswordRequest): Promise<{ success: true }> {
  homey.app.setBrowserSettingsPassword(body.password, body.username);
  return { success: true };
}

export async function getBrowserUsername(
  { homey }: BrowserPasswordRequest,
): Promise<{ username: string; host?: string }> {
  let host: string | undefined;
  try {
    host = (await homey.cloud.getLocalAddress()).replace(/:\d+$/, '');
  } catch {
    host = undefined;
  }
  return { username: homey.app.getBrowserSettingsUsername(), host };
}

interface SyncCalendarsRequest {
  homey: {
    app: {
      syncCalendars(): Promise<{
        events: number;
        added: Array<{ calendar: string; title: string; start: string }>;
        changed: Array<{ calendar: string; title: string; start: string }>;
        failedCalendars: string[];
        failures: Array<{ calendar: string; error: string }>;
      }>;
    };
  };
}

interface SetCountdownRemainingRequest {
  homey: {
    app: {
      setCountdownRemaining(name: unknown, seconds: unknown): Promise<void>;
    };
  };
  body: {
    name: unknown;
    seconds: unknown;
  };
}

export async function testEmail({ homey }: TestEmailRequest): Promise<{ success: true }> {
  await homey.app.sendTestEmail();
  return { success: true };
}

export async function syncCalendars(
  { homey }: SyncCalendarsRequest,
): Promise<{
  events: number;
  added: Array<{ calendar: string; title: string; start: string }>;
  changed: Array<{ calendar: string; title: string; start: string }>;
  failedCalendars: string[];
  failures: Array<{ calendar: string; error: string }>;
}> {
  return homey.app.syncCalendars();
}

export async function setCountdownRemaining(
  { homey, body }: SetCountdownRemainingRequest,
): Promise<{ success: true }> {
  await homey.app.setCountdownRemaining(body.name, body.seconds);
  return { success: true };
}
