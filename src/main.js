// ============================================================================
// Alerta Barrio — punto de entrada. Router simple basado en hash + vistas.
// ============================================================================
import {
  getZones, getZone, getIncidents, getIncidentsForZone, countByZone,
  riskForZone, addIncident, getActiveAlerts, resetData,
  INCIDENT_TYPES, RISK_LEVELS, typeMeta,
} from './data.js';
import { renderMap, nearestZone } from './map.js';
import { recommendRoutes } from './routes.js';
import { timeAgo, esc, el } from './utils.js';

const app = document.getElementById('app');
let mapFilter = 'all'; // filtro de nivel en la vista de mapa
// Ubicación simulada del usuario (para las alertas de proximidad).
let userLocationZoneId = null;

// Iconos SVG inline (siempre se renderizan, aunque el dispositivo no tenga emojis).
const ICONS = {
  pin: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z"/></svg>',
  map: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/></svg>',
  route: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="19" r="2.4"/><circle cx="18" cy="5" r="2.4"/><path d="M8.4 19H14a3.5 3.5 0 0 0 0-7H10a3.5 3.5 0 0 1 0-7h5.6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  bell: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
};

// ---------------------------------------------------------------------------
// Router (#/mapa, #/reportar, #/zona/:id, #/alertas, #/rutas)
// ---------------------------------------------------------------------------
function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, param] = hash.split('/');
  return { name: name || 'mapa', param: param || null };
}

function navigate(path) {
  location.hash = path;
}

function render() {
  const { name, param } = parseRoute();
  let view, active;
  switch (name) {
    case 'reportar': view = ReportView(param); active = 'reportar'; break;
    case 'zona':     view = ZoneView(param);   active = 'mapa';     break;
    case 'rutas':    view = RoutesView();       active = 'rutas';    break;
    case 'alertas':  view = AlertsView();       active = 'alertas';  break;
    case 'mapa':
    default:         view = MapView();          active = 'mapa';     break;
  }

  app.innerHTML = '';
  const shell = el('div', { class: 'shell' }, [
    Header(),
    el('main', { class: 'content' }, [view]),
    BottomNav(active),
  ]);
  app.appendChild(shell);
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------
// Componentes de chrome (header + nav inferior)
// ---------------------------------------------------------------------------
function Header() {
  const brand = el('div', { class: 'appbar-brand' });
  brand.innerHTML = ICONS.pin + '<span>Alerta Barrio</span>';
  const header = el('header', { class: 'appbar' }, [brand]);
  const reset = el('button', {
    class: 'appbar-reset', title: 'Restablecer datos de demostración',
    onclick: () => {
      if (confirm('¿Restablecer los datos de demostración? Se perderán tus reportes locales.')) {
        resetData();
        navigate('mapa');
        render();
      }
    },
  }, '↺');
  header.appendChild(reset);
  return header;
}

function BottomNav(active) {
  const item = (id, iconSvg, label) => {
    const btn = el('button', {
      class: `nav-item${active === id ? ' is-active' : ''}`,
      onclick: () => navigate(id === 'reportar' ? 'reportar' : id),
    });
    const ic = el('span', { class: 'nav-icon' });
    ic.innerHTML = iconSvg;
    btn.append(ic, el('span', { class: 'nav-label' }, label));
    return btn;
  };

  return el('nav', { class: 'bottom-nav' }, [
    item('mapa', ICONS.map, 'Mapa'),
    item('rutas', ICONS.route, 'Rutas'),
    item('reportar', ICONS.plus, 'Reportar'),
    item('alertas', ICONS.bell, 'Alertas'),
  ]);
}

// ---------------------------------------------------------------------------
// Vista 1 — Mapa / Inicio
// ---------------------------------------------------------------------------
function MapView() {
  const wrap = el('div', { class: 'view view-map' });

  // Buscador de zona.
  const search = el('input', {
    class: 'search', type: 'search', placeholder: 'Buscar zona…', 'aria-label': 'Buscar zona',
  });

  const mapBox = el('div', { class: 'map-box' });
  const legend = el('div', { class: 'legend' }, [
    LegendChip('all', 'Todas'),
    LegendChip('alto', RISK_LEVELS.alto.label, RISK_LEVELS.alto.color),
    LegendChip('medio', RISK_LEVELS.medio.label, RISK_LEVELS.medio.color),
    LegendChip('bajo', RISK_LEVELS.bajo.label, RISK_LEVELS.bajo.color),
  ]);

  const list = el('div', { class: 'zone-list' });
  const proximityHost = el('div');

  const paint = () => {
    const userZone = userLocationZoneId ? getZone(userLocationZoneId) : null;
    renderMap(mapBox, (zoneId) => navigate(`zona/${zoneId}`), {
      filterLevel: mapFilter,
      userPoint: userZone ? { x: userZone.x, y: userZone.y } : null,
    });
    paintList(list, search.value);
    renderProximity(proximityHost);
  };

  search.addEventListener('input', () => paintList(list, search.value));

  wrap.append(
    el('div', { class: 'view-head' }, [
      el('h1', {}, 'Mapa de la ciudad'),
      el('p', { class: 'muted' }, 'Zonas de riesgo y mapa de calor según los reportes de la comunidad.'),
    ]),
    proximityHost,
    LocationPicker(() => paint()),
    search,
    mapBox,
    legend,
    el('h2', { class: 'section-title' }, 'Zonas'),
    list,
  );

  // Pinta después de montar (para que el SVG tenga dimensiones).
  setTimeout(paint, 0);
  // Guarda la función de repintado en el chip de leyenda.
  legend.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      mapFilter = chip.dataset.level;
      legend.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c === chip));
      paint();
    });
  });

  return wrap;
}

