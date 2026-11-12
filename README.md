# Wall Dashboard
Always-on home dashboard for a wall-mounted tablet. Page 1: clock, rotating weather (Land O' Lakes / Spring Hill / Dade City), air quality & heat, today's calendar and the next two weeks.
Calendar data comes from a personal Google Apps Script web app (`Code.gs`); its URL is stored only on the device.

## Nest cameras & thermostats (no hub needed)
The Home page can show live Nest camera video and thermostat readings straight from Google's Device Access API, relayed by the same Apps Script as the calendar.
1. **Device Access**: go to console.nest.google.com/device-access, accept the terms and pay Google's one-time $5 fee.
2. **Google Cloud**: at console.cloud.google.com create a project, enable the *Smart Device Management API*, set up the OAuth consent screen (External, then **Publish app** so the sign-in doesn't expire weekly), and create an OAuth client of type *Web application*. Add your Apps Script `/exec` URL as an *Authorized redirect URI*.
3. **Device Access project**: back in the Device Access console, create a project and paste in the OAuth client ID. Copy the project ID.
4. **Script**: paste the latest `Code.gs` into your Apps Script project, fill in `projectId`, `clientId` and `clientSecret` in the `NEST` block, then Deploy → Manage deployments → edit → New version (approve the new permissions).
5. **Link**: open your `/exec` URL with `?nest=setup` on the end, sign in, and tick the cameras and thermostats to share.
Older Nest cameras that only offer RTSP can't play in a web page and are skipped. Live video only runs while the Home page is on screen.
