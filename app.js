/* ================= Firebase ================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
    connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection,
    onSnapshot, serverTimestamp, connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
    projectId: "pme-plataforma",
    appId: "1:716307447702:web:7845f5e816902f80cce7b7",
    storageBucket: "pme-plataforma.firebasestorage.app",
    apiKey: "AIzaSyAkFSX-ZPH14aVtmJPOEMrP0MmAMlzH8dI",
    authDomain: "pme-plataforma.firebaseapp.com",
    messagingSenderId: "716307447702",
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const provider = new GoogleAuthProvider();

// En local (firebase emulators:start) se conecta a los emuladores en vez del
// proyecto real, para poder probar todo el flujo sin credenciales reales.
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

/* ================= constantes ================= */
const AREA_ORDER = ['produccion', 'diseno', 'gestion', 'compras', 'pedidos', 'cotizacion', 'montaje'];
const AREA_LABEL = { produccion: 'Producción', diseno: 'Diseño', gestion: 'Gestión', compras: 'Compras', pedidos: 'Pedidos', cotizacion: 'Cotización', montaje: 'Montaje' };
const AREA_CODE = { produccion: 'PR', diseno: 'DI', gestion: 'GE', compras: 'CO', pedidos: 'PE', cotizacion: 'CZ', montaje: 'MO' };
const GENERAL_PROJECT = { id: 'general', name: 'Tareas generales', client: 'Sin proyecto asignado', deadline: '', status: 'activo', general: true };

const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const todayStr = () => new Date().toISOString().slice(0, 10);

/* ================= estado ================= */
let currentUser = null; // { uid, email, name, photoURL, role, area, status }
let authReady = false;

let adminTab = 'resumen'; // resumen | proyectos | incidencias | notas | usuarios
let activeProjectId = 'general';
let activeAreaFilter = 'todas';
let sortMode = 'due';
let showFinished = false;
let editingTaskId = null;
let editingProjectId = null;
let viewMode = 'project'; // project | today | week | calendar (dentro de Proyectos)
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let selectedCalDay = null;
let noteFormOpen = false;
let incidentFormOpen = false;

const DATA = { projects: [], tasks: [], incidents: [], notes: [], users: [] };
let unsubscribers = [];
let unsubUserDoc = null;

document.getElementById('today').textContent = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

/* ================= helpers compartidos ================= */
function escapeHtml(str) { const div = document.createElement('div'); div.textContent = str || ''; return div.innerHTML; }
function escapeAttr(str) { return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; }
function isOverdue(iso, col) { return iso && col !== 2 && iso < todayStr(); }
function isDueToday(iso, col) { return iso && col !== 2 && iso === todayStr(); }
function allProjects() { return [GENERAL_PROJECT, ...DATA.projects]; }
function projectById(pid) { return allProjects().find(p => p.id === pid); }
function projectName(pid) { const p = projectById(pid); return p ? p.name : '—'; }
function taskById(tid) { return DATA.tasks.find(t => t.id === tid); }
function projectTasks(pid) { return DATA.tasks.filter(t => t.projectId === pid); }
function userById(uid) { return DATA.users.find(u => u.uid === uid); }
function activeUsers() { return DATA.users.filter(u => u.status === 'active'); }
function myTasks() { return DATA.tasks.filter(t => t.assigneeUid === currentUser.uid); }

function sortedProjectList() {
    const active = DATA.projects.filter(p => p.status !== 'finalizado');
    const finished = DATA.projects.filter(p => p.status === 'finalizado');
    const byDeadline = arr => {
        const withD = arr.filter(p => p.deadline);
        const withoutD = arr.filter(p => !p.deadline);
        withD.sort((a, b) => a.deadline.localeCompare(b.deadline));
        return [...withD, ...withoutD];
    };
    return showFinished ? [...byDeadline(active), ...byDeadline(finished)] : byDeadline(active);
}

function areaOptions(selected) {
    return AREA_ORDER.map(a => `<option value="${a}" ${a === selected ? 'selected' : ''}>${AREA_LABEL[a]}</option>`).join('');
}
function memberOptions(selectedUid) {
    const opts = activeUsers().map(u => `<option value="${u.uid}" ${u.uid === selectedUid ? 'selected' : ''}>${escapeHtml(u.name)} — ${AREA_LABEL[u.area] || 'sin área'}</option>`).join('');
    return `<option value="">— sin responsable —</option>` + opts;
}
function projectOptions(selected) {
    return allProjects().map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
}
function taskOptionsFor(pid, selected) {
    const opts = projectTasks(pid).map(t => `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${escapeHtml(t.title)}</option>`).join('');
    return `<option value="">— sin tarea asociada —</option>` + opts;
}

/* ================= autenticación =================
   Se usa signInWithPopup (no signInWithRedirect): el flujo de redirección
   depende de que el navegador conserve un marcador en almacenamiento local
   entre la salida a Google y el regreso a la app, y la protección de
   almacenamiento entre sitios de los navegadores modernos (Chrome, Safari)
   puede romper esa persistencia — se comprobó que fallaba en producción de
   forma silenciosa (redirigía a Google y volvía sin iniciar sesión, sin
   ningún error). El popup se comunica en vivo con la ventana que lo abrió,
   sin depender de ese guardado. */
async function signInGoogle() {
    try { await signInWithPopup(auth, provider); }
    catch (e) {
        if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
        console.error('Error al iniciar sesión', e);
        alert('No se pudo iniciar sesión: ' + e.message);
    }
}

async function signOutUser() {
    teardownDataListeners();
    await signOut(auth);
}

