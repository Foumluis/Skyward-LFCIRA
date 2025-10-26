// agente_snabb_interactivo.js - Versión mejorada con completado de datos robusto
import puppeteer from "@cloudflare/puppeteer";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const N = (s) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// ============================================
// FUNCIÓN PRINCIPAL: BUSCAR HORAS DISPONIBLES
// ============================================
export async function agendarCitaCompleta(env, datosUsuario, parametros) {
  const { servicio, especialidad, ubicacion } = parametros;
  
  let browser;
  let page;
  
  try {
    console.log("🚀 Iniciando browser con Cloudflare Puppeteer...");
    
    browser = await puppeteer.launch(env.MY_BROWSER);
    page = await browser.newPage();
    page.setDefaultTimeout(25000);
    
    const url = "https://agenda.redsalud.cl/patientPortal/identifyPatient";
    console.log("🌐 Navegando a:", url);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await sleep(2000);

    // PASO 1: IDENTIFICAR PACIENTE
    console.log("\n🔍 PASO 1: IDENTIFICAR PACIENTE");
    await identificarPaciente(page, datosUsuario.rut);

    // PASO 2: SELECCIONAR SERVICIO
    console.log("\n🏥 PASO 2: SELECCIONAR SERVICIO");
    await seleccionarServicio(page, servicio);

    // PASO 3: BUSCAR ESPECIALIDAD Y UBICACIÓN
    console.log("\n🔎 PASO 3: BUSCAR ESPECIALIDAD Y UBICACIÓN");
    await buscarEspecialidad(page, especialidad, ubicacion);

    // PASO 4: ESPERAR HORAS DISPONIBLES
    console.log("\n📅 PASO 4: VERIFICANDO HORAS DISPONIBLES");
    
    const horasCargadas = await page.waitForFunction(() => {
      const toText = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
      const buttons = Array.from(document.querySelectorAll("button.MuiButton-root"));
      return buttons.some((btn) => {
        const t = toText(btn);
        return /Reservar/i.test(t) && /\d{2}:\d{2}/.test(t) && !/HORAS/i.test(t) && !/ESTE DIA/i.test(t);
      });
    }, { timeout: 30000 }).then(() => true).catch(() => false);

    if (!horasCargadas) {
      const screenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
      await browser.close();
      
      return {
        status: 'no_disponible',
        message: 'No hay horas disponibles para esta búsqueda.',
        screenshot
      };
    }

    console.log("✅ Horas disponibles detectadas");
    await sleep(2000);

    // EXTRAER FECHAS Y HORAS
    const opciones = await obtenerOpcionesDisponibles(page);
    
    if (!opciones.fechas.length || !opciones.horas.length) {
      const screenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
      await browser.close();
      
      return {
        status: 'no_disponible',
        message: 'No se pudieron extraer las opciones disponibles.',
        screenshot
      };
    }

    const screenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
    console.log("📸 Screenshot con opciones capturado");
    await browser.close();

    return {
      status: 'opciones_disponibles',
      opciones,
      screenshot,
      estado: { especialidad, ubicacion, servicio }
    };

  } catch (error) {
    console.error("💥 Error:", error);
    
    let errorScreenshot = null;
    if (page) {
      try {
        errorScreenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
      } catch (e) {
        console.log("No se pudo capturar screenshot del error");
      }
    }
    
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    
    return {
      status: 'error',
      message: error.message,
      screenshot: errorScreenshot
    };
  }
}

