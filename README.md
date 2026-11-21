# Multikit: API, Email, iCal and Timers in one app

Multikit combines a local API, outgoing webhooks, Gmail email, iCal calendars, and countdown timers in one Homey application.

The iCal dashboard widget requires Homey 12.3.0 or later; this release therefore requires Homey 12.3.0 or later.

## Tools in one app

- **Multikit API:** Receive local requests and use them to trigger Homey Flows. Flows can return an empty `200` response or a custom JSON response. Optional token authentication helps protect endpoints.
- **Outgoing webhooks:** Send HTTP or HTTPS requests from a Flow, with an optional JSON headers object and request body.
- **Gmail email:** Configure a Gmail account and send plain-text emails from a Flow. Email actions can be combined with API requests, timer events, and other Homey automation.
- **iCal calendars:** Subscribe to iCalendar (`.ics`) URLs, synchronize upcoming and recurring events automatically or from a Flow, and trigger automations when events start, end, change, or synchronization fails. Flows can check whether an event is ongoing, create Homey-only local events, and remove local events by title.
- **Countdown timers:** Create named timers and control them from Flows. Start fixed or random countdowns, repeat them for multiple rounds, adjust, pause, resume, or stop them, and use timer events and state as Flow triggers and conditions.
- **Virtual devices and modes:** Create Homey devices with selectable controls and sensor values, and independent on/off modes for Flows.

## Dashboard widgets

- **Active timers:** Shows all running and paused countdown timers with their remaining time and repeat-round state.
- **Saved webhook:** Runs one saved webhook selected in the widget settings without exposing its URL, headers, or body.
- **Virtual device value:** Displays and updates one selected capability from a virtual device created by Multikit.
- **Timer control:** Starts, restarts, pauses, resumes, or stops one selected timer.
- **Email quota:** Shows today's Gmail sending usage, recipient limit, configuration state, and last send result.
- **Calendar statistics:** Shows today's, tomorrow's, and all upcoming event counts plus the next event and last synchronization.
- **Upcoming calendar events:** Shows detailed appointments in the configured number of days ahead.

Dashboard widget selections are stored by Homey. Removed timers, saved webhooks, or virtual devices produce a clear widget error until the widget is reconfigured.

## Settings and app updates

The app ID changed from `dev.charlesderidder.homeyhttpapi` to `dev.charlesderidder.multikit`. Homey treats this as a separate app, not an update to the old one: settings, virtual devices, widgets and Flows must be recreated or reconfigured. Keep the old app installed while recording its configuration, and do not uninstall it until the new setup has been verified. Both apps use port 3000 by default; stop the old app or configure different ports before running them at the same time.

The app keeps its configuration in Homey's persistent app settings, separate from the installed app files. Updating the app in place preserves saved API settings and tokens, Gmail credentials, calendar URLs, timer configuration, and active timer state. Do not uninstall the app as part of an update; uninstalling may remove its stored settings. The Gmail app password is never displayed in the settings page: leaving its field blank keeps the saved password, and it is removed only when you explicitly select **Clear the saved app password**.

### Browser settings

Browser access is disabled by default. Open **Configure** in the Homey app and choose a browser username and a password of at least 6 characters. Use a long, unique password for better security. Usernames can contain 1–64 characters, but not a colon, control characters, or leading or trailing whitespace. This Homey page is only used to enable, disable, or recover browser access; all application settings are managed in the browser. Replace `HOMEY_IP` in the address shown there with Homey's local IP address, open `http://HOMEY_IP:3000/multikit-settings/` using your configured API port, and sign in with the username and password you chose. Existing browser credentials remain valid with username `admin` until changed. Calendar synchronization, email testing, and active timer controls are also available on the browser page. Expand the sections to access their controls and help. Browser credentials can be changed or access disabled in either interface; restart the app after changing the server port.

The browser password is independent of the optional API token. While browser access is enabled, the `/multikit-settings` path and its subpaths are reserved by the settings interface and cannot be used for Flow routes. Failed logins are temporarily rate-limited. HTTP does **not** encrypt passwords, tokens, calendar URLs, or other settings; use only a trusted local network, never forward this port to the internet, and use a secure VPN when accessing it remotely. The Gmail app password remains write-only.

## Supported HTTP methods

The trigger card supports `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS`. Routes may be entered as either `status` or `/status`; query parameters do not change the route match.

Request bodies for `POST`, `PUT`, and `PATCH` must contain valid JSON. `HEAD` responses contain the same headers as a normal response but no response body. `OPTIONS` requests include the supported methods in the `Allow` header.

