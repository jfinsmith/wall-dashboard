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
  if (!haConfigured()) { // sample mode: flip locally
    const s = DEMO.states[entity_id]; if (s) s.state = s.state === 'on' ? 'off' : 'on'; renderHome(); return;
  }
  haSend({ type: 'call_service', domain, service, target: { entity_id } }, r => { if (!r.success) toast('Couldn’t change that: ' + (r.error?.message || 'error')); });
}

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
const homeStates = () => haConfigured() ? HA.states : DEMO.states;

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

/* Cameras: rotate on a timer; refresh the visible snapshot every 3 s */
let camIdx = 0, camRotT = null, camSnapT = null;
function camList() { return byDomain('camera').filter(shown); }
function camSrc(s) {
  const p = s.attributes?.entity_picture; if (!p) return null;
  return p.startsWith('data:') ? p : S.haUrl + p + (p.includes('?') ? '&' : '?') + '_=' + Date.now();
}
function renderCam() {
  const box = $('#cam'), cams = camList();
  if (!cams.length) { box.innerHTML = `<div class="ph-img">${haConfigured() && HA.ok ? 'No cameras found in Home Assistant yet.' : 'Cameras will appear here.'}</div>`; return; }
  camIdx %= cams.length; const s = cams[camIdx];
  box.innerHTML = `<div class="ph-img">Loading ${esc(nameOf(s))}…</div><img alt="" id="camImg" style="opacity:0">
    <div class="ov"><span class="ico">${svgI('cam')}</span><div><b>${esc(nameOf(s))}</b><span id="camWhen"><i class="live"></i>Live snapshot</span></div></div>
    <span class="cdots">${cams.map((_, i) => `<i class="${i === camIdx ? 'on' : ''}"></i>`).join('')}</span>`;
  refreshSnap(true);
}
function refreshSnap(first) {
  const cams = camList(), s = cams[camIdx % (cams.length || 1)], img = $('#camImg'); if (!s || !img) return;
  const src = camSrc(s); if (!src) { $('#cam .ph-img').textContent = 'No picture available for this camera.'; return; }
  const pre = new Image();
  pre.onload = () => { img.src = pre.src; img.style.opacity = 1; const w = $('#camWhen'); if (w) w.innerHTML = `<i class="live"></i>Updated ${tShort(new Date())}`; };
  pre.onerror = () => { if (first) $('#cam .ph-img').textContent = `${nameOf(s)}: live view isn’t available as a snapshot.`; };
  pre.src = src;
}
function startCams() {
  clearInterval(camRotT); clearInterval(camSnapT);
  camRotT = setInterval(() => { camIdx++; renderCam(); }, S.camSec * 1000);
  camSnapT = setInterval(() => { if (document.visibilityState === 'visible') refreshSnap(false); }, 3000);
}
$('#cam').addEventListener('click', () => { camIdx++; renderCam(); startCams(); });

function renderHome() {
  const banner = $('#haBanner');
  banner.hidden = haConfigured() && !HA.error;
  banner.textContent = !haConfigured() ? 'Sample devices · connect Home Assistant in ⚙️' : HA.error ? '⚠️ ' + HA.error : '';
  const locks = byDomain('lock').filter(shown), climate = byDomain('climate').filter(shown);
  const lights = byDomain('light', 'switch').filter(shown).sort((a, b) => (b.state === 'on') - (a.state === 'on'));
  $('#doors').innerHTML = locks.map(lockTile).join('') || '<div class="st" style="color:var(--faint)">No locks found.</div>';
  $('#climate').innerHTML = climate.map(thermoTile).join('') || '<div class="st" style="color:var(--faint)">No thermostats found.</div>';
  $('#lights').innerHTML = lights.map(lightTile).join('') || '<div class="st" style="color:var(--faint)">No lights found.</div>';
  const nOn = lights.filter(l => l.state === 'on').length;
  $('#lightsOn').textContent = lights.length ? `${nOn} of ${lights.length} on` : '';
  if (!$('#camImg') || !camList().length) renderCam();
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
  rows.push(`<div class="sum"><i class="d ${nOn ? 'on' : ''}"></i><span>${nOn ? `<b>${nOn}</b> light${nOn > 1 ? 's' : ''} on` : 'All lights off'}</span></div>`);
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
  $('#haUrl').value = S.haUrl; $('#haToken').value = S.haToken; $('#camSec').value = S.camSec; $('#camVal').textContent = S.camSec;
  $('#haState').textContent = !haConfigured() ? 'Not connected: the Home page is showing sample devices.'
    : HA.ok ? `✅ Connected · ${Object.keys(HA.states).length} entities` : HA.error ? '⚠️ ' + HA.error : 'Connecting…';
  if (!haConfigured()) { $('#haToggles').innerHTML = ''; return; }
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
$('#camSec').addEventListener('input', e => { S.camSec = +e.target.value; $('#camVal').textContent = S.camSec; saveSettings(); startCams(); });

/* ---------------- Boot ---------------- */
renderHome(); startCams(); haConnect();
setInterval(renderSide, 5000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && haConfigured() && !HA.ok) haConnect(); });