// ============================================
// FUNCIÓN PARA CONFIRMAR RESERVA
// ============================================
export async function confirmarCita(env, estado, fecha, hora, datosUsuario) {
  let browser;
  let page;
  
  try {
    console.log("🔄 Iniciando nueva sesión para confirmación...");
    browser = await puppeteer.launch(env.MY_BROWSER);
    page = await browser.newPage();
    page.setDefaultTimeout(25000);
    
    const url = "https://agenda.redsalud.cl/patientPortal/identifyPatient";
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await sleep(2000);

    // Re-ejecutar pasos 1-3
    console.log("🔍 Re-ejecutando identificación...");
    await identificarPaciente(page, datosUsuario.rut);
    
    console.log("🏥 Re-seleccionando servicio...");
    await seleccionarServicio(page, estado.servicio);
    
    console.log("🔎 Re-buscando especialidad...");
    await buscarEspecialidad(page, estado.especialidad, estado.ubicacion);

    // Esperar horas
    await page.waitForFunction(() => {
      const toText = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
      const buttons = Array.from(document.querySelectorAll("button.MuiButton-root"));
      return buttons.some((btn) => {
        const t = toText(btn);
        return /Reservar/i.test(t) && /\d{2}:\d{2}/.test(t) && !/HORAS/i.test(t) && !/ESTE DIA/i.test(t);
      });
    }, { timeout: 30000 });

    await sleep(2000);

    // SELECCIONAR FECHA
    console.log(`📅 Seleccionando fecha: "${fecha}"`);
    await seleccionarFecha(page, fecha);

    // SELECCIONAR HORA
    console.log(`🕐 Seleccionando hora: "${hora}"`);
    await seleccionarHora(page, hora);

    // ACEPTAR TÉRMINOS
    console.log("✏️ Aceptando términos...");
    await aceptarTerminos(page);

    // COMPLETAR DATOS
    console.log("📝 Completando datos de contacto...");
    await completarDatos(page, datosUsuario);

    // RESERVAR
    console.log("✅ Haciendo clic en RESERVAR HORA...");
    await reservarHora(page);

    const screenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
    await browser.close();

    return {
      status: 'success',
      message: '🎉 ¡Reserva completada exitosamente!',
      screenshot,
      datos: { especialidad: estado.especialidad, fecha, hora }
    };

  } catch (error) {
    console.error("💥 Error en confirmación:", error);
    
    let errorScreenshot = null;
    if (page) {
      try {
        errorScreenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
      } catch (e) {
        console.log("No se pudo capturar screenshot del error");
      }
    }
    
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    
    return {
      status: 'error',
      message: error.message,
      screenshot: errorScreenshot
    };
  }
}

// ============================================
// FUNCIONES AUXILIARES
// ============================================

async function identificarPaciente(page, rut) {
  console.log("📋 Buscando dropdown de tipo de documento...");

  const openSelectCandidates = [
    "[role='button'][aria-haspopup='listbox']",
    ".MuiSelect-select",
    ".MuiFormControl-root .MuiOutlinedInput-root",
    "div[role='button']",
    "[id*='select']"
  ];

  let opened = false;
  for (const sel of openSelectCandidates) {
    const el = await page.$(sel);
    if (el) {
      console.log(`✅ Encontrado selector: ${sel}`);
      await el.click();
      opened = true;
      await sleep(800);
      break;
    }
  }

  if (!opened) {
    throw new Error("No se pudo abrir el dropdown de tipo de documento");
  }

  // Seleccionar "Carnet de Identidad"
  const picked = await page.evaluate(() => {
    const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
    const items = Array.from(document.querySelectorAll("[role='option'], li[role='option'], .MuiMenuItem-root"));
    const el = items.find(e => {
      if (e.offsetParent === null) return false;
      const txt = N(e.textContent || "");
      return txt.includes("carnet");
    });
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.click();
      return el.textContent.trim();
    }
    return null;
  });

  if (!picked) {
    throw new Error("No se pudo seleccionar 'Carnet de Identidad'");
  }

  console.log(`✅ Opción seleccionada: "${picked}"`);
  await sleep(1000);

  // Escribir RUT
  console.log("✏️ Escribiendo número de documento...");
  const inputCandidates = [
    "input[name='documentNumber']",
    "#rut",
    "input[placeholder*='RUT']",
    "input[type='text'].MuiInputBase-input"
  ];

  let typed = false;
  for (const sel of inputCandidates) {
    const el = await page.$(sel);
    if (el) {
      const isVisible = await page.evaluate(e => {
        const style = window.getComputedStyle(e);
        return style.display !== 'none' && style.visibility !== 'hidden' && e.offsetParent !== null;
      }, el);

      if (isVisible) {
        await el.click();
        await sleep(300);
        await el.type(rut, { delay: 18 });
        console.log(`✅ RUT escrito: ${rut}`);
        typed = true;
        await sleep(500);
        break;
      }
    }
  }

  if (!typed) {
    throw new Error("No se pudo escribir el RUT");
  }

  // Hacer clic en CONTINUAR
  console.log("⏳ Esperando habilitar botón Continuar...");
  
  let clicked = false;
  for (let i = 0; i < 20 && !clicked; i++) {
    clicked = await page.evaluate(() => {
      const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
      const btns = Array.from(document.querySelectorAll("button,[role='button']"));
      const b = btns.find(e => N(e.textContent || "").includes("continuar"));
      if (b && !b.disabled) { b.click(); return true; }
      return false;
    });

    if (!clicked) {
      await sleep(500);
    }
  }

  if (!clicked) {
    throw new Error("CONTINUAR no se habilitó");
  }

  console.log("✅ CONTINUAR pulsado");
  await sleep(3000);
}

