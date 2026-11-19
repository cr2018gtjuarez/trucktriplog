// YENAVI — visor de imágenes dentro de la app (con botón para regresar).
// Antes, al tocar una foto se abría una ventana nueva sin botón de regreso (en la app instalada no hay barra del navegador).
// Ahora todas las fotos se abren en esta pantalla negra con "✕ Cerrar"; también se cierra tocando el fondo o con el gesto/botón de atrás.
(function () {
  if (window.verImagen) return;
  var ES = !/driver\.html/i.test(location.pathname); // admin en español, driver en inglés
  var L = function (es, en) { return ES ? es : en; };

  var css = document.createElement('style');
  css.textContent =
    '#yv-visor{position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.96);display:none;flex-direction:column}' +
    '#yv-visor.on{display:flex}' +
    '#yv-visor .yv-top{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top,0px) + 10px) 12px 10px}' +
    '#yv-visor .yv-b{border:none;border-radius:12px;padding:11px 18px;font-size:16px;font-weight:800;background:#fff;color:#000;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
    '#yv-visor .yv-d{background:#1E3A8A;color:#fff;font-size:14px;padding:10px 14px}' +
    '#yv-visor .yv-c{flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;padding:8px;touch-action:pinch-zoom pan-x pan-y}' +
    '#yv-visor img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px}' +
    '#yv-visor .yv-m{color:#fff;opacity:.8;font-size:14px}';
  document.head.appendChild(css);

  var v, img, drv, msg, pushed = false;
  function build() {
    if (v) return;
    v = document.createElement('div'); v.id = 'yv-visor';
    v.innerHTML = '<div class="yv-top"><button type="button" class="yv-b yv-x">✕ ' + L('Cerrar', 'Close') + '</button>' +
      '<a class="yv-b yv-d" target="_blank" rel="noopener" style="display:none">☁️ ' + L('Abrir en Drive', 'Open in Drive') + '</a></div>' +
      '<div class="yv-c"><div class="yv-m"></div><img alt=""/></div>';
    document.body.appendChild(v);
    img = v.querySelector('img'); drv = v.querySelector('.yv-d'); msg = v.querySelector('.yv-m');
    v.querySelector('.yv-x').onclick = function () { cerrar(); };
    v.querySelector('.yv-c').onclick = function (e) { if (e.target !== img) cerrar(); };
    img.onload = function () { msg.style.display = 'none'; img.style.display = ''; };
    img.onerror = function () { msg.textContent = L('No se pudo cargar la foto. Usa "Abrir en Drive".', 'Could not load the photo. Use "Open in Drive".'); msg.style.display = ''; img.style.display = 'none'; };
  }
  function cerrar(fromBack) {
    if (!v || !v.classList.contains('on')) return;
    v.classList.remove('on'); img.removeAttribute('src');
    if (pushed && !fromBack) { pushed = false; try { history.back(); } catch (e) {} }
    pushed = false;
  }
  window.addEventListener('popstate', function () { if (v && v.classList.contains('on')) cerrar(true); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrar(); });

  function driveId(u) {
    var m = /\/d\/([A-Za-z0-9_-]{10,})/.exec(u) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(u);
    return m ? m[1] : null;
  }
  function esDrive(u) { return /^https:\/\/(drive|docs)\.google\.com\//.test(u) || /googleusercontent\.com\//.test(u); }

  // src: la foto (data:, URL). link: enlace opcional de Drive para el botón "Abrir en Drive".
  window.verImagen = function (src, link) {
    if (!src) return;
    build();
    var id = esDrive(src) ? driveId(src) : null;
    if (id) { if (!link && !/thumbnail/.test(src)) link = src; src = 'https://drive.google.com/thumbnail?id=' + id + '&sz=w2000'; }
    if (link) { drv.href = link; drv.style.display = ''; } else drv.style.display = 'none';
    msg.textContent = L('Cargando…', 'Loading…'); msg.style.display = ''; img.style.display = 'none';
    img.src = src;
    v.classList.add('on');
    if (!pushed) { try { history.pushState({ yvVisor: 1 }, ''); pushed = true; } catch (e) {} }
  };
  window.openLightbox = function (src) { window.verImagen(src); };
  window.closeLightbox = function () { cerrar(); var lb = document.getElementById('lightbox'); if (lb) lb.classList.remove('open'); };

  // Las fotos que antes llamaban window.open(foto) ahora se ven en el visor.
  var WO = window.open;
  window.open = function (url) {
    var u = typeof url === 'string' ? url : '';
    if (/^data:image\//.test(u) || (esDrive(u) && (driveId(u) || /thumbnail/.test(u)))) { window.verImagen(u); return null; }
    return WO.apply(window, arguments);
  };

  // Enlaces "foto" / "Ver recibo" de Drive también abren en el visor (el visor tiene "Abrir en Drive").
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var h = a.getAttribute('href') || '', t = (a.textContent || '').toLowerCase();
    if (esDrive(h) && driveId(h) && /foto|photo|recibo|receipt|ver en drive|en drive ✓/.test(t)) {
      e.preventDefault(); window.verImagen(h, h);
    }
  }, true);
})();
