// puppeteer-server.js
// Servidor Node.js que recibe peticiones del backend de Cloudflare
// y ejecuta el script de Puppeteer para agendar en RedSalud

import express from 'express';
import cors from 'cors';
import { reservarHora } from './agente_snabb_real.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Log de todas las peticiones
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Endpoint de salud
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Puppeteer Server is running',
    timestamp: new Date().toISOString(),
    nodeVersion: process.version
  });
});

// Endpoint principal para agendar hora
app.post('/agendar', async (req, res) => {
  console.log('\n📥 Nueva solicitud de agendamiento recibida');
  console.log('📦 Datos recibidos:', JSON.stringify(req.body, null, 2));

  const { rut, nombreCompleto, telefono, email, especialidad, fecha, medico } = req.body;

  // Validación de datos requeridos
  if (!rut || !nombreCompleto || !especialidad || !fecha) {
    console.error('❌ Faltan datos requeridos');
    return res.status(400).json({ 
      error: 'Faltan datos requeridos',
      required: ['rut', 'nombreCompleto', 'especialidad', 'fecha']
    });
  }

  try {
    // Parsear fecha ISO a componentes
    const fechaObj = new Date(fecha);
    const dia = fechaObj.getDate().toString();
    const hora = fechaObj.toTimeString().slice(0, 5); // HH:MM

    console.log(`📅 Procesando agendamiento para: ${nombreCompleto}`);
    console.log(`   RUT: ${rut}`);
    console.log(`   Especialidad: ${especialidad}`);
    console.log(`   Fecha: ${dia} a las ${hora}`);

    // Responder inmediatamente al backend
    res.json({ 
      success: true, 
      message: 'Agendamiento en proceso',
      data: {
        rut,
        especialidad,
        fecha: fechaObj.toLocaleString('es-CL')
      }
    });

    // Ejecutar Puppeteer en segundo plano (no bloqueante)
    console.log('🤖 Iniciando Puppeteer...');
    
    reservarHora({
      tipoDocumento: "Carnet de Identidad",
      numeroDocumento: rut,
      servicio: "Consultas",
      especialidad: especialidad,
      region: "Providencia",
      fecha: dia,
      medico: medico || null,
      hora: hora,
      telefono: telefono || null,
      email: email || null,
      headless: true // Siempre headless en producción
    }).then(() => {
      console.log(`✅ Agendamiento completado exitosamente para ${nombreCompleto}`);
    }).catch((error) => {
      console.error(`❌ Error en Puppeteer para ${nombreCompleto}:`, error.message);
    });

  } catch (error) {
    console.error('💥 Error procesando solicitud:', error);
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Error al procesar el agendamiento',
        details: error.message 
      });
    }
  }
});

// Endpoint para consultar el estado de un agendamiento (opcional)
app.get('/status/:rut', (req, res) => {
  res.json({ 
    message: 'Endpoint de estado en desarrollo',
    rut: req.params.rut
  });
});

// Manejador de errores global
app.use((err, req, res, next) => {
  console.error('💥 Error no manejado:', err);
  res.status(500).json({ 
    error: 'Error interno del servidor',
    message: err.message 
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`\n🚀 Puppeteer Server corriendo en puerto ${PORT}`);
  console.log(`📍 Endpoint principal: /agendar`);
  console.log(`🏥 Endpoint de salud: /health`);
  console.log(`🐛 Node version: ${process.version}\n`);
});

export default app;