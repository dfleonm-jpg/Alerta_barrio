# 📍 Alerta Barrio

**Seguridad y percepción de riesgo en las comunidades**

Aplicación web que hace realidad la propuesta de solución TIC del proyecto *Alerta Barrio*,
desarrollada con la metodología **Design Thinking**. Permite **consultar y reportar**
situaciones de inseguridad por zona en **Bogotá** y en **Chía** (Cundinamarca), respondiendo a
la necesidad identificada en la investigación: *acceder de forma clara, localizada y
actualizada a la información sobre los riesgos de seguridad para tomar mejores decisiones al
desplazarse.*

> Integrantes: Daniel Felipe León Martínez · Juan Esteban Pinilla Ramírez · José Javier Pérez Bayona

---

## ✨ Funcionalidades

1. **🗺️ Mapa de percepción (Bogotá)** — Las **20 localidades** con su **geometría real**
   (contornos oficiales del DANE). Cada zona se colorea según la percepción de riesgo, que
   combina las **calificaciones ciudadanas** y los **reportes en vivo recientes**.
2. **🗺️ Mapa de percepción (Chía)** — Chía (resaltada) y sus **municipios vecinos** de la
   Sabana Centro, también con geometría real.
3. **➕ Reportes en vivo** — Formulario para publicar incidentes (**Robo, Acoso, Violencia,
   Poca iluminación, Sospechoso, Otro**) con **nivel de riesgo**, **localidad/municipio**,
   descripción y **"usar mi ubicación"** (geolocalización). Feed en vivo con **filtros por
   tipo**, estadísticas y caducidad: los reportes se **archivan tras 72 h**.
4. **🔗 Reportes ↔ mapa conectados** — Un reporte nuevo **recolorea automáticamente** la zona
   correspondiente del mapa y actualiza el ranking, las estadísticas y la sección de "últimos
   reportes" del inicio (gracias a una capa de datos reactiva).
5. **📊 Ranking por riesgo** — Zonas ordenadas de mayor a menor percepción.
6. **♿ Accesibilidad** — Enlaces "saltar al contenido", roles y `aria` en el diálogo y el mapa,
   foco visible, navegación por teclado (Enter/Escape) y soporte de `prefers-reduced-motion`.
7. **🌙 Modo oscuro** — Tema claro/oscuro con botón en la barra, persistente y respetando la
   preferencia del sistema (`prefers-color-scheme`).
8. **🔔 Toasts** — Avisos animados de éxito/error/confirmación (`assets/ui.js`).
9. **📱 Móvil primero + FAB** — Diseño responsive y **botón flotante** de "Reportar" siempre a mano.
10. **📍 Geolocalización, 📷 foto y anonimato** — El formulario permite usar tu ubicación,
    adjuntar una foto (comprimida en el navegador) y publicar con **alias** o de forma **anónima**.
11. **👍 Validación comunitaria** — Confirmar un reporte o marcarlo como **resuelto**; el feed
    muestra el estado. Filtros por **tipo**, **rango de fecha** (24 h / 7 días) y **estado**.
12. **📌 "Clustering"** — Insignias con el **conteo de reportes por zona** sobre el mapa.
13. **📲 PWA** — `manifest.json` + Service Worker (`sw.js`): **instalable** y con **app shell
    offline**.
14. **🛡️ Seguridad** — **Sanitización anti-XSS** (`AlertaData.sanitize`) en todo texto de usuario
    antes de renderizarlo, y limpieza/límite de longitud de entradas.

---

## 🚀 Cómo ejecutarla

Es una app **estática** (HTML + CSS + JS, sin frameworks ni build obligatorio). Sirve la
carpeta por HTTP y abre `index.html`:

```bash
python3 -m http.server 8080   # y abrir http://localhost:8080
```

> Se recomienda servir por HTTP (o publicar en **GitHub Pages**) porque las páginas cargan
> los scripts compartidos de `assets/` con rutas relativas. Los datos se guardan en
> `localStorage`, así que funciona **sin conexión** una vez cargada.

