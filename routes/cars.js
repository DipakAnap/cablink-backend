const express = require('express');
const router = express.Router();
const db = require('../db');

const formatCar = (car) => {
    let finalImageUrl = car.imageUrl;
    if (car.imageData) {
        finalImageUrl = `data:image/jpeg;base64,${Buffer.from(car.imageData).toString('base64')}`;
    }
    const formatted = {
        ...car,
        imageUrl: finalImageUrl,
    };
    delete formatted.imageData;
    
    if (car.driverId) {
        formatted.driver = {
            id: car.driverId,
            name: car.driverName,
            phone: car.driverPhone
        };
    } else {
        formatted.driver = null;
    }
    delete formatted.driverName;
    delete formatted.driverPhone;

    return formatted;
}

// GET all cars with driver info
router.get('/', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 9;
    const offset = (page - 1) * limit;
    const { lat, lng } = req.query;

    let distanceSelection = '';
    let distanceParams = [];
    let orderBy = 'c.id DESC';

    if (lat && lng) {
        distanceSelection = `, (
            6371 * acos(
                cos(radians(?)) * cos(radians(c.latitude)) * cos(radians(c.longitude) - radians(?)) +
                sin(radians(?)) * sin(radians(c.latitude))
            )
        ) AS distance`;
        distanceParams = [parseFloat(lat), parseFloat(lng), parseFloat(lat)];
        orderBy = 'distance ASC';
    }

    try {
        const [[{ totalItems }]] = await db.query("SELECT COUNT(*) as totalItems FROM cars WHERE status != 'Deleted'");
        const totalPages = Math.ceil(totalItems / limit);

        const query = `
            SELECT c.*, u.name as driverName, u.phone as driverPhone ${distanceSelection}
            FROM cars c
            LEFT JOIN users u ON c.driverId = u.id
            WHERE c.status != 'Deleted'
            ORDER BY ${orderBy}
            LIMIT ?
            OFFSET ?
        `;
        const [cars] = await db.query(query, [...distanceParams, limit, offset]);
        const formattedCars = cars.map(formatCar);
        
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
    const { carNumber, model, driverId, capacity, pricePerKm, status, minKmPerDay, imageData, storeAsBinary, latitude, longitude } = req.body;
    
    let imageUrlToSave = null;
    let imageDataToSave = null;

    if (imageData) {
        if (storeAsBinary) {
            imageDataToSave = Buffer.from(imageData, 'base64');
        } else {
            imageUrlToSave = `https://picsum.photos/id/${Math.floor(Math.random()*200)}/400/250`;
        }
    } else {
        imageUrlToSave = `https://picsum.photos/id/${Math.floor(Math.random()*200)}/400/250`;
    }

    try {
        const [result] = await db.query(
            'INSERT INTO cars (carNumber, model, driverId, capacity, pricePerKm, minKmPerDay, imageUrl, imageData, status, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [carNumber, model, driverId || null, capacity, pricePerKm, minKmPerDay, imageUrlToSave, imageDataToSave, status || 'Pending Payment', latitude, longitude]
        );
        
        const [[newCar]] = await db.query(`
            SELECT c.*, u.name as driverName, u.phone as driverPhone 
            FROM cars c
            LEFT JOIN users u ON c.driverId = u.id
            WHERE c.id = ?
        `, [result.insertId]);
        
        res.status(201).json(formatCar(newCar));

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST to subscribe a car
router.post('/:id/subscribe', async (req, res) => {
    const { id } = req.params;
    const { planId, paymentDetails } = req.body;

    // This is a mocked data source for car registration plans. In a real app, this would be a DB table.
    const plans = [
        { id: 1, name: 'Basic', durationMonths: 6, price: 5000 },
        { id: 2, name: 'Premium', durationMonths: 12, price: 9000 }
    ];
    const plan = plans.find(p => p.id === planId);
    
    if (!plan) {
        return res.status(404).json({ message: 'Car registration plan not found.' });
    }

    try {
        // Log the transaction if payment details are provided
        if (paymentDetails) {
            await db.query(
                'INSERT INTO payment_transactions (car_id, transaction_type, amount, gateway_transaction_id) VALUES (?, ?, ?, ?)',
                [id, 'CarRegistration', paymentDetails.amount, paymentDetails.transactionId]
            );
        }

        // Update car status and expiry date
        const expiryDate = new Date();
        expiryDate.setMonth(expiryDate.getMonth() + plan.durationMonths);
        const expiryDateString = expiryDate.toISOString().split('T')[0];

        await db.query(
            "UPDATE cars SET status = 'Pending Approval', subscriptionExpiryDate = ? WHERE id = ?",
            [expiryDateString, id]
        );
        
        res.json({ message: 'Car subscription successful, pending approval.' });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});


// PUT to update a car
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { carNumber, model, driverId, capacity, pricePerKm, minKmPerDay, imageData, storeAsBinary, status, subscriptionExpiryDate, latitude, longitude } = req.body;

    // Fetch existing car to not overwrite fields that are not passed
    const [[existingCar]] = await db.query('SELECT * FROM cars WHERE id = ?', [id]);
    if (!existingCar) {
        return res.status(404).json({ message: 'Car not found' });
    }

    const updatedCar = {
        carNumber: carNumber ?? existingCar.carNumber,
        model: model ?? existingCar.model,
        driverId: driverId === 0 ? 0 : (driverId ?? existingCar.driverId),
        capacity: capacity ?? existingCar.capacity,
        pricePerKm: pricePerKm ?? existingCar.pricePerKm,
        minKmPerDay: minKmPerDay ?? existingCar.minKmPerDay,
        status: status ?? existingCar.status,
        subscriptionExpiryDate: subscriptionExpiryDate ?? existingCar.subscriptionExpiryDate,
        imageUrl: existingCar.imageUrl,
        imageData: existingCar.imageData,
        latitude: latitude ?? existingCar.latitude,
        longitude: longitude ?? existingCar.longitude,
    };
    
    if (imageData) {
        if (storeAsBinary) {
            updatedCar.imageData = Buffer.from(imageData, 'base64');
            updatedCar.imageUrl = null;
        } else {
            updatedCar.imageUrl = `https://picsum.photos/id/${Math.floor(Math.random()*200)}/400/250`;
            updatedCar.imageData = null;
        }
    }

    const query = `UPDATE cars SET carNumber = ?, model = ?, driverId = ?, capacity = ?, pricePerKm = ?, minKmPerDay = ?, status = ?, subscriptionExpiryDate = ?, imageUrl = ?, imageData = ?, latitude = ?, longitude = ? WHERE id = ?`;
    const queryParams = [
        updatedCar.carNumber, updatedCar.model, updatedCar.driverId === 0 ? null : updatedCar.driverId, updatedCar.capacity, updatedCar.pricePerKm,
        updatedCar.minKmPerDay, updatedCar.status, updatedCar.subscriptionExpiryDate, updatedCar.imageUrl, updatedCar.imageData, updatedCar.latitude, updatedCar.longitude, id
    ];

    try {
        await db.query(query, queryParams);
        const [[refetchedCar]] = await db.query(`
            SELECT c.*, u.name as driverName, u.phone as driverPhone 
            FROM cars c
            LEFT JOIN users u ON c.driverId = u.id
            WHERE c.id = ?
        `, [id]);
        res.json(formatCar(refetchedCar));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// DELETE a car
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.query("UPDATE cars SET status = 'Deleted' WHERE id = ?", [id]);
        res.json({ message: 'Car deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;