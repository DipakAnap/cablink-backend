
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all expenses with car details
router.get('/', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 9;
    const offset = (page - 1) * limit;

    try {
        const [[{ totalItems }]] = await db.query('SELECT COUNT(*) as totalItems FROM expenses');
        const totalPages = Math.ceil(totalItems / limit);

        const query = `
            SELECT 
                e.id, e.carId, e.expenseType, e.amount, 
                DATE_FORMAT(e.date, '%Y-%m-%d') as date,
                e.description,
                c.model as carModel, c.carNumber
            FROM expenses e
            JOIN cars c ON e.carId = c.id
            ORDER BY e.date DESC
            LIMIT ?
            OFFSET ?
        `;
        const [expenses] = await db.query(query, [limit, offset]);
        const result = expenses.map(e => ({
            ...e,
            car: {
                id: e.carId,
                model: e.carModel,
                carNumber: e.carNumber
            }
        }));
        res.json({
            items: result,
            totalItems,
            totalPages,
            currentPage: page
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST a new expense
router.post('/', async (req, res) => {
    const { carId, expenseType, amount, date, description } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO expenses (carId, expenseType, amount, date, description) VALUES (?, ?, ?, ?, ?)',
            [carId, expenseType, amount, date, description]
        );
        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// PUT to update an expense
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { carId, expenseType, amount, date, description } = req.body;
    try {
        await db.query(
            'UPDATE expenses SET carId = ?, expenseType = ?, amount = ?, date = ?, description = ? WHERE id = ?',
            [carId, expenseType, amount, date, description, id]
        );
        res.json({ message: 'Expense updated successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// DELETE an expense
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM expenses WHERE id = ?', [id]);
        res.json({ message: 'Expense deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
