import { Hono, Context } from 'hono'
// Quitamos la importación de JWTPayload que no existe
import { sign, verify } from 'hono/jwt'
import { bearerAuth } from 'hono/bearer-auth'
import { cors } from 'hono/cors' // <--- AÑADE ESTA LÍNEA
// --- CORRECCIÓN 1: Definir nuestro propio tipo de Payload ---
// En lugar de importar JWTPayload, definimos la forma
// que tiene el payload que nosotros mismos creamos.
type MyJWTPayload = {
  sub: string
  iat: number
  exp: number
}
// --- Fin Corrección 1 ---

// --- Tipos (Hono v4) ---
type Env = {
  Bindings: {
    base_de_usuarios: D1Database;
    JWT_SECRET: string;
  },
  Variables: {
    // Usamos nuestro tipo personalizado
    jwtPayload: MyJWTPayload
  }
}

const app = new Hono<Env>()

// --- AÑADE ESTA LÍNEA DE AQUÍ ---
// Esto permite peticiones desde cualquier origen (cualquier frontend)
app.use('*', cors())
// --- FIN DE LA LÍNEA A AÑADIR ---

// --- Lógica de Contraseñas (Web Crypto API) ---
// (El resto de tu código sigue igual)
// --- Lógica de Contraseñas (Web Crypto API) ---
// (Esta parte ya estaba correcta con el 'as ArrayBuffer')

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


// --- RUTAS PÚBLICAS (Login / Registro) ---
// (Sin cambios aquí)

app.post('/register', async (c) => {
  // 1. Extraer TODOS los datos del paciente del body
  const { 
    rut, 
    nombrePaciente, 
    fechaNacimiento, 
    idGenero, 
    mail, 
    telefono, 
    password // Recibimos 'password' (la contraseña)
  } = await c.req.json<{ 
    rut: string, 
    nombrePaciente: string,
    fechaNacimiento: string, // Esperamos "AAAA-MM-DD"
    idGenero: number,
    mail: string,
    telefono: string,
    password: string 
  }>();

  // Validación básica (puedes añadir más)
  if (!rut || !nombrePaciente || !fechaNacimiento || !idGenero || !telefono || !password) {
    return c.json({ error: 'Faltan campos requeridos para el registro' }, 400);
  }

  // 2. Hashear la contraseña
  const passwordHash = await hashPassword(password);

  try {
    // 3. Insertar en la tabla 'paciente'
    const { success } = await c.env.base_de_usuarios.prepare(
      "INSERT INTO paciente (rut, nombrePaciente, fechaNacimiento, idGenero, mail, telefono, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        rut, 
        nombrePaciente, 
        fechaNacimiento, 
        idGenero, 
        mail || null, // Mail es opcional
        telefono, 
        passwordHash // Guardamos el hash
      )
      .run();

    if (success) {
      return c.json({ message: 'Paciente registrado con éxito' }, 201);
    } else {
      return c.json({ error: 'No se pudo registrar al paciente' }, 500);
    }
  } catch (e: any) {
    console.log("Error capturado en /register:", e); // Mantenemos el debug
    if (e.message?.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'El RUT ya está registrado' }, 409); // 409 Conflict
    }
    return c.json({ error: 'Error interno del servidor', details: e.message }, 500);
  }
});

/**
 * Ruta para iniciar sesión (Login)
 * POST /login
 * Body: { "rut": "1-1", "password": "123" }
 */
app.post('/login', async (c) => {
  const { rut, password } = await c.req.json<{ rut: string, password: string }>();

  if (!rut || !password) {
    return c.json({ error: 'RUT y contraseña son requeridos' }, 400);
  }

  // 1. Buscar al PACIENTE por RUT
  const paciente = await c.env.base_de_usuarios.prepare(
    "SELECT rut, password_hash FROM paciente WHERE rut = ?"
  )
    .bind(rut)
    .first<{ rut: string, password_hash: string }>(); // Solo traemos lo necesario

  if (!paciente) {
    return c.json({ error: 'Credenciales inválidas (usuario)' }, 401); 
  }

  // 2. Verificar la contraseña
  const isValidPassword = await verifyPassword(password, paciente.password_hash);

  if (!isValidPassword) {
    return c.json({ error: 'Credenciales inválidas (contraseña)' }, 401);
  }

  // 3. Si es válido, crear un token JWT
  const payload: MyJWTPayload = {
    sub: paciente.rut, // El "Subject" sigue siendo el RUT
    iat: Math.floor(Date.now() / 1000), 
    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24), // Expira en 24 horas
  };

  const token = await sign(payload, c.env.JWT_SECRET);

  return c.json({
    message: 'Login exitoso',
    token: token
  });
});

// --- RUTAS PRIVADAS (Requieren Token) ---
// (Tu ruta /api/profile sigue funcionando igual, 
//  pero ahora consulta la tabla 'paciente' en lugar de 'users')
// ... (Asegúrate de cambiar 'c.env.DB' a 'c.env.base_de_usuarios' también en /api/profile)

// --- RUTAS PRIVADAS (Requieren Token) ---
// (Esta parte usa la lógica correcta de bearerAuth)

app.use(
  '/api/*',
  bearerAuth({
    verifyToken: async (token: string, c: Context<Env>) => {
      try {
        // --- CORRECCIÓN 2: Usamos nuestro tipo 'MyJWTPayload' ---
        // Le decimos a 'verify' que esperamos un payload con esa forma.
        const payload = await verify(token, c.env.JWT_SECRET) as MyJWTPayload;
        // --- Fin Corrección 2 ---

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

// Esta ruta funciona porque 'c.var.jwtPayload' está bien tipado
app.get('/api/profile', async (c) => {
  const payload = c.var.jwtPayload;
  const rut = payload.sub; // TypeScript sabe que 'sub' existe

  const user = await c.env.base_de_usuarios.prepare("SELECT rut, nombrePaciente, fechaNacimiento, idGenero, mail, telefono FROM paciente WHERE rut = ?")
    .bind(rut)
    .first();

  return c.json({
    message: `Hola! Esta es tu información de perfil (protegida).`,
    user: user
  });
});

export default app