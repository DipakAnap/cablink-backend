const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all subscription plans (Paginated with Filters)
router.get('/plans', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const { search, providerId } = req.query;

    let whereClauses = ["sp.status = 'Active'"];
    let queryParams = [];

    if (search) {
        whereClauses.push("sp.name LIKE ?");
        queryParams.push(`%${search}%`);
    }

    if (providerId && providerId !== 'All') {
        whereClauses.push("sp.providerId = ?");
        queryParams.push(providerId);
    }

    const whereSql = whereClauses.join(' AND ');

    try {
        const countQuery = `SELECT COUNT(*) as totalItems FROM subscription_plans sp WHERE ${whereSql}`;
        const [[{ totalItems }]] = await db.query(countQuery, queryParams);
        const totalPages = Math.ceil(totalItems / limit);

        const query = `
            SELECT sp.*, u.name as providerName 
            FROM subscription_plans sp
            JOIN users u ON sp.providerId = u.id
            WHERE ${whereSql}
            ORDER BY sp.providerRole, sp.durationMonths ASC
            LIMIT ?
            OFFSET ?
        `;
        const [plans] = await db.query(query, [...queryParams, limit, offset]);
        res.json({
            items: plans,
            totalItems,
            totalPages,
            currentPage: page
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// GET all subscription plans (not paginated) for data service
router.get('/plans/all', async (req, res) => {
    try {
        const query = `
            SELECT sp.*, u.name as providerName 
            FROM subscription_plans sp
            JOIN users u ON sp.providerId = u.id
            WHERE sp.status = 'Active'
            ORDER BY sp.providerRole, sp.durationMonths ASC
        `;
        const [plans] = await db.query(query);
        res.json(plans);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST a new subscription plan (for drivers/admin)
router.post('/plans', async (req, res) => {
    const { name, durationMonths, price, customerDiscountPercent, providerId, providerRole } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO subscription_plans (name, durationMonths, price, customerDiscountPercent, providerId, providerRole) VALUES (?, ?, ?, ?, ?, ?)',
            [name, durationMonths, price, customerDiscountPercent, providerId, providerRole]
        );
        const [[newPlan]] = await db.query('SELECT * FROM subscription_plans WHERE id = ?', [result.insertId]);
        res.status(201).json(newPlan);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});


// PUT update a subscription plan
router.put('/plans/:id', async (req, res) => {
    const { id } = req.params;
    // In a real app, you'd get providerId from a JWT token to verify ownership
    const { name, price, customerDiscountPercent } = req.body;
    try {
        await db.query(
            'UPDATE subscription_plans SET name = ?, price = ?, customerDiscountPercent = ? WHERE id = ?',
            [name, price, customerDiscountPercent, id]
        );
        const [[updatedPlan]] = await db.query('SELECT * FROM subscription_plans WHERE id = ?', [id]);
        res.json(updatedPlan);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// DELETE a subscription plan
router.delete('/plans/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.query("UPDATE subscription_plans SET status = 'Deleted' WHERE id = ?", [id]);
        res.json({ message: 'Plan deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});


// POST assign a subscription to a user (customer)
router.post('/assign', async (req, res) => {
    const { userId, planId, paymentDetails } = req.body;
    try {
        const [planRows] = await db.query("SELECT durationMonths, price FROM subscription_plans WHERE id = ? AND status = 'Active'", [planId]);
        if (planRows.length === 0) {
            return res.status(404).json({ message: 'Subscription plan not found or is inactive.' });
        }

        const { durationMonths, price } = planRows[0];

        // If paymentDetails are provided, log the transaction
        if (paymentDetails) {
            await db.query(
                'INSERT INTO payment_transactions (user_id, transaction_type, amount, gateway_transaction_id) VALUES (?, ?, ?, ?)',
                [userId, 'Membership', price, paymentDetails.transactionId]
            );
        }

        const [result] = await db.query(
            'UPDATE users SET subscriptionPlanId = ?, subscriptionExpiryDate = DATE_ADD(CURDATE(), INTERVAL ? MONTH) WHERE id = ?',
            [planId, durationMonths, userId]
        );
        
        if (result.affectedRows > 0) {
            res.json({ message: 'Subscription assigned successfully.' });
        } else {
            res.status(404).json({ message: 'User not found.' });
        }
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});


module.exports = router;