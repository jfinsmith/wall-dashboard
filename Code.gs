/**
 * Home Dashboard — calendar feed.
 * Reads every calendar on your Google account (your own, shared, subscribed, holidays)
 * and returns the next ~2 weeks of events as JSON for the wall dashboard.
 *
 * Setup: script.google.com → New project → paste this → Deploy → New deployment →
 *        type "Web app", Execute as "Me", Who has access "Anyone" → Deploy → copy the /exec URL.
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.nest === 'setup' || p.code) return nestPage_(p);
  var days = Math.min(Number(p.days || 16), 60);   // days ahead
  var back = Math.min(Number(p.back || 0), 31);    // days back (earlier this week)
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var start = new Date(today.getTime() - back * 86400000);
  var end = new Date(today.getTime() + days * 86400000);
  var out = { calendars: [], events: [], tz: tz, generated: now.toISOString() };

  CalendarApp.getAllCalendars().forEach(function (c) {
    var id = c.getId();
    out.calendars.push({
      id: id, name: c.getName(), color: c.getColor(),
      primary: c.isMyPrimaryCalendar(), selected: c.isSelected(), hidden: c.isHidden()
    });
    var evs = [];
    try { evs = c.getEvents(start, end); } catch (err) { return; }
    evs.forEach(function (ev) {
      var allDay = ev.isAllDayEvent();
      out.events.push({
        cal: id,
        title: ev.getTitle() || '(busy)',
        allDay: allDay,
        start: allDay ? Utilities.formatDate(ev.getStartTime(), tz, 'yyyy-MM-dd') : ev.getStartTime().toISOString(),
        end: allDay ? Utilities.formatDate(ev.getEndTime(), tz, 'yyyy-MM-dd') : ev.getEndTime().toISOString(),
        location: ev.getLocation() || ''
      });
    });
  });

  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* =====================================================================================
 * Nest cameras + thermostats (optional) — Google's official Device Access API.
 * Fill in the three values below (see the setup steps in the dashboard README), deploy a
 * new version, then open  <your /exec URL>?nest=setup  once to link your Nest devices.
 * Nothing here is ever published: this script lives only in your Google account.
 * ===================================================================================== */
var NEST = {
  projectId: '',     // Device Access project ID (console.nest.google.com/device-access)
  clientId: '',      // OAuth client ID (console.cloud.google.com)
  clientSecret: ''   // OAuth client secret
};
var SDM = 'https://smartdevicemanagement.googleapis.com/v1/';

function nestReady_() { return NEST.projectId && NEST.clientId && NEST.clientSecret; }
function props_() { return PropertiesService.getScriptProperties(); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** Setup page (?nest=setup) and the sign-in return (?code=…). Called from doGet. */
function nestPage_(p) {
  var url = ScriptApp.getService().getUrl();
  if (!nestReady_()) return HtmlService.createHtmlOutput('<h2>Nest isn\'t set up yet</h2><p>Fill in projectId, clientId and clientSecret at the top of the NEST section in the script, then deploy a new version.</p>');
  if (p.code) {
    if (p.state !== props_().getProperty('NEST_STATE')) return HtmlService.createHtmlOutput('<h2>That sign-in link expired</h2><p>Open ?nest=setup again.</p>');
    var r = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v4/token', { method: 'post', muteHttpExceptions: true,
      payload: { client_id: NEST.clientId, client_secret: NEST.clientSecret, code: p.code, grant_type: 'authorization_code', redirect_uri: url } });
    var t = JSON.parse(r.getContentText());
    if (!t.refresh_token) return HtmlService.createHtmlOutput('<h2>Google didn\'t return a key</h2><pre>' + r.getContentText().replace(/</g, '&lt;') + '</pre>');
    props_().setProperty('NEST_REFRESH', t.refresh_token); props_().deleteProperty('NEST_STATE');
    CacheService.getScriptCache().remove('nest_at');
    return HtmlService.createHtmlOutput('<h2>✅ Nest is linked</h2><p>Your cameras and thermostats will appear on the dashboard\'s Home page within a minute. You can close this tab.</p>');
  }
  var state = Utilities.getUuid(); props_().setProperty('NEST_STATE', state);
  var link = 'https://nestservices.google.com/partnerconnections/' + NEST.projectId + '/auth?redirect_uri=' + encodeURIComponent(url) +
    '&access_type=offline&prompt=consent&response_type=code&scope=' + encodeURIComponent('https://www.googleapis.com/auth/sdm.service') +
    '&client_id=' + encodeURIComponent(NEST.clientId) + '&state=' + state;
  return HtmlService.createHtmlOutput('<h2>Link your Nest devices</h2><p>Redirect address to register on your OAuth client:<br><code>' + url + '</code></p>' +
    '<p><a target="_top" href="' + link + '" style="font-size:1.3em">Sign in with Google and choose your devices →</a></p>' +
    '<p>Status: ' + (props_().getProperty('NEST_REFRESH') ? 'already linked (signing in again re-links)' : 'not linked yet') + '</p>');
}