async function seleccionarServicio(page, servicio) {
  console.log("⏳ Esperando tarjetas de servicio...");
  await page.waitForSelector('.MuiCard-root', { timeout: 10000 });
  await sleep(1500);

  const servicioClicked = await page.evaluate((srv) => {
    const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
    const typographies = Array.from(document.querySelectorAll('.MuiTypography-root'));
    const targetTypo = typographies.find(t => N(t.textContent) === N(srv));
    if (targetTypo) {
      const cardButton = targetTypo.closest('button.MuiCardActionArea-root') ||
                         targetTypo.closest('.MuiCard-root')?.closest('button');
      if (cardButton) {
        cardButton.scrollIntoView({ behavior: "smooth", block: "center" });
        cardButton.click();
        return targetTypo.textContent.trim();
      }
    }
    return null;
  }, servicio);

  if (!servicioClicked) {
    throw new Error(`No se pudo seleccionar el servicio: "${servicio}"`);
  }

  console.log(`✅ Servicio seleccionado: "${servicioClicked}"`);
  await sleep(3000);
}

async function buscarEspecialidad(page, especialidad, ubicacion) {
  console.log("⏳ Esperando campos de búsqueda...");
  await page.waitForSelector('input#filterService', { timeout: 10000 });
  await sleep(1500);

  // Especialidad
  console.log(`✏️ Escribiendo especialidad: "${especialidad}"`);
  const especialidadInput = await page.$('input#filterService');
  if (especialidadInput) {
    await especialidadInput.click();
    await sleep(300);
    await especialidadInput.type(especialidad, { delay: 100 });
    console.log(`✅ Especialidad escrita`);
    await sleep(800);

    try {
      await page.waitForSelector('[role="option"]', { timeout: 3000 });
      await sleep(500);
      await page.evaluate(() => {
        const opciones = Array.from(document.querySelectorAll('[role="option"]'));
        if (opciones.length > 0) opciones[0].click();
      });
    } catch {
      console.log("ℹ️ No aparecieron sugerencias de especialidad");
    }
    await sleep(500);
  }

  // Ubicación
  console.log(`📍 Escribiendo ubicación: "${ubicacion}"`);
  const regionInput = await page.$('input#filterLocation');
  if (regionInput) {
    await regionInput.click();
    await sleep(300);
    await regionInput.type(ubicacion, { delay: 100 });
    console.log(`✅ Ubicación escrita`);
    await sleep(800);

    try {
      await page.waitForSelector('[role="option"]', { timeout: 3000 });
      await sleep(500);
      await page.evaluate(() => {
        const opciones = Array.from(document.querySelectorAll('[role="option"]'));
        if (opciones.length > 0) opciones[0].click();
      });
    } catch {
      console.log("ℹ️ No aparecieron sugerencias de ubicación");
    }
    await sleep(500);
  }

  // Hacer clic en BUSCAR HORAS
  console.log("🔎 Buscando botón BUSCAR HORAS...");
  await sleep(1000);
  const buscarClicked = await page.evaluate(() => {
    const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
    const btns = Array.from(document.querySelectorAll("button"));
    const btn = btns.find(b => N(b.textContent).includes("buscar horas"));
    if (btn && !btn.disabled) {
      btn.scrollIntoView({ behavior: "smooth", block: "center" });
      btn.click();
      return true;
    }
    return false;
  });

  if (!buscarClicked) {
    throw new Error("No se pudo hacer clic en BUSCAR HORAS");
  }

  console.log("✅ BUSCAR HORAS pulsado");
  await sleep(4000);
}

