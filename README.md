# PME — Plataforma de Control Operativo y Proyectos

Plataforma interna para gestionar proyectos, tareas y seguimiento operativo
de un equipo de producción museográfica (diseño industrial).

## Estado actual: en producción

`index.html` + `app.js` implementan la plataforma real: autenticación con
Google, Firestore como base de datos, y RBAC aplicado del lado del servidor
mediante `firestore.rules` (nunca solo ocultando botones en el frontend).

Sin build step ni bundler: el SDK modular de Firebase se carga por CDN desde
un `<script type="module">`. `index.html` es el shell (markup + estilos) y
`app.js` toda la lógica. Responsive: colapsa a una columna en pantallas
angostas — el equipo la usa desde el celular en el taller.

### Navegación del administrador

| Pestaña | Responde |
| --- | --- |
| **Resumen** | ¿Qué está pasando? Siguiente acción, lo que requiere atención, hoy, próximos días, proyectos, actividad reciente y —al final, como contexto— las métricas. |
| **Proyectos** | ¿En qué estamos trabajando? Tarjetas de proyecto con avance y desglose, y las tareas en lista / kanban / calendario (las tres muestran lo mismo, filtrado igual). |
| **Actividad** | ¿Qué ha ocurrido? Historial cronológico de incidencias y notas, con filtros de tipo, proyecto, estado y periodo. |
| **Equipo** | ¿Quién participa? Aprobar solicitudes asignando área, reasignar área/rol, restablecer NIP, revocar y reactivar acceso. |

El colaborador ve una sola pantalla: sus tareas, sus proyectos y lo que él
mismo ha registrado. De solo lectura salvo sus propias incidencias y notas.

### Modelo de datos: decisiones que no son obvias

- **`tasks.assignees: [{uid, name}]`** — una tarea admite varios
  responsables, y cualquiera puede ser alguien sin cuenta en la plataforma
  (un servicio externo de montaje, por ejemplo). Los externos llevan `uid`
  vacío.
- **`incidents.status: open | tracking | resolved | discarded`** — "alguien
  reportó esto" y "estamos trabajando en esto" son estados distintos.
  `discarded` es cerrar sin resolver, y la interfaz deliberadamente no lo
  muestra como un desenlace bueno.
- **`archived`** es una bandera aparte, no un estado, tanto en incidencias
  como en notas: permite archivar una resuelta o una descartada sin perder
  cuál fue el desenlace real.
- Todo registro nuevo lleva `ts` (milisegundos) además de la fecha, para
  ordenar y mostrar la hora en el historial.
- Los registros creados antes de estos cambios **no se migraron**: se
  normalizan al leerlos (`normalizeIncident`, `normalizeNote`, y el
  fallback de `assignees` en el listener de tareas). Si tocas esos campos,
  respeta esa normalización o se romperá lo ya capturado.

### Autenticación

- Google vía `signInWithPopup`. Se probó primero con `signInWithRedirect`,
  pero falla en producción de forma silenciosa: el navegador debe conservar
  un marcador en almacenamiento local entre la salida a Google y el regreso,
  y la protección de almacenamiento entre sitios de Chrome/Safari lo rompe.
  `signInWithPopup` no depende de esa persistencia.
- Flujo de aprobación: cualquiera puede iniciar sesión, pero queda `pending`
  hasta que un administrador le asigna área y lo aprueba. El primer
  administrador se define en `config/bootstrap.adminEmails` (ver runbook en
  el vault del proyecto).
- **NIP de administrador**: segundo filtro tras el login de Google, solo para
  el rol admin. Hash SHA-256 con sal aleatoria vía Web Crypto; se vuelve a
  pedir en cada pestaña o navegador nuevo. Es una traba de interfaz contra el
  acceso casual en una computadora compartida del taller, no una barrera
  criptográfica.

Solo dos roles: `ADMIN` y `COLLABORATOR`. La especificación completa de
arquitectura y seguridad vive en el vault del proyecto (no en este repo),
junto al manual de uso para el cliente.

## Desarrollo local (Firebase Emulator Suite)

No hay build step. Para probar todo el flujo (auth + Firestore + reglas)
sin tocar el proyecto real ni credenciales reales:

```bash
npm install
firebase emulators:start
```

Abre `http://127.0.0.1:5000` — el propio `app.js` detecta `localhost` y se
conecta automáticamente a los emuladores en vez de producción.

Para poder iniciar sesión como administrador en el emulador, siembra
`config/bootstrap` ahí (nunca afecta producción):

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run seed:emulator -- tu-correo-de-prueba@ejemplo.com
```

## Despliegue a producción

Proyecto Firebase aislado: `pme-plataforma`, ya desplegado en
https://pme-plataforma.web.app. Para desplegar cambios nuevos:

```bash
firebase deploy
```