function nestToken_() {
  var c = CacheService.getScriptCache(), at = c.get('nest_at'); if (at) return at;
  var rt = props_().getProperty('NEST_REFRESH'); if (!rt) throw new Error('not_linked');
  var r = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v4/token', { method: 'post', muteHttpExceptions: true,
    payload: { client_id: NEST.clientId, client_secret: NEST.clientSecret, refresh_token: rt, grant_type: 'refresh_token' } });
  var t = JSON.parse(r.getContentText());
  if (!t.access_token) throw new Error('Google sign-in expired: open ?nest=setup again (' + (t.error || r.getResponseCode()) + ')');
  c.put('nest_at', t.access_token, Math.max(60, (t.expires_in || 3600) - 300));
  return t.access_token;
}
function sdm_(path, body) {
  var o = { headers: { Authorization: 'Bearer ' + nestToken_() }, muteHttpExceptions: true };
  if (body) { o.method = 'post'; o.contentType = 'application/json'; o.payload = JSON.stringify(body); }
  var r = UrlFetchApp.fetch(SDM + path, o), j = JSON.parse(r.getContentText() || '{}');
  if (r.getResponseCode() >= 400) throw new Error((j.error && j.error.message) || ('Nest error ' + r.getResponseCode()));
  return j;
}

/** The dashboard talks to Nest through here (POST with a small JSON body). */
function doPost(e) {
  var q = {}; try { q = JSON.parse(e.postData.contents); } catch (err) {}
  if (!nestReady_()) return json_({ nest: false });
  if (!props_().getProperty('NEST_REFRESH')) return json_({ nest: false, linked: false });
  try {
    if (q.nest === 'devices') {
      var list = sdm_('enterprises/' + NEST.projectId + '/devices').devices || [];
      return json_({ nest: true, devices: list.map(function (d) {
        var t = d.traits || {}, room = (d.parentRelations && d.parentRelations[0] && d.parentRelations[0].displayName) || '';
        var o = { id: d.name, type: d.type.split('.').pop(), name: (t['sdm.devices.traits.Info'] || {}).customName || room || 'Nest' };
        var live = t['sdm.devices.traits.CameraLiveStream']; if (live) o.protocols = live.supportedProtocols || [];
        var temp = t['sdm.devices.traits.Temperature'];
        if (temp) {
          var sp = t['sdm.devices.traits.ThermostatTemperatureSetpoint'] || {};
          o.thermostat = { c: temp.ambientTemperatureCelsius, humidity: (t['sdm.devices.traits.Humidity'] || {}).ambientHumidityPercent,
            mode: (t['sdm.devices.traits.ThermostatMode'] || {}).mode, eco: (t['sdm.devices.traits.ThermostatEco'] || {}).mode,
            hvac: (t['sdm.devices.traits.ThermostatHvac'] || {}).status, heatC: sp.heatCelsius, coolC: sp.coolCelsius,
            online: (t['sdm.devices.traits.Connectivity'] || {}).status !== 'OFFLINE' };
        }
        return o;
      }) });
    }
    if (!/^enterprises\/[^\/]+\/devices\/[^\/]+$/.test(q.device || '')) return json_({ nest: true, error: 'bad device' });
    var cmd = q.nest === 'offer' ? { command: 'sdm.devices.commands.CameraLiveStream.GenerateWebRtcStream', params: { offerSdp: q.sdp } }
      : q.nest === 'extend' ? { command: 'sdm.devices.commands.CameraLiveStream.ExtendWebRtcStream', params: { mediaSessionId: q.session } }
      : q.nest === 'stop' ? { command: 'sdm.devices.commands.CameraLiveStream.StopWebRtcStream', params: { mediaSessionId: q.session } } : null;
    if (!cmd) return json_({ nest: true, error: 'unknown request' });
    return json_({ nest: true, results: sdm_(q.device + ':executeCommand', cmd).results || {} });
  } catch (err) { return json_({ nest: true, error: String(err.message || err) }); }
}