async function ensureUserDoc(fbUser) {
    const uref = doc(db, 'users', fbUser.uid);
    const snap = await getDoc(uref);
    if (snap.exists()) return;
    let adminEmails = [];
    try {
        const bootSnap = await getDoc(doc(db, 'config', 'bootstrap'));
        if (bootSnap.exists()) adminEmails = bootSnap.data().adminEmails || [];
    } catch (e) { console.warn('No se pudo leer config/bootstrap', e); }
    const isBootstrap = adminEmails.includes(fbUser.email);
    await setDoc(uref, {
        email: fbUser.email,
        name: fbUser.displayName || fbUser.email,
        photoURL: fbUser.photoURL || '',
        role: isBootstrap ? 'admin' : 'collaborator',
        area: null,
        status: isBootstrap ? 'active' : 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
}

onAuthStateChanged(auth, async (fbUser) => {
    if (unsubUserDoc) { unsubUserDoc(); unsubUserDoc = null; }
    teardownDataListeners();
    if (!fbUser) { currentUser = null; authReady = true; renderAll(); return; }
    try {
        await ensureUserDoc(fbUser);
    } catch (e) {
        console.error('No se pudo crear el perfil de usuario', e);
    }
    const uref = doc(db, 'users', fbUser.uid);
    unsubUserDoc = onSnapshot(uref, (snap) => {
        currentUser = snap.exists() ? { uid: fbUser.uid, ...snap.data() } : null;
        authReady = true;
        if (currentUser && currentUser.status === 'active') ensureDataListeners();
        else teardownDataListeners();
        renderAll();
    }, err => console.error('user doc listener', err));
});

/* ================= listeners de datos (solo si activo) ================= */
function ensureDataListeners() {
    if (unsubscribers.length) return;

    unsubscribers.push(onSnapshot(collection(db, 'projects'), snap => {
        DATA.projects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAll();
    }, err => console.error('projects listener', err)));

    unsubscribers.push(onSnapshot(collection(db, 'tasks'), snap => {
        DATA.tasks = snap.docs.map(d => {
            const v = d.data();
            return { id: d.id, ...v, assignee: v.assigneeName || '' };
        });
        renderAll();
    }, err => console.error('tasks listener', err)));

    unsubscribers.push(onSnapshot(collection(db, 'incidents'), snap => {
        DATA.incidents = snap.docs.map(d => {
            const v = d.data();
            return { id: d.id, ...v, reportedBy: v.reportedByName || '', resolvedBy: v.resolvedByName || '' };
        });
        renderAll();
    }, err => console.error('incidents listener', err)));

    unsubscribers.push(onSnapshot(collection(db, 'notes'), snap => {
        DATA.notes = snap.docs.map(d => {
            const v = d.data();
            return { id: d.id, ...v, author: v.authorName || '' };
        });
        renderAll();
    }, err => console.error('notes listener', err)));

    if (currentUser.role === 'admin') {
        unsubscribers.push(onSnapshot(collection(db, 'users'), snap => {
            DATA.users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
            renderAll();
        }, err => console.error('users listener', err)));
    }
}

function teardownDataListeners() {
    unsubscribers.forEach(u => u());
    unsubscribers = [];
    DATA.projects = []; DATA.tasks = []; DATA.incidents = []; DATA.notes = []; DATA.users = [];
}

/* ================= render raíz ================= */
function renderAll() {
    const sessionHolder = document.getElementById('session-bar-holder');
    const alertHolder = document.getElementById('alert-banner-holder');
    const root = document.getElementById('app-root');

    if (!authReady) { root.innerHTML = ''; sessionHolder.innerHTML = ''; alertHolder.innerHTML = ''; return; }

    if (!currentUser) {
        sessionHolder.innerHTML = '';
        alertHolder.innerHTML = '';
        root.innerHTML = loginScreenHtml();
        document.getElementById('google-signin-btn').addEventListener('click', signInGoogle);
        return;
    }

    renderSessionBar();

    if (currentUser.status !== 'active') {
        alertHolder.innerHTML = '';
        root.innerHTML = gateScreenHtml(currentUser.status);
        return;
    }

    if (currentUser.role === 'admin') {
        root.innerHTML = adminShell();
        mountAdminTab();
    } else {
        root.innerHTML = collabShell();
        renderAlertBannerFor(myTasks());
        mountCollabSections();
    }
}

function renderSessionBar() {
    const holder = document.getElementById('session-bar-holder');
    const roleLabel = currentUser.role === 'admin' ? 'Administrador' : 'Colaborador';
    holder.innerHTML = `
    <div class="session-bar">
      <span>${escapeHtml(currentUser.name || currentUser.email)}</span>
      <span class="tag role-tag">${roleLabel}${currentUser.area ? ' · ' + (AREA_LABEL[currentUser.area] || currentUser.area) : ''}</span>
      <button id="signout-btn">cerrar sesión</button>
    </div>`;
    document.getElementById('signout-btn').addEventListener('click', signOutUser);
}

function loginScreenHtml() {
    return `
    <div class="gate-screen">
      <h2>PME — Plataforma operativa</h2>
      <p>Inicia sesión con tu cuenta de Google para ver tus proyectos y tareas.</p>
      <button class="google-btn" id="google-signin-btn">Continuar con Google</button>
    </div>`;
}

function gateScreenHtml(status) {
    if (status === 'revoked') {
        return `
      <div class="gate-screen">
        <span class="gate-badge err">acceso revocado</span>
        <h2>Tu acceso fue revocado</h2>
        <p>Un administrador desactivó tu cuenta. Si crees que es un error, contacta al administrador de PME.</p>
      </div>`;
    }
    return `
    <div class="gate-screen">
      <span class="gate-badge">pendiente de aprobación</span>
      <h2>Cuenta creada</h2>
      <p>Tu cuenta ya existe pero todavía no fue aprobada. Un administrador debe asignarte un área para que puedas ver tus proyectos y tareas.</p>
    </div>`;
}

/* ================= dashboard administrador ================= */
function tabBadge(n) { return n > 0 ? `<span class="tab-badge">${n}</span>` : ''; }

function adminShell() {
    const proyectosCount = DATA.tasks.filter(t => isOverdue(t.due, t.col) || isDueToday(t.due, t.col)).length;
    const incidenciasCount = DATA.incidents.filter(i => i.status === 'open').length;
    const notasCount = DATA.notes.filter(n => n.createdAt === todayStr()).length;
    const usuariosCount = DATA.users.filter(u => u.status === 'pending').length;
    return `
    <div class="tabbar" id="admin-tabbar">
      <button data-tab="resumen">Resumen</button>
      <button data-tab="proyectos">Proyectos${tabBadge(proyectosCount)}</button>
      <button data-tab="incidencias">Incidencias${tabBadge(incidenciasCount)}</button>
      <button data-tab="notas">Notas${tabBadge(notasCount)}</button>
      <button data-tab="usuarios">Usuarios${tabBadge(usuariosCount)}</button>
    </div>
    <div id="admin-tab-content"></div>
  `;
}

function mountAdminTab() {
    document.querySelectorAll('#admin-tabbar button').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === adminTab);
        b.addEventListener('click', () => { adminTab = b.dataset.tab; renderAll(); });
    });
    renderAlertBannerFor(DATA.tasks);
    const content = document.getElementById('admin-tab-content');
    if (adminTab === 'resumen') { content.innerHTML = resumenView(); return; }
    if (adminTab === 'incidencias') { content.innerHTML = incidenciasView(true); return; }
    if (adminTab === 'notas') { content.innerHTML = notasView(true); return; }
    if (adminTab === 'usuarios') { content.innerHTML = usuariosView(); return; }
    content.innerHTML = proyectosViewShell();
    mountProyectosView();
}

