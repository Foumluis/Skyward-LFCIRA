// agente_snabb_interactivo.js
// Usar Cloudflare Puppeteer correctamente

import puppeteer from "@cloudflare/puppeteer";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function agendarCitaCompleta(env, datosUsuario, parametros) {
  const { servicio, especialidad, ubicacion } = parametros;
  
  let browser;
  let page;
  
  try {
    console.log("🚀 Iniciando browser con Cloudflare Puppeteer...");
    
    browser = await puppeteer.launch(env.MY_BROWSER);
    page = await browser.newPage();
    
    // Aumentar timeout a 60 segundos
    page.setDefaultTimeout(60000);
    
    const url = "https://agenda.redsalud.cl/patientPortal/identifyPatient";
    console.log("🌐 Navegando a:", url);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await sleep(2000);
    
    console.log("📝 PASO 1: Identificación");
    let screenshot = await page.screenshot({ encoding: 'base64' });
    console.log("📸 Screenshot después de cargar página");
    
    await identificarPaciente(page, datosUsuario.rut);
    screenshot = await page.screenshot({ encoding: 'base64' });
    console.log("📸 Screenshot después de identificación");
    
    console.log("🏥 PASO 2: Seleccionar servicio");
    await seleccionarServicio(page, servicio);
    screenshot = await page.screenshot({ encoding: 'base64' });
    console.log("📸 Screenshot después de seleccionar servicio");
    
    console.log("🔍 PASO 3: Buscar especialidad");
    await buscarEspecialidad(page, especialidad, ubicacion);
    screenshot = await page.screenshot({ encoding: 'base64' });
    console.log("📸 Screenshot después de buscar especialidad");
    
    console.log("📅 PASO 4: Obtener opciones disponibles");
    
    const horasCargadas = await page.waitForFunction(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      return buttons.some(btn => /Reservar/i.test(btn.textContent) && /\d{2}:\d{2}/.test(btn.textContent));
    }, { timeout: 45000 }).then(() => true).catch(() => false);
    
    if (!horasCargadas) {
      screenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
      await browser.close();
      
      return {
        status: 'no_disponible',
        message: 'No hay horas disponibles para esta búsqueda.',
        screenshot
      };
    }
    
    await sleep(2000);
    const opciones = await obtenerOpcionesDisponibles(page);
    
    if (!opciones.fechas.length || !opciones.horas.length) {
      screenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
      await browser.close();
      
      return {
        status: 'no_disponible',
        message: 'No hay horas disponibles para esta búsqueda.',
        screenshot
      };
    }
    
    screenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
    console.log("📸 Screenshot final con opciones disponibles");
    await browser.close();
    
    return {
      status: 'opciones_disponibles',
      opciones,
      screenshot,
      estado: {
        especialidad,
        ubicacion,
        servicio
      }
    };
    
  } catch (error) {
    console.error("💥 Error:", error);
    
    // Capturar screenshot del error
    let errorScreenshot = null;
    if (page) {
      try {
        errorScreenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
        console.log("📸 Screenshot del error capturado");
      } catch (e) {
        console.log("No se pudo capturar screenshot del error");
      }
    }
    
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    
    // Re-lanzar el error con el screenshot
    const enhancedError = new Error(error.message);
    enhancedError.screenshot = errorScreenshot;
    throw enhancedError;
  }
}

export async function confirmarCita(env, estado, fecha, hora, datosUsuario) {
  let browser;
  let page;
  
  try {
    console.log("🔄 Iniciando nueva sesión de browser para confirmación...");
    browser = await puppeteer.launch(env.MY_BROWSER);
    page = await browser.newPage();
    page.setDefaultTimeout(25000);
    
    const url = "https://agenda.redsalud.cl/patientPortal/identifyPatient";
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await sleep(2000);
    
    console.log("🔁 Re-ejecutando proceso hasta selección...");
    await identificarPaciente(page, datosUsuario.rut);
    await seleccionarServicio(page, estado.servicio);
    await buscarEspecialidad(page, estado.especialidad, estado.ubicacion);
    
    await page.waitForFunction(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      return buttons.some(btn => /Reservar/i.test(btn.textContent) && /\d{2}:\d{2}/.test(btn.textContent));
    }, { timeout: 30000 });
    
    await sleep(2000);
    
    console.log("📅 Seleccionando fecha y hora...");
    await seleccionarFecha(page, fecha);
    await seleccionarHora(page, hora);
    
    console.log("✍️ Confirmando datos...");
    await confirmarDatos(page, datosUsuario);
    
    console.log("✅ Completando reserva...");
    await completarReserva(page);
    
    const screenshot = await page.screenshot({ encoding: 'base64' });
    await browser.close();
    
    return {
      status: 'success',
      message: '🎉 ¡Reserva completada exitosamente!',
      screenshot,
      datos: { especialidad: estado.especialidad, fecha, hora }
    };
    
  } catch (error) {
    console.error("💥 Error en confirmación:", error);
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    throw error;
  }
}

