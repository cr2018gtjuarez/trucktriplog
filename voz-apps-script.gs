// ===== Asistente YENAVI (voz, chat y capturas de pantalla) — Google Apps Script =====
// Recibe la pregunta, las fotos/capturas (si hay) y TODOS los datos de Truck Trip Log desde la app,
// se los pasa a Claude y devuelve la respuesta. Con fotos también devuelve "docs": los datos leídos de cada foto
// (recibo de diésel, BOL, POD, RC, orden, foto de carga) para que la app ofrezca botones de Guardar.
// El Apps Script NO guarda nada: la app guarda solo cuando el administrador toca Guardar.
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
    const imgs = (b.images || []).filter(function (x) { return x && x.data && /^image\/(jpeg|png|gif|webp)$/.test(x.media_type || ''); }).slice(0, 6);

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
      '- ' + L('RECIBO DE DIÉSEL (Love\'s, Pilot, TA, Circle K, Bosselman, Mudflap, etc.): gasolinera y número de tienda, ciudad, estado y ZIP, fecha, galones, precio por galón y total; revisa que galones × precio = total. Di de qué driver es: el nombre de Love\'s Rewards / loyalty, o los últimos 4 de la tarjeta según fuelCards en los DATOS; si la tarjeta no está en fuelCards, dilo. Di a qué viaje corresponde (driver activo en esa fecha, ruta y fechas) y si la gasolinera queda en la ruta. "DUPLICATE RECEIPT" o "COPY" impreso = reimpresión, NO quiere decir que ya esté en la app: revisa fuelStops (misma fecha y mismo total) para saber si ya está guardado.', 'FUEL RECEIPT: station, city, date, gallons, price, total (check gallons × price = total); which of your trips it belongs to and whether it is already saved (same date and total in fuelStops). "DUPLICATE RECEIPT" printed only means a reprint.'),
      '- ' + L('BOL / POD: número de BOL, PRO, sello, shipper → consignee (ciudad, estado, ZIP), fechas, piezas y peso, quién firmó. Si lo firmó quien recibe (consignee) es POD; si solo shipper y carrier, es BOL de pick up. Algunos BOL ponen la fecha día-mes (05-11-2026 = 5 de noviembre): usa las fechas de pick up para decidir. Si el carrier impreso no es YENAVI FREIGHT o la placa no es de un camión en trucks, avísalo. Di de qué viaje es (o si es nuevo) y qué le falta a ese viaje.', 'BOL / POD: numbers, parties, dates, who signed (signed by receiver = POD); which trip it is and what is missing.'),
      '- ' + L('RC (rate confirmation) u ORDEN ya tomada (por ejemplo la pantalla "Order" de Premium con RC SIGNED): número de RC/orden, broker, driver, pick up y entrega (dirección, ZIP, fecha y hora), peso, millas y pago. Si en la página no viene el pago, dilo. Di si ya existe ese viaje en la app (mismo RC #) y si el pago no coincide. Copia las instrucciones importantes (base militar, cómo presentarse, liftgate, equipo de protección). Recuerda la regla: un viaje pasa a En Tránsito solo cuando ya hay BOL; sin BOL queda programado.', 'RC or booked ORDER: numbers, broker, driver, stops, pay; whether the trip already exists.'),
      '- ' + L('Pantalla de load board: además revisa si da el tiempo entre pick up y entrega (millas ÷ 55 mph); si no da, dilo.', 'Load board: also check the pick up → delivery window is drivable (miles ÷ 55 mph).'),
      '- ' + L('FOTO DE LA CARGA (caja abierta con la mercancía): di que es foto de carga, cuántas piezas se ven y si va asegurada (straps, barras); avisa si algo se ve suelto o mal acomodado.', 'CARGO PHOTO: say what is loaded and whether it looks secured.'),
      '- ' + (en ? 'You only look things up. If asked to save or change something, say it is done in the app.' : 'Cuando la foto se puede guardar (recibo, BOL, POD, RC, orden o foto de carga), la app te pone botones de Guardar debajo de tu respuesta: no digas que no puedes guardar; di a qué viaje lo guardarías.'),
      '- ' + L('Contesta en español.', 'Reply in English.')
    ].join('\n');

    // Con fotos (solo administrador): además de la respuesta, los datos de cada foto en JSON para los botones de Guardar
    const DOCS = imgs.length && !en ? [
      'DESPUÉS de escribir tu respuesta, llama SIEMPRE a la herramienta "docs" con lo que leíste de cada foto (no pongas ese JSON en el texto).',
      'Un objeto por foto, con "img" = número de la captura (1, 2, …) y "tipo" = diesel | bol | pod | rc | orden | carga | loadboard | otro. Campos según el tipo (pon null si no se ve; NUNCA inventes):',
      '- diesel: fecha (AAAA-MM-DD), gasolinera (marca y número de tienda), ciudad, estado (2 letras), zip, galones, precio, total, tarjeta (últimos 4), nombre (loyalty, si viene), ticket (número de ticket, invoice o transacción), reimpreso (true si dice DUPLICATE/COPY), producto (diesel | def | gasolina), enRuta (true | false | null)',
      '- bol / pod: bol, pro, sello, broker, carrier, placa, shipper {nombre, ciudad, estado, zip}, consignee {nombre, ciudad, estado, zip}, fechaPickup, fechaEntrega, piezas, peso, firmaDriver, firmaRecibido (true | false)',
      '- rc / orden: rc (número de RC u orden), broker, driver, pago (número o null), millas, peso, pickup {fecha, hora, direccion, ciudad, estado, zip}, entrega {fecha, hora, direccion, ciudad, estado, zip}, notas (instrucciones importantes, corto)',
      '- carga: piezas, asegurada (true | false | null)',
      'En TODOS los tipos pon tripId = el "id" del viaje de los DATOS al que corresponde (o null si no hay o no estás seguro) y driver = nombre del driver si lo sabes.'
    ].join('\n') : '';

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
    contenido.push({ type: 'text', text: L('AHORA: ', 'NOW: ') + JSON.stringify(live) + '\n\n' + L('PREGUNTA: ', 'QUESTION: ') + String(b.q || '').slice(0, 1500) + (DOCS ? '\n\n' + DOCS : '') });
    msgs.push({ role: 'user', content: contenido });

    const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': P.getProperty('ANTHROPIC_KEY'), 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: imgs.length ? MODELO_CAPTURAS : MODELO,
        max_tokens: imgs.length ? 3500 : 900,
        system: [
          { type: 'text', text: sistema },
          { type: 'text', text: L('DATOS:\n', 'DATA:\n') + JSON.stringify(ctx), cache_control: { type: 'ephemeral' } }
        ],
        messages: msgs,
        tools: DOCS ? [{ name: 'docs', description: 'Datos leídos de cada foto, para los botones de Guardar de la app.',
          input_schema: { type: 'object', properties: { docs: { type: 'array', items: { type: 'object' } } }, required: ['docs'] } }] : undefined
      })
    });
    const j = JSON.parse(res.getContentText());
    if (j.error) return out_({ error: 'IA: ' + (j.error.message || j.error.type) });
    let texto = (j.content || []).map(function (c) { return c.type === 'text' ? (c.text || '') : ''; }).join('').trim();
    let docs = null;
    (j.content || []).forEach(function (c) { if (c.type === 'tool_use' && c.name === 'docs' && c.input && Array.isArray(c.input.docs)) docs = c.input.docs; });
    const at = texto.indexOf('<<DOCS>>');
    if (at >= 0) {   // por si acaso el modelo lo puso en el texto
      const raw = texto.slice(at + 8).replace(/```(json)?/g, '').trim();
      texto = texto.slice(0, at).trim();
      try { const a = raw.indexOf('{'), z = raw.lastIndexOf('}'); docs = docs || JSON.parse(raw.slice(a, z + 1)).docs || null; } catch (x) { }
    }
    return out_({ answer: texto, docs: docs });
  } catch (err) {
    return out_({ error: String(err) });
  }
}

// Para probar que la URL funciona: ábrela en el navegador y debe decir "Asistente YENAVI listo".
