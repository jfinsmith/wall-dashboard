'use strict';
/* Home wall dashboard — page 1: clock, rotating weather, around-town air/heat, today + next 14 days. */

const CITIES = [
  { name: "Land O' Lakes", lat: 28.2189, lon: -82.4573 },
  { name: 'Spring Hill',   lat: 28.4769, lon: -82.5254 },
  { name: 'Dade City',     lat: 28.3647, lon: -82.1959 },
];
const TZ = 'America/New_York';
const DEFAULTS = { calUrl: '', hidden: {}, rotateSec: 8, nightDim: true, idleReturn: true, wake: true, demo: false,
  newsOn: { local: true, politics: true, ai: true, space: false, lightning: false } };

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function loadJSON(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

let S = Object.assign({}, DEFAULTS, loadJSON('wd.settings', {}));
S.newsOn = Object.assign({}, DEFAULTS.newsOn, S.newsOn);
const saveSettings = () => saveJSON('wd.settings', S);

const state = {
  wx: loadJSON('wd.wx', null),     // {at, data:[per city]}
  aq: loadJSON('wd.aq', null),     // {at, data:[per city]}
  cal: loadJSON('wd.cal', null),   // {at, calendars, events}
  news: loadJSON('wd.news', null), newsError: null,
  calError: null, cityIdx: 0,
};

// One-time setup link: …/#connect=<encoded Apps Script URL>
(() => {
  const m = location.hash.match(/connect=([^&]+)/);
  if (m) { S.calUrl = decodeURIComponent(m[1]); S.demo = false; saveSettings(); history.replaceState(null, '', location.pathname + location.search); }
  if (/[?&]demo\b/.test(location.search)) S.demo = true;
})();

/* ---------------- Date helpers ---------------- */
const DAY = 86400000;
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const ymd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function tShort(d) { const h = d.getHours() % 12 || 12, m = d.getMinutes(); return h + (m ? ':' + String(m).padStart(2, '0') : '') + (d.getHours() < 12 ? 'a' : 'p'); }
function tParts(d) { return [(d.getHours() % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0'), d.getHours() < 12 ? 'AM' : 'PM']; }
function relDur(ms) { const m = Math.round(ms / 60000); if (m < 60) return m + 'm'; const h = Math.floor(m / 60), r = m % 60; return h + 'h' + (r ? ' ' + r + 'm' : ''); }

/* ---------------- Holidays (for countdown chips) ---------------- */
function nthDow(y, m, dow, n) { const off = (dow - new Date(y, m, 1).getDay() + 7) % 7; return new Date(y, m, 1 + off + 7 * (n - 1)); }
function lastDow(y, m, dow) { const d = new Date(y, m + 1, 0); return new Date(y, m, d.getDate() - ((d.getDay() - dow + 7) % 7)); }
function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da); }
function holidays(y) {
  return [
    ['🎆', "New Year's", new Date(y, 0, 1)], ['💘', "Valentine's", new Date(y, 1, 14)], ['☘️', "St. Patrick's", new Date(y, 2, 17)],
    ['🐣', 'Easter', easter(y)], ['💐', "Mother's Day", nthDow(y, 4, 0, 2)], ['🇺🇸', 'Memorial Day', lastDow(y, 4, 1)],
    ['👔', "Father's Day", nthDow(y, 5, 0, 3)], ['🎇', 'July 4th', new Date(y, 6, 4)], ['🛠️', 'Labor Day', nthDow(y, 8, 1, 1)],
    ['🎃', 'Halloween', new Date(y, 9, 31)], ['🎖️', 'Veterans Day', new Date(y, 10, 11)], ['🦃', 'Thanksgiving', nthDow(y, 10, 4, 4)],
    ['🎄', 'Christmas', new Date(y, 11, 25)],
  ];
}
function upcomingHolidays(today, n = 2) {
  const list = [...holidays(today.getFullYear()), ...holidays(today.getFullYear() + 1)]
    .map(([e, name, d]) => ({ e, name, days: Math.round((d - today) / DAY) })).filter(h => h.days >= 0).sort((a, b) => a.days - b.days);
  return list.slice(0, n);
}

/* ---------------- Weather icons (inline animated SVG) ---------------- */
function rays(cx, cy, r1, r2) { let s = ''; for (let a = 0; a < 360; a += 45) { const t = a * Math.PI / 180, c = Math.cos(t), n = Math.sin(t); s += `<line x1="${(cx + r1 * c).toFixed(1)}" y1="${(cy + r1 * n).toFixed(1)}" x2="${(cx + r2 * c).toFixed(1)}" y2="${(cy + r2 * n).toFixed(1)}"/>`; } return s; }
const sunG = (cx, cy, r) => `<g class="spin" style="transform-origin:${cx}px ${cy}px"><g stroke="#FFD43B" stroke-width="${(r * .26).toFixed(1)}" stroke-linecap="round">${rays(cx, cy, r * 1.4, r * 1.8)}</g></g><circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFC53D"/><circle cx="${cx - r * .15}" cy="${cy - r * .15}" r="${r * .7}" fill="#FFE07A"/>`;
const moonG = (cx, cy, r) => `<path d="M${cx + r * .3} ${cy - r} A${r} ${r} 0 1 0 ${cx + r} ${cy + r * .35} A${r * .8} ${r * .8} 0 0 1 ${cx + r * .3} ${cy - r} Z" fill="#FDE68A"/>`;
const CLOUD = 'M18 48h28a11 11 0 0 0 1.5-21.9A15 15 0 0 0 19 24.5a12 12 0 0 0-1 23.5z';
const cloudG = (tx, ty, s, fill = '#F8FAFC', cls = 'bob') => `<g class="${cls}"><path transform="translate(${tx} ${ty}) scale(${s})" d="${CLOUD}" fill="${fill}"/></g>`;
const drops = (color, w, n = 3) => [22, 32, 42].slice(0, n).map((x, i) => `<line class="drop" style="animation-delay:${i * .4}s" x1="${x}" y1="47" x2="${x - 2}" y2="53" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`).join('');
function wxKind(c) {
  if (c === 0) return ['clear', 'Clear']; if (c === 1) return ['partly', 'Mostly clear']; if (c === 2) return ['partly', 'Partly cloudy'];
  if (c === 3) return ['cloudy', 'Overcast']; if (c === 45 || c === 48) return ['fog', 'Foggy']; if (c >= 51 && c <= 57) return ['drizzle', 'Drizzle'];
  if (c >= 61 && c <= 67) return ['rain', c >= 65 ? 'Heavy rain' : 'Rain']; if (c >= 71 && c <= 77) return ['snow', 'Snow'];
  if (c >= 80 && c <= 82) return ['rain', 'Showers']; if (c === 85 || c === 86) return ['snow', 'Snow showers']; if (c >= 95) return ['storm', 'Thunderstorms'];
  return ['cloudy', 'Cloudy'];
}
function icon(code, isDay = 1) {
  const [k] = wxKind(code); let g;
  switch (k) {
    case 'clear': g = isDay ? sunG(32, 32, 12) : moonG(30, 32, 15) + '<circle cx="50" cy="16" r="1.6" fill="#fff" class="flash"/><circle cx="14" cy="14" r="1.2" fill="#fff"/>'; break;
    case 'partly': g = (isDay ? sunG(23, 23, 9) : moonG(22, 22, 11)) + cloudG(7, 9, .85); break;
    case 'cloudy': g = cloudG(-4, -4, .8, '#CBD5E1', 'fl') + cloudG(4, 6, .9); break;
    case 'fog': g = cloudG(2, -4, .9, '#E2E8F0') + [50, 56, 62].map((y, i) => `<line class="fl" style="animation-delay:${i * .5}s" x1="${12 + i * 3}" y1="${y - 2}" x2="${50 - i * 2}" y2="${y - 2}" stroke="#E2E8F0" stroke-width="3" stroke-linecap="round"/>`).join(''); break;
    case 'drizzle': g = cloudG(2, -6, .9) + drops('#7DD3FC', 2.5); break;
    case 'rain': g = cloudG(2, -6, .9, '#E2E8F0') + drops('#38BDF8', 3.5); break;
    case 'storm': g = cloudG(2, -8, .9, '#94A3B8') + '<polygon class="flash" points="33,40 25,53 32,53 28,63 41,48 34,48 38,40" fill="#FDE047"/>'; break;
    case 'snow': g = cloudG(2, -6, .9) + [22, 32, 42].map((x, i) => `<circle class="drop" style="animation-delay:${i * .45}s;animation-duration:2.2s" cx="${x}" cy="50" r="2.4" fill="#fff"/>`).join(''); break;
  }
  return `<svg class="ic" viewBox="0 0 64 64" aria-hidden="true">${g}</svg>`;
}
const compass = deg => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
function aqiInfo(v) { if (v == null) return ['—', '#cbd5e1']; if (v <= 50) return ['Good', '#4ade80']; if (v <= 100) return ['Moderate', '#facc15']; if (v <= 150) return ['Sensitive', '#fb923c']; if (v <= 200) return ['Unhealthy', '#f87171']; if (v <= 300) return ['Very unhealthy', '#c084fc']; return ['Hazardous', '#fb7185']; }
function uvInfo(v) { if (v == null) return ['—', '#cbd5e1']; if (v < 3) return ['Low', '#4ade80']; if (v < 6) return ['Moderate', '#facc15']; if (v < 8) return ['High', '#fb923c']; if (v < 11) return ['Very high', '#f87171']; return ['Extreme', '#c084fc']; }
function wbgtF(tF, rh) { const t = (tF - 32) * 5 / 9, e = rh / 100 * 6.105 * Math.exp(17.27 * t / (237.7 + t)); return (0.567 * t + 0.393 * e + 3.94) * 9 / 5 + 32; }
function moon(now) { const p = (((now - Date.UTC(2000, 0, 6, 18, 14)) / DAY / 29.530588853) % 1 + 1) % 1; const i = Math.round(p * 8) % 8; return [['🌑', 'New moon'], ['🌒', 'Waxing crescent'], ['🌓', 'First quarter'], ['🌔', 'Waxing gibbous'], ['🌕', 'Full moon'], ['🌖', 'Waning gibbous'], ['🌗', 'Last quarter'], ['🌘', 'Waning crescent']][i]; }

/* ---------------- Data fetching ---------------- */
async function fetchWeather() {
  const lat = CITIES.map(c => c.lat).join(','), lon = CITIES.map(c => c.lon).join(',');
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day,uv_index' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max' +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=${encodeURIComponent(TZ)}&forecast_days=7`;
  try {
    const r = await fetch(u); if (!r.ok) throw new Error(r.status);
    let j = await r.json(); if (!Array.isArray(j)) j = [j];
    state.wx = { at: Date.now(), data: j }; saveJSON('wd.wx', state.wx);
  } catch (e) { console.warn('weather', e); }
  renderWx(); renderTown(); setTheme();
}
async function fetchAir() {
  const lat = CITIES.map(c => c.lat).join(','), lon = CITIES.map(c => c.lon).join(',');
  const u = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi&timezone=${encodeURIComponent(TZ)}`;
  try {
    const r = await fetch(u); if (!r.ok) throw new Error(r.status);
    let j = await r.json(); if (!Array.isArray(j)) j = [j];
    state.aq = { at: Date.now(), data: j }; saveJSON('wd.aq', state.aq);
  } catch (e) { console.warn('air', e); }
  renderTown();
}
async function fetchCal() {
  if (!S.demo && S.calUrl) {
    try {
      const u = S.calUrl + (S.calUrl.includes('?') ? '&' : '?') + 'days=16&back=7&t=' + Date.now();
      const r = await fetch(u);
      const txt = await r.text(); let j;
      try { j = JSON.parse(txt); } catch { throw new Error('The script did not return calendar data. Check it is deployed with access set to “Anyone”.'); }
      if (j.error) throw new Error(j.error);
      j.at = Date.now(); state.cal = j; state.calError = null; saveJSON('wd.cal', j);
    } catch (e) { state.calError = e.message || String(e); }
  }
  renderCal(); renderSettingsCals();
}

/* ---------------- Demo calendar (made-up sample data, only with demo mode on) ---------------- */
let demoCache = null;
function demoCal() {
  const t = startOfDay(new Date()); const key = t.toDateString();
  if (demoCache && demoCache.key === key) return demoCache.data;
  const iso = (dd, h, m = 0) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + dd, h, m).toISOString();
  const day = dd => { const d = addDays(t, dd); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const ev = (cal, title, dd, h, m, durMin, location = '') => ({ cal, title, start: iso(dd, h, m), end: new Date(new Date(iso(dd, h, m)).getTime() + durMin * 60000).toISOString(), allDay: false, location });
  const ad = (cal, title, dd, len = 1) => ({ cal, title, start: day(dd), end: day(dd + len), allDay: true });
  const data = {
    calendars: [
      { id: 'me', name: 'Personal', color: '#8B5CF6', selected: true }, { id: 'fam', name: 'Family', color: '#22C55E', selected: true },
      { id: 'hol', name: 'Holidays', color: '#0EA5E9', selected: true }, { id: 'bday', name: 'Birthdays', color: '#F59E0B', selected: true },
    ],
    events: [
      ad('fam', 'Trash & recycling', 0), ev('me', 'Morning run', 0, 6, 30, 45, 'Park trail'), ev('me', 'Dentist', 0, 14, 0, 60, 'Main St Dental'),
      ev('fam', 'Dinner with friends', 0, 19, 0, 120, 'Taco place'), ev('me', 'Oil change', 1, 9, 0, 60), ad('bday', "Sam's birthday 🎂", 2),
      ev('fam', 'Soccer practice', 2, 17, 30, 90, 'Rec fields'), ev('me', 'Haircut', 3, 11, 0, 45), ad('fam', 'Beach weekend', 3, 2),
      ev('fam', 'Pancake breakfast', 4, 9, 0, 60), ev('me', 'Book club', 6, 19, 0, 90), ev('fam', 'Soccer practice', 7, 17, 30, 90),
      ev('me', 'Vet appointment', 8, 10, 30, 30), ad('hol', 'Thanksgiving', 15), ev('me', 'Grocery pickup', 9, 16, 0, 30),
      ev('fam', 'Movie night', 10, 19, 30, 150), ev('me', 'Car wash', 11, 10, 0, 30), ev('fam', 'Soccer game', 12, 9, 0, 90, 'Rec fields'),
      ev('me', 'Coffee w/ Alex', 13, 8, 30, 60), ad('fam', 'School half day', 14), ev('me', 'Gym', -1, 7, 0, 60), ad('fam', 'Pay day', -2), ev('fam', 'Soccer practice', -2, 17, 30, 90),
    ],
  };
  demoCache = { key, data }; return data;
}

/* ---------------- Calendar model ---------------- */
function calSource() { return S.demo ? demoCal() : state.cal; }
function isHiddenCal(c) { return c.id in S.hidden ? S.hidden[c.id] : (c.selected === false || c.hidden === true); }
function events() {
  const src = calSource(); if (!src) return [];
  const cals = {}; (src.calendars || []).forEach(c => cals[c.id] = c);
  return (src.events || []).filter(e => !(cals[e.cal] && isHiddenCal(cals[e.cal]))).map(e => {
    let s, en;
    if (e.allDay) { s = ymd(e.start); en = e.end ? ymd(e.end) : addDays(s, 1); if (en <= s) en = addDays(s, 1); }
    else { s = new Date(e.start); en = new Date(e.end || e.start); }
    return { ...e, s, en, color: e.color || cals[e.cal]?.color || '#8B5CF6' };
  });
}
function eventsOn(all, day) {
  const a = startOfDay(day), b = addDays(a, 1);
  return all.filter(e => e.en > e.s ? (e.s < b && e.en > a) : (e.s >= a && e.s < b))
    .map(e => ({ ...e, cont: !e.allDay && e.s < a }))
    .sort((x, y) => ((y.allDay || y.cont) - (x.allDay || x.cont)) || (x.s - y.s) || x.title.localeCompare(y.title));
}
function textOn(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#fff'; const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#1b1630' : '#fff'; }

/* ---------------- Rendering ---------------- */
function renderClock() {
  const now = new Date(), h = now.getHours();
  $('#hm').textContent = (h % 12 || 12) + ':' + String(now.getMinutes()).padStart(2, '0');
  $('#ampm').textContent = h < 12 ? 'AM' : 'PM';
  $('#date').textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  $('#greet').textContent = h < 5 ? 'Hey, night owl' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
  const all = events(), today = startOfDay(now);
  const timed = [...eventsOn(all, today), ...eventsOn(all, addDays(today, 1))].filter(e => !e.allDay && !e.cont);
  const cur = timed.find(e => e.s <= now && e.en > now), nxt = timed.find(e => e.s > now);
  let html = '';
  if (cur) html = `<i class="dot-now"></i><span class="lbl">Now</span><b>${esc(cur.title)}</b><span class="when">until ${tShort(cur.en)}</span>`;
  else if (nxt) html = `<i class="dot-next"></i><span class="lbl">Next</span><b>${esc(nxt.title)}</b><span class="when">${nxt.s - now < 6 * 3600000 ? 'in ' + relDur(nxt.s - now) : (startOfDay(nxt.s) > today ? 'tmrw ' : '') + tShort(nxt.s)}</span>`;
  $('#nextup').innerHTML = html;
  $('#holis').innerHTML = upcomingHolidays(today, 2).map(x => x.days === 0
    ? `<span class="holi now">${x.e} Happy ${esc(x.name)}!</span>`
    : `<span class="holi">${x.e} ${esc(x.name)} <em>${x.days === 1 ? 'tomorrow' : x.days + ' days'}</em></span>`).join('');
}


function renderWx() {
  const box = $('#wxBody'), d = state.wx?.data?.[state.cityIdx];
  if (!d) { box.innerHTML = '<div class="loading">Fetching the forecast…</div>'; return; }
  const c = d.current, dl = d.daily, city = CITIES[state.cityIdx];
  const [, label] = wxKind(c.weather_code);
  const cond = c.weather_code === 0 ? (c.is_day ? 'Sunny' : 'Clear') : label;
  const uv = Math.round(c.uv_index ?? dl.uv_index_max[0]);
  const daysHtml = dl.time.slice(0, 6).map((t, i) => {
    const dt = ymd(t), pp = dl.precipitation_probability_max[i] ?? 0;
    return `<div class="wd${i === 0 ? ' first' : ''}"><div class="dn">${i === 0 ? 'Today' : DOW[dt.getDay()]}</div>${icon(dl.weather_code[i], 1)}
      <div class="hl"><span class="hi">${Math.round(dl.temperature_2m_max[i])}°</span><span class="lo">${Math.round(dl.temperature_2m_min[i])}°</span></div>
      <div class="pp${pp < 20 ? ' dry' : ''}">${pp}%</div></div>`;
  }).join('');
  box.innerHTML = `
    <div class="wx-now">
      <div class="wx-city">${esc(city.name)}<span class="cdots">${CITIES.map((_, i) => `<i class="${i === state.cityIdx ? 'on' : ''}"></i>`).join('')}</span></div>
      <div class="wx-main">${icon(c.weather_code, c.is_day)}
        <div><div class="wx-temp">${Math.round(c.temperature_2m)}<sup>°</sup></div>
        <div class="wx-cond">${esc(cond)}</div>
        <div class="wx-feel">Feels ${Math.round(c.apparent_temperature)}° · H ${Math.round(dl.temperature_2m_max[0])}° L ${Math.round(dl.temperature_2m_min[0])}°</div></div>
      </div>
      <div class="stats">
        <div><span>Wind</span><b>${Math.round(c.wind_speed_10m)}<small> mph ${compass(c.wind_direction_10m)}</small></b></div>
        <div><span>Humidity</span><b>${c.relative_humidity_2m}<small>%</small></b></div>
        <div><span>Rain</span><b>${dl.precipitation_probability_max[0] ?? 0}<small>%</small></b></div>
        <div><span>UV</span><b>${uv}<small> ${uvInfo(uv)[0]}</small></b></div>
      </div>
    </div>
    <div class="wx-days">${daysHtml}</div>`;
}


function renderTown() {
  const wx = state.wx?.data; if (!wx) return;
  $('#townRows').innerHTML = CITIES.map((city, i) => {
    const c = wx[i]?.current; if (!c) return '';
    const aqi = state.aq?.data?.[i]?.current?.us_aqi;
    const [aL, aC] = aqiInfo(aqi); const uv = Math.round(c.uv_index ?? wx[i].daily.uv_index_max[0]); const [, uC] = uvInfo(uv);
    const w = Math.round(wbgtF(c.temperature_2m, c.relative_humidity_2m));
    return `<div class="tr${i === state.cityIdx ? ' on' : ''}">
      <div class="nm">${esc(city.name)}</div>
      <div class="t">${icon(c.weather_code, c.is_day)}${Math.round(c.temperature_2m)}°</div>
      <div class="meta"><span><i style="background:${aC}"></i>AQI <b>${aqi ?? '—'}</b></span><span><i style="background:${uC}"></i>UV <b>${uv}</b></span><span title="Estimated WBGT (shade)">WBGT <b>${w}°</b></span></div></div>`;
  }).join('');
  const dl = wx[0].daily, sr = new Date(dl.sunrise[0]), ss = new Date(dl.sunset[0]), [me, mn] = moon(Date.now());
  $('#sunmoon').innerHTML = `<span>Sunrise <b>${tShort(sr)}</b></span><span>Sunset <b>${tShort(ss)}</b></span><span>${me} ${mn}</span>`;
}


function renderCal() {
  renderToday(); renderDays(); renderClock();
  requestAnimationFrame(fitAll);
}

function renderToday() {
  const now = new Date(), today = startOfDay(now);
  $('#todayDate').textContent = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const list = $('#todayList'), cnt = $('#todayCount'), src = calSource();
  if (!src) {
    cnt.textContent = '';
    list.innerHTML = state.calError
      ? `<div class="empty"><div class="big">⚠️</div><div>Couldn’t reach your calendar.</div><div style="font-size:.9rem">${esc(state.calError)}</div></div>`
      : `<div class="empty"><div class="big">🗓️</div><div><b>Connect Google Calendar</b></div><div>Tap ⚙️ in the bottom-right corner.</div></div>`;
    return;
  }
  const evs = eventsOn(events(), today);
  cnt.textContent = state.calError ? 'offline' : evs.length ? String(evs.length) : '';
  if (!evs.length) { list.innerHTML = `<div class="empty"><div class="big">🌴</div><div><b>Nothing scheduled</b></div><div>Enjoy the free day.</div></div>`; return; }
  list.innerHTML = evs.map(e => {
    if (e.allDay || e.cont) return `<div class="ad" style="--c:${e.color}">${esc(e.title)}</div>`;
    const [t, ap] = tParts(e.s), past = e.en <= now, live = e.s <= now && e.en > now;
    return `<div class="tev${past ? ' past' : ''}${live ? ' now' : ''}"><div class="tt">${t}<small>${ap}</small></div><div class="bar" style="background:${e.color}"></div>
      <div class="tb"><div class="ttl">${esc(e.title)}</div><div class="loc">${live ? '<span class="nowtag">Now</span>' : ''}until ${tShort(e.en)}${e.location ? ' · ' + esc(e.location.split(',')[0]) : ''}</div></div></div>`;
  }).join('');
}

function renderDays() {
  // Always Monday → Sunday: this week on top, next week below.
  const now = new Date(), today = startOfDay(now), all = events(), src = calSource();
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  let html = '';
  for (let i = 0; i < 14; i++) {
    const d = addDays(monday, i), wk = d.getDay() === 0 || d.getDay() === 6;
    const isToday = +d === +today, past = d < today;
    const evs = src ? eventsOn(all, d) : [];
    const items = evs.map(e => (e.allDay || e.cont)
      ? `<div class="dad" style="--c:${e.color}">${esc(e.title)}</div>`
      : `<div class="dev${isToday && e.en <= now ? ' done' : ''}"><i class="dot" style="background:${e.color}"></i><span class="tm">${tShort(e.s)}</span><span class="nm">${esc(e.title)}</span></div>`).join('');
    html += `<article class="card day${wk ? ' wkend' : ''}${isToday ? ' is-today' : ''}${past ? ' past' : ''}">
      <header><span class="dow">${DOW[d.getDay()]}</span><span class="dnum">${d.getDate()}</span></header>
      <div class="dlist">${items}</div></article>`;
  }
  $('#days').innerHTML = html;
}

// Trim lists that overflow their card and show "+N more"
function fitList(list) {
  if (!list || list.querySelector('.empty,.dfree')) return;
  const items = [...list.children].filter(n => !n.classList.contains('more'));
  list.querySelector('.more')?.remove(); items.forEach(n => (n.style.display = ''));
  const over = () => list.scrollHeight > list.clientHeight + 1;
  if (!over()) return;
  let hidden = 0; const more = document.createElement('div'); more.className = 'more'; list.appendChild(more);
  for (let i = items.length - 1; i >= 0 && over(); i--) { items[i].style.display = 'none'; hidden++; more.textContent = `+${hidden} more`; }
}
function fitAll() { fitList($('#todayList')); document.querySelectorAll('.dlist,.nlist,.hero-more').forEach(fitList); }

/* ---------------- Theme by sun position ---------------- */
function setTheme() {
  const now = Date.now(), dl = state.wx?.data?.[0]?.daily;
  let tod;
  if (dl) {
    const sr = +new Date(dl.sunrise[0]), ss = +new Date(dl.sunset[0]), H = 3600000;
    tod = now < sr - H ? 'night' : now < sr + 1.5 * H ? 'dawn' : now < ss - H ? 'day' : now < ss + H ? 'dusk' : 'night';
  } else { const h = new Date().getHours(); tod = h < 6 ? 'night' : h < 9 ? 'dawn' : h < 17 ? 'day' : h < 19 ? 'dusk' : 'night'; }
  document.body.dataset.tod = tod;
}

/* ---------------- Weather rotation ---------------- */
let rotTimer = null;
function startRotation() {
  clearInterval(rotTimer);
  const prog = $('#wxProg'); const kick = () => { prog.classList.remove('run'); void prog.offsetWidth; prog.style.animationDuration = S.rotateSec + 's'; prog.classList.add('run'); };
  kick();
  rotTimer = setInterval(() => {
    const body = $('#wxBody'); body.classList.add('out');
    setTimeout(() => { state.cityIdx = (state.cityIdx + 1) % CITIES.length; renderWx(); renderTown(); body.classList.remove('out'); }, 450);
    kick();
  }, S.rotateSec * 1000);
}

/* ---------------- Pager, idle return, dim, wake lock, burn-in shift ---------------- */
const pager = $('#pager'), pages = [...document.querySelectorAll('.page')];
$('#dots').innerHTML = pages.map((_, i) => `<button aria-label="Page ${i + 1}" data-i="${i}"></button>`).join('');
const goPage = i => pager.scrollTo({ left: i * pager.clientWidth, behavior: 'smooth' });
$('#dots').addEventListener('click', e => { const b = e.target.closest('button'); if (b) goPage(+b.dataset.i); });
function updateDots() { const i = Math.round(pager.scrollLeft / pager.clientWidth); document.querySelectorAll('#dots button').forEach((b, j) => b.classList.toggle('on', i === j)); }
pager.addEventListener('scroll', () => requestAnimationFrame(updateDots), { passive: true });

let lastTouch = Date.now(), undimUntil = 0;
document.addEventListener('pointerdown', () => { lastTouch = Date.now(); if (+$('#dim').style.opacity > 0) { undimUntil = Date.now() + 120000; applyDim(); } wake(); }, { passive: true });
setInterval(() => { if (S.idleReturn && Date.now() - lastTouch > 180000 && pager.scrollLeft > 10 && $('#settings').hidden) goPage(0); }, 15000);

function applyDim() {
  const h = new Date().getHours(), night = h >= 23 || h < 6;
  const el = $('#dim'); const on = S.nightDim && night && Date.now() > undimUntil;
  el.style.transition = on ? 'opacity 60s linear' : 'opacity .4s'; el.style.opacity = on ? '.6' : '0';
}

let wakeLock = null;
async function wake() {
  if (S.wake && 'wakeLock' in navigator && document.visibilityState === 'visible' && (!wakeLock || wakeLock.released)) {
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', updateWakeState); } catch (e) { console.warn('wake', e); }
  }
  if (!S.wake && wakeLock && !wakeLock.released) { try { await wakeLock.release(); } catch {} }
  updateWakeState();
}
function updateWakeState() {
  const el = $('#wakeState'); if (!el) return;
  el.textContent = !('wakeLock' in navigator) ? 'This browser can’t hold the screen on; set the tablet’s screen timeout instead.'
    : wakeLock && !wakeLock.released ? '✅ Screen is being kept awake.' : S.wake ? 'Waiting to lock the screen on (tap anywhere once).' : 'Off';
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { wake(); refreshAll(); } });

function shift() { const r = () => Math.round(Math.random() * 6 - 3); $('#app').style.transform = `translate(${r()}px, ${r()}px)`; }

/* ---------------- Settings ---------------- */
const modal = $('#settings');
$('#gear').addEventListener('click', () => { renderSettings(); modal.hidden = false; });
modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) modal.hidden = true; });
function renderSettings() {
  $('#calUrl').value = S.calUrl; $('#rot').value = S.rotateSec; $('#rotVal').textContent = S.rotateSec;
  $('#dimOn').checked = S.nightDim; $('#idleOn').checked = S.idleReturn; $('#wakeOn').checked = S.wake;
  $('#demoBtn').textContent = S.demo ? 'Turn off sample data' : 'Preview with sample data';
  renderSettingsCals(); renderNewsToggles(); updateWakeState();
}
function renderSettingsCals() {
  const src = calSource(), box = $('#calToggles'), hint = $('#calHint');
  if (!src?.calendars?.length) { box.innerHTML = ''; hint.textContent = 'Connect your calendar below and every calendar on your Google account will show up here.'; return; }
  hint.textContent = S.demo ? 'Sample calendars — connect yours to see your real list.' : 'Turn off any calendar you don’t want on the wall.';
  box.innerHTML = src.calendars.slice().sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0) || a.name.localeCompare(b.name)).map(c => {
    const on = !isHiddenCal(c);
    return `<label class="tog${on ? '' : ' off'}"><span class="sq" style="background:${c.color}"></span><span class="cn">${esc(c.name)}</span><input type="checkbox" data-cal="${esc(c.id)}"${on ? ' checked' : ''}><span class="sw2"></span></label>`;
  }).join('');
}
$('#calToggles').addEventListener('change', e => {
  const id = e.target.dataset.cal; if (!id) return;
  S.hidden[id] = !e.target.checked; saveSettings(); e.target.closest('.tog').classList.toggle('off', !e.target.checked); renderCal();
});
$('#calSave').addEventListener('click', () => { S.calUrl = $('#calUrl').value.trim(); S.demo = false; state.cal = null; state.calError = null; saveSettings(); renderSettings(); renderCal(); fetchCal(); });
$('#demoBtn').addEventListener('click', () => { S.demo = !S.demo; saveSettings(); renderSettings(); renderCal(); if (!S.demo) fetchCal(); });
$('#refreshBtn').addEventListener('click', () => location.reload());
$('#rot').addEventListener('input', e => { S.rotateSec = +e.target.value; $('#rotVal').textContent = S.rotateSec; saveSettings(); startRotation(); });
$('#dimOn').addEventListener('change', e => { S.nightDim = e.target.checked; saveSettings(); applyDim(); });
$('#idleOn').addEventListener('change', e => { S.idleReturn = e.target.checked; saveSettings(); });
$('#wakeOn').addEventListener('change', e => { S.wake = e.target.checked; saveSettings(); wake(); });