// ============================================
// FUNCIONES AUXILIARES
// ============================================

async function identificarPaciente(page, rut) {
  const sel = await page.$("[role='button'][aria-haspopup='listbox']");
  if (sel) await sel.click();
  await sleep(800);
  
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("[role='option']"));
    const item = items.find(e => e.textContent.includes("Carnet"));
    if (item) item.click();
  });
  await sleep(1000);
  
  const input = await page.$("input[name='documentNumber']");
  if (input) {
    await input.click();
    await input.type(rut, { delay: 50 });
  }
  await sleep(1000);
  
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const btn = btns.find(b => b.textContent.toLowerCase().includes("continuar"));
    if (btn) btn.click();
  });
  await sleep(3000);
}

async function seleccionarServicio(page, servicio) {
  await page.waitForSelector('.MuiCard-root');
  await sleep(1500);
  
  await page.evaluate((srv) => {
    const cards = Array.from(document.querySelectorAll('.MuiCard-root'));
    for (const card of cards) {
      if (card.textContent.toLowerCase().includes(srv.toLowerCase())) {
        card.click();
        break;
      }
    }
  }, servicio);
  await sleep(3000);
}

async function buscarEspecialidad(page, especialidad, ubicacion) {
  await page.waitForSelector('input#filterService');
  await sleep(1500);
  
  const espInput = await page.$('input#filterService');
  if (espInput) {
    await espInput.click();
    await espInput.type(especialidad, { delay: 100 });
    await sleep(800);
    
    await page.evaluate(() => {
      const opts = document.querySelectorAll('[role="option"]');
      if (opts[0]) opts[0].click();
    });
    await sleep(500);
  }
  
  const locInput = await page.$('input#filterLocation');
  if (locInput) {
    await locInput.click();
    await locInput.type(ubicacion, { delay: 100 });
    await sleep(800);
    
    await page.evaluate(() => {
      const opts = document.querySelectorAll('[role="option"]');
      if (opts[0]) opts[0].click();
    });
    await sleep(500);
  }
  
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const btn = btns.find(b => b.textContent.toLowerCase().includes("buscar"));
    if (btn) btn.click();
  });
}

async function obtenerOpcionesDisponibles(page) {
  await page.waitForSelector('.MuiBox-root', { timeout: 30000 });
  await sleep(2000);
  
  const fechas = await page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('.MuiBox-root'));
    return boxes
      .map(box => {
        const textos = Array.from(box.querySelectorAll('p'));
        const texto = textos.map(t => t.textContent.trim()).join(' ');
        if (!texto.includes('sin horas') && texto.match(/\d+/)) {
          return texto;
        }
      })
      .filter(Boolean)
      .slice(0, 5);
  });
  
  const horas = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns
      .filter(btn => /Reservar/.test(btn.textContent) && /\d{2}:\d{2}/.test(btn.textContent))
      .map(btn => btn.textContent.match(/\d{2}:\d{2}/)[0])
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort()
      .slice(0, 10);
  });
  
  return { fechas, horas };
}

async function seleccionarFecha(page, fecha) {
  await page.evaluate((f) => {
    const boxes = Array.from(document.querySelectorAll('.MuiBox-root'));
    for (const box of boxes) {
      const textos = Array.from(box.querySelectorAll('p'));
      const texto = textos.map(t => t.textContent).join(' ');
      if (texto.includes(f)) {
        box.click();
        break;
      }
    }
  }, fecha);
  await sleep(2000);
}

async function seleccionarHora(page, hora) {
  await page.evaluate((h) => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent.includes(h) && b.textContent.includes('Reservar'));
    if (btn) btn.click();
  }, hora);
  await sleep(2000);
}

async function confirmarDatos(page, datos) {
  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent.toLowerCase() === 'acepto');
      if (btn) btn.click();
    });
    await sleep(2000);
  } catch {}
  
  if (datos.telefono) {
    const telInput = await page.$('input[name="phoneNumber"]');
    if (telInput) {
      await telInput.click({ clickCount: 3 });
      await telInput.type(datos.telefono, { delay: 50 });
    }
  }
  
  if (datos.email) {
    const emailInput = await page.$('input[type="email"]');
    if (emailInput) {
      await emailInput.click({ clickCount: 3 });
      await emailInput.type(datos.email, { delay: 50 });
    }
  }
  
  await page.evaluate(() => {
    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    checkboxes.forEach(cb => {
      if (!cb.checked) {
        const parent = cb.closest('label') || cb.parentElement;
        if (parent) parent.click();
      }
    });
  });
  await sleep(1000);
}

async function completarReserva(page) {
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent.toLowerCase().includes('reservar hora'));
    if (btn) btn.click();
  });
  await sleep(3000);
}