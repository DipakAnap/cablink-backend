
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all cars with driver info
router.get('/', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 9;
    const offset = (page - 1) * limit;

    try {
        const [[{ totalItems }]] = await db.query('SELECT COUNT(*) as totalItems FROM cars');
        const totalPages = Math.ceil(totalItems / limit);

        const query = `
            SELECT c.*, u.name as driverName, u.phone as driverPhone 
            FROM cars c
            JOIN users u ON c.driverId = u.id
            ORDER BY c.id DESC
            LIMIT ?
            OFFSET ?
        `;
        const [cars] = await db.query(query, [limit, offset]);
        const formattedCars = cars.map(car => ({
            ...car,
            driver: {
                id: car.driverId,
                name: car.driverName,
                phone: car.driverPhone
            }
        }));
        
        res.json({
            items: formattedCars,
            totalItems,
            totalPages,
            currentPage: page
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST a new car
router.post('/', async (req, res) => {
    const { carNumber, model, driverId, capacity, pricePerKm } = req.body;
    const imageUrl = `https://picsum.photos/id/${Math.floor(Math.random()*200)}/400/250`;
    try {
        const [result] = await db.query(
            'INSERT INTO cars (carNumber, model, driverId, capacity, pricePerKm, imageUrl) VALUES (?, ?, ?, ?, ?, ?)',
            [carNumber, model, driverId, capacity, pricePerKm, imageUrl]
        );
        res.status(201).json({ id: result.insertId, ...req.body, imageUrl });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// PUT to update a car
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { carNumber, model, driverId, capacity, pricePerKm } = req.body;
    try {
        await db.query(
            'UPDATE cars SET carNumber = ?, model = ?, driverId = ?, capacity = ?, pricePerKm = ? WHERE id = ?',
            [carNumber, model, driverId, capacity, pricePerKm, id]
        );
        res.json({ message: 'Car updated successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// DELETE a car
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // The database schema is set to ON DELETE CASCADE for related tables
        await db.query('DELETE FROM cars WHERE id = ?', [id]);
        res.json({ message: 'Car deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