function resumenView() {
    const activeProj = DATA.projects.filter(p => p.status !== 'finalizado');
    const overdueProj = activeProj.filter(p => p.deadline && p.deadline < todayStr());
    const porHacer = DATA.tasks.filter(t => t.col === 0).length;
    const enCurso = DATA.tasks.filter(t => t.col === 1).length;
    const hecho = DATA.tasks.filter(t => t.col === 2).length;
    const overdueTasks = DATA.tasks.filter(t => isOverdue(t.due, t.col));
    const openIncidents = DATA.incidents.filter(i => i.status === 'open');
    const pendingUsers = DATA.users.filter(u => u.status === 'pending');
    const cards = [
        { num: activeProj.length, label: 'Proyectos activos', warn: false },
        { num: overdueProj.length, label: 'Proyectos vencidos', warn: overdueProj.length > 0 },
        { num: porHacer, label: 'Tareas por hacer', warn: false },
        { num: enCurso, label: 'Tareas en curso', warn: false },
        { num: hecho, label: 'Tareas hechas', warn: false },
        { num: overdueTasks.length, label: 'Tareas vencidas', warn: overdueTasks.length > 0 },
        { num: openIncidents.length, label: 'Incidencias abiertas', warn: openIncidents.length > 0 },
        { num: pendingUsers.length, label: 'Usuarios pendientes', warn: pendingUsers.length > 0 },
    ];
    const attention = [
        ...overdueTasks.map(t => ({ kind: 'Tarea vencida', title: t.title, sub: projectName(t.projectId) + ' · ' + (t.assignee || 'sin responsable') })),
        ...openIncidents.map(i => ({ kind: 'Incidencia abierta', title: i.title, sub: projectName(i.projectId) + ' · reportó ' + i.reportedBy })),
        ...pendingUsers.map(u => ({ kind: 'Usuario pendiente', title: u.name || u.email, sub: 'esperando aprobación en la pestaña Usuarios' })),
    ];
    return `
    <div class="indicator-grid">
      ${cards.map(c => `
        <div class="indicator-card ${c.warn ? 'warn' : ''}">
          <div class="num ${c.warn ? 'warn-num' : ''}">${c.num}</div>
          <div class="label">${c.label}</div>
        </div>`).join('')}
    </div>
    <p class="section-label"><span>Necesita tu atención</span></p>
    ${attention.length === 0 ? '<div class="empty">Nada pendiente de atención en este momento.</div>' :
            `<div class="today-list">${attention.map(a => `
        <div class="today-item overdue">
          <p class="title">${escapeHtml(a.title)}</p>
          <div class="meta"><span class="tag overdue">${a.kind}</span><span>${escapeHtml(a.sub)}</span></div>
        </div>`).join('')}</div>`}
  `;
}

function incidenciasView(isAdmin) {
    const list = [...DATA.incidents].sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.reportedAt.localeCompare(a.reportedAt));
    return `
    <p class="section-label"><span>Incidencias</span></p>
    ${list.length === 0 ? '<div class="empty">Sin incidencias registradas.</div>' : list.map(i => incidentCardHtml(i, isAdmin)).join('')}
  `;
}

function incidentCardHtml(i, isAdmin) {
    return `
    <div class="incident-card ${i.status}">
      <div class="top-row">
        <div>
          <h3>${escapeHtml(i.title)}</h3>
          <div class="meta">
            <span class="tag project-tag">${escapeHtml(projectName(i.projectId))}</span>
            ${i.taskId ? `<span>${escapeHtml((taskById(i.taskId) || {}).title || '')}</span>` : ''}
            <span>reportó ${escapeHtml(i.reportedBy)} · ${fmtDate(i.reportedAt)}</span>
            <span class="tag status-${i.status}">${i.status === 'open' ? 'abierta' : 'resuelta'}</span>
          </div>
          <p>${escapeHtml(i.description)}</p>
          ${i.status === 'resolved' ? `
            <div class="resolution-box">
              <span class="rlabel">Resolución · ${escapeHtml(i.resolvedBy)} · ${fmtDate(i.resolvedAt)}</span>
              ${escapeHtml(i.resolution)}
            </div>` : ''}
        </div>
        ${isAdmin && i.status === 'open' ? `<button class="resolve-btn" onclick="startResolveIncident('${i.id}')">marcar resuelta</button>` : ''}
      </div>
      <div id="resolve-form-${i.id}"></div>
    </div>
  `;
}

function startResolveIncident(id) {
    const holder = document.getElementById('resolve-form-' + id);
    holder.innerHTML = `
    <div class="inline-form show" style="margin-top:10px;">
      <textarea id="resolution-text-${id}" placeholder="Describe cómo se resolvió..."></textarea>
      <div class="row-actions">
        <button class="cancel" onclick="document.getElementById('resolve-form-${id}').innerHTML=''">Cancelar</button>
        <button onclick="confirmResolveIncident('${id}')">Marcar como resuelta</button>
      </div>
    </div>`;
}

async function confirmResolveIncident(id) {
    const text = document.getElementById('resolution-text-' + id).value.trim();
    await updateDoc(doc(db, 'incidents', id), {
        status: 'resolved',
        resolvedByUid: currentUser.uid,
        resolvedByName: currentUser.name,
        resolvedAt: todayStr(),
        resolution: text || 'Resuelta sin comentario adicional.',
    });
}

