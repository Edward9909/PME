/* ================= Firebase ================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
    connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection,
    onSnapshot, serverTimestamp, connectFirestoreEmulator, writeBatch,
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
const GENERAL_PROJECT = { id: 'general', name: 'Tareas generales', client: 'Sin proyecto asignado', deadline: '', status: 'activo', general: true };

/* Ciclo de vida de una incidencia. "abierta" y "en seguimiento" son estados
   distintos a propósito: alguien reportó algo no es lo mismo que alguien lo
   está atendiendo. "archivada" no es un estado sino una bandera aparte
   (igual que en notas), porque se puede archivar tanto una resuelta como una
   descartada sin perder el desenlace real. */
const INCIDENT_STATUS = { open: 'Abierta', tracking: 'En seguimiento', resolved: 'Resuelta', discarded: 'Descartada' };
const INCIDENT_FLOW = ['open', 'tracking', 'resolved', 'discarded'];
const PRIORITY_LABEL = { alta: 'Alta', normal: 'Normal', baja: 'Baja' };

// toISOString() convierte a UTC, así que en México (UTC-6) a partir de las
// 18:00 devolvía ya la fecha del día siguiente: el taller trabajando de noche
// veía las tareas de mañana como "de hoy", las de hoy como vencidas, y las
// notas quedaban archivadas con fecha del día siguiente. Se compensa el huso
// para que la fecha sea siempre la que el usuario tiene en su reloj.
const localISO = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return localISO(d); };
const todayStr = () => localISO(new Date());

/* ================= estado ================= */
let currentUser = null; // { uid, email, name, photoURL, role, area, status }
let authReady = false;

let adminTab = 'resumen'; // resumen | proyectos | actividad | equipo
let activeProjectId = 'general';
let activeAreaFilter = 'todas';
let sortMode = 'due'; // due | priority | project | assignee | created
let showFinished = false;
let editingTaskId = null;
let editingProjectId = null;
let viewMode = 'project'; // project | today | week — puertas temporales de Proyectos
let taskView = 'kanban';  // kanban | lista | calendario — cómo se ven las tareas
let taskFormOpen = false; // panel lateral de "nueva tarea"
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let selectedCalDay = null;
// De dónde saca sus tareas el calendario: dentro de un proyecto muestra las
// de ese proyecto (con su filtro de área); en Resumen, las de todos.
let calScope = 'project'; // project | all
// Actividad: la memoria operativa. Incidencias y notas dejan de ser dos
// pestañas y pasan a ser dos tipos de registro dentro del mismo historial.
let activityType = 'todo';        // todo | incidencias | notas
let activityProject = 'todos';
let activityStatus = 'todos';     // solo aplica a incidencias
let activityPeriod = '30';        // 30 | 90 | todo (días hacia atrás)
let showArchivedActivity = false;
let expandedActivityId = null;
let recordDrawer = null;          // null | 'elegir' | 'incidencia' | 'nota'
let recordDrawerProject = null;   // proyecto preseleccionado al abrir

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
function activeUsers() { return DATA.users.filter(u => u.status === 'active'); }
function myTasks() { return DATA.tasks.filter(t => (t.assignees || []).some(a => a.uid === currentUser.uid)); }

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
// Los nombres completos de una cuenta de Google suelen tener 3-4 palabras y
// no caben legibles en un chip. Se muestra nombre + primer apellido, con el
// área debajo para desambiguar entre homónimos (que aquí sí ocurren).
function shortName(name) {
    const parts = (name || '').trim().split(/\s+/);
    if (parts.length <= 2) return name || '';
    // Nombres en español: con 4 palabras suele ser nombre + segundo nombre +
    // apellido paterno + materno, así que el apellido útil es el tercero.
    if (parts.length >= 4) return parts[0] + ' ' + parts[2];
    return parts[0] + ' ' + parts[1];
}

// Responsables de una tarea: uno o varios miembros registrados (con uid) y/o
// personas externas sin cuenta (uid vacío, solo nombre libre — p.ej. un
// servicio externo de montaje). "selected" es el arreglo t.assignees actual.
function assigneesPickerHtml(prefix, selected) {
    const sel = selected || [];
    const selUids = new Set(sel.filter(a => a.uid).map(a => a.uid));
    const externals = sel.filter(a => !a.uid).map(a => a.name);
    const chips = activeUsers().map(u => `
      <label class="assignee-chip" title="${escapeAttr(u.name)}">
        <input type="checkbox" class="assignee-member" value="${u.uid}" data-name="${escapeAttr(u.name)}" ${selUids.has(u.uid) ? 'checked' : ''}>
        <span class="mc-name">${escapeHtml(shortName(u.name))}</span>
        <span class="mc-area">${escapeHtml(AREA_LABEL[u.area] || 'sin área')}</span>
      </label>`).join('');
    return `
    <div class="assignees-picker" id="${prefix}-picker">
      <div class="assignee-check-list">${chips || '<span style="font-size:11px;color:var(--ink-soft);">Sin colaboradores activos</span>'}</div>
      <button type="button" class="external-toggle" onclick="toggleExternalField('${prefix}')">+ agregar responsable externo</button>
      <div class="assignee-external-wrap ${externals.length ? 'show' : ''}" id="${prefix}-external-wrap">
        <input type="text" class="assignee-external" placeholder="Nombre de la persona o servicio" value="${escapeAttr(externals.join(', '))}">
        <span class="assignee-external-hint">Alguien sin cuenta en la plataforma. Separa varios con coma.</span>
      </div>
    </div>`;
}

function toggleExternalField(prefix) {
    const wrap = document.getElementById(prefix + '-external-wrap');
    wrap.classList.toggle('show');
    if (wrap.classList.contains('show')) wrap.querySelector('.assignee-external').focus();
    else wrap.querySelector('.assignee-external').value = '';
}

