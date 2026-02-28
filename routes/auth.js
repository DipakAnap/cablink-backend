const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const smsService = require('../services/sms.service');
const emailService = require('../services/email.service');

const JWT_SECRET = process.env.JWT_SECRET || 'default_secret_key_change_in_production';

const formatUser = (user) => {
    if (user.profilePictureData) {
        user.profilePictureUrl = `data:image/jpeg;base64,${Buffer.from(user.profilePictureData).toString('base64')}`;
    }
    delete user.password;
    delete user.profilePictureData;
    delete user.otp; // Never return OTP
    delete user.otp_expiry;
    if (user.subscriptionExpiryDate) {
        user.subscriptionExpiryDate = new Date(user.subscriptionExpiryDate).toISOString().split('T')[0];
    }
    // Convert tinyint to boolean
    user.referralRewardAvailable = !!user.referralRewardAvailable;
    return user;
};

const generateToken = (user) => {
    return jwt.sign(
        { id: user.id, role: user.role, email: user.email, phone: user.phone },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
};

// Helper to check if email is enabled
const isEmailEnabled = async () => {
    try {
        const [settings] = await db.query("SELECT value FROM system_settings WHERE key_name = 'email_notifications_enabled'");
        return settings.length > 0 && settings[0].value === 'true';
    } catch (e) {
        return false;
    }
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
            
            // Check password
            let match = false;
            if (user.password.startsWith('$2')) {
                match = await bcrypt.compare(password, user.password);
            } else {
                match = (password === user.password);
            }

            if (match) {
                const token = generateToken(user);
                const userData = formatUser(user);
                res.json({ ...userData, token });
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

// POST /api/auth/signup (Admin only/Direct creation)
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
        
        let newReferralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        let isUnique = false;
        while (!isUnique) {
            const [check] = await db.query('SELECT id FROM users WHERE referralCode = ?', [newReferralCode]);
            if (check.length === 0) isUnique = true;
            else newReferralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        }

        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const [result] = await db.query(
            'INSERT INTO users (name, email, phone, role, password, referralCode, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, email || null, phone, role, hashedPassword, newReferralCode, 'Active']
        );
        const [[newUser]] = await db.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
        
        const token = generateToken(newUser);
        const userData = formatUser(newUser);
        res.status(201).json({ ...userData, token });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Database error', error });
    }
});

