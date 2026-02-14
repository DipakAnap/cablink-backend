
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all bookings with details
router.get('/', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6;
    const offset = (page - 1) * limit;

    // Filters
    const carId = req.query.carId;
    const bookingType = req.query.type;
    const date = req.query.date;

    let whereClauses = ['1=1'];
    let queryParams = [];

    if (carId) {
        whereClauses.push('(c.id = ?)');
        queryParams.push(carId);
    }
    if (bookingType && bookingType !== 'All') {
        whereClauses.push('b.bookingType = ?');
        queryParams.push(bookingType);
    }
    if (date) {
        whereClauses.push('(r.date = ? OR DATE(b.startDate) = ?)');
        queryParams.push(date, date);
    }

    const whereString = whereClauses.join(' AND ');

    try {
        const countQuery = `
            SELECT COUNT(DISTINCT b.id) as totalItems
            FROM bookings b
            JOIN users u ON b.userId = u.id
            LEFT JOIN routes r ON b.routeId = r.id
            LEFT JOIN cars c ON b.carId = c.id OR r.carId = c.id
            WHERE ${whereString}
        `;
        const [[{ totalItems }]] = await db.query(countQuery, queryParams);
        const totalPages = Math.ceil(totalItems / limit);

        const query = `
            SELECT 
                b.*,
                DATE_FORMAT(b.bookingDate, '%Y-%m-%d') as bookingDate,
                DATE_FORMAT(b.startDate, '%Y-%m-%dT%H:%i:%s.000Z') as startDate,
                DATE_FORMAT(b.endDate, '%Y-%m-%dT%H:%i:%s.000Z') as endDate,
                u.name as userName, u.phone as userPhone,
                c.id as carIdResolved, c.model as carModel, c.carNumber as carNumber,
                ud.id as driverId, ud.name as driverName, ud.phone as driverPhone, ud.qrCodeUrl as driverQrCode,
                r.id as routeIdResolved, r.from as routeFrom, r.to as routeTo, 
                DATE_FORMAT(r.date, '%Y-%m-%d') as routeDate, r.time as routeTime,
                r.price as routePrice
            FROM bookings b
            JOIN users u ON b.userId = u.id
            LEFT JOIN routes r ON b.routeId = r.id
            LEFT JOIN cars c ON b.carId = c.id OR r.carId = c.id
            LEFT JOIN users ud ON c.driverId = ud.id
            WHERE ${whereString}
            ORDER BY b.id DESC
            LIMIT ?
            OFFSET ?
        `;
        const [bookings] = await db.query(query, [...queryParams, limit, offset]);

        const result = bookings.map(b => ({
            id: b.id,
            userId: b.userId,
            bookingDate: b.bookingDate,
            bookingType: b.bookingType,
            status: b.status,
            paymentStatus: b.paymentStatus,
            totalPrice: b.totalPrice,
            routeId: b.routeId,
            seatsBooked: b.seatsBooked,
            carId: b.carId,
            pickupLocation: b.pickupLocation,
            dropoffLocation: b.dropoffLocation,
            startDate: b.startDate,
            endDate: b.endDate,
            user: { id: b.userId, name: b.userName, phone: b.userPhone },
            car: b.carIdResolved ? { 
                id: b.carIdResolved, 
                model: b.carModel, 
                carNumber: b.carNumber, 
                driver: { id: b.driverId, name: b.driverName, phone: b.driverPhone, qrCodeUrl: b.driverQrCode } 
            } : null,
            route: b.routeIdResolved ? { 
                id: b.routeIdResolved, 
                from: b.routeFrom, 
                to: b.routeTo, 
                date: b.routeDate,
                time: b.routeTime,
                price: b.routePrice
            } : null
        }));

        res.json({
            items: result,
            totalItems,
            totalPages,
            currentPage: page
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
    }
});

// POST a new route booking
router.post('/route', async (req, res) => {
    const { routeId, userId, seatsToBook } = req.body;
    try {
        const [routeRows] = await db.query('SELECT price, carId FROM routes WHERE id = ?', [routeId]);
        if (routeRows.length === 0) return res.status(404).json({ message: 'Route not found' });
        
        const [carRows] = await db.query('SELECT driverId FROM cars WHERE id = ?', [routeRows[0].carId]);
        const [driverRows] = await db.query(`
            SELECT u.subscriptionPlanId, u.subscriptionExpiryDate, sp.customerDiscountPercent
            FROM users u LEFT JOIN subscription_plans sp ON u.subscriptionPlanId = sp.id
            WHERE u.id = ?
        `, [carRows[0].driverId]);

        let finalPrice = routeRows[0].price * seatsToBook;
        const driver = driverRows[0];
        if (driver && driver.subscriptionPlanId && new Date(driver.subscriptionExpiryDate) > new Date()) {
            finalPrice *= (1 - (driver.customerDiscountPercent / 100));
        }

        const bookingDate = new Date().toISOString().split('T')[0];
        const [result] = await db.query(
            'INSERT INTO bookings (userId, bookingDate, bookingType, status, totalPrice, routeId, seatsBooked) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [userId, bookingDate, 'Route', 'Confirmed', finalPrice, routeId, seatsToBook]
        );
        res.status(201).json({ id: result.insertId, ...req.body, totalPrice: finalPrice, bookingDate, status: 'Confirmed', bookingType: 'Route' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST a new private hire booking
router.post('/private', async (req, res) => {
    const { userId, carId, pickupLocation, dropoffLocation, startDate, endDate } = req.body;
    try {
        const [carRows] = await db.query('SELECT pricePerKm, driverId FROM cars WHERE id = ?', [carId]);
        if (carRows.length === 0) return res.status(404).json({ message: 'Car not found' });
        
        const [driverRows] = await db.query(`
            SELECT u.subscriptionPlanId, u.subscriptionExpiryDate, sp.customerDiscountPercent
            FROM users u LEFT JOIN subscription_plans sp ON u.subscriptionPlanId = sp.id
            WHERE u.id = ?
        `, [carRows[0].driverId]);

        const start = new Date(startDate);
        const end = new Date(endDate);
        const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        const durationDays = Math.max(1, Math.ceil(durationHours / 24));
        let estimatedPrice = carRows[0].pricePerKm * 150 * durationDays;

        const driver = driverRows[0];
        if (driver && driver.subscriptionPlanId && new Date(driver.subscriptionExpiryDate) > new Date()) {
            estimatedPrice *= (1 - (driver.customerDiscountPercent / 100));
        }

        const bookingDate = new Date().toISOString().split('T')[0];
        const [result] = await db.query(
            'INSERT INTO bookings (userId, bookingDate, bookingType, status, totalPrice, carId, pickupLocation, dropoffLocation, startDate, endDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [userId, bookingDate, 'Private', 'Confirmed', estimatedPrice, carId, pickupLocation, dropoffLocation, startDate, endDate]
        );

        res.status(201).json({ id: result.insertId, ...req.body, totalPrice: estimatedPrice, bookingDate, status: 'Confirmed', bookingType: 'Private' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// PUT to update seats in a booking
router.put('/:id/seats', async (req, res) => {
    const { id } = req.params;
    const { newSeatCount, routeId } = req.body;
     try {
        const [bookingRows] = await db.query('SELECT r.price, c.driverId FROM bookings b JOIN routes r ON b.routeId = r.id JOIN cars c ON r.carId = c.id WHERE b.id = ?', [id]);
        if (bookingRows.length === 0) return res.status(404).json({ message: 'Booking or related info not found' });

        const [driverRows] = await db.query(`
            SELECT u.subscriptionPlanId, u.subscriptionExpiryDate, sp.customerDiscountPercent
            FROM users u LEFT JOIN subscription_plans sp ON u.subscriptionPlanId = sp.id
            WHERE u.id = ?
        `, [bookingRows[0].driverId]);

        let pricePerSeat = bookingRows[0].price;
        const driver = driverRows[0];
        if (driver && driver.subscriptionPlanId && new Date(driver.subscriptionExpiryDate) > new Date()) {
            pricePerSeat *= (1 - (driver.customerDiscountPercent / 100));
        }
        
        const newTotalPrice = pricePerSeat * newSeatCount;
        await db.query(
            'UPDATE bookings SET seatsBooked = ?, totalPrice = ? WHERE id = ?',
            [newSeatCount, newTotalPrice, id]
        );
        res.json({ message: 'Booking updated successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});


// PUT to cancel a booking
router.put('/:id/cancel', async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('UPDATE bookings SET status = ? WHERE id = ?', ['Cancelled', id]);
        res.json({ message: 'Booking cancelled' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// PUT to update payment status
router.put('/:id/payment', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const allowedStatuses = ['Pending', 'Paid', 'Failed', 'Refunded'];
    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ message: 'Invalid payment status' });
    }

    try {
        await db.query('UPDATE bookings SET paymentStatus = ? WHERE id = ?', [status, id]);
        res.json({ message: 'Payment status updated' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});


module.exports = router;
