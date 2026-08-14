# PME — Plataforma de Control Operativo y Proyectos

Plataforma interna para gestionar proyectos, tareas y seguimiento operativo
de un equipo de producción museográfica (diseño industrial).

## Estado actual: Fase 1 — maqueta

`index.html` es una maqueta de alta fidelidad en HTML/CSS/JS puro, **sin
backend, sin autenticación real y sin persistencia**. Los datos (proyectos,
tareas, incidencias, notas, equipo) están simulados directamente en el
script y se reinician al recargar la página. El objetivo de esta fase es
validar UX, arquitectura de información y dirección visual antes de diseñar
el modelo de datos y la arquitectura real del MVP.

Para abrir la maqueta: abre `index.html` directamente en el navegador, o
sírvelo con cualquier servidor estático.

### Qué incluye

- **Dashboard Administrador**: resumen/indicadores, tablero de proyectos y
  tareas (kanban de 3 columnas, con vistas de hoy / semana / calendario),
  panel de incidencias (abrir/resolver), feed de notas del equipo.
- **Dashboard Colaborador**: mis actividades, mis proyectos, crear nota,
  reportar incidencia — de solo lectura salvo notas e incidencias.
- Selector **"Ver como"** para previsualizar cualquiera de los dos roles y
  cualquier miembro simulado del equipo.
- Responsive: colapsa a una columna en pantallas angostas (celular).

### Roles del MVP (ver especificación completa)

Solo dos roles: `ADMIN` y `COLLABORATOR`. El colaborador consulta y reporta;
el administrador administra y decide. La especificación completa de
arquitectura, roles, incidencias, notas, autenticación y seguridad vive en
el vault del proyecto, no en este repo.

## Próxima fase (no incluida todavía)

Autenticación con Google, aprobación de usuarios, RBAC real aplicado en el
backend, Firebase (Auth + Firestore + Hosting) como plataforma, persistencia
real de los datos.
