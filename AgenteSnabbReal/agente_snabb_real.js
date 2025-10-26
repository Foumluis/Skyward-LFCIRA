import puppeteer from "puppeteer";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const N = (s) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Click por texto visible, robusto a cambios de clases/ids */
async function clickByText(page, text, timeout = 6000) {
  const target = N(text);
  const ok = await page.waitForFunction((t) => {
    const n = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
    const nodes = Array.from(document.querySelectorAll("button,[role='button'],a[href],.btn,.button,li,div"));
    return !!nodes.find(el => {
      const st = getComputedStyle(el);
      if (st.visibility === "hidden" || st.display === "none" || el.offsetParent === null) return false;
      const txt = n(el.textContent || "");
      return txt === n(t) || txt.includes(n(t));
    });
  }, { timeout }, target).catch(() => false);
  if (!ok) return false;

  const clicked = await page.evaluate((t) => {
    const n = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
    const nodes = Array.from(document.querySelectorAll("button,[role='button'],a[href],.btn,.button,li,div"));
    const el = nodes.find(node => {
      const st = getComputedStyle(node);
      if (st.visibility === "hidden" || st.display === "none" || node.offsetParent === null) return false;
      const txt = n(node.textContent || "");
      return txt === n(t) || txt.includes(n(t));
    });
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.click(); return true; }
    return false;
  }, target);
  if (clicked) { await sleep(300); return true; }
  return false;
}

/** Escribir en un input */
async function typeInto(page, selector, value, timeout = 8000) {
  await page.waitForSelector(selector, { timeout });
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, value, { delay: 18 });
  await sleep(150);
}