function notasView(isAdmin) {
    const list = [...DATA.notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return `
    <p class="section-label"><span>Notas del equipo</span></p>
    ${list.length === 0 ? '<div class="empty">Sin notas todavía.</div>' : list.map(n => `
      <div class="note-card">
        <div class="meta">
          <strong>${escapeHtml(n.author)}</strong>
          <span class="tag project-tag">${escapeHtml(projectName(n.projectId))}</span>
          ${n.taskId ? `<span>${escapeHtml((taskById(n.taskId) || {}).title || '')}</span>` : ''}
          <span>${fmtDate(n.createdAt)}</span>
        </div>
        <p>${escapeHtml(n.text)}</p>
      </div>
    `).join('')}
  `;
}

/* ---------- pestaña Usuarios ---------- */
function usuariosView() {
    const pending = DATA.users.filter(u => u.status === 'pending');
    const active = DATA.users.filter(u => u.status === 'active');
    const revoked = DATA.users.filter(u => u.status === 'revoked');

    const rowHtml = (u, kind) => `
    <div class="user-row ${u.status}">
      <div class="who">
        <p class="name">${escapeHtml(u.name || u.email)}</p>
        <span class="email">${escapeHtml(u.email)}</span>
      </div>
      ${kind !== 'revoked' ? `
        <select id="role-${u.uid}">
          <option value="collaborator" ${u.role === 'collaborator' ? 'selected' : ''}>Colaborador</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option>
        </select>
        <select id="area-${u.uid}">
          <option value="">— sin área —</option>
          ${AREA_ORDER.map(a => `<option value="${a}" ${u.area === a ? 'selected' : ''}>${AREA_LABEL[a]}</option>`).join('')}
        </select>
      ` : ''}
      ${kind === 'pending' ? `<button onclick="approveUser('${u.uid}')">aceptar</button>` : ''}
      ${kind === 'active' ? `<button onclick="saveUserFields('${u.uid}')">guardar</button><button class="revoke" onclick="revokeUser('${u.uid}')">revocar acceso</button>` : ''}
      ${kind === 'revoked' ? `<button onclick="reactivateUser('${u.uid}')">reactivar</button>` : ''}
    </div>`;

    return `
    <p class="section-label"><span>Pendientes de aprobación</span></p>
    ${pending.length === 0 ? '<div class="empty">Sin solicitudes pendientes.</div>' : pending.map(u => rowHtml(u, 'pending')).join('')}
    <p class="section-label" style="margin-top:22px;"><span>Activos</span></p>
    ${active.length === 0 ? '<div class="empty">Sin usuarios activos todavía.</div>' : active.map(u => rowHtml(u, 'active')).join('')}
    ${revoked.length ? `<p class="section-label" style="margin-top:22px;"><span>Revocados</span></p>${revoked.map(u => rowHtml(u, 'revoked')).join('')}` : ''}
  `;
}

async function approveUser(uid) {
    const role = document.getElementById('role-' + uid).value;
    const area = document.getElementById('area-' + uid).value || null;
    if (!area) { alert('Asigna un área antes de aceptar.'); return; }
    await updateDoc(doc(db, 'users', uid), { role, area, status: 'active', updatedAt: serverTimestamp() });
}

async function saveUserFields(uid) {
    const role = document.getElementById('role-' + uid).value;
    const area = document.getElementById('area-' + uid).value || null;
    await updateDoc(doc(db, 'users', uid), { role, area, updatedAt: serverTimestamp() });
}

async function revokeUser(uid) {
    if (!confirm('¿Revocar el acceso de este usuario? Perderá acceso de inmediato.')) return;
    await updateDoc(doc(db, 'users', uid), { status: 'revoked', updatedAt: serverTimestamp() });
}

async function reactivateUser(uid) {
    await updateDoc(doc(db, 'users', uid), { status: 'active', updatedAt: serverTimestamp() });
}

/* ---------- pestaña Proyectos (tablero completo, editable) ---------- */
function proyectosViewShell() {
    return `
    <div class="view-buttons">
      <button class="today-btn" id="today-toggle-btn"></button>
      <button class="today-btn" id="week-toggle-btn"></button>
      <button class="today-btn" id="cal-toggle-btn"></button>
    </div>
    <div id="project-sub-view"></div>
  `;
}

function mountProyectosView() {
    renderProyectosButtons();
    document.getElementById('today-toggle-btn').addEventListener('click', () => setSubView(viewMode === 'today' ? 'project' : 'today'));
    document.getElementById('week-toggle-btn').addEventListener('click', () => setSubView(viewMode === 'week' ? 'project' : 'week'));
    document.getElementById('cal-toggle-btn').addEventListener('click', () => setSubView(viewMode === 'calendar' ? 'project' : 'calendar'));
    renderProjectSubView();
}

function setSubView(mode) { viewMode = mode; renderAll(); }

function renderProyectosButtons() {
    const overdueTasks = DATA.tasks.filter(t => isOverdue(t.due, t.col));
    const todayTasks = DATA.tasks.filter(t => isDueToday(t.due, t.col));
    const total = overdueTasks.length + todayTasks.length;
    const btn = document.getElementById('today-toggle-btn');
    btn.classList.toggle('in-today', viewMode === 'today');
    btn.innerHTML = viewMode === 'today' ? '← volver a proyectos' : `Ver tareas de hoy ${total ? '<span class="count">' + total + '</span>' : ''}`;

    const weekDates = weekWindowDates();
    const weekTasks = DATA.tasks.filter(t => t.col !== 2 && t.due && weekDates.includes(t.due));
    const weekBtn = document.getElementById('week-toggle-btn');
    weekBtn.classList.toggle('in-today', viewMode === 'week');
    weekBtn.innerHTML = viewMode === 'week' ? '← volver a proyectos' : `Resumen semanal ${weekTasks.length ? '<span class="count">' + weekTasks.length + '</span>' : ''}`;

    const calBtn = document.getElementById('cal-toggle-btn');
    calBtn.classList.toggle('in-today', viewMode === 'calendar');
    calBtn.innerHTML = viewMode === 'calendar' ? '← volver a proyectos' : 'Calendario';
}

function weekWindowDates() {
    const dates = [];
    for (let i = 0; i < 7; i++) dates.push(addDays(i));
    return dates;
}

function renderProjectSubView() {
    const holder = document.getElementById('project-sub-view');
    if (viewMode === 'today') { holder.innerHTML = todayViewHtml(DATA.tasks); return; }
    if (viewMode === 'week') { holder.innerHTML = weekViewHtml(DATA.tasks); return; }
    if (viewMode === 'calendar') { holder.innerHTML = calendarShellHtml(); mountCalendar(); return; }
    holder.innerHTML = projectBoardShellHtml();
    mountProjectBoard();
}

function todayViewHtml(taskPool) {
    const list = taskPool.filter(t => t.col !== 2 && t.due && t.due <= todayStr()).sort((a, b) => a.due.localeCompare(b.due));
    if (list.length === 0) return '<p class="section-label"><span>Tareas de hoy y vencidas</span></p><div class="empty">No hay tareas vencidas ni para hoy. 🎉</div>';
    return `<p class="section-label"><span>Tareas de hoy y vencidas</span></p><div class="today-list">${list.map(t => taskTodayItemHtml(t, true)).join('')}</div>`;
}

function taskTodayItemHtml(t, withDone) {
    const overdue = isOverdue(t.due, t.col);
    return `
    <div class="today-item ${overdue ? 'overdue' : ''}">
      <div class="top-row">
        <div>
          <p class="title">${escapeHtml(t.title)}</p>
          <div class="meta">
            <span class="tag project-tag">${escapeHtml(projectName(t.projectId))}</span>
            <span class="tag area-${t.area}">${escapeHtml(AREA_LABEL[t.area] || t.area)}</span>
            ${t.assignee ? '<span>' + escapeHtml(t.assignee) + '</span>' : ''}
            <span class="tag ${overdue ? 'overdue' : 'due'}">${overdue ? 'vencida ' : 'entrega '}${fmtDate(t.due)}</span>
            ${t.priority === 'urgente' ? '<span class="tag urgent">urgente</span>' : ''}
          </div>
          ${t.notes ? `<p class="card-notes">${escapeHtml(t.notes)}</p>` : ''}
        </div>
        ${withDone ? `<button class="done-btn" onclick="markDone('${t.id}')">marcar hecho</button>` : ''}
      </div>
    </div>`;
}

async function markDone(id) { await updateDoc(doc(db, 'tasks', id), { col: 2 }); }

function weekViewHtml(taskPool) {
    const weekDates = weekWindowDates();
    const groups = weekDates.map(dateIso => ({ dateIso, tasks: taskPool.filter(t => t.col !== 2 && t.due === dateIso) }));
    const any = groups.some(g => g.tasks.length > 0);
    let inner = '<p class="section-label"><span>Resumen de la semana</span></p>';
    if (!any) return inner + '<div class="empty">No hay entregas programadas en los próximos 7 días.</div>';
    const dayLabel = iso => { const d = new Date(iso + 'T00:00:00'); const l = d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' }); return iso === todayStr() ? l + ' (hoy)' : l; };
    inner += groups.map(g => `
    <div class="week-group">
      <div class="week-group-head"><span>${dayLabel(g.dateIso)}</span><span class="day-count">${g.tasks.length ? g.tasks.length + ' tarea' + (g.tasks.length > 1 ? 's' : '') : 'sin entregas'}</span></div>
      ${g.tasks.length ? `<div class="today-list">${g.tasks.map(t => taskTodayItemHtml(t, true)).join('')}</div>` : ''}
    </div>`).join('');
    return inner;
}

function calendarShellHtml() {
    return `
    <div class="cal-head"><button id="cal-prev-btn">&larr;</button><span class="cal-title" id="cal-title"></span><button id="cal-next-btn">&rarr;</button></div>
    <div class="cal-grid" id="cal-grid"></div>
    <p class="section-label" id="cal-day-label" style="display:none;"></p>
    <div class="today-list" id="cal-day-tasks"></div>
  `;
}

function mountCalendar() {
    document.getElementById('cal-prev-btn').addEventListener('click', () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } selectedCalDay = null; renderCalendar(); });
    document.getElementById('cal-next-btn').addEventListener('click', () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } selectedCalDay = null; renderCalendar(); });
    renderCalendar();
}

