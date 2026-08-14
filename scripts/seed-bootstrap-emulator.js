// Sembrar config/bootstrap SOLO en el emulador local de Firestore.
// El Admin SDK detecta FIRESTORE_EMULATOR_HOST y omite la autenticación real
// (no toca el proyecto de producción, no requiere credenciales reales).
//
// Uso: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-bootstrap-emulator.js correo1@ejemplo.com correo2@ejemplo.com

const admin = require('firebase-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST no está definido. Este script solo debe correr contra el emulador local (ver README).');
  process.exit(1);
}

const emails = process.argv.slice(2);
if (emails.length === 0) {
  console.error('Uso: node scripts/seed-bootstrap-emulator.js correo1@ejemplo.com [correo2@ejemplo.com ...]');
  process.exit(1);
}

admin.initializeApp({ projectId: 'pme-plataforma' });
const db = admin.firestore();

db.doc('config/bootstrap').set({ adminEmails: emails })
  .then(() => {
    console.log('config/bootstrap sembrado en el emulador con adminEmails:', emails);
    process.exit(0);
  })
  .catch(err => { console.error(err); process.exit(1); });