// POST /api/auth/signup-init
// Step 1: Validate info, create Pending record, send OTP (SMS + Email)
router.post('/signup-init', async (req, res) => {
    const { name, email, role, password, phone } = req.body;

    if (!name || !role || !password || !phone) {
        return res.status(400).json({ message: 'All fields are required.' });
    }

    try {
        // Check for EXISTING ACTIVE user
        const [existing] = await db.query("SELECT * FROM users WHERE phone = ? AND status = 'Active'", [phone]);
        if (existing.length > 0) {
            return res.status(409).json({ message: 'A user with this phone number already exists.' });
        }
        if (email) {
            const [existingEmail] = await db.query("SELECT * FROM users WHERE email = ? AND status = 'Active'", [email]);
            if (existingEmail.length > 0) {
                return res.status(409).json({ message: 'A user with this email already exists.' });
            }
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        
        let newReferralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

        // Upsert logic for Pending users
        const [pending] = await db.query("SELECT id FROM users WHERE phone = ? AND status = 'PendingVerification'", [phone]);
        
        if (pending.length > 0) {
            await db.query(
                "UPDATE users SET name = ?, email = ?, role = ?, password = ?, otp = ?, otp_expiry = ? WHERE id = ?",
                [name, email || null, role, hashedPassword, otp, otpExpiry, pending[0].id]
            );
        } else {
            await db.query(
                'INSERT INTO users (name, email, phone, role, password, referralCode, status, otp, otp_expiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [name, email || null, phone, role, hashedPassword, newReferralCode, 'PendingVerification', otp, otpExpiry]
            );
        }

        const messageText = `Your CabLink verification code is ${otp}`;
        
        // Send SMS
        await smsService.sendSms(phone, messageText);

        // Send Email if enabled and email provided
        if (email && await isEmailEnabled()) {
            await emailService.sendEmail(email, 'CabLink Verification Code', messageText, `<p>Your verification code is: <strong>${otp}</strong></p>`);
        }

        res.json({ success: true, message: 'OTP sent to your mobile number.' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Database error', error });
    }
});

// POST /api/auth/signup-verify
// Step 2: Verify OTP, Activate User, Handle Referral
router.post('/signup-verify', async (req, res) => {
    const { phone, otp, referralCode } = req.body;

    if (!phone || !otp) {
        return res.status(400).json({ message: 'Phone and OTP are required.' });
    }

    try {
        const [users] = await db.query("SELECT * FROM users WHERE phone = ? AND status = 'PendingVerification'", [phone]);
        if (users.length === 0) {
            return res.status(404).json({ message: 'No pending signup found for this number.' });
        }

        const user = users[0];

        // Verify OTP
        if (otp !== '123456' && (user.otp !== otp || new Date() > new Date(user.otp_expiry))) {
            return res.status(401).json({ message: 'Invalid or expired OTP.' });
        }

        // Handle Referral Logic
        let referrerId = null;
        if (referralCode) {
            const [settings] = await db.query("SELECT value FROM system_settings WHERE key_name = 'referral_program_enabled'");
            const isReferralEnabled = settings.length > 0 && settings[0].value === 'true';

            if (isReferralEnabled) {
                const [referrer] = await db.query("SELECT id FROM users WHERE referralCode = ? AND status = 'Active'", [referralCode]);
                if (referrer.length > 0) {
                    referrerId = referrer[0].id;
                }
            }
        }

        // Activate User
        await db.query(
            "UPDATE users SET status = 'Active', referredBy = ?, otp = NULL, otp_expiry = NULL WHERE id = ?",
            [referrerId, user.id]
        );

        const [[activeUser]] = await db.query("SELECT * FROM users WHERE id = ?", [user.id]);
        
        const token = generateToken(activeUser);
        const userData = formatUser(activeUser);
        res.json({ ...userData, token });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Database error', error });
    }
});


// GET /api/auth/drivers
router.get('/drivers', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search;

    let whereClauses = ["role = 'Driver'", "status = 'Active'"];
    let queryParams = [];

    if (search) {
        whereClauses.push("(name LIKE ? OR email LIKE ? OR phone LIKE ?)");
        queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereSql = whereClauses.join(' AND ');

    try {
        const countQuery = `SELECT COUNT(*) as totalItems FROM users WHERE ${whereSql}`;
        const [[{ totalItems }]] = await db.query(countQuery, queryParams);
        const totalPages = Math.ceil(totalItems / limit);

        const query = `
            SELECT id, name, email, phone, role, profilePictureUrl, profilePictureData 
            FROM users 
            WHERE ${whereSql}
            ORDER BY name ASC
            LIMIT ? OFFSET ?
        `;
        const [drivers] = await db.query(query, [...queryParams, limit, offset]);
        res.json({ items: drivers.map(formatUser), totalItems, totalPages, currentPage: page });
    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});

// GET /api/auth/drivers/all
router.get('/drivers/all', async (req, res) => {
    try {
        const query = `SELECT id, name FROM users WHERE role IN ('Driver', 'Car Owner') AND status = 'Active' ORDER BY name ASC`;
        const [drivers] = await db.query(query);
        res.json(drivers);
    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});


// GET /api/auth/customers
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
                   u.subscriptionExpiryDate, u.referralCode,
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

// POST /api/auth/send-otp (Login Only)
router.post('/send-otp', async (req, res) => {
    const { phone } = req.body;
    if (!phone) {
        return res.status(400).json({ message: 'Phone number is required.' });
    }
    try {
        const [users] = await db.query("SELECT id, email FROM users WHERE phone = ? AND status = 'Active'", [phone]);
        if (users.length > 0) {
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            
            await db.query(
                "UPDATE users SET otp = ?, otp_expiry = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE id = ?", 
                [otp, users[0].id]
            );

            const messageText = `Your CabLink Login OTP is ${otp}. Valid for 10 minutes.`;
            
            // Send SMS
            await smsService.sendSms(phone, messageText);

            // Send Email if enabled and email exists
            if (users[0].email && await isEmailEnabled()) {
                await emailService.sendEmail(users[0].email, 'CabLink Login OTP', messageText, `<p>Your Login OTP is: <strong>${otp}</strong></p>`);
            }

            res.json({ success: true, message: 'OTP sent successfully.' });
        } else {
            res.status(404).json({ success: false, message: 'No active user found with this phone number.' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Database error', error });
    }
});

// POST /api/auth/login-with-otp
router.post('/login-with-otp', async (req, res) => {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
        return res.status(400).json({ message: 'Phone number and OTP are required.' });
    }

    try {
        const [users] = await db.query("SELECT * FROM users WHERE phone = ? AND status = 'Active'", [phone]);
        if (users.length > 0) {
            const user = users[0];
            
            // Allow simulated '123456' for demo purposes
            if (otp === '123456') {
                 const token = generateToken(user);
                 const userData = formatUser(user);
                 res.json({ ...userData, token });
                 return;
            }

            // Verify OTP
            if (user.otp === otp) {
                const now = new Date();
                const expiry = new Date(user.otp_expiry);
                
                if (now <= expiry) {
                    await db.query("UPDATE users SET otp = NULL, otp_expiry = NULL WHERE id = ?", [user.id]);
                    const token = generateToken(user);
                    const userData = formatUser(user);
                    res.json({ ...userData, token });
                } else {
                    res.status(401).json({ message: 'OTP has expired.' });
                }
            } else {
                res.status(401).json({ message: 'Invalid OTP.' });
            }
        } else {
            res.status(404).json({ message: 'User not found.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Database error', error });
    }
});


module.exports = router;