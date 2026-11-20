// YENAVI Truck Trip Log — Revisión automática del POD con IA
// Funciona en driver.html (driver, inglés) e index.html (admin, español). Se carga después de la app.
//
// 1) Cuando el driver sube el POD, la IA lo revisa en segundos (firma del receiver en el lugar correcto,
//    nombre impreso, fecha de entrega, número de carga, foto completa) y le dice si se puede ir o qué falta.
// 2) El resultado se guarda en el viaje (trip.podAi) y te llega aviso (Telegram + campanita).
// 3) Si el POD salió ❌, el driver no puede finalizar el viaje y, si se aleja del receiver, suena una alarma
//    en su celular y te llega aviso a ti.
// La IA corre en el mismo Apps Script del asistente (voz-apps-script.gs, función revisarPOD_).
(function(){
  'use strict';
  if (window.__ypod) return; window.__ypod = true;

  var IS_DRIVER_PAGE = /driver\.html/i.test(location.pathname);
  var LEAVE_KM = 0.8;          // ~0.5 millas del receiver = "ya se fue"
  var CHECK_MS = 30000;        // revisa la ubicación cada 30 s

  function user(){ try { return (typeof currentUser !== 'undefined') ? currentUser : null; } catch(e){ return null; } }
  function isDriver(){ var u = user(); return !!u && (u.role === 'driver' || (!u.role && IS_DRIVER_PAGE)); }
  function en(){ return isDriver() || window.TL_LANG === 'en'; }
  function esc(x){ return String(x == null ? '' : x).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function trips(){ try { return loadTrips() || []; } catch(e){ return []; } }
  function fb(){ try { return (typeof fbReady !== 'undefined' && fbReady && typeof db !== 'undefined' && db) ? db : null; } catch(e){ return null; } }

  // ---------- ¿el POD de este viaje ya está bien? ----------
  function podOk(t){ return !!(t && (t.podApproved || (t.podAi && t.podAi.verdict === 'ok'))); }
  function podBad(t){ return !!(t && !t.podApproved && t.podAi && t.podAi.verdict === 'reject'); }
  window.podOk = podOk;

  // ---------- configuración del Apps Script (la misma del asistente de voz) ----------
  var cfg = null;
  async function loadCfg(){
    if (cfg && cfg.url) return cfg;
    try { var c = JSON.parse(localStorage.getItem('yvoz_cfg') || 'null'); if (c && c.url) cfg = c; } catch(e){}
    if (cfg && cfg.url) return cfg;
    var d = fb();
    if (d) { try { var sn = await d.collection('data').doc('voz').get(); if (sn.exists && sn.data().url) { cfg = { url: sn.data().url, k: sn.data().k || '' }; localStorage.setItem('yvoz_cfg', JSON.stringify(cfg)); } } catch(e){} }
    return cfg;
  }

  function tripInfo(t){
    return {
      rc: t.rc || '', broker: t.brokerName || '', driver: t.driverName || '',
      shipper: [t.city1, t.state1, t.z1].filter(Boolean).join(' '), pickupAddress: t.pickupAddress || '',
      consignee: [t.city2, t.state2, t.z2].filter(Boolean).join(' '), deliveryAddress: t.deliveryAddress || '',
      pickupDate: t.date || t.pickupDate || '', deliveryDate: t.deliveryDate || ''
    };
  }

  async function callAi(t, dataUrl){
    var c = await loadCfg();
    if (!c || !c.url) throw new Error(en() ? 'AI check is not set up' : 'El asistente IA no está configurado');
    var m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(dataUrl || '');
    if (!m) throw new Error('foto');
    var body = JSON.stringify({ k: c.k, mode: 'pod', images: [{ media_type: m[1] === 'image/jpg' ? 'image/jpeg' : m[1], data: m[2] }], trip: tripInfo(t) });
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = setTimeout(function(){ try { ctl && ctl.abort(); } catch(e){} }, 90000);
    try {
      var r = await fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, redirect: 'follow', signal: ctl ? ctl.signal : undefined });
      var j = await r.json();
      if (j.error) throw new Error(j.error);
      if (!j.pod || !j.pod.verdict) throw new Error('sin respuesta');
      return j.pod;
    } finally { clearTimeout(timer); }
  }

  // ---------- guardar el resultado en el viaje (en fila con las otras escrituras) ----------
  function saveAi(tripId, ai){
    var run = async function(){
      var T = trips(); var i = T.findIndex(function(x){ return String(x.id) === String(tripId); }); if (i < 0) return null;
      T[i] = Object.assign({}, T[i], { podAi: ai });
      await storeTrips(T); return T[i];
    };
    var p = (window._tripWriteChain || Promise.resolve()).then(run);
    window._tripWriteChain = p.catch(function(){});
    return p;
  }

  function lastLoc(){
    try { var l = JSON.parse(localStorage.getItem('trucklog_last_location') || 'null'); if (l && isFinite(l.lat) && isFinite(l.lon) && Date.now() - Date.parse(l.time) < 30 * 60000) return { lat: +l.lat, lon: +l.lon }; } catch(e){}
    return null;
  }

  // ---------- pantallas para el driver ----------
  function sheet(html){
    var old = document.getElementById('ypod-sheet'); if (old) old.remove();
    var m = document.createElement('div'); m.id = 'ypod-sheet'; m.setAttribute('data-no-tr', '1');
    m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:100000;display:flex;align-items:flex-end;justify-content:center;';
    m.innerHTML = '<div style="background:var(--card,#fff);color:var(--text,#111);width:100%;max-width:520px;border-radius:18px 18px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom));max-height:88vh;overflow:auto;">' + html + '</div>';
    document.body.appendChild(m); return m;
  }
  function closeSheet(){ var m = document.getElementById('ypod-sheet'); if (m) m.remove(); }
  window.ypodClose = closeSheet;
  window.ypodRetake = function(){ closeSheet(); try { triggerBolUpload('pod'); } catch(e){} };

  function showChecking(){
    sheet('<div style="text-align:center;padding:14px 0;"><div style="font-size:40px;">🔎</div>' +
      '<div style="font-size:18px;font-weight:800;margin-top:6px;">' + (en() ? 'Checking your POD…' : 'Revisando el POD…') + '</div>' +
      '<div style="font-size:14px;color:var(--text3,#666);margin-top:6px;">' + (en() ? 'Stay at the receiver until you see the result. It takes a few seconds.' : 'Espera el resultado. Tarda unos segundos.') + '</div></div>');
  }

  function verdictHtml(ai, forDriver){
    var E = forDriver ? true : en();
    var probs = (ai.problems_en || []).filter(Boolean);
    if (ai.verdict === 'ok') {
      return '<div style="text-align:center;"><div style="font-size:44px;">✅</div><div style="font-size:20px;font-weight:900;color:#15803D;">' + (E ? 'POD OK — you can leave' : 'POD correcto') + '</div>' +
        '<div style="font-size:14px;margin-top:8px;">' + (ai.receiver_name ? (E ? 'Received by: ' : 'Recibió: ') + '<b>' + esc(ai.receiver_name) + '</b>' : '') + (ai.delivery_date ? ' · ' + esc(ai.delivery_date) : '') + '</div></div>';
    }
    var bad = ai.verdict === 'reject';
    return '<div style="text-align:center;"><div style="font-size:44px;">' + (bad ? '🛑' : '⚠️') + '</div>' +
      '<div style="font-size:20px;font-weight:900;color:' + (bad ? '#B91C1C' : '#B45309') + ';">' + (bad ? (E ? 'DO NOT LEAVE YET' : 'POD RECHAZADO') : (E ? 'Wait — office must check' : 'Revisar POD')) + '</div></div>' +
      (probs.length ? '<div style="background:' + (bad ? '#FEF2F2' : '#FFFBEB') + ';border:1px solid ' + (bad ? '#FECACA' : '#FDE68A') + ';border-radius:12px;padding:10px 12px;margin-top:12px;font-size:14px;line-height:1.45;">' + probs.map(function(p){ return '• ' + esc(p); }).join('<br>') + '</div>' : '') +
      (ai.fix_en ? '<div style="margin-top:12px;font-size:15px;line-height:1.45;"><b>' + (E ? 'What to do: ' : 'Qué hacer: ') + '</b>' + esc(ai.fix_en) + '</div>' : '') +
      (!forDriver && ai.resumen_es ? '<div style="margin-top:8px;font-size:13px;color:var(--text3,#666);">' + esc(ai.resumen_es) + '</div>' : '');
  }

  function showResult(ai){
    var bad = ai.verdict !== 'ok';
    sheet(verdictHtml(ai, true) +
      (bad ? '<button type="button" onclick="ypodRetake()" style="width:100%;margin-top:16px;padding:14px;border:none;border-radius:12px;background:#1E3A8A;color:#fff;font-weight:800;font-size:16px;">📷 ' + (en() ? 'Take a new POD photo' : 'Tomar otra foto del POD') + '</button>' : '') +
      '<button type="button" onclick="ypodClose()" style="width:100%;margin-top:10px;padding:13px;border:1px solid var(--border,#ddd);border-radius:12px;background:transparent;color:inherit;font-weight:700;font-size:15px;">' + (bad ? (en() ? 'Close' : 'Cerrar') : 'OK') + '</button>');
    try { if (bad && navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 600]); } catch(e){}
  }

  function notifyOwner(t, ai, extra){
    try {
      var icon = ai.verdict === 'ok' ? '✅' : ai.verdict === 'reject' ? '🛑' : '⚠️';
      var msg = icon + ' <b>POD revisado por IA: ' + (ai.verdict === 'ok' ? 'CORRECTO' : ai.verdict === 'reject' ? 'RECHAZADO' : 'REVISAR') + '</b>\n' +
        (t.driverName || '') + (t.rc ? ' · RC #' + t.rc : '') + ' · ' + (t.city2 || '') + '\n' + (ai.resumen_es || '') + (extra ? '\n' + extra : '');
      tgAddNotif(sanitizeForFirestore({ tripId: t.id, driverName: t.driverName || '', type: 'pod_ai', msg: msg, city1: t.city1, city2: t.city2, ts: new Date().toISOString(), read: false })).catch(function(){});
    } catch(e){}
  }

  // ---------- revisar un POD recién subido ----------
  async function runCheck(tripId, file){
    var t0 = trips().find(function(x){ return String(x.id) === String(tripId); }); if (!t0) return;
    var dataUrl;
    try { dataUrl = await shrinkDataUrl(await fileToDataUrl0(file), 2000, 0.85); } catch(e){ return; }
    var driver = isDriver();
    if (driver) showChecking();
    var ai;
    try { ai = await callAi(t0, dataUrl); }
    catch(err){
      if (driver) sheet('<div style="text-align:center;"><div style="font-size:40px;">📡</div><div style="font-size:17px;font-weight:800;margin-top:6px;">' + (en() ? 'Could not check the POD automatically' : 'No se pudo revisar el POD') + '</div>' +
        '<div style="font-size:14px;margin-top:8px;line-height:1.45;">' + (en() ? 'Check it yourself before leaving: receiver signature on the RECEIVER line, printed name and date.' : 'Revísalo tú: firma del receiver en su lugar, nombre impreso y fecha.') + '</div>' +
        '<button type="button" onclick="ypodClose()" style="width:100%;margin-top:14px;padding:13px;border:none;border-radius:12px;background:#1E3A8A;color:#fff;font-weight:800;">OK</button></div>');
      return;
    }
    ai.at = new Date().toISOString();
    ai.by = (user() && user().username) || '';
    var loc = lastLoc(); if (loc) ai.loc = loc;
    var t = await saveAi(tripId, ai) || t0;
    if (driver) showResult(ai);
    notifyOwner(t, ai);
    try { if (typeof renderMiViaje === 'function') renderMiViaje(); } catch(e){}
  }
  window.podAiRunCheck = runCheck;

  // ---------- engancharse a la app sin cambiar su código ----------
  function hook(){
    // 1) subir POD → revisar con IA (la foto se sube a Drive igual que siempre)
    if (typeof window.proceedWithDocUpload === 'function' && !window.proceedWithDocUpload.__ypod) {
      var orig = window.proceedWithDocUpload;
      window.proceedWithDocUpload = function(kind, file, tripId){
        if (kind === 'pod' && file) { try { runCheck(tripId, file); } catch(e){} }
        return orig.apply(this, arguments);
      };
      window.proceedWithDocUpload.__ypod = true;
    }
    // 2) no dejar finalizar con POD rechazado (el admin sí puede)
    if (typeof window.tripFinishMissing === 'function' && !window.tripFinishMissing.__ypod) {
      var origMiss = window.tripFinishMissing;
      window.tripFinishMissing = function(t){
        var m = origMiss.apply(this, arguments) || [];
        if (isDriver() && podBad(t)) m.push(en() ? 'A new POD: the last one was rejected (' + ((t.podAi.problems_en || [])[0] || 'receiver signature') + ')' : 'Un POD nuevo: el último fue rechazado');
        return m;
      };
      window.tripFinishMissing.__ypod = true;
    }
    // 3) "Ya salí" del delivery sin POD bien → aviso
    if (typeof window.mvCheck === 'function' && !window.mvCheck.__ypod) {
      var origCheck = window.mvCheck;
      window.mvCheck = function(stop, io){
        if (stop === 'del' && io === 'Out' && isDriver()) {
          var id = (document.getElementById('mv-trip-id') || {}).value;
          var t = trips().find(function(x){ return String(x.id) === String(id); });
          if (t && !podOk(t)) {
            var why = !t.podAi ? (en() ? 'You have not uploaded a POD that passed the check.' : 'No has subido un POD revisado.') : (t.podAi.problems_en || []).join('; ');
            if (!confirm((en() ? '🛑 STOP — your POD is not OK.\n\n' : '🛑 ALTO — el POD no está bien.\n\n') + why + (en() ? '\n\nFix it with the receiver BEFORE you leave. Leave anyway?' : '\n\nArréglalo ANTES de salir. ¿Salir de todos modos?'))) return;
            notifyOwner(t, t.podAi || { verdict: 'reject', resumen_es: 'Sin POD revisado' }, '🚚 El driver marcó "Ya salí" sin POD correcto.');
          }
        }
        return origCheck.apply(this, arguments);
      };
      window.mvCheck.__ypod = true;
    }
    // 4) mostrar el resultado de la IA junto a la foto del POD (driver y admin)
    if (typeof window.renderMiViaje === 'function' && !window.renderMiViaje.__ypod) {
      var origR = window.renderMiViaje;
      window.renderMiViaje = function(){
        var r = origR.apply(this, arguments);
        try {
          var id = (document.getElementById('mv-trip-id') || {}).value;
          var t = trips().find(function(x){ return String(x.id) === String(id); });
          badgeInto('mv-pod-preview', t, true);
        } catch(e){}
        return r;
      };
      window.renderMiViaje.__ypod = true;
    }
    if (typeof window.openTripDetail === 'function' && !window.openTripDetail.__ypod) {
      var origO = window.openTripDetail;
      window.openTripDetail = function(tripId){
        var r = origO.apply(this, arguments);
        try { var t = trips().find(function(x){ return String(x.id) === String(tripId); }); badgeInto('at-pod-preview', t, false); } catch(e){}
        return r;
      };
      window.openTripDetail.__ypod = true;
    }
  }

  function badgeInto(elId, t, forDriver){
    var el = document.getElementById(elId); if (!el || !t || !t.podAi) return;
    var old = el.querySelector('.ypod-badge'); if (old) old.remove();
    var ai = t.podAi, E = forDriver || en();
    var col = ai.verdict === 'ok' ? '#15803D' : ai.verdict === 'reject' ? '#B91C1C' : '#B45309';
    var txt = ai.verdict === 'ok' ? (E ? '🤖 AI check: POD OK' : '🤖 IA: POD correcto')
      : ai.verdict === 'reject' ? (E ? '🤖 AI check: REJECTED — ' : '🤖 IA: RECHAZADO — ') + esc((E ? (ai.problems_en || [])[0] : ai.resumen_es) || '')
      : (E ? '🤖 AI check: office will review' : '🤖 IA: revisar — ') + (E ? '' : esc(ai.resumen_es || ''));
    if (t.podApproved && ai.verdict !== 'ok') txt += E ? ' (approved by office)' : ' (aprobado por ti)';
    var d = document.createElement('div'); d.className = 'ypod-badge'; d.setAttribute('data-no-tr', '1');
    d.style.cssText = 'font-size:11px;font-weight:800;margin-top:3px;color:' + col + ';cursor:pointer;';
    d.textContent = txt.replace(/&amp;/g, '&');
    d.onclick = function(ev){ ev.stopPropagation(); sheet(verdictHtml(ai, forDriver) + '<button type="button" onclick="ypodClose()" style="width:100%;margin-top:14px;padding:13px;border:none;border-radius:12px;background:#1E3A8A;color:#fff;font-weight:800;">OK</button>'); };
    el.appendChild(d);
  }

  // ---------- alarma: el driver se aleja del receiver sin POD bien ----------
  function km(a, b){ var R = 6371, dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lon - a.lon) * Math.PI / 180;
    var x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.sqrt(x)); }
  function geoTick(){
    if (!isDriver()) return;
    var u = user(); var here = lastLoc(); if (!here) return;
    var mine = trips().filter(function(t){ return (t.driverUser === u.username || (!t.driverUser && t.driverName === u.name)) && t.tripStatus === 'active'; });
    mine.forEach(function(t){
      if (podOk(t)) return;
      var ev = t.events || {};
      // dónde estaba el receiver: donde tocó "Llegué" al delivery, o donde subió el POD
      var anchor = ev.delInLoc || (t.podAi && t.podAi.loc) || null;
      if (!anchor) return;
      if (km(anchor, here) < LEAVE_KM) return;
      var key = 'ypod_alarm_' + t.id, last = +(localStorage.getItem(key) || 0);
      if (Date.now() - last < 20 * 60000) return;   // máximo una alarma cada 20 min por viaje
      localStorage.setItem(key, String(Date.now()));
      try { if (navigator.vibrate) navigator.vibrate([600, 200, 600, 200, 900]); } catch(e){}
      var why = t.podAi ? ((t.podAi.problems_en || []).join(' · ') || 'POD not OK') : 'No POD uploaded';
      sheet('<div style="text-align:center;"><div style="font-size:48px;">🚨</div><div style="font-size:20px;font-weight:900;color:#B91C1C;">' + (en() ? 'You left the receiver without a good POD' : 'Saliste sin un POD correcto') + '</div>' +
        '<div style="font-size:14px;margin-top:10px;line-height:1.45;">' + esc(why) + '</div>' +
        '<div style="font-size:15px;margin-top:10px;font-weight:700;">' + (en() ? 'If you can, go back now and get it signed correctly. Call the office.' : 'Si puedes, regresa y que lo firmen bien. Llama a la oficina.') + '</div>' +
        '<button type="button" onclick="ypodRetake()" style="width:100%;margin-top:16px;padding:14px;border:none;border-radius:12px;background:#1E3A8A;color:#fff;font-weight:800;font-size:16px;">📷 ' + (en() ? 'Upload a new POD' : 'Subir otro POD') + '</button>' +
        '<button type="button" onclick="ypodClose()" style="width:100%;margin-top:10px;padding:13px;border:1px solid var(--border,#ddd);border-radius:12px;background:transparent;color:inherit;font-weight:700;">' + (en() ? 'Close' : 'Cerrar') + '</button></div>');
      notifyOwner(t, t.podAi || { verdict: 'reject', resumen_es: 'No subió POD' }, '🚨 El driver se alejó del receiver (' + km(anchor, here).toFixed(1) + ' km) sin POD correcto. Llámalo.');
    });
  }

  function start(){
    hook();
    setInterval(function(){ try { hook(); geoTick(); } catch(e){} }, CHECK_MS);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