function LegendChip(level, label, color) {
  return el('button', {
    class: `chip${mapFilter === level ? ' is-active' : ''}`, 'data-level': level,
  }, [
    color ? el('span', { class: 'dot', style: `background:${color}` }) : null,
    label,
  ]);
}

function paintList(container, query = '') {
  const q = query.trim().toLowerCase();
  const zones = getZones()
    .map((z) => ({ z, risk: riskForZone(z.id), reports: countByZone(z.id) }))
    .filter(({ z }) => !q || z.name.toLowerCase().includes(q) || (z.localidad || '').toLowerCase().includes(q))
    .sort((a, b) => b.risk.score - a.risk.score);

  container.innerHTML = '';
  if (zones.length === 0) {
    container.appendChild(el('p', { class: 'muted empty' }, 'No se encontraron zonas.'));
    return;
  }
  for (const { z, risk, reports } of zones) {
    container.appendChild(
      el('button', {
        class: 'zone-card', onclick: () => navigate(`zona/${z.id}`),
      }, [
        el('span', { class: 'zone-badge', style: `background:${risk.level.color}` }, risk.level.label),
        el('span', { class: 'zone-card-body' }, [
          el('span', { class: 'zone-card-name' }, z.name),
          el('span', { class: 'zone-card-meta muted' }, `${z.localidad} · ${reports} reportes`),
        ]),
        el('span', { class: 'zone-card-chevron' }, '›'),
      ])
    );
  }
}

