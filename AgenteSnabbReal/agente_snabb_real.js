// agente_snabb_real.js (CONFIGURADO PARA PRODUCCIÓN)
import puppeteer from "puppeteer";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const N = (s) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

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

async function typeInto(page, selector, value, timeout = 8000) {
  await page.waitForSelector(selector, { timeout });
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, value, { delay: 18 });
  await sleep(150);
}

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
  headless = true
} = {}) {
  
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

  // ----- INICIO DE LA CORRECCIÓN -----
  // CONFIGURACIÓN PARA RENDER (PRODUCCIÓN)

const chromePath = '/opt/render/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';
  
console.log(`[DEBUG] Usando path de Chrome: ${chromePath}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    
    // ESTA LÍNEA ES ESENCIAL para Render/producción
    // Le dice a Puppeteer que use el Chrome que descargó en node_modules
    executablePath: chromePath, 
    
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--single-process'
    ],
    ignoreHTTPSErrors: true
    // El comentario original que tenías era la causa del error.
  });
  // ----- FIN DE LA CORRECCIÓN -----

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  page.setDefaultTimeout(25000);

  try {
    console.log("🌐 Abriendo:", url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 0 });
    await sleep(2000);

    // PASO 1: IDENTIFICAR PACIENTE
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

    console.log("✏️ Escribiendo número de documento...");
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
      throw new Error("No encontré el input del número de documento.");
    }

    console.log("⏳ Esperando que se habilite el botón Continuar...");
    
    let clicked = false;
    for (let i = 0; i < 20 && !clicked; i++) {
      clicked = await page.evaluate(() => {
        const N = (s) => (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
        const btns = Array.from(document.querySelectorAll("button,[role='button']"));
        const b = btns.find(e => N(e.textContent || "").includes("continuar"));
        
        if (b && !b.disabled) { 
          b.click(); 
          return true; 
        }
        return false;
      });
      
      if (!clicked) await sleep(500);
    }
    
    if (!clicked) {
      throw new Error("CONTINUAR no se habilitó (revisa formato/validez del documento).");
    }
    
    console.log("✅ CONTINUAR pulsado.");
    await sleep(3000);

    // PASO 2: SELECCIONAR SERVICIO
    console.log("\n=== PASO 2: SELECCIONAR SERVICIO ===");
    
    await page.waitForSelector('.MuiCard-root, [id="cardMainArea"]', { timeout: 10000 });
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
      throw new Error(`No encontré el servicio: "${servicio}"`);
    }
    
    console.log(`✅ Servicio seleccionado: "${servicioClicked}"`);
    await sleep(3000);

    // PASO 3-6: Resto del flujo igual...
    // (Mantén el resto de tu código aquí)

    console.log("\n✅ PROCESO COMPLETADO - RESERVA LISTA");
    console.log(`${'='.repeat(60)}\n`);
    
    await browser.close();
    
    return {
      success: true,
      message: "Agendamiento completado exitosamente",
      data: { rut: numeroDocumento, especialidad, fecha, hora }
    };
    
  } catch (e) {
    console.error("\n💥 ERROR EN EL PROCESO:", e.message);
    await browser.close();
    throw e;
  }
}
// LA LLAVE EXTRA QUE ESTABA AQUÍ FUE ELIMINADA