import { Hono, Context } from 'hono';
import { sign, verify } from 'hono/jwt';
import { bearerAuth } from 'hono/bearer-auth';
import { cors } from 'hono/cors';
import { iniciarAgendamiento, continuarAgendamiento } from './agente_snabb_interactivo.js';

// --- TIPOS ---
type MyJWTPayload = {
  sub: string;
  iat: number;
  exp: number;
};

type ChatResponse = {
  message: string;
  screenshot?: string | null;
  options?: string[];
  waitingFor?: string;
};

type Env = {
  Bindings: {
    base_de_usuarios: D1Database;
    JWT_SECRET: string;
    AI: Ai;
    ELEVENLABS_API_KEY: string;
    MY_BROWSER: Fetcher;
  };
  Variables: {
    jwtPayload: MyJWTPayload;
  };
};

const app = new Hono<Env>();

// --- ALMACENAMIENTO DE SESIONES DE PUPPETEER (en memoria) ---
// En producción: usar Durable Objects o Redis
const puppeteerSessions = new Map<string, any>();

// --- FUNCIONES DE CONTRASEÑA (sin cambios) ---
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

// --- CORS ---
app.use('*', cors());

// --- RUTAS PÚBLICAS (sin cambios) ---
app.post('/register', async (c) => {
  const { rut, nombrePaciente, fechaNacimiento, idGenero, mail, telefono, password } = await c.req.json<any>();
  if (!rut || !nombrePaciente || !fechaNacimiento || !idGenero || !telefono || !password) {
    return c.json({ error: 'Faltan campos requeridos' }, 400);
  }
  const passwordHash = await hashPassword(password);
  try {
    const { success } = await c.env.base_de_usuarios.prepare(
      "INSERT INTO paciente (rut, nombrePaciente, fechaNacimiento, idGenero, mail, telefono, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(rut, nombrePaciente, fechaNacimiento, idGenero, mail || null, telefono, passwordHash).run();
    if (success) return c.json({ message: 'Paciente registrado con éxito' }, 201);
    else return c.json({ error: 'No se pudo registrar' }, 500);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) return c.json({ error: 'El RUT ya está registrado' }, 409);
    return c.json({ error: 'Error interno', details: e.message }, 500);
  }
});

app.post('/login', async (c) => {
  const { rut, password } = await c.req.json<{ rut: string, password: string }>();
  if (!rut || !password) return c.json({ error: 'RUT y contraseña requeridos' }, 400);
  const paciente = await c.env.base_de_usuarios.prepare(
    "SELECT rut, nombrePaciente, password_hash FROM paciente WHERE rut = ?"
  ).bind(rut).first<{ rut: string, nombrePaciente: string, password_hash: string }>();
  if (!paciente) return c.json({ error: 'Credenciales inválidas' }, 401);
  const isValidPassword = await verifyPassword(password, paciente.password_hash);
  if (!isValidPassword) return c.json({ error: 'Credenciales inválidas' }, 401);
  const payload: MyJWTPayload = { sub: paciente.rut, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) };
  const token = await sign(payload, c.env.JWT_SECRET);
  return c.json({ token, user: { rut: paciente.rut, nombrePaciente: paciente.nombrePaciente } });
});

app.get('/generos', async (c) => {
  try {
    const { results } = await c.env.base_de_usuarios.prepare("SELECT * FROM genero").all();
    return c.json(results);
  } catch (e: any) {
    return c.json({ error: 'Error al obtener géneros' }, 500);
  }
});

app.get('/especialidades', async (c) => {
  try {
    const { results } = await c.env.base_de_usuarios.prepare("SELECT * FROM especialidad").all();
    return c.json(results);
  } catch (e: any) {
    return c.json({ error: 'Error al obtener especialidades' }, 500);
  }
});

app.post('/tts', async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  const voiceId = "21m00Tcm4TlvDq8ikWAM";
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'Accept': 'audio/mpeg', 'Content-Type': 'application/json', 'xi-api-key': c.env.ELEVENLABS_API_KEY },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
    });
    if (!response.ok) return c.json({ error: 'TTS failed' }, 500);
    return new Response(response.body, { headers: { 'Content-Type': 'audio/mpeg' } });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- MIDDLEWARE ---
