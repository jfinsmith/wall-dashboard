'use strict';
/* Page 2 — Home: cameras, doors, thermostats and lights from Home Assistant (live over its WebSocket API).
   Uses helpers from app.js ($, esc, S, saveSettings, state, CITIES, icon, wxKind, tShort, events, eventsOn, startOfDay, addDays, relDur, toast). */

S.haUrl = S.haUrl || ''; S.haToken = S.haToken || ''; S.haHidden = S.haHidden || {}; S.camSec = S.camSec || 10;

// One-time setup link: …/#ha=<url>&token=<token>
(() => {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('ha') && h.get('token')) {
    S.haUrl = h.get('ha').replace(/\/+$/, ''); S.haToken = h.get('token'); saveSettings();
    history.replaceState(null, '', location.pathname + location.search);
  }
})();

const ICONS = {
  bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.8"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  thermo: '<path d="M14 14.8V3.5a2.5 2.5 0 0 0-5 0v11.3a4.5 4.5 0 1 0 5 0z"/>',
  cam: '<path d="m23 7-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
};
const svgI = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

/* ---------------- Home Assistant connection ---------------- */
const HA = { ws: null, states: {}, ok: false, error: null, id: 1, cb: {}, retry: 5000, pingT: null, stop: false };
const haConfigured = () => !!(S.haUrl && S.haToken);
function haSend(msg, cb) { if (!HA.ws || HA.ws.readyState !== 1) return; msg.id = HA.id++; if (cb) HA.cb[msg.id] = cb; HA.ws.send(JSON.stringify(msg)); }
function haConnect() {
  clearInterval(HA.pingT); try { HA.ws && HA.ws.close(); } catch {}
  HA.ok = false; HA.stop = false;
  if (!haConfigured()) { renderHome(); return; }
  if (!/^https:/i.test(S.haUrl) && location.protocol === 'https:') { HA.error = 'The address must start with https:// (browsers block insecure connections from this page).'; renderHome(); return; }
  let ws;
  try { ws = new WebSocket(S.haUrl.replace(/^http/i, 'ws') + '/api/websocket'); } catch (e) { HA.error = 'Bad address: ' + e.message; renderHome(); return; }
  HA.ws = ws;
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: S.haToken }));
    else if (m.type === 'auth_invalid') { HA.error = 'Home Assistant rejected the access token.'; HA.stop = true; ws.close(); }
    else if (m.type === 'auth_ok') {
      HA.ok = true; HA.error = null; HA.retry = 5000;
      haSend({ type: 'get_states' }, r => { HA.states = {}; (r.result || []).forEach(s => (HA.states[s.entity_id] = s)); renderHome(); renderHaSettings(); });
      haSend({ type: 'subscribe_events', event_type: 'state_changed' });
      HA.pingT = setInterval(() => haSend({ type: 'ping' }), 30000);
    } else if (m.type === 'result' || m.type === 'pong') { const f = HA.cb[m.id]; if (f) { delete HA.cb[m.id]; f(m); } }
    else if (m.type === 'event') {
      const d = m.event.data; if (!/^(camera|lock|climate|light|switch)\./.test(d.entity_id)) return;
      if (d.new_state) HA.states[d.entity_id] = d.new_state; else delete HA.states[d.entity_id];
      scheduleHome();
    }
  };
  ws.onerror = () => { if (!HA.ok && !HA.error) HA.error = 'Can’t reach Home Assistant at that address.'; };
  ws.onclose = () => {
    clearInterval(HA.pingT); HA.ok = false; renderHome();
    if (!HA.stop && haConfigured()) { setTimeout(haConnect, HA.retry); HA.retry = Math.min(HA.retry * 2, 60000); }
  };
}
function haCall(domain, service, entity_id) {
  if (ST.states[entity_id]) return stToggle(ST.states[entity_id]);
  if (!homeLive()) { // sample mode: flip locally
    const s = DEMO.states[entity_id]; if (s) s.state = s.state === 'on' ? 'off' : 'on'; renderHome(); return;
  }
  haSend({ type: 'call_service', domain, service, target: { entity_id } }, r => { if (!r.success) toast('Couldn’t change that: ' + (r.error?.message || 'error')); });
}


