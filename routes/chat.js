const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/chat/notifications?userId=X
router.get('/notifications', async (req, res) => {
    const { userId } = req.query;
    if (!userId) {
        return res.status(400).json({ message: 'User ID is required' });
    }

    try {
        // Find all bookings where the user is either the customer or the driver/owner
        const [bookings] = await db.query(`
            SELECT b.id FROM bookings b
            LEFT JOIN cars c ON b.carId = c.id OR (SELECT carId FROM routes r WHERE r.id = b.routeId) = c.id
            WHERE b.userId = ? OR c.driverId = ?
        `, [userId, userId]);

        if (bookings.length === 0) {
            return res.json([]);
        }

        const bookingIds = bookings.map(b => b.id);

        // Find unread messages in those bookings not sent by the current user
        const [messages] = await db.query(`
            SELECT cm.*, u.name as senderName, u.role as senderRole
            FROM chat_messages cm
            JOIN users u ON cm.senderId = u.id
            WHERE cm.bookingId IN (?) AND cm.senderId != ? AND cm.isRead = 0
            ORDER BY cm.timestamp DESC
        `, [bookingIds, userId]);

        res.json(messages);
    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});

// GET /api/chat/:bookingId
router.get('/:bookingId', async (req, res) => {
    const { bookingId } = req.params;
    try {
        const [messages] = await db.query(`
            SELECT cm.*, u.name as senderName, u.role as senderRole
            FROM chat_messages cm
            JOIN users u ON cm.senderId = u.id
            WHERE cm.bookingId = ?
            ORDER BY cm.timestamp ASC
        `, [bookingId]);
        res.json(messages);
    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});

// POST /api/chat
router.post('/', async (req, res) => {
    const { bookingId, senderId, message } = req.body;
    if (!bookingId || !senderId || !message) {
        return res.status(400).json({ message: 'bookingId, senderId, and message are required' });
    }

    try {
        const [result] = await db.query(
            'INSERT INTO chat_messages (bookingId, senderId, message) VALUES (?, ?, ?)',
            [bookingId, senderId, message]
        );

        const [[newMessage]] = await db.query(`
            SELECT cm.*, u.name as senderName, u.role as senderRole
            FROM chat_messages cm
            JOIN users u ON cm.senderId = u.id
            WHERE cm.id = ?
        `, [result.insertId]);

        res.status(201).json(newMessage);
    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});


// PUT /api/chat/:bookingId/read
router.put('/:bookingId/read', async (req, res) => {
    const { bookingId } = req.params;
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ message: 'User ID is required' });
    }

    try {
        await db.query(
            'UPDATE chat_messages SET isRead = 1 WHERE bookingId = ? AND senderId != ?',
            [bookingId, userId]
        );
        res.json({ message: 'Messages marked as read' });
    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});

module.exports = router;