function readAssignees(scopeEl) {
    if (!scopeEl) return [];
    const checked = [...scopeEl.querySelectorAll('.assignee-member:checked')]
        .map(el => ({ uid: el.value, name: el.dataset.name }));
    const externalInput = scopeEl.querySelector('.assignee-external');
    const external = externalInput
        ? externalInput.value.split(',').map(s => s.trim()).filter(Boolean).map(name => ({ uid: '', name }))
        : [];
    return [...checked, ...external];
}
function projectOptions(selected) {
    return allProjects().map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
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
    if (!fbUser) {
        currentUser = null;
        authReady = true;
        sessionStorage.clear(); // que el NIP se vuelva a pedir en el próximo inicio de sesión
        renderAll();
        return;
    }
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

/* ================= normalización de registros =================
   Las incidencias creadas antes del ciclo de vida ampliado solo tenían
   open/resolved y ningún campo de área, prioridad, responsable ni hora. Se
   completan aquí con valores neutros para que el resto del código pueda
   asumir la forma nueva sin comprobar cada campo. */
function normalizeIncident(id, v) {
    return {
        id, ...v,
        status: INCIDENT_STATUS[v.status] ? v.status : 'open',
        area: v.area || '',
        priority: v.priority || 'normal',
        archived: !!v.archived,
        ts: v.ts || 0,
        assigneeUid: v.assigneeUid || '',
        assigneeName: v.assigneeName || '',
        reportedBy: v.reportedByName || '',
        resolvedBy: v.resolvedByName || '',
    };
}

function normalizeNote(id, v) {
    return { id, ...v, archived: !!v.archived, ts: v.ts || 0, author: v.authorName || '' };
}

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
            // Compatibilidad con tareas viejas creadas antes de soportar
            // varios responsables: si no tienen "assignees" (arreglo), se
            // reconstruye a partir de los campos únicos que sí tenían.
            const assignees = Array.isArray(v.assignees) ? v.assignees
                : (v.assigneeUid || v.assigneeName) ? [{ uid: v.assigneeUid || '', name: v.assigneeName || '' }] : [];
            const assignee = assignees.map(a => a.name).filter(Boolean).join(', ');
            return { id: d.id, ...v, assignees, assignee };
        });
        renderAll();
    }, err => console.error('tasks listener', err)));

    unsubscribers.push(onSnapshot(collection(db, 'incidents'), snap => {
        DATA.incidents = snap.docs.map(d => normalizeIncident(d.id, d.data()));
        renderAll();
    }, err => console.error('incidents listener', err)));

    unsubscribers.push(onSnapshot(collection(db, 'notes'), snap => {
        DATA.notes = snap.docs.map(d => normalizeNote(d.id, d.data()));
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
        // Segundo filtro solo para el panel administrador: si la sesión de
        // Google se queda abierta en una computadora compartida, cualquiera
        // que la use necesita además este NIP. No aplica a colaboradores
        // (la especificación pide simplicidad extrema para ellos).
        if (!currentUser.pinHash) {
            root.innerHTML = createPinScreenHtml();
            document.getElementById('pin-create-btn').addEventListener('click', submitCreatePin);
            wirePinEnterKey('pin-new-2', submitCreatePin);
            return;
        }
        if (!pinVerifiedFor(currentUser.uid)) {
            root.innerHTML = enterPinScreenHtml();
            document.getElementById('pin-enter-btn').addEventListener('click', submitEnterPin);
            wirePinEnterKey('pin-enter', submitEnterPin);
            return;
        }
        root.innerHTML = adminShell();
        mountAdminTab();
        if (taskFormOpen && adminTab === 'proyectos') {
            root.insertAdjacentHTML('beforeend', taskDrawerHtml());
            mountTaskDrawer();
        }
        if (recordDrawer) {
            root.insertAdjacentHTML('beforeend', recordDrawerHtml());
            mountRecordDrawer();
        }
    } else {
        root.innerHTML = collabShell();
        renderAlertBannerFor(myTasks());
        mountCollabSections();
        if (recordDrawer) {
            root.insertAdjacentHTML('beforeend', recordDrawerHtml());
            mountRecordDrawer();
        }
    }
}

function wirePinEnterKey(inputId, handler) {
    const el = document.getElementById(inputId);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') handler(); });
}

function renderSessionBar() {
    const holder = document.getElementById('session-bar-holder');
    const roleLabel = currentUser.role === 'admin' ? 'Administrador' : 'Colaborador';
    const isAdminActive = currentUser.role === 'admin' && currentUser.status === 'active'
        && currentUser.pinHash && pinVerifiedFor(currentUser.uid);
    holder.innerHTML = `
    <div class="session-bar">
      ${isAdminActive ? `
        <button class="link-btn" id="export-backup-btn">⭳ exportar respaldo</button>
        <button class="link-btn" id="import-backup-trigger">⭱ restaurar respaldo</button>
        <input type="file" id="import-backup-input" accept="application/json" style="display:none;">
      ` : ''}
      <span class="session-sep"></span>
      <span>${escapeHtml(currentUser.name || currentUser.email)}</span>
      <span class="tag role-tag">${roleLabel}${currentUser.area ? ' · ' + (AREA_LABEL[currentUser.area] || currentUser.area) : ''}</span>
      <button id="signout-btn">salir</button>
    </div>`;
    document.getElementById('signout-btn').addEventListener('click', signOutUser);
}

function loginScreenHtml() {
    return `
    <div class="gate-screen">
      <h2>AS — Plataforma operativa</h2>
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

/* ---------- NIP (segundo filtro, solo administrador) ---------- */
async function hashPin(pin, salt) {
    const data = new TextEncoder().encode(salt + ':' + pin);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function pinVerifiedFor(uid) { return sessionStorage.getItem('pme_pin_ok_' + uid) === '1'; }
function markPinVerified(uid) { sessionStorage.setItem('pme_pin_ok_' + uid, '1'); }

function createPinScreenHtml() {
    return `
    <div class="gate-screen">
      <span class="gate-badge">configura tu acceso</span>
      <h2>Crea tu NIP</h2>
      <p>Si dejas la sesión de Google abierta en una computadora compartida, cualquiera podría abrir el panel. Este NIP es una segunda verificación que se pedirá cada vez que abras la app en una pestaña o navegador nuevo. Elige de 4 a 6 dígitos.</p>
      <input type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="6" id="pin-new-1" placeholder="Nuevo NIP" class="pin-input">
      <input type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="6" id="pin-new-2" placeholder="Repite el NIP" class="pin-input">
      <div class="pin-error" id="pin-error"></div>
      <button class="google-btn" id="pin-create-btn">Guardar NIP</button>
    </div>`;
}

function enterPinScreenHtml() {
    return `
    <div class="gate-screen">
      <span class="gate-badge">verificación adicional</span>
      <h2>Ingresa tu NIP</h2>
      <p>Por seguridad, el panel administrativo también pide tu NIP en cada pestaña o navegador nuevo.</p>
      <input type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="6" id="pin-enter" placeholder="NIP" class="pin-input">
      <div class="pin-error" id="pin-error"></div>
      <button class="google-btn" id="pin-enter-btn">Entrar</button>
      <p style="font-size:10.5px; margin-top:14px;">¿Olvidaste tu NIP? Pídele a otro administrador que te lo restablezca desde la pestaña Usuarios, o contacta a soporte técnico.</p>
    </div>`;
}

async function submitCreatePin() {
    const p1 = document.getElementById('pin-new-1').value.trim();
    const p2 = document.getElementById('pin-new-2').value.trim();
    const err = document.getElementById('pin-error');
    if (!/^\d{4,6}$/.test(p1)) { err.textContent = 'El NIP debe tener de 4 a 6 dígitos.'; return; }
    if (p1 !== p2) { err.textContent = 'Los dos NIP no coinciden.'; return; }
    const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
    const hash = await hashPin(p1, salt);
    await updateDoc(doc(db, 'users', currentUser.uid), { pinSalt: salt, pinHash: hash });
    markPinVerified(currentUser.uid);
    renderAll();
}

async function submitEnterPin() {
    const p = document.getElementById('pin-enter').value.trim();
    const err = document.getElementById('pin-error');
    const hash = await hashPin(p, currentUser.pinSalt);
    if (hash === currentUser.pinHash) {
        markPinVerified(currentUser.uid);
        renderAll();
    } else {
        err.textContent = 'NIP incorrecto.';
        document.getElementById('pin-enter').value = '';
    }
}

async function resetUserPin(uid) {
    if (!confirm('¿Restablecer el NIP de este usuario? En su próximo inicio de sesión tendrá que crear uno nuevo.')) return;
    await updateDoc(doc(db, 'users', uid), { pinHash: null, pinSalt: null });
}

/* ================= dashboard administrador ================= */
/* ---------- respaldo manual (exportar / restaurar) ---------- */
function exportBackup() {
    const payload = {
        exportedAt: new Date().toISOString(),
        projects: DATA.projects,
        tasks: DATA.tasks,
        incidents: DATA.incidents,
        notes: DATA.notes,
        users: DATA.users,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `respaldo-pme-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function commitInChunks(ops) {
    const CHUNK = 400;
    for (let i = 0; i < ops.length; i += CHUNK) {
        const batch = writeBatch(db);
        for (const op of ops.slice(i, i + CHUNK)) {
            const ref = doc(db, op.col, op.id);
            if (op.type === 'delete') batch.delete(ref); else batch.set(ref, op.data);
        }
        await batch.commit();
    }
}

// Restaura proyectos, tareas, incidencias y notas desde un respaldo exportado
// con exportBackup(). Los usuarios registrados NUNCA se tocan aquí a propósito
// -- un respaldo desactualizado no debe poder revocar ni recrear cuentas
// reales de nadie.
async function restoreBackup(fileInputEl) {
    const file = fileInputEl.files[0];
    if (!file) return;
    let parsed;
    try {
        parsed = JSON.parse(await file.text());
    } catch (e) {
        alert('Ese archivo no es un JSON válido.');
        fileInputEl.value = '';
        return;
    }
    if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.tasks)) {
        alert('El archivo no tiene el formato de un respaldo de PME.');
        fileInputEl.value = '';
        return;
    }
    const confirmed = confirm(
        'Esto va a REEMPLAZAR todos los proyectos, tareas, incidencias y notas ' +
        'actuales por los del respaldo (del ' + (parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('es-MX') : 'fecha desconocida') + '). ' +
        'Los usuarios registrados no se modifican. Esta acción no se puede deshacer. ¿Continuar?'
    );
    if (!confirmed) { fileInputEl.value = ''; return; }

    const COLLECTIONS = ['projects', 'tasks', 'incidents', 'notes'];
    try {
        const toDelete = [];
        COLLECTIONS.forEach(col => DATA[col].forEach(item => toDelete.push({ type: 'delete', col, id: item.id })));
        await commitInChunks(toDelete);

        const toWrite = [];
        COLLECTIONS.forEach(col => (parsed[col] || []).forEach(item => {
            const { id, assignee, reportedBy, resolvedBy, author, ...data } = item;
            if (id) toWrite.push({ type: 'set', col, id, data });
        }));
        await commitInChunks(toWrite);

        alert('Respaldo restaurado correctamente.');
    } catch (e) {
        console.error('Error al restaurar el respaldo', e);
        alert('Hubo un error al restaurar el respaldo: ' + e.message);
    }
    fileInputEl.value = '';
}

function tabBadge(n) { return n > 0 ? `<span class="tab-badge">${n}</span>` : ''; }

function adminShell() {
    const proyectosCount = DATA.tasks.filter(t => isOverdue(t.due, t.col) || isDueToday(t.due, t.col)).length;
    // La insignia de Actividad cuenta lo que sigue pendiente de alguien:
    // incidencias sin desenlace. Las notas no la alimentan (una nota no pide
    // que nadie haga nada).
    const actividadCount = DATA.incidents.filter(i => !i.archived && (i.status === 'open' || i.status === 'tracking')).length;
    const equipoCount = DATA.users.filter(u => u.status === 'pending').length;
    return `
    <div class="tabbar" id="admin-tabbar">
      <button data-tab="resumen">Resumen</button>
      <button data-tab="proyectos">Proyectos${tabBadge(proyectosCount)}</button>
      <button data-tab="actividad">Actividad${tabBadge(actividadCount)}</button>
      <button data-tab="equipo">Equipo${tabBadge(equipoCount)}</button>
    </div>
    <div id="admin-tab-content"></div>
  `;
}

