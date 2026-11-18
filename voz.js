// YENAVI Truck Trip Log — Asistente de voz con IA (botón de micrófono)
// Funciona en index.html (admin, español) y driver.html (driver, inglés).
// Solo CONSULTA: lee los datos de la app y contesta. No crea, cambia ni borra nada.
// La IA corre en un Apps Script de Google (ver voz-apps-script.gs). La URL y la clave se guardan en Firestore: data/voz.
(function(){
  'use strict';
  if (window.__yvoz) return; window.__yvoz = true;

  var IS_DRIVER = /driver\.html/i.test(location.pathname) || (typeof DRIVER_APP !== 'undefined' && DRIVER_APP);
  var APP = /[?&]app=voz\b/.test(location.search);   // app aparte (asistente.html → index.html?app=voz)
  var cfg = null;              // {url, k}
  var history = [];            // últimas preguntas/respuestas
  var rec = null, listening = false, busy = false;

  function T(es, en){ return IS_DRIVER ? en : es; }
  function $(id){ return document.getElementById(id); }
  function user(){ try { return (typeof currentUser !== 'undefined') ? currentUser : null; } catch(e){ return null; } }
  function allowed(){
    var u = user(); if (!u) return false;
    try { if (document.documentElement.classList.contains('eta-skin')) return false; } catch(e){}
    if (APP) return u.role === 'admin' || u.role === 'driver' || !u.role;
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
  async function ask(q, opt){
    if (busy) return; q = (q || '').trim(); if (!q) return; opt = opt || {};
    await loadCfg();
    if (!cfg || !cfg.url) { var ok = await setupCfg(); if (!ok) return; }
    busy = true; show(); addMsg('me', q, opt); var thinking = typing(true);
    try {
      var ctx = await buildContext();
      var body = JSON.stringify({ k: cfg.k, lang: IS_DRIVER ? 'en' : 'es', role: IS_DRIVER ? 'driver' : 'admin', user: (user() || {}).name, q: q, ctx: ctx, history: history.slice(-6) });
      var r = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, redirect: 'follow' });
      var txt = await r.text(); var j; try { j = JSON.parse(txt); } catch(e){ throw new Error(T('El asistente no contestó bien. Revisa la URL del Apps Script.', 'The assistant did not answer correctly.')); }
      if (j.error) { if (/clave|key/i.test(j.error) && !IS_DRIVER) { localStorage.removeItem('yvoz_cfg'); cfg = null; } throw new Error(j.error); }
      var a = (j.answer || '').trim() || T('No tengo respuesta.', 'No answer.');
      typing(false); addMsg('ai', a); history.push({ role: 'user', content: q }, { role: 'assistant', content: a }); history = history.slice(-12);
      speak(a);
    } catch(e){ typing(false); addMsg('ai', '⚠️ ' + (e && e.message ? e.message : e), { err: true }); }
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
      u.onstart = function(){ status(T('hablando…', 'speaking…')); }; u.onend = u.onerror = function(){ status(); };
      speechSynthesis.speak(u);
    } catch(e){}
  }
  function listen(){
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch(e){}
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { show(); $('yvoz-in').focus(); setHint(T('Este navegador no deja usar el micrófono aquí; escribe tu pregunta.', 'Voice is not available in this browser; type your question.')); return; }
    if (listening && rec) { try { rec.stop(); } catch(e){} return; }
    rec = new SR(); rec.lang = IS_DRIVER ? 'en-US' : 'es-US'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    var finalText = '', t0 = Date.now();
    rec.onstart = function(){ listening = true; t0 = Date.now(); show(); fab(true); setHint(''); status(T('escuchando…', 'listening…')); };
    rec.onresult = function(ev){ var s = ''; finalText = ''; for (var i = 0; i < ev.results.length; i++) { s += ev.results[i][0].transcript; if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript; } $('yvoz-in').value = s; sendBtn(); };
    rec.onerror = function(ev){ setHint(ev.error === 'not-allowed' ? T('Permite el micrófono para esta página.', 'Allow the microphone for this page.') : T('No te escuché bien, intenta otra vez.', "I didn't catch that, try again.")); };
    rec.onend = function(){ listening = false; fab(false); status(); var q = (finalText || $('yvoz-in').value || '').trim(); if (q) { $('yvoz-in').value = ''; sendBtn(); setHint(''); ask(q, { voice: Math.max(1, Math.round((Date.now() - t0) / 1000)) }); } };
    try { rec.start(); } catch(e){ listening = false; fab(false); }
  }

  // ---------- interfaz (estilo chat tipo WhatsApp) ----------
  var IC = {
    mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2.5-6.5L4 12z"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    vol: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>',
    off: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9.5l4.5 4.5M21.5 9.5L17 14"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/></svg>'
  };
  function css(){
    var s = document.createElement('style');
    s.textContent =
      '#yvoz-fab,#yvoz-panel{--yb:#0B3D91;--yb2:#1D5FBF;--paper:#ECE5DD;--me:#DCF8C6;--ink:#111B21;--sub:#667781}' +
      '#yvoz-fab svg,#yvoz-panel svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
      '#yvoz-fab{position:fixed;right:16px;bottom:calc(var(--bn-h,0px) + 84px);z-index:9990;width:58px;height:58px;border-radius:50%;border:none;background:var(--yb);color:#fff;box-shadow:0 4px 14px rgba(11,61,145,.35);cursor:pointer;display:none;align-items:center;justify-content:center;}' +
      '#yvoz-fab svg{width:26px;height:26px}' +
      '#yvoz-fab.on{background:#E53935;animation:yvozp 1.1s infinite;}' +
      '@keyframes yvozp{0%{box-shadow:0 0 0 0 rgba(229,57,53,.55)}70%{box-shadow:0 0 0 16px rgba(229,57,53,0)}100%{box-shadow:0 0 0 0 rgba(229,57,53,0)}}' +
      '#yvoz-panel{position:fixed;right:16px;bottom:calc(var(--bn-h,0px) + 16px);z-index:9991;width:400px;height:min(640px,calc(100vh - 32px));background:var(--paper);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink)}' +
      '@media (max-width:600px){#yvoz-panel{inset:0;width:auto;height:auto;border-radius:0;bottom:0;right:0}}' +
      '#yvoz-panel .h{display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top,0px)) 10px 10px 6px;background:var(--yb);color:#fff}' +
      '#yvoz-panel .h button{background:none;border:none;color:#fff;padding:6px;border-radius:50%;cursor:pointer;display:flex}' +
      '#yvoz-panel .h button:active{background:rgba(255,255,255,.15)}' +
      '#yvoz-panel .av{width:38px;height:38px;border-radius:50%;background:#fff;color:var(--yb);font-weight:800;font-size:14px;display:flex;align-items:center;justify-content:center;flex:none}' +
      '#yvoz-panel .who{flex:1;min-width:0}#yvoz-panel .who b{display:block;font-size:16px;font-weight:600}' +
      '#yvoz-st{font-size:12.5px;color:#C8D6F0}#yvoz-st.act{color:#9FE6B4}' +
      '#yvoz-log{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:4px;min-height:120px}' +
      '#yvoz-log .day{align-self:center;background:#E1F2FB;color:#54656F;font-size:12px;padding:4px 10px;border-radius:7px;margin:4px 0 6px}' +
      '#yvoz-log .m{position:relative;max-width:82%;padding:6px 9px 18px;border-radius:8px;font-size:15px;line-height:1.38;white-space:pre-wrap;word-wrap:break-word;box-shadow:0 1px .5px rgba(11,20,26,.13);margin-top:2px}' +
      '#yvoz-log .me{align-self:flex-end;background:var(--me);border-top-right-radius:0}' +
      '#yvoz-log .ai{align-self:flex-start;background:#fff;border-top-left-radius:0}' +
      '#yvoz-log .m.err{color:#B3261E}' +
      '#yvoz-log .tm{position:absolute;right:8px;bottom:3px;font-size:11px;color:var(--sub);display:flex;align-items:center;gap:3px}' +
      '#yvoz-log .tm i{font-style:normal;color:#53BDEB;letter-spacing:-3px}' +
      '#yvoz-log .vn{display:flex;align-items:center;gap:8px;min-width:190px;padding-right:4px}' +
      '#yvoz-log .vn .pl{width:30px;height:30px;border-radius:50%;background:var(--yb);color:#fff;display:flex;align-items:center;justify-content:center;flex:none}' +
      '#yvoz-log .vn .pl svg{width:15px;height:15px}' +
      '#yvoz-log .vn .wv{flex:1;display:flex;align-items:center;gap:2px;height:24px}' +
      '#yvoz-log .vn .wv span{flex:1;background:#7C9A8A;border-radius:2px}' +
      '#yvoz-log .vn em{font-style:normal;font-size:12px;color:var(--sub)}' +
      '#yvoz-log .tx{font-size:13px;color:var(--sub);margin-top:4px;font-style:italic}' +
      '#yvoz-log .rp{display:inline-flex;align-items:center;gap:4px;margin-top:6px;background:#F0F2F5;border:none;border-radius:12px;padding:3px 9px 3px 6px;font-size:12px;color:var(--yb);cursor:pointer}' +
      '#yvoz-log .rp svg{width:13px;height:13px}' +
      '#yvoz-log .typ{display:flex;gap:4px;padding:12px 14px}' +
      '#yvoz-log .typ span{width:7px;height:7px;border-radius:50%;background:#8696A0;animation:yvozd 1.2s infinite}' +
      '#yvoz-log .typ span:nth-child(2){animation-delay:.2s}#yvoz-log .typ span:nth-child(3){animation-delay:.4s}' +
      '@keyframes yvozd{0%,60%,100%{opacity:.35;transform:none}30%{opacity:1;transform:translateY(-3px)}}' +
      '#yvoz-chips{display:flex;gap:6px;overflow-x:auto;padding:4px 10px 2px;scrollbar-width:none}#yvoz-chips::-webkit-scrollbar{display:none}' +
      '#yvoz-chips button{flex:none;background:#fff;border:1px solid #D1D7DB;color:var(--yb);border-radius:16px;padding:6px 12px;font-size:13px;cursor:pointer;white-space:nowrap}' +
      '#yvoz-hint{font-size:12.5px;color:#54656F;text-align:center;padding:2px 12px 0;min-height:0}' +
      '#yvoz-hint:empty{display:none}' +
      '#yvoz-f{display:flex;align-items:flex-end;gap:6px;padding:6px 8px calc(8px + env(safe-area-inset-bottom,0px));background:transparent}' +
      '#yvoz-in{flex:1;border:none;outline:none;border-radius:22px;padding:11px 16px;font-size:16px;background:#fff;color:var(--ink);box-shadow:0 1px .5px rgba(11,20,26,.13);min-width:0}' +
      '#yvoz-go{width:46px;height:46px;border-radius:50%;border:none;background:var(--yb);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none}' +
      '#yvoz-go.on{background:#E53935;animation:yvozp 1.1s infinite}' +
      'html.voz-app #yvoz-fab{display:none!important}' +
      'html.voz-app #yvoz-panel{inset:0;width:auto;height:auto;border-radius:0;bottom:0;right:0;z-index:2147483000;box-shadow:none}' +
      'html.voz-app #yvoz-x{display:none}html.voz-app #yvoz-panel .h{padding-left:12px}' +
      '#yvoz-out{font-size:13px;font-weight:600;border:1px solid rgba(255,255,255,.35)!important;border-radius:14px!important;padding:5px 10px!important}' +
      '@media (prefers-reduced-motion:reduce){#yvoz-fab.on,#yvoz-go.on,#yvoz-log .typ span{animation:none}}';
    document.head.appendChild(s);
  }
  function hhmm(){ return new Date().toLocaleTimeString(IS_DRIVER ? 'en-US' : 'es-US', { hour: 'numeric', minute: '2-digit' }); }
  function chips(){
    if (IS_DRIVER) return ['How much did I earn this week?', 'Where is my delivery?', 'Diesel this week?'];
    var out = [];
    try { (typeof getUsers === 'function' ? getUsers() : []).filter(function(x){ return x.role === 'driver' && x.truckId != null && x.truckId !== ''; }).slice(0, 2).forEach(function(x){ out.push('¿Dónde está ' + String(x.name).split(' ')[0] + '?'); }); } catch(e){}
    return out.concat(['¿Qué cargas faltan por cobrar?', '¿Cuánto ganamos esta semana?']);
  }
  var cssDone = false;
  function ui(){
    if (!cssDone) { css(); cssDone = true; }
    var b = document.createElement('button'); b.id = 'yvoz-fab'; b.type = 'button'; b.title = T('Asistente YENAVI', 'YENAVI Assistant'); b.setAttribute('aria-label', b.title); b.innerHTML = IC.mic;
    b.onclick = function(){ show(); }; document.body.appendChild(b);
    var p = document.createElement('div'); p.id = 'yvoz-panel';
    p.innerHTML = '<div class="h"><button type="button" id="yvoz-x" aria-label="' + T('Cerrar', 'Close') + '">' + IC.back + '</button>' +
      '<div class="av">YF</div><div class="who"><b>' + T('Asistente YENAVI', 'YENAVI Assistant') + '</b><div id="yvoz-st">' + T('en línea', 'online') + '</div></div>' +
      '<button type="button" id="yvoz-mute" aria-label="' + T('Voz encendida', 'Voice on') + '">' + IC.vol + '</button>' +
      (IS_DRIVER ? '' : '<button type="button" id="yvoz-cfg" aria-label="' + T('Configurar', 'Settings') + '">' + IC.gear + '</button>') +
      (APP ? '<button type="button" id="yvoz-out">' + T('Salir', 'Log out') + '</button>' : '') + '</div>' +
      '<div id="yvoz-log"><div class="day">' + T('HOY', 'TODAY') + '</div></div>' +
      '<div id="yvoz-chips"></div><div id="yvoz-hint"></div>' +
      '<form id="yvoz-f"><input id="yvoz-in" autocomplete="off" enterkeyhint="send" placeholder="' + T('Escribe o toca el micrófono', 'Type or tap the mic') + '">' +
      '<button type="button" id="yvoz-go" aria-label="' + T('Hablar', 'Talk') + '">' + IC.mic + '</button></form>';
    document.body.appendChild(p);
    $('yvoz-x').onclick = function(){ p.style.display = 'none'; try { if (listening && rec) rec.stop(); speechSynthesis.cancel(); } catch(e){} };
    $('yvoz-mute').onclick = function(){ var m = this.dataset.on === '1' ? '0' : '1'; this.dataset.on = m; this.innerHTML = m === '1' ? IC.off : IC.vol; this.setAttribute('aria-label', m === '1' ? T('Voz apagada', 'Voice off') : T('Voz encendida', 'Voice on')); if (m === '1') try { speechSynthesis.cancel(); } catch(e){} };
    if ($('yvoz-cfg')) $('yvoz-cfg').onclick = function(){ setupCfg(); };
    if ($('yvoz-out')) $('yvoz-out').onclick = function(){ try { speechSynthesis.cancel(); } catch(e){} try { if (typeof doLogout === 'function') doLogout(); } catch(e){} };
    $('yvoz-in').oninput = sendBtn;
    $('yvoz-go').onclick = function(){ var q = $('yvoz-in').value.trim(); if (q && !listening) { $('yvoz-in').value = ''; sendBtn(); ask(q); } else listen(); };
    $('yvoz-f').onsubmit = function(e){ e.preventDefault(); var q = $('yvoz-in').value; $('yvoz-in').value = ''; sendBtn(); ask(q); };
    addMsg('ai', T('Hola 👋 Pregúntame lo que quieras de la app: dónde está un driver, viajes en tránsito, ganancias de la semana, pagos pendientes, diésel o millas. Mándame una nota de voz con el micrófono o escríbeme.',
                   'Hi 👋 Ask me about your trips: your pay this week, miles, diesel or your current trip. Send me a voice note with the mic or type.'), { noReplay: true });
  }
  var chipsDone = false;
  function show(){
    var p = $('yvoz-panel'); if (!p) return; p.style.display = 'flex';
    if (!chipsDone) { chipsDone = true; var c = $('yvoz-chips'); chips().forEach(function(q){ var x = document.createElement('button'); x.type = 'button'; x.textContent = q; x.onclick = function(){ ask(q); }; c.appendChild(x); }); }
    var l = $('yvoz-log'); l.scrollTop = l.scrollHeight;
  }
  function sendBtn(){ var g = $('yvoz-go'), i = $('yvoz-in'); if (!g || !i) return; var txt = !!i.value.trim() && !listening; g.innerHTML = txt ? IC.send : IC.mic; g.setAttribute('aria-label', txt ? T('Enviar', 'Send') : T('Hablar', 'Talk')); }
  function fab(on){ var b = $('yvoz-fab'); if (b) b.classList.toggle('on', !!on); var g = $('yvoz-go'); if (g) { g.classList.toggle('on', !!on); g.innerHTML = IC.mic; } var i = $('yvoz-in'); if (i) i.placeholder = on ? T('Escuchando… habla ahora', 'Listening… speak now') : T('Escribe o toca el micrófono', 'Type or tap the mic'); }
  function status(t){ var e = $('yvoz-st'); if (!e) return; e.textContent = t || T('en línea', 'online'); e.classList.toggle('act', !!t); }
  function setHint(t){ var h = $('yvoz-hint'); if (h) h.textContent = t || ''; }
  function typing(on){
    var l = $('yvoz-log'), t = $('yvoz-typ'); if (t) t.remove();
    status(on ? T('escribiendo…', 'typing…') : '');
    if (!on) return null;
    var d = document.createElement('div'); d.id = 'yvoz-typ'; d.className = 'm ai typ'; d.innerHTML = '<span></span><span></span><span></span>'; l.appendChild(d); l.scrollTop = l.scrollHeight; return d;
  }
  function addMsg(who, text, o){
    o = o || {}; var d = document.createElement('div'); d.className = 'm ' + who + (o.err ? ' err' : '');
    if (who === 'me' && o.voice) {
      var bars = ''; for (var i = 0; i < 26; i++) bars += '<span style="height:' + (5 + Math.round(Math.abs(Math.sin(i * 1.7 + text.length)) * 17)) + 'px"></span>';
      d.innerHTML = '<div class="vn"><div class="pl">' + IC.mic + '</div><div class="wv">' + bars + '</div><em>0:' + ('0' + Math.min(59, o.voice)).slice(-2) + '</em></div>';
      var tx = document.createElement('div'); tx.className = 'tx'; tx.textContent = '“' + text + '”'; d.appendChild(tx);
    } else d.textContent = text;
    if (who === 'ai' && !o.err && !o.noReplay) { var r = document.createElement('button'); r.type = 'button'; r.className = 'rp'; r.innerHTML = IC.play + T('Escuchar', 'Listen'); r.onclick = function(){ var m = $('yvoz-mute'); var was = m.dataset.on; m.dataset.on = '0'; speak(text); m.dataset.on = was; }; d.appendChild(document.createElement('br')); d.appendChild(r); }
    var tm = document.createElement('span'); tm.className = 'tm'; tm.innerHTML = hhmm() + (who === 'me' ? ' <i>✓✓</i>' : ''); d.appendChild(tm);
    var l = $('yvoz-log'); l.appendChild(d); l.scrollTop = l.scrollHeight; return d;
  }

  var builtFor = null;
  function tick(){
    if (APP) {
      var u = user(), a = allowed();
      var key = a ? (u.username || u.name) + '|' + u.role : null;
      if (key !== builtFor) {
        ['yvoz-fab', 'yvoz-panel'].forEach(function(id){ var e = $(id); if (e) e.remove(); });
        chipsDone = false; history = []; builtFor = key;
        if (a) { IS_DRIVER = u.role === 'driver' || !u.role; ui(); show(); }
      }
      return;
    }
    var b = $('yvoz-fab'); if (!b) return; var a2 = allowed(); b.style.display = a2 ? 'flex' : 'none'; if (!a2) { var p = $('yvoz-panel'); if (p) p.style.display = 'none'; }
  }
  function start(){
    try {
      if (APP) { document.documentElement.classList.add('voz-app'); if (!cssDone) { css(); cssDone = true; } }
      else ui();
      setInterval(tick, APP ? 700 : 1500); tick(); try { speechSynthesis && speechSynthesis.getVoices(); } catch(e){}
    } catch(e){ console.warn('voz', e); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
