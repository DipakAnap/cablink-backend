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

// GET all cars with driver info and filters
router.get('/', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 9;
    const offset = (page - 1) * limit;
    const { lat, lng, search, status, driverId } = req.query;

    let whereClauses = ["c.status != 'Deleted'"];
    let queryParams = [];

    if (search) {
        whereClauses.push("(c.model LIKE ? OR c.carNumber LIKE ?)");
        queryParams.push(`%${search}%`, `%${search}%`);
    }
    if (status && status !== 'All') {
        whereClauses.push("c.status = ?");
        queryParams.push(status);
    }
    if (driverId && driverId !== 'All') {
        whereClauses.push("c.driverId = ?");
        queryParams.push(driverId);
    }

    const whereSql = whereClauses.join(' AND ');

    let distanceSelection = '';
    let orderBy = 'c.id DESC';

    if (lat && lng) {
        distanceSelection = `, (
            6371 * acos(
                cos(radians(?)) * cos(radians(c.latitude)) * cos(radians(c.longitude) - radians(?)) +
                sin(radians(?)) * sin(radians(c.latitude))
            )
        ) AS distance`;
        // Insert distance params at the beginning because they appear in SELECT
        // Actually, for the main query, we need to be careful with param order if using ? placeholders.
        // It's safer to not mix select params with where params if order matters and is complex.
        // However, mysql2 supports positional params. 
        // We will append distance params to queryParams for the main query *after* the SELECT part? 
        // No, params are substituted in order. 
        // SELECT part comes first.
        // So distance params first, then where params, then limit/offset.
    }

    try {
        const countQuery = `SELECT COUNT(*) as totalItems FROM cars c WHERE ${whereSql}`;
        const [[{ totalItems }]] = await db.query(countQuery, queryParams);
        const totalPages = Math.ceil(totalItems / limit);

        let finalParams = [...queryParams]; // Start with WHERE params
        
        if (lat && lng) {
             // If we use distance, we need to inject the params at the start
             finalParams = [parseFloat(lat), parseFloat(lng), parseFloat(lat), ...queryParams];
             orderBy = 'distance ASC';
        }

        const query = `
            SELECT c.*, u.name as driverName, u.phone as driverPhone ${distanceSelection}
            FROM cars c
            LEFT JOIN users u ON c.driverId = u.id
            WHERE ${whereSql}
            ORDER BY ${orderBy}
            LIMIT ?
            OFFSET ?
        `;
        
        // Add limit and offset to the end
        finalParams.push(limit, offset);

        const [cars] = await db.query(query, finalParams);
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
            [carNumber.replace(/\s/g, '').toUpperCase(), model, driverId || null, capacity, pricePerKm, minKmPerDay, imageUrlToSave, imageDataToSave, status || 'Pending Payment', latitude, longitude]
        );
        
        const [[newCar]] = await db.query(`
            SELECT c.*, u.name as driverName, u.phone as driverPhone 
            FROM cars c
            LEFT JOIN users u ON c.driverId = u.id
            WHERE c.id = ?
        `, [result.insertId]);
        
        res.status(201).json(formatCar(newCar));

    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'A car with this number plate already exists.' });
        }
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

    try {
        // Fetch existing car to not overwrite fields that are not passed
        const [[existingCar]] = await db.query('SELECT * FROM cars WHERE id = ?', [id]);
        if (!existingCar) {
            return res.status(404).json({ message: 'Car not found' });
        }

        const updatedCar = {
            carNumber: carNumber ? carNumber.replace(/\s/g, '').toUpperCase() : existingCar.carNumber,
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

        await db.query(query, queryParams);
        const [[refetchedCar]] = await db.query(`
            SELECT c.*, u.name as driverName, u.phone as driverPhone 
            FROM cars c
            LEFT JOIN users u ON c.driverId = u.id
            WHERE c.id = ?
        `, [id]);
        res.json(formatCar(refetchedCar));
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'A car with this number plate already exists.' });
        }
        res.status(500).json({ message: err.message });
    }
});

const { sendEmail } = require('../services/email.service');
const { sendSms } = require('../services/sms.service');

// DELETE a car
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Check if car exists
        const [[car]] = await db.query('SELECT * FROM cars WHERE id = ?', [id]);
        if (!car) {
            return res.status(404).json({ message: 'Car not found' });
        }

        // 2. Find active bookings (Confirmed or Pending) linked to this car directly OR via its routes
        // We need user details for notifications
        const [bookings] = await db.query(`
            SELECT b.id, b.userId, u.email, u.phone, u.name, b.bookingDate, b.bookingType
            FROM bookings b
            JOIN users u ON b.userId = u.id
            LEFT JOIN routes r ON b.routeId = r.id
            WHERE 
                (b.carId = ? OR r.carId = ?) 
                AND b.status IN ('Confirmed', 'Pending')
        `, [id, id]);

        // 3. Cancel these bookings and send notifications
        if (bookings.length > 0) {
            const bookingIds = bookings.map(b => b.id);
            await db.query(`UPDATE bookings SET status = 'Cancelled' WHERE id IN (?)`, [bookingIds]);

            // 4. Send notifications
            // We use Promise.all to send notifications in parallel but catch errors individually so one failure doesn't stop others
            await Promise.all(bookings.map(async (booking) => {
                const message = `Dear ${booking.name}, your booking (ID: ${booking.id}) for ${new Date(booking.bookingDate).toLocaleDateString()} has been cancelled because the assigned car is no longer available. We apologize for the inconvenience.`;
                
                const notifications = [];
                // Send Email
                if (booking.email) {
                     notifications.push(sendEmail(booking.email, 'Booking Cancelled - CabLink', message, `<p>${message}</p>`));
                }
                
                // Send SMS
                if (booking.phone) {
                     notifications.push(sendSms(booking.phone, message));
                }
                
                try {
                    await Promise.all(notifications);
                } catch (notifyErr) {
                    console.error(`Failed to notify user ${booking.userId} for booking ${booking.id}:`, notifyErr);
                }
            }));
        }

        // 5. Delete/Cancel Routes associated with this car
        await db.query("UPDATE routes SET status = 'Deleted' WHERE carId = ?", [id]);

        // 6. Delete the car (Soft delete)
        await db.query("UPDATE cars SET status = 'Deleted' WHERE id = ?", [id]);

        res.json({ 
            message: 'Car deleted successfully. Associated bookings were cancelled and customers notified.',
            cancelledBookingsCount: bookings.length
        });
    } catch (err) {
        console.error('Error deleting car:', err);
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;