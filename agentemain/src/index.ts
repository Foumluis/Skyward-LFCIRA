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
    base_de_usuarios: D1Database;
    JWT_SECRET: string;
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
app.post('/api/chat', async (c) => {
  const { prompt } = await c.req.json<{ prompt: string }>();
  const payload = c.var.jwtPayload;
  const rutPaciente = payload.sub;

  const p = prompt.toLowerCase();
  let aiResponse = "";
  let isAppointment = false;
  let newAppointment: any = {};

  if (p.includes('citas') || p.includes('horas') || p.includes('hola')) {
      aiResponse = "Entiendo. Para poder reservarte una hora, necesito saber qué especialidad buscas (ej. **Odontología**, **Pediatría**, **Cardiología**) y si tienes alguna preferencia de día o doctor.";
  } else if (p.includes('dolor') || p.includes('sintomas') || p.includes('síntomas')) {
      aiResponse = "Lamento que no te sientas bien. Para asistirte, por favor, dime la especialidad que necesitas o la **fecha y hora** exacta que buscas.";
  
  // Lógica de reserva "falsa"
  } else if (p.includes('confirmar') || (p.includes('cardiologia') && (p.includes('martes') || p.includes('mañana')))) {
      aiResponse = "¡**Reserva completada!** La hora con el **Dr. Smith** en **Cardiología** queda programada para el *15 de noviembre a las 11:00 AM*. Recibirás un recordatorio por correo.";
      
      // ¡Aquí conectamos con la BD!
      isAppointment = true;
      newAppointment = {
        fechaHora: new Date('2025-11-15T11:00:00').toISOString(), // Fecha/hora de la cita
        rut: rutPaciente,
        idMedico: 2, // ID Fijo para "Dra. Ana López" (Cardiología)
      };

  } else if (p.includes('pediatria') || p.includes('cardiologia') || p.includes('odontologia') || p.includes('medicina general')) {
      aiResponse = "Perfecto, ¿para cuándo te gustaría la cita? Estoy viendo horas disponibles para la próxima semana, *por ejemplo, el martes por la tarde*.";
  } else {
      aiResponse = "Para continuar, ¿me indicas la especialidad y si necesitas alguna fecha u horario específico?";
  }

  // Si se detectó una cita, la guardamos en la BD
  if (isAppointment) {
    try {
      await c.env.base_de_usuarios.prepare(
        "INSERT INTO consulta (fechaHora, rut, idMedico) VALUES (?, ?, ?)"
      ).bind(newAppointment.fechaHora, newAppointment.rut, newAppointment.idMedico).run();
    } catch (e: any) {
      console.log("Error al guardar consulta:", e);
      aiResponse = "Hubo un problema al guardar tu cita en la base de datos, pero la IA la ha registrado. (Error: " + e.message + ")";
    }
  }

  return c.json({ role: 'ai', text: aiResponse, id: Date.now() });
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
    const now = new Date();
    const appointments = results.map((row: any) => {
      const apptDate = new Date(row.fechaHora);
      const isPast = apptDate < now;
      return {
        id: row.fechaHora, // Usamos la fechaHora como ID único
        specialty: row.especialidad,
        doctor: row.nombreMedico,
        date: apptDate.toLocaleDateString('es-CL', { day: '2-digit', month: 'long' }),
        time: apptDate.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
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


export default app