/* ---------------- Nest, direct from Google (through the calendar script; no hub needed) ---------------- */
const NEST = { on: false, states: {}, error: null, pc: null, session: null, device: null, extT: null, gen: 0 };
const f2 = c => c == null ? null : c * 9 / 5 + 32;
async function nestPost(body) {
  const r = await fetch(S.calUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  const j = await r.json(); if (j.error) throw new Error(j.error); return j;
}
async function fetchNest() {
  if (!S.calUrl || S.demo) return;
  let j; try { j = await nestPost({ nest: 'devices' }); } catch (e) { if (NEST.on) { NEST.error = e.message; renderHome(); } return; }
  if (!j.nest) { NEST.on = false; return; }
  const st = {};
  (j.devices || []).forEach(d => {
    const key = d.id.split('/').pop().slice(-12).toLowerCase();
    if (d.protocols) st['camera.nest_' + key] = { entity_id: 'camera.nest_' + key, state: 'idle', nest: d.id, webrtc: d.protocols.includes('WEB_RTC'), attributes: { friendly_name: d.name } };
    const t = d.thermostat;
    if (t) {
      const mode = { HEAT: 'heat', COOL: 'cool', HEATCOOL: 'heat_cool', OFF: 'off' }[t.mode] || 'off';
      st['climate.nest_' + key] = { entity_id: 'climate.nest_' + key, state: t.online ? mode : 'unavailable', attributes: { friendly_name: d.name,
        current_temperature: f2(t.c), current_humidity: t.humidity, hvac_action: { HEATING: 'heating', COOLING: 'cooling' }[t.hvac] || 'idle',
        temperature: f2(mode === 'heat' ? t.heatC : t.coolC), target_temp_low: f2(t.heatC), target_temp_high: f2(t.coolC), preset_mode: t.eco === 'MANUAL_ECO' ? 'eco' : null } };
    }
  });
  const first = !NEST.on; NEST.on = true; NEST.error = null; NEST.states = st;
  renderHome(); if (first) renderHaSettings();
}
const SESS = {}; // camera entity id -> { pc, session, device, extT, retryT, gen }
function nestStop(id) {
  const x = SESS[id]; if (!x) return; delete SESS[id];
  clearInterval(x.extT); clearTimeout(x.retryT);
  if (x.session) nestPost({ nest: 'stop', device: x.device, session: x.session }).catch(() => {});
  try { x.pc && x.pc.close(); } catch {}
}
function nestStopAll() { Object.keys(SESS).forEach(nestStop); }
async function nestPlay(s, tile) {
  const id = s.entity_id; nestStop(id);
  const x = SESS[id] = { device: s.nest }, live = () => SESS[id] === x;
  const video = tile.querySelector('video'), note = tile.querySelector('.ph-img');
  const retry = ms => { if (live()) x.retryT = setTimeout(() => { if (live() && homePageVisible() && tile.isConnected) nestPlay(s, tile); }, ms); };
  try {
    const pc = x.pc = new RTCPeerConnection();
    pc.addTransceiver('audio', { direction: 'recvonly' }); pc.addTransceiver('video', { direction: 'recvonly' }); pc.createDataChannel('dataSendChannel');
    pc.ontrack = ev => { if (!live()) return; video.srcObject = ev.streams[0] || new MediaStream([ev.track]); video.play().catch(() => {}); };
    pc.onconnectionstatechange = () => { if (live() && pc.connectionState === 'failed') { video.style.opacity = 0; note.textContent = `Reconnecting ${nameOf(s)}…`; retry(20000); } };
    video.onplaying = () => { video.style.opacity = 1; };
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise(res => { if (pc.iceGatheringState === 'complete') return res(); pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && res(); setTimeout(res, 4000); });
    if (!live()) return;
    const j = await nestPost({ nest: 'offer', device: s.nest, sdp: pc.localDescription.sdp });
    if (!live()) { if (j.results?.mediaSessionId) nestPost({ nest: 'stop', device: s.nest, session: j.results.mediaSessionId }).catch(() => {}); return; }
    x.session = j.results.mediaSessionId;
    await pc.setRemoteDescription({ type: 'answer', sdp: j.results.answerSdp });
    x.extT = setInterval(() => nestPost({ nest: 'extend', device: x.device, session: x.session }).then(r => { if (r.results?.mediaSessionId) x.session = r.results.mediaSessionId; }).catch(() => {}), 4 * 60000);
  } catch (e) { if (live()) { note.textContent = `${nameOf(s)}: ${/rate|quota|limit/i.test(e.message) ? 'Google is limiting requests; retrying shortly.' : e.message}`; retry(60000); } }
}

/* ---------------- Lights through Samsung SmartThings (same Google script) ---------------- */
const ST = { on: false, states: {}, error: null };
function hsv2rgb(h, s) { // SmartThings hue & saturation are 0–100
  h = (h || 0) / 100 * 6; s = Math.min(1, (s || 0) / 100) * .75; const f = n => { const k = (n + h) % 6; return Math.round(255 * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)))); };
  return [f(5), f(3), f(1)];
}
async function fetchST() {
  if (!S.calUrl || S.demo) return;
  let j; try { j = await nestPost({ st: 'devices' }); } catch (e) { if (ST.on) { ST.error = e.message; renderHome(); } return; }
  if (!j.st) { ST.on = false; return; }
  const st = {};
  (j.devices || []).forEach(d => { const id = 'light.st_' + d.id.replace(/-/g, '');
    st[id] = { entity_id: id, st: d.id, state: !d.online ? 'unavailable' : d.on ? 'on' : 'off',
      attributes: { friendly_name: d.name, brightness: d.level != null ? d.level * 2.55 : null, rgb_color: d.sat > 5 ? hsv2rgb(d.hue, d.sat) : [255, 214, 150] } }; });
  const first = !ST.on; ST.on = true; ST.error = null; ST.states = st; renderHome(); if (first) renderHaSettings();
}
let stT = null;
function stToggle(s) {
  const on = s.state !== 'on'; s.state = on ? 'on' : 'off'; renderHome();
  nestPost({ st: 'cmd', device: s.st, on }).catch(e => { toast('Couldn’t change that: ' + e.message); }).finally(() => { clearTimeout(stT); stT = setTimeout(fetchST, 2500); });
}
const homePageVisible = () => document.visibilityState === 'visible' && Math.round(pager.scrollLeft / pager.clientWidth) === 1;