/* ---------------- Page 2: News (Ground News, via news.json built every 30 min) ---------------- */
const NEWS_META = { local: ['📍', 'Tampa Bay & Pasco'], politics: ['🏛️', 'US Politics'], ai: ['🤖', 'AI'], space: ['🚀', 'Space & Launches'], lightning: ['🏒', 'Lightning'] };
let heroIdx = 0, heroTimer = null;
function ago(iso) { const m = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000)); return m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; }
function biasBar(st) {
  const b = st.bias || {}, tot = (b.left || 0) + (b.center || 0) + (b.right || 0);
  if (!tot || st.sources < 3) return '';
  const p = k => (100 * (b[k] || 0) / tot).toFixed(1);
  return `<span class="bias" title="Left / Center / Right coverage"><i class="l" style="width:${p('left')}%"></i><i class="c" style="width:${p('center')}%"></i><i class="r" style="width:${p('right')}%"></i></span>`;
}
function biasLabel(st) {
  const b = st.bias || {}, tot = (b.left || 0) + (b.center || 0) + (b.right || 0);
  if (!tot || st.sources < 3) return '';
  const p = k => Math.round(100 * (b[k] || 0) / tot);
  return `<span class="blab"><b class="bl">L ${p('left')}%</b> · C ${p('center')}% · <b class="br">R ${p('right')}%</b></span>`;
}
const srcTxt = n => n + (n === 1 ? ' source' : ' sources');
function newsSection(key) { return state.news?.sections?.find(s => s.key === key); }

