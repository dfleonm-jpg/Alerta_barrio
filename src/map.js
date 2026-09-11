// ============================================================================
// Mapa esquemático de Bogotá dibujado en SVG (sin tiles externos → offline).
// Renderiza un mapa de calor y marcadores por nivel de riesgo.
// ============================================================================
import { getZones, riskForZone, countByZone } from './data.js';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// Dibuja un fondo estilizado de ciudad: manzanas y avenidas principales.
function drawBackground(svg) {
  const bg = svgEl('rect', { x: 0, y: 0, width: 100, height: 100, fill: '#eef2f6' });
  svg.appendChild(bg);

  // Manzanas (grid tenue).
  const grid = svgEl('g', { opacity: '0.5' });
  for (let gx = 6; gx < 100; gx += 12) {
    for (let gy = 6; gy < 100; gy += 12) {
      grid.appendChild(
        svgEl('rect', {
          x: gx, y: gy, width: 8.5, height: 8.5, rx: 1.2,
          fill: '#dfe6ec', stroke: '#d3dce4', 'stroke-width': 0.2,
        })
      );
    }
  }
  svg.appendChild(grid);

  // "Cerros orientales" al oriente (derecha) — referencia geográfica de Bogotá.
  svg.appendChild(
    svgEl('path', {
      d: 'M100,0 L100,100 L84,100 C88,72 86,40 100,0 Z',
      fill: '#d7e4d0', opacity: '0.8',
    })
  );

  // Avenidas principales.
  const roads = svgEl('g', { stroke: '#ffffff', 'stroke-width': 1.6, 'stroke-linecap': 'round', fill: 'none' });
  roads.appendChild(svgEl('line', { x1: 0, y1: 45, x2: 100, y2: 40 }));   // horizontal
  roads.appendChild(svgEl('line', { x1: 52, y1: 0, x2: 48, y2: 100 }));   // vertical (Caracas)
  roads.appendChild(svgEl('line', { x1: 0, y1: 70, x2: 100, y2: 62 }));
  roads.appendChild(svgEl('line', { x1: 30, y1: 0, x2: 26, y2: 100 }));
  svg.appendChild(roads);
}

// Capa de calor: círculos difusos según nivel/score.
function drawHeat(svg, zones) {
  const heat = svgEl('g', { filter: 'url(#blur)' });
  for (const z of zones) {
    const { score, level } = riskForZone(z.id);
    const r = 6 + score * 1.4;
    heat.appendChild(
      svgEl('circle', {
        cx: z.x, cy: z.y, r, fill: level.color, opacity: 0.28,
      })
    );
  }
  svg.appendChild(heat);
}

/**
 * Renderiza el mapa dentro de `container`.
 * @param {HTMLElement} container
 * @param {(zoneId:string)=>void} onSelect  callback al tocar una zona
 * @param {string|object} opts  Filtro de nivel ('all'|'alto'|'medio'|'bajo')
 *   o un objeto de opciones:
 *   { filterLevel, routePath: string[], userPoint: {x,y}, highlight: string[] }
 */
export function renderMap(container, onSelect, opts = 'all') {
  const options = typeof opts === 'string' ? { filterLevel: opts } : (opts || {});
  const filterLevel = options.filterLevel || 'all';
  const routePath = options.routePath || null;
  const userPoint = options.userPoint || null;
  const highlight = new Set(options.highlight || []);

  container.innerHTML = '';
  const zones = getZones();
  const byId = new Map(zones.map((z) => [z.id, z]));

  const svg = svgEl('svg', {
    viewBox: '0 0 100 100',
    class: 'map-svg',
    preserveAspectRatio: 'xMidYMid slice',
    role: 'img',
    'aria-label': 'Mapa de zonas de riesgo de Bogotá',
  });

  // Definición del desenfoque para el mapa de calor.
  const defs = svgEl('defs');
  const filter = svgEl('filter', { id: 'blur', x: '-50%', y: '-50%', width: '200%', height: '200%' });
  filter.appendChild(svgEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '2.4' }));
  defs.appendChild(filter);
  svg.appendChild(defs);

  drawBackground(svg);
  drawHeat(svg, zones);

  // Ruta recomendada (polilínea que une las zonas del camino).
  if (routePath && routePath.length > 1) {
    const pts = routePath.map((id) => byId.get(id)).filter(Boolean);
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    // Trazo blanco de fondo para dar contraste.
    svg.appendChild(svgEl('path', {
      d, fill: 'none', stroke: '#ffffff', 'stroke-width': 2.6,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }));
    // Trazo azul de la ruta.
    svg.appendChild(svgEl('path', {
      d, fill: 'none', stroke: '#2b4c7e', 'stroke-width': 1.4,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'stroke-dasharray': '3 2', class: 'route-line',
    }));
  }

  // Marcadores.
  for (const z of zones) {
    const { level } = riskForZone(z.id);
    if (filterLevel !== 'all' && level.id !== filterLevel && !highlight.has(z.id)) continue;

    const g = svgEl('g', { class: 'map-marker', tabindex: '0', role: 'button',
      'aria-label': `${z.name}, riesgo ${level.label}` });
    g.style.cursor = 'pointer';

    // Pin (gota).
    g.appendChild(
      svgEl('path', {
        d: `M ${z.x} ${z.y} c -2.6 -3.4 -3.9 -5 -3.9 -7 a 3.9 3.9 0 0 1 7.8 0 c 0 2 -1.3 3.6 -3.9 7 Z`,
        fill: level.color, stroke: '#ffffff', 'stroke-width': 0.5,
        transform: `translate(0 -1.5)`,
      })
    );
    g.appendChild(svgEl('circle', { cx: z.x, cy: z.y - 6.5, r: 1.4, fill: '#ffffff' }));

    const activate = () => onSelect && onSelect(z.id);
    g.addEventListener('click', activate);
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });

    // Resalta las zonas de la ruta o las marcadas.
    if (highlight.has(z.id)) {
      g.insertBefore(
        svgEl('circle', { cx: z.x, cy: z.y - 4, r: 5.2, fill: 'none', stroke: level.color, 'stroke-width': 0.9, opacity: 0.9 }),
        g.firstChild
      );
    }

    // Tooltip nativo.
    const title = svgEl('title');
    title.textContent = `${z.name} — ${countByZone(z.id)} reportes`;
    g.appendChild(title);

    svg.appendChild(g);
  }

  // Marcador de "mi ubicación" (punto azul pulsante).
  if (userPoint) {
    const u = svgEl('g', { class: 'user-loc' });
    u.appendChild(svgEl('circle', { cx: userPoint.x, cy: userPoint.y, r: 4.5, fill: '#1e88e5', opacity: 0.18 }));
    u.appendChild(svgEl('circle', { cx: userPoint.x, cy: userPoint.y, r: 2, fill: '#1e88e5', stroke: '#fff', 'stroke-width': 0.7 }));
    const t = svgEl('title'); t.textContent = 'Mi ubicación'; u.appendChild(t);
    svg.appendChild(u);
  }

  container.appendChild(svg);
}

// Utilidad: encuentra la zona más cercana a un punto {x,y} y su distancia.
export function nearestZone(point) {
  const zones = getZones();
  let best = null;
  let bestD = Infinity;
  for (const z of zones) {
    const d = Math.hypot(z.x - point.x, z.y - point.y);
    if (d < bestD) { bestD = d; best = z; }
  }
  return { zone: best, distance: bestD };
}