/* ---------------- Sample data (shown until Home Assistant is connected) ---------------- */
function demoCamImg(name, hue) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,22%)"/><stop offset="1" stop-color="hsl(${hue + 30},35%,10%)"/></linearGradient></defs>
    <rect width="640" height="360" fill="url(#g)"/><rect y="270" width="640" height="90" fill="hsl(${hue},20%,14%)"/>
    <path d="M190 270V170l130-80 130 80v100z" fill="hsl(${hue},25%,30%)"/><rect x="295" y="200" width="50" height="70" fill="hsl(40,70%,60%)" opacity=".8"/>
    <rect x="215" y="185" width="45" height="35" fill="hsl(40,70%,65%)" opacity=".6"/><rect x="380" y="185" width="45" height="35" fill="hsl(40,70%,65%)" opacity=".6"/>
    <text x="20" y="34" font-family="monospace" font-size="18" fill="#fff" opacity=".7">${name.toUpperCase()} · SAMPLE</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
const DEMO = { states: {} };
(() => {
  const add = (id, state, attributes) => (DEMO.states[id] = { entity_id: id, state, attributes });
  [['front_door', 'Front Door', 250], ['driveway', 'Driveway', 210], ['backyard', 'Backyard', 160], ['garage', 'Garage', 280]]
    .forEach(([k, n, h]) => add('camera.' + k, 'idle', { friendly_name: n, entity_picture: demoCamImg(n, h) }));
  add('lock.front_door', 'locked', { friendly_name: 'Front Door' });
  add('lock.back_door', 'unlocked', { friendly_name: 'Back Door' });
  add('lock.garage_entry', 'locked', { friendly_name: 'Garage Entry' });
  add('climate.downstairs', 'cool', { friendly_name: 'Downstairs', current_temperature: 74, temperature: 72, hvac_action: 'cooling', current_humidity: 52 });
  add('climate.upstairs', 'heat_cool', { friendly_name: 'Upstairs', current_temperature: 71, target_temp_low: 68, target_temp_high: 75, hvac_action: 'idle', current_humidity: 48 });
  [['living_room', 'Living Room', 'on', 80, [255, 190, 120]], ['kitchen', 'Kitchen', 'on', 100, [255, 236, 200]], ['porch', 'Front Porch', 'on', 60, [255, 170, 80]],
   ['office', 'Office', 'off'], ['bedroom', 'Bedroom', 'off'], ['dining', 'Dining Room', 'off'], ['hallway', 'Hallway', 'off'], ['tv_strip', 'TV Light Strip', 'on', 45, [140, 120, 255]],
   ['garage_l', 'Garage', 'off'], ['patio', 'Patio String Lights', 'off']]
    .forEach(([k, n, st, b, rgb]) => add('light.' + k, st, { friendly_name: n, brightness: b ? Math.round(b * 2.55) : null, rgb_color: rgb }));
})();
const homeLive = () => haConfigured() || NEST.on || ST.on;
const homeStates = () => !homeLive() ? DEMO.states : { ...(haConfigured() ? HA.states : {}), ...NEST.states, ...ST.states };

