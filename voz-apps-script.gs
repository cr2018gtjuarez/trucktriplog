// ===== Asistente YENAVI (voz, chat y capturas de pantalla) — Google Apps Script =====
// Recibe la pregunta, las capturas (si hay) y TODOS los datos de Truck Trip Log desde la app,
// se los pasa a Claude y devuelve la respuesta. Solo consulta: no crea, cambia ni borra nada.
//
// Propiedades del script (⚙️ Configuración del proyecto → Propiedades del script):
//   ANTHROPIC_KEY = tu API key de console.anthropic.com
//   VOZ_KEY       = la clave que pegas en la app (botón ⚙️ del asistente)
// Implementar → Nueva implementación → Aplicación web → Ejecutar como: Yo · Acceso: Cualquier usuario.
// Si ya estaba implementado: Implementar → Administrar implementaciones → ✏️ → Versión: Nueva versión (la URL no cambia).

const MODELO = 'claude-sonnet-5-5';          // preguntas normales (rápido)
const MODELO_CAPTURAS = 'claude-opus-5-5';   // cuando mandas capturas (el más potente para leer y analizar)

function doGet() {
  return ContentService.createTextOutput('Asistente YENAVI listo');
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const P = PropertiesService.getScriptProperties();
    const b = JSON.parse(e.postData.contents || '{}');
    if (!b.k || b.k !== P.getProperty('VOZ_KEY')) return out_({ error: 'Clave incorrecta' });
    const en = b.lang === 'en';
    const imgs = (b.images || []).filter(function (x) { return x && x.data && /^image\/(jpeg|png|gif|webp)$/.test(x.media_type || ''); }).slice(0, 4);

    // lo que cambia a cada minuto (hora y ubicaciones) va aparte, para que el resto se pueda reutilizar (caché = más barato y rápido)
    const ctx = b.ctx || {};
    const live = { now: ctx.now, today: ctx.today, thisWeek: ctx.thisWeek, liveLocations: ctx.liveLocations };
    delete ctx.now; delete ctx.liveLocations;

    const L = function (es, eng) { return en ? eng : es; };
    const sistema = [
      en
        ? 'You are the YENAVI FREIGHT LLC assistant inside the Truck Trip Log app, talking to driver ' + (b.user || '') + '. Answer ONLY about this driver\'s own trips, pay, miles, diesel and truck, using the DATA. Never reveal company profit, other drivers\' pay or company finances.'
        : 'Eres el asistente de YENAVI FREIGHT LLC dentro de la app Truck Trip Log, hablando con ' + (b.user || 'el administrador') + ' (administrador). Tienes TODOS los datos de la app: viajes (activos, programados, terminados y archivados), pagos de brokers y drivers, diésel, millas cargadas y muertas, gastos, mantenimiento, camiones, drivers, ajustes de pago, costos fijos y ubicaciones en vivo.',
      '',
      L('Cómo contestar:', 'How to answer:'),
      '- ' + L('Usa solo los DATOS y lo que se ve en las capturas. Si algo no está, dilo claro. Nunca inventes números.', 'Use only the DATA and what is visible in the screenshots. If something is missing, say so. Never invent numbers.'),
      '- ' + L('Usa primero los totales ya calculados en "summaries" (byWeek, byMonth, byYear, por driver/camión/broker, receivables = por cobrar, driverPayPending = pago a drivers pendiente). Suma viajes tú mismo solo si ningún total sirve, y revisa la cuenta dos veces.', 'Prefer the precomputed totals in "summaries". Only add up trips yourself when no total fits, and double-check the math.'),
      '- ' + L('La semana de trabajo es de sábado a viernes; la carga cuenta en la semana en que se entregó. "Esta semana" es thisWeek.', 'Work week is Saturday to Friday; a load counts in the week it was delivered. "This week" is thisWeek.'),
      '- ' + L('Tarifa por milla = valor de la carga ÷ (millas cargadas + muertas). Lee también "rules" en los DATOS.', 'Rate per mile = load value ÷ (loaded + deadhead miles). Also read "rules" in the DATA.'),
      '- ' + L('Para ubicación usa liveLocations (place y minutesAgo); si tiene más de 60 minutos, di que es la última ubicación conocida. Para ETA estima millas de carretera a unos 55 mph y di que es aproximado.', 'For location use liveLocations (place and minutesAgo); if older than 60 minutes, say it is the last known location. For ETA estimate road miles at about 55 mph and say it is approximate.'),
      '- ' + L('Sin capturas: la respuesta se lee en voz alta, así que corta y directa (2 a 4 oraciones), dinero como "1,250 dólares", sin tablas ni markdown. Si piden lista o detalle, dalo en renglones cortos.', 'Without screenshots: the answer is read aloud, so be short (2-4 sentences), money like "1,250 dollars", no tables or markdown. If asked for a list, use short lines.'),
      '',
      L('CAPTURAS DE PANTALLA (si vienen):', 'SCREENSHOTS (if any):'),
      '- ' + L('Primero di en una línea qué es (carga de load board, recibo de diésel, BOL/POD, RC, correo, ELD, otra cosa) y la conclusión. La PRIMERA LÍNEA se lee en voz alta: que sea la respuesta corta. Luego el detalle en renglones cortos, sin tablas ni markdown.', 'First line: what it is and the verdict (it is read aloud). Then details in short lines, no tables or markdown.'),
      '- ' + L('Lee con cuidado números, fechas, ciudades, ZIP, peso, equipo y pago. Si algo no se lee, dilo; no adivines.', 'Read numbers, dates, cities, ZIPs, weight, equipment and pay carefully. If something is unreadable, say so; do not guess.'),
      '- ' + (en
        ? 'LOAD (TQL, C.H. Robinson, DAT, Premium, etc.): give origin → destination, pick up date, weight, equipment, pay and loaded miles; estimate deadhead from where the driver is or will be free (liveLocations or the delivery of the active trip, mark "~"); rate per loaded mile and per total mile; your estimated pay (your payPct). Say if it fits a 26 ft box truck (≤ 8,500 lb).'
        : 'CARGA de load board (TQL, C.H. Robinson, DAT, Premium, etc.): origen → destino, fecha de pick up, peso, equipo, pago y millas cargadas. Estima las millas muertas desde donde está o queda libre cada driver (liveLocations o el delivery de su viaje activo; márcalas "~") y di qué driver conviene. Calcula tarifa por milla cargada y por milla total, pago al driver y factoring según "rules", diésel estimado con el fuelPerMi o mpg del camión en summaries (byTruck), y la GANANCIA LIMPIA estimada. Compara con el historial: tarifa promedio de ese broker y de cargas parecidas (mismos estados) en los DATOS. Revisa que quepa en box truck de 26 ft y ≤ 8,500 lb. Termina con veredicto (✅ tomar / ⚠️ negociar / ❌ no conviene) y cuánto pedir: el pago a $2.00, $2.25 y $2.50 por milla total.'),
      '- ' + L('RECIBO DE DIÉSEL: fecha, gasolinera, ciudad, galones, precio y total; di a qué viaje corresponde (driver, ruta y fechas) y si parece DUPLICADO (mismo total y fecha ya en fuelStops) o fuera de la ruta.', 'FUEL RECEIPT: date, station, city, gallons, price, total; which of your trips it belongs to and whether it looks duplicated.'),
      '- ' + L('BOL / POD / RC: número, shipper, consignee, fechas, peso y pago; di qué viaje es (o si es nuevo) y qué le falta a ese viaje en la app (RC #, pago, BOL, POD). Si el pago del RC no coincide con el viaje, dilo.', 'BOL / POD / RC: numbers, parties, dates; which trip it is and what is missing.'),
      '- ' + L('Recuerda: solo consultas. Si piden registrar o cambiar algo, di que se hace en la app.', 'You only look things up. If asked to save or change something, say it is done in the app.'),
      '- ' + L('Contesta en español.', 'Reply in English.')
    ].join('\n');

    const msgs = [];
    (b.history || []).slice(-8).forEach(function (m) {
      if (m && m.content && (m.role === 'user' || m.role === 'assistant')) msgs.push({ role: m.role, content: String(m.content).slice(0, 2000) });
    });
    while (msgs.length && msgs[0].role !== 'user') msgs.shift();
    // los mensajes deben alternar usuario / asistente
    for (let i = msgs.length - 1; i > 0; i--) if (msgs[i].role === msgs[i - 1].role) msgs.splice(i - 1, 1);
    if (msgs.length && msgs[msgs.length - 1].role === 'user') msgs.pop();

    const contenido = [];
    imgs.forEach(function (x, i) {
      contenido.push({ type: 'text', text: L('Captura ', 'Screenshot ') + (i + 1) + ':' });
      contenido.push({ type: 'image', source: { type: 'base64', media_type: x.media_type, data: x.data } });
    });
    contenido.push({ type: 'text', text: L('AHORA: ', 'NOW: ') + JSON.stringify(live) + '\n\n' + L('PREGUNTA: ', 'QUESTION: ') + String(b.q || '').slice(0, 1500) });
    msgs.push({ role: 'user', content: contenido });

    const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': P.getProperty('ANTHROPIC_KEY'), 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: imgs.length ? MODELO_CAPTURAS : MODELO,
        max_tokens: imgs.length ? 1800 : 900,
        system: [
          { type: 'text', text: sistema },
          { type: 'text', text: L('DATOS:\n', 'DATA:\n') + JSON.stringify(ctx), cache_control: { type: 'ephemeral' } }
        ],
        messages: msgs
      })
    });
    const j = JSON.parse(res.getContentText());
    if (j.error) return out_({ error: 'IA: ' + (j.error.message || j.error.type) });
    const texto = (j.content || []).map(function (c) { return c.text || ''; }).join('').trim();
    return out_({ answer: texto });
  } catch (err) {
    return out_({ error: String(err) });
  }
}

// Para probar que la URL funciona: ábrela en el navegador y debe decir "Asistente YENAVI listo".
