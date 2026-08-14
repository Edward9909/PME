# PME — Plataforma de Control Operativo y Proyectos

Plataforma interna para gestionar proyectos, tareas y seguimiento operativo
de un equipo de producción museográfica (diseño industrial).

## Estado actual: Fase 2 — MVP funcional (Firebase)

`index.html` + `app.js` implementan la plataforma real: autenticación con
Google, Firestore como base de datos, y RBAC aplicado del lado del servidor
mediante `firestore.rules` (nunca solo ocultando botones en el frontend).

- **Dashboard Administrador**: resumen/indicadores, tablero de proyectos y
  tareas (kanban de 3 columnas, con vistas de hoy / semana / calendario),
  panel de incidencias (abrir/resolver), feed de notas del equipo, y pestaña
  **Usuarios** (aceptar solicitudes asignando área, reasignar área/rol,
  revocar acceso, reactivar).
- **Dashboard Colaborador**: mis actividades, mis proyectos, crear nota,
  reportar incidencia — de solo lectura salvo notas e incidencias propias.
- Autenticación con Google vía `signInWithRedirect` (no popup — más
  confiable en celular, que es el dispositivo principal del equipo en el
  taller).
- Flujo de aprobación: cualquiera puede iniciar sesión, pero queda
  `pending` hasta que un administrador le asigna área y lo aprueba. El
  primer administrador se define en `config/bootstrap.adminEmails` (ver
  runbook en el vault del proyecto).
- Responsive: colapsa a una columna en pantallas angostas.

Solo dos roles: `ADMIN` y `COLLABORATOR`. La especificación completa de
arquitectura y seguridad vive en el vault del proyecto (no en este repo).

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

Proyecto Firebase aislado: `pme-plataforma`. Antes del primer deploy hacen
falta dos pasos manuales de una sola vez (documentados con el enlace exacto
en el MOC del proyecto en el vault): habilitar la API de Firestore y
habilitar Google como proveedor de sign-in en Firebase Auth. Después:

```bash
firebase deploy
```