/* ---------------- Entity selection ---------------- */
const nameOf = s => s.attributes?.friendly_name || s.entity_id.split('.')[1].replace(/_/g, ' ');
function shown(s) { const id = s.entity_id; return id in S.haHidden ? !S.haHidden[id] : !id.startsWith('switch.'); }
function byDomain(...domains) {
  return Object.values(homeStates()).filter(s => domains.includes(s.entity_id.split('.')[0]))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
}

/* ---------------- Rendering ---------------- */
let homeT = null;
function scheduleHome() { if (!homeT) homeT = setTimeout(() => { homeT = null; renderHome(); }, 300); }

function lightTile(s) {
  const on = s.state === 'on', na = s.state === 'unavailable', a = s.attributes || {};
  const pct = a.brightness != null ? Math.round(a.brightness / 2.55) + '%' : 'On';
  const rgb = a.rgb_color ? `rgb(${a.rgb_color.join(',')})` : null;
  const st = na ? 'Unavailable' : on ? pct : 'Off';
  return `<button class="tile${on ? ' on' : ''}${na ? ' na' : ''}" data-toggle="${esc(s.entity_id)}" style="${on && rgb ? `--ic:${rgb}` : ''}">
    <span class="ico">${svgI(s.entity_id.startsWith('switch.') ? 'plug' : 'bulb')}</span><span class="tx"><span class="nm">${esc(nameOf(s))}</span><span class="st">${st}</span></span></button>`;
}
function lockTile(s) {
  const st = s.state, cls = st === 'locked' ? 'ok' : (st === 'unlocked' || st === 'open') ? 'warn' : (st === 'jammed') ? 'bad' : st === 'unavailable' ? 'na' : '';
  const label = { locked: 'Locked', unlocked: 'Unlocked', open: 'Open', locking: 'Locking…', unlocking: 'Unlocking…', jammed: 'Jammed!', unavailable: 'Unavailable' }[st] || st;
  const ic = st === 'locked' || st === 'locking' ? 'lock' : st === 'jammed' ? 'alert' : 'unlock';
  return `<div class="tile ${cls}"><span class="ico">${svgI(ic)}</span><span class="tx"><span class="nm">${esc(nameOf(s))}</span><span class="st">${label}</span></span></div>`;
}
function thermoTile(s) {
  const a = s.attributes || {}, mode = s.state, act = a.hvac_action;
  const cur = a.current_temperature != null ? Math.round(a.current_temperature) + '°' : '—';
  const set = mode === 'heat_cool' || mode === 'auto'
    ? (a.target_temp_low != null ? `${Math.round(a.target_temp_low)}–${Math.round(a.target_temp_high)}°` : 'Auto')
    : a.temperature != null ? `${Math.round(a.temperature)}°` : '';
  const st = s.state === 'unavailable' ? 'Unavailable' : mode === 'off' ? 'Off' : a.preset_mode === 'eco' ? 'Eco'
    : act === 'heating' ? `Heating to ${set}` : act === 'cooling' ? `Cooling to ${set}` : `Idle · set ${set}`;
  const cls = act === 'heating' ? 'heat' : act === 'cooling' ? 'cool' : '';
  const hum = a.current_humidity != null ? `<small> ${Math.round(a.current_humidity)}%</small>` : '';
  return `<div class="tile thermo ${cls}${s.state === 'unavailable' ? ' na' : ''}"><span class="ico">${svgI('thermo')}</span><span class="tx">
    <span class="nm">${esc(nameOf(s))}</span><span class="big">${cur}${hum}</span><span class="st">${st}</span></span></div>`;
}