function renderHero() {
  const top = newsSection('top')?.stories || [], el = $('#hero');
  if (!top.length) { el.innerHTML = `<div class="empty"><div class="big">📰</div><div>${state.newsError ? 'Couldn’t load the news.' : 'Loading the news…'}</div></div>`; return; }
  const feat = Math.min(6, top.length); heroIdx %= feat;
  const st = top[heroIdx];
  const others = top.filter((_, i) => i !== heroIdx).slice(0, 8);
  el.innerHTML = `
    <div class="hero-img">${st.image ? `<img src="${esc(st.image)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      <span class="kick">Top story ${heroIdx + 1}/${feat}</span><h1>${esc(st.title)}</h1></div>
    <div class="hero-body">
      ${st.summary ? `<p class="hero-sum">${esc(st.summary)}</p>` : ''}
      <div class="hero-meta">${biasBar(st)}${biasLabel(st)}<span>${srcTxt(st.sources)} · ${ago(st.start)}</span></div>
      <div class="hero-more">${others.map((o, i) => `<a class="hm" href="${esc(o.url)}" target="_blank" rel="noopener"><span class="n">${i + 1}</span><span class="t">${esc(o.title)}</span><span class="s">${o.sources} src</span></a>`).join('')}</div>
    </div>
    <span class="news-foot">Ground News · updated ${tShort(new Date(state.news.generated))}</span>`;
  el.onclick = e => { if (!e.target.closest('a')) window.open(st.url, '_blank', 'noopener'); };
  el.querySelectorAll('.hm').forEach(a => a.style.color = 'inherit');
  requestAnimationFrame(() => fitList(el.querySelector('.hero-more')));
}
function renderNews() {
  renderHero();
  const keys = Object.keys(NEWS_META).filter(k => S.newsOn[k] && newsSection(k));
  const box = $('#ncols'); box.classList.toggle('two-rows', keys.length > 3);
  box.style.gridAutoFlow = keys.length > 3 ? 'column' : 'column';
  box.innerHTML = keys.map(k => {
    const [em, label] = NEWS_META[k], sts = newsSection(k).stories;
    return `<article class="card ncol"><header><span class="em">${em}</span><h2>${label}</h2></header><div class="nlist">${sts.length ? sts.map((st, i) =>
      `<a class="ni" href="${esc(st.url)}" target="_blank" rel="noopener">${i === 0 && st.image && keys.length <= 3 ? `<img src="${esc(st.image)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
        <span class="t">${esc(st.title)}</span><span class="m">${biasBar(st)}${srcTxt(st.sources)} · ${ago(st.start)}</span></a>`).join('')
      : '<div class="empty">Nothing new right now.</div>'}</div></article>`;
  }).join('');
  requestAnimationFrame(() => document.querySelectorAll('.nlist').forEach(fitList));
}
async function fetchNews() {
  try {
    const r = await fetch('news.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error(r.status);
    state.news = await r.json(); state.newsError = null; saveJSON('wd.news', state.news);
  } catch (e) { state.newsError = String(e); }
  renderNews();
}
function startHero() { clearInterval(heroTimer); heroTimer = setInterval(() => { heroIdx++; renderHero(); }, 15000); }
function renderNewsToggles() {
  $('#newsToggles').innerHTML = Object.entries(NEWS_META).map(([k, [em, label]]) =>
    `<label class="tog${S.newsOn[k] ? '' : ' off'}"><span>${em}</span><span class="cn">${label}</span><input type="checkbox" data-news="${k}"${S.newsOn[k] ? ' checked' : ''}><span class="sw2"></span></label>`).join('');
}
$('#newsToggles').addEventListener('change', e => {
  const k = e.target.dataset.news; if (!k) return;
  S.newsOn[k] = e.target.checked; saveSettings(); e.target.closest('.tog').classList.toggle('off', !e.target.checked); renderNews();
});

/* ---------------- Refresh button + automatic updates ---------------- */
let bootVersion = null;
function toast(msg, ms = 2500) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms); }
async function checkForUpdate() {
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return false;
    const { v } = await r.json();
    if (!bootVersion) { bootVersion = v; return false; }
    if (v && v !== bootVersion) { toast('✨ Update found, reloading…'); setTimeout(() => location.reload(), 1200); return true; }
  } catch {}
  return false;
}
$('#reload').addEventListener('click', async () => {
  const b = $('#reload'); b.classList.add('spin');
  if (await checkForUpdate()) return;
  lastRefresh = 0; await Promise.allSettled([fetchWeather(), fetchAir(), fetchCal(), fetchNews()]); lastRefresh = Date.now();
  b.classList.remove('spin'); toast('Everything’s up to date ✓');
});