async function obtenerOpcionesDisponibles(page) {
  await page.waitForSelector('.MuiBox-root', { timeout: 10000 });
  await sleep(2000);

  // Extraer fechas
  const fechas = await page.evaluate(() => {
    const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
    const fechaBoxes = Array.from(document.querySelectorAll('.MuiBox-root'));
    const result = [];
    
    for (const box of fechaBoxes) {
      const textos = Array.from(box.querySelectorAll('p.MuiTypography-root'));
      const textoCompleto = textos.map(t => t.textContent.trim()).join(' ');
      
      // Filtrar elementos válidos
      if (textoCompleto.includes('Sin Horas') || 
          textoCompleto.includes('Clínica') ||
          textoCompleto.includes('RedSalud') ||
          textoCompleto.includes('Profesional') ||
          !textoCompleto.match(/\d+/)) {
        continue;
      }
      
      result.push(textoCompleto);
    }
    
    return result
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 5);
  });

  // Extraer horas
  const horas = await page.evaluate(() => {
    const toText = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
    const buttons = Array.from(document.querySelectorAll("button.MuiButton-root"));
    const result = [];
    
    for (const btn of buttons) {
      const texto = toText(btn);
      if (!/Reservar/i.test(texto)) continue;
      if (/HORAS/i.test(texto) || /ESTE DIA/i.test(texto)) continue;
      
      const match = texto.match(/(\d{2}:\d{2})/);
      if (match) result.push(match[1]);
    }
    
    const toMin = (t) => {
      const [hh, mm] = t.split(":").map(Number);
      return hh * 60 + mm;
    };
    
    return Array.from(new Set(result))
      .sort((a, b) => toMin(a) - toMin(b))
      .slice(0, 10);
  });

  console.log(`📊 Extraídas ${fechas.length} fechas y ${horas.length} horas`);

  return { fechas, horas };
}

async function seleccionarFecha(page, fecha) {
  const fechaClicked = await page.evaluate((f) => {
    const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
    const fechaBoxes = Array.from(document.querySelectorAll('.MuiBox-root'));
    
    for (const box of fechaBoxes) {
      const textos = Array.from(box.querySelectorAll('p.MuiTypography-root'));
      const textoCompleto = textos.map(t => N(t.textContent)).join(' ');
      
      if (textoCompleto.includes(N(f)) && !textoCompleto.includes('sin horas')) {
        box.scrollIntoView({ behavior: "smooth", block: "center" });
        box.click();
        return textos.map(t => t.textContent.trim()).join(' ');
      }
    }
    return null;
  }, fecha);

  if (!fechaClicked) {
    throw new Error(`No se pudo seleccionar la fecha: "${fecha}"`);
  }

  console.log(`✅ Fecha seleccionada: "${fechaClicked}"`);
  await sleep(3000);
}