/* Cameras: all shown together in a grid. Nest video only streams while this page is on screen. Tap one to enlarge. */
let camSnapT = null, camKey = '', camSolo = null;
function camList() { return byDomain('camera').filter(shown).filter(s => !s.nest || s.webrtc); }
function camSrc(s) {
  const p = s.attributes?.entity_picture; if (!p) return null;
  return p.startsWith('data:') ? p : S.haUrl + p + (p.includes('?') ? '&' : '?') + '_=' + Date.now();
}
function renderCam() {
  const box = $('#cam'), cams = camList(), vis = homePageVisible();
  nestStopAll();
  camKey = cams.map(s => s.entity_id).join() + '|' + vis;
  if (!cams.length) { box.className = 'cam'; box.innerHTML = `<div class="ph-img">${homeLive() ? 'No cameras found yet.' : 'Cameras will appear here.'}</div>`; return; }
  if (!cams.some(s => s.entity_id === camSolo)) camSolo = null;
  const cols = cams.length < 2 ? 1 : cams.length <= 4 ? 2 : 3;
  box.className = 'cam grid' + (camSolo ? ' solo' : ''); box.style.setProperty('--cols', cols);
  box.innerHTML = cams.map(s => `<div class="ct${s.entity_id === camSolo ? ' big' : ''}" data-cam="${esc(s.entity_id)}"><div class="ph-img">${vis || !s.nest ? 'Loading ' : ''}${esc(nameOf(s))}${vis || !s.nest ? '…' : ''}</div>
    ${s.nest ? '<video muted playsinline autoplay style="opacity:0"></video>' : '<img alt="" style="opacity:0">'}
    <div class="cname"><i class="live"></i>${esc(nameOf(s))}</div></div>`).join('');
  cams.forEach((s, i) => {
    const tile = box.children[i];
    if (s.nest) { if (vis) setTimeout(() => { if (tile.isConnected) nestPlay(s, tile); }, i * 400); }
    else refreshSnap(s, tile, true);
  });
}
function refreshSnap(s, tile, first) {
  const img = tile.querySelector('img'), src = camSrc(s);
  if (!src) { tile.querySelector('.ph-img').textContent = `${nameOf(s)}: no picture available.`; return; }
  const pre = new Image();
  pre.onload = () => { img.src = pre.src; img.style.opacity = 1; };
  pre.onerror = () => { if (first) tile.querySelector('.ph-img').textContent = `${nameOf(s)}: live view isn’t available as a snapshot.`; };
  pre.src = src;
}
function startCams() {
  clearInterval(camSnapT);
  camSnapT = setInterval(() => { if (!homePageVisible()) return; const cams = camList();
    document.querySelectorAll('#cam .ct').forEach(t => { const s = cams.find(c => c.entity_id === t.dataset.cam); if (s && !s.nest) refreshSnap(s, t, false); }); }, 3000);
}
$('#cam').addEventListener('click', e => {
  const t = e.target.closest('.ct'); if (!t || camList().length < 2) return;
  camSolo = camSolo ? null : t.dataset.cam;
  $('#cam').classList.toggle('solo', !!camSolo); document.querySelectorAll('#cam .ct').forEach(c => c.classList.toggle('big', c.dataset.cam === camSolo));
});