// ---------------------------------------------------------------------------
// Vista 2 — Reportar alerta
// ---------------------------------------------------------------------------
function ReportView(preselectZone) {
  const wrap = el('div', { class: 'view view-report' });
  const state = { zoneId: preselectZone || '', type: 'robo', level: 'medio', note: '' };

  const zoneSelect = el('select', { class: 'field-input', 'aria-label': 'Ubicación' }, [
    el('option', { value: '' }, 'Selecciona la zona en el mapa…'),
    ...getZones().map((z) =>
      el('option', { value: z.id, ...(z.id === state.zoneId ? { selected: 'selected' } : {}) },
        `${z.name} (${z.localidad})`)
    ),
  ]);
  zoneSelect.addEventListener('change', () => { state.zoneId = zoneSelect.value; });

  // Tipo de incidente (radios).
  const typeGroup = el('div', { class: 'options' },
    INCIDENT_TYPES.map((t) =>
      OptionRadio('type', t.id, `${t.icon} ${t.label}`, t.id === state.type, (v) => (state.type = v))
    )
  );

  // Nivel percibido (chips).
  const levelGroup = el('div', { class: 'level-pills' },
    Object.values(RISK_LEVELS).sort((a, b) => a.order - b.order).map((lv) =>
      el('button', {
        type: 'button',
        class: `pill${lv.id === state.level ? ' is-active' : ''}`,
        style: `--pill:${lv.color}`,
        'data-level': lv.id,
        onclick: (e) => {
          state.level = lv.id;
          levelGroup.querySelectorAll('.pill').forEach((p) => p.classList.toggle('is-active', p === e.currentTarget));
        },
      }, lv.label)
    )
  );

  const note = el('textarea', {
    class: 'field-input', rows: '3', maxlength: '200',
    placeholder: 'Describe brevemente lo ocurrido (opcional)…',
  });
  note.addEventListener('input', () => (state.note = note.value));

  const feedback = el('div', { class: 'form-feedback', 'aria-live': 'polite' });

  const submit = el('button', { class: 'btn-primary btn-block' }, 'Enviar reporte');
  submit.addEventListener('click', () => {
    if (!state.zoneId) {
      feedback.textContent = 'Selecciona una zona antes de enviar.';
      feedback.classList.add('is-error');
      zoneSelect.focus();
      return;
    }
    addIncident(state);
    const zone = getZone(state.zoneId);
    feedback.classList.remove('is-error');
    wrap.innerHTML = '';
    wrap.appendChild(SuccessCard(zone));
  });

  wrap.append(
    el('div', { class: 'view-head' }, [
      el('h1', {}, 'Reportar alerta'),
      el('p', { class: 'muted' }, 'Registra la ubicación, el tipo de incidente y el nivel de riesgo.'),
    ]),
    el('label', { class: 'field' }, [ el('span', { class: 'field-label' }, '📍 Ubicación'), zoneSelect ]),
    el('div', { class: 'field' }, [ el('span', { class: 'field-label' }, 'Tipo de incidente'), typeGroup ]),
    el('div', { class: 'field' }, [ el('span', { class: 'field-label' }, 'Nivel percibido'), levelGroup ]),
    el('label', { class: 'field' }, [ el('span', { class: 'field-label' }, 'Detalle'), note ]),
    feedback,
    submit,
  );
  return wrap;
}

function OptionRadio(name, value, label, checked, onChange) {
  const input = el('input', { type: 'radio', name, value, ...(checked ? { checked: 'checked' } : {}) });
  input.addEventListener('change', () => onChange(value));
  return el('label', { class: 'option' }, [ input, el('span', {}, label) ]);
}

