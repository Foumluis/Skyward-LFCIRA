import { Hono, Context } from 'hono'
import { sign, verify } from 'hono/jwt'
import { bearerAuth } from 'hono/bearer-auth'
import { cors } from 'hono/cors' // Importamos CORS

// --- Definición de Tipos ---

// El payload que guardamos en el token
type MyJWTPayload = {
  sub: string // El RUT del paciente
  iat: number
  exp: number
}

// Tipos del Entorno (Bindings y Variables)
type Env = {
  Bindings: {
    base_de_usuarios: D1Database; // Base de datos D1
    JWT_SECRET: string; // Clave secreta para JWT
    AI: Ai; // Binding para el servicio de IA
    ELEVENLABS_API_KEY: string; // Clave API para ElevenLabs
  },
  Variables: {
    jwtPayload: MyJWTPayload
  }
}

const app = new Hono<Env>()

// --- Middleware de CORS ---
// Permite que tu frontend (en localhost o en su propio dominio) 
// llame a tu backend de Cloudflare.
app.use('*', cors()) 

// --- Lógica de Contraseñas (Sin Cambios) ---
// (Las funciones hashPassword y verifyPassword van aquí... 
//  asegúrate de que estén presentes y correctas con SHA-256)

async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  
  const exportedKeyBuffer = (await crypto.subtle.exportKey('raw', key)) as ArrayBuffer;
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
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );
    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    const exportedDerivedKeyBuffer = (await crypto.subtle.exportKey('raw', derivedKey)) as ArrayBuffer;
    const exportedDerivedKey = new Uint8Array(exportedDerivedKeyBuffer);

    if (exportedDerivedKey.length !== key.length) return false;
    let diff = 0;
    for (let i = 0; i < key.length; i++) {
      diff |= exportedDerivedKey[i] ^ key[i];
    }
    return diff === 0;

  } catch (e) {
    return false;
  }
}

// --- RUTAS PÚBLICAS (Login / Registro / Datos) ---

// Ruta de Registro (Sin cambios, ya estaba bien)
app.post('/register', async (c) => {
  const { 
    rut, 
    nombrePaciente, 
    fechaNacimiento, 
    idGenero, 
    mail, 
    telefono, 
    password
  } = await c.req.json<any>();

  if (!rut || !nombrePaciente || !fechaNacimiento || !idGenero || !telefono || !password) {
    return c.json({ error: 'Faltan campos requeridos para el registro' }, 400);
  }
  const passwordHash = await hashPassword(password);

  try {
    const { success } = await c.env.base_de_usuarios.prepare(
      "INSERT INTO paciente (rut, nombrePaciente, fechaNacimiento, idGenero, mail, telefono, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(rut, nombrePaciente, fechaNacimiento, idGenero, mail || null, telefono, passwordHash).run();

    if (success) {
      return c.json({ message: 'Paciente registrado con éxito' }, 201);
    } else {
      return c.json({ error: 'No se pudo registrar al paciente' }, 500);
    }
  } catch (e: any) {
    console.log("Error capturado en /register:", e);
    if (e.message?.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'El RUT ya está registrado' }, 409);
    }
    return c.json({ error: 'Error interno del servidor', details: e.message }, 500);
  }
});

// --- ¡CAMBIO IMPORTANTE! ---
// Ruta de Login ahora devuelve el token Y los datos del usuario
app.post('/login', async (c) => {
  const { rut, password } = await c.req.json<{ rut: string, password: string }>();

  if (!rut || !password) {
    return c.json({ error: 'RUT y contraseña son requeridos' }, 400);
  }

  // Buscamos al paciente y traemos los datos que el frontend necesita
  const paciente = await c.env.base_de_usuarios.prepare(
    "SELECT rut, nombrePaciente, password_hash FROM paciente WHERE rut = ?"
  ).bind(rut).first<{ rut: string, nombrePaciente: string, password_hash: string }>();

  if (!paciente) {
    return c.json({ error: 'Credenciales inválidas (usuario)' }, 401); 
  }

  const isValidPassword = await verifyPassword(password, paciente.password_hash);
  if (!isValidPassword) {
    return c.json({ error: 'Credenciales inválidas (contraseña)' }, 401);
  }

  const payload: MyJWTPayload = {
    sub: paciente.rut, 
    iat: Math.floor(Date.now() / 1000), 
    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24),
  };
  const token = await sign(payload, c.env.JWT_SECRET);

  // Devolvemos el token Y el objeto 'user'
  return c.json({
    message: 'Login exitoso',
    token: token,
    user: {
      rut: paciente.rut,
      nombrePaciente: paciente.nombrePaciente
      // Agrega aquí cualquier otro dato que el frontend necesite
    }
  });
});

