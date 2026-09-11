// ============================================================================
// Motor de recomendación de rutas seguras.
// ----------------------------------------------------------------------------
// Construye un grafo de proximidad entre zonas (conecta las más cercanas) y
// calcula la ruta con menor "costo", donde el costo combina la distancia con
// una penalización por el nivel de riesgo de cada zona. Así la ruta sugerida
// prefiere pasar por zonas más seguras, aunque implique un pequeño rodeo.
// ============================================================================
import { getZones, riskForZone } from './data.js';

// Distancia euclidiana en el plano del mapa (coordenadas 0..100).
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Construye la lista de adyacencia: cada zona se conecta con sus K vecinas
// más cercanas (grafo no dirigido). K pequeño = rutas más "de barrio".
function buildGraph(zones, k = 3) {
  const adj = new Map(zones.map((z) => [z.id, new Set()]));
  for (const z of zones) {
    const nearest = zones
      .filter((o) => o.id !== z.id)
      .map((o) => ({ id: o.id, d: dist(z, o) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, k);
    for (const n of nearest) {
      adj.get(z.id).add(n.id);
      adj.get(n.id).add(z.id); // no dirigido
    }
  }
  return adj;
}

// Penalización de riesgo por zona (0..~20). Un score alto encarece pasar por ahí.
function riskPenalty(zoneId) {
  const { score } = riskForZone(zoneId);
  return score * score * 0.25; // cuadrático: castiga fuerte las zonas muy inseguras
}

/**
 * Dijkstra sobre el grafo de zonas.
 * @param {string} mode 'safe' (distancia + riesgo) | 'short' (solo distancia)
 * @returns {{path:string[], distance:number, riskSum:number}|null}
 */
function dijkstra(zones, adj, fromId, toId, mode) {
  const byId = new Map(zones.map((z) => [z.id, z]));
  const cost = new Map(zones.map((z) => [z.id, Infinity]));
  const prev = new Map();
  const visited = new Set();
  cost.set(fromId, 0);

  while (visited.size < zones.length) {
    // Nodo no visitado con menor costo.
    let u = null;
    let best = Infinity;
    for (const [id, c] of cost) {
      if (!visited.has(id) && c < best) { best = c; u = id; }
    }
    if (u === null) break;
    if (u === toId) break;
    visited.add(u);

    for (const v of adj.get(u)) {
      if (visited.has(v)) continue;
      const edge = dist(byId.get(u), byId.get(v));
      const penalty = mode === 'safe' ? riskPenalty(v) : 0;
      const nc = cost.get(u) + edge + penalty;
      if (nc < cost.get(v)) {
        cost.set(v, nc);
        prev.set(v, u);
      }
    }
  }

  if (!prev.has(toId) && fromId !== toId) return null;

  // Reconstruye el camino.
  const path = [toId];
  let cur = toId;
  while (cur !== fromId) {
    cur = prev.get(cur);
    if (cur === undefined) return null;
    path.unshift(cur);
  }

  // Métricas reales del camino.
  let distance = 0;
  let riskSum = 0;
  for (let i = 0; i < path.length; i++) {
    riskSum += riskForZone(path[i]).score;
    if (i > 0) distance += dist(byId.get(path[i - 1]), byId.get(path[i]));
  }
  return { path, distance, riskSum };
}

/**
 * Recomienda rutas entre dos zonas.
 * Devuelve { safe, short } con las métricas de cada una, más un texto de
 * comparación. `safe` evita zonas de alto riesgo; `short` es la más directa.
 */
export function recommendRoutes(fromId, toId) {
  const zones = getZones();
  if (fromId === toId) return { error: 'El origen y el destino son la misma zona.' };
  const adj = buildGraph(zones);
  const safe = dijkstra(zones, adj, fromId, toId, 'safe');
  const short = dijkstra(zones, adj, fromId, toId, 'short');
  if (!safe || !short) return { error: 'No se encontró una ruta entre esas zonas.' };

  // Riesgo promedio por zona en cada ruta.
  safe.avgRisk = safe.riskSum / safe.path.length;
  short.avgRisk = short.riskSum / short.path.length;

  const saferBy = short.avgRisk - safe.avgRisk; // cuánto baja el riesgo
  const longerBy = safe.distance - short.distance; // cuánto se alarga
  const sameRoute = safe.path.join() === short.path.join();

  return { safe, short, saferBy, longerBy, sameRoute };
}
