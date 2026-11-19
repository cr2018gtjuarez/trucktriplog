// YENAVI Truck Trip Log — Asistente de voz con IA (botón de micrófono)
// Funciona en index.html (admin, español) y driver.html (driver, inglés).
// Lee los datos de la app y contesta. Con fotos (solo administrador) ofrece botones de Guardar:
// recibo de diésel → viaje, BOL/POD/foto de carga → viaje, RC u orden → viaje existente o formulario de Nuevo viaje lleno.
// Nada se guarda sin que el administrador toque Guardar.
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
    var d = fb(); if (d) { try { await d.collection('data').doc('voz').set({ url: cfg.url, k: cfg.k, updatedAt: new Date().toISOString() }, { merge: true }); } catch(e){} }
    return true;
  }

  // ---------- datos para la IA ----------
  function num(x){ var n = parseFloat(x); return isFinite(n) ? Math.round(n * 100) / 100 : undefined; }
  function clean(o){ var r = {}; Object.keys(o).forEach(function(k){ var v = o[k]; if (v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && isNaN(v))) r[k] = v; }); return r; }
  function place(c, s, z){ return [c, s].filter(Boolean).join(', ') + (z ? ' ' + z : ''); }
  function chicagoNow(){ return new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'long', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function daysAgoISO(n){ var d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

  // ---------- utilidades de datos ----------
  function f(x){ var n = parseFloat(x); return isFinite(n) ? n : 0; }
  function call(fn){ try { return (typeof window[fn] === 'function' ? window[fn]() : (eval('typeof ' + fn) === 'function' ? eval(fn + '()') : null)); } catch(e){ return null; } }
  var HEAVY = /img|image|photo|foto|base64|dataurl|signature|firma|thumb|blob|pdf|svg|^_|password|pass$|^pw$|pin$|token|apikey|^key$|url$|^k$|drive.*id|fileid|html/i;
  // copia liviana de cualquier registro: sin fotos, firmas, claves ni textos enormes
  function slim(o, depth){
    depth = depth || 0;
    if (o == null) return undefined;
    if (typeof o === 'number') return isFinite(o) ? Math.round(o * 100) / 100 : undefined;
    if (typeof o === 'boolean') return o;
    if (typeof o === 'string') { if (!o || /^data:|^https?:\/\//i.test(o)) return undefined; return o.length > 240 ? o.slice(0, 240) + '…' : o; }
    if (depth > 3) return undefined;
    if (Array.isArray(o)) { var arr = o.slice(0, 80).map(function(x){ return slim(x, depth + 1); }).filter(function(x){ return x !== undefined; }); return arr.length ? arr : undefined; }
    if (typeof o === 'object') { var r = {}, n = 0; Object.keys(o).forEach(function(k){ if (HEAVY.test(k)) return; var v = slim(o[k], depth + 1); if (v !== undefined && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) { r[k] = v; n++; } }); return n ? r : undefined; }
    return undefined;
  }
  function iso(d){ return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function tripDate(t){ try { if (typeof repTripDate === 'function') return repTripDate(t) || ''; } catch(e){} return t.deliveryDate || t.date || ''; }
  // semana de trabajo: sábado a viernes; la carga cuenta en la semana en que se entregó
  function weekOf(ds){ if (!ds) return ''; var p = ds.split('-').map(Number); var d = new Date(p[0], p[1] - 1, p[2]); d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); var e = new Date(d); e.setDate(e.getDate() + 6); return iso(d) + ' a ' + iso(e); }
  function allTrips(){
    var t = []; try { t = (typeof loadTrips === 'function' ? loadTrips() : []) || []; } catch(e){}
    try { if (typeof _archiveTrips !== 'undefined' && _archiveTrips && _archiveTrips.length) { var ids = {}; t.forEach(function(x){ ids[String(x.id)] = 1; }); _archiveTrips.forEach(function(x){ if (!ids[String(x.id)]) t.push(x); }); } } catch(e){}
    return t;
  }
  function fuelOf(t){ var v = f(t.totalCost); if (!v && Array.isArray(t.fuelLoads)) t.fuelLoads.forEach(function(x){ v += f(x.total || x.amount || x.cost); }); return v; }
  function galOf(t){ var v = f(t.totalGal); if (!v && Array.isArray(t.fuelLoads)) t.fuelLoads.forEach(function(x){ v += f(x.gallons || x.gal); }); return v; }
  function loadedMi(t){ try { if (typeof tripDistance === 'function') { var m = tripDistance(t).mi; if (m) return f(m); } } catch(e){} return f(t.miles); }
  function deadMi(t){ try { if (typeof tripDeadMiles === 'function') return f(tripDeadMiles(t)); } catch(e){} return f(t.deadMiles); }
  function accOf(t){ var tot = 0; (t.accessorials || []).forEach(function(a){ tot += f(a.amount); }); return tot; }
  function extrasOf(t){ if (t.extrasTotal != null) return f(t.extrasTotal); var v = 0; if (Array.isArray(t.extras)) t.extras.forEach(function(e){ v += f(e.monto || e.amount); }); else v = f(t.extras); return v; }
  function money(t){
    var load = f(t.loadVal != null ? t.loadVal : t.loadValue), fuel = fuelOf(t), drv = f(t.driver), fee = f(t.fee), fact = f(t.factoringFee), ex = extrasOf(t);
    var net = (t.net != null && t.net !== '' && isFinite(parseFloat(t.net))) ? f(t.net) : load - fee - drv - fuel - ex - fact;
    var lm = loadedMi(t), dm = deadMi(t);
    return { load: load, lineHaul: t.lineHaul != null ? f(t.lineHaul) : load - accOf(t), acc: accOf(t), fuel: fuel, gal: galOf(t), driver: drv, fee: fee, factoring: fact, extras: ex, net: net, loadedMi: lm, deadMi: dm };
  }

  function tripRow(t, forDriver){
    var m = money(t), tot = m.loadedMi + m.deadMi;
    var row = {
      id: t.id, rc: t.rc, broker: t.brokerName || t.broker, dispatcher: forDriver ? undefined : (t.broker && t.brokerName && t.broker !== t.brokerName ? t.broker : undefined),
      driver: t.driverName, driverUser: forDriver ? undefined : t.driverUser, truck: t.truck || t.truckId,
      pickup: place(t.city1, t.state1, t.z1), delivery: place(t.city2, t.state2, t.z2), deadFrom: place(t.cityStart, t.stateStart, t.zStart),
      pickupAddr: t.addr1 || t.pickupAddress, deliveryAddr: t.addr2 || t.deliveryAddress,
      pickupDate: t.date || t.pickupDate, deliveryDate: t.deliveryDate, week: weekOf(tripDate(t)),
      status: t.tripStatus, unassigned: t.unassigned || undefined, started: t.startTime, finished: t.endTime, loadType: t.loadType, partial: t.partial || undefined,
      loadedMi: num(m.loadedMi), deadMi: num(m.deadMi), totalMi: num(tot), mpg: num(t.mpg) || (m.gal ? num(tot / m.gal) : undefined),
      fuelUSD: num(m.fuel), fuelGal: num(m.gal),
      fuelStops: Array.isArray(t.fuelLoads) && t.fuelLoads.length ? t.fuelLoads.map(function(x){ return clean({ date: x.date || x.fecha, gal: num(x.gallons || x.gal), usd: num(x.total || x.amount || x.cost), ppg: num(x.price || x.ppg), place: x.place || x.location || x.station || x.city }); }) : undefined,
      driverPay: num(m.driver), driverPayPct: num(t.payPct), driverPaid: t.driverPayStatus, accDriver: num(t.accDriver),
      bolPod: forDriver ? undefined : clean({ bol: t.bolStatus || (t.bol ? 'uploaded' : undefined), pod: t.podStatus || (t.pod ? 'uploaded' : undefined) })
    };
    if (!forDriver) {
      row.loadValue = num(m.load); row.lineHaul = num(m.lineHaul);
      row.accessorials = Array.isArray(t.accessorials) && t.accessorials.length ? t.accessorials.map(function(a){ return clean({ type: a.type || a.label || a.name, usd: num(a.amount), driverPct: num(a.pct) }); }) : undefined;
      row.ratePerTotalMi = tot ? num(m.load / tot) : undefined; row.ratePerLoadedMi = m.loadedMi ? num(m.load / m.loadedMi) : undefined;
      row.brokerPaid = t.payStatus; row.paidDate = t.paidDate || t.payDate;
      row.dispatchFee = num(m.fee); row.dispatchFeePct = num(t.brokerFeePct); row.factoringFee = num(m.factoring); row.factoringPct = num(t.factoringFeePct);
      row.tripExpenses = Array.isArray(t.extras) && t.extras.length ? t.extras.map(function(e){ return clean({ what: e.tipo || e.type || e.desc || e.label, usd: num(e.monto || e.amount) }); }) : (m.extras ? num(m.extras) : undefined);
      row.netProfit = num(m.net); row.notes = t.payNotes;
    } else if (tot && m.load) row.ratePerMi = num(m.load / tot);
    if (row.bolPod && !Object.keys(row.bolPod).length) delete row.bolPod;
    return clean(row);
  }

  // totales ya calculados para que la IA no tenga que sumar
  function addTo(map, key, t, forDriver){
    if (!key) return; var m = money(t), a = map[key] = map[key] || { loads: 0, loadValue: 0, lineHaul: 0, accessorials: 0, loadedMi: 0, deadMi: 0, fuelUSD: 0, fuelGal: 0, driverPay: 0, dispatchFee: 0, factoring: 0, tripExpenses: 0, netProfit: 0 };
    a.loads++; a.loadValue += m.load; a.lineHaul += m.lineHaul; a.accessorials += m.acc; a.loadedMi += m.loadedMi; a.deadMi += m.deadMi; a.fuelUSD += m.fuel; a.fuelGal += m.gal; a.driverPay += m.driver; a.dispatchFee += m.fee; a.factoring += m.factoring; a.tripExpenses += m.extras; a.netProfit += m.net;
  }
  function finish(map, forDriver){
    var out = {};
    Object.keys(map).sort().reverse().forEach(function(k){
      var a = map[k], tot = a.loadedMi + a.deadMi, r = {};
      Object.keys(a).forEach(function(x){ r[x] = num(a[x]); });
      r.totalMi = num(tot); if (tot && a.loadValue) r.ratePerTotalMi = num(a.loadValue / tot); if (a.loadedMi && a.loadValue) r.ratePerLoadedMi = num(a.loadValue / a.loadedMi);
      if (a.fuelGal) r.mpg = num(tot / a.fuelGal); if (tot) r.fuelPerMi = num(a.fuelUSD / tot); if (tot && !forDriver) r.netPerMi = num(a.netProfit / tot);
      if (forDriver) ['loadValue', 'lineHaul', 'accessorials', 'dispatchFee', 'factoring', 'tripExpenses', 'netProfit'].forEach(function(x){ delete r[x]; });
      out[k] = clean(r);
    });
    return out;
  }
  function summaries(trips, forDriver){
    var done = trips.filter(function(t){ return t.tripStatus === 'completed'; });
    var wk = {}, mo = {}, yr = {}, drv = {}, trk = {}, brk = {}, drvYr = {}, trkYr = {}, brkYr = {}, thisYear = String(new Date().getFullYear());
    done.forEach(function(t){
      var d = tripDate(t); if (!d) return; var w = weekOf(d);
      addTo(wk, w, t, forDriver); addTo(mo, d.slice(0, 7), t, forDriver); addTo(yr, d.slice(0, 4), t, forDriver);
      if (!forDriver) {
        var dn = t.driverName || t.driverUser || 'sin driver', tk = 'camión ' + (t.truck || t.truckId || '?'), bk = t.brokerName || t.broker || 'sin broker';
        addTo(drv, dn, t); addTo(trk, tk, t); addTo(brk, bk, t);
        if (d.slice(0, 4) === thisYear) { addTo(drvYr, dn, t); addTo(trkYr, tk, t); addTo(brkYr, bk, t); }
      }
    });
    var weeks = finish(wk, forDriver), keep = {}; Object.keys(weeks).slice(0, 60).forEach(function(k){ keep[k] = weeks[k]; });
    var S = { note: 'Solo viajes terminados. Semanas sábado a viernes por fecha de entrega. Millas totales = cargadas + muertas.', byWeek: keep, byMonth: finish(mo, forDriver), byYear: finish(yr, forDriver) };
    if (!forDriver) {
      S.byDriverAllTime = finish(drv); S.byTruckAllTime = finish(trk); S.byBrokerAllTime = finish(brk);
      S['byDriver' + thisYear] = finish(drvYr); S['byTruck' + thisYear] = finish(trkYr); S['byBroker' + thisYear] = finish(brkYr);
      var owed = done.filter(function(t){ return t.payStatus && t.payStatus !== 'paid'; });
      S.receivables = { count: owed.length, total: num(owed.reduce(function(s, t){ return s + money(t).load; }, 0)),
        loads: owed.map(function(t){ var d = tripDate(t); return clean({ rc: t.rc, broker: t.brokerName || t.broker, route: (t.city1 || '') + ' → ' + (t.city2 || ''), delivered: d, daysSince: d ? Math.round((Date.now() - Date.parse(d)) / 86400000) : undefined, usd: num(money(t).load), status: t.payStatus }); }) };
    }
    var unpaidDrv = done.filter(function(t){ return t.driverPayStatus && t.driverPayStatus !== 'paid'; });
    S.driverPayPending = { count: unpaidDrv.length, total: num(unpaidDrv.reduce(function(s, t){ return s + f(t.driver); }, 0)),
      byDriver: (function(){ var r = {}; unpaidDrv.forEach(function(t){ var k = t.driverName || t.driverUser || '?'; r[k] = num((r[k] || 0) + f(t.driver)); }); return r; })() };
    S.inTransit = trips.filter(function(t){ return t.tripStatus === 'active'; }).map(function(t){ return clean({ rc: t.rc, driver: t.driverName, truck: t.truck || t.truckId, route: place(t.city1, t.state1, t.z1) + ' → ' + place(t.city2, t.state2, t.z2), pickupDate: t.date, deliveryDate: t.deliveryDate, started: t.startTime }); });
    S.scheduled = trips.filter(function(t){ return t.tripStatus === 'scheduled' || t.unassigned; }).map(function(t){ return clean({ rc: t.rc, driver: t.driverName || 'sin asignar', route: place(t.city1, t.state1, t.z1) + ' → ' + place(t.city2, t.state2, t.z2), pickupDate: t.date, deliveryDate: t.deliveryDate }); });
    return S;
  }
  function byMonthSum(list, dateKeys, amtKeys, catKeys){
    var r = {};
    (list || []).forEach(function(x){ var d = ''; dateKeys.some(function(k){ if (x && x[k]) { d = String(x[k]).slice(0, 7); return true; } }); var a = 0; amtKeys.some(function(k){ if (x && x[k] != null && x[k] !== '') { a = f(x[k]); return true; } }); var c = 'otro'; catKeys.some(function(k){ if (x && x[k]) { c = String(x[k]); return true; } });
      if (!d) d = 'sin fecha'; r[d] = r[d] || { total: 0 }; r[d].total = num(r[d].total + a); r[d][c] = num((r[d][c] || 0) + a); });
    return r;
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
    var u = user(), trips = allTrips();
    var mine = IS_DRIVER ? trips.filter(function(t){ return (t.driverUser && t.driverUser === u.username) || (t.driverName && u.name && String(t.driverName).toLowerCase() === String(u.name).toLowerCase()); }) : trips;
    mine = mine.slice().sort(function(a, b){ return String(tripDate(b)).localeCompare(String(tripDate(a))); });
    var ctx = { now: chicagoNow() + ' (Central Time)', today: iso(new Date()), thisWeek: weekOf(iso(new Date())), user: { name: u.name, role: IS_DRIVER ? 'driver' : 'admin' },
      rules: 'Semana de trabajo sábado a viernes; la carga cuenta en la semana en que se entregó. Tarifa por milla = valor de la carga ÷ (millas cargadas + muertas). Ganancia neta = carga − fee dispatcher − pago driver − diésel − gastos del viaje − factoring.' };
    if (!IS_DRIVER) ctx.rules += ' Pago estándar: TQL y C.H. Robinson → driver 25% y factoring 2.99%; los demás brokers (Premium Logistics, etc.) → driver 30% y sin factoring. Sin dispatcher (fee 0%). Camiones box truck de 26 ft, máximo 8,500 lb de carga. Base: Missouri City / Houston, TX. Tarifas para negociar: $2.00, $2.25 y $2.50 por milla total.';
    else ctx.rules += ' Box truck 26 ft, max 8,500 lb.';
    ctx.summaries = summaries(mine, IS_DRIVER);
    ctx.trips = mine.map(function(t){ return tripRow(t, IS_DRIVER); });
    if (!IS_DRIVER) {
      try { ctx.drivers = getUsers().filter(function(x){ return x.role !== 'admin'; }).map(function(x){ var s2 = slim(x) || {}; return s2; }); } catch(e){}
      ctx.trucks = slim(call('loadTrucks'));
      ctx.maintenance = slim(call('loadMaintenance'));
      ctx.inspections = slim((call('loadInspections') || []).slice(-40));
      ctx.otherExpenses = slim(call('loadExtras'));
      ctx.otherExpensesByMonth = byMonthSum(call('loadExtras'), ['date', 'fecha', 'createdAt'], ['amount', 'monto', 'total'], ['category', 'categoria', 'cat', 'type', 'tipo']);
      ctx.companyExpenses = slim(call('loadCompanyExpenses'));
      ctx.companyExpensesByMonth = byMonthSum(call('loadCompanyExpenses'), ['date', 'fecha', 'createdAt'], ['amount', 'monto', 'total'], ['category', 'categoria', 'cat', 'type', 'tipo']);
      ctx.maintenanceByMonth = byMonthSum(call('loadMaintenance'), ['date', 'fecha'], ['cost', 'costo', 'amount', 'monto', 'total'], ['type', 'tipo', 'service', 'servicio']);
      ctx.fixedWeeklyCosts = slim(call('loadSemanaGastos'));
      ctx.weeklyBalanceHistory = slim(call('loadSemanaHistorial'));
      ctx.driverAdjustments = slim(call('loadAdj'));
      ctx.scheduledLoads = slim(call('loadScheduled'));
      ctx.company = slim(call('loadCompany'));
      try { var cm = await loadCards(); if (Object.keys(cm).length) ctx.fuelCards = cm; } catch(e){}
    } else {
      try { ctx.myAdjustments = slim((call('loadAdj') || []).filter(function(a){ return a && (a.driverUser === u.username || a.driver === u.username || (a.driverName && u.name && String(a.driverName).toLowerCase() === String(u.name).toLowerCase())); })); } catch(e){}
      try { ctx.myTruck = slim((call('loadTrucks') || []).filter(function(t){ return String(t.id) === String(u.truckId); })); } catch(e){}
    }
    // si es demasiado grande, los viajes viejos se quedan solo con lo esencial (los totales ya los cubren)
    var LIMIT = 450000, size = JSON.stringify(ctx).length;
    if (size > LIMIT) {
      var cut = iso(new Date(Date.now() - 365 * 86400000));
      ctx.trips = ctx.trips.map(function(r){ if ((r.deliveryDate || r.pickupDate || '') >= cut) return r; return clean({ rc: r.rc, broker: r.broker, driver: r.driver, truck: r.truck, pickup: r.pickup, delivery: r.delivery, deliveryDate: r.deliveryDate, totalMi: r.totalMi, loadValue: r.loadValue, driverPay: r.driverPay, fuelUSD: r.fuelUSD, netProfit: r.netProfit, brokerPaid: r.brokerPaid, driverPaid: r.driverPaid }); });
      size = JSON.stringify(ctx).length;
      if (size > LIMIT) { ctx.trips = ctx.trips.slice(0, 400); ctx.note = 'Solo se mandaron los 400 viajes más recientes; para lo anterior usa summaries.'; }
    }
    ctx.liveLocations = await locations(u);
    return ctx;
  }

  // ---------- llamada a la IA ----------
  async function ask(q, opt){
    if (busy) return; q = (q || '').trim(); opt = opt || {};
    var imgs = opt.images || [];
    if (!q && !imgs.length) return;
    if (!q) q = T('Analiza esta captura.', 'Check this screenshot.');
    await loadCfg();
    if (!cfg || !cfg.url) { var ok = await setupCfg(); if (!ok) return; }
    busy = true; show(); addMsg('me', q, opt); var thinking = typing(true);
    try {
      var ctx = await buildContext();
      var body = JSON.stringify({ k: cfg.k, lang: IS_DRIVER ? 'en' : 'es', role: IS_DRIVER ? 'driver' : 'admin', user: (user() || {}).name, q: q, ctx: ctx, history: history.slice(-8), images: imgs.map(function(x){ return { media_type: x.type, data: x.data }; }) });
      var r = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, redirect: 'follow' });
      var txt = await r.text(); var j; try { j = JSON.parse(txt); } catch(e){ throw new Error(T('El asistente no contestó bien. Revisa la URL del Apps Script.', 'The assistant did not answer correctly.')); }
      if (j.error) { if (/clave|key/i.test(j.error) && !IS_DRIVER) { localStorage.removeItem('yvoz_cfg'); cfg = null; } throw new Error(j.error); }
      var a = String(j.answer || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,4}\s+/gm, '').trim() || T('No tengo respuesta.', 'No answer.');
      typing(false); addMsg('ai', a);
      if (!IS_DRIVER && imgs.length && Array.isArray(j.docs) && j.docs.length) { try { docCards(j.docs, imgs); } catch(e){ console.warn('voz docs', e); } } history.push({ role: 'user', content: (imgs.length ? '[' + imgs.length + T(' captura(s)] ', ' screenshot(s)] ') : '') + q }, { role: 'assistant', content: a }); history = history.slice(-12);
      speak(imgs.length ? a.split(/\n/)[0] : a);
    } catch(e){ typing(false); addMsg('ai', '⚠️ ' + (e && e.message ? e.message : e), { err: true }); }
    busy = false;
  }

  // ---------- guardar lo que se lee en las fotos (solo administrador) ----------
  // Tarjetas de diésel → driver. Se aprenden solas: al guardar un recibo en el viaje de un driver, su tarjeta queda ligada a él.
  var cards = null;
  async function loadCards(){
    if (cards) return cards; cards = {};
    var d = fb(); if (d) { try { var sn = await d.collection('data').doc('voz').get(); if (sn.exists && sn.data().cards) cards = sn.data().cards; } catch(e){} }
    return cards;
  }
  async function learnCard(last4, t){
    last4 = String(last4 || '').replace(/\D/g, '').slice(-4); if (last4.length !== 4 || !t || !(t.driverUser || t.driverName)) return;
    await loadCards(); var cur = cards[last4];
    if (cur && cur.driverUser === t.driverUser && cur.driverName === t.driverName) return;
    cards[last4] = { driverUser: t.driverUser || null, driverName: t.driverName || null, at: new Date().toISOString() };
    var d = fb(); if (d) { try { var o = {}; o['cards.' + last4] = cards[last4]; await d.collection('data').doc('voz').update(o); } catch(e){ try { await d.collection('data').doc('voz').set({ cards: cards }, { merge: true }); } catch(_){} } }
  }
  function trips0(){ try { return (typeof loadTrips === 'function' ? loadTrips() : []) || []; } catch(e){ return []; } }
  function money2(v){ return '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function esc(x){ return String(x == null ? '' : x).replace(/[&<>"]/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function tLabel(t){ return (t.driverName || T('Sin driver', 'No driver')) + ' · ' + (t.city1 || t.z1 || '—') + ' → ' + (t.city2 || t.z2 || '—') + (t.rc ? ' · RC ' + t.rc : '') + (t.tripStatus === 'active' ? ' · 🚚' : t.tripStatus === 'scheduled' ? ' · ⏳' : ''); }
  function sameDriver(t, name){ if (!name) return false; var n = String(name).toLowerCase().trim(), a = String(t.driverName || '').toLowerCase(), u = String(t.driverUser || '').toLowerCase(); var f = n.split(/\s+/)[0]; return !!a && (a === n || a.split(/\s+/)[0] === f || u === f); }
  function tStart(t){ return String(t.date || t.pickupDate || (t.startTime || '').slice(0, 10) || ''); }
  function tEnd(t){ return String(t.deliveryDate || (t.endTime || '').slice(0, 10) || ''); }
  // viajes para escoger: en tránsito y programados primero, luego los terminados de los últimos 45 días
  function candidates(){
    var cut = iso(new Date(Date.now() - 45 * 86400000));
    return trips0().filter(function(t){ return t && (t.tripStatus === 'active' || t.tripStatus === 'scheduled' || tStart(t) >= cut || tEnd(t) >= cut); })
      .sort(function(a, b){ var r = function(t){ return t.tripStatus === 'active' ? 0 : t.tripStatus === 'scheduled' ? 1 : 2; }; return r(a) - r(b) || tStart(b).localeCompare(tStart(a)); });
  }
  function byId(id){ if (id == null || id === '') return null; return trips0().find(function(t){ return String(t.id) === String(id); }) || null; }
  function guessTrip(d){
    var list = candidates(), t = byId(d.tripId); if (t) return t;
    if (d.rc) { t = trips0().find(function(x){ return x.rc && String(x.rc).replace(/\D/g, '') === String(d.rc).replace(/\D/g, ''); }); if (t) return t; }
    var drv = d.driver || d.nombre || d.firmaDriver;
    if (d.tipo === 'diesel') {
      var c = cards && d.tarjeta ? cards[String(d.tarjeta).replace(/\D/g, '').slice(-4)] : null;
      var mine = list.filter(function(x){ return (c && ((c.driverUser && x.driverUser === c.driverUser) || (c.driverName && x.driverName === c.driverName))) || sameDriver(x, drv); });
      var dt = d.fecha || '';
      return mine.find(function(x){ var a = tStart(x), b = tEnd(x) || iso(new Date()); return dt && a && a <= dt && dt <= b; }) || mine.find(function(x){ return x.tripStatus === 'active'; }) || null;
    }
    var z1 = d.shipper && d.shipper.zip, z2 = (d.consignee && d.consignee.zip) || (d.entrega && d.entrega.zip);
    z1 = z1 || (d.pickup && d.pickup.zip);
    return list.find(function(x){ return z2 && String(x.z2) === String(z2).slice(0, 5) && (!z1 || String(x.z1) === String(z1).slice(0, 5)); })
      || list.find(function(x){ return z2 && String(x.z2) === String(z2).slice(0, 5); })
      || (drv ? list.find(function(x){ return x.tripStatus === 'active' && sameDriver(x, drv); }) : null) || null;
  }
  // el BOL casi siempre trae al broker como carrier (TQL = Total Quality Logistics): eso no es problema
  function normB(x){ x = String(x || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); if (/^tql\b|total quality/.test(x)) return 'tql'; if (/robinson|^chr\b/.test(x)) return 'chr'; if (/premium/.test(x)) return 'premium'; if (/^echo\b/.test(x)) return 'echo'; return x.split(' ')[0]; }
  function sameBroker(c, t){ if (!t) return false; var a = normB(c), b = normB(t.brokerName || t.broker); return !!a && !!b && a === b; }
  function fuelDup(d){
    var tot = parseFloat(d.total), out = null;
    trips0().forEach(function(t){ (t.fuelLoads || []).forEach(function(l){
      if (out) return;
      if (d.ticket && l.ticket && String(l.ticket) === String(d.ticket)) { out = t; return; }
      if (isFinite(tot) && d.fecha && (l.date || t.date) === d.fecha && Math.abs((parseFloat(l.cost) || 0) - tot) < 0.02) out = t;
    }); });
    return out;
  }
  function dataUrlOf(img){ return 'data:' + (img.type || 'image/jpeg') + ';base64,' + img.data; }
  // sube la foto a la carpeta del viaje en Drive con la fila de subidas de la app (si falla la señal, queda pendiente y no se pierde)
  async function attach(tripId, kind, dataUrl, extra){
    var trip = byId(tripId); if (!trip) throw new Error(T('No encontré el viaje.', 'Trip not found.'));
    var item = Object.assign({ tripId: trip.id, kind: kind, dataUrl: dataUrl }, extra || {});
    item.qid = upqAdd(item);
    try { var res = await uploadPhotoToDrive(trip, kind, dataUrl); await applyUpload(item, res); upqRemove(item.qid); return 'drive'; }
    catch(e){ console.warn('voz attach', e); try { await markPending(item); } catch(_){} return 'pending'; }
  }
  // agrega el recibo a las cargas de diésel del viaje (igual que "Agregar diésel" de En Tránsito)
  function chain(fn){ var p = (window._tripWriteChain || Promise.resolve()).then(fn); window._tripWriteChain = p.catch(function(){}); return p; }
  async function saveFuel(tripId, d, img){
    var gal = parseFloat(d.galones) || 0, price = parseFloat(d.precio) || 0, cost = parseFloat(d.total);
    if (!isFinite(cost) || cost <= 0) cost = gal * price; cost = Math.round(cost * 100) / 100;
    if (!(cost > 0)) throw new Error(T('No se leyó el total del recibo.', 'Could not read the receipt total.'));
    if (!price && gal) price = Math.round(cost / gal * 1000) / 1000;
    var tipo = d.producto === 'def' ? 'def' : 'diesel';
    var loadId = Date.now() + '_ia';
    var station = [d.gasolinera, [d.ciudad, d.estado].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
    var newLoad = clean({ loadId: loadId, gal: Math.round(gal * 1000) / 1000, price: price, cost: cost, station: station, date: d.fecha || iso(new Date()), type: tipo, tipo: tipo,
      city: d.ciudad, state: d.estado, zip: d.zip, ticket: d.ticket ? String(d.ticket) : undefined, card: d.tarjeta ? String(d.tarjeta).replace(/\D/g, '').slice(-4) : undefined, source: 'asistente' });
    newLoad.image = null;
    var trip = await chain(async function(){
      var T0 = trips0(), i = T0.findIndex(function(t){ return String(t.id) === String(tripId); }); if (i < 0) throw new Error(T('No encontré el viaje.', 'Trip not found.'));
      var t = T0[i], L = (t.fuelLoads || []).concat([newLoad]);
      var sum = function(arr, k){ return Math.round(arr.reduce(function(a, r){ return a + (parseFloat(r[k]) || 0); }, 0) * 100) / 100; };
      var totalGal = sum(L.filter(function(l){ return l.tipo !== 'otro'; }), 'gal'), totalCost = sum(L, 'cost');
      var upd = { fuelLoads: L, totalGal: totalGal, totalCost: totalCost,
        dieselCost: sum(L.filter(function(l){ return l.tipo === 'diesel' || !l.tipo; }), 'cost'), defCost: sum(L.filter(function(l){ return l.tipo === 'def'; }), 'cost'), otrosCost: sum(L.filter(function(l){ return l.tipo === 'otro'; }), 'cost') };
      if (t.profitSet && t.loadVal) upd.net = Math.round((t.loadVal - (t.fee || 0) - (t.factoringFee || 0) - (t.driver || 0) - totalCost - (t.extrasTotal || 0)) * 100) / 100;
      T0[i] = Object.assign({}, t, upd); await storeTrips(T0);
      try { if (typeof _adminActiveTrip !== 'undefined' && _adminActiveTrip && String(_adminActiveTrip.id) === String(tripId)) _adminActiveTrip = Object.assign({}, _adminActiveTrip, upd); } catch(e){}
      return T0[i];
    });
    try { if (typeof renderLog === 'function') renderLog(); } catch(e){}
    if (newLoad.card) learnCard(newLoad.card, trip).catch(function(){});
    return attach(tripId, 'diesel', dataUrlOf(img), { loadId: loadId });
  }
  // RC u orden nueva: abre "Nuevo viaje" con los datos puestos y la foto como RC adjunto; el administrador revisa e inicia
  async function fillNewTrip(d, img){
    if (APP) { document.documentElement.classList.remove('voz-app'); var fb2 = $('yvoz-fab'); if (fb2) fb2.style.display = 'flex'; }
    var p = $('yvoz-panel'); if (p) p.style.display = 'none';
    try { sidebarNav('new'); } catch(e){}
    await new Promise(function(r){ setTimeout(r, 400); });
    try { if (typeof adminResetForm === 'function') adminResetForm(); } catch(e){}
    var pk = Object.assign({}, d.pickup || {}), en = Object.assign({}, d.entrega || {}), done = [], miss = [];
    // ZIP: el que leyó la IA, o el que venga en la dirección, o el de la ciudad
    for (var x of [pk, en]) {
      var z = String(x.zip || '').match(/\d{5}/) || String((x.direccion || '') + ' ' + (x.ciudad || '')).match(/\b\d{5}\b/);
      x.zip = z ? z[0] : null;
      if (!x.zip && x.ciudad && x.estado) { try { x.zip = await rcResolveZip(x.ciudad, x.estado); } catch(e){} }
    }
    var rate = parseFloat(d.pago); rate = isFinite(rate) && rate > 0 ? rate : null;
    var stop = function(x, tp){ return { type: tp, city: x.ciudad || null, state: x.estado || null, zip: x.zip ? String(x.zip).slice(0, 5) : null, date: x.fecha || null, addr: x.direccion || null }; };
    _startRc = { file: null, name: 'RC ' + (d.rc || '') + ' (foto)', dataUrl: dataUrlOf(img),
      parsed: { rate: rate, lineHaul: rate, extras: [], stops: [], extraStops: [], notes: d.notas ? [String(d.notas)] : [], docsEmail: null, pickup: stop(pk, 'pickup'), delivery: stop(en, 'delivery') } };
    var lbl = $('f-rcfile-label'); if (lbl) lbl.textContent = '✔ ' + _startRc.name;
    var sel = $('f-driver-select');
    if (d.driver) { var u = null; try { u = rcMatchDriver(d.driver); } catch(e){} if (u && sel) { sel.value = u.username; try { onDriverSelectChange(); } catch(e){} done.push('Driver: ' + d.driver); } else miss.push('Driver (' + d.driver + ')'); } else miss.push('Driver');
    var sv = function(id, v, name){ var ok = false; try { ok = setVal(id, v); } catch(e){} if (name) (ok ? done : miss).push(name + (ok ? ': ' + v : '')); return ok; };
    sv('f-rc-admin', d.rc, 'RC #'); sv('f-brokername-admin', d.broker, 'Broker');
    sv('f-date-admin', pk.fecha, T('Fecha pick up', 'Pick up date')); sv('f-z1-admin', pk.zip ? String(pk.zip).slice(0, 5) : '', 'ZIP pick up'); sv('f-addr1-admin', pk.direccion);
    sv('f-delivery-date-admin', en.fecha, T('Fecha entrega', 'Delivery date')); sv('f-z2-admin', en.zip ? String(en.zip).slice(0, 5) : '', 'ZIP delivery'); sv('f-addr2-admin', en.direccion);
    try { calcDeadAdmin(); } catch(e){}
    var box = $('f-rc-read');
    if (box) {
      var h = '🤖 <b>' + T('Datos leídos por el asistente', 'Data read by the assistant') + '</b><br>' + done.map(function(x){ return '✔ ' + esc(x); }).join('<br>');
      h += '<br>💵 <b>' + T('Pago', 'Pay') + ': ' + (rate ? money2(rate) : T('no venía en la foto', 'not in the photo')) + '</b>' + (rate ? ' — ' + T('se pone solo al finalizar el viaje', 'filled in when finishing the trip') : '');
      if (d.notas) h += '<br>📝 ' + esc(d.notas);
      if (miss.length) h += '<br><span style="color:#B45309;">⚠️ ' + T('Falta / revisa', 'Missing / check') + ': ' + esc(miss.join(', ')) + '</span>';
      h += '<br><span style="color:#B45309;">' + T('Recuerda: si todavía no hay BOL, guárdalo como programado o sin driver.', 'Reminder: without a BOL, save it as scheduled.') + '</span>';
      box.innerHTML = h; box.style.display = 'block';
      try { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e){}
    }
  }
  var KIND = { bol: 'BOL', pod: 'POD', carga: T('Foto de carga', 'Cargo photo'), rc: 'RC', orden: T('Orden', 'Order') };
  function docCards(docs, imgs){
    var log = $('yvoz-log'); if (!log) return;
    loadCards().catch(function(){});
    docs.forEach(function(d){
      if (!d || !d.tipo) return;
      var img = imgs[(parseInt(d.img, 10) || 1) - 1]; if (!img) return;
      var tp = String(d.tipo).toLowerCase(); if (!/^(diesel|bol|pod|carga|rc|orden)$/.test(tp)) return;
      var box = document.createElement('div'); box.className = 'm ai dc';
      var head = '', warn = [], t0 = guessTrip(d), dup = null;
      if (tp === 'diesel') {
        var g = parseFloat(d.galones), pr = parseFloat(d.precio), tot = parseFloat(d.total);
        head = '⛽ <b>' + esc(d.gasolinera || T('Recibo', 'Receipt')) + '</b> · ' + esc([d.ciudad, d.estado].filter(Boolean).join(', ')) + '<br>' + esc(d.fecha || '') + ' · ' + (isFinite(g) ? g + ' gal' : '') + (isFinite(pr) ? ' × $' + pr : '') + ' = <b>' + (isFinite(tot) ? money2(tot) : '—') + '</b>' + (d.tarjeta ? ' · ' + T('tarjeta', 'card') + ' ' + esc(d.tarjeta) : '');
        if (isFinite(g) && isFinite(pr) && isFinite(tot) && Math.abs(g * pr - tot) > 0.6) warn.push(T('Galones × precio no da el total; revisa la foto.', 'Gallons × price does not match the total.'));
        dup = fuelDup(d); if (dup) warn.push(T('Ya está guardado en: ', 'Already saved in: ') + tLabel(dup));
        if (d.enRuta === false) warn.push(T('La gasolinera no parece quedar en la ruta del viaje.', 'The station does not seem to be on the trip route.'));
        if (d.tarjeta && !(cards && cards[String(d.tarjeta).replace(/\D/g, '').slice(-4)])) warn.push(T('Tarjeta nueva: al guardarlo queda ligada al driver del viaje.', 'New card: it will be linked to the trip driver.'));
      } else if (tp === 'rc' || tp === 'orden') {
        var pk = d.pickup || {}, en = d.entrega || {};
        head = '📑 <b>' + KIND[tp] + (d.rc ? ' #' + esc(d.rc) : '') + '</b>' + (d.broker ? ' · ' + esc(d.broker) : '') + '<br>' + esc([pk.ciudad, pk.estado, pk.zip].filter(Boolean).join(' ')) + ' → ' + esc([en.ciudad, en.estado, en.zip].filter(Boolean).join(' ')) + '<br>' + (d.pago ? '<b>' + money2(d.pago) + '</b>' : T('Sin pago en la foto', 'No pay in the photo')) + (d.driver ? ' · ' + esc(d.driver) : '');
        if (t0 && d.pago) { var ap = parseFloat(t0.loadVal != null && t0.loadVal !== '' ? t0.loadVal : t0.rcRate); if (isFinite(ap) && Math.abs(ap - d.pago) > 1) warn.push(T('El pago en la app es ', 'App pay is ') + money2(ap) + T(' y aquí dice ', ' and here it says ') + money2(d.pago)); }
      } else {
        head = (tp === 'carga' ? '📦 ' : '📄 ') + '<b>' + KIND[tp] + '</b>' + (d.bol ? ' #' + esc(d.bol) : '') + (d.consignee && d.consignee.ciudad ? ' · → ' + esc(d.consignee.ciudad + (d.consignee.estado ? ', ' + d.consignee.estado : '')) : '');
        if (d.carrier && !/yenavi/i.test(d.carrier) && !sameBroker(d.carrier, t0) && !sameBroker(d.carrier, { brokerName: d.broker })) warn.push(T('El carrier del BOL es ', 'Carrier on the BOL is ') + d.carrier + T(', no YENAVI.', ', not YENAVI.'));
        if (tp === 'bol' && d.firmaRecibido) warn.push(T('Ya está firmado de recibido: tal vez es POD.', 'Signed by the receiver: it may be a POD.'));
      }
      var opts = '<option value="">' + T('— Escoge el viaje —', '— Pick the trip —') + '</option>' + candidates().slice(0, 40).map(function(t){ return '<option value="' + esc(t.id) + '"' + (t0 && String(t0.id) === String(t.id) ? ' selected' : '') + '>' + esc(tLabel(t)) + '</option>'; }).join('');
      var newOpt = (tp === 'rc' || tp === 'orden');
      box.innerHTML = '<div class="dh">' + head + '</div>' + (warn.length ? '<div class="dw">⚠️ ' + warn.map(esc).join('<br>⚠️ ') + '</div>' : '') +
        '<select class="ds">' + (newOpt ? opts.replace('<option value="">' + T('— Escoge el viaje —', '— Pick the trip —') + '</option>', '<option value="__new">' + T('➕ Viaje nuevo (llenar formulario)', '➕ New trip (fill the form)') + '</option>') : opts) + '</select>' +
        '<button type="button" class="db">' + (dup ? T('Guardar de todos modos', 'Save anyway') : T('Guardar', 'Save')) + '</button><div class="dr"></div>';
      var sel = box.querySelector('select'), btn = box.querySelector('button'), res = box.querySelector('.dr');
      if (newOpt && !t0) sel.value = '__new';
      var lblB = function(){ btn.textContent = sel.value === '__new' ? T('Abrir Nuevo viaje', 'Open New trip') : (dup ? T('Guardar de todos modos', 'Save anyway') : (tp === 'diesel' ? T('Guardar en el viaje', 'Save to trip') : T('Subir al viaje', 'Upload to trip'))); };
      sel.onchange = lblB; lblB();
      btn.onclick = async function(){
        var id = sel.value; if (!id) { res.textContent = T('Escoge el viaje primero.', 'Pick the trip first.'); return; }
        btn.disabled = true; res.textContent = '⏳ ' + T('Guardando…', 'Saving…');
        try {
          var where;
          if (id === '__new') { await fillNewTrip(d, img); res.textContent = '✔ ' + T('Formulario de Nuevo viaje listo. Revísalo e inicia.', 'New trip form ready.'); return; }
          if (tp === 'diesel') where = await saveFuel(id, d, img);
          else where = await attach(id, tp === 'carga' ? 'loaded' : tp === 'orden' ? 'rc' : tp, dataUrlOf(img), (tp === 'bol' || tp === 'pod') ? { checklist: { admin: true, signature: true, date: true, name: true } } : null);
          var t = byId(id);
          res.textContent = '✔ ' + T('Guardado en ', 'Saved to ') + (t ? tLabel(t) : '') + (where === 'pending' ? T(' · la foto queda en el celular y se sube a Drive al tocar "Subir ahora"', ' · photo saved on the phone; tap "Upload now"') : '');
          btn.textContent = '✔'; sel.disabled = true;
        } catch(e){ btn.disabled = false; res.textContent = '⚠️ ' + (e && e.message ? e.message : e); }
      };
      log.appendChild(box); log.scrollTop = log.scrollHeight;
    });
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
    clip: '<svg viewBox="0 0 24 24"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/></svg>',
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
      '#yvoz-att{width:42px;height:46px;border:none;background:none;color:var(--sub);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none}' +
      '#yvoz-att svg{width:24px;height:24px}' +
      '#yvoz-pend{display:flex;gap:8px;padding:6px 10px 0;overflow-x:auto}#yvoz-pend:empty{display:none}' +
      '#yvoz-pend .pi{position:relative;flex:none}#yvoz-pend img{width:64px;height:64px;object-fit:cover;border-radius:8px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.2)}' +
      '#yvoz-pend .pi button{position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;border:none;background:#111B21;color:#fff;font-size:13px;line-height:22px;padding:0;cursor:pointer}' +
      '#yvoz-log .shots{display:flex;flex-wrap:wrap;gap:4px;margin:-2px -5px 6px}#yvoz-log .shots img{max-width:220px;max-height:260px;border-radius:6px;display:block;cursor:pointer}' +
      '#yvoz-panel.drop{outline:3px dashed var(--yb);outline-offset:-8px}' +
      '#yvoz-log .dc{padding:8px 10px 10px;border-left:4px solid var(--yb);white-space:normal;font-size:14px;max-width:88%}' +
      '#yvoz-log .dc .dw{margin-top:6px;font-size:13px;color:#9A3412;background:#FFF7ED;border-radius:6px;padding:5px 7px}' +
      '#yvoz-log .dc .ds{width:100%;margin-top:8px;padding:8px;border:1px solid #D1D7DB;border-radius:8px;font-size:14px;background:#fff;color:var(--ink)}' +
      '#yvoz-log .dc .db{width:100%;margin-top:6px;padding:9px;border:none;border-radius:8px;background:var(--yb);color:#fff;font-weight:700;font-size:14px;cursor:pointer}' +
      '#yvoz-log .dc .db:disabled{background:#8FA6CC}#yvoz-log .dc .dr{margin-top:5px;font-size:13px;color:#1B5E20}#yvoz-log .dc .dr:empty{display:none}' +
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
      '<div id="yvoz-pend"></div><input type="file" id="yvoz-file" accept="image/*" multiple hidden>' +
      '<form id="yvoz-f"><button type="button" id="yvoz-att" aria-label="' + T('Adjuntar captura', 'Attach screenshot') + '">' + IC.clip + '</button><input id="yvoz-in" autocomplete="off" enterkeyhint="send" placeholder="' + T('Escribe o toca el micrófono', 'Type or tap the mic') + '">' +
      '<button type="button" id="yvoz-go" aria-label="' + T('Hablar', 'Talk') + '">' + IC.mic + '</button></form>';
    document.body.appendChild(p);
    $('yvoz-x').onclick = function(){ p.style.display = 'none'; try { if (listening && rec) rec.stop(); speechSynthesis.cancel(); } catch(e){} };
    $('yvoz-mute').onclick = function(){ var m = this.dataset.on === '1' ? '0' : '1'; this.dataset.on = m; this.innerHTML = m === '1' ? IC.off : IC.vol; this.setAttribute('aria-label', m === '1' ? T('Voz apagada', 'Voice off') : T('Voz encendida', 'Voice on')); if (m === '1') try { speechSynthesis.cancel(); } catch(e){} };
    if ($('yvoz-cfg')) $('yvoz-cfg').onclick = function(){ setupCfg(); };
    if ($('yvoz-out')) $('yvoz-out').onclick = function(){ try { speechSynthesis.cancel(); } catch(e){} try { if (typeof doLogout === 'function') doLogout(); } catch(e){} };
    $('yvoz-in').oninput = sendBtn;
    $('yvoz-go').onclick = function(){ var q = $('yvoz-in').value.trim(); if ((q || pending.length) && !listening) send(); else listen(); };
    $('yvoz-f').onsubmit = function(e){ e.preventDefault(); send(); };
    $('yvoz-att').onclick = function(){ $('yvoz-file').click(); };
    $('yvoz-file').onchange = function(){ addFiles(this.files); this.value = ''; };
    p.addEventListener('paste', function(e){ var fs = []; Array.prototype.forEach.call((e.clipboardData || {}).items || [], function(it){ if (it.kind === 'file' && /^image\//.test(it.type)) fs.push(it.getAsFile()); }); if (fs.length) { e.preventDefault(); addFiles(fs); } });
    p.addEventListener('dragover', function(e){ e.preventDefault(); p.classList.add('drop'); });
    p.addEventListener('dragleave', function(){ p.classList.remove('drop'); });
    p.addEventListener('drop', function(e){ e.preventDefault(); p.classList.remove('drop'); if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });
    addMsg('ai', T('Hola 👋 Pregúntame lo que quieras de la app: dónde está un driver, viajes en tránsito, ganancias de la semana, pagos pendientes, diésel o millas. Mándame una nota de voz con el micrófono o escríbeme.',
                   'Hi 👋 Ask me about your trips: your pay this week, miles, diesel or your current trip. Send me a voice note with the mic or type.'), { noReplay: true });
    addMsg('ai', T('📎 También puedes mandarme capturas de pantalla: una carga de TQL, C.H. Robinson, DAT o Premium y te digo si conviene, cuánto quedaría limpio y cuánto pedir; un recibo de diésel, un BOL o un RC y te digo de qué viaje es y qué le falta.',
                   '📎 You can also send me screenshots: a load from a load board and I tell you the rate per mile and your pay; a fuel receipt, BOL or RC and I tell you which trip it belongs to.'), { noReplay: true });
  }
  // ---------- capturas de pantalla ----------
  var pending = [];   // [{type, data(base64)}]
  function shrink(file){
    return new Promise(function(res){
      var rd = new FileReader();
      rd.onload = function(){ var im = new Image(); im.onload = function(){
        var M = 1600, w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, M / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        res({ type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] }); };
        im.onerror = function(){ res(null); }; im.src = rd.result; };
      rd.onerror = function(){ res(null); }; rd.readAsDataURL(file);
    });
  }
  async function addFiles(list){
    var fs = Array.prototype.slice.call(list || []).filter(function(f){ return f && /^image\//.test(f.type); });
    for (var i = 0; i < fs.length && pending.length < 4; i++) { var x = await shrink(fs[i]); if (x) pending.push(x); }
    if (fs.length && pending.length >= 4) setHint(T('Máximo 4 capturas por mensaje.', 'Up to 4 screenshots per message.'));
    drawPending(); sendBtn(); show(); try { $('yvoz-in').focus(); } catch(e){}
  }
  function drawPending(){
    var c = $('yvoz-pend'); if (!c) return; c.innerHTML = '';
    pending.forEach(function(x, i){ var d = document.createElement('div'); d.className = 'pi'; d.innerHTML = '<img alt="" src="data:' + x.type + ';base64,' + x.data + '"><button type="button" aria-label="' + T('Quitar', 'Remove') + '">×</button>'; d.querySelector('button').onclick = function(){ pending.splice(i, 1); drawPending(); sendBtn(); }; c.appendChild(d); });
  }
  function send(){ var q = $('yvoz-in').value; var imgs = pending.slice(); pending = []; drawPending(); $('yvoz-in').value = ''; sendBtn(); setHint(''); ask(q, { images: imgs }); }
  var chipsDone = false;
  function show(){
    var p = $('yvoz-panel'); if (!p) return; p.style.display = 'flex';
    if (!chipsDone) { chipsDone = true; var c = $('yvoz-chips'); chips().forEach(function(q){ var x = document.createElement('button'); x.type = 'button'; x.textContent = q; x.onclick = function(){ ask(q); }; c.appendChild(x); }); }
    var l = $('yvoz-log'); l.scrollTop = l.scrollHeight;
  }
  function sendBtn(){ var g = $('yvoz-go'), i = $('yvoz-in'); if (!g || !i) return; var txt = (!!i.value.trim() || pending.length > 0) && !listening; g.innerHTML = txt ? IC.send : IC.mic; g.setAttribute('aria-label', txt ? T('Enviar', 'Send') : T('Hablar', 'Talk')); }
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
    if (who === 'me' && o.images && o.images.length) { var sh = document.createElement('div'); sh.className = 'shots'; o.images.forEach(function(im){ var g = document.createElement('img'); g.src = 'data:' + im.type + ';base64,' + im.data; g.alt = ''; g.onclick = function(){ if (window.verImagen) window.verImagen(g.src); }; sh.appendChild(g); }); d.insertBefore(sh, d.firstChild); }
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
        chipsDone = false; history = []; pending = []; builtFor = key;
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