---

## 🧱 Arquitectura

Todas las páginas comparten un mismo sistema de diseño y una **capa de datos única**, lo que
elimina la duplicación anterior.

```
index.html            → landing (hero + mini-mapa + últimos reportes)
alerta-barrio.html    → mapa interactivo de Bogotá
informacion.html      → mapa interactivo de Chía + vecinos
reportes.html         → formulario + feed de reportes en vivo
assets/
  app.css             → sistema de diseño compartido (incluye modo oscuro, toasts, FAB…)
  data.js             → CAPA DE DATOS: geometría de zonas, ratings, comentarios y
                        reportes (con estado/votos/alias/foto); escala de calor; sanitize;
                        pub/sub reactivo; store conmutable Local/Firebase
  map.js              → render del mapa + ranking + panel + badges de conteo — reactivo
  report.js           → página de reportes (form, geolocalización, foto, votos, filtros)
  ui.js               → toasts + modo oscuro persistente (reutilizable)
  icon.svg            → icono de la PWA
manifest.json         → manifiesto PWA (instalable)
sw.js                 → Service Worker (app shell offline)
```

**Flujo de datos:** las páginas solo hablan con `AlertaData` (en `data.js`). Cuando algo
cambia, `data.js` notifica a sus suscriptores (`AlertaData.subscribe`) y el mapa/feed se
redibujan solos. También se sincroniza **entre pestañas** del mismo navegador vía el evento
`storage`.

---

## 🔌 Conectar un backend real (Firebase)

Por defecto los datos son **locales** (`LocalStore`, cada usuario ve los suyos). Para
compartir reportes entre usuarios **en tiempo real**, `data.js` está preparado para cambiar
de "store" sin tocar el resto de la app:

1. Añade el SDK de Firebase a las páginas (o usa módulos ES) e inicializa `db`.
2. Implementa un `FirebaseStore` con la misma interfaz que `LocalStore`
   (`getState()`, `setState(mutator)`, `subscribe(fn)`), usando Firestore/RTDB. Hay una
   **plantilla comentada** dentro de `assets/data.js`.
   - En `setState` persiste el cambio (p. ej. `addDoc`/`setDoc`).
   - Suscríbete a los `onSnapshot` y llama a `this._emit()` en cada actualización.
   - Mantén la **misma forma de estado** que `emptyState()`:
     `{ ratings, comments, reports }`.
3. Actívalo **antes** de `AlertaMap.init(...)` / `AlertaReport.init()`:

   ```html
   <script src="assets/data.js"></script>
   <script type="module">
     // ...inicializa Firebase y crea `db`...
     AlertaData.useStore(new FirebaseStore(db));
   </script>
   <script src="assets/map.js"></script>
   ```

No hace falta cambiar `map.js` ni `report.js`: todo pasa por la capa de datos.

### 📷 Fotos: de base64 local a Firebase Storage

Hoy las fotos se **comprimen en el navegador** (máx. 720 px, JPEG ~0.7) y se guardan como
`dataURL` dentro del reporte (campo `photo`). Para producción, en el `FirebaseStore.setState`
sube el `dataURL`/`Blob` a **Firebase Storage** y guarda solo la **URL de descarga** en el
reporte; así Firestore no almacena imágenes pesadas.

---

## 🗺️ Sobre la geometría de los mapas

Los contornos provienen del **Marco Geoestadístico Nacional (DANE)** en formato TopoJSON,
**simplificados** (Douglas–Peucker) y proyectados a coordenadas SVG. **Sumapaz** se muestra
como un recuadro aparte por su gran tamaño rural (si se dibujara a escala, la zona urbana
quedaría minúscula), tal como en los mapas ilustrados de la ciudad.

## 📌 Alcance

La aplicación **no pretende resolver la inseguridad**, sino **centralizar y facilitar el
acceso** a la información para que las personas tomen decisiones más informadas. Los datos son
reportados por usuarios y reflejan **percepción**, no cifras oficiales de criminalidad.
