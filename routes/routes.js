
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all routes with car and booking info for seat availability
router.get('/', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6;
    const offset = (page - 1) * limit;

    try {
        const [[{ totalItems }]] = await db.query('SELECT COUNT(*) as totalItems FROM routes');
        const totalPages = Math.ceil(totalItems / limit);

        const routeQuery = `
            SELECT 
                r.id, r.from, r.to, 
                DATE_FORMAT(r.date, '%Y-%m-%d') as date, 
                r.time, r.price, r.carId,
                c.model as carModel, c.capacity as carCapacity, c.imageUrl as carImageUrl,
                u.name as driverName, u.phone as driverPhone
            FROM routes r
            JOIN cars c ON r.carId = c.id
            JOIN users u ON c.driverId = u.id
            ORDER BY r.date DESC, r.time DESC
            LIMIT ?
            OFFSET ?
        `;
        const [routes] = await db.query(routeQuery, [limit, offset]);

        if (routes.length === 0) {
            return res.json({ items: [], totalItems, totalPages, currentPage: page });
        }

        const routeIds = routes.map(r => r.id);
        const bookingQuery = `
            SELECT routeId, SUM(seatsBooked) as totalSeatsBooked
            FROM bookings
            WHERE status != 'Cancelled' AND routeId IN (?)
            GROUP BY routeId
        `;
        const [bookings] = await db.query(bookingQuery, [routeIds]);
        
        const bookingMap = bookings.reduce((acc, booking) => {
            acc[booking.routeId] = booking.totalSeatsBooked;
            return acc;
        }, {});

        const result = routes.map(route => ({
            ...route,
            car: {
                id: route.carId,
                model: route.carModel,
                capacity: route.carCapacity,
                imageUrl: route.carImageUrl,
                driver: {
                    name: route.driverName,
                    phone: route.driverPhone
                }
            },
            seatsAvailable: route.carCapacity - (bookingMap[route.id] || 0)
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

// POST a new route
router.post('/', async (req, res) => {
    const { from, to, date, time, price, carId } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO routes (`from`, `to`, `date`, `time`, `price`, `carId`) VALUES (?, ?, ?, ?, ?, ?)',
            [from, to, date, time, price, carId]
        );
        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// PUT to update a route
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { from, to, date, time, price, carId } = req.body;
    try {
        await db.query(
            'UPDATE routes SET `from` = ?, `to` = ?, `date` = ?, `time` = ?, `price` = ?, `carId` = ? WHERE id = ?',
            [from, to, date, time, price, carId, id]
        );
        res.json({ message: 'Route updated successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// DELETE a route
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // Delete related bookings first to avoid foreign key issues if not cascading
        await db.query('DELETE FROM bookings WHERE routeId = ?', [id]);
        await db.query('DELETE FROM routes WHERE id = ?', [id]);
        res.json({ message: 'Route deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
