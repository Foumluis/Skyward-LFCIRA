import { Hono, Context } from 'hono';
import { sign, verify } from 'hono/jwt';
import { bearerAuth } from 'hono/bearer-auth';
import { cors } from 'hono/cors';

// --- Definición de Tipos ---
type MyJWTPayload = {
  sub: string;
  iat: number;
  exp: number;
};

type Env = {
  Bindings: {
    base_de_usuarios: D1Database;
    JWT_SECRET: string;
    AI: Ai;
    ELEVENLABS_API_KEY: string;
  };
  Variables: {
    jwtPayload: MyJWTPayload;
  };
};

const app = new Hono<Env>();

// --- Middleware de CORS ---
app.use('*', cors());

// --- Lógica de Contraseñas ---
async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
  );
  const exportedKeyBuffer = await crypto.subtle.exportKey('raw', key) as ArrayBuffer;
  const exportedKey = new Uint8Array(exportedKeyBuffer);
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const keyHex = Array.from(exportedKey).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${keyHex}`;
}

async function verifyPassword(password: string, hash: string) {
  try {
    const [saltHex, keyHex] = hash.split(':');
    const salt = Uint8Array.from(saltHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const key = Uint8Array.from(keyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey']
    );
    const derivedKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
    );
    const exportedDerivedKeyBuffer = await crypto.subtle.exportKey('raw', derivedKey) as ArrayBuffer;
    const exportedDerivedKey = new Uint8Array(exportedDerivedKeyBuffer);
    if (exportedDerivedKey.length !== key.length) return false;
    let diff = 0;
    for (let i = 0; i < key.length; i++) diff |= exportedDerivedKey[i] ^ key[i];
    return diff === 0;
  } catch (e) {
    return false;
  }
}

// --- RUTAS PÚBLICAS (Login / Registro / Datos) ---
app.post('/register', async (c) => {
  const { rut, nombrePaciente, fechaNacimiento, idGenero, mail, telefono, password } = await c.req.json<any>();
  if (!rut || !nombrePaciente || !fechaNacimiento || !idGenero || !telefono || !password) {
    return c.json({ error: 'Faltan campos requeridos para el registro' }, 400);
  }
  const passwordHash = await hashPassword(password);
  try {
    const { success } = await c.env.base_de_usuarios.prepare(
      "INSERT INTO paciente (rut, nombrePaciente, fechaNacimiento, idGenero, mail, telefono, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(rut, nombrePaciente, fechaNacimiento, idGenero, mail || null, telefono, passwordHash).run();
    if (success) return c.json({ message: 'Paciente registrado con éxito' }, 201);
    else return c.json({ error: 'No se pudo registrar al paciente' }, 500);
  } catch (e: any) {
    console.log("Error capturado en /register:", e);
    if (e.message?.includes('UNIQUE constraint failed')) return c.json({ error: 'El RUT ya está registrado' }, 409);
    return c.json({ error: 'Error interno del servidor', details: e.message }, 500);
  }
});

app.post('/login', async (c) => {
  const { rut, password } = await c.req.json<{ rut: string, password: string }>();
  if (!rut || !password) return c.json({ error: 'RUT y contraseña son requeridos' }, 400);
  const paciente = await c.env.base_de_usuarios.prepare(
    "SELECT rut, nombrePaciente, password_hash FROM paciente WHERE rut = ?"
  ).bind(rut).first<{ rut: string, nombrePaciente: string, password_hash: string }>();
  if (!paciente) return c.json({ error: 'Credenciales inválidas (usuario)' }, 401);
  const isValidPassword = await verifyPassword(password, paciente.password_hash);
  if (!isValidPassword) return c.json({ error: 'Credenciales inválidas (contraseña)' }, 401);
  const payload: MyJWTPayload = { sub: paciente.rut, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) };
  const token = await sign(payload, c.env.JWT_SECRET);
  return c.json({ message: 'Login exitoso', token: token, user: { rut: paciente.rut, nombrePaciente: paciente.nombrePaciente } });
});

app.get('/generos', async (c) => {
  try {
    const { results } = await c.env.base_de_usuarios.prepare("SELECT * FROM genero").all();
    return c.json(results);
  } catch (e: any) {
    console.error("Error en /generos:", e);
    return c.json({ error: 'Error al obtener géneros', details: e.message }, 500);
  }
});

app.get('/especialidades', async (c) => {
 try {
    const { results } = await c.env.base_de_usuarios.prepare("SELECT * FROM especialidad").all();
    return c.json(results);
  } catch (e: any) {
    console.error("Error en /especialidades:", e);
    return c.json({ error: 'Error al obtener especialidades', details: e.message }, 500);
  }
});

app.get('/medicos', async (c) => {
 try {
    const { especialidad } = c.req.query();
    let query = "SELECT * FROM medico";
    let bindings: (string | number)[] = [];
    if (especialidad) {
      query = `SELECT * FROM medico WHERE idEspecialidad = ?`;
      bindings.push(parseInt(especialidad));
    }
    const { results } = await c.env.base_de_usuarios.prepare(query).bind(...bindings).all();
    return c.json(results);
  } catch (e: any) {
    console.error("Error en /medicos:", e);
    return c.json({ error: 'Error al obtener médicos', details: e.message }, 500);
  }
});

// --- RUTA TTS (Pública) ---
app.post('/tts', async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  const voiceId = "21m00Tcm4TlvDq8ikWAM";
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'Accept': 'audio/mpeg', 'Content-Type': 'application/json', 'xi-api-key': c.env.ELEVENLABS_API_KEY },
      body: JSON.stringify({ text: text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
    });
    if (!response.ok) {
      console.error("Error de ElevenLabs:", await response.text());
      return c.json({ error: 'Failed to generate speech' }, 500);
    }
    return new Response(response.body, { headers: { 'Content-Type': 'audio/mpeg' } });
  } catch (e: any) {
    console.error("Error en /tts:", e);
    return c.json({ error: e.message }, 500);
  }
});

// --- MIDDLEWARE DE AUTENTICACIÓN ---
app.use(
  '/api/*',
  bearerAuth({
    verifyToken: async (token: string, c: Context<Env>) => {
      try {
        const payload = await verify(token, c.env.JWT_SECRET) as MyJWTPayload;
        if (payload && payload.sub) {
          c.set('jwtPayload', payload);
          return true;
        }
        return false;
      } catch (e) {
        return false;
      }
    }
  })
);

// --- RUTAS PRIVADAS (DESPUÉS DEL MIDDLEWARE) ---

// RUTA BORRAR CITA
app.delete('/api/consultas/:id', async (c) => {
  console.log("!!! >>> DENTRO DE app.delete <<< !!!");
  const idConsulta = c.req.param('id');
  const payload = c.var.jwtPayload;
  
  if (!payload) {
    console.error("DELETE Handler: Middleware falló, falta payload");
    return c.json({ error: 'Autenticación fallida' }, 401);
  }
  
  const rutPaciente = payload.sub;
  console.log(`Intentando borrar: idConsulta='${idConsulta}', rut='${rutPaciente}'`);
  
  try {
    const { success } = await c.env.base_de_usuarios.prepare(
      "DELETE FROM consulta WHERE idConsulta = ? AND rut = ?"
    ).bind(idConsulta, rutPaciente).run();
    
    if (!success) {
      console.log(`DELETE falló: No se encontró fila con idConsulta=${idConsulta} Y rut=${rutPaciente}`);
      return c.json({ error: 'No se pudo borrar la cita. No se encontró o no tienes permiso.' }, 404);
    }
    
    console.log(`DELETE exitoso para idConsulta=${idConsulta}, rut=${rutPaciente}`);
    return c.json({ message: 'Cita borrada con éxito' });
  } catch (e: any) {
    console.error("Error crítico al borrar consulta:", e);
    return c.json({ error: 'Error interno al borrar la cita', details: e.message }, 500);
  }
});

// RUTA MODIFICAR CITA (HORARIO)
app.put('/api/consultas/:id', async (c) => {
  console.log("!!! >>> DENTRO DE app.put <<< !!!");
  const idConsulta = c.req.param('id');
  const payload = c.var.jwtPayload;
  
  if (!payload) {
    console.error("PUT Handler: Middleware falló, falta payload");
    return c.json({ error: 'Autenticación fallida' }, 401);
  }
  
  const rutPaciente = payload.sub;
  const { fecha_iso } = await c.req.json<{ fecha_iso: string }>();
  
  if (!fecha_iso) {
    return c.json({ error: 'Falta la nueva fecha (fecha_iso)' }, 400);
  }

  let fechaHoraCita: Date;
  try {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(fecha_iso)) {
      throw new Error('Formato fecha_iso esperado YYYY-MM-DDTHH:MM:SS');
    }
    const fechaConTimezone = new Date(fecha_iso + "-03:00");
    if (isNaN(fechaConTimezone.getTime())) {
      throw new Error('Fecha inválida después de parsear');
    }
    fechaHoraCita = fechaConTimezone;
  } catch (e: any) {
    console.error("Error parseando fecha_iso:", fecha_iso, e);
    return c.json({ error: `Formato de fecha inválido: ${e.message}` }, 400);
  }

  try {
    const { success } = await c.env.base_de_usuarios.prepare(
      "UPDATE consulta SET fechaHora = ? WHERE idConsulta = ? AND rut = ?"
    ).bind(fechaHoraCita.toISOString(), idConsulta, rutPaciente).run();
    
    if (!success) {
      return c.json({ error: 'No se pudo modificar la cita. No se encontró o no tienes permiso.' }, 404);
    }
    
    return c.json({ message: 'Cita modificada con éxito' });
  } catch (e: any) {
    console.error("Error al modificar consulta:", e);
    if (e.message?.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Error: Esa nueva hora ya está ocupada.' }, 409);
    }
    return c.json({ error: 'Error interno al modificar la cita', details: e.message }, 500);
  }
});

// RUTA PERFIL
app.get('/api/profile', async (c) => {
  const payload = c.var.jwtPayload;
  const rut = payload.sub;
  const user = await c.env.base_de_usuarios.prepare(
    "SELECT rut, nombrePaciente, fechaNacimiento, idGenero, mail, telefono FROM paciente WHERE rut = ?"
  ).bind(rut).first();
  if (user) return c.json(user);
  else return c.json({ error: 'Usuario no encontrado' }, 404);
});

// RUTA OBTENER CONSULTAS
app.get('/api/consultas', async (c) => {
  const payload = c.var.jwtPayload;
  const rut = payload.sub;
  try {
    const query = `SELECT c.idConsulta, c.fechaHora, m.nombreMedico, e.especialidad
                   FROM consulta c
                   JOIN medico m ON c.idMedico = m.idMedico
                   JOIN especialidad e ON m.idEspecialidad = e.idEspecialidad
                   WHERE c.rut = ? ORDER BY c.fechaHora DESC`;
    const { results } = await c.env.base_de_usuarios.prepare(query).bind(rut)
                         .all<{ idConsulta: number, fechaHora: string, nombreMedico: string, especialidad: string }>();
    
    const now = new Date();
    const appointments = results.map((row: any) => {
      const apptDate = new Date(row.fechaHora);
      const isPast = apptDate.getTime() < (now.getTime() - 3600000);
      return {
        id: row.idConsulta,
        specialty: row.especialidad,
        doctor: row.nombreMedico,
        date: apptDate.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', timeZone: 'America/Santiago' }),
        time: apptDate.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' }),
        status: isPast ? 'Completada' : 'Confirmada',
        isPast: isPast,
      };
    });
    return c.json(appointments);
  } catch (e: any) {
    console.log("Error al obtener consultas:", e);
    return c.json({ error: 'Error al obtener consultas', details: e.message }, 500);
  }
});

// --- LÓGICA DEL CHATBOT ---

// Función para guardar cita
async function guardarNuevaConsulta(c: Context<Env>, rutPaciente: string, especialidadNombre: string, fechaHoraCita: Date): Promise<string> {
  try {
    const especialidadResult = await c.env.base_de_usuarios.prepare(
      "SELECT idEspecialidad FROM especialidad WHERE especialidad = ? LIMIT 1"
    ).bind(especialidadNombre).first<{ idEspecialidad: number }>();
    
    if (!especialidadResult) {
      return `Lo siento, no pude encontrar la especialidad "${especialidadNombre}".`;
    }
    
    const medicoResult = await c.env.base_de_usuarios.prepare(
      "SELECT idMedico, nombreMedico FROM medico WHERE idEspecialidad = ? LIMIT 1"
    ).bind(especialidadResult.idEspecialidad).first<{ idMedico: number, nombreMedico: string }>();
    
    if (!medicoResult) {
      return `Lo siento, no tenemos médicos para "${especialidadNombre}".`;
    }
    
    await c.env.base_de_usuarios.prepare(
      "INSERT INTO consulta (fechaHora, rut, idMedico) VALUES (?, ?, ?)"
    ).bind(fechaHoraCita.toISOString(), rutPaciente, medicoResult.idMedico).run();
    
    return `¡Reserva completada! Tu hora para ${especialidadNombre} con ${medicoResult.nombreMedico} ha sido agendada para: ${fechaHoraCita.toLocaleString('es-CL', { timeZone: 'America/Santiago' })}.`;
  } catch (e: any) {
    console.log("Error al guardar consulta:", e);
    if (e.message?.includes('UNIQUE constraint failed')) {
      return `Lo siento, esa hora exacta ya está tomada. Por favor elige otra hora.`;
    }
    return `Error al guardar la cita: ${e.message}`;
  }
}

// Función para borrar cita (directa, sin fetch)
async function borrarConsulta(c: Context<Env>, rutPaciente: string, consultaId: number): Promise<string> {
  try {
    console.log(`Intentando borrar: idConsulta='${consultaId}', rut='${rutPaciente}'`);
    
    const { success } = await c.env.base_de_usuarios.prepare(
      "DELETE FROM consulta WHERE idConsulta = ? AND rut = ?"
    ).bind(consultaId, rutPaciente).run();
    
    if (!success) {
      console.log(`DELETE falló: No se encontró fila con idConsulta=${consultaId} Y rut=${rutPaciente}`);
      return `No encontré la cita con ID ${consultaId} o no te pertenece.`;
    }
    
    console.log(`DELETE exitoso para idConsulta=${consultaId}, rut=${rutPaciente}`);
    return `¡Cita ${consultaId} borrada con éxito!`;
  } catch (e: any) {
    console.error("Error al borrar consulta:", e);
    return `Error al intentar borrar la cita: ${e.message}`;
  }
}

// Función para modificar cita (directa, sin fetch)
async function modificarConsulta(c: Context<Env>, rutPaciente: string, consultaId: number, nuevaFecha: Date): Promise<string> {
  try {
    console.log(`Intentando modificar: idConsulta='${consultaId}', rut='${rutPaciente}', nuevaFecha='${nuevaFecha.toISOString()}'`);
    
    const { success } = await c.env.base_de_usuarios.prepare(
      "UPDATE consulta SET fechaHora = ? WHERE idConsulta = ? AND rut = ?"
    ).bind(nuevaFecha.toISOString(), consultaId, rutPaciente).run();
    
    if (!success) {
      console.log(`UPDATE falló: No se encontró fila con idConsulta=${consultaId} Y rut=${rutPaciente}`);
      return `No encontré la cita con ID ${consultaId} o no te pertenece.`;
    }
    
    console.log(`UPDATE exitoso para idConsulta=${consultaId}, rut=${rutPaciente}`);
    const fechaFormateada = nuevaFecha.toLocaleString('es-CL', { timeZone: 'America/Santiago' });
    return `¡Cita ${consultaId} modificada con éxito para el ${fechaFormateada}!`;
  } catch (e: any) {
    console.error("Error al modificar consulta:", e);
    if (e.message?.includes('UNIQUE constraint failed')) {
      return `Lo siento, la nueva hora ya está ocupada. Intenta con otra hora.`;
    }
    return `Error al intentar modificar la cita: ${e.message}`;
  }
}

// Función para parsear fecha con validación
function parsearFecha(fecha_iso: string): { fecha: Date | null, error: string | null } {
  try {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(fecha_iso)) {
      return { fecha: null, error: 'Formato fecha_iso esperado YYYY-MM-DDTHH:MM:SS' };
    }
    const fechaConTimezone = new Date(fecha_iso + "-03:00");
    if (isNaN(fechaConTimezone.getTime())) {
      return { fecha: null, error: 'Fecha inválida después de parsear' };
    }
    return { fecha: fechaConTimezone, error: null };
  } catch (e: any) {
    return { fecha: null, error: e.message };
  }
}

// Función Lógica Principal de la IA (CORREGIDA)
async function procesarAccionIA(c: Context<Env>, rutPaciente: string, iaJSON: any, token: string): Promise<string> {
  const { accion, especialidad, fecha_iso, consulta_id } = iaJSON;
  console.log("Dentro de procesarAccionIA, acción detectada:", accion, "Datos:", iaJSON);

  try {
    // --- CASE 1: AGENDAR ---
    if (accion === 'agendar') {
      if (especialidad && fecha_iso) {
        const { fecha, error } = parsearFecha(fecha_iso);
        if (error || !fecha) {
          return `La fecha que entendí (${fecha_iso}) no es válida: ${error}. ¿Podrías repetirla?`;
        }
        return await guardarNuevaConsulta(c, rutPaciente, especialidad, fecha);
      } else if (especialidad && !fecha_iso) {
        return `¡Perfecto! ¿Para qué fecha y hora te gustaría agendar en ${especialidad}?`;
      } else if (!especialidad && fecha_iso) {
        return `¡Claro! ¿Para qué especialidad necesitas la hora?`;
      } else {
        return "Necesito saber la especialidad y la fecha para agendar. ¿Qué especialidad necesitas y para cuándo?";
      }
    }

    // --- CASE 2: BORRAR ---
    else if (accion === 'borrar') {
      if (consulta_id) {
        console.log(`BORRAR: Detectado ID ${consulta_id}. Llamando a función directa...`);
        return await borrarConsulta(c, rutPaciente, consulta_id);
      } else {
        // Listar citas para que el usuario elija
        console.log("BORRAR: No se detectó ID, listando citas...");
        const query = `SELECT c.idConsulta, c.fechaHora, e.especialidad 
                       FROM consulta c 
                       JOIN medico m ON c.idMedico = m.idMedico 
                       JOIN especialidad e ON m.idEspecialidad = e.idEspecialidad 
                       WHERE c.rut = ? AND c.fechaHora > datetime('now') 
                       ORDER BY c.fechaHora ASC`;
        const { results } = await c.env.base_de_usuarios.prepare(query).bind(rutPaciente)
          .all<{ idConsulta: number, fechaHora: string, especialidad: string }>();
        
        if (!results || results.length === 0) {
          return "No tienes ninguna cita futura para borrar.";
        }
        
        const listaCitas = results.map(r => 
          `[ID ${r.idConsulta}] ${r.especialidad} - ${new Date(r.fechaHora).toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`
        ).join("; ");
        return `Tus próximas citas son: ${listaCitas}. Por favor, dime el ID de la cita que quieres borrar.`;
      }
    }

    // --- CASE 3: MODIFICAR ---
    else if (accion === 'modificar') {
      if (consulta_id && fecha_iso) {
        console.log(`MODIFICAR: Detectado ID ${consulta_id} y fecha ${fecha_iso}. Llamando a función directa...`);
        
        const { fecha, error } = parsearFecha(fecha_iso);
        if (error || !fecha) {
          return `La fecha que entendí (${fecha_iso}) no es válida: ${error}. ¿Podrías repetirla?`;
        }
        
        return await modificarConsulta(c, rutPaciente, consulta_id, fecha);
      } else if (consulta_id && !fecha_iso) {
        return `Entendido, quieres modificar la cita ${consulta_id}. ¿Para qué nueva fecha y hora?`;
      } else {
        // Listar citas para que el usuario elija
        console.log("MODIFICAR: No se detectó ID o fecha, listando citas...");
        const query = `SELECT c.idConsulta, c.fechaHora, e.especialidad 
                       FROM consulta c 
                       JOIN medico m ON c.idMedico = m.idMedico 
                       JOIN especialidad e ON m.idEspecialidad = e.idEspecialidad 
                       WHERE c.rut = ? AND c.fechaHora > datetime('now') 
                       ORDER BY c.fechaHora ASC`;
        const { results } = await c.env.base_de_usuarios.prepare(query).bind(rutPaciente)
          .all<{ idConsulta: number, fechaHora: string, especialidad: string }>();
        
        if (!results || results.length === 0) {
          return "No tienes ninguna cita futura para modificar.";
        }
        
        const listaCitas = results.map(r => 
          `[ID ${r.idConsulta}] ${r.especialidad} - ${new Date(r.fechaHora).toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`
        ).join("; ");
        return `Tus próximas citas son: ${listaCitas}. Por favor, dime el ID de la cita que quieres modificar y la nueva fecha/hora.`;
      }
    }

    // --- CASE 4: HABLAR (Fallback) ---
    else if (accion === 'hablar') {
      console.log("Acción: hablar. Generando respuesta...");
      if (especialidad && !fecha_iso) {
        return `¡Perfecto! ¿Para qué fecha y hora en ${especialidad}?`;
      } else if (!especialidad && fecha_iso) {
        return `¡Claro! ¿Para qué especialidad necesitas la hora?`;
      } else {
        return "¡Hola! Soy tu asistente médico virtual. Puedo ayudarte a agendar, modificar o cancelar citas. ¿En qué puedo ayudarte?";
      }
    }

    // --- DEFAULT FALLBACK ---
    else {
      console.warn("Acción desconocida o JSON incompleto:", iaJSON);
      return "No estoy seguro de cómo ayudarte con eso. Puedo ayudarte a agendar, modificar o cancelar citas médicas. ¿Qué necesitas?";
    }

  } catch (outerError: any) {
    console.error("Error inesperado en procesarAccionIA:", outerError);
    return `Lo siento, ocurrió un error interno inesperado: ${outerError.message}`;
  }
}

// RUTA PRINCIPAL DEL CHAT
app.post('/api/chat', async (c) => {
  try {
    const { prompt, history } = await c.req.json<{ prompt: string, history: { role: string, text: string }[] }>();
    const payload = c.var.jwtPayload;
    
    if (!payload) {
      console.error("/api/chat: Middleware falló, falta payload");
      return c.json({ error: 'Autenticación fallida' }, 401);
    }
    
    const rutPaciente = payload.sub;
    const token = c.req.header('Authorization')?.split(' ')[1] || '';

    const { results: specialties } = await c.env.base_de_usuarios.prepare(
      "SELECT especialidad FROM especialidad"
    ).all<{ especialidad: string }>();
    const specialtyList = specialties.map(s => s.especialidad).join(", ");
    const today = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });

    const systemPrompt = `Eres un extractor de intención para agendar citas médicas. Tu única tarea es analizar la solicitud del usuario y devolver un objeto JSON.
La fecha de HOY es ${today}. Las ÚNICAS especialidades disponibles son: [${specialtyList}].
Tu respuesta DEBE contener un bloque de JSON envuelto en etiquetas <json> y </json>.
La estructura JSON es: <json>{ "accion": "string", "especialidad": "string|null", "fecha_iso": "string|null", "consulta_id": "number|null", "consulta_filtro": "string|null" }</json>

--- REGLAS ESTRICTAS DE EXTRACCIÓN ---
1. Si quiere RESERVAR ("agéndame", "necesito hora", "quiero agendar"), usa "accion": "agendar".
2. Si quiere ELIMINAR ("borra", "cancela", "elimina mi cita"), usa "accion": "borrar".
3. Si quiere CAMBIAR ("modifica", "cambiar", "mover mi cita"), usa "accion": "modificar".
4. Si solo saluda o faltan datos, usa "accion": "hablar".
5. Si menciona un ID numérico ("cita 4", "la número 5"), extrae "consulta_id": 4.
6. Si usa un filtro ("la de cardiología", "mi hora de pediatría"), extrae "consulta_filtro": "cardiología".
7. Para fechas, SIEMPRE devuelve formato ISO: "YYYY-MM-DDTHH:MM:SS" (ejemplo: "2025-10-26T14:30:00").
8. Si el usuario dice "mañana", "pasado mañana", calcula la fecha correcta desde HOY (${today}).
9. Si no especifica hora, usa 09:00:00 por defecto.

Ejemplos:
- Usuario: "Quiero hora para cardiología mañana a las 3 pm" → {"accion":"agendar","especialidad":"Cardiología","fecha_iso":"2025-10-26T15:00:00","consulta_id":null,"consulta_filtro":null}
- Usuario: "Borra mi cita 5" → {"accion":"borrar","especialidad":null,"fecha_iso":null,"consulta_id":5,"consulta_filtro":null}
- Usuario: "Cambia mi cita de pediatría al lunes 10:00" → {"accion":"modificar","especialidad":null,"fecha_iso":"2025-10-27T10:00:00","consulta_id":null,"consulta_filtro":"Pediatría"}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map(msg => ({ role: msg.role === 'ai' ? 'assistant' : 'user', content: msg.text })),
      { role: 'user', content: prompt }
    ];
    
    const aiResponse: any = await c.env.AI.run('@cf/meta/llama-3-8b-instruct', { 
      messages: messages,
      max_tokens: 512,
      temperature: 0.2
    });
    
    let iaJSON: any = null;
    const responseText = aiResponse.response?.trim() || '';
    
    console.log("Respuesta cruda de la IA:", responseText);
    
    // Intentar extraer JSON
    let jsonString = null;
    const jsonMatch = responseText.match(/<json>([\s\S]*?)<\/json>/);
    if (jsonMatch && jsonMatch[1]) {
      jsonString = jsonMatch[1].trim();
      console.log("JSON string encontrado usando etiquetas <json>");
    }
    
    // Si no encontró con etiquetas, buscar llaves
    if (!jsonString && responseText.includes('{') && responseText.includes('}')) {
      const startIdx = responseText.indexOf('{');
      const endIdx = responseText.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        jsonString = responseText.substring(startIdx, endIdx + 1);
        console.log("JSON string encontrado buscando llaves {}");
      }
    }
    
    if (jsonString) {
      try {
        iaJSON = JSON.parse(jsonString);
        console.log("JSON parseado exitosamente:", iaJSON);
      } catch (e) {
        console.warn("String parecía JSON pero malformado:", jsonString, e);
        iaJSON = null;
      }
    }
    
    let textoRespuestaFinal: string = "";
    
    if (iaJSON && iaJSON.accion) {
      textoRespuestaFinal = await procesarAccionIA(c, rutPaciente, iaJSON, token);
    } else {
      console.error("La IA no devolvió un JSON válido:", responseText);
      // Intentar dar una respuesta genérica basada en el texto
      if (responseText.toLowerCase().includes('hola') || responseText.toLowerCase().includes('saludo')) {
        textoRespuestaFinal = "¡Hola! Soy tu asistente médico virtual. Puedo ayudarte a agendar, modificar o cancelar citas. ¿En qué puedo ayudarte?";
      } else {
        textoRespuestaFinal = "Lo siento, no pude entender tu solicitud. ¿Podrías reformularla? Puedo ayudarte a agendar, modificar o cancelar citas médicas.";
      }
    }
    
    console.log("/api/chat devolviendo:", textoRespuestaFinal);
    return c.json({ role: 'ai', text: textoRespuestaFinal, id: Date.now() });

  } catch (e: any) {
    console.error("Error crítico en /api/chat:", e);
    return c.json({ 
      role: 'ai', 
      text: `Lo siento, ocurrió un error al procesar tu mensaje: ${e.message}`, 
      id: Date.now() 
    }, 500);
  }
});

export default app;