function mountAdminTab() {
    document.getElementById('export-backup-btn').addEventListener('click', exportBackup);
    document.getElementById('import-backup-trigger').addEventListener('click', () => document.getElementById('import-backup-input').click());
    document.getElementById('import-backup-input').addEventListener('change', e => restoreBackup(e.target));
    document.querySelectorAll('#admin-tabbar button').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === adminTab);
        b.addEventListener('click', () => { adminTab = b.dataset.tab; renderAll(); });
    });
    // El banner sobra donde lo vencido y lo de hoy ya son visibles por sí
    // solos: en Resumen (abre con eso) y en Proyectos (la puerta "Tareas de
    // hoy"). En las demás pestañas sigue siendo el único aviso.
    if (adminTab === 'resumen' || adminTab === 'proyectos') document.getElementById('alert-banner-holder').innerHTML = '';
    else renderAlertBannerFor(DATA.tasks);
    const content = document.getElementById('admin-tab-content');
    if (adminTab === 'resumen') { calScope = 'all'; content.innerHTML = resumenView(); mountCalendar(); return; }
    if (adminTab === 'actividad') { content.innerHTML = actividadView(true); mountActividadView(); return; }
    if (adminTab === 'equipo') { content.innerHTML = usuariosView(); return; }
    content.innerHTML = proyectosViewShell();
    mountProyectosView();
}

/* ---------- dashboard operativo: acción → tiempo → proyecto → métrica ----------
   Nota deliberada: el modelo de datos no guarda horas (tasks.due es solo una
   fecha) ni un historial de cambios de estado, así que este dashboard no
   inventa horarios ni un log de actividad minuto a minuto. Todo lo que se
   muestra abajo se deriva de datos que realmente existen. */