function SuccessCard(zone) {
  return el('div', { class: 'success-card' }, [
    el('div', { class: 'success-icon' }, '✅'),
    el('h2', {}, '¡Reporte enviado!'),
    el('p', { class: 'muted' }, zone
      ? `Tu reporte en “${zone.name}” fue registrado y el mapa de calor se actualizó.`
      : 'Tu reporte fue registrado.'),
    el('div', { class: 'success-actions' }, [
      zone ? el('button', { class: 'btn-primary', onclick: () => navigate(`zona/${zone.id}`) }, 'Ver la zona') : null,
      el('button', { class: 'btn-ghost', onclick: () => navigate('mapa') }, 'Volver al mapa'),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Vista 3 — Información de zona
// ---------------------------------------------------------------------------
function ZoneView(zoneId) {
  const zone = getZone(zoneId);
  const wrap = el('div', { class: 'view view-zone' });
  if (!zone) {
    wrap.append(
      el('p', { class: 'muted' }, 'Zona no encontrada.'),
      el('button', { class: 'btn-ghost', onclick: () => navigate('mapa') }, '‹ Volver al mapa'),
    );
    return wrap;
  }

  const { level } = riskForZone(zone.id);
  const incidents = getIncidentsForZone(zone.id);

  const miniMap = el('div', { class: 'map-box map-box--mini' });
  setTimeout(() => renderMap(miniMap, (id) => navigate(`zona/${id}`), 'all'), 0);

  wrap.append(
    el('button', { class: 'back-link', onclick: () => navigate('mapa') }, '‹ Volver al mapa'),
    el('div', { class: 'view-head' }, [
      el('h1', {}, zone.name),
      el('p', { class: 'muted' }, zone.localidad),
    ]),
    miniMap,
    el('div', { class: 'risk-banner', style: `--risk:${level.color}` }, [
      el('span', { class: 'risk-dot', style: `background:${level.color}` }),
      el('span', {}, [ 'Nivel de riesgo: ', el('strong', { style: `color:${level.color}` }, level.label) ]),
    ]),
    el('div', { class: 'stat-row' }, [
      Stat(String(incidents.length), 'Reportes en la zona'),
      Stat(String(incidents.filter((i) => Date.now() - i.ts <= 24 * 3600000).length), 'En las últimas 24 h'),
    ]),
    el('p', { class: 'zone-desc' }, zone.descripcion),
    el('h2', { class: 'section-title' }, 'Últimos reportes'),
    IncidentList(incidents),
    el('button', {
      class: 'btn-primary btn-block', onclick: () => navigate(`reportar/${zone.id}`),
    }, '➕ Reportar en esta zona'),
  );
  return wrap;
}

function Stat(value, label) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'stat-value' }, value),
    el('div', { class: 'stat-label muted' }, label),
  ]);
}

function IncidentList(incidents) {
  if (!incidents.length) {
    return el('p', { class: 'muted empty' }, 'Aún no hay reportes en esta zona.');
  }
  return el('ul', { class: 'incident-list' },
    incidents.slice(0, 15).map((i) => {
      const t = typeMeta(i.type);
      const color = RISK_LEVELS[i.level].color;
      return el('li', { class: 'incident' }, [
        el('span', { class: 'incident-icon', style: `background:${color}22;color:${color}` }, t.icon),
        el('span', { class: 'incident-body' }, [
          el('span', { class: 'incident-title' }, t.label),
          i.note ? el('span', { class: 'incident-note muted' }, i.note) : null,
        ]),
        el('span', { class: 'incident-time muted' }, timeAgo(i.ts)),
      ]);
    })
  );
}

// ---------------------------------------------------------------------------
// Vista 4 — Alertas
// ---------------------------------------------------------------------------
function AlertsView() {
  const wrap = el('div', { class: 'view view-alerts' });
  const alerts = getActiveAlerts();

  wrap.append(
    el('div', { class: 'view-head' }, [
      el('h1', {}, 'Alertas'),
      el('p', { class: 'muted' }, 'Incidentes recientes o de nivel alto cerca de las zonas monitoreadas.'),
    ]),
  );

  if (!alerts.length) {
    wrap.appendChild(el('p', { class: 'muted empty' }, 'No hay alertas activas por ahora.'));
    return wrap;
  }

  wrap.appendChild(
    el('ul', { class: 'alert-list' },
      alerts.map((a) => {
        const t = typeMeta(a.type);
        const color = RISK_LEVELS[a.level].color;
        return el('li', {
          class: 'alert-card', onclick: () => a.zone && navigate(`zona/${a.zone.id}`),
        }, [
          el('span', { class: 'alert-bar', style: `background:${color}` }),
          el('span', { class: 'alert-body' }, [
            el('span', { class: 'alert-title' }, [
              el('span', { class: 'alert-emoji' }, t.icon),
              `${t.label} — ${a.zone ? a.zone.name : 'Zona'}`,
            ]),
            el('span', { class: 'alert-meta muted' }, `${RISK_LEVELS[a.level].label} · ${timeAgo(a.ts)}`),
            a.note ? el('span', { class: 'alert-note muted' }, a.note) : null,
          ]),
          el('span', { class: 'zone-card-chevron' }, '›'),
        ]);
      })
    )
  );
  return wrap;
}

