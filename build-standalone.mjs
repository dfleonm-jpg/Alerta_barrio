// Genera un index.html AUTOCONTENIDO (sin módulos ES) a partir de los fuentes
// en src/. Así la app funciona con doble clic (file://), por HTTP y en GitHub Pages.
//
// Uso:  node build-standalone.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(root, 'src');

// Orden de dependencia: utils y data primero, luego routes/map, luego main.
const order = ['utils.js', 'data.js', 'routes.js', 'map.js', 'main.js'];

function strip(code) {
  return code
    // Elimina líneas de import (incluyendo import { ... } from '...';, mono o multilínea).
    .replace(/^\s*import\s+[^;]*?;\s*$/gm, '')
    .replace(/^\s*import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];\s*$/gm, '')
    // Convierte "export function/const/let/class/async" en la declaración normal.
    .replace(/^\s*export\s+(function|const|let|class|async)\b/gm, '$1')
    // Elimina "export { ... };" sueltos.
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
}

let bundle = '';
for (const f of order) {
  const raw = fs.readFileSync(path.join(srcDir, f), 'utf8');
  bundle += `\n/* ===== ${f} ===== */\n` + strip(raw) + '\n';
}

const css = fs.readFileSync(path.join(srcDir, 'styles.css'), 'utf8');

const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#2b4c7e" />
  <meta name="description" content="Alerta Barrio - Consulta y reporta situaciones de inseguridad en tu zona de Bogotá." />
  <title>Alerta Barrio</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📍</text></svg>" />
  <style>
${css}
  </style>
</head>
<body>
  <div id="app">
    <div class="splash" id="splash">
      <div class="splash-logo">📍</div>
      <div class="splash-name">Alerta Barrio</div>
      <div class="splash-tag">Seguridad y percepción de riesgo en las comunidades</div>
    </div>
  </div>

  <!-- App autocontenida: todo el código va embebido como script clásico (sin módulos ES),
       para que funcione con doble clic (file://), por HTTP y en GitHub Pages. -->
  <script>
  (function () {
    'use strict';
${bundle}
  })();
  </script>
</body>
</html>
`;

fs.writeFileSync(path.join(root, 'index.html'), html, 'utf8');
console.log('index.html generado (' + html.length + ' bytes)');