async function reservarHora({
  url = "https://agenda.redsalud.cl/patientPortal/identifyPatient",
  // PASO 1: Identificación
  tipoDocumento = "Carnet de Identidad",   // "Carnet de Identidad" | "Pasaporte"
  numeroDocumento = "21764574-3",
  // PASO 2: Servicio
  servicio = "Consultas",                   // "Consultas" | "Telemedicina"
  // PASO 3: Especialidad y Región
  especialidad = "Medicina General",        // Ej: "Medicina General", "Pediatría", etc.
  region = null,                            // Opcional: "Santiago", "Providencia", etc.
  // PASO 4: Día, Médico y Hora
  fecha = null,                             // Opcional: "27", "lunes", "28 martes", etc.
  medico = null,                            // Opcional: "Luis Jose", "Rodriguez", etc.
  hora = null,                              // Opcional: "09:15", "10:30", etc.
  // PASO 5: Datos de contacto
  telefono = null,                          // Opcional: "+56994123456"
  email = null                              // Opcional: "usuario@ejemplo.com"
} = {}) {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      "--start-maximized",
      "--disable-blink-features=AutomationControlled"
    ],
    ignoreHTTPSErrors: true
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(25000);

  try {
    console.log("🌐 Abriendo:", url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 0 });
    await sleep(2000);

    // ============================================
    // PASO 1: IDENTIFICAR PACIENTE
    // ============================================
    console.log("\n=== PASO 1: IDENTIFICAR PACIENTE ===");
    
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
      console.log("⚠️ Intentando clic por texto...");
      await clickByText(page, "Documento", 3000).catch(()=>{});
      await sleep(800);
    }

    const opcionesDisponibles = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("[role='option'], li[role='option'], .MuiMenuItem-root"));
      return items
        .filter(e => e.offsetParent !== null)
        .map(e => e.textContent.trim());
    });
    
    console.log("📋 Opciones disponibles en el dropdown:", opcionesDisponibles);

    console.log(`🔍 Buscando opción: "${tipoDocumento}"`);
    
    const picked = await page.evaluate((texto) => {
      const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
      const items = Array.from(document.querySelectorAll("[role='option'], li[role='option'], .MuiMenuItem-root"));
      
      const el = items.find(e => {
        if (e.offsetParent === null) return false;
        const txt = N(e.textContent || "");
        const match = txt === N(texto) || txt.includes(N(texto));
        return match;
      });
      
      if (el) { 
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.click(); 
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return el.textContent.trim();
      }
      return null;
    }, tipoDocumento);
    
    if (!picked) {
      throw new Error(`No encontré la opción del documento: "${tipoDocumento}". Opciones disponibles: ${opcionesDisponibles.join(", ")}`);
    }
    
    console.log(`✅ Opción seleccionada: "${picked}"`);
    await sleep(1000);

    console.log("✍️ Escribiendo número de documento...");
    await sleep(500);
    
    const inputCandidates = [
      "input[name='documentNumber']",
      "#rut",
      "input[placeholder*='RUT']",
      "input[placeholder*='rut']",
      "input[type='text'].MuiInputBase-input",
      ".MuiInputBase-input[type='text']"
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
          await typeInto(page, sel, numeroDocumento);
          console.log(`✅ Escrito en: ${sel}`);
          typed = true;
          break;
        }
      }
    }
    
    if (!typed) {
      const inputsDisponibles = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("input"))
          .filter(i => {
            const style = window.getComputedStyle(i);
            return style.display !== 'none' && style.visibility !== 'hidden';
          })
          .map(i => ({
            type: i.type,
            name: i.name,
            id: i.id,
            placeholder: i.placeholder,
            class: i.className
          }));
      });
      console.log("📋 Inputs visibles disponibles:", inputsDisponibles);
      throw new Error("No encontré el input del número de documento.");
    }

    console.log("⏳ Esperando que se habilite el botón Continuar...");
    
    let clicked = false;
    for (let i = 0; i < 20 && !clicked; i++) {
      clicked = await page.evaluate(() => {
        const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
        const btns = Array.from(document.querySelectorAll("button,[role='button']"));
        const b = btns.find(e => N(e.textContent || "").includes("continuar"));
        
        if (b) {
          if (!b.disabled) { 
            b.click(); 
            return true; 
          }
        }
        return false;
      });
      
      if (!clicked) {
        console.log(`   Intento ${i + 1}/20...`);
        await sleep(500);
      }
    }
    
    if (clicked) {
      console.log("✅ CONTINUAR pulsado.");
    } else {
      throw new Error("CONTINUAR no se habilitó (revisa formato/validez del documento).");
    }

    await sleep(3000);

    // ============================================
    // PASO 2: SELECCIONAR SERVICIO
    // ============================================
    console.log("\n=== PASO 2: SELECCIONAR SERVICIO ===");
    
    // Esperar a que aparezcan las tarjetas de servicio
    console.log("⏳ Esperando que carguen las tarjetas de servicio...");
    await page.waitForSelector('.MuiCard-root, [id="cardMainArea"]', { timeout: 10000 });
    await sleep(1500);
    
    // Mostrar servicios disponibles
    const serviciosDisponibles = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.MuiCard-root [class*="MuiTypography"]'));
      return cards
        .filter(c => c.offsetParent !== null)
        .map(c => c.textContent.trim())
        .filter(t => t.length > 0);
    });
    console.log("📋 Servicios disponibles:", serviciosDisponibles);
    
    console.log(`🔍 Buscando servicio: "${servicio}"`);
    
    // Buscar y hacer click en la tarjeta del servicio
    const servicioClicked = await page.evaluate((srv) => {
      const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
      
      // Buscar el div con el texto del servicio
      const typographies = Array.from(document.querySelectorAll('.MuiTypography-root'));
      const targetTypo = typographies.find(t => N(t.textContent) === N(srv));
      
      if (targetTypo) {
        // Encontrar el botón padre que contiene esta tarjeta
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
      throw new Error(`No encontré el servicio: "${servicio}". Servicios disponibles: ${serviciosDisponibles.join(", ")}`);
    }
    
    console.log(`✅ Servicio seleccionado: "${servicioClicked}"`);
    await sleep(3000);

    // ============================================
    // PASO 3: SELECCIONAR ESPECIALIDAD Y REGIÓN
    // ============================================
    console.log("\n=== PASO 3: SELECCIONAR ESPECIALIDAD Y REGIÓN ===");
    
    // Esperar a que cargue la página de búsqueda
    console.log("⏳ Esperando campos de búsqueda...");
    await page.waitForSelector('input#filterService, input[placeholder*="búsqueda"]', { timeout: 10000 });
    await sleep(1500);
    
    // Escribir en el campo de Consulta/Especialidad
    if (especialidad) {
      console.log(`✍️ Escribiendo especialidad: "${especialidad}"`);
      
      const especialidadInput = await page.$('input#filterService');
      if (especialidadInput) {
        await especialidadInput.click();
        await sleep(300);
        await especialidadInput.type(especialidad, { delay: 100 });
        console.log(`✅ Especialidad escrita: "${especialidad}"`);
        await sleep(800);
        
        // Esperar a que aparezcan sugerencias y seleccionar la primera
        try {
          await page.waitForSelector('[role="option"], .MuiAutocomplete-option', { timeout: 3000 });
          await sleep(500);
          
          const opcionSeleccionada = await page.evaluate(() => {
            const opciones = Array.from(document.querySelectorAll('[role="option"], .MuiAutocomplete-option'));
            if (opciones.length > 0) {
              opciones[0].click();
              return opciones[0].textContent.trim();
            }
            return null;
          });
          
          if (opcionSeleccionada) {
            console.log(`✅ Opción seleccionada: "${opcionSeleccionada}"`);
          }
        } catch {
          console.log("ℹ️ No aparecieron sugerencias de especialidad");
        }
        
        await sleep(500);
      } else {
        console.log("⚠️ No se encontró el campo de especialidad");
      }
    }
    
    // Escribir en el campo de Región o Centro
    if (region) {
      console.log(`📍 Escribiendo región: "${region}"`);
      
      const regionInput = await page.$('input#filterLocation');
      if (regionInput) {
        await regionInput.click();
        await sleep(300);
        await regionInput.type(region, { delay: 100 });
        console.log(`✅ Región escrita: "${region}"`);
        await sleep(800);
        
        // Esperar a que aparezcan sugerencias y seleccionar la primera
        try {
          await page.waitForSelector('[role="option"], .MuiAutocomplete-option', { timeout: 3000 });
          await sleep(500);
          
          const opcionSeleccionada = await page.evaluate(() => {
            const opciones = Array.from(document.querySelectorAll('[role="option"], .MuiAutocomplete-option'));
            if (opciones.length > 0) {
              opciones[0].click();
              return opciones[0].textContent.trim();
            }
            return null;
          });
          
          if (opcionSeleccionada) {
            console.log(`✅ Región seleccionada: "${opcionSeleccionada}"`);
          }
        } catch {
          console.log("ℹ️ No aparecieron sugerencias de región");
        }
        
        await sleep(500);
      } else {
        console.log("⚠️ No se encontró el campo de región");
      }
    }
    
    // Hacer click en BUSCAR HORAS
    console.log("🔍 Buscando el botón BUSCAR HORAS...");
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
    
    if (buscarClicked) {
      console.log("✅ BUSCAR HORAS pulsado");
    } else {
      console.log("⚠️ No se pudo hacer click en BUSCAR HORAS (puede estar deshabilitado)");
    }
    
    await sleep(4000);

    // ============================================
    // PASO 4: SELECCIONAR DÍA, MÉDICO Y HORA
    // ============================================
    console.log("\n=== PASO 4: SELECCIONAR DÍA, MÉDICO Y HORA ===");
    
    // Esperar a que carguen las fechas y médicos disponibles
    console.log("⏳ Esperando resultados de búsqueda...");
    await page.waitForSelector('.MuiBox-root, .MuiCard-root', { timeout: 15000 });
    await sleep(2000);
    
    // Seleccionar fecha si se especificó
    if (fecha) {
      console.log(`📅 Buscando fecha: "${fecha}"`);
      
      const fechaClicked = await page.evaluate((f) => {
        const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
        
        // Buscar contenedores de fecha
        const fechaBoxes = Array.from(document.querySelectorAll('.MuiBox-root'));
        
        for (const box of fechaBoxes) {
          const textos = Array.from(box.querySelectorAll('p.MuiTypography-root'));
          const textoCompleto = textos.map(t => N(t.textContent)).join(' ');
          
          // Buscar por número de día o día de la semana
          if (textoCompleto.includes(N(f))) {
            // Verificar que no sea "Sin Horas"
            if (!textoCompleto.includes('sin horas')) {
              box.scrollIntoView({ behavior: "smooth", block: "center" });
              box.click();
              return textos.map(t => t.textContent.trim()).join(' ');
            }
          }
        }
        return null;
      }, fecha);
      
      if (fechaClicked) {
        console.log(`✅ Fecha seleccionada: "${fechaClicked}"`);
        await sleep(2000);
      } else {
        console.log(`⚠️ No se encontró la fecha "${fecha}" con horas disponibles`);
      }
    }
    
    // Buscar médico si se especificó
    if (medico) {
      console.log(`👨‍⚕️ Buscando médico: "${medico}"`);
      
      // Expandir acordeones si es necesario
      await sleep(1000);
      
      const medicoEncontrado = await page.evaluate((med) => {
        const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
        
        // Buscar en todos los nombres de médicos
        const medicoNames = Array.from(document.querySelectorAll('p.MuiTypography-root'));
        
        for (const name of medicoNames) {
          const texto = N(name.textContent);
          if (texto.includes(N(med))) {
            name.scrollIntoView({ behavior: "smooth", block: "center" });
            return name.textContent.trim();
          }
        }
        return null;
      }, medico);
      
      if (medicoEncontrado) {
        console.log(`✅ Médico encontrado: "${medicoEncontrado}"`);
        await sleep(1000);
      } else {
        console.log(`⚠️ No se encontró el médico "${medico}"`);
      }
    }
    
    // Seleccionar hora
    if (hora) {
      console.log(`⏰ Buscando hora: "${hora}"`);
      
      const horaClicked = await page.evaluate((h) => {
        // Buscar botones de hora con la estructura específica de RedSalud
        const buttons = Array.from(document.querySelectorAll('button.MuiButton-root'));
        
        // Buscar botón que contenga la hora exacta
        for (const btn of buttons) {
          const texto = btn.textContent.replace(/\s+/g, ' ').trim();
          
          // Buscar formato "Reservar 09:15" (con el &nbsp; convertido a espacio)
          if (texto.includes('Reservar') && texto.includes(h)) {
            // Verificar que no sea el botón de "X HORAS ESTE DIA"
            if (!texto.includes('HORAS') && !texto.includes('ESTE DIA')) {
              btn.scrollIntoView({ behavior: "smooth", block: "center" });
              btn.click();
              return texto;
            }
          }
        }
        return null;
      }, hora);
      
      if (horaClicked) {
        console.log(`✅ Hora seleccionada: "${horaClicked}"`);
        await sleep(2000);
      } else {
        console.log(`⚠️ No se encontró la hora "${hora}"`);
        console.log("ℹ️ Buscando primera hora disponible...");
        
        // Seleccionar primera hora disponible
        const primeraHora = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button.MuiButton-root'));
          
          for (const btn of buttons) {
            const texto = btn.textContent.replace(/\s+/g, ' ').trim();
            
            // Buscar formato "Reservar HH:MM"
            if (texto.includes('Reservar') && /\d{2}:\d{2}/.test(texto)) {
              // Verificar que no sea el botón de "X HORAS ESTE DIA"
              if (!texto.includes('HORAS') && !texto.includes('ESTE DIA')) {
                btn.scrollIntoView({ behavior: "smooth", block: "center" });
                btn.click();
                return texto;
              }
            }
          }
          return null;
        });
        
        if (primeraHora) {
          console.log(`✅ Primera hora disponible seleccionada: "${primeraHora}"`);
          await sleep(2000);
        } else {
          console.log("⚠️ No se encontraron horas disponibles");
        }
      }
    } else {
      console.log("ℹ️ No se especificó hora. Seleccionando primera hora disponible...");
      
      // Seleccionar primera hora disponible si no se especificó
      const primeraHora = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button.MuiButton-root'));
        
        for (const btn of buttons) {
          const texto = btn.textContent.replace(/\s+/g, ' ').trim();
          
          // Buscar formato "Reservar HH:MM"
          if (texto.includes('Reservar') && /\d{2}:\d{2}/.test(texto)) {
            // Verificar que no sea el botón de "X HORAS ESTE DIA"
            if (!texto.includes('HORAS') && !texto.includes('ESTE DIA')) {
              btn.scrollIntoView({ behavior: "smooth", block: "center" });
              btn.click();
              return texto;
            }
          }
        }
        return null;
      });
      
      if (primeraHora) {
        console.log(`✅ Primera hora disponible seleccionada: "${primeraHora}"`);
        await sleep(2000);
      }
    }

    // ============================================
    // PASO 5: ACEPTAR TÉRMINOS E INFORMACIÓN ADICIONAL
    // ============================================
    console.log("\n=== PASO 5: ACEPTAR TÉRMINOS ===");
    
    // Esperar a que aparezca el modal de información adicional
    console.log("⏳ Esperando modal de información adicional...");
    
    try {
      // Esperar el botón ACEPTO
      await page.waitForSelector('button[type="submit"]', { timeout: 8000 });
      await sleep(1000);
      
      // Buscar y hacer click en el botón ACEPTO
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
      } else {
        console.log("⚠️ No se encontró el botón ACEPTO");
      }
      
    } catch (e) {
      console.log("ℹ️ No apareció modal de términos (puede que no sea necesario)");
    }

    // ============================================
    // PASO 5.5: COMPLETAR DATOS DE CONTACTO
    // ============================================
    console.log("\n=== COMPLETANDO DATOS DE CONTACTO ===");
    await sleep(2000);
    
    // Completar teléfono si se proporcionó
    if (telefono) {
      console.log(`📱 Completando teléfono: "${telefono}"`);
      
      try {
        const telefonoInput = await page.$('input[name="phoneNumber"], input[id="phoneNumber"], input[autocomplete="phoneNumber"]');
        
        if (telefonoInput) {
          await telefonoInput.click();
          await sleep(300);
          await telefonoInput.click({ clickCount: 3 });
          await page.keyboard.press('Backspace');
          await sleep(200);
          await telefonoInput.type(telefono, { delay: 50 });
          console.log("✅ Teléfono completado");
          await sleep(500);
        } else {
          console.log("⚠️ No se encontró el campo de teléfono");
        }
      } catch (e) {
        console.log("⚠️ Error al completar teléfono:", e.message);
      }
    }
    
    // Completar email si se proporcionó
    if (email) {
      console.log(`📧 Completando email: "${email}"`);
      
      try {
        const emailInput = await page.$('input[name="email"], input[id="email"], input[type="email"], input[autocomplete="email"]');
        
        if (emailInput) {
          await emailInput.click();
          await sleep(300);
          await emailInput.click({ clickCount: 3 });
          await page.keyboard.press('Backspace');
          await sleep(200);
          await emailInput.type(email, { delay: 50 });
          console.log("✅ Email completado");
          await sleep(500);
        } else {
          console.log("⚠️ No se encontró el campo de email");
        }
      } catch (e) {
        console.log("⚠️ Error al completar email:", e.message);
      }
    }
    
    // Aceptar términos y condiciones
    console.log("☑️ Aceptando términos y condiciones...");
    
    try {
      await sleep(800);
      
      const checkboxClicked = await page.evaluate(() => {
        // Buscar el checkbox específico
        const checkbox = document.querySelector('input.PrivateSwitchBase-input.css-1m9pwf3[type="checkbox"][data-indeterminate="false"]');
        
        if (checkbox) {
          console.log("Checkbox encontrado, checked:", checkbox.checked);
          
          if (!checkbox.checked) {
            // Intentar hacer click en el checkbox directamente
            checkbox.scrollIntoView({ behavior: "smooth", block: "center" });
            checkbox.click();
            
            // También intentar con el padre por si el checkbox está oculto visualmente
            const parent = checkbox.closest('span.MuiButtonBase-root') || 
                          checkbox.closest('.MuiCheckbox-root') || 
                          checkbox.parentElement;
            
            if (parent) {
              parent.click();
            }
            
            return true;
          }
          
          return checkbox.checked;
        }
        
        return false;
      });
      
      await sleep(800);
      
      if (checkboxClicked) {
        console.log("✅ Términos y condiciones aceptados");
      } else {
        console.log("⚠️ No se pudo aceptar los términos, intentando método alternativo...");
        
        // Método alternativo: buscar por cualquier checkbox visible
        const alternativeClick = await page.evaluate(() => {
          const allCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
          
          for (const cb of allCheckboxes) {
            const style = window.getComputedStyle(cb);
            const parentStyle = cb.parentElement ? window.getComputedStyle(cb.parentElement) : null;
            
            // Verificar si es visible (aunque sea con opacity 0)
            if (style.display !== 'none' && parentStyle && parentStyle.display !== 'none') {
              if (!cb.checked) {
                cb.scrollIntoView({ behavior: "smooth", block: "center" });
                
                // Click en el padre que generalmente es el componente MUI visible
                const clickTarget = cb.closest('span.MuiButtonBase-root') || 
                                   cb.closest('.MuiCheckbox-root') ||
                                   cb.closest('label') ||
                                   cb.parentElement;
                
                if (clickTarget) {
                  clickTarget.click();
                  return true;
                }
              }
              return cb.checked;
            }
          }
          return false;
        });
        
        if (alternativeClick) {
          console.log("✅ Términos aceptados con método alternativo");
        } else {
          console.log("⚠️ No se encontró checkbox de términos");
        }
      }
    } catch (e) {
      console.log("⚠️ Error al aceptar términos:", e.message);
    }
    
    // Buscar y hacer click en RESERVAR HORA
    console.log("🔍 Buscando botón RESERVAR HORA...");
    await sleep(1500);
    
    const reservarClicked = await page.evaluate(() => {
      const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
      
      // Buscar específicamente el botón con las clases de MUI y el estilo correcto
      const buttons = Array.from(document.querySelectorAll('button.MuiButton-root.MuiButton-textPrimary.css-r5j4e0'));
      
      // Filtrar por el texto "RESERVAR HORA"
      const btnReservar = buttons.find(btn => {
        const texto = N(btn.textContent);
        return texto === 'reservar hora';
      });
      
      if (btnReservar) {
        console.log("Botón RESERVAR HORA encontrado");
        btnReservar.scrollIntoView({ behavior: "smooth", block: "center" });
        
        // Hacer click múltiple para asegurar que se registre
        btnReservar.click();
        
        // Disparar evento de mouse también
        btnReservar.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        
        return true;
      }
      
      // Método alternativo: buscar cualquier botón con el texto "RESERVAR HORA"
      const allButtons = Array.from(document.querySelectorAll('button'));
      const altBtn = allButtons.find(btn => N(btn.textContent) === 'reservar hora');
      
      if (altBtn) {
        console.log("Botón encontrado con método alternativo");
        altBtn.scrollIntoView({ behavior: "smooth", block: "center" });
        altBtn.click();
        altBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      }
      
      return false;
    });
    
    if (reservarClicked) {
      console.log("✅ RESERVAR HORA pulsado");
      await sleep(3000);
    } else {
      console.log("⚠️ No se encontró el botón RESERVAR HORA");
      console.log("ℹ️ Intentando con Puppeteer click directo...");
      
      // Método de respaldo usando Puppeteer directamente
      try {
        await page.waitForSelector('button.MuiButton-root.css-r5j4e0', { timeout: 3000 });
        const botonReservar = await page.$('button.MuiButton-root.css-r5j4e0');
        
        if (botonReservar) {
          await botonReservar.click();
          console.log("✅ RESERVAR HORA pulsado con método de respaldo");
          await sleep(3000);
        }
      } catch (e) {
        console.log("⚠️ No se pudo hacer click en RESERVAR HORA:", e.message);
      }
    }

    console.log("\n✅ PROCESO COMPLETADO - RESERVA LISTA");
    console.log("📍 El navegador permanecerá abierto para confirmar la reserva final...");
    
    // No cerrar el navegador para continuar manualmente
    // await browser.close();
    
  } catch (e) {
    console.error("\n💥 Error:", e.message);
    try { 
      await page.screenshot({ path: "redsalud_error.png", fullPage: true }); 
      console.log("📸 Screenshot guardado: redsalud_error.png");
    } catch {}
    // await browser.close();
  }
}

// ============================================
// EJEMPLOS DE USO
// ============================================

// Ejemplo 1: Reserva completa con todos los parámetros
reservarHora({
  tipoDocumento: "Carnet de Identidad",
  numeroDocumento: "21764574-3",
  servicio: "Consultas",
  especialidad: "Medicina General",
  region: "Providencia",
  fecha: "27",                    // Busca el día 27
  medico: "Luis Jose Rodriguez",  // Busca este médico específico
  hora: "09:15",                   // Busca esta hora específica
  telefono: "954450476",        // NUEVO: Teléfono
  email: "luiscaceresalarcon@outlook.com"     // NUEVO: Email
});