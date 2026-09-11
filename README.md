# 📍 Alerta Barrio

**Seguridad y percepción de riesgo en las comunidades**

Aplicación web que hace realidad la propuesta de solución TIC del proyecto *Alerta Barrio*,
desarrollada con la metodología **Design Thinking**. Permite **consultar y reportar**
situaciones de inseguridad en las zonas de Bogotá, respondiendo a la necesidad identificada
en la investigación: *acceder de forma clara, localizada y actualizada a la información sobre
los riesgos de seguridad para tomar mejores decisiones al desplazarse.*

> Integrantes: Daniel Felipe León Martínez · Juan Esteban Pinilla Ramírez · José Javier Pérez Bayona

---

## ✨ Funcionalidades (según los wireframes del MVP)

La app implementa exactamente el flujo definido en el documento:

1. **🗺️ Inicio / Mapa** — Mapa de la ciudad con **zonas de riesgo** y **mapa de calor**,
   marcadores por nivel (Alto / Medio / Bajo), buscador de zona y filtro por nivel.
2. **➕ Reportar alerta** — El ciudadano registra la **ubicación**, el **tipo de incidente**
   (Robo, Acoso, Violencia, Poca iluminación, Otro) y el **nivel percibido**.
3. **ℹ️ Información de zona** — Muestra el **nivel de riesgo**, la **cantidad de reportes** y
   los **últimos incidentes** de la zona.
4. **🔔 Alertas** — Lista los incidentes recientes o de nivel alto.

### Funcionalidades complementarias (propuesta TIC)

5. **🧭 Rutas seguras** — Recomienda el recorrido entre dos zonas que **evita las de mayor
   riesgo**. Calcula la ruta con un algoritmo tipo Dijkstra sobre un grafo de zonas, donde
   el costo combina la distancia con una **penalización por nivel de riesgo**. Dibuja la
   ruta sobre el mapa, la desglosa por pasos y la **compara** con la ruta más directa
   (cuánto baja el riesgo y cuánto se alarga el recorrido).
6. **📍 Alertas de proximidad** — Puedes *simular tu ubicación* y la app te **avisa** si
   estás en (o cerca de) una zona de riesgo alto, con un banner destacado en el mapa y un
   marcador pulsante de "mi ubicación".

### Flujo del sistema

```
Ciudadano → Reporta incidente → El sistema registra ubicación y datos →
Analiza cantidad de reportes → Actualiza el mapa de calor →
El usuario consulta el mapa → Recibe alerta si está cerca de una zona de riesgo
```

Los datos semilla provienen de los **resultados reales de las 10 entrevistas** del proyecto
(San Victorino, Parque Timiza, Av. Caracas / Parque Lourdes, Estación Ricaurte, Parque El
Tunal, Av. Jiménez, etc.). Los reportes que crees se guardan en tu navegador
(`localStorage`) y actualizan el mapa de calor y las estadísticas en tiempo real.

---

## 🚀 Cómo ejecutarla

**La forma más simple:** abre el archivo **`index.html`** con doble clic. La app es
totalmente autocontenida (todo el HTML, CSS y JavaScript va embebido en ese único archivo),
así que **no necesita servidor ni instalación** y funciona sin conexión a internet.

También puedes publicarla tal cual en **GitHub Pages** (Settings → Pages) o servirla por HTTP:

```bash
python3 -m http.server 8080   # y abrir http://localhost:8080
```

### 🛠️ Para desarrollar

El código fuente vive de forma modular y legible en `src/`. Después de editarlo, se
regenera el `index.html` autocontenido con:

```bash
node build-standalone.mjs
```

Este script concatena los módulos de `src/`, elimina los `import`/`export` y embebe todo
(junto con `src/styles.css`) dentro de `index.html`. Así se evita que el navegador bloquee
los módulos ES al abrir con `file://`.

El botón **↺** de la barra superior restablece los datos de demostración.

---

## 🧱 Arquitectura

Aplicación **sin frameworks ni dependencias** (HTML + CSS + JavaScript con módulos ES),
pensada para funcionar completamente **offline**. El mapa es un **SVG dibujado a mano**
(no usa tiles externos), por lo que no depende de ninguna conexión.

```
index.html          → punto de entrada y splash
src/
  main.js           → router por hash + vistas (Mapa, Rutas, Reportar, Zona, Alertas)
  map.js            → mapa esquemático en SVG: mapa de calor, marcadores, ruta y ubicación
  routes.js         → motor de rutas seguras (grafo de zonas + Dijkstra ponderado por riesgo)
  data.js           → modelo de datos, datos semilla y persistencia (localStorage)
  utils.js          → utilidades (tiempo relativo, helpers de DOM)
  styles.css        → estilos mobile-first
```

## 📌 Alcance

Tal como se define en la propuesta, la aplicación **no pretende resolver la inseguridad**,
sino **centralizar y facilitar el acceso** a la información para que las personas tomen
decisiones más informadas sobre sus desplazamientos.
