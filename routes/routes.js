const express = require('express');
const router = express.Router();
const db = require('../db');

// Helper to check for time conflicts
const checkRouteConflict = async (carId, date, time, excludeRouteId = null) => {
    // Fetch all active routes for this car
    let query = `SELECT id, date, time FROM routes WHERE carId = ? AND status = 'Active'`;
    let params = [carId];

    if (excludeRouteId) {
        query += ` AND id != ?`;
        params.push(excludeRouteId);
    }

    const [existingRoutes] = await db.query(query, params);
    
    // Parse the new route time
    const newRouteTime = new Date(`${date}T${time}`);
    const gapThreshold = 3 * 60 * 60 * 1000; // 3 hours in milliseconds

    for (const route of existingRoutes) {
        // Ensure we have a string in YYYY-MM-DD format
        let existingDateStr = route.date;
        if (route.date instanceof Date) {
            existingDateStr = route.date.toISOString().split('T')[0];
        }
        
        const existingRouteTime = new Date(`${existingDateStr}T${route.time}`);
        const diff = Math.abs(newRouteTime - existingRouteTime);

        if (diff < gapThreshold) {
            return true; // Conflict found
        }
    }
    return false; // No conflict
};

// GET all routes with car and booking info for seat availability
router.get('/', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6;
    const offset = (page - 1) * limit;
    const { lat, lng, from, to, date, carId } = req.query;

    let whereClauses = ["r.status = 'Active'"];
    let queryParams = [];

    if (from) {
        whereClauses.push("r.from LIKE ?");
        queryParams.push(`%${from}%`);
    }
    if (to) {
        whereClauses.push("r.to LIKE ?");
        queryParams.push(`%${to}%`);
    }
    if (date) {
        whereClauses.push("r.date = ?");
        queryParams.push(date);
    }
    if (carId && carId !== 'All') {
        whereClauses.push("r.carId = ?");
        queryParams.push(carId);
    }

    const whereSql = whereClauses.join(' AND ');

    let distanceSelection = '';
    let orderBy = 'r.date DESC, r.time DESC';

    if (lat && lng) {
        distanceSelection = `, (
            6371 * acos(
                cos(radians(?)) * cos(radians(r.from_lat)) * cos(radians(r.from_lng) - radians(?)) +
                sin(radians(?)) * sin(radians(r.from_lat))
            )
        ) AS distance`;
    }

    try {
        const countQuery = `SELECT COUNT(*) as totalItems FROM routes r WHERE ${whereSql}`;
        const [[{ totalItems }]] = await db.query(countQuery, queryParams);
        const totalPages = Math.ceil(totalItems / limit);

        let finalParams = [];
        if (lat && lng) {
            finalParams = [parseFloat(lat), parseFloat(lng), parseFloat(lat)];
            orderBy = 'distance ASC';
        }
        finalParams = [...finalParams, ...queryParams, limit, offset];

        const routeQuery = `
            SELECT 
                r.id, r.from, r.to, 
                DATE_FORMAT(r.date, '%Y-%m-%d') as date, 
                r.time, r.price, r.carId, r.seatsOffered,
                r.from_lat, r.from_lng, r.to_lat, r.to_lng,
                c.model as carModel, c.capacity as carCapacity, c.imageUrl as carImageUrl,
                u.name as driverName, u.phone as driverPhone
                ${distanceSelection}
            FROM routes r
            JOIN cars c ON r.carId = c.id
            LEFT JOIN users u ON c.driverId = u.id
            WHERE ${whereSql}
            ORDER BY ${orderBy}
            LIMIT ?
            OFFSET ?
        `;
        const [routes] = await db.query(routeQuery, finalParams);

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
            seatsAvailable: (route.seatsOffered || route.carCapacity) - (bookingMap[route.id] || 0)
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
    const { from, to, date, time, price, carId, seatsOffered, from_lat, from_lng, to_lat, to_lng } = req.body;
    
    try {
        const hasConflict = await checkRouteConflict(carId, date, time);
        if (hasConflict) {
            return res.status(409).json({ message: 'This car already has a route scheduled within 3 hours of this time.' });
        }

        const [result] = await db.query(
            'INSERT INTO routes (`from`, `to`, `date`, `time`, `price`, `carId`, `seatsOffered`, `from_lat`, `from_lng`, `to_lat`, `to_lng`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [from, to, date, time, price, carId, seatsOffered, from_lat, from_lng, to_lat, to_lng]
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
    const { from, to, date, time, price, carId, seatsOffered, from_lat, from_lng, to_lat, to_lng } = req.body;
    try {
        const hasConflict = await checkRouteConflict(carId, date, time, id);
        if (hasConflict) {
            return res.status(409).json({ message: 'This car already has a route scheduled within 3 hours of this time.' });
        }

        await db.query(
            'UPDATE routes SET `from` = ?, `to` = ?, `date` = ?, `time` = ?, `price` = ?, `carId` = ?, `seatsOffered` = ?, `from_lat` = ?, `from_lng` = ?, `to_lat` = ?, `to_lng` = ? WHERE id = ?',
            [from, to, date, time, price, carId, seatsOffered, from_lat, from_lng, to_lat, to_lng, id]
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