async function seleccionarHora(page, hora) {
  const clickedHour = await page.evaluate((t) => {
    const toText = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
    const buttons = Array.from(document.querySelectorAll('button.MuiButton-root'));
    
    for (const btn of buttons) {
      const texto = toText(btn);
      if (/Reservar/i.test(texto) && texto.includes(t)) {
        if (!/HORAS/i.test(texto) && !/ESTE DIA/i.test(texto)) {
          btn.scrollIntoView({ behavior: "smooth", block: "center" });
          btn.click();
          return true;
        }
      }
    }
    return false;
  }, hora);

  if (!clickedHour) {
    throw new Error(`No se pudo seleccionar la hora: "${hora}"`);
  }

  console.log(`✅ Hora seleccionada: "${hora}"`);
  await sleep(2000);
}

async function aceptarTerminos(page) {
  try {
    await page.waitForSelector('button[type="submit"]', { timeout: 8000 });
    await sleep(1000);
    
    const aceptoClicked = await page.evaluate(() => {
      const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
      const buttons = Array.from(document.querySelectorAll('button[type="submit"], button'));
      const btnAcepto = buttons.find(btn => N(btn.textContent) === 'acepto');
      if (btnAcepto) {
        btnAcepto.scrollIntoView({ behavior: "smooth", block: "center" });
        btnAcepto.click();
        return true;
      }
      return false;
    });
    
    if (aceptoClicked) {
      console.log("✅ ACEPTO pulsado");
      await sleep(3000);
    }
  } catch {
    console.log("ℹ️ No apareció modal de términos");
  }
}

