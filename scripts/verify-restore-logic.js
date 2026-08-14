// Script de verificacion (no forma parte de la app): simula exportar y
// restaurar un respaldo directamente contra el emulador de Firestore, para
// confirmar que el borrado + reescritura por lotes preserva IDs y relaciones
// (projectId, assigneeUid, taskId) y nunca toca la coleccion users.
//
// Uso: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/verify-restore-logic.js

const admin = require('firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('Este script solo debe correr contra el emulador.');
    process.exit(1);
}
admin.initializeApp({ projectId: 'pme-plataforma' });
const db = admin.firestore();

async function main() {
    // limpiar estado previo de prueba
    for (const col of ['projects', 'tasks', 'incidents', 'notes', 'users']) {
        const snap = await db.collection(col).get();
        await Promise.all(snap.docs.map(d => d.ref.delete()));
    }

    await db.collection('users').doc('u1').set({ email: 'admin@test.com', role: 'admin', status: 'active' });
    await db.collection('projects').doc('p1').set({ name: 'Proyecto de prueba', status: 'activo' });
    await db.collection('tasks').doc('t1').set({ title: 'Tarea 1', projectId: 'p1', assigneeUid: 'u1', assigneeName: 'Admin', col: 2 });
    await db.collection('incidents').doc('i1').set({ title: 'Incidencia 1', projectId: 'p1', taskId: 't1', status: 'open' });
    await db.collection('notes').doc('n1').set({ text: 'Nota 1', projectId: 'p1' });

    // "exportar": leer tal cual quedaria DATA en la app
    const exportOf = async col => (await db.collection(col).get()).docs.map(d => ({ id: d.id, ...d.data() }));
    const backup = {
        projects: await exportOf('projects'),
        tasks: await exportOf('tasks'),
        incidents: await exportOf('incidents'),
        notes: await exportOf('notes'),
    };

    // modificar el estado actual para simular que algo cambio despues del respaldo
    await db.collection('tasks').doc('t1').update({ col: 0 });
    await db.collection('projects').doc('p2').set({ name: 'Proyecto nuevo sin respaldo', status: 'activo' });

    // "restaurar": borrar todo lo actual de esas 4 colecciones, escribir el respaldo
    const COLLECTIONS = ['projects', 'tasks', 'incidents', 'notes'];
    for (const col of COLLECTIONS) {
        const snap = await db.collection(col).get();
        await Promise.all(snap.docs.map(d => d.ref.delete()));
    }
    for (const col of COLLECTIONS) {
        for (const item of backup[col]) {
            const { id, ...data } = item;
            await db.collection(col).doc(id).set(data);
        }
    }

    // verificar
    const p1 = await db.collection('projects').doc('p1').get();
    const p2 = await db.collection('projects').doc('p2').get();
    const t1 = await db.collection('tasks').doc('t1').get();
    const i1 = await db.collection('incidents').doc('i1').get();
    const n1 = await db.collection('notes').doc('n1').get();
    const u1 = await db.collection('users').doc('u1').get();

    const checks = [
        ['p1 existe tras restaurar', p1.exists],
        ['p2 (creado despues del respaldo) fue eliminado por la restauracion', !p2.exists],
        ['t1.col volvio a 2 (estado del respaldo, no el modificado)', t1.data().col === 2],
        ['t1.projectId sigue apuntando a p1', t1.data().projectId === 'p1'],
        ['i1.taskId sigue apuntando a t1', i1.data().taskId === 't1'],
        ['n1 existe tras restaurar', n1.exists],
        ['u1 (usuario) NO fue tocado por la restauracion', u1.exists && u1.data().role === 'admin'],
    ];
    let ok = true;
    for (const [label, pass] of checks) {
        console.log((pass ? 'OK  ' : 'FAIL') + ' - ' + label);
        if (!pass) ok = false;
    }
    process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
