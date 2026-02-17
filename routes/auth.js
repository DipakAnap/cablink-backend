const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');

const formatUser = (user) => {
    if (user.profilePictureData) {
        user.profilePictureUrl = `data:image/jpeg;base64,${Buffer.from(user.profilePictureData).toString('base64')}`;
    }
    delete user.password;
    delete user.profilePictureData;
    if (user.subscriptionExpiryDate) {
        user.subscriptionExpiryDate = new Date(user.subscriptionExpiryDate).toISOString().split('T')[0];
    }
    return user;
};

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { phone, email, role, password } = req.body;
    const identifier = phone || email;
    
    if (!identifier || !role || !password) {
        return res.status(400).json({ message: 'Phone/email, role, and password are required.' });
    }

    try {
        const isEmail = identifier.includes('@');
        const fieldName = isEmail ? 'email' : 'phone';
        const query = `
            SELECT u.* 
            FROM users u WHERE u.${fieldName} = ? AND u.role = ? AND u.status = 'Active'
        `;
        const [rows] = await db.query(query, [identifier.trim(), role]);
        
        if (rows.length > 0) {
            const user = rows[0];
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                res.json(formatUser(user));
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
    const { name, email, role, password, phone } = req.body;

    if (!name || !role || !password || !phone) {
        return res.status(400).json({ message: 'Name, role, password, and phone number are required.' });
    }

    const saltRounds = 10;

    try {
        const [existing] = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);
        if (existing.length > 0) {
            return res.status(409).json({ message: 'A user with this phone number already exists' });
        }
        if (email) {
            const [existingEmail] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
            if (existingEmail.length > 0) {
                return res.status(409).json({ message: 'A user with this email already exists' });
            }
        }
        
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const [result] = await db.query(
            'INSERT INTO users (name, email, phone, role, password) VALUES (?, ?, ?, ?, ?)',
            [name, email || null, phone, role, hashedPassword]
        );
        const [[newUser]] = await db.query('SELECT id, name, email, phone, role FROM users WHERE id = ?', [result.insertId]);
        res.status(201).json(formatUser(newUser));

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
        const [[{ totalItems }]] = await db.query("SELECT COUNT(*) as totalItems FROM users WHERE role = 'Driver' AND status = 'Active'");
        const totalPages = Math.ceil(totalItems / limit);

        const query = `
            SELECT id, name, email, phone, role, profilePictureUrl, profilePictureData FROM users WHERE role = 'Driver' AND status = 'Active'
            ORDER BY name ASC
            LIMIT ? OFFSET ?
        `;
        const [drivers] = await db.query(query, [limit, offset]);
        res.json({ items: drivers.map(formatUser), totalItems, totalPages, currentPage: page });
    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});

// GET /api/auth/drivers/all (for dropdowns)
router.get('/drivers/all', async (req, res) => {
    try {
        const query = `SELECT id, name FROM users WHERE role IN ('Driver', 'Car Owner') AND status = 'Active' ORDER BY name ASC`;
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

    let whereClauses = ["u.role = 'Customer'", "u.status = 'Active'"];
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
            SELECT u.id, u.name, u.email, u.phone, u.role, u.profilePictureUrl, u.profilePictureData, u.subscriptionPlanId, 
                   u.subscriptionExpiryDate,
                   sp.name as subscriptionPlanName
            FROM users u
            LEFT JOIN subscription_plans sp ON u.subscriptionPlanId = sp.id
            WHERE ${whereString}
            ORDER BY u.name ASC
            LIMIT ? OFFSET ?
        `;
        const [customers] = await db.query(query, [...queryParams, limit, offset]);
        res.json({ items: customers.map(formatUser), totalItems, totalPages, currentPage: page });
    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});

// PUT /api/auth/users/:id
router.put('/users/:id', async (req, res) => {
    const { id } = req.params;
    const { name, email, phone, imageData, storeAsBinary } = req.body;

    if (!name || !phone) {
        return res.status(400).json({ message: 'Name and phone are required.' });
    }

    try {
        const [existing] = await db.query('SELECT id FROM users WHERE phone = ? AND id != ?', [phone, id]);
        if (existing.length > 0) {
            return res.status(409).json({ message: 'Another user with this phone number already exists.' });
        }
        if (email) {
            const [existingEmail] = await db.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, id]);
            if (existingEmail.length > 0) {
                return res.status(409).json({ message: 'Another user with this email already exists.' });
            }
        }

        let updateQuery = 'UPDATE users SET name = ?, email = ?, phone = ?';
        const queryParams = [name, email || null, phone];

        if (imageData) {
            if (storeAsBinary) {
                updateQuery += ', profilePictureData = ?, profilePictureUrl = NULL';
                queryParams.push(Buffer.from(imageData, 'base64'));
            } else {
                updateQuery += ', profilePictureUrl = ?, profilePictureData = NULL';
                const newUrl = `https://picsum.photos/id/${Math.floor(Math.random()*200)}/200`;
                queryParams.push(newUrl);
            }
        }

        updateQuery += ' WHERE id = ?';
        queryParams.push(id);
        
        await db.query(updateQuery, queryParams);
        
        const [[updatedUser]] = await db.query(`
            SELECT u.*, sp.name as subscriptionPlanName 
            FROM users u 
            LEFT JOIN subscription_plans sp ON u.subscriptionPlanId = sp.id
            WHERE u.id = ?
        `, [id]);
        
        res.json(formatUser(updatedUser));

    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});

// DELETE /api/auth/users/:id
router.delete('/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.query("UPDATE users SET status = 'Deleted' WHERE id = ?", [id]);
        if (result.affectedRows > 0) {
            res.json({ message: 'User deleted successfully' });
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
    const { phone } = req.body;
    if (!phone) {
        return res.status(400).json({ message: 'Phone number is required.' });
    }
    try {
        const [users] = await db.query("SELECT id FROM users WHERE phone = ? AND status = 'Active'", [phone]);
        if (users.length > 0) {
            // In a real app, you would generate, store, and send an OTP via SMS.
            // For this demo, we just confirm the user exists.
            res.json({ success: true, message: 'OTP sent successfully (simulated).' });
        } else {
            res.status(404).json({ success: false, message: 'No active user found with this phone number.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});

// POST /api/auth/login-with-otp
router.post('/login-with-otp', async (req, res) => {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
        return res.status(400).json({ message: 'Phone number and OTP are required.' });
    }

    // For demo purposes, we use a hardcoded OTP.
    if (otp !== '123456') {
        return res.status(401).json({ message: 'Invalid OTP.' });
    }

    try {
        const [users] = await db.query("SELECT * FROM users WHERE phone = ? AND status = 'Active'", [phone]);
        if (users.length > 0) {
            res.json(formatUser(users[0]));
        } else {
            res.status(404).json({ message: 'User not found.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});


module.exports = router;