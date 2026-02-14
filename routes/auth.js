const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { email, role, password } = req.body;
    
    if (!email || !role || !password) {
        return res.status(400).json({ message: 'Email, role, and password are required.' });
    }

    try {
        const query = `
            SELECT u.*, DATE_FORMAT(u.subscriptionExpiryDate, '%Y-%m-%d') as subscriptionExpiryDate 
            FROM users u WHERE u.email = ? AND u.role = ?
        `;
        const [rows] = await db.query(query, [email.trim(), role]);
        
        if (rows.length > 0) {
            const user = rows[0];
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                // Do not send the password hash to the client
                delete user.password;
                res.json(user);
            } else {
                res.status(401).json({ message: 'Invalid credentials' });
            }
        } else {
            res.status(401).json({ message: 'Invalid credentials' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
    const { name, email, role, password } = req.body;

    if (!name || !email || !role || !password) {
        return res.status(400).json({ message: 'Name, email, role, and password are required.' });
    }

    const phone = `9${Math.floor(100000000 + Math.random() * 900000000)}`;
    const saltRounds = 10;

    try {
        const [existing] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(409).json({ message: 'User already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const [result] = await db.query(
            'INSERT INTO users (name, email, phone, role, password) VALUES (?, ?, ?, ?, ?)',
            [name, email, phone, role, hashedPassword]
        );
        const newUser = { id: result.insertId, name, email, phone, role };
        res.status(201).json(newUser);

    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});

// GET /api/auth/drivers (paginated)
router.get('/drivers', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    try {
        const [[{ totalItems }]] = await db.query("SELECT COUNT(*) as totalItems FROM users WHERE role = 'Driver'");
        const totalPages = Math.ceil(totalItems / limit);

        const query = `
            SELECT id, name, email, phone, role FROM users WHERE role = 'Driver'
            ORDER BY name ASC
            LIMIT ? OFFSET ?
        `;
        const [drivers] = await db.query(query, [limit, offset]);
        res.json({ items: drivers, totalItems, totalPages, currentPage: page });
    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});

// GET /api/auth/drivers/all (for dropdowns)
router.get('/drivers/all', async (req, res) => {
    try {
        const query = `SELECT id, name FROM users WHERE role = 'Driver' ORDER BY name ASC`;
        const [drivers] = await db.query(query);
        res.json(drivers);
    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});


// GET /api/auth/customers (paginated and filtered)
router.get('/customers', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const searchTerm = req.query.term || '';
    const subscriptionFilter = req.query.subscription || 'all';

    let whereClauses = ["u.role = 'Customer'"];
    let queryParams = [];

    if (searchTerm) {
        whereClauses.push("u.name LIKE ?");
        queryParams.push(`%${searchTerm}%`);
    }

    if (subscriptionFilter === 'subscribed') {
        whereClauses.push("u.subscriptionPlanId IS NOT NULL AND u.subscriptionExpiryDate > CURDATE()");
    } else if (subscriptionFilter === 'not_subscribed') {
        whereClauses.push("u.subscriptionPlanId IS NULL OR u.subscriptionExpiryDate <= CURDATE()");
    }
    
    const whereString = whereClauses.join(' AND ');

    try {
        const countQuery = `SELECT COUNT(*) as totalItems FROM users u WHERE ${whereString}`;
        const [[{ totalItems }]] = await db.query(countQuery, queryParams);
        const totalPages = Math.ceil(totalItems / limit);

        const query = `
            SELECT u.id, u.name, u.email, u.phone, u.role, u.profilePictureUrl, u.subscriptionPlanId, 
                   DATE_FORMAT(u.subscriptionExpiryDate, '%Y-%m-%d') as subscriptionExpiryDate,
                   sp.name as subscriptionPlanName
            FROM users u
            LEFT JOIN subscription_plans sp ON u.subscriptionPlanId = sp.id
            WHERE ${whereString}
            ORDER BY u.name ASC
            LIMIT ? OFFSET ?
        `;
        const [customers] = await db.query(query, [...queryParams, limit, offset]);
        res.json({ items: customers, totalItems, totalPages, currentPage: page });
    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});

// PUT /api/auth/users/:id
router.put('/users/:id', async (req, res) => {
    const { id } = req.params;
    const { name, email, phone } = req.body;

    if (!name || !email || !phone) {
        return res.status(400).json({ message: 'Name, email, and phone are required.' });
    }

    try {
        const [existing] = await db.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, id]);
        if (existing.length > 0) {
            return res.status(409).json({ message: 'Another user with this email already exists.' });
        }

        await db.query(
            'UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?',
            [name, email, phone, id]
        );
        
        const [[updatedUser]] = await db.query(`
            SELECT u.*, DATE_FORMAT(u.subscriptionExpiryDate, '%Y-%m-%d') as subscriptionExpiryDate, sp.name as subscriptionPlanName 
            FROM users u 
            LEFT JOIN subscription_plans sp ON u.subscriptionPlanId = sp.id
            WHERE u.id = ?
        `, [id]);
        delete updatedUser.password;
        res.json(updatedUser);

    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});


module.exports = router;