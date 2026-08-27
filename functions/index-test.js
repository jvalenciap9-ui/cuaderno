const { onCall } = require('firebase-functions/v2/https');

exports.health = onCall(async () => ({ ok: true }));