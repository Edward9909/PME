// Verifica firestore.rules contra el emulador (asserta permiso concedido o
// denegado con identidades simuladas de admin/colaborador). No usa el Admin
// SDK (que se salta las reglas) sino @firebase/rules-unit-testing, que sí
// las evalúa de verdad.
//
// Uso: primero levantar el emulador (firebase emulators:start), luego:
//   node scripts/verify-rules.js

const fs = require('fs');
const {
    initializeTestEnvironment, assertSucceeds, assertFails,
} = require('@firebase/rules-unit-testing');

async function main() {
    const testEnv = await initializeTestEnvironment({
        projectId: 'pme-plataforma',
        firestore: {
            rules: fs.readFileSync('firestore.rules', 'utf8'),
            host: '127.0.0.1',
            port: 8080,
        },
    });

    await testEnv.clearFirestore();

    // sembrar usuarios y datos base como admin (sin reglas)
    await testEnv.withSecurityRulesDisabled(async ctx => {
        const db = ctx.firestore();
        await db.doc('users/admin1').set({ role: 'admin', status: 'active', area: null });
        await db.doc('users/collab1').set({ role: 'collaborator', status: 'active', area: 'produccion' });
        await db.doc('projects/p1').set({ name: 'P1', status: 'activo' });
        await db.doc('tasks/t1').set({ title: 'T1', projectId: 'p1' });
    });

    const admin = testEnv.authenticatedContext('admin1', { email: 'admin@test.com' }).firestore();
    const collab = testEnv.authenticatedContext('collab1', { email: 'collab@test.com' }).firestore();

    const checks = [];
    const check = async (label, promise, expect) => {
        try { await promise; checks.push([label, expect === 'allow']); }
        catch (e) { checks.push([label, expect === 'deny']); }
    };

    // --- lo que ya funcionaba antes (no debe romperse) ---
    await check(
        'colaborador puede crear su propia incidencia abierta',
        collab.doc('incidents/i-own').set({ title: 'x', projectId: 'p1', taskId: 't1', reportedByUid: 'collab1', reportedByName: 'C', reportedAt: '2026-08-14', status: 'open', resolvedByUid: '', resolvedByName: '', resolvedAt: '', resolution: '' }),
        'allow'
    );
    await check(
        'colaborador NO puede crear incidencia a nombre de otro',
        collab.doc('incidents/i-fake').set({ title: 'x', projectId: 'p1', reportedByUid: 'otro-uid', status: 'open' }),
        'deny'
    );
    await check(
        'colaborador NO puede crear su propia incidencia ya resuelta',
        collab.doc('incidents/i-resolved-self').set({ title: 'x', projectId: 'p1', reportedByUid: 'collab1', status: 'resolved' }),
        'deny'
    );
    await check(
        'colaborador puede crear su propia nota',
        collab.doc('notes/n-own').set({ text: 'x', projectId: 'p1', authorUid: 'collab1', authorName: 'C', createdAt: '2026-08-14', archived: false }),
        'allow'
    );
    await check(
        'colaborador NO puede editar/archivar una nota',
        collab.doc('notes/n-own').update({ archived: true }),
        'deny'
    );

    // --- lo que arregla el fix (restaurar respaldo como admin) ---
    await check(
        'admin puede crear incidencia a nombre de otra persona (restaurar respaldo)',
        admin.doc('incidents/i-restored').set({ title: 'x', projectId: 'p1', reportedByUid: 'collab1', reportedByName: 'C', status: 'resolved', resolvedByUid: 'admin1', resolvedByName: 'A', resolvedAt: '2026-08-13', resolution: 'ok' }),
        'allow'
    );
    await check(
        'admin puede crear nota a nombre de otra persona (restaurar respaldo)',
        admin.doc('notes/n-restored').set({ text: 'x', projectId: 'p1', authorUid: 'collab1', authorName: 'C', createdAt: '2026-08-10', archived: false }),
        'allow'
    );
    await check(
        'admin puede archivar una nota',
        admin.doc('notes/n-restored').update({ archived: true }),
        'allow'
    );

    // --- NIP (segundo filtro) ---
    await check(
        'admin puede guardar su propio NIP (pinHash/pinSalt)',
        admin.doc('users/admin1').update({ pinHash: 'h', pinSalt: 's' }),
        'allow'
    );
    await check(
        'admin puede restablecer el NIP de otro usuario',
        admin.doc('users/collab1').update({ pinHash: null, pinSalt: null }),
        'allow'
    );
    await check(
        'colaborador NO puede restablecerse el rol a admin aunque intente junto con su propio NIP',
        collab.doc('users/collab1').update({ pinHash: 'h', pinSalt: 's', role: 'admin' }),
        'deny'
    );
    await check(
        'colaborador SI puede guardar su propio NIP (sin tocar role/status/area)',
        collab.doc('users/collab1').update({ pinHash: 'h', pinSalt: 's' }),
        'allow'
    );

    let ok = true;
    for (const [label, pass] of checks) {
        console.log((pass ? 'OK  ' : 'FAIL') + ' - ' + label);
        if (!pass) ok = false;
    }
    await testEnv.cleanup();
    process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