function daysFromToday(iso) {
    if (!iso) return null;
    return Math.round((new Date(iso + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 86400000);
}

function relDayLabel(iso) {
    const d = daysFromToday(iso);
    if (d === null) return '';
    if (d === 0) return 'hoy';
    if (d === 1) return 'mañana';
    if (d === -1) return 'ayer';
    return d < 0 ? `hace ${-d} días` : `en ${d} días`;
}

function dayPart() {
    const h = new Date().getHours();
    return h < 12 ? 'manana' : h < 18 ? 'tarde' : 'cierre';
}

function openTasks() { return DATA.tasks.filter(t => t.col !== 2); }

function urgencyRank(t) {
    if (isOverdue(t.due, t.col)) return 0;
    if (isDueToday(t.due, t.col)) return 1;
    if (t.due) return 2;
    return 3;
}

function byUrgency(a, b) {
    return urgencyRank(a) - urgencyRank(b)
        || (b.priority === 'urgente') - (a.priority === 'urgente')
        || (a.due || '').localeCompare(b.due || '');
}

function nextActionTask() {
    const pool = openTasks().filter(t => t.due);
    return pool.length ? [...pool].sort(byUrgency)[0] : null;
}

function taskSubtitle(t) {
    return projectName(t.projectId) + ' · ' + (t.assignee || 'sin responsable');
}

function actionRowHtml(cls, title, sub, when, onClick) {
    return `
    <div class="action-row ${cls}">
      <span class="ar-title">${escapeHtml(title)}</span>
      <span class="ar-sub">${escapeHtml(sub)}</span>
      <span class="ar-when">${escapeHtml(when)}</span>
      <button class="ar-open" onclick="${onClick}">abrir →</button>
    </div>`;
}

function actionGroupHtml(cls, label, count, rows) {
    if (!rows.length) return '';
    return `
    <div class="action-group ${cls}">
      <p class="action-group-head">${label} <b>${count}</b></p>
      ${rows.join('')}
    </div>`;
}

// Solo lo que está atrasado o atorado. Las tareas de hoy viven en la columna
// "Hoy" y las futuras en "Próximos días" — cada elemento aparece una sola vez
// en el dashboard, para que esta sección siga siendo corta y escaneable.
function requiereAccionHtml() {
    const vencidas = openTasks().filter(t => isOverdue(t.due, t.col)).sort(byUrgency);
    // Sin resolver = abiertas + en seguimiento: ambas siguen esperando algo
    // de alguien, aunque una ya se esté atendiendo.
    const incidencias = DATA.incidents
        .filter(i => !i.archived && (i.status === 'open' || i.status === 'tracking'))
        .sort((a, b) => a.reportedAt.localeCompare(b.reportedAt));
    const usuarios = DATA.users.filter(u => u.status === 'pending');

    const groups = [
        actionGroupHtml('g-overdue', 'tareas vencidas', vencidas.length,
            vencidas.map(t => actionRowHtml('r-overdue', t.title, taskSubtitle(t), relDayLabel(t.due), `openTask('${t.id}')`))),
        actionGroupHtml('g-inc', 'incidencias sin resolver', incidencias.length,
            incidencias.map(i => actionRowHtml('r-overdue', i.title,
                projectName(i.projectId) + ' · ' + INCIDENT_STATUS[i.status].toLowerCase(),
                relDayLabel(i.reportedAt), `openIncident('${i.id}')`))),
        actionGroupHtml('g-users', 'usuarios por aprobar', usuarios.length,
            usuarios.map(u => actionRowHtml('r-today', u.name || u.email, 'solicita acceso a la plataforma', 'pendiente', `goTab('equipo')`))),
    ].filter(Boolean);

    return groups.length ? groups.join('') : '<div class="dash-empty">Nada atrasado ni pendiente de resolver. 🎉</div>';
}

function hoyColumnHtml() {
    const part = dayPart();
    const hint = part === 'manana' ? 'empieza por aquí' : part === 'tarde' ? 'lo que sigue pendiente' : 'lo que queda del día';
    const hoy = openTasks().filter(t => isDueToday(t.due, t.col)).sort(byUrgency);
    const fecha = new Date().toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
    return `
    <div>
      <p class="dash-label"><span>Hoy · ${fecha}</span><span class="dash-hint">${hint}</span></p>
      ${hoy.length === 0 ? '<div class="dash-empty">Sin entregas programadas para hoy.</div>' : hoy.map(t =>
        actionRowHtml(t.priority === 'urgente' ? 'r-today r-urgent' : 'r-today', t.title, taskSubtitle(t),
            t.priority === 'urgente' ? 'urgente' : (AREA_LABEL[t.area] || t.area), `openTask('${t.id}')`)).join('')}
    </div>`;
}

function proximosDiasHtml() {
    const dias = [1, 2, 3, 4, 5, 6, 7].map(n => addDays(n));
    const total = openTasks().filter(t => dias.includes(t.due)).length;
    const rows = dias.map(iso => {
        const tasks = openTasks().filter(t => t.due === iso).sort(byUrgency);
        const d = new Date(iso + 'T00:00:00');
        const label = d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' }).toUpperCase();
        return `
      <div class="tl-day-block">
        <p class="tl-day-head"><span>${label}</span><span>${tasks.length || '—'}</span></p>
        ${tasks.map(t => `
          <div class="tl-task" onclick="openTask('${t.id}')">
            <span class="tl-mark mark-${t.area}"></span>
            <span class="tl-task-title">${escapeHtml(t.title)}</span>
            <span class="tl-task-sub">${escapeHtml(projectName(t.projectId))}</span>
          </div>`).join('')}
      </div>`;
    }).join('');
    return `
    <div>
      <p class="dash-label"><span>Próximos 7 días</span><span class="dash-hint">${total} por entregar</span></p>
      ${rows}
    </div>`;
}

function proyectosActivosHtml() {
    const activos = DATA.projects.filter(p => p.status !== 'finalizado');
    const rows = activos.map(p => {
        const tasks = projectTasks(p.id);
        const done = tasks.filter(t => t.col === 2).length;
        const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
        const vencidas = tasks.filter(t => isOverdue(t.due, t.col)).length;
        const lateProject = p.deadline && p.deadline < todayStr() && pct < 100;
        const meta = [
            `${done}/${tasks.length} tareas`,
            vencidas ? `<span class="warn-num">${vencidas} vencida${vencidas > 1 ? 's' : ''}</span>` : 'sin vencidas',
            p.deadline ? `entrega ${fmtDate(p.deadline)}${lateProject ? ' (fuera de fecha)' : ''}` : 'sin fecha de entrega',
        ].join(' · ');
        return `
      <div class="proj-row" onclick="openProject('${p.id}')">
        <div class="proj-top">
          <span class="proj-name">${escapeHtml(p.name)}</span>
          <span class="proj-pct">${pct}%</span>
        </div>
        <div class="proj-meta">${meta}</div>
        <div class="proj-rule"><span style="width:${pct}%"></span></div>
      </div>`;
    }).join('');
    return `
    <div>
      <p class="dash-label"><span>Proyectos activos</span><span class="dash-hint">${activos.length}</span></p>
      ${activos.length === 0 ? '<div class="dash-empty">Sin proyectos activos.</div>' : rows}
    </div>`;
}

function actividadRecienteHtml() {
    const items = [];
    DATA.notes.filter(n => !n.archived).forEach(n => items.push({ date: n.createdAt, text: `${n.author} agregó una nota en ${projectName(n.projectId)}` }));
    DATA.incidents.forEach(i => {
        items.push({ date: i.reportedAt, text: `${i.reportedBy} reportó "${i.title}"` });
        if (i.resolvedAt && (i.status === 'resolved' || i.status === 'discarded')) {
            items.push({ date: i.resolvedAt, text: `${i.resolvedBy} ${i.status === 'resolved' ? 'resolvió' : 'descartó'} "${i.title}"` });
        }
    });
    DATA.projects.filter(p => p.finalizedAt).forEach(p => items.push({ date: p.finalizedAt, text: `Se finalizó el proyecto "${p.name}"` }));
    const list = items.filter(x => x.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
    return `
    <div>
      <p class="dash-label"><span>Actividad reciente</span></p>
      ${list.length === 0 ? '<div class="dash-empty">Sin movimientos registrados.</div>' : list.map(x => `
        <div class="act-row">
          <span class="act-when">${relDayLabel(x.date)}</span>
          <span class="act-text">${escapeHtml(x.text)}</span>
        </div>`).join('')}
    </div>`;
}

function operacionHtml() {
    const activos = DATA.projects.filter(p => p.status !== 'finalizado');
    const projVencidos = activos.filter(p => p.deadline && p.deadline < todayStr()).length;
    const abiertas = openTasks().length;
    const vencidas = DATA.tasks.filter(t => isOverdue(t.due, t.col)).length;
    const porHacer = DATA.tasks.filter(t => t.col === 0).length;
    const enCurso = DATA.tasks.filter(t => t.col === 1).length;
    const hechas = DATA.tasks.filter(t => t.col === 2).length;
    // Mismo criterio que la insignia de Actividad y "Requiere acción": una
    // incidencia en seguimiento sigue sin resolverse.
    const incAbiertas = DATA.incidents.filter(i => !i.archived && (i.status === 'open' || i.status === 'tracking')).length;
    const incTotal = DATA.incidents.length;
    return `
    <p class="dash-label"><span>Operación</span></p>
    <div class="ops-strip">
      <div class="ops-block">
        <div class="ops-label">Proyectos</div>
        <div class="ops-figure">${activos.length} activos · ${projVencidos ? `<span class="warn-num">${projVencidos} fuera de fecha</span>` : '0 fuera de fecha'}</div>
      </div>
      <div class="ops-block">
        <div class="ops-label">Tareas</div>
        <div class="ops-figure">${abiertas} abiertas · ${vencidas ? `<span class="warn-num">${vencidas} vencida${vencidas > 1 ? 's' : ''}</span>` : '0 vencidas'}</div>
        <div class="ops-detail">${porHacer} por hacer · ${enCurso} en curso · ${hechas} hechas</div>
      </div>
      <div class="ops-block">
        <div class="ops-label">Incidencias</div>
        <div class="ops-figure">${incAbiertas ? `<span class="warn-num">${incAbiertas} sin resolver</span>` : '0 sin resolver'}</div>
        <div class="ops-detail">${incTotal} registradas en total</div>
      </div>
    </div>`;
}

function siguienteAccionHtml() {
    const t = nextActionTask();
    if (!t) return '';
    const overdue = isOverdue(t.due, t.col);
    const part = dayPart();
    const label = part === 'cierre' ? 'para cerrar el día' : 'siguiente acción';
    const when = overdue ? `vencida ${relDayLabel(t.due)}` : isDueToday(t.due, t.col) ? 'vence hoy' : `vence ${relDayLabel(t.due)}`;
    return `
    <div class="next-action ${overdue ? 'is-overdue' : ''}">
      <span class="na-label">${label}</span>
      <span class="na-title">${escapeHtml(t.title)}</span>
      <span class="na-sub">${escapeHtml(taskSubtitle(t))}</span>
      <span class="na-when">${escapeHtml(when)}</span>
      <button onclick="openTask('${t.id}')">Abrir tarea</button>
    </div>`;
}

function goTab(tab) { adminTab = tab; renderAll(); }

function openTask(id) {
    const t = taskById(id);
    if (!t) return;
    adminTab = 'proyectos';
    viewMode = 'project';
    activeProjectId = t.projectId;
    activeAreaFilter = 'todas';
    renderAll();
}

function openProject(pid) {
    adminTab = 'proyectos';
    viewMode = 'project';
    activeProjectId = pid;
    activeAreaFilter = 'todas';
    renderAll();
}

// Abre una incidencia concreta en Actividad, ya desplegada y con los filtros
// abiertos lo suficiente para que sea visible venga de donde venga.
function openIncident(id) {
    adminTab = 'actividad';
    activityType = 'todo';
    activityProject = 'todos';
    activityStatus = 'todos';
    activityPeriod = 'todo';
    expandedActivityId = id;
    renderAll();
}

// La actividad de un proyecto es su memoria: qué pasó, quién lo atendió y
// qué se decidió. Se consulta en Actividad, ya filtrada, en vez de duplicar
// el historial dentro de la vista de proyecto.
function openProjectActivity(pid) {
    adminTab = 'actividad';
    activityType = 'todo';
    activityProject = pid;
    activityStatus = 'todos';
    activityPeriod = 'todo';
    expandedActivityId = null;
    renderAll();
}

function resumenView() {
    return `
    ${siguienteAccionHtml()}
    <p class="dash-label"><span>Requiere acción</span></p>
    ${requiereAccionHtml()}
    <div class="dash-cols" style="margin-top:26px;">
      ${hoyColumnHtml()}
      ${proximosDiasHtml()}
    </div>
    ${calendarioMesHtml()}
    <div class="dash-cols">
      ${proyectosActivosHtml()}
      ${actividadRecienteHtml()}
    </div>
    ${operacionHtml()}
  `;
}

// Cierra la secuencia temporal del dashboard: hoy → próximos 7 días → el mes
// completo. Es el mismo calendario de los proyectos, pero con las tareas de
// todos ellos (ver calScope).
function calendarioMesHtml() {
    const pendientes = openTasks().filter(t => t.due).length;
    return `
    <p class="dash-label" style="margin-top:26px;">
      <span>Calendario</span>
      <span class="dash-hint">todos los proyectos · ${pendientes} con fecha</span>
    </p>
    ${calendarShellHtml()}`;
}

/* ================= ACTIVIDAD (memoria operativa) =================
   Incidencias y notas ya no son dos secciones sino dos tipos de registro
   dentro del mismo historial cronológico. Lo que las distingue se conserva:
   una incidencia es un problema con seguimiento y desenlace; una nota es
   información que solo debe quedar registrada. */

function fmtTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function dayGroupLabel(iso) {
    if (iso === todayStr()) return 'Hoy';
    if (iso === addDays(-1)) return 'Ayer';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Un evento envuelve a la incidencia o la nota con los campos que el
// historial necesita ordenar y agrupar, sin perder el registro original.
function activityEvents() {
    const inc = DATA.incidents.map(i => ({ kind: 'incidencia', id: i.id, date: i.reportedAt || '', ts: i.ts || 0, raw: i }));
    const nts = DATA.notes.map(n => ({ kind: 'nota', id: n.id, date: n.createdAt || '', ts: n.ts || 0, raw: n }));
    return [...inc, ...nts];
}

function filteredActivity() {
    const cutoff = activityPeriod === 'todo' ? '' : addDays(-parseInt(activityPeriod, 10));
    return activityEvents()
        .filter(e => showArchivedActivity || !e.raw.archived)
        .filter(e => activityType === 'todo' || (activityType === 'incidencias' ? e.kind === 'incidencia' : e.kind === 'nota'))
        .filter(e => activityProject === 'todos' || e.raw.projectId === activityProject)
        // Filtrar por estado solo tiene sentido en incidencias: al usarlo, las
        // notas salen del resultado porque no tienen estado que comparar.
        .filter(e => activityStatus === 'todos' || (e.kind === 'incidencia' && e.raw.status === activityStatus))
        .filter(e => !cutoff || !e.date || e.date >= cutoff)
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.ts || 0) - (a.ts || 0));
}

function actividadView(isAdmin) {
    const events = filteredActivity();
    const groups = [];
    events.forEach(e => {
        const last = groups[groups.length - 1];
        if (last && last.date === e.date) last.items.push(e);
        else groups.push({ date: e.date, items: [e] });
    });

    const archivadas = activityEvents().filter(e => e.raw.archived).length;

    return `
    <p class="level-label">
      <span>Actividad</span>
      <span class="lvl-actions">
        ${isAdmin ? `<button class="btn-primary" onclick="openRecordDrawer()">+ nuevo registro</button>` : ''}
      </span>
    </p>

    <div class="task-controls">
      <div class="view-switch" id="activity-type-switch">
        <button data-t="todo">Todo</button>
        <button data-t="incidencias">Incidencias</button>
        <button data-t="notas">Notas</button>
      </div>
      ${archivadas ? `<button class="btn-quiet" onclick="toggleArchivedActivity()">${showArchivedActivity ? 'ocultar archivados' : `ver archivados (${archivadas})`}</button>` : ''}
    </div>

    <div class="filter-row activity-filters">
      <label class="mini-filter">Proyecto
        <select id="af-project">
          <option value="todos">Todos</option>
          ${allProjects().map(p => `<option value="${p.id}" ${activityProject === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
        </select>
      </label>
      <label class="mini-filter">Estado
        <select id="af-status">
          <option value="todos">Todos</option>
          ${INCIDENT_FLOW.map(s => `<option value="${s}" ${activityStatus === s ? 'selected' : ''}>${INCIDENT_STATUS[s]}</option>`).join('')}
        </select>
      </label>
      <label class="mini-filter">Periodo
        <select id="af-period">
          <option value="30" ${activityPeriod === '30' ? 'selected' : ''}>Últimos 30 días</option>
          <option value="90" ${activityPeriod === '90' ? 'selected' : ''}>Últimos 90 días</option>
          <option value="todo" ${activityPeriod === 'todo' ? 'selected' : ''}>Todo el historial</option>
        </select>
      </label>
    </div>

    ${groups.length === 0
            ? '<div class="empty">Sin registros que coincidan con estos filtros.</div>'
            : groups.map(g => `
      <div class="day-group">
        <p class="day-label">${escapeHtml(dayGroupLabel(g.date))}</p>
        ${g.items.map(e => e.kind === 'incidencia' ? incidentEntryHtml(e.raw, isAdmin) : noteEntryHtml(e.raw, isAdmin)).join('')}
      </div>`).join('')}
  `;
}

function mountActividadView() {
    document.querySelectorAll('#activity-type-switch button').forEach(b => {
        b.classList.toggle('active', b.dataset.t === activityType);
        b.addEventListener('click', () => { activityType = b.dataset.t; renderAll(); });
    });
    const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('change', e => { fn(e.target.value); renderAll(); }); };
    bind('af-project', v => activityProject = v);
    bind('af-status', v => activityStatus = v);
    bind('af-period', v => activityPeriod = v);
}

function toggleArchivedActivity() { showArchivedActivity = !showArchivedActivity; renderAll(); }
function toggleActivityDetail(id) { expandedActivityId = expandedActivityId === id ? null : id; renderAll(); }

/* ---------- una incidencia en el historial ---------- */
function incidentEntryHtml(i, isAdmin) {
    const open = expandedActivityId === i.id;
    const cerrada = i.status === 'resolved' || i.status === 'discarded';
    return `
    <article class="act-entry incidencia st-${i.status} ${i.archived ? 'archived' : ''}">
      <div class="act-top">
        <span class="act-kind">
          <span class="act-dot">${i.status === 'resolved' ? '✓' : i.status === 'discarded' ? '—' : '●'}</span>Incidencia
        </span>
        <span class="act-state st-${i.status}">${INCIDENT_STATUS[i.status]}</span>
        ${i.priority === 'alta' && !cerrada ? '<span class="act-prio">Prioridad alta</span>' : ''}
        <span class="act-time">${fmtTime(i.ts) || fmtDate(i.reportedAt)}</span>
      </div>
      <h3 class="act-title">${escapeHtml(i.title)}</h3>
      <p class="act-context">${escapeHtml(projectName(i.projectId))}${i.area ? ' · ' + escapeHtml(AREA_LABEL[i.area] || i.area) : ''}</p>
      <p class="act-byline">Reportó ${escapeHtml(i.reportedBy || '—')}${i.assigneeName ? ` · Responsable ${escapeHtml(i.assigneeName)}` : ''}</p>
      <p class="act-body">${escapeHtml(i.description)}</p>
      ${open ? incidentDetailHtml(i, isAdmin) : ''}
      <div class="act-actions">
        <button class="btn-quiet" onclick="toggleActivityDetail('${i.id}')">${open ? 'cerrar' : 'ver incidencia'}</button>
      </div>
    </article>`;
}

function incidentDetailHtml(i, isAdmin) {
    const cerrada = i.status === 'resolved' || i.status === 'discarded';
    const dato = (label, value) => `<div class="dt-cell"><span class="dt-label">${label}</span><span class="dt-value">${value}</span></div>`;
    return `
    <div class="act-detail">
      <div class="detail-grid">
        ${dato('Proyecto', escapeHtml(projectName(i.projectId)))}
        ${dato('Área', escapeHtml(i.area ? (AREA_LABEL[i.area] || i.area) : '—'))}
        ${dato('Reportó', escapeHtml(i.reportedBy || '—') + ' · ' + fmtDate(i.reportedAt))}
        ${dato('Responsable', escapeHtml(i.assigneeName || 'sin asignar'))}
        ${dato('Prioridad', escapeHtml(PRIORITY_LABEL[i.priority] || 'Normal'))}
        ${dato('Estado', `<span class="act-state st-${i.status}">${INCIDENT_STATUS[i.status]}</span>`)}
        ${i.taskId ? dato('Tarea', escapeHtml((taskById(i.taskId) || {}).title || '—')) : ''}
      </div>

      ${cerrada ? `
        <div class="resolution-box">
          <span class="rlabel">${i.status === 'resolved' ? 'Resolución' : 'Descartada'} · ${escapeHtml(i.resolvedBy || '—')} · ${fmtDate(i.resolvedAt)}</span>
          ${escapeHtml(i.resolution || 'Sin comentario.')}
        </div>` : ''}

      ${isAdmin ? `
      <div class="detail-actions">
        ${i.status === 'open' ? `<button class="btn-quiet" onclick="setIncidentStatus('${i.id}','tracking')">marcar en seguimiento</button>` : ''}
        ${!cerrada ? `
          <textarea class="resolution-input" id="res-${i.id}" placeholder="¿Cómo se resolvió? (opcional)"></textarea>
          <div class="detail-actions-row">
            <button class="btn-primary" onclick="closeIncident('${i.id}','resolved')">Marcar como resuelta</button>
            <button class="btn-quiet" onclick="closeIncident('${i.id}','discarded')">descartar</button>
          </div>` : `
          <div class="detail-actions-row">
            <button class="btn-quiet" onclick="setIncidentStatus('${i.id}','open')">reabrir</button>
            <button class="btn-quiet" onclick="setIncidentArchived('${i.id}', ${!i.archived})">${i.archived ? 'desarchivar' : 'archivar'}</button>
          </div>`}
      </div>` : ''}
    </div>`;
}

/* ---------- una nota en el historial (deliberadamente más ligera) ---------- */
function noteEntryHtml(n, isAdmin) {
    return `
    <article class="act-entry nota ${n.archived ? 'archived' : ''}">
      <div class="act-top">
        <span class="act-kind"><span class="act-dot">○</span>Nota</span>
        ${n.archived ? '<span class="act-state st-archived">Archivada</span>' : ''}
        <span class="act-time">${fmtTime(n.ts) || fmtDate(n.createdAt)}</span>
      </div>
      <p class="act-body note-body">${escapeHtml(n.text)}</p>
      <p class="act-context">${escapeHtml(projectName(n.projectId))}</p>
      <p class="act-byline">${escapeHtml(n.author || '—')}</p>
      ${isAdmin ? `
      <div class="act-actions">
        <button class="btn-quiet" onclick="setNoteArchived('${n.id}', ${!n.archived})">${n.archived ? 'desarchivar' : 'archivar'}</button>
      </div>` : ''}
    </article>`;
}

/* ---------- transiciones del ciclo de vida ---------- */
async function setIncidentStatus(id, status) {
    await updateDoc(doc(db, 'incidents', id), { status });
}

async function closeIncident(id, status) {
    const el = document.getElementById('res-' + id);
    const text = el ? el.value.trim() : '';
    await updateDoc(doc(db, 'incidents', id), {
        status,
        resolvedByUid: currentUser.uid,
        resolvedByName: currentUser.name,
        resolvedAt: todayStr(),
        resolution: text || (status === 'resolved' ? 'Resuelta sin comentario adicional.' : 'Descartada sin comentario adicional.'),
    });
}

async function setIncidentArchived(id, archived) { await updateDoc(doc(db, 'incidents', id), { archived }); }
async function setNoteArchived(id, archived) { await updateDoc(doc(db, 'notes', id), { archived }); }

/* ---------- tarjeta de solo lectura (reporte de proyecto finalizado) ---------- */
function incidentCardHtml(i) {
    const cerrada = i.status === 'resolved' || i.status === 'discarded';
    return `
    <div class="incident-card ${i.status}">
      <h3>${escapeHtml(i.title)}</h3>
      <div class="meta">
        <span class="tag project-tag">${escapeHtml(projectName(i.projectId))}</span>
        ${i.area ? `<span class="tag area-${i.area}">${escapeHtml(AREA_LABEL[i.area] || i.area)}</span>` : ''}
        <span>reportó ${escapeHtml(i.reportedBy)} · ${fmtDate(i.reportedAt)}</span>
        <span class="act-state st-${i.status}">${INCIDENT_STATUS[i.status]}</span>
      </div>
      <p>${escapeHtml(i.description)}</p>
      ${cerrada ? `
        <div class="resolution-box">
          <span class="rlabel">${i.status === 'resolved' ? 'Resolución' : 'Descartada'} · ${escapeHtml(i.resolvedBy || '—')} · ${fmtDate(i.resolvedAt)}</span>
          ${escapeHtml(i.resolution || 'Sin comentario.')}
        </div>` : ''}
    </div>`;
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
      ${kind === 'active' ? `<button onclick="saveUserFields('${u.uid}')">guardar</button>${u.role === 'admin' && u.pinHash ? `<button onclick="resetUserPin('${u.uid}')">restablecer NIP</button>` : ''}<button class="revoke" onclick="revokeUser('${u.uid}')">revocar acceso</button>` : ''}
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
    <div id="gates-holder"></div>
    <div id="project-sub-view"></div>
  `;
}

function mountProyectosView() {
    renderGates();
    renderProjectSubView();
}

function setSubView(mode) { viewMode = mode; renderAll(); }

// La puerta al trabajo del día tiene peso propio (nivel de acción); semana y
// calendario quedan por debajo, como accesos secundarios.
function renderGates() {
    const overdue = DATA.tasks.filter(t => isOverdue(t.due, t.col)).length;
    const hoy = DATA.tasks.filter(t => isDueToday(t.due, t.col)).length;
    const total = overdue + hoy;
    const weekDates = weekWindowDates();
    const weekTasks = DATA.tasks.filter(t => t.col !== 2 && t.due && weekDates.includes(t.due)).length;

    const sub = total === 0
        ? 'nada vencido ni con entrega hoy'
        : [hoy ? `${hoy} para hoy` : '', overdue ? `<span class="warn">${overdue} vencida${overdue > 1 ? 's' : ''}</span>` : ''].filter(Boolean).join(' · ');

    document.getElementById('gates-holder').innerHTML = `
    <button class="today-gate ${viewMode === 'today' ? 'in-today' : ''}" id="today-gate-btn">
      ${viewMode === 'today' ? '' : `<span class="tg-num">${total}</span>`}
      <span>
        <span class="tg-main">${viewMode === 'today' ? '← volver a proyectos' : 'Tareas de hoy'}</span>
        ${viewMode === 'today' ? '' : `<span class="tg-sub">${sub}</span>`}
      </span>
    </button>
    <div class="secondary-gates">
      <button id="week-gate-btn" class="${viewMode === 'week' ? 'active' : ''}">
        ${viewMode === 'week' ? '← volver a proyectos' : `Resumen semanal${weekTasks ? `<span class="count">${weekTasks}</span>` : ''}`}
      </button>
    </div>`;

    document.getElementById('today-gate-btn').addEventListener('click', () => setSubView(viewMode === 'today' ? 'project' : 'today'));
    document.getElementById('week-gate-btn').addEventListener('click', () => setSubView(viewMode === 'week' ? 'project' : 'week'));
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

// Dentro de Proyectos el calendario es una de las tres formas de ver las
// MISMAS tareas, así que respeta el proyecto activo y el filtro de área igual
// que lista y kanban. En Resumen la pregunta es otra —"¿cómo viene el mes?"—
// y ahí muestra las tareas de todos los proyectos.
function calendarTasks() { return calScope === 'all' ? DATA.tasks : visibleTasks(); }
function tasksForDate(iso) { return calendarTasks().filter(t => t.col !== 2 && t.due === iso); }

function renderCalendar() {
    const first = new Date(calYear, calMonth, 1);
    const startWeekday = first.getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const mesAnio = first.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    document.getElementById('cal-title').textContent = mesAnio.charAt(0).toUpperCase() + mesAnio.slice(1);
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
/* Tres niveles explícitos:
   1. PROYECTOS  — ¿en qué estamos trabajando?
   2. TAREAS     — ¿qué trabajo existe dentro?
   3. OPERACIÓN  — crear, filtrar, ordenar, mover. */
function projectBoardShellHtml() {
    return `
    <p class="level-label">
      <span>Proyectos</span>
      <span class="lvl-actions">
        <button class="btn-quiet" onclick="toggleFinished()">${showFinished ? 'ocultar finalizados' : 'ver finalizados'}</button>
      </span>
    </p>
    <div class="projects-strip" id="projects-strip"></div>
    <div class="new-project-form" id="new-project-form">
      <input type="text" name="name" placeholder="Nombre del proyecto">
      <input type="text" name="client" placeholder="Institución / cliente">
      <label>Entrega<input type="date" name="deadline"></label>
      <button id="save-project-btn">Crear</button>
      <button class="cancel" id="cancel-project-btn" type="button">Cancelar</button>
    </div>
    <div class="project-toolbar" id="project-toolbar"></div>

    <p class="level-label" style="margin-top:26px;"><span>Tareas</span></p>
    <div class="tasks-head">
      <span class="th-context"><h2 id="active-name"></h2><span class="sub" id="active-sub"></span></span>
      <button class="btn-primary" onclick="openTaskForm()">+ nueva tarea</button>
    </div>
    <div class="task-controls">
      <div class="view-switch" id="view-switch">
        <button data-view="lista">Lista</button>
        <button data-view="kanban">Kanban</button>
        <button data-view="calendario">Calendario</button>
      </div>
      <div class="sort-control">
        <span>Ordenar</span>
        <select id="sort-input">
          <option value="due">Fecha de entrega</option>
          <option value="priority">Prioridad</option>
          <option value="project">Proyecto</option>
          <option value="assignee">Responsable</option>
          <option value="created">Fecha de creación</option>
        </select>
      </div>
    </div>
    <div class="filter-row">
      <span class="filter-label">Área</span>
      <div class="area-filter" id="area-filter">
        <button data-area="todas">Todas</button>
        ${AREA_ORDER.map(a => `<button data-area="${a}">${AREA_LABEL[a]}</button>`).join('')}
      </div>
    </div>
    <div id="project-body"></div>
  `;
}

function toggleFinished() { showFinished = !showFinished; renderAll(); }

function mountProjectBoard() {
    renderProjectsStrip();
    renderActiveHead();

    document.querySelectorAll('#view-switch button').forEach(b => {
        b.classList.toggle('active', b.dataset.view === taskView);
        b.addEventListener('click', () => { taskView = b.dataset.view; renderAll(); });
    });

    const sortEl = document.getElementById('sort-input');
    sortEl.value = sortMode;
    sortEl.addEventListener('change', e => { sortMode = e.target.value; renderProjectBody(); });

    document.querySelectorAll('#area-filter button').forEach(b => {
        b.classList.toggle('active', b.dataset.area === activeAreaFilter);
        b.addEventListener('click', () => { activeAreaFilter = b.dataset.area; renderAll(); });
    });

    renderProjectBody();
    document.getElementById('save-project-btn').addEventListener('click', addOrUpdateProject);
    document.getElementById('cancel-project-btn').addEventListener('click', cancelProjectForm);
}

function activeProject() {
    return activeProjectId === 'general' ? GENERAL_PROJECT : DATA.projects.find(x => x.id === activeProjectId);
}

// Un proyecto finalizado se archiva: en vez del tablero editable se muestra
// un reporte de solo lectura (tareas, incidencias y notas de ese proyecto).
// Para volver a editarlo hay que reabrirlo primero.
// Las tres vistas (lista, kanban, calendario) muestran exactamente el mismo
// conjunto de tareas — el del proyecto activo, ya filtrado por área.
function visibleTasks() {
    const tasks = projectTasks(activeProjectId);
    return activeAreaFilter === 'todas' ? tasks : tasks.filter(t => t.area === activeAreaFilter);
}

function renderProjectBody() {
    const p = activeProject();
    const body = document.getElementById('project-body');
    if (p && p.status === 'finalizado') {
        body.innerHTML = projectReportHtml(p);
        return;
    }
    if (taskView === 'lista') { body.innerHTML = taskListHtml(); return; }
    if (taskView === 'calendario') { calScope = 'project'; body.innerHTML = calendarShellHtml(); mountCalendar(); return; }
    body.innerHTML = `
    <div class="board">
      <div class="col" data-col="0"><div class="col-head"><span class="col-num">01</span><span class="col-title">Por hacer</span><span class="col-count" id="count-0">0</span></div><div class="cards" id="cards-0"></div></div>
      <div class="col" data-col="1"><div class="col-head"><span class="col-num">02</span><span class="col-title">En curso</span><span class="col-count" id="count-1">0</span></div><div class="cards" id="cards-1"></div></div>
      <div class="col" data-col="2"><div class="col-head"><span class="col-num">03</span><span class="col-title">Hecho</span><span class="col-count" id="count-2">0</span></div><div class="cards" id="cards-2"></div></div>
    </div>
  `;
    renderBoard();
}

const COL_LABEL = ['Por hacer', 'En curso', 'Hecho'];

function taskListHtml() {
    const tasks = sortTasks(visibleTasks());
    if (!tasks.length) return '<div class="empty">Sin tareas que coincidan con este filtro.</div>';
    return `
    <div class="task-list-head">
      <span>Tarea</span><span>Proyecto</span><span>Área</span><span>Responsable</span><span>Entrega</span><span></span>
    </div>
    ${tasks.map(t => {
        const overdue = isOverdue(t.due, t.col);
        const dueTxt = t.due ? (overdue ? 'vencida ' : '') + fmtDate(t.due) : '—';
        return `
      <div class="task-list-row ${overdue ? 'is-overdue' : ''} ${t.col === 2 ? 'is-done' : ''}">
        <span class="tlr-title">${escapeHtml(t.title)}${t.priority === 'urgente' ? ' <span class="tag urgent">urgente</span>' : ''}</span>
        <span class="tlr-cell">${escapeHtml(projectName(t.projectId))}</span>
        <span class="tlr-cell"><span class="tag area-${t.area}">${escapeHtml(AREA_LABEL[t.area] || t.area)}</span></span>
        <span class="tlr-cell">${escapeHtml(t.assignee || 'sin asignar')}</span>
        <span class="tlr-cell ${overdue ? 'warn' : ''}">${dueTxt}</span>
        <span class="tlr-actions">
          <button class="btn-quiet" onclick="moveTask('${t.id}', -1)" ${t.col === 0 ? 'disabled' : ''}>&larr;</button>
          <button class="btn-quiet" onclick="moveTask('${t.id}', 1)" ${t.col === 2 ? 'disabled' : ''}>&rarr;</button>
          <button class="btn-quiet" onclick="startEditTask('${t.id}')">editar</button>
        </span>
      </div>`;
    }).join('')}`;
}

function projectReportHtml(p) {
    const tasks = projectTasks(p.id);
    const done = tasks.filter(t => t.col === 2).length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    const incidents = DATA.incidents.filter(i => i.projectId === p.id).sort((a, b) => a.reportedAt.localeCompare(b.reportedAt));
    const notes = DATA.notes.filter(n => n.projectId === p.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const openInc = incidents.filter(i => i.status === 'open').length;
    const colLabel = ['Por hacer', 'En curso', 'Hecho'];

    return `
    <div class="report-banner">
      📦 proyecto archivado${p.finalizedAt ? ` — finalizado el ${fmtDate(p.finalizedAt)}` : ''}
    </div>
    <div class="indicator-grid">
      <div class="indicator-card"><div class="num">${tasks.length}</div><div class="label">Tareas totales</div></div>
      <div class="indicator-card"><div class="num">${pct}%</div><div class="label">Completado</div></div>
      <div class="indicator-card ${openInc ? 'warn' : ''}"><div class="num ${openInc ? 'warn-num' : ''}">${incidents.length}</div><div class="label">Incidencias (${openInc} sin resolver)</div></div>
      <div class="indicator-card"><div class="num">${notes.length}</div><div class="label">Notas registradas</div></div>
    </div>

    <p class="section-label"><span>Tareas</span></p>
    ${tasks.length === 0 ? '<div class="empty">Sin tareas registradas.</div>' : `<div class="today-list">${tasks.map(t => `
      <div class="today-item">
        <div class="top-row">
          <div>
            <p class="title">${escapeHtml(t.title)}</p>
            <div class="meta">
              <span class="tag area-${t.area}">${escapeHtml(AREA_LABEL[t.area] || t.area)}</span>
              ${t.assignee ? `<span>${escapeHtml(t.assignee)}</span>` : ''}
              <span class="tag ${t.col === 2 ? 'status-resolved' : 'status-open'}">${colLabel[t.col]}</span>
            </div>
            ${t.notes ? `<p class="card-notes">${escapeHtml(t.notes)}</p>` : ''}
          </div>
        </div>
      </div>`).join('')}</div>`}

    <p class="section-label" style="margin-top:22px;"><span>Incidencias</span></p>
    ${incidents.length === 0 ? '<div class="empty">Sin incidencias registradas.</div>' : incidents.map(i => incidentCardHtml(i)).join('')}

    <p class="section-label" style="margin-top:22px;"><span>Notas</span></p>
    ${notes.length === 0 ? '<div class="empty">Sin notas registradas.</div>' : notes.map(n => `
      <div class="note-card">
        <div class="meta"><strong>${escapeHtml(n.author)}</strong><span>${fmtDate(n.createdAt)}</span></div>
        <p>${escapeHtml(n.text)}</p>
      </div>`).join('')}

    <button class="open-form-btn secondary print-hide" style="margin-top:20px;" onclick="window.print()">Imprimir / exportar reporte</button>
  `;
}

function renderProjectsStrip() {
    const strip = document.getElementById('projects-strip');
    const ordered = [GENERAL_PROJECT, ...sortedProjectList()];
    // Cada tarjeta es un resumen operativo: se debe poder leer el estado del
    // proyecto sin abrirlo.
    strip.innerHTML = ordered.map(p => {
        const tasks = projectTasks(p.id);
        const done = tasks.filter(t => t.col === 2).length;
        const enCurso = tasks.filter(t => t.col === 1).length;
        const porHacer = tasks.filter(t => t.col === 0).length;
        const vencidas = tasks.filter(t => isOverdue(t.due, t.col)).length;
        const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
        const overdue = p.deadline && p.deadline < todayStr() && pct < 100 && p.status !== 'finalizado';
        return `
      <div class="project-card ${p.id === activeProjectId ? 'active' : ''} ${p.general ? 'general' : ''} ${overdue ? 'overdue' : ''}" onclick="selectProject('${p.id}')">
        <p class="project-name">${escapeHtml(p.name)} ${p.status === 'finalizado' ? '✓' : ''}</p>
        <p class="project-client">${escapeHtml(p.client || '')}</p>
        <div class="project-figures">
          <span class="pf-pct">${pct}%</span>
          <span class="pf-total">${tasks.length} tarea${tasks.length === 1 ? '' : 's'}</span>
        </div>
        <div class="project-bar-track"><div class="project-bar-fill" style="width:${pct}%"></div></div>
        <div class="project-breakdown">
          ${vencidas ? `<span class="warn">${vencidas} vencida${vencidas > 1 ? 's' : ''}</span>` : ''}
          <span>${enCurso} en curso</span>
          <span>${porHacer} por hacer</span>
          <span>${done} hecha${done === 1 ? '' : 's'}</span>
        </div>
        ${p.general ? '' : `<p class="project-deadline ${overdue ? 'overdue' : ''}">
          <span class="pd-label">Entrega</span>${p.deadline ? fmtDate(p.deadline) : 'sin fecha'}
        </p>`}
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
    const p = activeProject();
    if (!p) { activeProjectId = 'general'; renderAll(); return; }
    const visibles = visibleTasks().length;
    document.getElementById('active-name').textContent = p.name;
    document.getElementById('active-sub').textContent = p.general
        ? `tareas que no pertenecen a ningún proyecto · ${visibles}`
        : [p.client, p.deadline ? 'entrega ' + fmtDate(p.deadline) : '', `${visibles} tarea${visibles === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    const toolbar = document.getElementById('project-toolbar');
    if (p.general) { toolbar.innerHTML = ''; return; }
    const registros = activityEvents().filter(e => e.raw.projectId === p.id && !e.raw.archived).length;
    const verActividad = `<button class="edit-btn" onclick="openProjectActivity('${p.id}')">actividad${registros ? ` (${registros})` : ''}</button>`;
    toolbar.innerHTML = p.status === 'finalizado' ? `
    <button class="finalize" onclick="reopenProject()">↺ reabrir proyecto</button>
    ${verActividad}
    <button class="edit-btn" onclick="startEditProject()">editar</button>
    <button class="danger" onclick="deleteProject()">eliminar proyecto</button>
  ` : `
    <button class="finalize" onclick="finalizeProject()">✓ finalizar proyecto</button>
    ${verActividad}
    <button class="edit-btn" onclick="startEditProject()">editar</button>
    <button class="danger" onclick="deleteProject()">eliminar proyecto</button>
  `;
}

async function finalizeProject() { if (activeProjectId !== 'general') await updateDoc(doc(db, 'projects', activeProjectId), { status: 'finalizado', finalizedAt: todayStr() }); }
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

/* ---------- panel lateral: crear tarea ----------
   El formulario deja de ocupar la pantalla de forma permanente. El proyecto
   es un campo más, no el encabezado de la sección: así una tarea sin proyecto
   es explícitamente independiente, no "algo dentro de Tareas generales". */
function openTaskForm() { taskFormOpen = true; renderAll(); }
function closeTaskForm() { taskFormOpen = false; renderAll(); }

function taskDrawerHtml() {
    return `
    <div class="drawer-overlay" onclick="closeTaskForm()"></div>
    <aside class="drawer" role="dialog" aria-label="Nueva tarea">
      <div class="drawer-head">
        <h3>Nueva tarea</h3>
        <button onclick="closeTaskForm()" aria-label="Cerrar">&times;</button>
      </div>
      <div class="drawer-body">
        <div class="drawer-field">
          <label for="nt-title">Título</label>
          <input type="text" id="nt-title" placeholder="p. ej. Cortar PTR 5x5 base sala 3">
        </div>
        <div class="drawer-field">
          <label for="nt-project">Proyecto</label>
          <select id="nt-project">${projectOptions(activeProjectId)}</select>
        </div>
        <div class="drawer-row">
          <div class="drawer-field">
            <label for="nt-area">Área</label>
            <select id="nt-area">${areaOptions('produccion')}</select>
          </div>
          <div class="drawer-field">
            <label for="nt-priority">Prioridad</label>
            <select id="nt-priority"><option value="normal">Normal</option><option value="urgente">Urgente</option></select>
          </div>
        </div>
        <div class="drawer-field">
          <label>Responsables</label>
          ${assigneesPickerHtml('nt-assignee', [])}
        </div>
        <div class="drawer-field">
          <label for="nt-due">Fecha de entrega</label>
          <input type="date" id="nt-due">
        </div>
        <div class="drawer-field">
          <label for="nt-notes">Nota (opcional)</label>
          <textarea id="nt-notes" placeholder="Contexto, medidas, material..."></textarea>
        </div>
        <div class="drawer-error" id="nt-error"></div>
        <div class="drawer-actions">
          <button class="cancel" onclick="closeTaskForm()">Cancelar</button>
          <button class="btn-primary" id="nt-submit">Crear tarea</button>
        </div>
      </div>
    </aside>`;
}

function mountTaskDrawer() {
    const title = document.getElementById('nt-title');
    title.focus();
    title.addEventListener('keydown', e => { if (e.key === 'Enter') submitNewTask(); });
    document.getElementById('nt-submit').addEventListener('click', submitNewTask);
}

/* ---------- panel lateral: nuevo registro (incidencia o nota) ----------
   Una sola acción de entrada. El usuario elige el tipo después de decidir
   que quiere registrar algo, en vez de tener que entender de antemano la
   diferencia entre las dos secciones. */
function openRecordDrawer(projectId) {
    recordDrawer = 'elegir';
    recordDrawerProject = projectId || null;
    renderAll();
}
function closeRecordDrawer() { recordDrawer = null; recordDrawerProject = null; renderAll(); }
function chooseRecordType(kind) { recordDrawer = kind; renderAll(); }

function recordDrawerHtml() {
    const body = recordDrawer === 'elegir' ? recordChooserHtml()
        : recordDrawer === 'incidencia' ? incidentFormHtml()
            : noteFormHtml();
    const title = recordDrawer === 'elegir' ? 'Nuevo registro'
        : recordDrawer === 'incidencia' ? 'Nueva incidencia' : 'Nueva nota';
    return `
    <div class="drawer-overlay" onclick="closeRecordDrawer()"></div>
    <aside class="drawer" role="dialog" aria-label="${title}">
      <div class="drawer-head">
        <h3>${title}</h3>
        <button onclick="closeRecordDrawer()" aria-label="Cerrar">&times;</button>
      </div>
      <div class="drawer-body">${body}</div>
    </aside>`;
}

function recordChooserHtml() {
    return `
    <p class="chooser-question">¿Qué quieres registrar?</p>
    <button class="type-card" onclick="chooseRecordType('incidencia')">
      <span class="tc-head"><span class="tc-dot warn">●</span>Incidencia</span>
      <span class="tc-desc">Un problema que requiere seguimiento hasta resolverse.</span>
    </button>
    <button class="type-card" onclick="chooseRecordType('nota')">
      <span class="tc-head"><span class="tc-dot">○</span>Nota</span>
      <span class="tc-desc">Información que debe quedar registrada, sin seguimiento.</span>
    </button>`;
}

function incidentFormHtml() {
    const pre = recordDrawerProject || activeProjectId;
    return `
    <div class="drawer-field">
      <label for="ni-title">Título</label>
      <input type="text" id="ni-title" placeholder="p. ej. Se acabó el PTR">
    </div>
    <div class="drawer-field">
      <label for="ni-desc">Descripción</label>
      <textarea id="ni-desc" placeholder="Qué pasó y qué está bloqueando."></textarea>
    </div>
    <div class="drawer-field">
      <label for="ni-project">Proyecto</label>
      <select id="ni-project">${projectOptions(pre)}</select>
    </div>
    <div class="drawer-row">
      <div class="drawer-field">
        <label for="ni-area">Área</label>
        <select id="ni-area">${areaOptions(currentUser.area || 'produccion')}</select>
      </div>
      <div class="drawer-field">
        <label for="ni-priority">Prioridad</label>
        <select id="ni-priority">
          <option value="alta">Alta</option>
          <option value="normal" selected>Normal</option>
          <option value="baja">Baja</option>
        </select>
      </div>
    </div>
    <div class="drawer-field">
      <label for="ni-assignee">Responsable</label>
      <select id="ni-assignee">
        <option value="">— por asignar —</option>
        ${activeUsers().map(u => `<option value="${u.uid}">${escapeHtml(shortName(u.name))} — ${AREA_LABEL[u.area] || 'sin área'}</option>`).join('')}
      </select>
    </div>
    <div class="drawer-error" id="ni-error"></div>
    <div class="drawer-actions">
      <button class="cancel" onclick="closeRecordDrawer()">Cancelar</button>
      <button class="btn-primary" onclick="submitIncident()">Reportar incidencia</button>
    </div>`;
}

function noteFormHtml() {
    const pre = recordDrawerProject || activeProjectId;
    return `
    <div class="drawer-field">
      <label for="nn-project">Proyecto</label>
      <select id="nn-project">${projectOptions(pre)}</select>
    </div>
    <div class="drawer-field">
      <label for="nn-text">Nota</label>
      <textarea id="nn-text" rows="6" placeholder="Avance, observación, decisión, contexto..." style="min-height:120px;"></textarea>
    </div>
    <div class="drawer-error" id="nn-error"></div>
    <div class="drawer-actions">
      <button class="cancel" onclick="closeRecordDrawer()">Cancelar</button>
      <button class="btn-primary" onclick="submitNote()">Guardar nota</button>
    </div>`;
}

function mountRecordDrawer() {
    const first = document.getElementById('ni-title') || document.getElementById('nn-text');
    if (first) first.focus();
}

async function submitIncident() {
    const title = document.getElementById('ni-title').value.trim();
    const description = document.getElementById('ni-desc').value.trim();
    const err = document.getElementById('ni-error');
    if (!title) { err.textContent = 'La incidencia necesita un título.'; return; }
    if (!description) { err.textContent = 'Describe brevemente qué ocurrió.'; return; }
    const assigneeUid = document.getElementById('ni-assignee').value;
    const assignee = assigneeUid ? activeUsers().find(u => u.uid === assigneeUid) : null;
    await addDoc(collection(db, 'incidents'), {
        title, description,
        projectId: document.getElementById('ni-project').value,
        area: document.getElementById('ni-area').value,
        priority: document.getElementById('ni-priority').value,
        assigneeUid: assigneeUid || '',
        assigneeName: assignee ? assignee.name : '',
        taskId: '',
        reportedByUid: currentUser.uid,
        reportedByName: currentUser.name,
        reportedAt: todayStr(),
        ts: Date.now(),
        status: 'open',
        archived: false,
        resolvedByUid: '', resolvedByName: '', resolvedAt: '', resolution: '',
    });
    closeRecordDrawer();
}

async function submitNote() {
    const text = document.getElementById('nn-text').value.trim();
    const err = document.getElementById('nn-error');
    if (!text) { err.textContent = 'La nota está vacía.'; return; }
    await addDoc(collection(db, 'notes'), {
        text,
        authorUid: currentUser.uid,
        authorName: currentUser.name,
        projectId: document.getElementById('nn-project').value,
        taskId: '',
        createdAt: todayStr(),
        ts: Date.now(),
        archived: false,
    });
    closeRecordDrawer();
}

async function submitNewTask() {
    const title = document.getElementById('nt-title').value.trim();
    const err = document.getElementById('nt-error');
    if (!title) { err.textContent = 'La tarea necesita un título.'; return; }
    const projectId = document.getElementById('nt-project').value;
    await addDoc(collection(db, 'tasks'), {
        title,
        assignees: readAssignees(document.getElementById('nt-assignee-picker')),
        area: document.getElementById('nt-area').value,
        due: document.getElementById('nt-due').value,
        priority: document.getElementById('nt-priority').value,
        notes: document.getElementById('nt-notes').value.trim(),
        projectId, col: 0, createdAt: Date.now(),
    });
    activeProjectId = projectId; // que la tarea recién creada quede a la vista
    taskFormOpen = false;
    renderAll();
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
    const assignees = readAssignees(document.getElementById('edit-' + id + '-picker'));
    const title = wrap.querySelector('.f-title').value.trim() || (t ? t.title : '');
    const patch = {
        title,
        assignees,
        area: wrap.querySelector('.f-area').value,
        due: wrap.querySelector('.f-due').value,
        priority: wrap.querySelector('.f-priority').value,
        notes: wrap.querySelector('.f-notes').value.trim(),
    };
    editingTaskId = null;
    await updateDoc(doc(db, 'tasks', id), patch);
}

function byDueDate(a, b) {
    if (a.due && b.due) return a.due.localeCompare(b.due);
    if (a.due) return -1;
    if (b.due) return 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
}

function sortTasks(list) {
    const arr = [...list];
    switch (sortMode) {
        case 'priority': return arr.sort((a, b) => (b.priority === 'urgente') - (a.priority === 'urgente') || byDueDate(a, b));
        case 'project': return arr.sort((a, b) => projectName(a.projectId).localeCompare(projectName(b.projectId)) || byDueDate(a, b));
        case 'assignee': return arr.sort((a, b) => (a.assignee || 'zzz').localeCompare(b.assignee || 'zzz') || byDueDate(a, b));
        case 'created': return arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        default: return arr.sort(byDueDate);
    }
}

function renderBoard() {
    const tasks = visibleTasks();
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
              ${assigneesPickerHtml('edit-' + t.id, t.assignees)}
              <div class="row">
                <input class="f-due" type="date" value="${t.due || ''}">
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
    // El colaborador ve su propio historial con la misma estructura que la
    // Actividad del administrador, solo que acotado a lo que él registró.
    const misRegistros = activityEvents()
        .filter(e => e.kind === 'incidencia' ? e.raw.reportedByUid === currentUser.uid : e.raw.authorUid === currentUser.uid)
        .filter(e => !e.raw.archived)
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.ts || 0) - (a.ts || 0));

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
      <p class="section-label">
        <span>Lo que he registrado</span>
        <button class="btn-primary" onclick="openRecordDrawer()">+ nuevo registro</button>
      </p>
      ${misRegistros.length === 0
            ? '<div class="empty">Todavía no has registrado nada. Usa «nuevo registro» para reportar un problema o dejar una nota.</div>'
            : misRegistros.map(e => e.kind === 'incidencia' ? incidentEntryHtml(e.raw, false) : noteEntryHtml(e.raw, false)).join('')}
    </div>
  `;
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
    submitNote, submitIncident,
    openRecordDrawer, closeRecordDrawer, chooseRecordType,
    toggleActivityDetail, toggleArchivedActivity,
    setIncidentStatus, closeIncident, setIncidentArchived, setNoteArchived,
    openIncident, openProjectActivity,
    goToday, approveUser, saveUserFields, revokeUser, reactivateUser,
    resetUserPin,
    goTab, openTask, openProject,
    openTaskForm, closeTaskForm, toggleExternalField,
});

renderAll();