function tasksForDate(iso) { return DATA.tasks.filter(t => t.col !== 2 && t.due === iso); }

function renderCalendar() {
    const first = new Date(calYear, calMonth, 1);
    const startWeekday = first.getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    document.getElementById('cal-title').textContent = first.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    const dows = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
    let html = dows.map(d => `<div class="cal-dow">${d}</div>`).join('');
    for (let i = 0; i < startWeekday; i++) html += '<div class="cal-day empty"></div>';
    for (let day = 1; day <= daysInMonth; day++) {
        const iso = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const tasks = tasksForDate(iso);
        const overdueHere = tasks.some(t => isOverdue(t.due, t.col));
        const areasPresent = [...new Set(tasks.map(t => t.area))];
        const classes = ['cal-day'];
        if (iso === todayStr()) classes.push('today');
        if (iso === selectedCalDay) classes.push('selected');
        if (overdueHere) classes.push('overdue-day');
        html += `<div class="${classes.join(' ')}" onclick="selectCalDay('${iso}')"><span class="cal-day-num">${day}</span><div class="cal-dots">${areasPresent.map(a => `<span class="cal-dot area-${a}"></span>`).join('')}</div></div>`;
    }
    document.getElementById('cal-grid').innerHTML = html;
    const label = document.getElementById('cal-day-label');
    const taskList = document.getElementById('cal-day-tasks');
    if (!selectedCalDay) { label.style.display = 'none'; taskList.innerHTML = ''; return; }
    label.style.display = 'block';
    label.textContent = new Date(selectedCalDay + 'T00:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
    const tasks = tasksForDate(selectedCalDay);
    taskList.innerHTML = tasks.length === 0 ? '<div class="empty">Sin tareas con esa fecha de entrega.</div>' : tasks.map(t => taskTodayItemHtml(t, true)).join('');
}

function selectCalDay(iso) { selectedCalDay = selectedCalDay === iso ? null : iso; renderAll(); }

/* ---------- tablero kanban ---------- */
function projectBoardShellHtml() {
    return `
    <p class="section-label"><span>Proyectos</span><button class="open-form-btn secondary" style="margin:0;padding:4px 10px;font-size:10.5px;" onclick="toggleFinished()">${showFinished ? 'ocultar finalizados' : 'ver finalizados'}</button></p>
    <div class="projects-strip" id="projects-strip"></div>
    <div class="new-project-form" id="new-project-form">
      <input type="text" name="name" placeholder="Nombre del proyecto">
      <input type="text" name="client" placeholder="Institución / cliente">
      <label>Entrega<input type="date" name="deadline"></label>
      <button id="save-project-btn">Crear</button>
      <button class="cancel" id="cancel-project-btn" type="button">Cancelar</button>
    </div>
    <div class="active-head"><h2 id="active-name"></h2><span class="sub" id="active-sub"></span></div>
    <div class="project-toolbar" id="project-toolbar"></div>
    <div class="add-bar">
      <input type="text" id="task-input" placeholder="Nueva tarea, p.ej. Cortar PTR 5x5 base sala 3">
      <select class="assignee" id="assignee-input">${memberOptions('')}</select>
      <select id="area-input">${areaOptions('produccion')}</select>
      <input type="date" id="due-input" title="Fecha de entrega de la tarea">
      <select id="priority-input"><option value="normal">Normal</option><option value="urgente">Urgente</option></select>
      <input type="text" id="notes-input" placeholder="Nota rápida (opcional)" style="flex:2; min-width:180px;">
      <button id="add-btn">Agregar</button>
    </div>
    <div class="toolbar-row">
      <div class="area-filter" id="area-filter">
        <button class="active" data-area="todas">Todas</button>
        ${AREA_ORDER.map(a => `<button data-area="${a}">${AREA_LABEL[a]}</button>`).join('')}
      </div>
      <div class="sort-toggle">ordenar por
        <select id="sort-input"><option value="due">Fecha de entrega</option><option value="created">Más reciente</option></select>
      </div>
    </div>
    <div class="board">
      <div class="col" data-col="0"><div class="col-head"><span class="col-num">01</span><span class="col-title">Por hacer</span><span class="col-count" id="count-0">0</span></div><div class="cards" id="cards-0"></div></div>
      <div class="col" data-col="1"><div class="col-head"><span class="col-num">02</span><span class="col-title">En curso</span><span class="col-count" id="count-1">0</span></div><div class="cards" id="cards-1"></div></div>
      <div class="col" data-col="2"><div class="col-head"><span class="col-num">03</span><span class="col-title">Hecho</span><span class="col-count" id="count-2">0</span></div><div class="cards" id="cards-2"></div></div>
    </div>
  `;
}

function toggleFinished() { showFinished = !showFinished; renderAll(); }

function mountProjectBoard() {
    renderProjectsStrip();
    renderActiveHead();
    renderBoard();
    document.getElementById('add-btn').addEventListener('click', addTask);
    document.getElementById('task-input').addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
    document.getElementById('save-project-btn').addEventListener('click', addOrUpdateProject);
    document.getElementById('cancel-project-btn').addEventListener('click', cancelProjectForm);
    document.getElementById('sort-input').addEventListener('change', e => { sortMode = e.target.value; renderBoard(); });
    document.querySelectorAll('#area-filter button').forEach(b => b.addEventListener('click', () => { activeAreaFilter = b.dataset.area; document.querySelectorAll('#area-filter button').forEach(x => x.classList.toggle('active', x === b)); renderBoard(); }));
}

function renderProjectsStrip() {
    const strip = document.getElementById('projects-strip');
    const ordered = [GENERAL_PROJECT, ...sortedProjectList()];
    strip.innerHTML = ordered.map(p => {
        const tasks = projectTasks(p.id);
        const done = tasks.filter(t => t.col === 2).length;
        const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
        const overdue = p.deadline && p.deadline < todayStr() && pct < 100 && p.status !== 'finalizado';
        const pendingByArea = AREA_ORDER.map(a => ({ a, n: tasks.filter(t => t.area === a && t.col !== 2).length })).filter(x => x.n > 0);
        return `
      <div class="project-card ${p.id === activeProjectId ? 'active' : ''} ${p.general ? 'general' : ''} ${overdue ? 'overdue' : ''}" onclick="selectProject('${p.id}')">
        <p class="project-name">${escapeHtml(p.name)} ${p.status === 'finalizado' ? '✓' : ''}</p>
        <p class="project-client">${escapeHtml(p.client || '')}</p>
        ${p.deadline ? `<p class="project-deadline ${overdue ? 'overdue' : ''}">entrega ${fmtDate(p.deadline)}</p>` : (p.general ? '' : '<p class="project-deadline">sin fecha</p>')}
        <div class="project-bar-track"><div class="project-bar-fill" style="width:${pct}%"></div></div>
        <div class="project-stats"><span>${tasks.length} tareas</span><span>${pct}% hecho</span></div>
        <div class="project-areas">${pendingByArea.map(x => `<span class="area-chip tag area-${x.a}">${AREA_CODE[x.a]}·${x.n}</span>`).join('')}</div>
      </div>`;
    }).join('') + '<div class="add-project-card" id="add-project-trigger">+ nuevo proyecto</div>';
    document.getElementById('add-project-trigger').addEventListener('click', () => {
        editingProjectId = null;
        const form = document.getElementById('new-project-form');
        form.querySelectorAll('input').forEach(i => i.value = '');
        document.getElementById('save-project-btn').textContent = 'Crear';
        form.classList.toggle('show');
    });
}

function selectProject(pid) { activeProjectId = pid; activeAreaFilter = 'todas'; editingTaskId = null; renderAll(); }

function renderActiveHead() {
    const p = activeProjectId === 'general' ? GENERAL_PROJECT : DATA.projects.find(x => x.id === activeProjectId);
    if (!p) { activeProjectId = 'general'; renderAll(); return; }
    document.getElementById('active-name').textContent = p.name;
    document.getElementById('active-sub').textContent = [p.client, p.deadline ? 'entrega ' + fmtDate(p.deadline) : ''].filter(Boolean).join(' · ');
    const toolbar = document.getElementById('project-toolbar');
    if (p.general) { toolbar.innerHTML = ''; return; }
    toolbar.innerHTML = p.status === 'finalizado' ? `
    <button class="finalize" onclick="reopenProject()">↺ reabrir proyecto</button>
    <button class="edit-btn" onclick="startEditProject()">editar</button>
    <button class="danger" onclick="deleteProject()">eliminar proyecto</button>
  ` : `
    <button class="finalize" onclick="finalizeProject()">✓ finalizar proyecto</button>
    <button class="edit-btn" onclick="startEditProject()">editar</button>
    <button class="danger" onclick="deleteProject()">eliminar proyecto</button>
  `;
}

async function finalizeProject() { if (activeProjectId !== 'general') await updateDoc(doc(db, 'projects', activeProjectId), { status: 'finalizado' }); }
async function reopenProject() { if (activeProjectId !== 'general') await updateDoc(doc(db, 'projects', activeProjectId), { status: 'activo' }); }

function startEditProject() {
    const p = DATA.projects.find(x => x.id === activeProjectId);
    if (!p) return;
    editingProjectId = p.id;
    const form = document.getElementById('new-project-form');
    form.querySelector('[name=name]').value = p.name;
    form.querySelector('[name=client]').value = p.client || '';
    form.querySelector('[name=deadline]').value = p.deadline || '';
    document.getElementById('save-project-btn').textContent = 'Guardar cambios';
    form.classList.add('show');
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function addOrUpdateProject() {
    const form = document.getElementById('new-project-form');
    const name = form.querySelector('[name=name]').value.trim();
    const client = form.querySelector('[name=client]').value.trim();
    const deadline = form.querySelector('[name=deadline]').value;
    if (!name) return;
    if (editingProjectId) {
        await updateDoc(doc(db, 'projects', editingProjectId), { name, client, deadline });
        editingProjectId = null;
    } else {
        const ref = await addDoc(collection(db, 'projects'), { name, client, deadline, status: 'activo' });
        activeProjectId = ref.id;
    }
    form.querySelectorAll('input').forEach(i => i.value = '');
    form.classList.remove('show');
    document.getElementById('save-project-btn').textContent = 'Crear';
}

function cancelProjectForm() { editingProjectId = null; const form = document.getElementById('new-project-form'); form.querySelectorAll('input').forEach(i => i.value = ''); form.classList.remove('show'); document.getElementById('save-project-btn').textContent = 'Crear'; }

async function deleteProject() {
    if (activeProjectId === 'general') return;
    if (!confirm('¿Eliminar este proyecto y todas sus tareas? Esta acción no se puede deshacer.')) return;
    const pid = activeProjectId;
    activeProjectId = 'general';
    const toDelete = DATA.tasks.filter(t => t.projectId === pid);
    await Promise.all(toDelete.map(t => deleteDoc(doc(db, 'tasks', t.id))));
    await deleteDoc(doc(db, 'projects', pid));
}

async function addTask() {
    const title = document.getElementById('task-input').value.trim();
    const assigneeUid = document.getElementById('assignee-input').value;
    const assigneeName = assigneeUid ? ((userById(assigneeUid) || {}).name || '') : '';
    const area = document.getElementById('area-input').value;
    const due = document.getElementById('due-input').value;
    const priority = document.getElementById('priority-input').value;
    const notes = document.getElementById('notes-input').value.trim();
    if (!title) return;
    await addDoc(collection(db, 'tasks'), {
        title, assigneeUid: assigneeUid || '', assigneeName, area, due, priority, notes,
        projectId: activeProjectId, col: 0, createdAt: Date.now(),
    });
    document.getElementById('task-input').value = '';
    document.getElementById('due-input').value = '';
    document.getElementById('notes-input').value = '';
}

async function moveTask(id, dir) {
    const t = taskById(id); if (!t) return;
    const nc = t.col + dir; if (nc < 0 || nc > 2) return;
    await updateDoc(doc(db, 'tasks', id), { col: nc });
}

async function deleteTask(id) {
    if (!confirm('¿Eliminar esta tarea?')) return;
    await deleteDoc(doc(db, 'tasks', id));
}

function startEditTask(id) { editingTaskId = id; renderAll(); }
function cancelEditTask() { editingTaskId = null; renderAll(); }

async function saveEditTask(id) {
    const wrap = document.getElementById('edit-' + id);
    const t = taskById(id);
    const assigneeUid = wrap.querySelector('.f-assignee').value;
    const assigneeName = assigneeUid ? ((userById(assigneeUid) || {}).name || '') : '';
    const title = wrap.querySelector('.f-title').value.trim() || (t ? t.title : '');
    const patch = {
        title,
        assigneeUid: assigneeUid || '',
        assigneeName,
        area: wrap.querySelector('.f-area').value,
        due: wrap.querySelector('.f-due').value,
        priority: wrap.querySelector('.f-priority').value,
        notes: wrap.querySelector('.f-notes').value.trim(),
    };
    editingTaskId = null;
    await updateDoc(doc(db, 'tasks', id), patch);
}

function sortTasks(list) {
    if (sortMode === 'due') return [...list].sort((a, b) => { if (a.due && b.due) return a.due.localeCompare(b.due); if (a.due) return -1; if (b.due) return 1; return (a.createdAt || 0) - (b.createdAt || 0); });
    return [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function renderBoard() {
    let tasks = projectTasks(activeProjectId);
    if (activeAreaFilter !== 'todas') tasks = tasks.filter(t => t.area === activeAreaFilter);
    [0, 1, 2].forEach(idx => {
        const container = document.getElementById('cards-' + idx);
        if (!container) return;
        const colTasks = sortTasks(tasks.filter(t => t.col === idx));
        document.getElementById('count-' + idx).textContent = colTasks.length;
        if (colTasks.length === 0) { container.innerHTML = '<div class="empty">Sin tareas</div>'; return; }
        container.innerHTML = colTasks.map(t => {
            if (editingTaskId === t.id) {
                return `
          <div class="card area-${t.area}" id="edit-${t.id}">
            <div class="edit-form">
              <input class="f-title" type="text" value="${escapeAttr(t.title)}">
              <div class="row">
                <select class="f-assignee" style="flex:1;">${memberOptions(t.assigneeUid)}</select>
                <input class="f-due" type="date" value="${t.due || ''}">
              </div>
              <div class="row">
                <select class="f-area">${areaOptions(t.area)}</select>
                <select class="f-priority"><option value="normal" ${t.priority === 'normal' ? 'selected' : ''}>Normal</option><option value="urgente" ${t.priority === 'urgente' ? 'selected' : ''}>Urgente</option></select>
              </div>
              <textarea class="f-notes" placeholder="Nota rápida (opcional)">${escapeHtml(t.notes || '')}</textarea>
              <div class="row-actions"><button class="cancel" onclick="cancelEditTask()">Cancelar</button><button onclick="saveEditTask('${t.id}')">Guardar</button></div>
            </div>
          </div>`;
            }
            const overdue = isOverdue(t.due, t.col);
            return `
        <div class="card area-${t.area}">
          <p class="card-title">${escapeHtml(t.title)}</p>
          <div class="card-meta">
            <span class="tag area-${t.area}">${escapeHtml(AREA_LABEL[t.area] || t.area)}</span>
            ${t.assignee ? '<span>' + escapeHtml(t.assignee) + '</span>' : ''}
            ${t.due ? `<span class="tag ${overdue ? 'overdue' : 'due'}">${overdue ? 'vencida ' : 'entrega '}${fmtDate(t.due)}</span>` : ''}
            ${t.priority === 'urgente' ? '<span class="tag urgent">urgente</span>' : ''}
          </div>
          ${t.notes ? `<p class="card-notes">${escapeHtml(t.notes)}</p>` : ''}
          <div class="card-actions">
            <div class="move-btns">
              <button onclick="moveTask('${t.id}', -1)" ${idx === 0 ? 'disabled' : ''}>&larr;</button>
              <button onclick="moveTask('${t.id}', 1)" ${idx === 2 ? 'disabled' : ''}>&rarr;</button>
            </div>
            <div class="card-actions-right">
              <button class="edit-btn-sm" onclick="startEditTask('${t.id}')">editar</button>
              <button class="del-btn" onclick="deleteTask('${t.id}')">eliminar</button>
            </div>
          </div>
        </div>`;
        }).join('');
    });
}

/* ================= dashboard colaborador ================= */
function collabShell() {
    return `
    <div class="collab-head">
      <h2>Hola, ${escapeHtml(currentUser.name)}</h2>
      <span class="sub tag area-${currentUser.area}">${AREA_LABEL[currentUser.area] || 'Sin área asignada'}</span>
    </div>
    <div id="collab-sections"></div>
  `;
}

function mountCollabSections() {
    const holder = document.getElementById('collab-sections');
    const tasks = myTasks();
    const myProjectIds = [...new Set(tasks.map(t => t.projectId))];
    const myProjects = myProjectIds.map(id => projectById(id)).filter(Boolean);
    const myNotes = DATA.notes.filter(n => n.authorUid === currentUser.uid).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const myIncidents = DATA.incidents.filter(i => i.reportedByUid === currentUser.uid).sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));

    holder.innerHTML = `
    <div class="collab-section">
      <p class="section-label"><span>Mis actividades</span></p>
      <div class="collab-cols">
        ${[0, 1, 2].map(idx => {
        const label = idx === 0 ? 'Por hacer' : idx === 1 ? 'En curso' : 'Hecho';
        const list = tasks.filter(t => t.col === idx);
        return `<div><div class="col-head" style="margin-bottom:8px;"><span class="col-title" style="font-size:12px;">${label}</span><span class="col-count">${list.length}</span></div>
            <div class="cards">${list.length === 0 ? '<div class="empty">Sin tareas</div>' : list.map(t => `
              <div class="card area-${t.area}">
                <p class="card-title">${escapeHtml(t.title)}</p>
                <div class="card-meta">
                  <span class="tag project-tag">${escapeHtml(projectName(t.projectId))}</span>
                  ${t.due ? `<span class="tag ${isOverdue(t.due, t.col) ? 'overdue' : 'due'}">${isOverdue(t.due, t.col) ? 'vencida ' : 'entrega '}${fmtDate(t.due)}</span>` : ''}
                  ${t.priority === 'urgente' ? '<span class="tag urgent">urgente</span>' : ''}
                </div>
                ${t.notes ? `<p class="card-notes">${escapeHtml(t.notes)}</p>` : ''}
              </div>`).join('')}</div></div>`;
    }).join('')}
      </div>
    </div>

    <div class="collab-section">
      <p class="section-label"><span>Mis proyectos</span></p>
      ${myProjects.length === 0 ? '<div class="empty">No tienes proyectos asignados por ahora.</div>' : `
      <div class="projects-strip">
        ${myProjects.map(p => {
        const pTasks = projectTasks(p.id);
        const done = pTasks.filter(t => t.col === 2).length;
        const pct = pTasks.length ? Math.round((done / pTasks.length) * 100) : 0;
        return `<div class="project-card readonly">
            <p class="project-name">${escapeHtml(p.name)}</p>
            <p class="project-client">${escapeHtml(p.client || '')}</p>
            ${p.deadline ? `<p class="project-deadline ${p.deadline < todayStr() ? 'overdue' : ''}">entrega ${fmtDate(p.deadline)}</p>` : ''}
            <div class="project-bar-track"><div class="project-bar-fill" style="width:${pct}%"></div></div>
            <div class="project-stats"><span>${pTasks.length} tareas</span><span>${pct}% hecho</span></div>
          </div>`;
    }).join('')}
      </div>`}
    </div>

    <div class="collab-section">
      <p class="section-label"><span>Notas</span></p>
      <button class="open-form-btn" onclick="toggleNoteForm()">${noteFormOpen ? 'cancelar' : '+ nueva nota'}</button>
      <div class="inline-form ${noteFormOpen ? 'show' : ''}" id="note-form">
        <textarea id="note-text" placeholder="Escribe una nota: avance, observación, información de materiales, contexto..."></textarea>
        <div class="row">
          <select id="note-project">${projectOptions(myProjectIds[0] || '')}</select>
          <select id="note-task"></select>
        </div>
        <div class="row-actions"><button class="cancel" onclick="toggleNoteForm()">Cancelar</button><button onclick="submitNote()">Guardar nota</button></div>
      </div>
      ${myNotes.length === 0 ? '<div class="empty">Todavía no has creado notas.</div>' : myNotes.map(n => `
        <div class="note-card">
          <div class="meta"><span class="tag project-tag">${escapeHtml(projectName(n.projectId))}</span><span>${fmtDate(n.createdAt)}</span></div>
          <p>${escapeHtml(n.text)}</p>
        </div>`).join('')}
    </div>

    <div class="collab-section">
      <p class="section-label"><span>Incidencias</span></p>
      <button class="open-form-btn" onclick="toggleIncidentForm()">${incidentFormOpen ? 'cancelar' : '+ reportar incidencia'}</button>
      <div class="inline-form ${incidentFormOpen ? 'show' : ''}" id="incident-form">
        <input type="text" id="incident-title" placeholder="Título breve de la incidencia">
        <textarea id="incident-desc" placeholder="Describe el problema..."></textarea>
        <div class="row">
          <select id="incident-project">${projectOptions(myProjectIds[0] || '')}</select>
          <select id="incident-task"></select>
        </div>
        <div class="row-actions"><button class="cancel" onclick="toggleIncidentForm()">Cancelar</button><button onclick="submitIncident()">Reportar incidencia</button></div>
      </div>
      ${myIncidents.length === 0 ? '<div class="empty">No has reportado incidencias.</div>' : myIncidents.map(i => incidentCardHtml(i, false)).join('')}
    </div>
  `;

    const noteProjectSel = document.getElementById('note-project');
    const noteTaskSel = document.getElementById('note-task');
    const refreshNoteTasks = () => { noteTaskSel.innerHTML = taskOptionsFor(noteProjectSel.value, ''); };
    if (noteProjectSel) { noteProjectSel.addEventListener('change', refreshNoteTasks); refreshNoteTasks(); }

    const incProjectSel = document.getElementById('incident-project');
    const incTaskSel = document.getElementById('incident-task');
    const refreshIncTasks = () => { incTaskSel.innerHTML = taskOptionsFor(incProjectSel.value, ''); };
    if (incProjectSel) { incProjectSel.addEventListener('change', refreshIncTasks); refreshIncTasks(); }
}

function toggleNoteForm() { noteFormOpen = !noteFormOpen; renderAll(); }
function toggleIncidentForm() { incidentFormOpen = !incidentFormOpen; renderAll(); }

async function submitNote() {
    const text = document.getElementById('note-text').value.trim();
    if (!text) return;
    await addDoc(collection(db, 'notes'), {
        text,
        authorUid: currentUser.uid,
        authorName: currentUser.name,
        projectId: document.getElementById('note-project').value,
        taskId: document.getElementById('note-task').value,
        createdAt: todayStr(),
    });
    noteFormOpen = false;
    renderAll();
}

async function submitIncident() {
    const title = document.getElementById('incident-title').value.trim();
    const description = document.getElementById('incident-desc').value.trim();
    if (!title || !description) return;
    await addDoc(collection(db, 'incidents'), {
        title, description,
        projectId: document.getElementById('incident-project').value,
        taskId: document.getElementById('incident-task').value,
        reportedByUid: currentUser.uid,
        reportedByName: currentUser.name,
        reportedAt: todayStr(),
        status: 'open',
        resolvedByUid: '', resolvedByName: '', resolvedAt: '', resolution: '',
    });
    incidentFormOpen = false;
    renderAll();
}

/* ================= banner de alertas (compartido) ================= */
function renderAlertBannerFor(taskPool) {
    const overdueTasks = taskPool.filter(t => isOverdue(t.due, t.col));
    const todayTasks = taskPool.filter(t => isDueToday(t.due, t.col));
    const holder = document.getElementById('alert-banner-holder');
    if (overdueTasks.length === 0 && todayTasks.length === 0) { holder.innerHTML = ''; return; }
    const parts = [];
    if (overdueTasks.length) parts.push(`<strong>${overdueTasks.length}</strong> vencida${overdueTasks.length > 1 ? 's' : ''}`);
    if (todayTasks.length) parts.push(`<strong>${todayTasks.length}</strong> para hoy`);
    const isAdmin = currentUser && currentUser.role === 'admin';
    holder.innerHTML = `<div class="alert-banner" ${isAdmin ? 'style="cursor:pointer;" onclick="goToday()"' : ''}>⚠ ${parts.join(' · ')}${isAdmin ? ' — toca para ver' : ''}</div>`;
}

function goToday() { adminTab = 'proyectos'; viewMode = 'today'; renderAll(); }

/* ================= exponer handlers usados en onclick="" ================= */
Object.assign(window, {
    selectProject, toggleFinished, startEditProject, finalizeProject, reopenProject, deleteProject,
    moveTask, deleteTask, startEditTask, cancelEditTask, saveEditTask, markDone, selectCalDay,
    startResolveIncident, confirmResolveIncident, toggleNoteForm, toggleIncidentForm, submitNote, submitIncident,
    goToday, approveUser, saveUserFields, revokeUser, reactivateUser,
});

renderAll();