app.use('/api/*', bearerAuth({
  verifyToken: async (token: string, c: Context<Env>) => {
    try {
      const payload = await verify(token, c.env.JWT_SECRET) as MyJWTPayload;
      if (payload?.sub) {
        c.set('jwtPayload', payload);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }
}));

// --- RUTAS PRIVADAS EXISTENTES ---
app.delete('/api/consultas/:id', async (c) => {
  const idConsulta = c.req.param('id');
  const rutPaciente = c.var.jwtPayload.sub;
  try {
    const { success } = await c.env.base_de_usuarios.prepare(
      "DELETE FROM consulta WHERE idConsulta = ? AND rut = ?"
    ).bind(idConsulta, rutPaciente).run();
    if (!success) return c.json({ error: 'No se pudo borrar' }, 404);
    return c.json({ message: 'Cita borrada' });
  } catch (e: any) {
    return c.json({ error: 'Error al borrar', details: e.message }, 500);
  }
});

app.put('/api/consultas/:id', async (c) => {
  const idConsulta = c.req.param('id');
  const rutPaciente = c.var.jwtPayload.sub;
  const { fecha_iso } = await c.req.json<{ fecha_iso: string }>();
  if (!fecha_iso) return c.json({ error: 'Falta fecha_iso' }, 400);
  
  try {
    const fechaConTimezone = new Date(fecha_iso + "-03:00");
    if (isNaN(fechaConTimezone.getTime())) throw new Error('Fecha inválida');
    
    const { success } = await c.env.base_de_usuarios.prepare(
      "UPDATE consulta SET fechaHora = ? WHERE idConsulta = ? AND rut = ?"
    ).bind(fechaConTimezone.toISOString(), idConsulta, rutPaciente).run();
    
    if (!success) return c.json({ error: 'No se pudo modificar' }, 404);
    return c.json({ message: 'Cita modificada' });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint')) return c.json({ error: 'Hora ocupada' }, 409);
    return c.json({ error: 'Error al modificar' }, 500);
  }
});

app.get('/api/profile', async (c) => {
  const rut = c.var.jwtPayload.sub;
  const user = await c.env.base_de_usuarios.prepare(
    "SELECT rut, nombrePaciente, fechaNacimiento, idGenero, mail, telefono FROM paciente WHERE rut = ?"
  ).bind(rut).first();
  if (user) return c.json(user);
  return c.json({ error: 'Usuario no encontrado' }, 404);
});

app.get('/api/consultas', async (c) => {
  const rut = c.var.jwtPayload.sub;
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
        isPast,
      };
    });
    return c.json(appointments);
  } catch (e: any) {
    return c.json({ error: 'Error al obtener consultas' }, 500);
  }
});

// ============================================
// NUEVA LÓGICA: CHAT INTERACTIVO CON PUPPETEER
// ============================================

// Almacenamiento temporal de estados (EN PRODUCCIÓN: usar Durable Objects)
const estadosTemporales = new Map<string, any>();

