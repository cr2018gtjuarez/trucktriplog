// YENAVI Truck Trip Log — Asistente de voz con IA (botón de micrófono)
// Funciona en index.html (admin, español) y driver.html (driver, inglés).
// Solo CONSULTA: lee los datos de la app y contesta. No crea, cambia ni borra nada.
// La IA corre en un Apps Script de Google (ver voz-apps-script.gs). La URL y la clave se guardan en Firestore: data/voz.
(function(){
  'use strict';
  if (window.__yvoz) return; window.__yvoz = true;

  var IS_DRIVER = /driver\.html/i.test(location.pathname) || (typeof DRIVER_APP !== 'undefined' && DRIVER_APP);
  var cfg = null;              // {url, k}
  var history = [];            // últimas preguntas/respuestas
  var rec = null, listening = false, busy = false;

  function T(es, en){ return IS_DRIVER ? en : es; }
  function $(id){ return document.getElementById(id); }
  function user(){ try { return (typeof currentUser !== 'undefined') ? currentUser : null; } catch(e){ return null; } }
  function allowed(){
    var u = user(); if (!u) return false;
    try { if (document.documentElement.classList.contains('eta-skin')) return false; } catch(e){}
    return IS_DRIVER ? (u.role === 'driver' || !u.role) : (u.role === 'admin');
  }
  function fb(){ try { return (typeof fbReady !== 'undefined' && fbReady && typeof db !== 'undefined' && db) ? db : null; } catch(e){ return null; } }

  // ---------- configuración (URL del Apps Script + clave) ----------
  async function loadCfg(){
    if (cfg && cfg.url) return cfg;
    try { var c = JSON.parse(localStorage.getItem('yvoz_cfg') || 'null'); if (c && c.url) cfg = c; } catch(e){}
    var d = fb();
    if (d) { try { var sn = await d.collection('data').doc('voz').get(); if (sn.exists && sn.data().url) { cfg = { url: sn.data().url, k: sn.data().k || '' }; localStorage.setItem('yvoz_cfg', JSON.stringify(cfg)); } } catch(e){} }
    return cfg;
  }
  async function setupCfg(){
    if (IS_DRIVER) { alert('The voice assistant is not set up yet. Ask the admin.'); return false; }
    var url = prompt('Configurar asistente de voz (solo una vez)\n\nPega la URL del Apps Script del asistente (termina en /exec):', (cfg && cfg.url) || '');
    if (!url) return false; url = url.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) { alert('Esa URL no parece correcta. Debe empezar con https://script.google.com/macros/s/ y terminar en /exec'); return false; }
    var k = prompt('Pega la CLAVE del asistente (VOZ_KEY, la que pusiste en el Apps Script):', (cfg && cfg.k) || '');
    if (!k) return false;
    cfg = { url: url, k: k.trim() };
    localStorage.setItem('yvoz_cfg', JSON.stringify(cfg));
    var d = fb(); if (d) { try { await d.collection('data').doc('voz').set({ url: cfg.url, k: cfg.k, updatedAt: new Date().toISOString() }); } catch(e){} }
    return true;
  }

  // ---------- datos para la IA ----------
  function num(x){ var n = parseFloat(x); return isFinite(n) ? Math.round(n * 100) / 100 : undefined; }
  function clean(o){ var r = {}; Object.keys(o).forEach(function(k){ var v = o[k]; if (v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && isNaN(v))) r[k] = v; }); return r; }
  function place(c, s, z){ return [c, s].filter(Boolean).join(', ') + (z ? ' ' + z : ''); }
  function chicagoNow(){ return new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'long', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function daysAgoISO(n){ var d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

  function tripRow(t, forDriver){
    var fuelUSD = num(t.totalCost);
    if (fuelUSD === undefined && Array.isArray(t.fuelLoads)) { var s = 0; t.fuelLoads.forEach(function(f){ s += parseFloat(f.total || f.amount || f.cost || 0) || 0; }); fuelUSD = num(s); }
    var row = {
      rc: t.rc, broker: t.brokerName || t.broker, driver: t.driverName, truck: t.truck || t.truckId,
      pickup: place(t.city1, t.state1, t.z1), delivery: place(t.city2, t.state2, t.z2),
      pickupDate: t.date || t.pickupDate, deliveryDate: t.deliveryDate,
      status: t.tripStatus, started: t.startTime, finished: t.endTime,
      loadType: t.loadType, miles: num(t.miles), deadMiles: num(t.deadMiles),
      fuelGal: num(t.totalGal), fuelUSD: fuelUSD,
      driverPay: num(t.driver), driverPayPct: num(t.payPct), driverPaid: t.driverPayStatus
    };
    if (!forDriver) {
      row.loadValue = num(t.loadVal != null ? t.loadVal : t.loadValue);
      row.brokerPaid = t.payStatus; row.factoringFee = num(t.factoringFee); row.factoringPct = num(t.factoringFeePct);
      row.dispatchFeePct = num(t.brokerFeePct); row.netProfit = num(t.net); row.extras = (typeof t.extras === 'number' || typeof t.extras === 'string') ? t.extras : undefined;
      row.notes = t.payNotes;
    }
    return clean(row);
  }

  var geoCache = {};
  async function cityOf(lat, lon){
    var key = (+lat).toFixed(2) + ',' + (+lon).toFixed(2);
    if (geoCache[key]) return geoCache[key];
    try {
      var r = await fetch('https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&lat=' + lat + '&lon=' + lon);
      if (!r.ok) return null; var j = await r.json(); var a = j.address || {};
      var c = a.city || a.town || a.village || a.county || ''; var st = (a['ISO3166-2-lvl4'] || '').split('-')[1] || a.state || '';
      var out = c ? (c + (st ? ', ' + st : '') + (a.postcode ? ' ' + a.postcode : '')) : null;
      if (out) geoCache[key] = out; return out;
    } catch(e){ return null; }
  }
  async function locations(u){
    var d = fb(); if (!d) return [];
    var docs = [];
    try {
      if (IS_DRIVER) { var sn = await d.collection('locations').doc(u.username).get(); if (sn.exists) docs.push({ id: sn.id, v: sn.data() }); if (u.truckId != null && u.truckId !== '') { var st = await d.collection('locations').doc('truck_' + u.truckId).get(); if (st.exists) docs.push({ id: st.id, v: st.data() }); } }
      else { var all = await d.collection('locations').get(); all.forEach(function(x){ docs.push({ id: x.id, v: x.data() }); }); }
    } catch(e){ return []; }
    var now = Date.now(), out = [];
    for (var i = 0; i < docs.length; i++) {
      var v = docs[i].v || {}; var tm = typeof v.time === 'number' ? v.time : Date.parse(v.time);
      if (!tm || now - tm > 3 * 86400000 || v.lat == null || v.lon == null) continue;
      var where = (out.length < 6) ? await cityOf(v.lat, v.lon) : null;
      out.push(clean({ who: docs[i].id.indexOf('truck_') === 0 ? ('ELD camión ' + docs[i].id.slice(6)) : (v.name || docs[i].id), place: where, lat: num(v.lat), lon: num(v.lon), minutesAgo: Math.round((now - tm) / 60000), status: v.movingStatus, mph: v.speedMph }));
    }
    return out;
  }

  async function buildContext(){
    var u = user(); var trips = [];
    try { trips = (typeof loadTrips === 'function' ? loadTrips() : []) || []; } catch(e){}
    var cut = daysAgoISO(IS_DRIVER ? 120 : 150);
    var mine = IS_DRIVER ? trips.filter(function(t){ return (t.driverUser && t.driverUser === u.username) || (t.driverName && u.name && String(t.driverName).toLowerCase() === String(u.name).toLowerCase()); }) : trips;
    var rows = mine.filter(function(t){
      var d = t.deliveryDate || t.date || '';
      return t.tripStatus !== 'completed' || !d || d >= cut || (!IS_DRIVER && t.payStatus && t.payStatus !== 'paid');
    }).sort(function(a, b){ return String(b.date || '').localeCompare(String(a.date || '')); }).slice(0, 220).map(function(t){ return tripRow(t, IS_DRIVER); });
    var ctx = { now: chicagoNow() + ' (Central Time)', user: { name: u.name, role: u.role }, workWeek: 'Saturday to Friday; a load counts in the week it was delivered', trips: rows };
    if (!IS_DRIVER) {
      try { ctx.drivers = getUsers().filter(function(x){ return x.role !== 'admin'; }).map(function(x){ return clean({ name: x.name, username: x.username, role: x.role, truckId: x.truckId }); }); } catch(e){}
      try { if (typeof loadTrucks === 'function') ctx.trucks = loadTrucks().map(function(t){ var r = {}; Object.keys(t || {}).forEach(function(k){ var v = t[k]; if ((typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length < 80)) && !/img|image|photo|foto|base64/i.test(k)) r[k] = v; }); return r; }); } catch(e){}
    }
    ctx.liveLocations = await locations(u);
    return ctx;
  }

  // ---------- llamada a la IA ----------
  async function ask(q){
    if (busy) return; q = (q || '').trim(); if (!q) return;
    await loadCfg();
    if (!cfg || !cfg.url) { var ok = await setupCfg(); if (!ok) return; }
    busy = true; show(); addMsg('me', q); var thinking = addMsg('ai', T('Pensando…', 'Thinking…'));
    try {
      var ctx = await buildContext();
      var body = JSON.stringify({ k: cfg.k, lang: IS_DRIVER ? 'en' : 'es', role: IS_DRIVER ? 'driver' : 'admin', user: (user() || {}).name, q: q, ctx: ctx, history: history.slice(-6) });
      var r = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, redirect: 'follow' });
      var txt = await r.text(); var j; try { j = JSON.parse(txt); } catch(e){ throw new Error(T('El asistente no contestó bien. Revisa la URL del Apps Script.', 'The assistant did not answer correctly.')); }
      if (j.error) { if (/clave|key/i.test(j.error) && !IS_DRIVER) { localStorage.removeItem('yvoz_cfg'); cfg = null; } throw new Error(j.error); }
      var a = (j.answer || '').trim() || T('No tengo respuesta.', 'No answer.');
      thinking.textContent = a; history.push({ role: 'user', content: q }, { role: 'assistant', content: a }); history = history.slice(-12);
      speak(a);
    } catch(e){ thinking.textContent = '⚠️ ' + (e && e.message ? e.message : e); thinking.style.color = '#c0392b'; }
    busy = false;
  }

  // ---------- voz ----------
  function speak(text){
    try {
      if (!window.speechSynthesis || $('yvoz-mute').dataset.on === '1') return;
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text.replace(/[*#_`]/g, ''));
      u.lang = IS_DRIVER ? 'en-US' : 'es-US'; u.rate = 1.03;
      var vs = speechSynthesis.getVoices().filter(function(v){ return v.lang && v.lang.toLowerCase().indexOf(IS_DRIVER ? 'en' : 'es') === 0; });
      if (vs.length) u.voice = vs.find(function(v){ return /US|MX|419/i.test(v.lang); }) || vs[0];
      speechSynthesis.speak(u);
    } catch(e){}
  }
  function listen(){
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch(e){}
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { show(); $('yvoz-in').focus(); setHint(T('Este navegador no deja usar el micrófono aquí; escribe tu pregunta.', 'Voice is not available in this browser; type your question.')); return; }
    if (listening && rec) { try { rec.stop(); } catch(e){} return; }
    rec = new SR(); rec.lang = IS_DRIVER ? 'en-US' : 'es-US'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    var finalText = '';
    rec.onstart = function(){ listening = true; show(); fab(true); setHint(T('Te escucho… habla ahora', 'Listening… speak now')); };
    rec.onresult = function(ev){ var s = ''; finalText = ''; for (var i = 0; i < ev.results.length; i++) { s += ev.results[i][0].transcript; if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript; } $('yvoz-in').value = s; };
    rec.onerror = function(ev){ setHint(ev.error === 'not-allowed' ? T('Permite el micrófono para esta página.', 'Allow the microphone for this page.') : T('No te escuché bien, intenta otra vez.', "I didn't catch that, try again.")); };
    rec.onend = function(){ listening = false; fab(false); var q = (finalText || $('yvoz-in').value || '').trim(); if (q) { $('yvoz-in').value = ''; setHint(''); ask(q); } };
    try { rec.start(); } catch(e){ listening = false; fab(false); }
  }

  // ---------- interfaz ----------
  function css(){
    var s = document.createElement('style');
    s.textContent =
      '#yvoz-fab{position:fixed;right:16px;bottom:calc(var(--bn-h,0px) + 84px);z-index:9990;width:58px;height:58px;border-radius:50%;border:none;background:linear-gradient(135deg,#1a5f9c,#0d3b66);color:#fff;font-size:26px;box-shadow:0 6px 18px rgba(13,59,102,.35);cursor:pointer;display:none;align-items:center;justify-content:center;}' +
      '#yvoz-fab.on{background:linear-gradient(135deg,#e74c3c,#c0392b);animation:yvozp 1.1s infinite;}' +
      '@keyframes yvozp{0%{box-shadow:0 0 0 0 rgba(231,76,60,.55)}70%{box-shadow:0 0 0 16px rgba(231,76,60,0)}100%{box-shadow:0 0 0 0 rgba(231,76,60,0)}}' +
      '#yvoz-panel{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(var(--bn-h,0px) + 12px);z-index:9991;width:min(560px,calc(100% - 20px));max-height:min(70vh,560px);background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;font-family:inherit;}' +
      '#yvoz-panel .h{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0d3b66;color:#fff;font-weight:700;font-size:15px}' +
      '#yvoz-panel .h button{background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:8px;padding:5px 9px;font-size:13px;cursor:pointer}' +
      '#yvoz-log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f5f7fa;min-height:120px}' +
      '#yvoz-log .m{max-width:88%;padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.4;white-space:pre-wrap}' +
      '#yvoz-log .me{align-self:flex-end;background:#1a5f9c;color:#fff;border-bottom-right-radius:4px}' +
      '#yvoz-log .ai{align-self:flex-start;background:#fff;color:#1f2d3d;border:1px solid #e3e8ef;border-bottom-left-radius:4px}' +
      '#yvoz-hint{font-size:12px;color:#6b7a8c;padding:4px 14px 0;min-height:16px}' +
      '#yvoz-f{display:flex;gap:6px;padding:10px;border-top:1px solid #e3e8ef}' +
      '#yvoz-in{flex:1;border:1px solid #cfd8e3;border-radius:10px;padding:10px;font-size:15px}' +
      '#yvoz-f button{border:none;border-radius:10px;padding:0 14px;font-size:18px;cursor:pointer;background:#1a5f9c;color:#fff}' +
      '#yvoz-f #yvoz-mic2{background:#eef3f8;color:#0d3b66}';
    document.head.appendChild(s);
  }
  function ui(){
    css();
    var b = document.createElement('button'); b.id = 'yvoz-fab'; b.type = 'button'; b.title = T('Asistente de voz', 'Voice assistant'); b.textContent = '🎤';
    b.onclick = listen; document.body.appendChild(b);
    var p = document.createElement('div'); p.id = 'yvoz-panel';
    p.innerHTML = '<div class="h"><span style="flex:1">🎤 ' + T('Asistente YENAVI', 'YENAVI Assistant') + '</span>' +
      '<button type="button" id="yvoz-mute" title="' + T('Voz encendida/apagada', 'Voice on/off') + '">🔊</button>' +
      (IS_DRIVER ? '' : '<button type="button" id="yvoz-cfg" title="Configurar">⚙️</button>') +
      '<button type="button" id="yvoz-x">✕</button></div>' +
      '<div id="yvoz-log"></div><div id="yvoz-hint"></div>' +
      '<form id="yvoz-f"><input id="yvoz-in" autocomplete="off" placeholder="' + T('Pregunta algo… ej. ¿dónde está Jairo?', 'Ask something… e.g. how much did I earn this week?') + '">' +
      '<button type="button" id="yvoz-mic2">🎤</button><button type="submit">➤</button></form>';
    document.body.appendChild(p);
    $('yvoz-x').onclick = function(){ p.style.display = 'none'; try { speechSynthesis.cancel(); } catch(e){} };
    $('yvoz-mute').onclick = function(){ var m = this.dataset.on === '1' ? '0' : '1'; this.dataset.on = m; this.textContent = m === '1' ? '🔇' : '🔊'; if (m === '1') try { speechSynthesis.cancel(); } catch(e){} };
    if ($('yvoz-cfg')) $('yvoz-cfg').onclick = function(){ setupCfg(); };
    $('yvoz-mic2').onclick = listen;
    $('yvoz-f').onsubmit = function(e){ e.preventDefault(); var q = $('yvoz-in').value; $('yvoz-in').value = ''; ask(q); };
    addMsg('ai', T('Hola 👋 Pregúntame lo que quieras de la app: dónde está un driver, viajes en tránsito, ganancias de la semana, pagos pendientes, diésel, millas… Toca 🎤 y habla.',
                   'Hi 👋 Ask me about your trips: your pay this week, miles, diesel, your current trip… Tap 🎤 and talk.'));
  }
  function show(){ var p = $('yvoz-panel'); if (p) p.style.display = 'flex'; }
  function fab(on){ var b = $('yvoz-fab'); if (b) b.classList.toggle('on', !!on); }
  function setHint(t){ var h = $('yvoz-hint'); if (h) h.textContent = t || ''; }
  function addMsg(who, text){ var d = document.createElement('div'); d.className = 'm ' + who; d.textContent = text; var l = $('yvoz-log'); l.appendChild(d); l.scrollTop = l.scrollHeight; return d; }

  function tick(){ var b = $('yvoz-fab'); if (!b) return; var a = allowed(); b.style.display = a ? 'flex' : 'none'; if (!a) { var p = $('yvoz-panel'); if (p) p.style.display = 'none'; } }
  function start(){ try { ui(); setInterval(tick, 1500); tick(); try { speechSynthesis && speechSynthesis.getVoices(); } catch(e){} } catch(e){ console.warn('voz', e); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