// --- NUEVAS RUTAS PÚBLICAS ---
// Para poblar los dropdowns del frontend

app.get('/generos', async (c) => {
  try {
    const { results } = await c.env.base_de_usuarios.prepare("SELECT * FROM genero").all();
    return c.json(results);
  } catch (e: any) {
    return c.json({ error: 'Error al obtener géneros', details: e.message }, 500);
  }
});

app.get('/especialidades', async (c) => {
  try {
    const { results } = await c.env.base_de_usuarios.prepare("SELECT * FROM especialidad").all();
    return c.json(results);
  } catch (e: any) {
    return c.json({ error: 'Error al obtener especialidades', details: e.message }, 500);
  }
});

app.get('/medicos', async (c) => {
  try {
    // Opcional: filtrar por especialidad
    // ej: /medicos?especialidad=1
    const { especialidad } = c.req.query();
    let query = "SELECT * FROM medico";
    if (especialidad) {
      query = `SELECT * FROM medico WHERE idEspecialidad = ${parseInt(especialidad)}`;
    }
    const { results } = await c.env.base_de_usuarios.prepare(query).all();
    return c.json(results);
  } catch (e: any) {
    return c.json({ error: 'Error al obtener médicos', details: e.message }, 500);
  }
});


// --- RUTAS PRIVADAS (Requieren Token) ---

// 1. Middleware de autenticación
// (Sin cambios)
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

// 2. Ruta de Perfil (Actualizada a tabla 'paciente')
app.get('/api/profile', async (c) => {
  const payload = c.var.jwtPayload;
  const rut = payload.sub;

  // Busca en la tabla 'paciente'
  const user = await c.env.base_de_usuarios.prepare(
    "SELECT rut, nombrePaciente, fechaNacimiento, idGenero, mail, telefono FROM paciente WHERE rut = ?"
  ).bind(rut).first();

  if (user) {
    return c.json(user);
  } else {
    return c.json({ error: 'Usuario no encontrado' }, 404);
  }
});

// --- NUEVA RUTA: CHAT "IA" ---
// Replicamos la lógica "falsa" del frontend, pero en el backend
// para que pueda interactuar con la base de datos.
// --- NUEVA RUTA: CHAT CON IA (Llama 3) ---

// (Primero, pongamos la lógica de la BD en su propia función)
// (Esta función está dentro de src/index.ts, antes de la ruta /api/chat)

// (Reemplaza esta función completa)
// (Esta función está en src/index.ts, reemplaza la versión anterior)

// (Esta función está en src/index.ts, reemplaza la versión anterior)

// (Esta función está en src/index.ts, reemplaza la versión anterior)

async function crearConsultaEnBD(
  c: Context<Env>, 
  rutPaciente: string,  // <-- ¡AQUÍ ESTÁ LA CORRECCIÓN!
  especialidadNombre: string, 
  fechaHoraCita: Date
) {
  
  // --- ¡LÓGICA MEJORADA! AHORA USA COINCIDENCIA EXACTA ---
  
  // 1. Buscar el ID de la especialidad en la base de datos
  const especialidadResult = await c.env.base_de_usuarios.prepare(
    "SELECT idEspecialidad FROM especialidad WHERE especialidad = ? LIMIT 1"
  ).bind(especialidadNombre).first<{ idEspecialidad: number }>();

  if (!especialidadResult) {
    return `Lo siento, no pude encontrar la especialidad "${especialidadNombre}" en nuestra base de datos. ¿Podrías intentarlo de nuevo?`;
  }

  const idEspecialidad = especialidadResult.idEspecialidad;

  // 2. Buscar un médico disponible para esa especialidad
  const medicoResult = await c.env.base_de_usuarios.prepare(
    "SELECT idMedico, nombreMedico FROM medico WHERE idEspecialidad = ? LIMIT 1"
  ).bind(idEspecialidad).first<{ idMedico: number, nombreMedico: string }>();

  if (!medicoResult) {
    return `Lo siento, no tenemos médicos disponibles para la especialidad "${especialidadNombre}" en este momento.`;
  }

  const idMedico = medicoResult.idMedico;
  const nombreMedico = medicoResult.nombreMedico;
  // --- FIN LÓGICA MEJORADA ---

  try {
    await c.env.base_de_usuarios.prepare(
      "INSERT INTO consulta (fechaHora, rut, idMedico) VALUES (?, ?, ?)"
    )
    .bind(fechaHoraCita.toISOString(), rutPaciente, idMedico) // <-- Esta línea ahora funciona
    .run();
    
    const mensajeConfirmacion = `¡Reserva completada! Tu hora para ${especialidadNombre} con el/la ${nombreMedico} ha sido agendada para: ${fechaHoraCita.toLocaleString('es-CL', { timeZone: 'America/Santiago' })}.`;
    
    return mensajeConfirmacion;

  } catch (e: any) {
    console.log("Error al guardar consulta:", e);
    if (e.message?.includes('UNIQUE constraint failed')) {
        return `Lo siento, esa hora exacta (${fechaHoraCita.toLocaleString('es-CL', { timeZone: 'America/Santiago' })}) con ${nombreMedico} ya está tomada. Por favor, intenta con otra.`;
    }
    return `Lo siento, detecté tu intención de agendar para ${especialidadNombre}, pero ocurrió un error al guardarla en la base de datos: ${e.message}`;
  }
}