// ✅ FUNCIÓN MEJORADA: completarDatos
async function completarDatos(page, datos) {
  console.log("\n📝 === COMPLETANDO DATOS DE CONTACTO ===");
  await sleep(2000);

  // 1. TELÉFONO
  if (datos.telefono) {
    console.log(`📱 Completando teléfono: ${datos.telefono}`);
    try {
      const telefonoLimpio = datos.telefono.replace(/\D/g, '').slice(-9);
      
      // Intentar múltiples selectores
      const telefonoSelectors = [
        'input[name="phoneNumber"]',
        'input[placeholder*="Teléfono"]',
        'input[placeholder*="telefono"]',
        'input[type="tel"]'
      ];
      
      let telefonoInput = null;
      for (const sel of telefonoSelectors) {
        telefonoInput = await page.$(sel);
        if (telefonoInput) {
          console.log(`✅ Input teléfono encontrado: ${sel}`);
          break;
        }
      }
      
      if (telefonoInput) {
        // Limpiar campo primero
        await telefonoInput.click({ clickCount: 3 });
        await sleep(200);
        await page.keyboard.press('Backspace');
        await sleep(300);
        
        // Escribir nuevo valor
        await telefonoInput.type(telefonoLimpio, { delay: 80 });
        console.log(`✅ Teléfono completado: ${telefonoLimpio}`);
        await sleep(800);
      } else {
        console.log("⚠️ No se encontró input de teléfono");
      }
    } catch (e) {
      console.log("⚠️ Error al completar teléfono:", e.message);
    }
  }

  // 2. EMAIL (CRÍTICO)
  if (datos.email) {
    console.log(`📧 Completando email: ${datos.email}`);
    try {
      // Intentar múltiples selectores y estrategias
      const emailSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[placeholder*="correo"]',
        'input[placeholder*="Correo"]',
        'input[placeholder*="email"]'
      ];
      
      let emailInput = null;
      for (const sel of emailSelectors) {
        emailInput = await page.$(sel);
        if (emailInput) {
          console.log(`✅ Input email encontrado: ${sel}`);
          break;
        }
      }
      
      if (emailInput) {
        // Estrategia 1: Focus + Select All + Type
        await emailInput.click();
        await sleep(300);
        
        // Seleccionar todo el texto
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await sleep(200);
        
        // Borrar
        await page.keyboard.press('Backspace');
        await sleep(300);
        
        // Escribir nuevo email
        await emailInput.type(datos.email, { delay: 80 });
        console.log(`✅ Email escrito: ${datos.email}`);
        await sleep(800);
        
        // Verificar que se escribió correctamente
        const valorActual = await page.evaluate(el => el.value, emailInput);
        console.log(`🔍 Valor actual del email: "${valorActual}"`);
        
        if (valorActual !== datos.email) {
          console.log("⚠️ El email no coincide, intentando método alternativo...");
          
          // Método alternativo: usar evaluate para forzar el valor
          await page.evaluate((el, val) => {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, emailInput, datos.email);
          
          await sleep(500);
          console.log("✅ Email forzado mediante JavaScript");
        }
        
      } else {
        console.log("❌ No se encontró input de email");
      }
    } catch (e) {
      console.log("❌ Error al completar email:", e.message);
    }
  }

  // 3. CHECKBOX DE TÉRMINOS (CRÍTICO) - Material-UI específico
  console.log("\n☑️ Buscando y marcando checkbox de términos...");
  await sleep(1000);
  
  try {
    const checkboxMarcado = await page.evaluate(() => {
      // Buscar checkbox específico de Material-UI
      const checkboxSelectors = [
        'input.PrivateSwitchBase-input[type="checkbox"]',
        'input.css-1m9pwf3[type="checkbox"]',
        'input[type="checkbox"]'
      ];
      
      let checkbox = null;
      for (const sel of checkboxSelectors) {
        const found = document.querySelector(sel);
        if (found && found.offsetParent !== null) {
          checkbox = found;
          console.log(`✓ Checkbox encontrado con selector: ${sel}`);
          break;
        }
      }
      
      if (!checkbox) {
        console.log("✗ No se encontró checkbox visible");
        return 0;
      }
      
      // Verificar si ya está marcado
      if (checkbox.checked) {
        console.log("✓ Checkbox ya está marcado");
        return 1;
      }
      
      console.log("→ Intentando marcar checkbox...");
      
      // ESTRATEGIA 1: Click en el span.MuiButtonBase-root más cercano
      const muiButton = checkbox.closest('span.MuiButtonBase-root');
      if (muiButton) {
        console.log("→ Método 1: Click en MuiButtonBase-root");
        muiButton.scrollIntoView({ behavior: "smooth", block: "center" });
        muiButton.click();
        
        // Verificar si funcionó
        if (checkbox.checked) {
          console.log("✓ Método 1 exitoso");
          return 1;
        }
      }
      
      // ESTRATEGIA 2: Click en cualquier span padre
      const spanParent = checkbox.closest('span');
      if (spanParent && !checkbox.checked) {
        console.log("→ Método 2: Click en span padre");
        spanParent.click();
        
        if (checkbox.checked) {
          console.log("✓ Método 2 exitoso");
          return 1;
        }
      }
      
      // ESTRATEGIA 3: Disparar evento click programáticamente
      if (!checkbox.checked) {
        console.log("→ Método 3: Evento click programático");
        checkbox.click();
        
        // También disparar evento change
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        
        if (checkbox.checked) {
          console.log("✓ Método 3 exitoso");
          return 1;
        }
      }
      
      // ESTRATEGIA 4: Forzar el valor checked
      if (!checkbox.checked) {
        console.log("→ Método 4: Forzar checked = true");
        checkbox.checked = true;
        
        // Disparar eventos necesarios para Material-UI
        checkbox.dispatchEvent(new Event('input', { bubbles: true }));
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        
        if (checkbox.checked) {
          console.log("✓ Método 4 exitoso");
          return 1;
        }
      }
      
      console.log("✗ Ningún método funcionó");
      return 0;
    });
    
    console.log(`📊 Resultado: ${checkboxMarcado} checkbox(es) marcado(s)`);
    await sleep(1500);
    
    // Verificar estado final
    const estadoFinal = await page.evaluate(() => {
      const cb = document.querySelector('input.PrivateSwitchBase-input[type="checkbox"]') ||
                 document.querySelector('input[type="checkbox"]');
      
      if (cb) {
        return {
          checked: cb.checked,
          visible: cb.offsetParent !== null,
          disabled: cb.disabled,
          clases: cb.className
        };
      }
      
      return { encontrado: false };
    });
    
    console.log("📊 Estado final del checkbox:", JSON.stringify(estadoFinal));
    
    // Si todavía no está marcado, intentar con Puppeteer directamente
    if (estadoFinal.encontrado && !estadoFinal.checked) {
      console.log("🔄 Último intento con Puppeteer...");
      
      const checkboxElement = await page.$('input.PrivateSwitchBase-input[type="checkbox"]') ||
                              await page.$('input[type="checkbox"]');
      
      if (checkboxElement) {
        await checkboxElement.click();
        await sleep(500);
        
        const verificacion = await page.evaluate(() => {
          const cb = document.querySelector('input[type="checkbox"]');
          return cb ? cb.checked : false;
        });
        
        console.log(`📊 Verificación final: ${verificacion ? "✅ MARCADO" : "❌ NO MARCADO"}`);
      }
    }
    
  } catch (e) {
    console.log("⚠️ Error al marcar checkbox:", e.message);
  }
  
  console.log("✅ === DATOS COMPLETADOS ===\n");
  await sleep(1000);
}