### Select one response value

Add `field` (or the Dutch alias `veld`) to a `GET` request to return one property from the JSON returned by a flow. The app looks for the property both at the top level and inside a `data` object. For example, when `/alles` returns a `Zonsopkomst` property, request:

```text
http://HOMEY_IP:3000/alles?veld=Zonsopkomst
```

If API token authentication is enabled, include the token as well:

```text
http://HOMEY_IP:3000/alles?veld=Zonsopkomst&token=YOUR_TOKEN
```

The response contains only that value in its `data` property. A requested field that does not exist returns `404`.

## iCal calendars

Open the **iCal** settings tab, add a name and an iCalendar (`.ics`) URL for each calendar, and choose the automatic synchronization interval and how many days ahead to load events. Synchronization runs automatically (every 15 minutes by default); disabling it stops automatic synchronization, including on startup and configuration changes. You can still synchronize from the settings page, widget, or the **Synchronize iCal calendars** Flow action. The agenda table can be searched by title, calendar, or location. Recurring events are expanded into individual events for the selected timeframe. Calendar URLs may contain private access tokens; treat them as credentials.

For Google Calendar, copy **Secret address in iCal format** from the calendar's settings. For Outlook, publish the calendar and copy the ICS link. For iCloud, enable **Public Calendar** and copy the original URL; Apple's default Home and Work calendars do not provide public links. Calendar providers that only specify `X-WR-TIMEZONE` without timezone information on events may have their event times interpreted as UTC.

The iCal Flow cards trigger when an event starts or ends, when a synchronized event changes or is added, and when a calendar synchronization fails. After the first successful synchronization, the settings page lists only newly added or changed events; the corresponding Flow triggers send those event details to connected Homey Flows. A failed calendar keeps its previous snapshot and does not create false change notifications. Conditions check whether any event or a title/calendar match is ongoing, whether an event starts within a given number of minutes, or whether a matching event ends within a given number of minutes. Flows can create local events, which exist only in Homey and do not modify the external calendar, and delete local events whose title contains specified text. Trigger cards provide the event title, description, location, calendar, start/end time, duration, URL, status, and UID.

The filtered iCal trigger can be configured for an event starting, ending, being added, or changing. It matches a case-insensitive substring in the title and an exact calendar name (case-insensitive); use `*` for any title or calendar. Added/changed triggers follow the same synchronization and first-snapshot rules as the existing cards.

Pair the **iCal Calendar** device to expose whether any synchronized event is upcoming. The **Upcoming calendar events** dashboard widget displays events over the selected number of days, with optional calendar names and locations, and provides a manual refresh button.

## Countdown timers

Create named timers in the **Timers** tab in app settings. The list can be imported from or exported to a JSON file. Timers keep running across app restarts; the app stores the deadline and resumes a paused timer with its remaining value.
The **Active timers** list in that tab also lets you enter and apply a new remaining time in seconds for a running timer.

The countdown flow cards provide:

- Triggers for reaching zero, reaching a selected value, starting, stopping before zero, changing value, and starting or updating.
- Actions to start a timer for its configured duration only when it is not running, start or reset it to its configured duration regardless of whether it is running, or reset it to a manually entered duration in seconds. The start-or-reset action also starts a paused timer from its configured duration. Other actions can start a fixed or inclusive random duration, optionally repeat it for a chosen number of rounds (up to 1,000), adjust a running or paused timer, stop one or all timers, and pause or resume a timer. Random durations are selected once and reused for every round.
- Conditions for running state, paused state, exact value (or not), and less-than or greater-than comparisons.

Values are measured in whole seconds. The zero trigger includes the completed round number and the number of rounds remaining, and fires when the timer deadline expires, including when an expired timer is recovered after an app restart. A stopped timer is reset to `-1`; a timer that completes its final round remains at `0` until it is started or stopped.

## Virtual devices and modes

In Homey, add a device from **Multikit** and choose **Virtual device** or **Virtual mode**. For a virtual device, choose a Homey class and at least one capability; the class selects a starting preset, and additional controls or sensor values can be searched and selected. Temperature controls offer range, step and measurement precision options. Available classes and capabilities depend on the Homey software version. A virtual device stores its own values; it does not operate a physical device or automatically copy a sensor. Connect it to other devices using Flows.

Choose the default, star or circle icon, or upload a simple SVG (maximum 256 KB). Uploaded icons allow basic shapes and paths but reject scripts, external references, styles and unsupported SVG elements or attributes. Delete the virtual device to remove its uploaded icon.

