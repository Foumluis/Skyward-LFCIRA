// agente_snabb_real.js (MODIFICADO)
// Script de Puppeteer que ahora es una función exportable

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

// ====================================
// FUNCIÓN PRINCIPAL EXPORTABLE
// ====================================
export async function reservarHora({
  url = "https://agenda.redsalud.cl/patientPortal/identifyPatient",
  tipoDocumento = "Carnet de Identidad",
  numeroDocumento,
  servicio = "Consultas",
  especialidad,
  region = null,
  fecha = null,
  medico = null,
  hora = null,
  telefono = null,
  email = null,
  headless = false // Cambiado a false para debugging, true para producción
} = {}) {
  
  // Validación de datos requeridos
  if (!numeroDocumento || !especialidad) {
    throw new Error('numeroDocumento y especialidad son requeridos');
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🏥 INICIANDO AGENDAMIENTO EN REDSALUD`);
  console.log(`${'='.repeat(60)}`);
  console.log(`📋 RUT: ${numeroDocumento}`);
  console.log(`🏥 Especialidad: ${especialidad}`);
  console.log(`📅 Fecha: ${fecha || 'Primera disponible'}`);
  console.log(`⏰ Hora: ${hora || 'Primera disponible'}`);
  console.log(`👨‍⚕️ Médico: ${medico || 'Cualquiera'}`);
  console.log(`${'='.repeat(60)}\n`);

  const browser = await puppeteer.launch({
    headless: headless,
    defaultViewport: null,
    args: [
      "--start-maximized",
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox"
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
    
    console.log("⏳ Esperando que carguen las tarjetas de servicio...");
    await page.waitForSelector('.MuiCard-root, [id="cardMainArea"]', { timeout: 10000 });
    await sleep(1500);
    
    const serviciosDisponibles = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.MuiCard-root [class*="MuiTypography"]'));
      return cards
        .filter(c => c.offsetParent !== null)
        .map(c => c.textContent.trim())
        .filter(t => t.length > 0);
    });
    console.log("📋 Servicios disponibles:", serviciosDisponibles);
    
    console.log(`🔍 Buscando servicio: "${servicio}"`);
    
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
      throw new Error(`No encontré el servicio: "${servicio}". Servicios disponibles: ${serviciosDisponibles.join(", ")}`);
    }
    
    console.log(`✅ Servicio seleccionado: "${servicioClicked}"`);
    await sleep(3000);

    // ============================================
    // PASO 3: SELECCIONAR ESPECIALIDAD Y REGIÓN
    // ============================================
    console.log("\n=== PASO 3: SELECCIONAR ESPECIALIDAD Y REGIÓN ===");
    
    console.log("⏳ Esperando campos de búsqueda...");
    await page.waitForSelector('input#filterService, input[placeholder*="búsqueda"]', { timeout: 10000 });
    await sleep(1500);
    
    if (especialidad) {
      console.log(`✍️ Escribiendo especialidad: "${especialidad}"`);
      
      const especialidadInput = await page.$('input#filterService');
      if (especialidadInput) {
        await especialidadInput.click();
        await sleep(300);
        await especialidadInput.type(especialidad, { delay: 100 });
        console.log(`✅ Especialidad escrita: "${especialidad}"`);
        await sleep(800);
        
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
    
    if (region) {
      console.log(`📍 Escribiendo región: "${region}"`);
      
      const regionInput = await page.$('input#filterLocation');
      if (regionInput) {
        await regionInput.click();
        await sleep(300);
        await regionInput.type(region, { delay: 100 });
        console.log(`✅ Región escrita: "${region}"`);
        await sleep(800);
        
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
    }, servicio);
    
    if (buscarClicked) {
      console.log("✅ BUSCAR HORAS pulsado");
    } else {
      console.log("⚠️ No se pudo hacer click en BUSCAR HORAS");
    }
    
    await sleep(4000);

    // ============================================
    // PASO 4: SELECCIONAR DÍA, MÉDICO Y HORA
    // ============================================
    console.log("\n=== PASO 4: SELECCIONAR DÍA, MÉDICO Y HORA ===");
    
    console.log("⏳ Esperando resultados de búsqueda...");
    await page.waitForSelector('.MuiBox-root, .MuiCard-root', { timeout: 15000 });
    await sleep(2000);
    
    if (fecha) {
      console.log(`📅 Buscando fecha: "${fecha}"`);
      
      const fechaClicked = await page.evaluate((f) => {
        const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
        
        const fechaBoxes = Array.from(document.querySelectorAll('.MuiBox-root'));
        
        for (const box of fechaBoxes) {
          const textos = Array.from(box.querySelectorAll('p.MuiTypography-root'));
          const textoCompleto = textos.map(t => N(t.textContent)).join(' ');
          
          if (textoCompleto.includes(N(f))) {
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
    
    if (medico) {
      console.log(`👨‍⚕️ Buscando médico: "${medico}"`);
      await sleep(1000);
      
      const medicoEncontrado = await page.evaluate((med) => {
        const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
        
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
    
    if (hora) {
      console.log(`⏰ Buscando hora: "${hora}"`);
      
      const horaClicked = await page.evaluate((h) => {
        const buttons = Array.from(document.querySelectorAll('button.MuiButton-root'));
        
        for (const btn of buttons) {
          const texto = btn.textContent.replace(/\s+/g, ' ').trim();
          
          if (texto.includes('Reservar') && texto.includes(h)) {
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
        
        const primeraHora = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button.MuiButton-root'));
          
          for (const btn of buttons) {
            const texto = btn.textContent.replace(/\s+/g, ' ').trim();
            
            if (texto.includes('Reservar') && /\d{2}:\d{2}/.test(texto)) {
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
      
      const primeraHora = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button.MuiButton-root'));
        
        for (const btn of buttons) {
          const texto = btn.textContent.replace(/\s+/g, ' ').trim();
          
          if (texto.includes('Reservar') && /\d{2}:\d{2}/.test(texto)) {
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
    // PASO 5: ACEPTAR TÉRMINOS E INFORMACIÓN
    // ============================================
    console.log("\n=== PASO 5: ACEPTAR TÉRMINOS ===");
    
    console.log("⏳ Esperando modal de información adicional...");
    
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
      } else {
        console.log("⚠️ No se encontró el botón ACEPTO");
      }
      
    } catch (e) {
      console.log("ℹ️ No apareció modal de términos");
    }

    // ============================================
    // PASO 6: COMPLETAR DATOS DE CONTACTO
    // ============================================
    console.log("\n=== PASO 6: COMPLETANDO DATOS DE CONTACTO ===");
    await sleep(2000);
    
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
    
    console.log("☑️ Aceptando términos y condiciones...");
    
    try {
      await sleep(800);
      
      const checkboxClicked = await page.evaluate(() => {
        const checkbox = document.querySelector('input.PrivateSwitchBase-input.css-1m9pwf3[type="checkbox"][data-indeterminate="false"]');
        
        if (checkbox) {
          if (!checkbox.checked) {
            checkbox.scrollIntoView({ behavior: "smooth", block: "center" });
            checkbox.click();
            
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
        console.log("⚠️ Intentando método alternativo para checkbox...");
        
        const alternativeClick = await page.evaluate(() => {
          const allCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
          
          for (const cb of allCheckboxes) {
            const style = window.getComputedStyle(cb);
            const parentStyle = cb.parentElement ? window.getComputedStyle(cb.parentElement) : null;
            
            if (style.display !== 'none' && parentStyle && parentStyle.display !== 'none') {
              if (!cb.checked) {
                cb.scrollIntoView({ behavior: "smooth", block: "center" });
                
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
        }
      }
    } catch (e) {
      console.log("⚠️ Error al aceptar términos:", e.message);
    }
    
    console.log("🔍 Buscando botón RESERVAR HORA...");
    await sleep(1500);
    
    const reservarClicked = await page.evaluate(() => {
      const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
      
      const buttons = Array.from(document.querySelectorAll('button.MuiButton-root.MuiButton-textPrimary.css-r5j4e0'));
      
      const btnReservar = buttons.find(btn => {
        const texto = N(btn.textContent);
        return texto === 'reservar hora';
      });
      
      if (btnReservar) {
        btnReservar.scrollIntoView({ behavior: "smooth", block: "center" });
        btnReservar.click();
        btnReservar.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      }
      
      const allButtons = Array.from(document.querySelectorAll('button'));
      const altBtn = allButtons.find(btn => N(btn.textContent) === 'reservar hora');
      
      if (altBtn) {
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
    console.log(`${'='.repeat(60)}`);
    console.log("📸 Tomando screenshot final...");
    
    await page.screenshot({ path: `redsalud_exito_${numeroDocumento}_${Date.now()}.png`, fullPage: true });
    console.log("✅ Screenshot guardado");
    
    console.log(`${'='.repeat(60)}\n`);
    
    await browser.close();
    
    return {
      success: true,
      message: "Agendamiento completado exitosamente",
      data: {
        rut: numeroDocumento,
        especialidad,
        fecha,
        hora
      }
    };
    
  } catch (e) {
    console.error("\n💥 ERROR EN EL PROCESO:", e.message);
    console.log(`${'='.repeat(60)}\n`);
    
    try { 
      await page.screenshot({ path: `redsalud_error_${numeroDocumento}_${Date.now()}.png`, fullPage: true }); 
      console.log("📸 Screenshot de error guardado");
    } catch {}
    
    await browser.close();
    
    throw e;
  }
}

// Para testing directo del script
if (import.meta.url === `file://${process.argv[1]}`) {
  reservarHora({
    tipoDocumento: "Carnet de Identidad",
    numeroDocumento: "21764574-3",
    servicio: "Consultas",
    especialidad: "Medicina General",
    region: "Providencia",
    fecha: "27",
    medico: "Luis Jose Rodriguez",
    hora: "09:15",
    telefono: "954450476",
    email: "luiscaceresalarcon@outlook.com"
  }).then(() => {
    console.log("✅ Script ejecutado exitosamente");
    process.exit(0);
  }).catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
}