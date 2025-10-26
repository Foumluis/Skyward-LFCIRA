#!/usr/bin/env bash
set -e

echo "📦 Instalando dependencias de Node..."
npm install

echo "🌐 Descargando Chrome para Puppeteer..."
npx puppeteer browsers install chrome

echo "✅ Build completado exitosamente"