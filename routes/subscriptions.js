
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all subscription plans
router.get('/plans', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    try {
        const [[{ totalItems }]] = await db.query('SELECT COUNT(*) as totalItems FROM subscription_plans');
        const totalPages = Math.ceil(totalItems / limit);

        const query = `
            SELECT sp.*, u.name as providerName 
            FROM subscription_plans sp
            JOIN users u ON sp.providerId = u.id
            ORDER BY sp.providerRole, sp.durationMonths ASC
            LIMIT ?
            OFFSET ?
        `;
        const [plans] = await db.query(query, [limit, offset]);
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

// POST a new subscription plan (for drivers/admin)
router.post('/plans', async (req, res) => {
    const { name, durationMonths, price, customerDiscountPercent, providerId, providerRole } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO subscription_plans (name, durationMonths, price, customerDiscountPercent, providerId, providerRole) VALUES (?, ?, ?, ?, ?, ?)',
            [name, durationMonths, price, customerDiscountPercent, providerId, providerRole]
        );
        res.status(201).json({ id: result.insertId, ...req.body });
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
        // This is a simplified authorization check. A real app would use middleware.
        // const [planRows] = await db.query('SELECT providerId FROM subscription_plans WHERE id = ?', [id]);
        // if (planRows.length === 0) return res.status(404).json({ message: 'Plan not found' });
        // if (planRows[0].providerId !== req.user.id && req.user.role !== 'Admin') {
        //     return res.status(403).json({ message: 'Unauthorized' });
        // }
        
        await db.query(
            'UPDATE subscription_plans SET name = ?, price = ?, customerDiscountPercent = ? WHERE id = ?',
            [name, price, customerDiscountPercent, id]
        );
        res.json({ message: 'Plan updated successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// DELETE a subscription plan
router.delete('/plans/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // ON DELETE CASCADE will handle users subscribed to this plan
        await db.query('DELETE FROM subscription_plans WHERE id = ?', [id]);
        res.json({ message: 'Plan deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});


// POST assign a subscription to a user (customer)
router.post('/assign', async (req, res) => {
    const { userId, planId } = req.body;
    try {
        const [planRows] = await db.query('SELECT durationMonths FROM subscription_plans WHERE id = ?', [planId]);
        if (planRows.length === 0) {
            return res.status(404).json({ message: 'Subscription plan not found.' });
        }

        const durationMonths = planRows[0].durationMonths;
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