// Función auxiliar para guardar cita en BD (MOVERLA ANTES DEL ENDPOINT)
async function guardarCitaEnBD(c: Context<Env>, rutPaciente: string, datos: any) {
  try {
    const { especialidad, fecha, hora } = datos;
    
    // Extraer día del texto de fecha
    const diaMatch = fecha.match(/\d+/);
    if (!diaMatch) {
      console.error("⚠️ No se pudo extraer día de:", fecha);
      return;
    }
    
    const dia = diaMatch[0].padStart(2, '0');
    const mesActual = (new Date().getMonth() + 1).toString().padStart(2, '0');
    const añoActual = new Date().getFullYear();
    
    // Construir fecha ISO: YYYY-MM-DDTHH:mm:ss-03:00
    const fechaISO = `${añoActual}-${mesActual}-${dia}T${hora}:00-03:00`;
    const fechaHoraCita = new Date(fechaISO);
    
    if (isNaN(fechaHoraCita.getTime())) {
      console.error("⚠️ Fecha inválida:", fechaISO);
      return;
    }
    
    console.log("📅 Guardando cita:", fechaHoraCita.toISOString());
    
    // Buscar especialidad en BD
    const especialidadResult = await c.env.base_de_usuarios.prepare(
      "SELECT idEspecialidad FROM especialidad WHERE especialidad LIKE ? LIMIT 1"
    ).bind(`%${especialidad}%`).first<{ idEspecialidad: number }>();
    
    if (!especialidadResult) {
      console.error("⚠️ Especialidad no encontrada:", especialidad);
      return;
    }
    
    // Buscar médico de esa especialidad
    const medicoResult = await c.env.base_de_usuarios.prepare(
      "SELECT idMedico FROM medico WHERE idEspecialidad = ? LIMIT 1"
    ).bind(especialidadResult.idEspecialidad).first<{ idMedico: number }>();
    
    if (!medicoResult) {
      console.error("⚠️ Médico no encontrado");
      return;
    }
    
    // Insertar consulta
    const result = await c.env.base_de_usuarios.prepare(
      "INSERT INTO consulta (fechaHora, rut, idMedico) VALUES (?, ?, ?)"
    ).bind(fechaHoraCita.toISOString(), rutPaciente, medicoResult.idMedico).run();
    
    if (result.success) {
      console.log("✅ Cita guardada en BD exitosamente");
    } else {
      console.error("❌ No se pudo guardar la cita");
    }
    
  } catch (error: any) {
    console.error("❌ Error guardando en BD:", error);
  }
}