// ---------------------------------------------------------------------------
// Ubicación simulada + alertas de proximidad
// ---------------------------------------------------------------------------
function LocationPicker(onChange) {
  const select = el('select', { class: 'field-input loc-select', 'aria-label': 'Mi ubicación' }, [
    el('option', { value: '' }, '📍 Simular mi ubicación…'),
    ...getZones().map((z) =>
      el('option', { value: z.id, ...(z.id === userLocationZoneId ? { selected: 'selected' } : {}) }, z.name)
    ),
  ]);
  select.addEventListener('change', () => {
    userLocationZoneId = select.value || null;
    onChange && onChange();
  });
  return el('div', { class: 'loc-picker' }, [select]);
}

// Umbral de proximidad (en unidades del mapa 0..100).
const PROXIMITY_RADIUS = 18;

function renderProximity(host) {
  host.innerHTML = '';
  if (!userLocationZoneId) return;
  const userZone = getZone(userLocationZoneId);
  if (!userZone) return;

  const { zone, distance } = nearestZone({ x: userZone.x, y: userZone.y });
  // Evalúa el riesgo de la propia zona del usuario.
  const own = riskForZone(userZone.id);
  // Y busca la zona de alto riesgo más cercana dentro del radio.
  let nearbyHigh = null;
  let nearbyD = Infinity;
  for (const z of getZones()) {
    if (z.id === userZone.id) continue;
    const d = Math.hypot(z.x - userZone.x, z.y - userZone.y);
    const r = riskForZone(z.id);
    if (r.level.id === 'alto' && d <= PROXIMITY_RADIUS && d < nearbyD) {
      nearbyD = d; nearbyHigh = { zone: z, risk: r };
    }
  }

  if (own.level.id === 'alto') {
    host.appendChild(ProximityBanner('alto',
      `Estás en una zona de riesgo ALTO: ${userZone.name}. Mantente atento y evita mostrar objetos de valor.`,
      userZone.id));
  } else if (nearbyHigh) {
    host.appendChild(ProximityBanner('alto',
      `Cerca de una zona de riesgo alto: ${nearbyHigh.zone.name}. Considera una ruta más segura.`,
      nearbyHigh.zone.id));
  } else if (own.level.id === 'medio') {
    host.appendChild(ProximityBanner('medio',
      `Tu zona (${userZone.name}) tiene un riesgo medio. Precaución al desplazarte.`,
      userZone.id));
  } else {
    host.appendChild(ProximityBanner('bajo',
      `Tu zona (${userZone.name}) se percibe con riesgo bajo por ahora.`,
      userZone.id));
  }
}

function ProximityBanner(level, text, zoneId) {
  const color = RISK_LEVELS[level].color;
  const icon = level === 'alto' ? '🔴' : level === 'medio' ? '🟠' : '🟢';
  return el('div', {
    class: 'proximity-banner', style: `--risk:${color}`,
    onclick: () => zoneId && navigate(`zona/${zoneId}`),
    role: 'button', tabindex: '0',
  }, [
    el('span', { class: 'proximity-icon' }, icon),
    el('span', { class: 'proximity-text' }, text),
  ]);
}

