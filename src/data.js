// ============================================================================
// Alerta Barrio — Capa de datos
// ----------------------------------------------------------------------------
// Modelo de datos, datos semilla (derivados de las entrevistas del proyecto)
// y persistencia en localStorage. Sin dependencias externas.
// ============================================================================

const STORAGE_KEY = 'alerta_barrio_v1';

// Tipos de incidente soportados (coinciden con el wireframe "Reportar alerta").
export const INCIDENT_TYPES = [
  { id: 'robo', label: 'Robo', icon: '🚨' },
  { id: 'acoso', label: 'Acoso', icon: '⚠️' },
  { id: 'violencia', label: 'Violencia', icon: '🆘' },
  { id: 'iluminacion', label: 'Poca iluminación', icon: '💡' },
  { id: 'otro', label: 'Otro', icon: '❔' },
];

// Niveles de riesgo percibido.
export const RISK_LEVELS = {
  alto: { id: 'alto', label: 'Alto', color: '#e53935', order: 3 },
  medio: { id: 'medio', label: 'Medio', color: '#fb8c00', order: 2 },
  bajo: { id: 'bajo', label: 'Bajo', color: '#43a047', order: 1 },
};

export function levelFromScore(score) {
  if (score >= 7) return RISK_LEVELS.alto;
  if (score >= 4) return RISK_LEVELS.medio;
  return RISK_LEVELS.bajo;
}

// ----------------------------------------------------------------------------
// Zonas de Bogotá. Las coordenadas x/y son posiciones relativas (0..100) sobre
// nuestro mapa esquemático (SVG). lat/lng son aproximadas y solo informativas.
// Cada zona nace de un hallazgo real de las entrevistas del documento.
// ----------------------------------------------------------------------------
const SEED_ZONES = [
  {
    id: 'san-victorino',
    name: 'San Victorino / Plaza de la Mariposa',
    localidad: 'Santa Fe',
    x: 46, y: 55,
    baseScore: 9,
    descripcion:
      'Zona de comercio informal con alta afluencia. Los robos son frecuentes y la vigilancia es insuficiente, sobre todo al anochecer.',
  },
  {
    id: 'av-jimenez',
    name: 'Avenida Jiménez',
    localidad: 'La Candelaria',
    x: 50, y: 51,
    baseScore: 8,
    descripcion:
      'Calles con mucha congestión donde la aglomeración facilita los robos. Mayor riesgo durante la noche.',
  },
  {
    id: 'ricaurte',
    name: 'Estación Ricaurte / Calle 13',
    localidad: 'Los Mártires',
    x: 40, y: 57,
    baseScore: 8,
    descripcion:
      'Alrededores de la estación con poca vigilancia en algunos sectores. Riesgo al esperar transporte a solas de noche.',
  },
  {
    id: 'av-caracas-lourdes',
    name: 'Av. Caracas (Cll 60–72) / Parque Lourdes',
    localidad: 'Chapinero',
    x: 58, y: 40,
    baseScore: 8,
    descripcion:
      'Pasos peatonales temporales por obras del metro y andenes reducidos por ventas informales. Inseguridad permanente que se agrava de noche.',
  },
  {
    id: 'parque-timiza',
    name: 'Parque Timiza',
    localidad: 'Kennedy',
    x: 28, y: 74,
    baseScore: 7,
    descripcion:
      'Sin iluminación alrededor y muy solitario en la noche (7pm–3am). Difícil pedir ayuda si ocurre algo.',
  },
  {
    id: 'parque-tunal',
    name: 'Parque El Tunal y alrededores',
    localidad: 'Tunjuelito',
    x: 44, y: 80,
    baseScore: 6,
    descripcion:
      'Calles residenciales que quedan poco transitadas después de las 7 de la noche, con poca iluminación.',
  },
  {
    id: 'barrios-vecinos',
    name: 'Calles de barrios vecinos',
    localidad: 'Bogotá',
    x: 66, y: 66,
    baseScore: 6,
    descripcion:
      'Poca vigilancia al caer la tarde. Presencia reportada de ladrones de celulares en moto.',
  },
  {
    id: 'puentes-peatonales',
    name: 'Puentes peatonales y calles poco transitadas',
    localidad: 'Bogotá',
    x: 72, y: 52,
    baseScore: 5,
    descripcion:
      'Poca iluminación y falta de personas después de las 8 de la noche, especialmente al caminar solo.',
  },
];

// Genera una marca de tiempo hace N horas.
function hoursAgo(h) {
  return Date.now() - h * 60 * 60 * 1000;
}

