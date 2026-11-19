// YENAVI Truck Trip Log — Solicitud de empleo del driver (49 CFR 391.21) llenada y firmada en la app.
// driver.html: aviso en Home + formulario (inglés con ayuda en español) + firma con el dedo.
// index.html (admin): ver la solicitud, imprimirla y poner la fecha de firma; al guardar la fecha queda en Documentos → Solicitud de empleo.
// Se guarda en Firestore: applications/<username>.
(function(){
  'use strict';
  if (window.__ysol) return; window.__ysol = true;

  var IS_DRIVER_PAGE = /driver\.html/i.test(location.pathname);
  function $(id){ return document.getElementById(id); }
  function user(){ try { return (typeof currentUser !== 'undefined') ? currentUser : null; } catch(e){ return null; } }
  function fb(){ try { return (typeof fbReady !== 'undefined' && fbReady && typeof db !== 'undefined' && db) ? db : null; } catch(e){ return null; } }
  function esc(x){ return String(x == null ? '' : x).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function users(){ try { return getUsers() || []; } catch(e){ return []; } }
  function nameOf(u){ var x = users().find(function(z){ return z.username === u; }) || {}; return x.firstName && x.lastName ? x.firstName + ' ' + x.lastName : (x.name || u); }

  function isApproved(A){ return !!(A && (A.approved || A.dateSigned)); }
  async function getApp(u){ var d = fb(); if (!d) return null; try { var s = await d.collection('applications').doc(u).get(); return s.exists ? s.data() : null; } catch(e){ return null; } }

  // ---------- estilos ----------
  var cssDone = false;
  function css(){
    if (cssDone) return; cssDone = true;
    var s = document.createElement('style');
    s.textContent =
      '#ysol{position:fixed;inset:0;z-index:2147482000;background:#F1F5F9;overflow:auto;-webkit-overflow-scrolling:touch;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#0F172A}' +
      '#ysol .top{position:sticky;top:0;z-index:2;background:#0B3D91;color:#fff;display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top,0px)) 12px 10px}' +
      '#ysol .top b{flex:1;font-size:16px}#ysol .top button{background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:10px;padding:7px 12px;font-size:14px;cursor:pointer}' +
      '#ysol .wrap{max-width:760px;margin:0 auto;padding:12px 12px 120px}' +
      '#ysol .sec{background:#fff;border-radius:14px;padding:12px 14px;margin-bottom:12px;box-shadow:0 1px 2px rgba(0,0,0,.06)}' +
      '#ysol h3{margin:0 0 2px;font-size:15px}#ysol .es{font-size:12px;color:#64748B;margin:0 0 10px;font-style:italic}' +
      '#ysol label{display:block;font-size:12.5px;font-weight:600;margin:8px 0 3px}#ysol label i{font-weight:400;color:#64748B}' +
      '#ysol input[type=text],#ysol input[type=date],#ysol input[type=tel],#ysol input[type=email],#ysol textarea,#ysol select{width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #CBD5E1;border-radius:10px;font-size:16px;background:#fff;color:#0F172A}' +
      '#ysol .g2{display:grid;grid-template-columns:1fr 1fr;gap:0 10px}#ysol .g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 10px}' +
      '@media(max-width:520px){#ysol .g3{grid-template-columns:1fr 1fr}}' +
      '#ysol .row{border:1px dashed #CBD5E1;border-radius:12px;padding:6px 10px 10px;margin:8px 0;position:relative}' +
      '#ysol .row .rm{position:absolute;top:6px;right:8px;background:#FEE2E2;color:#B91C1C;border:none;border-radius:8px;padding:3px 8px;font-size:12px;cursor:pointer}' +
      '#ysol .add{background:#E0E7FF;color:#1E3A8A;border:none;border-radius:10px;padding:8px 12px;font-size:13.5px;font-weight:700;cursor:pointer;margin-top:4px}' +
      '#ysol .yn{display:flex;gap:8px;margin-top:4px}#ysol .yn label{margin:0;display:flex;align-items:center;gap:6px;font-weight:600;background:#F8FAFC;border:1.5px solid #CBD5E1;border-radius:10px;padding:8px 14px;cursor:pointer}' +
      '#ysol .chk{display:flex;gap:8px;align-items:flex-start;font-size:13px;margin:8px 0}#ysol .chk input{width:20px;height:20px;flex:none;margin-top:1px}' +
      '#ysol canvas{width:100%;height:170px;border:2px solid #94A3B8;border-radius:12px;background:#fff;touch-action:none;display:block}' +
      '#ysol .send{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #E2E8F0;padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));display:flex;gap:10px;justify-content:center;z-index:3}' +
      '#ysol .send button{max-width:380px;flex:1;padding:14px;border:none;border-radius:12px;background:#16A34A;color:#fff;font-size:16px;font-weight:800;cursor:pointer}' +
      '#ysol .send button.sec2{background:#E2E8F0;color:#0F172A;flex:none;padding:14px 16px}' +
      '#ysol .err{color:#B91C1C;font-size:13px;font-weight:600;margin:6px 0}#ysol .hint{font-size:12px;color:#64748B}' +
      '#ysol table{width:100%;border-collapse:collapse;font-size:12.5px;margin:4px 0}#ysol td,#ysol th{border:1px solid #CBD5E1;padding:4px 6px;text-align:left;vertical-align:top}#ysol th{background:#F1F5F9;font-size:11.5px}' +
      '#ysol .kv{font-size:13px;margin:2px 0}#ysol .kv b{display:inline-block;min-width:150px;color:#334155}' +
      '.ysol-banner{background:#FEF2F2;border:2px solid #FCA5A5;border-radius:14px;padding:12px 14px;margin-bottom:14px;color:#7F1D1D}' +
      '.ysol-banner b{display:block;font-size:15px;color:#991B1B}.ysol-banner button{margin-top:8px;background:#DC2626;color:#fff;border:none;border-radius:10px;padding:10px 14px;font-size:14.5px;font-weight:800;cursor:pointer;width:100%}' +
      '@media print{body>*:not(#ysol){display:none!important}#ysol{position:static;overflow:visible;background:#fff}#ysol .top,#ysol .send,#ysol .noprint{display:none!important}#ysol .sec{box-shadow:none;border:1px solid #CBD5E1;break-inside:avoid}}';
    document.head.appendChild(s);
  }
  function close(){ var o = $('ysol'); if (o) o.remove(); document.documentElement.style.overflow = ''; }
  function shell(title, html, footer){
    css(); close();
    var o = document.createElement('div'); o.id = 'ysol';
    o.innerHTML = '<div class="top"><b>' + esc(title) + '</b><button type="button" id="ysol-x">' + (IS_DRIVER_PAGE ? 'Close' : 'Cerrar') + '</button></div><div class="wrap">' + html + '</div>' + (footer || '');
    document.body.appendChild(o); document.documentElement.style.overflow = 'hidden';
    $('ysol-x').onclick = close; return o;
  }

  // ---------- formulario (driver) ----------
  var ROWS = {
    addr:  [['street', 'Street', 'Calle'], ['city', 'City', 'Ciudad'], ['state', 'State', 'Estado'], ['zip', 'ZIP', 'ZIP'], ['from', 'From (mm/yy)', 'Desde'], ['to', 'To (mm/yy)', 'Hasta']],
    lic:   [['state', 'State', 'Estado'], ['number', 'License #', 'Número'], ['cls', 'Class', 'Clase'], ['endorse', 'Endorsements', 'Endosos'], ['exp', 'Expiration', 'Vence']],
    exp:   [['equip', 'Equipment (box truck, tractor…)', 'Tipo de vehículo'], ['from', 'From (mm/yy)', 'Desde'], ['to', 'To (mm/yy)', 'Hasta'], ['miles', 'Approx. miles', 'Millas aprox.']],
    acc:   [['date', 'Date', 'Fecha'], ['nature', 'What happened', 'Qué pasó'], ['fatal', 'Fatalities', 'Muertos'], ['inj', 'Injuries', 'Heridos'], ['haz', 'Hazmat spill', 'Derrame peligroso']],
    conv:  [['place', 'Location', 'Lugar'], ['date', 'Date', 'Fecha'], ['charge', 'Charge', 'Infracción'], ['penalty', 'Penalty', 'Sanción']],
    emp:   [['employer', 'Employer', 'Empleador'], ['phone', 'Phone', 'Teléfono'], ['address', 'Address', 'Dirección'], ['position', 'Position', 'Puesto'], ['from', 'From (mm/yy)', 'Desde'], ['to', 'To (mm/yy)', 'Hasta'], ['reason', 'Reason for leaving', 'Motivo de salida'], ['fmcsr', 'Subject to FMCSRs? (Yes/No)', '¿Sujeto a FMCSA?'], ['dot', 'DOT drug & alcohol testing? (Yes/No)', '¿Pruebas DOT?']]
  };
  function rowHtml(kind, v, i){
    var cols = ROWS[kind]; v = v || {};
    return '<div class="row" data-k="' + kind + '"><button type="button" class="rm" data-rm="1">Remove</button><div class="' + (cols.length > 4 ? 'g3' : 'g2') + '">' +
      cols.map(function(c){ return '<div><label>' + c[1] + ' <i>' + c[2] + '</i></label><input type="text" data-f="' + c[0] + '" value="' + esc(v[c[0]]) + '"></div>'; }).join('') + '</div></div>';
  }
  function listHtml(kind, arr, addLabel){
    return '<div class="lst" data-list="' + kind + '">' + (arr && arr.length ? arr : [{}]).map(function(v, i){ return rowHtml(kind, v, i); }).join('') + '</div>' +
      '<button type="button" class="add" data-add="' + kind + '">+ ' + addLabel + '</button>';
  }
  function readList(o, kind){
    var out = [];
    o.querySelectorAll('[data-list="' + kind + '"] .row').forEach(function(r){
      var v = {}, any = false; r.querySelectorAll('input[data-f]').forEach(function(inp){ v[inp.dataset.f] = inp.value.trim(); if (v[inp.dataset.f]) any = true; });
      if (any) out.push(v);
    });
    return out;
  }
  function val(o, id){ var e = o.querySelector('#' + id); return e ? (e.type === 'checkbox' ? e.checked : e.value.trim()) : ''; }
  function radio(o, name){ var e = o.querySelector('input[name="' + name + '"]:checked'); return e ? e.value : ''; }

  // ---------- foto de la licencia (la lee la IA del asistente) ----------
  function fileToDataUrl(f){ return new Promise(function(ok, ko){ var r = new FileReader(); r.onload = function(){ ok(r.result); }; r.onerror = ko; r.readAsDataURL(f); }); }
  function shrink(dataUrl, max, q){
    return new Promise(function(ok){
      var im = new Image();
      im.onload = function(){ var k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); ok(c.toDataURL('image/jpeg', q)); };
      im.onerror = function(){ ok(dataUrl); }; im.src = dataUrl;
    });
  }
  async function vozCfg(){
    try { var c = JSON.parse(localStorage.getItem('yvoz_cfg') || 'null'); if (c && c.url) return c; } catch(e){}
    var d = fb(); if (d) { try { var sn = await d.collection('data').doc('voz').get(); if (sn.exists && sn.data().url) return { url: sn.data().url, k: sn.data().k || '' }; } catch(e){} }
    return null;
  }
  var lastLicImg = null;
  async function readLicense(f){
    var dataUrl = await fileToDataUrl(f);
    if (!/^data:image\//.test(dataUrl)) throw new Error('Use a photo (JPG/PNG). / Use una foto.');
    dataUrl = await shrink(dataUrl, 1600, 0.85); lastLicImg = dataUrl;
    var cfg = await vozCfg(); if (!cfg) throw new Error('The assistant is not set up. / El asistente no está configurado.');
    var q = 'This photo is a US driver license (front). Do NOT answer in sentences. Reply with ONLY one JSON object, no other text, with these keys (use "" if not visible, never guess): ' +
      '{"first":"first and middle name","last":"last name(s)","dob":"YYYY-MM-DD","number":"license number","state":"2-letter issuing state","cls":"class letter, e.g. A, B or C","cdl":true/false (true only if it says COMMERCIAL or CDL),' +
      '"endorse":"endorsements, empty if NONE","restrict":"restrictions, empty if NONE","exp":"YYYY-MM-DD expiration","iss":"YYYY-MM-DD issue date","street":"street address","city":"city","st":"address state 2 letters","zip":"ZIP"}. ' +
      'Names in normal capitalization (Fredy Adolfo, not FREDY ADOLFO). Read dates carefully: EXP is expiration, ISS is issue, DOB is birth date.';
    var body = JSON.stringify({ k: cfg.k, lang: 'en', role: 'driver', user: nameOf((user() || {}).username), q: q, ctx: {}, history: [], images: [{ media_type: 'image/jpeg', data: dataUrl.split(',')[1] }] });
    var r = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, redirect: 'follow' });
    var j; try { j = JSON.parse(await r.text()); } catch(e){ throw new Error('The assistant did not answer. / El asistente no contestó.'); }
    if (j.error) throw new Error(j.error);
    var t = String(j.answer || ''), a = t.indexOf('{'), z = t.lastIndexOf('}');
    if (a < 0 || z < a) throw new Error('Could not read the license. Try a clearer photo. / No se pudo leer; tome otra foto con más luz.');
    var L; try { L = JSON.parse(t.slice(a, z + 1)); } catch(e){ throw new Error('Could not read the license. / No se pudo leer la licencia.'); }
    Object.keys(L).forEach(function(k){ if (typeof L[k] === 'string') { L[k] = L[k].trim(); if (/^(none|n\/a|null)$/i.test(L[k])) L[k] = ''; } });
    return L;
  }
  function isoOk(x){ return /^\d{4}-\d{2}-\d{2}$/.test(x || '') ? x : ''; }
  function us(x){ x = isoOk(x); return x ? x.slice(5, 7) + '/' + x.slice(8, 10) + '/' + x.slice(0, 4) : ''; }
  function fillLicense(o, L){
    var n = 0;
    function put(el, v){ if (!el || !v) return; el.value = v; el.style.background = '#FEF9C3'; n++; }
    var name = [L.first, L.last].filter(Boolean).join(' ');
    put(o.querySelector('#s-name'), name);
    put(o.querySelector('#s-dob'), isoOk(L.dob));
    var addr = [L.street, L.city, [L.st, L.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    put(o.querySelector('#s-addr'), addr);
    var row = o.querySelector('[data-list="lic"] .row'); if (!row) return n;
    // si la primera licencia ya tiene otro número, la nueva va en otra fila
    var numEl = row.querySelector('[data-f="number"]');
    if (numEl && numEl.value && L.number && numEl.value.replace(/\W/g, '') !== String(L.number).replace(/\W/g, '')) {
      var lst = o.querySelector('[data-list="lic"]'); lst.insertAdjacentHTML('afterbegin', rowHtml('lic', {})); row = lst.querySelector('.row');
    }
    function f(k){ return row.querySelector('[data-f="' + k + '"]'); }
    put(f('state'), (L.state || '').toUpperCase());
    put(f('number'), L.number);
    put(f('cls'), (L.cls ? L.cls.toUpperCase() : '') + (L.cls ? (L.cdl ? ' (CDL)' : ' (non-CDL)') : ''));
    put(f('endorse'), [L.endorse, L.restrict ? 'Restr: ' + L.restrict : ''].filter(Boolean).join(' · '));
    put(f('exp'), us(L.exp));
    return n;
  }
  // la foto también queda en Documentos → Licencia de manejo, con su fecha de vencimiento
  async function saveLicensePhoto(u, L){
    var d = fb(); if (!d || !lastLicImg) return;
    var file = { name: 'Licencia ' + (L.state || '') + ' ' + (L.number || '') + (isoOk(L.exp) ? ' (vence ' + L.exp + ')' : '') + '.jpg', mime: 'image/jpeg', id: '', link: '', at: new Date().toISOString(), from: 'solicitud' };
    try { if (typeof scriptMode === 'function' && scriptMode() && typeof scriptUpload === 'function') { var j = await scriptUpload(lastLicImg, 'cdl_' + u + '_' + Date.now() + '.jpg', { folder: 'Documentos_' + u }); file.id = j.id || ''; file.link = j.webViewLink || ''; } } catch(e){}
    if (!file.id) return;   // sin servicio de fotos no se guarda nada a medias
    var ref = d.collection('docs').doc('drv_' + u), sn = await ref.get(), cur = sn.exists ? sn.data() : { items: {} }; cur.items = cur.items || {};
    var it = cur.items.cdl || {}, files = (it.files || []).concat([file]).slice(-6);
    cur.items.cdl = Object.assign({}, it, { files: files, updatedAt: file.at, by: (user() || {}).username || u }, isoOk(L.exp) ? { exp: L.exp, expRead: L.exp } : {},
      { read: { clase: L.cls || '', endosos: L.endorse || '', estado: L.state || '', at: file.at } });
    cur.username = u; await ref.set(cur);
    lastLicImg = null;
  }

  async function openForm(u){
    u = u || (user() || {}).username; if (!u) return;
    var prev = await getApp(u) || {};
    if (isApproved(prev)) {
      shell(IS_DRIVER_PAGE ? 'Employment Application' : 'Solicitud de empleo', '<div class="sec" style="text-align:center;padding:30px 14px"><div style="font-size:48px">🔒</div><h3>Application approved</h3>' +
        '<p class="es">Su solicitud ya fue autorizada' + (prev.dateSigned ? ' (' + esc(prev.dateSigned) + ')' : '') + ' y ya no se puede cambiar. Si necesita corregir algo, pídaselo al administrador.</p>' +
        '<div class="hint">It can no longer be changed. Ask the office if something needs to be corrected.</div></div>');
      return;
    }
    var draft = null; try { draft = JSON.parse(localStorage.getItem('ysol_draft_' + u) || 'null'); } catch(e){}
    var d = (draft && !prev.submittedAt) ? draft : (prev.data || {});
    if (!d.name) d.name = nameOf(u);
    var html =
      '<div class="sec"><h3>Driver Employment Application</h3><p class="es">Solicitud de empleo del conductor · YENAVI FREIGHT LLC · USDOT 6498343 · 49 CFR 391.21</p>' +
      '<div class="hint">Fill in everything that applies. It is saved on this phone while you type. / Llene todo lo que aplique; se guarda mientras escribe.</div>' +
      (prev.rejected ? '<div class="err" style="background:#FEF2F2;border:1.5px solid #FCA5A5;border-radius:10px;padding:8px 10px">❌ Returned by the office — please correct: / Rechazada, corrija esto: <b>' + esc(prev.rejectNote || '') + '</b></div>' : '') + (prev.submittedAt && !prev.rejected ? '<div class="err" style="color:#1E40AF">✓ Sent ' + esc(new Date(prev.submittedAt).toLocaleDateString()) + ' — waiting for approval. You can still correct it and send it again (sign again). / Ya la mandó y está esperando autorización: todavía la puede corregir y mandar otra vez (firme de nuevo).</div>' : '') + '</div>' +

      '<div class="sec noprint" style="background:#EFF6FF;border:2px solid #93C5FD"><h3>📷 Scan your driver license</h3><p class="es">Tome una foto de su licencia (el frente) y los datos se llenan solos. Revíselos antes de enviar.</p>' +
      '<button type="button" class="add" id="s-licscan" style="width:100%;padding:12px;font-size:15px;background:#2563EB;color:#fff">📷 Take photo of license / Foto de la licencia</button>' +
      '<input type="file" id="s-licfile" accept="image/*" style="display:none"><div id="s-licmsg" class="hint" style="margin-top:6px"></div></div>' +

      '<div class="sec"><h3>1. Your information</h3><p class="es">Sus datos</p>' +
      '<label>Full legal name <i>Nombre completo</i></label><input type="text" id="s-name" value="' + esc(d.name) + '">' +
      '<div class="g2"><div><label>Date of birth <i>Fecha de nacimiento</i></label><input type="date" id="s-dob" value="' + esc(d.dob) + '"></div>' +
      '<div><label>Social Security # <i>Seguro social</i></label><input type="text" id="s-ssn" inputmode="numeric" autocomplete="off" maxlength="11" placeholder="123-45-6789" value="' + esc(prev.data && prev.data.ssn || '') + '"></div></div><div class="g2">' +
      '<div><label>Phone <i>Teléfono</i></label><input type="tel" id="s-phone" value="' + esc(d.phone) + '"></div></div>' +
      '<label>Email <i>Correo</i></label><input type="email" id="s-email" value="' + esc(d.email) + '">' +
      '<label>Current address (street, city, state, ZIP) <i>Dirección actual</i></label><input type="text" id="s-addr" value="' + esc(d.addr) + '">' +
      '<label>How long at this address? <i>¿Cuánto tiempo vive ahí?</i></label><input type="text" id="s-addrtime" value="' + esc(d.addrTime) + '">' +
      '<div class="g2"><div><label>Emergency contact <i>Contacto de emergencia</i></label><input type="text" id="s-emerg" value="' + esc(d.emerg) + '"></div>' +
      '<div><label>Emergency phone <i>Teléfono de emergencia</i></label><input type="tel" id="s-emergph" value="' + esc(d.emergPhone) + '"></div></div></div>' +

      '<div class="sec"><h3>2. Other addresses – past 3 years</h3><p class="es">Otras direcciones donde vivió en los últimos 3 años (si no hay, déjelo vacío)</p>' + listHtml('addr', d.addresses, 'Add address / Agregar dirección') + '</div>' +

      '<div class="sec"><h3>3. Driver licenses – past 3 years</h3><p class="es">Todas las licencias de manejo de los últimos 3 años</p>' + listHtml('lic', d.licenses, 'Add license / Agregar licencia') +
      '<label>A. Have you ever been denied a license, permit or privilege to operate a motor vehicle? <i>¿Alguna vez le negaron una licencia?</i></label>' +
      '<div class="yn"><label><input type="radio" name="s-qa" value="yes"' + (d.qa === 'yes' ? ' checked' : '') + '> Yes / Sí</label><label><input type="radio" name="s-qa" value="no"' + (d.qa === 'no' ? ' checked' : '') + '> No</label></div>' +
      '<label>B. Has any license, permit or privilege ever been suspended or revoked? <i>¿Alguna vez se la suspendieron o revocaron?</i></label>' +
      '<div class="yn"><label><input type="radio" name="s-qb" value="yes"' + (d.qb === 'yes' ? ' checked' : '') + '> Yes / Sí</label><label><input type="radio" name="s-qb" value="no"' + (d.qb === 'no' ? ' checked' : '') + '> No</label></div>' +
      '<label>If yes, explain <i>Si contestó sí, explique</i></label><textarea id="s-qexp" rows="2">' + esc(d.qExplain) + '</textarea></div>' +

      '<div class="sec"><h3>4. Driving experience</h3><p class="es">Experiencia manejando</p>' + listHtml('exp', d.experience, 'Add / Agregar') + '</div>' +

      '<div class="sec"><h3>5. Accidents – past 3 years</h3><p class="es">Accidentes de los últimos 3 años</p>' +
      '<div class="chk"><input type="checkbox" id="s-noacc"' + (d.noAccidents ? ' checked' : '') + '><span>I had <b>no accidents</b> in the past 3 years / No tuve accidentes</span></div>' + listHtml('acc', d.accidents, 'Add accident / Agregar accidente') + '</div>' +

      '<div class="sec"><h3>6. Traffic convictions – past 3 years</h3><p class="es">Multas o condenas de tránsito (no de estacionamiento)</p>' +
      '<div class="chk"><input type="checkbox" id="s-noconv"' + (d.noConvictions ? ' checked' : '') + '><span>I had <b>no traffic convictions</b> in the past 3 years / No tuve multas</span></div>' + listHtml('conv', d.convictions, 'Add / Agregar') + '</div>' +

      '<div class="sec"><h3>7. Employment history</h3><p class="es">Todos sus empleos de los últimos 3 años, y donde manejó vehículo comercial en los 7 años anteriores (10 años en total). Explique los tiempos sin trabajo.</p>' +
      listHtml('emp', d.employers, 'Add employer / Agregar empleo') +
      '<label>Gaps in employment (explain) <i>Tiempos sin trabajo (explique)</i></label><textarea id="s-gaps" rows="2">' + esc(d.gaps) + '</textarea></div>' +

      '<div class="sec"><h3>8. Certification and signature</h3><p class="es">Certificación y firma</p>' +
      '<div class="hint" style="font-size:12.5px;color:#334155;line-height:1.45">This certifies that this application was completed by me, and that all entries on it and information in it are true and complete to the best of my knowledge. I authorize YENAVI FREIGHT LLC to make investigations and inquiries of my previous employers (49 CFR 391.23) and to obtain my motor vehicle record. I understand that I have the right to review, correct and rebut information provided by previous employers.<br><i>Certifico que yo llené esta solicitud y que todo es verdadero y completo. Autorizo a YENAVI FREIGHT LLC a investigar con mis empleadores anteriores y a obtener mi récord de manejo.</i></div>' +
      '<div class="chk"><input type="checkbox" id="s-cert"><span>I agree / Estoy de acuerdo</span></div>' +
      '<label>Sign with your finger <i>Firme con el dedo</i></label><canvas id="s-sig"></canvas><button type="button" class="add" id="s-clear" style="background:#F1F5F9;color:#334155">Clear signature / Borrar firma</button>' +
      '<div class="hint" style="margin-top:6px">The date signed is filled in by the administrator. / La fecha de firma la llena el administrador.</div>' +
      '<div class="err" id="s-err"></div></div>';
    var o = shell(IS_DRIVER_PAGE ? 'Employment Application' : 'Solicitud de empleo · ' + nameOf(u), html,
      '<div class="send"><button type="button" id="s-go">Submit application / Enviar</button></div>');

    // filas dinámicas
    o.addEventListener('click', function(ev){
      var a = ev.target.closest('[data-add]'); if (a) { var l = o.querySelector('[data-list="' + a.dataset.add + '"]'); l.insertAdjacentHTML('beforeend', rowHtml(a.dataset.add, {})); return; }
      var r = ev.target.closest('[data-rm]'); if (r) { var row = r.closest('.row'), lst = row.parentNode; row.remove(); if (!lst.querySelector('.row')) lst.insertAdjacentHTML('beforeend', rowHtml(lst.dataset.list, {})); saveDraft(); }
    });
    // firma
    var cv = $('s-sig'), g, drawing = false, signed = false, last = null;
    function fit(){ var r = cv.getBoundingClientRect(), k = window.devicePixelRatio || 1; cv.width = r.width * k; cv.height = r.height * k; g = cv.getContext('2d'); g.scale(k, k); g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#0B1F4D'; }
    fit();
    function pt(e){ var r = cv.getBoundingClientRect(), t = e.touches ? e.touches[0] : e; return { x: t.clientX - r.left, y: t.clientY - r.top }; }
    function down(e){ e.preventDefault(); drawing = true; last = pt(e); }
    function move(e){ if (!drawing) return; e.preventDefault(); var p = pt(e); g.beginPath(); g.moveTo(last.x, last.y); g.lineTo(p.x, p.y); g.stroke(); last = p; signed = true; }
    function up(){ drawing = false; }
    cv.addEventListener('mousedown', down); cv.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    cv.addEventListener('touchstart', down, { passive: false }); cv.addEventListener('touchmove', move, { passive: false }); cv.addEventListener('touchend', up);
    $('s-clear').onclick = function(){ g.clearRect(0, 0, cv.width, cv.height); signed = false; };

    function collect(){
      return {
        name: val(o, 's-name'), dob: val(o, 's-dob'), ssn: val(o, 's-ssn'), phone: val(o, 's-phone'), email: val(o, 's-email'), addr: val(o, 's-addr'), addrTime: val(o, 's-addrtime'),
        emerg: val(o, 's-emerg'), emergPhone: val(o, 's-emergph'), addresses: readList(o, 'addr'), licenses: readList(o, 'lic'),
        qa: radio(o, 's-qa'), qb: radio(o, 's-qb'), qExplain: val(o, 's-qexp'), experience: readList(o, 'exp'),
        noAccidents: val(o, 's-noacc'), accidents: readList(o, 'acc'), noConvictions: val(o, 's-noconv'), convictions: readList(o, 'conv'),
        employers: readList(o, 'emp'), gaps: val(o, 's-gaps')
      };
    }
    function saveDraft(){ try { var x = collect(); delete x.ssn; localStorage.setItem('ysol_draft_' + u, JSON.stringify(x)); } catch(e){} }   // el seguro social no se guarda en el teléfono
    o.addEventListener('input', saveDraft); o.addEventListener('change', saveDraft);

    $('s-ssn').addEventListener('input', function(){ var v = this.value.replace(/\D/g, '').slice(0, 9); this.value = v.length > 5 ? v.slice(0, 3) + '-' + v.slice(3, 5) + '-' + v.slice(5) : v.length > 3 ? v.slice(0, 3) + '-' + v.slice(3) : v; });
    // foto de la licencia → llena los datos solos
    $('s-licscan').onclick = function(){ var f = $('s-licfile'); f.value = ''; f.click(); };
    $('s-licfile').onchange = async function(){
      var f = this.files && this.files[0]; if (!f) return;
      var msg = $('s-licmsg'), btn = $('s-licscan');
      btn.disabled = true; btn.textContent = '⏳ Reading license… / Leyendo licencia…'; msg.style.color = '#64748B'; msg.textContent = '';
      try {
        var L = await readLicense(f);
        var n = fillLicense(o, L); saveDraft();
        msg.style.color = '#166534';
        msg.textContent = n ? '✓ ' + n + ' fields filled (yellow). Check them. / Se llenaron ' + n + ' datos (en amarillo). Revíselos.' : 'Could not read the license. Try a clearer photo. / No se pudo leer; tome la foto con más luz.';
        if (n) saveLicensePhoto(u, L).catch(function(){});
      } catch(x){ msg.style.color = '#B91C1C'; msg.textContent = '⚠️ ' + (x.message || x); }
      btn.disabled = false; btn.textContent = '📷 Take photo of license / Foto de la licencia';
    };

    $('s-go').onclick = async function(){
      var D = collect(), err = [];
      if (!D.name) err.push('Name / Nombre');
      if (!D.dob) err.push('Date of birth / Fecha de nacimiento');
      if (!/^\d{3}-\d{2}-\d{4}$/.test(D.ssn || '')) err.push('Social Security # (9 digits) / Seguro social (9 números)');
      if (!D.phone) err.push('Phone / Teléfono');
      if (!D.addr) err.push('Current address / Dirección');
      if (!D.licenses.length || !D.licenses[0].number) err.push('Driver license / Licencia');
      if (!D.qa || !D.qb) err.push('Questions A and B / Preguntas A y B');
      if (!D.noAccidents && !D.accidents.length) err.push('Accidents: check "no accidents" or add them / Accidentes');
      if (!D.noConvictions && !D.convictions.length) err.push('Convictions: check "no convictions" or add them / Multas');
      if (!D.employers.length) err.push('At least one employer / Al menos un empleo');
      if (!val(o, 's-cert')) err.push('Check "I agree" / Marque "Estoy de acuerdo"');
      if (!signed) err.push('Signature / Firma');
      var e = $('s-err');
      if (err.length) { e.innerHTML = 'Missing / Falta: ' + err.map(esc).join(' · '); e.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      var d2 = fb(); if (!d2) { e.textContent = 'No internet. Try again. / Sin internet.'; return; }
      var btn = $('s-go'); btn.disabled = true; btn.textContent = 'Sending… / Enviando…';
      var now0 = await getApp(u); if (isApproved(now0)) { btn.disabled = false; btn.textContent = 'Submit application / Enviar'; e.textContent = 'Already approved: it can no longer be changed. / Ya fue autorizada; ya no se puede cambiar.'; return; }
      // firma chica (PNG) para no llenar la base de datos
      var sc = document.createElement('canvas'), r = cv.getBoundingClientRect(); sc.width = 520; sc.height = Math.round(520 * r.height / r.width);
      sc.getContext('2d').drawImage(cv, 0, 0, sc.width, sc.height);
      var sig = sc.toDataURL('image/png');
      try {
        await d2.collection('applications').doc(u).set({ username: u, data: D, signature: sig, submittedAt: new Date().toISOString(), submittedBy: (user() || {}).username || u, dateSigned: '', reviewedBy: '', approved: false, rejected: false, rejectNote: '', prevRejectNote: (now0 && now0.rejectNote) || '' });
        try { localStorage.removeItem('ysol_draft_' + u); } catch(x){}
        shell(IS_DRIVER_PAGE ? 'Employment Application' : 'Solicitud de empleo', '<div class="sec" style="text-align:center;padding:30px 14px"><div style="font-size:48px">✅</div><h3>Application submitted</h3><p class="es">Solicitud enviada. Hasta que el administrador la autorice, la puede abrir y corregir desde el Home.</p><div class="hint">Until the office approves it, you can open and correct it from Home.</div></div>');
        paintBanner(); try { if (typeof renderTareas === 'function') { renderTareas('home-tareas'); renderTareas('aud-tareas'); } } catch(x){}
      } catch(x){ btn.disabled = false; btn.textContent = 'Submit application / Enviar'; e.textContent = 'Could not send: ' + (x.message || x); }
    };
  }

  // ---------- vista del administrador ----------
  function tbl(rows, cols){
    if (!rows || !rows.length) return '<div class="kv"><i>—</i></div>';
    return '<table><tr>' + cols.map(function(c){ return '<th>' + c[1] + '</th>'; }).join('') + '</tr>' + rows.map(function(r){ return '<tr>' + cols.map(function(c){ return '<td>' + esc(r[c[0]]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
  }
  function refreshAdmin(){ try { if (typeof renderTareas === 'function') { renderTareas('home-tareas'); renderTareas('aud-tareas'); } if (typeof renderAuditoria === 'function' && typeof _currentSidebarId !== 'undefined' && _currentSidebarId === 'auditoria') { _audDocs = null; renderAuditoria(true); } } catch(x){} }
  async function adminView(u){
    var A = await getApp(u);
    if (!A) { alert('Ese driver todavía no ha llenado la solicitud en la app.'); return; }
    var D = A.data || {}, yn = function(x){ return x === 'yes' ? 'Sí' : x === 'no' ? 'No' : '—'; };
    var html =
      '<div class="sec"><h3>Driver Employment Application · Solicitud de empleo</h3><p class="es">YENAVI FREIGHT LLC · USDOT 6498343 · MC 92117262 · 49 CFR 391.21</p>' +
      '<div class="kv"><b>Llenada en la app:</b> ' + esc(new Date(A.submittedAt).toLocaleString('es-US')) + '</div></div>' +
      '<div class="sec"><h3>1. Datos del solicitante</h3>' +
      [['Nombre', D.name], ['Fecha de nacimiento', D.dob], ['Seguro social', D.ssn ? '__SSN__' : ''], ['Teléfono', D.phone], ['Correo', D.email], ['Dirección', D.addr], ['Tiempo en la dirección', D.addrTime], ['Contacto de emergencia', (D.emerg || '') + (D.emergPhone ? ' · ' + D.emergPhone : '')]]
        .map(function(k){ return '<div class="kv"><b>' + k[0] + ':</b> ' + (k[1] === '__SSN__' ? '<span id="s-ssnv" data-v="' + esc(D.ssn) + '">***-**-' + esc(String(D.ssn).slice(-4)) + '</span> <button type="button" class="add noprint" id="s-ssnshow" style="padding:2px 8px;font-size:12px">Mostrar</button>' : esc(k[1] || '—')) + '</div>'; }).join('') + '</div>' +
      '<div class="sec"><h3>2. Direcciones de los últimos 3 años</h3>' + tbl(D.addresses, ROWS.addr) + '</div>' +
      '<div class="sec"><h3>3. Licencias de los últimos 3 años</h3>' + tbl(D.licenses, ROWS.lic) +
      '<div class="kv"><b>A. ¿Le negaron licencia?</b> ' + yn(D.qa) + '</div><div class="kv"><b>B. ¿Suspendida o revocada?</b> ' + yn(D.qb) + '</div>' + (D.qExplain ? '<div class="kv"><b>Explicación:</b> ' + esc(D.qExplain) + '</div>' : '') + '</div>' +
      '<div class="sec"><h3>4. Experiencia manejando</h3>' + tbl(D.experience, ROWS.exp) + '</div>' +
      '<div class="sec"><h3>5. Accidentes (3 años)</h3>' + (D.noAccidents ? '<div class="kv">Ninguno / None</div>' : tbl(D.accidents, ROWS.acc)) + '</div>' +
      '<div class="sec"><h3>6. Multas de tránsito (3 años)</h3>' + (D.noConvictions ? '<div class="kv">Ninguna / None</div>' : tbl(D.convictions, ROWS.conv)) + '</div>' +
      '<div class="sec"><h3>7. Empleos anteriores</h3>' + tbl(D.employers, ROWS.emp) + (D.gaps ? '<div class="kv"><b>Tiempos sin trabajo:</b> ' + esc(D.gaps) + '</div>' : '') + '</div>' +
      '<div class="sec"><h3>8. Certificación y firma</h3><div class="hint" style="color:#334155">El solicitante certificó que la información es verdadera y completa y autorizó la investigación de empleadores anteriores (49 CFR 391.23) y su récord de manejo.</div>' +
      '<div style="margin:8px 0"><img src="' + esc(A.signature) + '" alt="firma" style="max-width:320px;width:100%;border-bottom:1.5px solid #334155"></div>' +
      '<div class="kv"><b>Firma:</b> ' + esc(D.name) + '</div>' +
      '<label>Fecha de firma <i>(la llena el administrador)</i></label><input type="date" id="s-dsign" value="' + esc(A.dateSigned) + '" style="max-width:220px">' +
      (isApproved(A) ? '<div class="kv" style="margin-top:6px;color:#166534"><b>🔒 Autorizada por:</b> ' + esc(A.reviewedBy || '') + (A.reviewedAt ? ' · ' + esc(new Date(A.reviewedAt).toLocaleDateString('es-US')) : '') + ' — el driver ya no la puede cambiar.</div>'
        : A.rejected ? '<div class="kv noprint" style="margin-top:6px;color:#B91C1C"><b>❌ Rechazada</b> ' + (A.rejectedAt ? esc(new Date(A.rejectedAt).toLocaleDateString('es-US')) : '') + ': ' + esc(A.rejectNote || '') + ' — esperando que el driver la corrija.</div>'
        : '<div class="kv noprint" style="margin-top:6px;color:#1E40AF">✏️ Pendiente de autorizar: el driver todavía la puede corregir. Al autorizarla queda cerrada.</div>') + '<div class="err" id="s-err"></div></div>';
    var o = shell('Solicitud de empleo · ' + (D.name || nameOf(u)), html,
      '<div class="send"><button type="button" class="sec2" id="s-print">🖨️ Imprimir</button>' + (isApproved(A) ? '<button type="button" class="sec2" id="s-unlock">🔓 Devolver para corregir</button><button type="button" id="s-save">Guardar fecha</button>' : '<button type="button" class="sec2" id="s-unlock" style="background:#FEE2E2;color:#B91C1C">❌ Rechazar</button><button type="button" id="s-save">✅ Autorizar</button>') + '</div>');
    if ($('s-unlock')) $('s-unlock').onclick = async function(){
      var why = prompt((isApproved(A) ? 'Devolver la solicitud al driver para que la corrija.\nSe quita la autorización y sale de Documentos hasta que la vuelvas a autorizar.' : 'Rechazar la solicitud: el driver la tiene que corregir y mandar otra vez.') + '\n\n¿Qué tiene que corregir? (el driver lo va a ver)', A.rejectNote || '');
      if (why === null) return; why = String(why).trim();
      if (!why) { alert('Escribe qué tiene que corregir.'); return; }
      var d2 = fb(), e = $('s-err'); if (!d2) { e.textContent = 'Sin internet.'; return; }
      try {
        await d2.collection('applications').doc(u).set({ approved: false, dateSigned: '', reviewedBy: '', rejected: true, rejectNote: why.slice(0, 500), rejectedAt: new Date().toISOString(), rejectedBy: (user() || {}).username || 'admin' }, { merge: true });
        var ref = d2.collection('docs').doc('drv_' + u), sn = await ref.get();
        if (sn.exists) { var cur = sn.data(); cur.items = cur.items || {}; if (cur.items.d_app) { cur.items.d_app.files = (cur.items.d_app.files || []).filter(function(x){ return !x.inApp; }); await ref.set(cur); try { if (typeof _ddData !== 'undefined') _ddData[u] = cur; } catch(x){} } }
        close(); refreshAdmin(); alert('Listo: solicitud rechazada. El driver ve el motivo en su Home y la puede corregir; cuando la vuelva a mandar, te sale otra vez para autorizar.');
      } catch(x){ e.textContent = 'No se pudo: ' + (x.message || x); }
    };
    function ssnShow(on){ var e = $('s-ssnv'); if (!e) return; var v = e.dataset.v || ''; e.textContent = on ? v : '***-**-' + v.slice(-4); var b = $('s-ssnshow'); if (b) b.textContent = on ? 'Ocultar' : 'Mostrar'; }
    if ($('s-ssnshow')) $('s-ssnshow').onclick = function(){ ssnShow(this.textContent === 'Mostrar'); };
    $('s-print').onclick = function(){ ssnShow(true); window.print(); setTimeout(function(){ ssnShow(false); }, 500); };
    $('s-save').onclick = async function(){
      var f = $('s-dsign').value, e = $('s-err'); if (!f) { e.textContent = 'Escribe la fecha de firma.'; return; }
      var d2 = fb(); if (!d2) { e.textContent = 'Sin internet.'; return; }
      var me = (user() || {}).username || 'admin', now = new Date().toISOString();
      try {
        await d2.collection('applications').doc(u).set({ dateSigned: f, reviewedBy: me, reviewedAt: now, approved: true, rejected: false, rejectNote: '' }, { merge: true });
        // queda en Documentos → Solicitud de empleo (así la auditoría la cuenta)
        var ref = d2.collection('docs').doc('drv_' + u), sn = await ref.get(), cur = sn.exists ? sn.data() : { items: {} };
        cur.items = cur.items || {}; cur.username = u;
        var it = cur.items.d_app || {}, files = (it.files || []).filter(function(x){ return !x.inApp; });
        files.push({ name: 'Solicitud de empleo llenada y firmada en la app (fecha de firma ' + f + ')', mime: 'app', id: '', link: location.origin + location.pathname.replace(/driver\.html$/, 'index.html') + '#solicitud=' + encodeURIComponent(u), inApp: true, at: now });
        cur.items.d_app = Object.assign({}, it, { files: files, updatedAt: now, by: me });
        await ref.set(cur);
        try { if (typeof _ddData !== 'undefined') _ddData[u] = cur; } catch(x){}
        close(); refreshAdmin();
        alert('Listo: solicitud autorizada. El driver ya no la puede cambiar y quedó en Documentos → Solicitud de empleo.');
      } catch(x){ e.textContent = 'No se pudo guardar: ' + (x.message || x); }
    };
  }

  // ---------- aviso en el Home del driver ----------
  var bannerState = null;
  async function paintBanner(done){
    var u = user(); if (!u || u.role === 'admin' || !IS_DRIVER_PAGE) return;
    var home = $('page-home'); if (!home) return;
    var b = $('ysol-banner');
    var A = await getApp(u.username), st = !A || !A.submittedAt ? 'todo' : isApproved(A) ? 'ok' : A.rejected ? 'rej' : 'wait';
    if (st === 'ok') { if (b) b.remove(); return; }
    if (b && b.dataset.st !== st) { b.remove(); b = null; }
    if (!b && st === 'rej') {
      b = document.createElement('div'); b.id = 'ysol-banner'; b.className = 'ysol-banner'; b.dataset.st = st; b.setAttribute('data-no-tr', '1');
      b.innerHTML = '<b>❌ Employment Application returned — please correct it</b>' + esc(A.rejectNote || '') + '<br><i style="font-size:12.5px">La oficina rechazó su solicitud; corríjala y mándela otra vez.</i><button type="button">Correct and resend / Corregir y mandar</button>';
      b.querySelector('button').onclick = function(){ openForm(u.username); };
      home.insertBefore(b, home.firstChild); return;
    }
    if (!b && st === 'wait') {
      b = document.createElement('div'); b.id = 'ysol-banner'; b.className = 'ysol-banner'; b.dataset.st = st; b.setAttribute('data-no-tr', '1');
      b.style.cssText = 'background:#EFF6FF;border-color:#93C5FD;color:#1E3A8A';
      b.innerHTML = '<b style="color:#1E3A8A">📝 Employment Application sent — waiting for approval</b>You can still review and correct it until the office approves it.<br><i style="font-size:12.5px">Su solicitud está esperando autorización; todavía la puede corregir.</i><button type="button" style="background:#2563EB">Review / edit — Revisar o corregir</button>';
      b.querySelector('button').onclick = function(){ openForm(u.username); };
      home.insertBefore(b, home.firstChild); return;
    }
    if (!b) {
      b = document.createElement('div'); b.id = 'ysol-banner'; b.className = 'ysol-banner'; b.dataset.st = st; b.setAttribute('data-no-tr', '1');
      b.innerHTML = '<b>⚠️ Action required: Employment Application</b>Please fill out and sign your employment application as soon as possible. It takes about 10 minutes.<br><i style="font-size:12.5px">Llene y firme su solicitud de empleo lo más pronto posible.</i><button type="button">Fill out now / Llenar ahora</button>';
      b.querySelector('button').onclick = function(){ openForm(u.username); };
      home.insertBefore(b, home.firstChild);
    }
  }

  window.solOpenForm = openForm;
  window.solAdminView = adminView;
  window.solGetApp = getApp;

  var lastKey = null;
  function tick(){
    var u = user(); if (!u || !fb()) return;
    var key = u.username + '|' + u.role;
    if (key !== lastKey || Date.now() - (tick.at || 0) > 120000) { lastKey = key; tick.at = Date.now(); paintBanner(); }
    if (!IS_DRIVER_PAGE && u.role === 'admin' && /^#solicitud=/.test(location.hash)) { var who = decodeURIComponent(location.hash.slice(11)); history.replaceState(null, '', location.pathname + location.search); adminView(who); }
  }
  function start(){ setInterval(tick, 1500); tick(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
