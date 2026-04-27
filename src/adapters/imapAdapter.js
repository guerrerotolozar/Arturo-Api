/**
 * imapAdapter.js — Adaptador IMAP para Gmail (ImapFlow).
 * 
 * Arquitectura event-driven:
 *   - ImapFlow entra en IDLE automáticamente cuando no hay operaciones.
 *   - Cuando llega correo nuevo, Gmail notifica vía IDLE y ImapFlow
 *     emite el evento "exists".
 *   - Polling cada 30s como respaldo por si Gmail no notifica.
 */

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { IMAP_USER, IMAP_PASSWORD, IMAP_HOST, IMAP_PORT } = require('../config/env');

const POLL_INTERVAL_MS = 30_000;
const RECONNECT_DELAY_MS = 15_000;

class ImapAdapter {
    constructor() {
        this.client = null;
        this.messageListeners = [];
        this.processedUIDs = new Set();
        this.pollTimer = null;
        this.isProcessing = false;
        this.ready = false;
    }

    async connect() {
        if (!IMAP_USER || !IMAP_PASSWORD) {
            console.warn('[IMAP] ⚠️  Faltan credenciales IMAP en .env — servicio deshabilitado.');
            return false;
        }

        this._cleanup();

        try {
            console.log(`[IMAP] 🔌 Conectando a ${IMAP_HOST}:${IMAP_PORT}...`);

            this.client = new ImapFlow({
                host: IMAP_HOST,
                port: parseInt(IMAP_PORT) || 993,
                secure: true,
                auth: { user: IMAP_USER, pass: IMAP_PASSWORD },
                logger: false,
                emitLogs: false,
                tls: { rejectUnauthorized: false }
            });

            await this.client.connect();
            console.log('[IMAP] ✅ Conectado a Gmail.');

            // Abrir INBOX (se queda abierto para siempre)
            await this.client.mailboxOpen('INBOX');
            console.log('[IMAP] 📂 INBOX abierto.');

            // ── Snapshot: ignorar correos viejos ─────────────
            await this._snapshotExisting();

            // ── Evento "exists": correo nuevo en tiempo real ──
            this.client.on('exists', (data) => {
                console.log(`[IMAP] 📬 Nuevo correo detectado (total: ${data.count}). Revisando...`);
                this._processNewMail();
            });

            // ── Reconexión automática ──
            this.client.on('close', () => {
                if (!this.ready) return; // Ignore si estamos cerrando intencionalmente
                console.warn('[IMAP] ⚠️  Conexión cerrada. Reconectando en 15s...');
                this._scheduleReconnect();
            });

            this.client.on('error', (err) => {
                console.error('[IMAP] ❌ Error:', err.message);
            });

            // ── Polling cada 30s como respaldo ──
            this.pollTimer = setInterval(() => this._processNewMail(), POLL_INTERVAL_MS);

            this.ready = true;
            console.log('[IMAP] 🔄 Escuchando correos nuevos (IDLE + polling cada 30s).');
            return true;

        } catch (error) {
            console.error('[IMAP] ❌ Error conectando:', error.message);
            this._scheduleReconnect();
            return false;
        }
    }

    onMessage(callback) {
        this.messageListeners.push(callback);
    }

    // ═══════════════════════════════════════════════════════
    // INTERNOS
    // ═══════════════════════════════════════════════════════

    async _snapshotExisting() {
        try {
            const existingUIDs = await this.client.search({
                seen: false,
                from: 'notificacionesbancolombia.com'
            });
            if (existingUIDs && existingUIDs.length > 0) {
                for (const uid of existingUIDs) this.processedUIDs.add(uid);
                console.log(`[IMAP] 📋 ${existingUIDs.length} correo(s) antiguos de Bancolombia ignorados.`);
            } else {
                console.log('[IMAP] 📋 No hay correos antiguos de Bancolombia sin leer.');
            }
        } catch (err) {
            console.warn('[IMAP] ⚠️  Snapshot fallido (no crítico):', err.message);
        }
    }

    async _processNewMail() {
        if (!this.client || !this.client.usable || this.isProcessing) return;
        this.isProcessing = true;

        try {
            // Buscar SOLO correos no leídos de Bancolombia
            const uids = await this.client.search({
                seen: false,
                from: 'notificacionesbancolombia.com'
            });

            if (!uids || uids.length === 0) return;

            const newUIDs = uids.filter(uid => !this.processedUIDs.has(uid));
            if (newUIDs.length === 0) return;

            console.log(`[IMAP] 💳 ${newUIDs.length} correo(s) NUEVO(s) de Bancolombia.`);

            for (const uid of newUIDs) {
                this.processedUIDs.add(uid);

                try {
                    const message = await this.client.fetchOne(uid, { source: true });
                    if (!message?.source) {
                        console.warn(`[IMAP] ⚠️  UID ${uid}: sin contenido.`);
                        continue;
                    }

                    const mail = await simpleParser(message.source);
                    const from = mail.from?.value[0]?.address || '';
                    const subject = mail.subject || '';
                    const text = mail.text || '';

                    console.log(`[IMAP] 📨 UID ${uid} | De: ${from}`);

                    for (const listener of this.messageListeners) {
                        try {
                            await listener({ from, subject, text, messageId: uid });
                        } catch (e) {
                            console.error(`[IMAP] ❌ Listener error UID ${uid}:`, e.message);
                        }
                    }
                } catch (fetchErr) {
                    console.error(`[IMAP] ❌ Fetch error UID ${uid}:`, fetchErr.message);
                }
            }
        } catch (err) {
            if (err.message?.includes('Not available') || err.message?.includes('closed')) {
                console.warn('[IMAP] ⚠️  Conexión perdida.');
                this._scheduleReconnect();
            } else {
                console.error('[IMAP] ❌ Error buscando:', err.message);
            }
        } finally {
            this.isProcessing = false;
        }
    }

    async markAsRead(uid) {
        if (!this.client?.usable) return;
        try {
            await this.client.messageFlagsAdd(uid, ['\\Seen']);
            console.log(`[IMAP] 👁️  UID ${uid} marcado como leído.`);
        } catch (err) {
            console.error(`[IMAP] ❌ markAsRead UID ${uid}:`, err.message);
        }
    }

    _cleanup() {
        this.ready = false;
        this.isProcessing = false;
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
        if (this.client) {
            this.client.removeAllListeners();
            try { this.client.close(); } catch (e) {}
            this.client = null;
        }
    }

    _scheduleReconnect() {
        this.ready = false;
        this.isProcessing = false;
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
        setTimeout(() => {
            console.log('[IMAP] 🔁 Reconectando...');
            this.connect();
        }, RECONNECT_DELAY_MS);
    }
}

module.exports = new ImapAdapter();
