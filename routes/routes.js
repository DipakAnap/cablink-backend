const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all routes with car and booking info for seat availability
router.get('/', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6;
    const offset = (page - 1) * limit;
    const { lat, lng } = req.query;

    let distanceSelection = '';
    let distanceParams = [];
    let orderBy = 'r.date DESC, r.time DESC';

    if (lat && lng) {
        distanceSelection = `, (
            6371 * acos(
                cos(radians(?)) * cos(radians(r.from_lat)) * cos(radians(r.from_lng) - radians(?)) +
                sin(radians(?)) * sin(radians(r.from_lat))
            )
        ) AS distance`;
        distanceParams = [parseFloat(lat), parseFloat(lng), parseFloat(lat)];
        orderBy = 'distance ASC';
    }


    try {
        const [[{ totalItems }]] = await db.query("SELECT COUNT(*) as totalItems FROM routes WHERE status = 'Active'");
        const totalPages = Math.ceil(totalItems / limit);

        const routeQuery = `
            SELECT 
                r.id, r.from, r.to, 
                DATE_FORMAT(r.date, '%Y-%m-%d') as date, 
                r.time, r.price, r.carId,
                r.from_lat, r.from_lng, r.to_lat, r.to_lng,
                c.model as carModel, c.capacity as carCapacity, c.imageUrl as carImageUrl,
                u.name as driverName, u.phone as driverPhone
                ${distanceSelection}
            FROM routes r
            JOIN cars c ON r.carId = c.id
            JOIN users u ON c.driverId = u.id
            WHERE r.status = 'Active'
            ORDER BY ${orderBy}
            LIMIT ?
            OFFSET ?
        `;
        const [routes] = await db.query(routeQuery, [...distanceParams, limit, offset]);

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
    const { from, to, date, time, price, carId, from_lat, from_lng, to_lat, to_lng } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO routes (`from`, `to`, `date`, `time`, `price`, `carId`, `from_lat`, `from_lng`, `to_lat`, `to_lng`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [from, to, date, time, price, carId, from_lat, from_lng, to_lat, to_lng]
        );
        const [[newRoute]] = await db.query('SELECT * FROM routes WHERE id = ?', [result.insertId]);
        res.status(201).json(newRoute);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// PUT to update a route
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { from, to, date, time, price, carId, from_lat, from_lng, to_lat, to_lng } = req.body;
    try {
        await db.query(
            'UPDATE routes SET `from` = ?, `to` = ?, `date` = ?, `time` = ?, `price` = ?, `carId` = ?, `from_lat` = ?, `from_lng` = ?, `to_lat` = ?, `to_lng` = ? WHERE id = ?',
            [from, to, date, time, price, carId, from_lat, from_lng, to_lat, to_lng, id]
        );
        const [[updatedRoute]] = await db.query('SELECT * FROM routes WHERE id = ?', [id]);
        res.json(updatedRoute);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// DELETE a route
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.query("UPDATE routes SET status = 'Deleted' WHERE id = ?", [id]);
        res.json({ message: 'Route deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;