function renderHome() {
  const banner = $('#haBanner');
  const err = (haConfigured() && HA.error) || NEST.error || ST.error;
  banner.hidden = homeLive() && !err;
  banner.textContent = !homeLive() ? 'Sample devices · connect your home in ⚙️' : err ? '⚠️ ' + err : '';
  $('#home').classList.toggle('nest-only', (NEST.on || ST.on) && !haConfigured());
  const locks = byDomain('lock').filter(shown), climate = byDomain('climate').filter(shown);
  const lights = byDomain('light', 'switch').filter(shown).sort((a, b) => (b.state === 'on') - (a.state === 'on'));
  $('#doors').innerHTML = locks.map(lockTile).join('') || '<div class="st" style="color:var(--faint)">No locks found.</div>';
  $('#climate').innerHTML = climate.map(thermoTile).join('') || '<div class="st" style="color:var(--faint)">No thermostats found.</div>';
  $('#lights').innerHTML = lights.map(lightTile).join('') || '<div class="st" style="color:var(--faint)">No lights found.</div>';
  const nOn = lights.filter(l => l.state === 'on').length;
  $('#home').classList.toggle('has-lights', lights.length > 0);
  $('#lightsOn').textContent = lights.length ? `${nOn} of ${lights.length} on` : '';
  if (camKey !== camList().map(s => s.entity_id).join() + '|' + homePageVisible()) renderCam();
  renderSide();
}
$('#lights').addEventListener('click', e => {
  const b = e.target.closest('[data-toggle]'); if (!b) return;
  const id = b.dataset.toggle; b.classList.add('busy'); haCall(id.split('.')[0], 'toggle', id);
});

/* Sidebar: time, weather, home summary, next event */
function renderSide() {
  const locks = byDomain('lock').filter(shown), climate = byDomain('climate').filter(shown);
  const nOn = byDomain('light', 'switch').filter(shown).filter(l => l.state === 'on').length;
  const now = new Date(), h = now.getHours();
  $('#hHm').textContent = (h % 12 || 12) + ':' + String(now.getMinutes()).padStart(2, '0');
  $('#hAmpm').textContent = h < 12 ? 'AM' : 'PM';
  $('#hDate').textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  $('#hGreet').textContent = h < 5 ? 'Hey, night owl' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
  const d = state.wx?.data?.[0];
  if (d) {
    const c = d.current, [, lbl] = wxKind(c.weather_code);
    $('#hWx').innerHTML = `${icon(c.weather_code, c.is_day)}<div><div class="t">${Math.round(c.temperature_2m)}°</div>
      <div class="c">${c.weather_code === 0 ? (c.is_day ? 'Sunny' : 'Clear') : lbl} · H ${Math.round(d.daily.temperature_2m_max[0])}° L ${Math.round(d.daily.temperature_2m_min[0])}°</div><div class="c">${esc(CITIES[0].name)}</div></div>`;
  }
  const open = locks.filter(l => l.state === 'unlocked' || l.state === 'open'), jam = locks.filter(l => l.state === 'jammed');
  const rows = [];
  if (haConfigured() && !HA.ok) rows.push(`<div class="sum"><i class="d bad"></i>${HA.error ? 'Home Assistant problem' : 'Connecting to Home Assistant…'}</div>`);
  if (locks.length) rows.push(jam.length ? `<div class="sum"><i class="d bad"></i><b>${esc(jam.map(nameOf).join(', '))}</b> jammed</div>`
    : open.length ? `<div class="sum"><i class="d warn"></i><span><b>${esc(open.map(nameOf).join(', '))}</b> unlocked</span></div>`
    : `<div class="sum"><i class="d ok"></i><span>All doors locked</span></div>`);
  if (byDomain('light', 'switch').filter(shown).length) rows.push(`<div class="sum"><i class="d ${nOn ? 'on' : ''}"></i><span>${nOn ? `<b>${nOn}</b> light${nOn > 1 ? 's' : ''} on` : 'All lights off'}</span></div>`);
  const t = climate.find(c => c.attributes?.current_temperature != null);
  if (t) { const act = t.attributes.hvac_action; rows.push(`<div class="sum"><i class="d ${act === 'heating' || act === 'cooling' ? 'on' : 'ok'}"></i><span>Inside <b>${Math.round(t.attributes.current_temperature)}°</b>${act === 'heating' ? ' · heating' : act === 'cooling' ? ' · cooling' : ''}</span></div>`); }
  $('#hSum').innerHTML = rows.join('');
  const all = events(), today = startOfDay(now);
  const timed = [...eventsOn(all, today), ...eventsOn(all, addDays(today, 1))].filter(e => !e.allDay && !e.cont);
  const cur = timed.find(e => e.s <= now && e.en > now), nxt = timed.find(e => e.s > now);
  $('#hNext').innerHTML = cur ? `Now<b>${esc(cur.title)}</b>until ${tShort(cur.en)}` : nxt ? `Next<b>${esc(nxt.title)}</b>${nxt.s - now < 6 * 3600000 ? 'in ' + relDur(nxt.s - now) : (startOfDay(nxt.s) > today ? 'tomorrow ' : '') + tShort(nxt.s)}` : '';
}