app.post('/api/chat', async (c) => {
  const { prompt, history } = await c.req.json<{ prompt: string, history: { role: string, text: string }[] }>();
  const payload = c.var.jwtPayload;
  const rutPaciente = payload.sub;

  // (Obtenemos la lista de especialidades...)
  const { results: specialties } = await c.env.base_de_usuarios.prepare(
    "SELECT especialidad FROM especialidad"
  ).all<{ especialidad: string }>();
  const specialtyList = specialties.map(s => s.especialidad).join(", ");
  
  const today = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });

  // (El System Prompt sigue siendo el mismo)
  const systemPrompt = `Eres un extractor de datos. Tu única tarea es analizar la solicitud del usuario y devolver un objeto JSON.
  La fecha de HOY es ${today} (formato DD-MM-YYYY).
  Las ÚNICAS especialidades disponibles son: [${specialtyList}].
  
  Tu respuesta DEBE contener un bloque de JSON envuelto en etiquetas <json> y </json>.
  
  Ejemplo de respuesta:
  <json>
  {
    "accion": "string", // "hablar" o "agendar"
    "especialidad": "string|null",
    "fecha_iso": "string|null" // (Formato YYYY-MM-DDTHH:MM:SS)
  }
  </json>
  
  --- REGLAS ESTRICTAS DE EXTRACCIÓN ---
  // (Todas tus reglas 1-4 van aquí...)
  `;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(msg => ({
      role: msg.role === 'ai' ? 'assistant' : 'user',
      content: msg.text
    })),
    { role: 'user', content: prompt }
  ];
  
  try {
    const aiResponse: any = await c.env.AI.run(
      '@cf/meta/llama-3.2-3b-instruct',
      { messages } // Sin 'response_format'
    );
    
    let iaJSON: any;
    let textoRespuestaFinal: string = "";

    // (Lógica robusta para buscar el JSON...)
    const jsonMatch = aiResponse.response.match(/<json>([\s\S]*?)<\/json>/);

    if (jsonMatch && jsonMatch[1]) {
      try {
        iaJSON = JSON.parse(jsonMatch[1]);
      } catch (e: any) {
        console.error("Llama 3 envió JSON malformado:", jsonMatch[1], e);
        throw new Error("Llama 3 generó una respuesta inválida.");
      }
    } else {
      console.error("Llama 3 no devolvió las etiquetas <json>.");
      throw new Error("Llama 3 no siguió las instrucciones de formato.");
    }

    // --- LÓGICA DE RESPUESTA DE TYPESCRIPT ---
    if (iaJSON.accion === 'agendar' && iaJSON.especialidad && iaJSON.fecha_iso) {
      
      console.log(`IA detectó agendamiento completo: ${iaJSON.especialidad}, ${iaJSON.fecha_iso}`);
      
      // --- ¡AQUÍ ESTÁ LA CORRECCIÓN INTELIGENTE! ---
      // Llama 3 es inconsistente. A veces envía YYYY-MM-DD, a veces DD-MM-YYYY.
      
      const parts = iaJSON.fecha_iso.split('T');
      if (parts.length < 2) throw new Error(`Fecha inválida, falta 'T': ${iaJSON.fecha_iso}`);
      
      const dateParts = parts[0].split('-');
      if (dateParts.length < 3) throw new Error(`Fecha inválida, falta '-': ${iaJSON.fecha_iso}`);

      let isoDateString = "";
      
      if (dateParts[0].length === 4) {
        // Formato correcto (YYYY-MM-DD), usar tal cual
        console.log("Formato de fecha detectado: YYYY-MM-DD (Correcto)");
        isoDateString = iaJSON.fecha_iso;
      } else if (dateParts[2].length === 4) {
        // Formato inverso (DD-MM-YYYY), voltear
        console.log("Formato de fecha detectado: DD-MM-YYYY (Invirtiendo)");
        isoDateString = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}T${parts[1]}`;
      } else {
        // Formato desconocido
        throw new Error(`Llama 3 devolvió un formato de fecha desconocido: ${iaJSON.fecha_iso}`);
      }
      
      // Ahora 'new Date()' funcionará
      const fechaConTimezone = new Date(isoDateString + "-03:00");
      // --- FIN DE LA CORRECCIÓN ---

      if (isNaN(fechaConTimezone.getTime())) {
         // Si la fecha *aún así* es inválida
         throw new Error(`La fecha procesada (${isoDateString}) es inválida.`);
      }

      textoRespuestaFinal = await crearConsultaEnBD(
        c, 
        rutPaciente, 
        iaJSON.especialidad, 
        fechaConTimezone
      );
    
    } else if (iaJSON.accion === 'hablar') {
      // (Lógica para "hablar" sin cambios...)
      if (iaJSON.especialidad && !iaJSON.fecha_iso) {
        textoRespuestaFinal = `¡Perfecto! ¿Para qué fecha y hora te gustaría agendar en ${iaJSON.especialidad}?`;
      } else if (!iaJSON.especialidad && iaJSON.fecha_iso) {
        textoRespuestaFinal = `¡Claro! ¿Para qué especialidad necesitas la hora? (Ej: ${specialtyList})`;
      } else {
        textoRespuestaFinal = "¡Hola! Soy tu asistente. ¿Qué especialidad y fecha buscas?";
      }
    } else {
      textoRespuestaFinal = "No estoy seguro de cómo ayudarte con eso. ¿Podrías reformular tu solicitud?";
    }
    
    return c.json({ role: 'ai', text: textoRespuestaFinal, id: Date.now() });

  } catch (e: any) {
    console.error("Error crítico llamando a la IA:", e);
    return c.json({ role: 'ai', text: `Lo siento, mi cerebro de IA tuvo un error: ${e.message}`, id: Date.now() });
  }
});

// --- NUEVA RUTA: OBTENER CONSULTAS ---
// Para la pestaña "Mis Reservas"
app.get('/api/consultas', async (c) => {
  const payload = c.var.jwtPayload;
  const rut = payload.sub;

  try {
    // Query complejo para traer toda la info de la cita
    const { results } = await c.env.base_de_usuarios.prepare(
      `SELECT
          c.fechaHora,
          c.rut,
          m.nombreMedico,
          e.especialidad
       FROM consulta c
       JOIN medico m ON c.idMedico = m.idMedico
       JOIN especialidad e ON m.idEspecialidad = e.idEspecialidad
       WHERE c.rut = ?
       ORDER BY c.fechaHora DESC`
    ).bind(rut).all();
    
    // Mapeamos los resultados al formato que el frontend espera
// ... dentro de app.get('/api/consultas', ...)

    const now = new Date();
    const appointments = results.map((row: any) => {
      const apptDate = new Date(row.fechaHora);
      
      // --- ¡CAMBIO! ---
      // Damos 1 hora (3,600,000 ms) de gracia.
      // Una cita solo es "pasada" si terminó hace más de una hora.
      const isPast = apptDate.getTime() < (now.getTime() - 3600000);
      // --- FIN DEL CAMBIO ---

      return {
        id: row.fechaHora, 
        specialty: row.especialidad,
        doctor: row.nombreMedico,
        date: apptDate.toLocaleDateString('es-CL', { 
            day: '2-digit', 
            month: 'long',
            timeZone: 'America/Santiago' // <--- AÑADIR ESTO
        }),
        time: apptDate.toLocaleTimeString('es-CL', { 
            hour: '2-digit', 
            minute: '2-digit',
            timeZone: 'America/Santiago' // <--- AÑADIR ESTO
        }),
        status: isPast ? 'Completada' : 'Confirmada', // <-- Esto ahora dirá "Confirmada"
        isPast: isPast,
      };
    });

    return c.json(appointments);
// ...

  } catch (e: any) {
    console.log("Error al obtener consultas:", e);
    return c.json({ error: 'Error al obtener consultas', details: e.message }, 500);
  }
});

// --- NUEVA RUTA: TEXT-TO-SPEECH (ELEVENLABS) ---
// Esta ruta NO está protegida, para que sea rápida.
app.post('/tts', async (c) => {
  const { text } = await c.req.json<{ text: string }>();

  // ID de voz de ejemplo (Rachel). Puedes cambiarla por la que prefieras.
  const voiceId = "21m00Tcm4TlvDq8ikWAM"; 

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': c.env.ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v2', // Buen modelo para español
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    if (!response.ok) {
      console.error("Error de ElevenLabs:", await response.text());
      return c.json({ error: 'Failed to generate speech' }, 500);
    }

    // Devolvemos el audio directamente al frontend
    return new Response(response.body, {
      headers: { 
        'Content-Type': 'audio/mpeg'
      }
    });

  } catch (e: any) {
    console.error("Error en /api/tts:", e);
    return c.json({ error: e.message }, 500);
  }
});

export default app