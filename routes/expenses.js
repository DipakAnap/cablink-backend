const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all expenses with car details and filters
router.get('/', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 9;
    const offset = (page - 1) * limit;
    const { carId, type, startDate, endDate } = req.query;

    let whereClauses = ["e.status = 'Active'"];
    let queryParams = [];

    if (carId && carId !== 'All') {
        whereClauses.push("e.carId = ?");
        queryParams.push(carId);
    }
    if (type && type !== 'All') {
        whereClauses.push("e.expenseType = ?");
        queryParams.push(type);
    }
    if (startDate) {
        whereClauses.push("e.date >= ?");
        queryParams.push(startDate);
    }
    if (endDate) {
        whereClauses.push("e.date <= ?");
        queryParams.push(endDate);
    }

    const whereSql = whereClauses.join(' AND ');

    try {
        const countQuery = `SELECT COUNT(*) as totalItems FROM expenses e WHERE ${whereSql}`;
        const [[{ totalItems }]] = await db.query(countQuery, queryParams);
        const totalPages = Math.ceil(totalItems / limit);

        const query = `
            SELECT 
                e.id, e.carId, e.expenseType, e.amount, 
                DATE_FORMAT(e.date, '%Y-%m-%d') as date,
                e.description,
                c.model as carModel, c.carNumber
            FROM expenses e
            JOIN cars c ON e.carId = c.id
            WHERE ${whereSql}
            ORDER BY e.date DESC
            LIMIT ?
            OFFSET ?
        `;
        const [expenses] = await db.query(query, [...queryParams, limit, offset]);
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

// GET all expenses (not paginated) for data service
router.get('/all', async (req, res) => {
    try {
        const query = `
            SELECT 
                e.id, e.carId, e.expenseType, e.amount, 
                DATE_FORMAT(e.date, '%Y-%m-%d') as date,
                e.description,
                c.model as carModel, c.carNumber
            FROM expenses e
            JOIN cars c ON e.carId = c.id
            WHERE e.status = 'Active'
            ORDER BY e.date DESC
        `;
        const [expenses] = await db.query(query);
        const result = expenses.map(e => ({
            ...e,
            car: {
                id: e.carId,
                model: e.carModel,
                carNumber: e.carNumber
            }
        }));
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// GET total expenses with filters
router.get('/total', async (req, res) => {
    const { carId, period, refDate } = req.query;
    
    let whereClauses = ["e.status = 'Active'"];
    let queryParams = [];

    if (carId && carId !== 'all' && carId !== 'All') {
        whereClauses.push('e.carId = ?');
        queryParams.push(carId);
    }

    if (period && period !== 'overall' && refDate) {
        const date = new Date(refDate);
        let startDate, endDate;

        if (period === 'day') {
            startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(date);
            endDate.setHours(23, 59, 59, 999);
        } else if (period === 'week') {
            startDate = new Date(date);
            startDate.setDate(date.getDate() - date.getDay());
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 6);
            endDate.setHours(23, 59, 59, 999);
        } else if (period === 'month') {
            startDate = new Date(date.getFullYear(), date.getMonth(), 1);
            endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
        } else if (period === 'year') {
            startDate = new Date(date.getFullYear(), 0, 1);
            endDate = new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999);
        }

        if (startDate && endDate) {
            whereClauses.push('e.date BETWEEN ? AND ?');
            const startStr = startDate.toISOString().slice(0, 10);
            const endStr = endDate.toISOString().slice(0, 10);
            queryParams.push(startStr, endStr);
        }
    }

    const whereString = whereClauses.join(' AND ');

    try {
        const query = `
            SELECT SUM(e.amount) as totalExpenses
            FROM expenses e
            WHERE ${whereString}
        `;
        const [[stats]] = await db.query(query, queryParams);
        res.json({ totalExpenses: stats.totalExpenses || 0 });
    } catch (err) {
        console.error(err);
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
        const [[newExpense]] = await db.query('SELECT * FROM expenses WHERE id = ?', [result.insertId]);
        res.status(201).json(newExpense);
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
        const [[updatedExpense]] = await db.query('SELECT * FROM expenses WHERE id = ?', [id]);
        res.json(updatedExpense);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// DELETE an expense
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.query("UPDATE expenses SET status = 'Deleted' WHERE id = ?", [id]);
        res.json({ message: 'Expense deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;