app.post('/api/chat', async (c) => {
  try {
    const { prompt } = await c.req.json<{ prompt: string }>();
    const rutPaciente = c.var.jwtPayload.sub;
    
    console.log("💬 Mensaje del usuario:", prompt);
    
    const stateKey = `state_${rutPaciente}`;
    let estado = estadosTemporales.get(stateKey);
    
    // CANCELAR
    if (/cancelar|empezar de nuevo|olvídalo|salir/i.test(prompt)) {
      estadosTemporales.delete(stateKey);
      return c.json({
        role: 'ai',
        text: 'Proceso cancelado. ¿En qué más puedo ayudarte?',
        id: Date.now()
      });
    }
    
    // ESTADO: Esperando servicio
    if (estado?.waitingFor === 'servicio') {
      estado.servicio = prompt.trim();
      estado.waitingFor = 'especialidad';
      estadosTemporales.set(stateKey, estado);
      
      return c.json({
        role: 'ai',
        text: `Perfecto, has seleccionado: ${prompt}\n\n¿Qué especialidad médica necesitas?\nEjemplo: Medicina General, Pediatría, Cardiología, etc.`,
        id: Date.now(),
        waitingFor: 'especialidad'
      });
    }
    
    // ESTADO: Esperando especialidad
    if (estado?.waitingFor === 'especialidad') {
      estado.especialidad = prompt.trim();
      estado.waitingFor = 'ubicacion';
      estadosTemporales.set(stateKey, estado);
      
      return c.json({
        role: 'ai',
        text: `Excelente. Buscando ${prompt}...\n\n¿En qué ubicación prefieres atenderte?\nEjemplo: Providencia, Las Condes, Santiago Centro, etc.`,
        id: Date.now(),
        waitingFor: 'ubicacion'
      });
    }
    
    // ESTADO: Esperando ubicación -> EJECUTAR BÚSQUEDA
    if (estado?.waitingFor === 'ubicacion') {
      estado.ubicacion = prompt.trim();
      
      try {
        console.log("🔍 Buscando horas disponibles...");
        
        const pacienteData = await c.env.base_de_usuarios.prepare(
          "SELECT rut, telefono, mail FROM paciente WHERE rut = ?"
        ).bind(rutPaciente).first<{ rut: string, telefono: string, mail: string }>();
        
        if (!pacienteData) {
          return c.json({ role: 'ai', text: 'Error: datos de paciente no encontrados', id: Date.now() }, 500);
        }
        
        // IMPORTAR LA FUNCIÓN
        const { agendarCitaCompleta } = await import('./agente_snabb_interactivo.js');
        
        const resultado = await agendarCitaCompleta(
          c.env,
          {
            rut: pacienteData.rut,
            telefono: pacienteData.telefono,
            email: pacienteData.mail
          },
          {
            servicio: estado.servicio,
            especialidad: estado.especialidad,
            ubicacion: estado.ubicacion
          }
        );
        
        // ✅ MANEJAR CASO DE ERROR
        if (resultado.status === 'error') {
          console.log("📸 Screenshot en error recibido:", resultado.screenshot ? "SÍ" : "NO");
          estadosTemporales.delete(stateKey);
          return c.json({
            role: 'ai',
            text: `Error al buscar horas: ${resultado.message}\n\n¿Quieres intentar con otra búsqueda?`,
            id: Date.now(),
            debug_screenshot: resultado.screenshot
          });
        }
        
        if (resultado.status === 'no_disponible') {
          estadosTemporales.delete(stateKey);
          return c.json({
            role: 'ai',
            text: resultado.message + '\n\n¿Quieres intentar con otra búsqueda?',
            id: Date.now(),
            debug_screenshot: resultado.screenshot
          });
        }
        
        // Guardar opciones
        estado.opciones = resultado.opciones;
        estado.browserEstado = resultado.estado;
        estado.waitingFor = 'fecha';
        estadosTemporales.set(stateKey, estado);
        
        let mensaje = `✅ Encontré horas disponibles!\n\n📅 Fechas disponibles:\n`;
        resultado.opciones.fechas.forEach((f: string, i: number) => {
          mensaje += `${i + 1}. ${f}\n`;
        });
        mensaje += `\n¿Qué fecha prefieres? (escribe el número o la fecha completa)`;
        
        return c.json({
          role: 'ai',
          text: mensaje,
          id: Date.now(),
          options: resultado.opciones.fechas,
          debug_screenshot: resultado.screenshot,
          waitingFor: 'fecha'
        });
        
      } catch (error: any) {
        console.error("💥 Error en búsqueda:", error);
        estadosTemporales.delete(stateKey);
        
        return c.json({
          role: 'ai',
          text: `Error al buscar horas: ${error.message}. Por favor intenta de nuevo.`,
          id: Date.now(),
          debug_screenshot: error.screenshot || null
        }, 500);
      }
    }
    
    // ESTADO: Esperando fecha
    if (estado?.waitingFor === 'fecha') {
      let fechaSeleccionada = null;
      
      // Intentar parsear número (1, 2, 3...)
      const numero = parseInt(prompt.trim());
      if (!isNaN(numero) && numero > 0 && numero <= estado.opciones.fechas.length) {
        fechaSeleccionada = estado.opciones.fechas[numero - 1];
      } else {
        // Buscar coincidencia en las fechas disponibles
        const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        fechaSeleccionada = estado.opciones.fechas.find((f: string) => 
          normalizar(f).includes(normalizar(prompt)) || normalizar(prompt).includes(normalizar(f))
        );
      }
      
      if (!fechaSeleccionada) {
        return c.json({
          role: 'ai',
          text: `No encontré esa fecha. Por favor elige una de las opciones:\n\n${estado.opciones.fechas.map((f: string, i: number) => `${i+1}. ${f}`).join('\n')}`,
          id: Date.now(),
          options: estado.opciones.fechas,
          waitingFor: 'fecha'
        });
      }
      
      estado.fechaSeleccionada = fechaSeleccionada;
      estado.waitingFor = 'hora';
      estadosTemporales.set(stateKey, estado);
      
      let mensaje = `📅 Fecha seleccionada: ${fechaSeleccionada}\n\n🕐 Horas disponibles:\n`;
      estado.opciones.horas.forEach((h: string, i: number) => {
        mensaje += `${i + 1}. ${h}\n`;
      });
      mensaje += `\n¿Qué hora prefieres?`;
      
      return c.json({
        role: 'ai',
        text: mensaje,
        id: Date.now(),
        options: estado.opciones.horas,
        waitingFor: 'hora'
      });
    }
    
    // ESTADO: Esperando hora -> CONFIRMAR RESERVA
    if (estado?.waitingFor === 'hora') {
      let horaSeleccionada = null;
      
      const numero = parseInt(prompt.trim());
      if (!isNaN(numero) && numero > 0 && numero <= estado.opciones.horas.length) {
        horaSeleccionada = estado.opciones.horas[numero - 1];
      } else {
        horaSeleccionada = estado.opciones.horas.find((h: string) => h.includes(prompt.trim()));
      }
      
      if (!horaSeleccionada) {
        return c.json({
          role: 'ai',
          text: `No encontré esa hora. Por favor elige una de las opciones:\n\n${estado.opciones.horas.map((h: string, i: number) => `${i+1}. ${h}`).join('\n')}`,
          id: Date.now(),
          options: estado.opciones.horas,
          waitingFor: 'hora'
        });
      }
      
      try {
        console.log("✅ Confirmando reserva...");
        
        const pacienteData = await c.env.base_de_usuarios.prepare(
          "SELECT rut, telefono, mail FROM paciente WHERE rut = ?"
        ).bind(rutPaciente).first<{ rut: string, telefono: string, mail: string }>();
        
        const { confirmarCita } = await import('./agente_snabb_interactivo.js');
        
        const resultado = await confirmarCita(
          c.env,
          estado.browserEstado,
          estado.fechaSeleccionada,
          horaSeleccionada,
          {
            rut: pacienteData!.rut,
            telefono: pacienteData!.telefono,
            email: pacienteData!.mail
          }
        );
        
        // ✅ MANEJAR CASO DE ERROR EN CONFIRMACIÓN
        if (resultado.status === 'error') {
          estadosTemporales.delete(stateKey);
          return c.json({
            role: 'ai',
            text: `Error al confirmar la reserva: ${resultado.message}. Por favor intenta de nuevo.`,
            id: Date.now(),
            debug_screenshot: resultado.screenshot
          });
        }
        
        // Guardar en BD
        await guardarCitaEnBD(c, rutPaciente, {
          especialidad: estado.especialidad,
          fecha: estado.fechaSeleccionada,
          hora: horaSeleccionada
        });
        
        // Limpiar estado
        estadosTemporales.delete(stateKey);
        
        return c.json({
          role: 'ai',
          text: `${resultado.message}\n\n✅ Especialidad: ${estado.especialidad}\n📅 Fecha: ${estado.fechaSeleccionada}\n🕐 Hora: ${horaSeleccionada}\n🏥 Ubicación: ${estado.ubicacion}\n\nRecibirás una confirmación por correo.`,
          id: Date.now(),
          debug_screenshot: resultado.screenshot
        });
        
      } catch (error: any) {
        console.error("💥 Error confirmando:", error);
        estadosTemporales.delete(stateKey);
        
        return c.json({
          role: 'ai',
          text: `Error al confirmar la reserva: ${error.message}. Por favor intenta de nuevo.`,
          id: Date.now(),
          debug_screenshot: error.screenshot || null
        }, 500);
      }
    }
    
    // INICIO: Detectar intención de agendar
    const intentoAgendar = /agendar|reserv|cita|hora|consulta|necesito|quiero/i.test(prompt);
    
    if (intentoAgendar) {
      console.log("🚀 Iniciando proceso de agendamiento...");
      
      estadosTemporales.set(stateKey, {
        waitingFor: 'servicio'
      });
      
      return c.json({
        role: 'ai',
        text: `¡Perfecto! Te ayudaré a agendar una cita médica paso a paso.\n\n🏥 Primero, ¿qué tipo de servicio necesitas?\n\nOpciones comunes:\n• Consultas Médicas\n• Exámenes\n• Procedimientos\n• Telemedicina\n\n(Puedes escribir el nombre del servicio)`,
        id: Date.now(),
        waitingFor: 'servicio'
      });
    }
    
    // Conversación general
    return c.json({
      role: 'ai',
      text: '¡Hola! Soy tu asistente médico virtual. Puedo ayudarte a:\n\n• Agendar citas médicas\n• Ver tus citas programadas\n• Modificar o cancelar citas\n\n¿Qué necesitas?',
      id: Date.now()
    });
    
  } catch (error: any) {
    console.error("💥 Error en /api/chat:", error);
    return c.json({
      role: 'ai',
      text: `Error inesperado: ${error.message}`,
      id: Date.now()
    }, 500);
  }
});

export default app;