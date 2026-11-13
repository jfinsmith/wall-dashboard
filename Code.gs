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
  if (p.st === 'setup' || (p.code && String(p.state || '').indexOf('st-') === 0)) return stPage_(p);
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
  if (q.st) return stPost_(q);
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

/* =====================================================================================
 * Lights through Samsung SmartThings (optional). Fill in the two values below, deploy a
 * new version, then open  <your /exec URL>?st=setup  once to approve access.
 * ===================================================================================== */
var ST = {
  clientId: '',      // from the SmartThings app registration
  clientSecret: ''
};
var ST_API = 'https://api.smartthings.com/';
function stReady_() { return ST.clientId && ST.clientSecret; }
function stAuthHeader_() { return { Authorization: 'Basic ' + Utilities.base64Encode(ST.clientId + ':' + ST.clientSecret) }; }

function stPage_(p) {
  var url = ScriptApp.getService().getUrl();
  if (!stReady_()) return HtmlService.createHtmlOutput('<h2>SmartThings isn\'t set up yet</h2><p>Fill in clientId and clientSecret in the ST section of the script, then deploy a new version.</p>');
  if (p.code) {
    if (p.state !== props_().getProperty('ST_STATE')) return HtmlService.createHtmlOutput('<h2>That sign-in link expired</h2><p>Open ?st=setup again.</p>');
    var r = UrlFetchApp.fetch(ST_API + 'oauth/token', { method: 'post', muteHttpExceptions: true, headers: stAuthHeader_(),
      payload: { grant_type: 'authorization_code', client_id: ST.clientId, code: p.code, redirect_uri: url } });
    var t = JSON.parse(r.getContentText() || '{}');
    if (!t.refresh_token) return HtmlService.createHtmlOutput('<h2>SmartThings didn\'t return a key</h2><pre>' + r.getContentText().replace(/</g, '&lt;') + '</pre>');
    props_().setProperty('ST_REFRESH', t.refresh_token); props_().deleteProperty('ST_STATE');
    CacheService.getScriptCache().put('st_at', t.access_token, 20 * 3600); CacheService.getScriptCache().remove('st_devs');
    return HtmlService.createHtmlOutput('<h2>✅ SmartThings is linked</h2><p>Your lights will appear on the dashboard\'s Home page within a minute. You can close this tab.</p>');
  }
  var state = 'st-' + Utilities.getUuid(); props_().setProperty('ST_STATE', state);
  var link = ST_API + 'oauth/authorize?response_type=code&client_id=' + encodeURIComponent(ST.clientId) + '&redirect_uri=' + encodeURIComponent(url) +
    '&scope=' + encodeURIComponent('r:devices:* x:devices:*') + '&state=' + state;
  return HtmlService.createHtmlOutput('<h2>Link SmartThings</h2><p><a target="_top" href="' + link + '" style="font-size:1.3em">Sign in with Samsung and approve →</a></p>' +
    '<p>Status: ' + (props_().getProperty('ST_REFRESH') ? 'already linked (signing in again re-links)' : 'not linked yet') + '</p>');
}

function stToken_() {
  var c = CacheService.getScriptCache(), at = c.get('st_at'); if (at) return at;
  var lock = LockService.getScriptLock(); lock.waitLock(20000);   // refresh keys are single-use: only one refresh at a time
  try {
    at = c.get('st_at'); if (at) return at;
    var rt = props_().getProperty('ST_REFRESH'); if (!rt) throw new Error('not_linked');
    var r = UrlFetchApp.fetch(ST_API + 'oauth/token', { method: 'post', muteHttpExceptions: true, headers: stAuthHeader_(),
      payload: { grant_type: 'refresh_token', client_id: ST.clientId, refresh_token: rt } });
    var t = JSON.parse(r.getContentText() || '{}');
    if (!t.access_token) throw new Error('SmartThings sign-in expired: open ?st=setup again');
    if (t.refresh_token) props_().setProperty('ST_REFRESH', t.refresh_token);
    c.put('st_at', t.access_token, 20 * 3600);
    return t.access_token;
  } finally { lock.releaseLock(); }
}
/** Keeps the SmartThings sign-in alive even if the dashboard is off for weeks. Run stKeepAliveInstall once from the editor (optional). */
function stKeepAlive() { CacheService.getScriptCache().remove('st_at'); stToken_(); }
function stKeepAliveInstall() { ScriptApp.newTrigger('stKeepAlive').timeBased().everyDays(7).create(); }

function stPost_(q) {
  if (!stReady_()) return json_({ st: false });
  if (!props_().getProperty('ST_REFRESH')) return json_({ st: false, linked: false });
  try {
    var h = { Authorization: 'Bearer ' + stToken_() }, c = CacheService.getScriptCache();
    if (q.st === 'devices') {
      var devs = JSON.parse(c.get('st_devs') || 'null');
      if (!devs) {
        var r = UrlFetchApp.fetch(ST_API + 'v1/devices?capability=switch', { headers: h, muteHttpExceptions: true });
        if (r.getResponseCode() >= 400) throw new Error('SmartThings error ' + r.getResponseCode());
        devs = (JSON.parse(r.getContentText()).items || []).map(function (d) {
          var caps = {}; (d.components || []).forEach(function (cm) { (cm.capabilities || []).forEach(function (k) { caps[k.id] = 1; }); });
          return { id: d.deviceId, name: d.label || d.name, caps: caps };
        }).filter(function (d) { // lights only: dimmable or colour, and not a TV or speaker
          return (d.caps.switchLevel || d.caps.colorControl || d.caps.colorTemperature) && !d.caps.tvChannel && !d.caps.audioVolume && !d.caps.mediaPlayback;
        }).map(function (d) { return { id: d.id, name: d.name }; });
        c.put('st_devs', JSON.stringify(devs), 600);
      }
      var res = UrlFetchApp.fetchAll(devs.map(function (d) { return { url: ST_API + 'v1/devices/' + d.id + '/status', headers: h, muteHttpExceptions: true }; }));
      return json_({ st: true, devices: devs.map(function (d, i) {
        var m = {}; try { m = JSON.parse(res[i].getContentText()).components.main || {}; } catch (err) {}
        var v = function (cap, attr) { return m[cap] && m[cap][attr] ? m[cap][attr].value : null; };
        return { id: d.id, name: d.name, on: v('switch', 'switch') === 'on', level: v('switchLevel', 'level'), hue: v('colorControl', 'hue'), sat: v('colorControl', 'saturation'),
          online: res[i].getResponseCode() < 400 && v('switch', 'switch') != null };
      }) });
    }
    if (q.st === 'cmd' && /^[0-9a-f-]{36}$/i.test(q.device || '')) {
      var r2 = UrlFetchApp.fetch(ST_API + 'v1/devices/' + q.device + '/commands', { method: 'post', contentType: 'application/json', headers: h, muteHttpExceptions: true,
        payload: JSON.stringify({ commands: [{ component: 'main', capability: 'switch', command: q.on ? 'on' : 'off' }] }) });
      return r2.getResponseCode() < 400 ? json_({ st: true, ok: true }) : json_({ st: true, error: 'SmartThings refused (' + r2.getResponseCode() + ')' });
    }
    return json_({ st: true, error: 'unknown request' });
  } catch (err) { return json_({ st: true, error: String(err.message || err) }); }
}