Homey's standard capability cards provide controls and conditions where supported. The device-specific control-changed trigger and the app-wide virtual-device-changed trigger run for control changes; the latter includes the device name, capability ID and value. Use either sensor action to select a capability or enter its ID and set a value from a Flow; sensor writes do not fire the custom control-changed triggers. The value must match the capability's type and limits.

Modes are independent switches. Their custom triggers fire on a control change, and the two silent actions change the switch without explicitly firing those custom triggers. Homey's standard capability triggers may still react. Existing devices and Flows from another virtual-device app are not migrated: create new devices in Multikit and update those Flows separately.

## Gmail email

Configure a Gmail address and a Google app password in the **Email** settings tab. A Google app password requires 2-Step Verification; do not enter your regular Google account password. The password is stored in the app's Homey settings.

The Email settings tab shows how many messages have been sent today. The app allows up to 500 email messages per local calendar day and up to 500 comma-separated recipients per message. Test emails count toward the daily limit.

Use the **Send an email with Gmail** Flow action to send a plain-text message. It can be connected after the Multikit trigger to send email when a matching request is received. Keep API token authentication enabled for routes that can send email.

## Outgoing webhooks

Use **Send a GET webhook** for a simple request, or **Send an HTTP webhook** for GET, POST, PUT, PATCH, or DELETE with headers and a text body. Enter headers as a JSON object with string values, for example `{"Content-Type":"application/json"}`; use `{}` for no headers. For JSON requests, provide a JSON body and set the content type explicitly. Flow tags can be used in the text fields.

In the browser settings, open **Webhooks** to add, edit, or remove named webhooks. Select one in the **Send a saved webhook** Flow action to reuse its latest saved configuration across Flows. Renaming a webhook preserves its selection; deleting it makes dependent Flow actions fail until another webhook is selected. Saved configuration is static: use the direct webhook action when the URL, headers or body need Flow tags. Up to 50 webhooks and 512 KB in total can be saved; each saved webhook has a maximum of 16 KB of headers and 64 KB of body text.

Saved webhook URLs, headers and bodies are stored in Homey settings and are visible to anyone with browser settings access. They may include API keys or other secrets. Use a unique browser password, a trusted network and HTTPS endpoints where possible; browser settings over HTTP are not encrypted.

Only HTTP and HTTPS URLs are accepted; URL-embedded usernames and passwords are rejected. Responses outside the 200–299 range fail the Flow action, redirects are not followed, and requests time out after 15 seconds. Request and response bodies are limited to 1 MB. The response body is discarded. The app does not automatically retry. Webhook URLs, headers, and bodies may contain secrets: use HTTPS when possible and protect access to Flows and app settings.

## Service status

The **Status** tab in the browser settings shows whether the local API is listening, calendar synchronization status and failures, email configuration and last send result, and the last webhook result. Refresh the tab to update it. Results are kept in memory and reset when the app restarts; a configured Gmail account has not necessarily been successfully tested. The browser settings use the API server, so they cannot display its status when the server is unreachable; check the Homey app log in that case. No credentials or webhook URLs are shown.

For a small surprise, click the Multikit logo in the browser settings five times.

## Why it matters

Some integrations do not require a complex control panel or a broad automation platform. They require a precise point of contact. An external service reports an event, Homey evaluates the current state of the environment, and a response is returned in a way that is both useful and controlled.

This creates a dependable bridge between observation and action: a sensor detects a condition, a script receives the update, and Homey responds with measured logic rather than raw mechanical behavior.

## Operational model

The solution is designed for scenarios where protocol details are not the primary concern, but reliable interaction is. It allows external systems to initiate a request without requiring deep knowledge of the underlying Homey automation structure.

## Security

Token authentication can be enabled in the app settings. Generate a long random token and send it with requests using the preferred header format:

```http
Authorization: Bearer YOUR_TOKEN
```

For simple URL-based clients, the token can also be supplied as `?token=YOUR_TOKEN`. Header authentication is recommended because URL tokens can appear in browser history and intermediary logs. Tokens are compared in constant time, responses are marked `no-store`, and authentication failures are rejected before a Homey flow is triggered. Generating a new token immediately invalidates the previous one.

The application is intended for local-network use only. Do not expose the port directly to the public internet; use a properly secured reverse proxy or VPN when remote access is required.

## Summary

This is a quiet translation layer: a request enters, a response is structured, and the home environment responds with measured precision. In a system that depends on consistency and context, that makes all the difference.
