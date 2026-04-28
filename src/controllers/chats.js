/**
 * src/controllers/chats.js — Thin controller para gestión de conversaciones.
 *
 * Endpoints:
 *   GET    /IA/chats      → Lista todos los chats
 *   DELETE /IA/chats/:id  → Elimina un chat y su historial
 */

const { listarChats, eliminarChat, obtenerHistorial } = require('../repositories/chatRepository');

async function listarChatsController(req, res) {
    try {
        const chats = listarChats();
        res.json({ chats });
    } catch (err) {
        console.error('[CHATS] Error al listar:', err.message);
        res.status(500).json({ error: err.message });
    }
}

async function obtenerMensajesController(req, res) {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Falta el ID del chat.' });

    try {
        const mensajes = obtenerHistorial(id, 100); // Últimos 100 mensajes
        res.json({ mensajes });
    } catch (err) {
        console.error('[CHATS] Error al obtener mensajes:', err.message);
        res.status(500).json({ error: err.message });
    }
}

async function eliminarChatController(req, res) {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Falta el ID del chat.' });

    try {
        eliminarChat(id);
        console.log(`[CHATS] Chat eliminado: ${id}`);
        res.json({ mensaje: `Chat ${id} eliminado correctamente.` });
    } catch (err) {
        console.error('[CHATS] Error al eliminar:', err.message);
        res.status(500).json({ error: err.message });
    }
}

module.exports = { listarChatsController, eliminarChatController, obtenerMensajesController };
