const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/settings/:key
router.get('/:key', async (req, res) => {
    const { key } = req.params;
    try {
        const [rows] = await db.query('SELECT value FROM system_settings WHERE key_name = ?', [key]);
        if (rows.length > 0) {
            res.json({ value: rows[0].value });
        } else {
            res.status(404).json({ message: 'Setting not found' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});

// POST /api/settings/:key
router.post('/:key', async (req, res) => {
    const { key } = req.params;
    const { value } = req.body;
    
    if (value === undefined) {
        return res.status(400).json({ message: 'Value is required' });
    }

    try {
        await db.query(
            'INSERT INTO system_settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?',
            [key, value, value]
        );
        res.json({ message: 'Setting updated successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});

module.exports = router;