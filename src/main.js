// ============================================================================
// Alerta Barrio — punto de entrada. Router simple basado en hash + vistas.
// ============================================================================
import {
  getZones, getZone, getIncidents, getIncidentsForZone, countByZone,
  riskForZone, addIncident, getActiveAlerts, resetData,
  INCIDENT_TYPES, RISK_LEVELS, typeMeta,
} from './data.js';
import { renderMap } from './map.js';
import { timeAgo, esc, el } from './utils.js';

const app = document.getElementById('app');
let mapFilter = 'all'; // filtro de nivel en la vista de mapa

// ---------------------------------------------------------------------------
// Router (#/mapa, #/reportar, #/zona/:id, #/alertas)
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
  return el('header', { class: 'appbar' }, [
    el('div', { class: 'appbar-brand' }, [
      el('span', { class: 'appbar-pin' }, '📍'),
      el('span', {}, 'Alerta Barrio'),
    ]),
    el('button', {
      class: 'appbar-reset', title: 'Restablecer datos de demostración',
      onclick: () => {
        if (confirm('¿Restablecer los datos de demostración? Se perderán tus reportes locales.')) {
          resetData();
          navigate('mapa');
          render();
        }
      },
    }, '↺'),
  ]);
}

function BottomNav(active) {
  const item = (id, icon, label) =>
    el('button', {
      class: `nav-item${active === id ? ' is-active' : ''}`,
      onclick: () => navigate(id === 'reportar' ? 'reportar' : id),
    }, [
      el('span', { class: 'nav-icon' }, icon),
      el('span', { class: 'nav-label' }, label),
    ]);

  return el('nav', { class: 'bottom-nav' }, [
    item('mapa', '🗺️', 'Mapa'),
    item('reportar', '➕', 'Reportar'),
    item('alertas', '🔔', 'Alertas'),
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

  const paint = () => {
    renderMap(mapBox, (zoneId) => navigate(`zona/${zoneId}`), mapFilter);
    paintList(list, search.value);
  };

  search.addEventListener('input', () => paintList(list, search.value));

  wrap.append(
    el('div', { class: 'view-head' }, [
      el('h1', {}, 'Mapa de la ciudad'),
      el('p', { class: 'muted' }, 'Zonas de riesgo y mapa de calor según los reportes de la comunidad.'),
    ]),
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
// Arranque
// ---------------------------------------------------------------------------
window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', () => {
  // Da un instante al splash y arranca.
  setTimeout(render, 250);
});
// Si el DOM ya está listo (module carga tarde), renderiza igual.
if (document.readyState !== 'loading') setTimeout(render, 250);