// ---------------------------------------------------------------------------
// Vista 5 — Rutas seguras
// ---------------------------------------------------------------------------
function RoutesView() {
  const wrap = el('div', { class: 'view view-routes' });
  const zones = getZones();
  const state = { from: userLocationZoneId || zones[0].id, to: '' };

  const buildSelect = (label, key, includeEmpty) => {
    const sel = el('select', { class: 'field-input', 'aria-label': label }, [
      includeEmpty ? el('option', { value: '' }, 'Selecciona el destino…') : null,
      ...zones.map((z) =>
        el('option', { value: z.id, ...(z.id === state[key] ? { selected: 'selected' } : {}) },
          `${z.name} (${z.localidad})`)
    ),
    ].filter(Boolean));
    sel.addEventListener('change', () => { state[key] = sel.value; update(); });
    return sel;
  };

  const mapBox = el('div', { class: 'map-box' });
  const result = el('div', { class: 'route-result' });

  const update = () => {
    if (!state.to || !state.from) {
      renderMap(mapBox, (id) => navigate(`zona/${id}`), 'all');
      result.innerHTML = '';
      result.appendChild(el('p', { class: 'muted' }, 'Elige un origen y un destino para ver la ruta más segura.'));
      return;
    }
    const rec = recommendRoutes(state.from, state.to);
    if (rec.error) {
      renderMap(mapBox, (id) => navigate(`zona/${id}`), 'all');
      result.innerHTML = '';
      result.appendChild(el('p', { class: 'muted' }, rec.error));
      return;
    }
    // Dibuja la ruta segura sobre el mapa.
    renderMap(mapBox, (id) => navigate(`zona/${id}`), {
      filterLevel: 'all', routePath: rec.safe.path, highlight: rec.safe.path,
    });
    paintRouteResult(result, rec, zones);
  };

  wrap.append(
    el('div', { class: 'view-head' }, [
      el('h1', {}, 'Rutas seguras'),
      el('p', { class: 'muted' }, 'Te sugerimos el recorrido que evita las zonas de mayor riesgo.'),
    ]),
    el('label', { class: 'field' }, [ el('span', { class: 'field-label' }, '🟢 Origen'), buildSelect('Origen', 'from', false) ]),
    el('label', { class: 'field' }, [ el('span', { class: 'field-label' }, '🏁 Destino'), buildSelect('Destino', 'to', true) ]),
    mapBox,
    result,
  );

  setTimeout(update, 0);
  return wrap;
}

function paintRouteResult(container, rec, zones) {
  const byId = new Map(zones.map((z) => [z.id, z]));
  container.innerHTML = '';

  const { safe, saferBy, longerBy, sameRoute } = rec;
  const avgLevel =
    safe.avgRisk >= 7 ? RISK_LEVELS.alto : safe.avgRisk >= 4 ? RISK_LEVELS.medio : RISK_LEVELS.bajo;

  // Resumen.
  container.appendChild(
    el('div', { class: 'route-summary', style: `--risk:${avgLevel.color}` }, [
      el('div', { class: 'route-summary-head' }, [
        el('span', { class: 'risk-dot', style: `background:${avgLevel.color}` }),
        el('strong', {}, `Ruta recomendada · riesgo ${avgLevel.label.toLowerCase()}`),
      ]),
      el('p', { class: 'muted' },
        sameRoute
          ? 'La ruta más directa ya es también la más segura disponible.'
          : `Esta ruta reduce el riesgo promedio ${saferBy.toFixed(1)} puntos${longerBy > 0.5 ? `, con un pequeño rodeo` : ''} frente a la más directa.`),
    ])
  );

  // Pasos.
  container.appendChild(el('h2', { class: 'section-title' }, `Recorrido (${safe.path.length} zonas)`));
  container.appendChild(
    el('ol', { class: 'route-steps' },
      safe.path.map((id, i) => {
        const z = byId.get(id);
        const r = riskForZone(id);
        const isEnd = i === 0 || i === safe.path.length - 1;
        return el('li', { class: `route-step${isEnd ? ' is-end' : ''}`, onclick: () => navigate(`zona/${id}`) }, [
          el('span', { class: 'route-step-dot', style: `background:${r.level.color}` }),
          el('span', { class: 'route-step-body' }, [
            el('span', { class: 'route-step-name' }, z ? z.name : id),
            el('span', { class: 'route-step-meta muted' }, `${z ? z.localidad : ''} · riesgo ${r.level.label.toLowerCase()}`),
          ]),
        ]);
      })
    )
  );
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', () => {
  // Da un instante al splash y arranca.
  setTimeout(render, 250);
});
// Si el DOM ya está listo (module carga tarde), renderiza igual.
if (document.readyState !== 'loading') setTimeout(render, 250);