// Reportes semilla, distribuidos entre las zonas para poblar el mapa de calor.
const SEED_INCIDENTS = [
  { zoneId: 'san-victorino', type: 'robo', level: 'alto', ts: hoursAgo(0.3), note: 'Robo de celular en plena plaza.' },
  { zoneId: 'san-victorino', type: 'acoso', level: 'medio', ts: hoursAgo(1), note: 'Acoso a transeúntes.' },
  { zoneId: 'san-victorino', type: 'robo', level: 'alto', ts: hoursAgo(3), note: 'Hurto a un vendedor.' },
  { zoneId: 'san-victorino', type: 'robo', level: 'alto', ts: hoursAgo(9) },
  { zoneId: 'av-jimenez', type: 'robo', level: 'alto', ts: hoursAgo(2), note: 'Cosquilleo en aglomeración.' },
  { zoneId: 'av-jimenez', type: 'robo', level: 'medio', ts: hoursAgo(6) },
  { zoneId: 'ricaurte', type: 'robo', level: 'alto', ts: hoursAgo(1.5), note: 'Robo cerca de la estación.' },
  { zoneId: 'ricaurte', type: 'otro', level: 'medio', ts: hoursAgo(8), note: 'Sujeto sospechoso rondando.' },
  { zoneId: 'av-caracas-lourdes', type: 'robo', level: 'alto', ts: hoursAgo(0.8), note: 'Hurto en paso temporal del metro.' },
  { zoneId: 'av-caracas-lourdes', type: 'iluminacion', level: 'medio', ts: hoursAgo(12), note: 'Tramo sin luz por obras.' },
  { zoneId: 'parque-timiza', type: 'iluminacion', level: 'alto', ts: hoursAgo(5), note: 'Parque totalmente a oscuras.' },
  { zoneId: 'parque-timiza', type: 'robo', level: 'medio', ts: hoursAgo(20) },
  { zoneId: 'parque-tunal', type: 'robo', level: 'medio', ts: hoursAgo(4), note: 'Robo a persona que regresaba a casa.' },
  { zoneId: 'parque-tunal', type: 'iluminacion', level: 'medio', ts: hoursAgo(15) },
  { zoneId: 'barrios-vecinos', type: 'robo', level: 'medio', ts: hoursAgo(7), note: 'Ladrones en moto.' },
  { zoneId: 'puentes-peatonales', type: 'iluminacion', level: 'bajo', ts: hoursAgo(10) },
  { zoneId: 'puentes-peatonales', type: 'otro', level: 'bajo', ts: hoursAgo(30) },
];

let _id = 1;
function nextId() {
  return `inc_${Date.now().toString(36)}_${(_id++).toString(36)}`;
}

// ----------------------------------------------------------------------------
// Estado en memoria + persistencia
// ----------------------------------------------------------------------------
function buildSeedState() {
  const incidents = SEED_INCIDENTS.map((i) => ({
    id: nextId(),
    zoneId: i.zoneId,
    type: i.type,
    level: i.level,
    note: i.note || '',
    ts: i.ts,
    source: 'seed',
  }));
  return { zones: SEED_ZONES, incidents };
}

let state = null;

function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Siempre reconciliamos con las zonas semilla (por si agregamos nuevas).
      const zoneMap = new Map(SEED_ZONES.map((z) => [z.id, z]));
      (parsed.zones || []).forEach((z) => zoneMap.set(z.id, z));
      state = { zones: [...zoneMap.values()], incidents: parsed.incidents || [] };
      return state;
    }
  } catch (e) {
    console.warn('No se pudo leer el almacenamiento local, usando datos semilla.', e);
  }
  state = buildSeedState();
  save();
  return state;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('No se pudo guardar en el almacenamiento local.', e);
  }
}

// ----------------------------------------------------------------------------
// API pública de la capa de datos
// ----------------------------------------------------------------------------

export function getZones() {
  return load().zones.slice();
}

export function getZone(zoneId) {
  return load().zones.find((z) => z.id === zoneId) || null;
}

export function getIncidents() {
  // Más recientes primero.
  return load().incidents.slice().sort((a, b) => b.ts - a.ts);
}

export function getIncidentsForZone(zoneId) {
  return getIncidents().filter((i) => i.zoneId === zoneId);
}

// Cantidad de reportes por zona.
export function countByZone(zoneId) {
  return load().incidents.filter((i) => i.zoneId === zoneId).length;
}

// Puntaje de riesgo dinámico de una zona: combina su base con los reportes
// recientes (últimas 24h pesan más). Devuelve un objeto con score y nivel.
export function riskForZone(zoneId) {
  const zone = getZone(zoneId);
  if (!zone) return { score: 0, level: RISK_LEVELS.bajo };
  const now = Date.now();
  let bonus = 0;
  for (const inc of getIncidentsForZone(zoneId)) {
    const ageH = (now - inc.ts) / 3_600_000;
    const recency = ageH <= 24 ? 1 : ageH <= 72 ? 0.5 : 0.2;
    const weight = inc.level === 'alto' ? 1.2 : inc.level === 'medio' ? 0.7 : 0.3;
    bonus += recency * weight;
  }
  const score = Math.min(10, zone.baseScore * 0.6 + bonus);
  return { score, level: levelFromScore(score) };
}

// Añade un nuevo reporte. `report` = { zoneId, type, level, note }.
export function addIncident(report) {
  const s = load();
  const incident = {
    id: nextId(),
    zoneId: report.zoneId,
    type: report.type,
    level: report.level,
    note: (report.note || '').trim(),
    ts: Date.now(),
    source: 'user',
  };
  s.incidents.push(incident);
  save();
  return incident;
}

// Alertas: zonas con reportes muy recientes (< 3h) o de nivel alto.
export function getActiveAlerts() {
  const now = Date.now();
  return getIncidents()
    .filter((i) => now - i.ts <= 3 * 3_600_000 || i.level === 'alto')
    .slice(0, 20)
    .map((i) => ({ ...i, zone: getZone(i.zoneId) }));
}

// Reinicia todo a los datos semilla (útil para demostraciones).
export function resetData() {
  state = buildSeedState();
  save();
  return state;
}

export function typeMeta(typeId) {
  return INCIDENT_TYPES.find((t) => t.id === typeId) || INCIDENT_TYPES[INCIDENT_TYPES.length - 1];
}