/* ---------------- Boot & schedules ---------------- */
let lastMinute = -1, lastDay = new Date().getDate();
function tick() {
  const now = new Date();
  if (now.getMinutes() !== lastMinute) {
    lastMinute = now.getMinutes(); renderClock(); setTheme(); applyDim();
    if (now.getDate() !== lastDay) { lastDay = now.getDate(); renderCal(); fetchWeather(); }
    else if (now.getMinutes() % 5 === 0) { renderToday(); requestAnimationFrame(fitAll); }
    if (now.getHours() === 3 && now.getMinutes() === 30 && navigator.onLine) location.reload(); // daily refresh to pick up updates
  }
}
let lastRefresh = 0;
function refreshAll() { if (Date.now() - lastRefresh < 60000) return; lastRefresh = Date.now(); fetchWeather(); fetchAir(); fetchCal(); fetchNews(); }

setTheme(); renderClock(); renderWx(); renderTown(); renderCal(); renderNews(); updateDots();
refreshAll(); startRotation(); startHero(); applyDim(); wake(); checkForUpdate();
setInterval(fetchNews, 10 * 60000);
setInterval(checkForUpdate, 5 * 60000);
setInterval(tick, 1000);
setInterval(fetchWeather, 15 * 60000);
setInterval(fetchAir, 30 * 60000);
setInterval(fetchCal, 10 * 60000);
setInterval(shift, 3 * 60000);
window.addEventListener('resize', () => requestAnimationFrame(fitAll));
document.fonts?.ready.then(fitAll);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
{ const pg = +(location.search.match(/[?&]page=(\d)/) || [])[1]; if (pg > 1) requestAnimationFrame(() => { pager.scrollLeft = (pg - 1) * pager.clientWidth; updateDots(); }); }