/* ---------------- Settings ---------------- */
function renderHaSettings() {
  $('#haUrl').value = S.haUrl; $('#haToken').value = S.haToken;
  $('#nestState').textContent = NEST.on ? `✅ Nest linked · ${Object.keys(NEST.states).filter(k => k.startsWith('camera.')).length} cameras, ${Object.keys(NEST.states).filter(k => k.startsWith('climate.')).length} thermostats${NEST.error ? ' · ⚠️ ' + NEST.error : ''}`
    : S.calUrl ? 'Nest isn’t linked yet. Follow “Nest cameras” in the setup guide, then open your calendar address with ?nest=setup on the end.' : 'Connect the calendar first; Nest uses the same Google script.';
  $('#stState').textContent = ST.on ? `✅ SmartThings linked · ${Object.keys(ST.states).length} lights${ST.error ? ' · ⚠️ ' + ST.error : ''}` : 'Lights (SmartThings): not linked yet.';
  $('#haState').textContent = !haConfigured() ? 'Not connected: the Home page is showing sample devices.'
    : HA.ok ? `✅ Connected · ${Object.keys(HA.states).length} entities` : HA.error ? '⚠️ ' + HA.error : 'Connecting…';
  if (!homeLive()) { $('#haToggles').innerHTML = ''; return; }
  const groups = [['Cameras', 'camera'], ['Doors', 'lock'], ['Thermostats', 'climate'], ['Lights', 'light'], ['Switches (off by default)', 'switch']];
  $('#haToggles').innerHTML = groups.map(([label, dom]) => {
    const list = byDomain(dom); if (!list.length) return '';
    return `<div class="ha-group"><h4>${label}</h4><div class="toggles">${list.map(s => { const on = shown(s);
      return `<label class="tog${on ? '' : ' off'}"><span class="cn">${esc(nameOf(s))}</span><input type="checkbox" data-ha="${esc(s.entity_id)}"${on ? ' checked' : ''}><span class="sw2"></span></label>`; }).join('')}</div></div>`;
  }).join('');
}
$('#gear').addEventListener('click', renderHaSettings);
$('#haToggles').addEventListener('change', e => {
  const id = e.target.dataset.ha; if (!id) return;
  S.haHidden[id] = !e.target.checked; saveSettings(); e.target.closest('.tog').classList.toggle('off', !e.target.checked); renderHome(); renderCam();
});
$('#haSave').addEventListener('click', () => {
  S.haUrl = $('#haUrl').value.trim().replace(/\/+$/, ''); S.haToken = $('#haToken').value.trim(); saveSettings();
  HA.error = null; HA.states = {}; $('#haState').textContent = 'Connecting…'; haConnect(); setTimeout(renderHaSettings, 2500);
});

/* ---------------- Boot ---------------- */
renderHome(); startCams(); haConnect(); fetchNest();
setInterval(fetchNest, 2 * 60000);
fetchST(); setInterval(() => { if (homePageVisible()) fetchST(); }, 30000); setInterval(fetchST, 10 * 60000); // lights: often while the Home page shows, rarely otherwise
{ const chk = () => { if (camKey && camKey.split('|')[1] !== String(homePageVisible())) { renderCam(); if (homePageVisible() && ST.on) fetchST(); } };
  pager.addEventListener('scroll', () => { clearTimeout(chk.t); chk.t = setTimeout(chk, 250); }, { passive: true }); document.addEventListener('visibilitychange', chk); setTimeout(chk, 1500); }
setInterval(renderSide, 5000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && haConfigured() && !HA.ok) haConnect(); });
