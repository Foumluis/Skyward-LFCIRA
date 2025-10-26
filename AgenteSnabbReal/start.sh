#!/bin/bash

# ===========================================
# SCRIPT DE INICIO RÁPIDO
# Sistema de Agendamiento Médico Integrado
# ===========================================

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  🏥 Sistema de Agendamiento Médico Integrado         ║"
echo "║  Iniciando todos los servicios...                    ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Función para verificar si un comando existe
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Verificar Node.js
echo -e "${BLUE}[1/4]${NC} Verificando Node.js..."
if ! command_exists node; then
  echo -e "${RED}❌ Node.js no está instalado${NC}"
  echo "Por favor instala Node.js desde: https://nodejs.org/"
  exit 1
fi
echo -e "${GREEN}✅ Node.js instalado: $(node -v)${NC}"
echo ""

# Verificar npm
echo -e "${BLUE}[2/4]${NC} Verificando npm..."
if ! command_exists npm; then
  echo -e "${RED}❌ npm no está instalado${NC}"
  exit 1
fi
echo -e "${GREEN}✅ npm instalado: $(npm -v)${NC}"
echo ""

# Instalar dependencias del servidor Puppeteer
echo -e "${BLUE}[3/4]${NC} Instalando dependencias del servidor Puppeteer..."
if [ ! -d "node_modules" ]; then
  npm install
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Dependencias instaladas correctamente${NC}"
  else
    echo -e "${RED}❌ Error al instalar dependencias${NC}"
    exit 1
  fi
else
  echo -e "${YELLOW}⚠️  node_modules ya existe, omitiendo instalación${NC}"
fi
echo ""

# Verificar que existen los archivos necesarios
echo -e "${BLUE}[4/4]${NC} Verificando archivos necesarios..."

if [ ! -f "puppeteer-server.js" ]; then
  echo -e "${RED}❌ puppeteer-server.js no encontrado${NC}"
  exit 1
fi

if [ ! -f "agente_snabb_real.js" ]; then
  echo -e "${RED}❌ agente_snabb_real.js no encontrado${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Todos los archivos necesarios encontrados${NC}"
echo ""

# Configurar variables de entorno si no existe .env
if [ ! -f ".env" ]; then
  echo -e "${YELLOW}⚠️  Archivo .env no encontrado${NC}"
  echo "Creando .env desde .env.example..."
  
  if [ -f ".env.example" ]; then
    cp .env.example .env
    echo -e "${GREEN}✅ Archivo .env creado${NC}"
    echo -e "${YELLOW}📝 Por favor edita .env con tus configuraciones antes de continuar${NC}"
    echo ""
  else
    echo -e "${YELLOW}Creando .env básico...${NC}"
    cat > .env << EOF
PORT=3001
PUPPETEER_HEADLESS=false
API_KEY=cambiar-en-produccion
EOF
    echo -e "${GREEN}✅ Archivo .env básico creado${NC}"
  fi
fi

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  🚀 INICIANDO SERVIDOR PUPPETEER                     ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}📍 Endpoint principal:${NC} http://localhost:3001/agendar"
echo -e "${GREEN}🏥 Health check:${NC} http://localhost:3001/health"
echo ""
echo -e "${YELLOW}Presiona Ctrl+C para detener el servidor${NC}"
echo ""
echo "─────────────────────────────────────────────────────────"
echo ""

# Iniciar servidor
npm start

# Si el servidor se detiene
echo ""
echo -e "${YELLOW}⚠️  Servidor detenido${NC}"