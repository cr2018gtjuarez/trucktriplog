// ===== Asistente YENAVI (voz y chat) — Google Apps Script =====
// Recibe la pregunta y TODOS los datos de Truck Trip Log desde la app, se los pasa a Claude y devuelve la respuesta.
// Solo consulta: no crea, cambia ni borra nada.
//
// Propiedades del script (⚙️ Configuración del proyecto → Propiedades del script):
//   ANTHROPIC_KEY = tu API key de console.anthropic.com
//   VOZ_KEY       = la clave que pegas en la app (botón ⚙️ del asistente)
// Implementar → Nueva implementación → Aplicación web → Ejecutar como: Yo · Acceso: Cualquier usuario.

const MODELO = 'claude-sonnet-5-5';   // para más potencia (y más costo) cambia a 'claude-opus-5-5'

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
    const driver = b.role === 'driver';

    // lo que cambia a cada minuto (hora y ubicaciones) va aparte, para que el resto se pueda reutilizar (caché = más barato y rápido)
    const ctx = b.ctx || {};
    const live = { now: ctx.now, today: ctx.today, thisWeek: ctx.thisWeek, liveLocations: ctx.liveLocations };
    delete ctx.now; delete ctx.liveLocations;

    const sistema = (en
      ? 'You are the YENAVI FREIGHT LLC assistant inside the Truck Trip Log app, talking to driver ' + (b.user || '') + '. Answer ONLY about this driver\'s own trips, pay, miles, diesel and truck, using the DATA. Never reveal company profit, load values of other drivers or other drivers\' pay.'
      : 'Eres el asistente de YENAVI FREIGHT LLC dentro de la app Truck Trip Log, hablando con ' + (b.user || 'el administrador') + ' (administrador). Tienes TODOS los datos de la app: viajes (activos, programados, terminados y archivados), pagos de brokers y drivers, diésel, millas cargadas y muertas, gastos, mantenimiento, camiones, drivers, ajustes de pago, costos fijos y ubicaciones en vivo.') +
      '\n\n' + (en ? 'How to answer:' : 'Cómo contestar:') +
      '\n- ' + (en ? 'Use only the DATA. If something is not there, say so plainly. Never invent numbers.' : 'Usa solo los DATOS. Si algo no está, dilo claro. Nunca inventes números.') +
      '\n- ' + (en ? 'Prefer the precomputed totals in "summaries" (byWeek, byMonth, byYear, by driver/truck/broker, receivables, driverPayPending). Only add up trips yourself when no total fits, and double-check the math.' : 'Usa primero los totales ya calculados en "summaries" (byWeek, byMonth, byYear, por driver/camión/broker, receivables = por cobrar, driverPayPending = pago a drivers pendiente). Suma viajes tú mismo solo si ningún total sirve, y revisa la cuenta dos veces.') +
      '\n- ' + (en ? 'Work week is Saturday to Friday; a load counts in the week it was delivered. "This week" is thisWeek.' : 'La semana de trabajo es de sábado a viernes; la carga cuenta en la semana en que se entregó. "Esta semana" es thisWeek.') +
      '\n- ' + (en ? 'Rate per mile = load value ÷ (loaded + deadhead miles).' : 'Tarifa por milla = valor de la carga ÷ (millas cargadas + muertas).') +
      '\n- ' + (en ? 'For location use liveLocations (place and minutesAgo); if older than 60 minutes, say it is the last known location. For ETA estimate road miles at about 55 mph and say it is approximate.' : 'Para ubicación usa liveLocations (place y minutesAgo); si tiene más de 60 minutos, di que es la última ubicación conocida. Para ETA estima millas de carretera a unos 55 mph y di que es aproximado.') +
      '\n- ' + (en ? 'Answers are read aloud: be short and direct (2-4 sentences), money like "1,250 dollars", no tables or markdown. If asked for a list or detail, give it in short lines.' : 'La respuesta se lee en voz alta: corta y directa (2 a 4 oraciones), dinero como "1,250 dólares", sin tablas ni markdown. Si piden lista o detalle, dalo en renglones cortos.') +
      '\n- ' + (en ? 'Reply in English.' : 'Contesta en español.');

    const msgs = [];
    (b.history || []).slice(-8).forEach(function (m) {
      if (m && m.content && (m.role === 'user' || m.role === 'assistant')) msgs.push({ role: m.role, content: String(m.content).slice(0, 2000) });
    });
    while (msgs.length && msgs[0].role !== 'user') msgs.shift();
    msgs.push({ role: 'user', content: (en ? 'NOW: ' : 'AHORA: ') + JSON.stringify(live) + '\n\n' + (en ? 'QUESTION: ' : 'PREGUNTA: ') + String(b.q || '').slice(0, 1000) });

    const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': P.getProperty('ANTHROPIC_KEY'), 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: MODELO, max_tokens: 900,
        system: [
          { type: 'text', text: sistema },
          { type: 'text', text: (en ? 'DATA:\n' : 'DATOS:\n') + JSON.stringify(ctx), cache_control: { type: 'ephemeral' } }
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