// ✅ FUNCIÓN MEJORADA: reservarHora
async function reservarHora(page) {
  console.log("\n🎯 === INTENTANDO RESERVAR HORA ===");
  await sleep(2000);
  
  try {
    // Verificar que el botón esté habilitado
    const botonInfo = await page.evaluate(() => {
      const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
      
      // Buscar botón con múltiples estrategias
      const strategies = [
        // Estrategia 1: Por clase específica
        () => document.querySelector('button.MuiButton-colorPrimary[style*="background: rgb(0, 138, 138)"]'),
        // Estrategia 2: Por texto "RESERVAR HORA"
        () => Array.from(document.querySelectorAll('button')).find(btn => N(btn.textContent) === 'reservar hora'),
        // Estrategia 3: Por clase MuiButton con el estilo específico
        () => Array.from(document.querySelectorAll('button.MuiButton-root')).find(btn => {
          const style = window.getComputedStyle(btn);
          return style.backgroundColor === 'rgb(0, 138, 138)' && N(btn.textContent) === 'reservar hora';
        })
      ];
      
      let btnReservar = null;
      for (let i = 0; i < strategies.length; i++) {
        btnReservar = strategies[i]();
        if (btnReservar) {
          console.log(`✓ Botón encontrado con estrategia ${i + 1}`);
          break;
        }
      }
      
      if (btnReservar) {
        return {
          encontrado: true,
          disabled: btnReservar.disabled,
          visible: btnReservar.offsetParent !== null,
          texto: btnReservar.textContent.trim(),
          cursor: window.getComputedStyle(btnReservar).cursor,
          background: window.getComputedStyle(btnReservar).backgroundColor
        };
      }
      
      return { encontrado: false };
    });
    
    console.log("📊 Estado del botón RESERVAR HORA:", JSON.stringify(botonInfo));
    
    if (!botonInfo.encontrado) {
      throw new Error("No se encontró el botón RESERVAR HORA");
    }
    
    if (botonInfo.disabled || botonInfo.cursor !== 'pointer') {
      console.log("⚠️ El botón está deshabilitado o no clickeable. Verificando requisitos...");
      
      // Verificar qué falta
      const diagnostico = await page.evaluate(() => {
        const checkbox = document.querySelector('input.PrivateSwitchBase-input[type="checkbox"]') ||
                        document.querySelector('input[type="checkbox"]');
        const emailInput = document.querySelector('input[type="email"]');
        const telefonoInput = document.querySelector('input[name="phoneNumber"]');
        
        return {
          checkbox: checkbox ? { checked: checkbox.checked, visible: checkbox.offsetParent !== null } : null,
          email: emailInput ? { value: emailInput.value, filled: emailInput.value.length > 0 } : null,
          telefono: telefonoInput ? { value: telefonoInput.value, filled: telefonoInput.value.length > 0 } : null
        };
      });
      
      console.log("🔍 Diagnóstico de campos:", JSON.stringify(diagnostico));
      
      // Intentar marcar checkbox nuevamente si no está marcado
      if (diagnostico.checkbox && !diagnostico.checkbox.checked) {
        console.log("🔄 Intentando marcar checkbox nuevamente...");
        
        await page.evaluate(() => {
          const checkbox = document.querySelector('input.PrivateSwitchBase-input[type="checkbox"]') ||
                          document.querySelector('input[type="checkbox"]');
          
          if (checkbox && !checkbox.checked) {
            // Intentar click en el span padre
            const spanParent = checkbox.closest('span.MuiButtonBase-root') || checkbox.closest('span');
            if (spanParent) {
              spanParent.click();
            } else {
              checkbox.checked = true;
              checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        });
        
        await sleep(1500);
        console.log("✅ Reintento de checkbox completado");
      }
    }
    
    // Intentar hacer clic en el botón
    console.log("🖱️ Haciendo clic en RESERVAR HORA...");
    await sleep(1000);
    
    const reservarClicked = await page.evaluate(() => {
      const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
      
      // Buscar el botón
      let btnReservar = document.querySelector('button.MuiButton-colorPrimary[style*="background: rgb(0, 138, 138)"]');
      
      if (!btnReservar) {
        btnReservar = Array.from(document.querySelectorAll('button')).find(btn => 
          N(btn.textContent) === 'reservar hora'
        );
      }
      
      if (btnReservar) {
        console.log("→ Botón encontrado, ejecutando click...");
        
        // Scroll al botón
        btnReservar.scrollIntoView({ behavior: "smooth", block: "center" });
        
        // Método 1: Click normal
        btnReservar.click();
        console.log("→ Click normal ejecutado");
        
        // Método 2: Evento MouseEvent
        btnReservar.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window
        }));
        console.log("→ MouseEvent ejecutado");
        
        // Método 3: Evento PointerEvent (Material-UI a veces lo usa)
        btnReservar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        btnReservar.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        console.log("→ PointerEvent ejecutado");
        
        return true;
      }
      
      console.log("✗ No se encontró el botón");
      return false;
    });

    if (!reservarClicked) {
      throw new Error("No se pudo hacer clic en RESERVAR HORA");
    }

    console.log("✅ Click ejecutado en RESERVAR HORA");
    await sleep(5000); // Esperar respuesta del servidor
    
    // Verificar si apareció mensaje de éxito o error
    const resultado = await page.evaluate(() => {
      const bodyText = document.body.textContent || "";
      
      if (bodyText.includes('exitosa') || 
          bodyText.includes('confirmada') || 
          bodyText.includes('éxito') ||
          bodyText.includes('correctamente')) {
        return { success: true, message: 'Reserva exitosa detectada' };
      }
      
      if (bodyText.includes('error') || 
          bodyText.includes('falló') ||
          bodyText.includes('no se pudo')) {
        return { success: false, message: 'Error detectado en la reserva' };
      }
      
      // Buscar elementos de confirmación de Material-UI
      const successElements = document.querySelectorAll('.MuiAlert-standardSuccess, .MuiSnackbar-root');
      if (successElements.length > 0) {
        return { success: true, message: 'Elemento de éxito detectado' };
      }
      
      return { success: null, message: 'Estado desconocido' };
    });
    
    console.log("📊 Resultado de la reserva:", JSON.stringify(resultado));
    
    if (resultado.success === false) {
      throw new Error(resultado.message);
    }
    
    console.log("✅ === RESERVA COMPLETADA ===\n");
    
  } catch (error) {
    console.error("❌ Error en reservarHora:", error.message);
    throw error;
  }
}