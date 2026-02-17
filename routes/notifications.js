const express = require('express');
const router = express.Router();
const db = require('../db');

// This is a helper function that we can imagine would be more complex
// as it formats messages based on templates.
const getNotificationMessage = (type, data) => {
    switch(type) {
        case 'BookingConfirmation':
            return `Your booking #${data.id} is confirmed.`;
        case 'BookingCancellation':
            return `Your booking #${data.id} has been cancelled.`;
        case 'PaymentReminder':
            return `Reminder: Payment for booking #${data.id} of INR ${data.totalPrice} is pending.`;
        default:
            return '';
    }
}

// POST /api/notifications/reminders
// Body: { bookingIds: [1, 2, 3] }
router.post('/reminders', async (req, res) => {
    const { bookingIds } = req.body;

    if (!bookingIds || !Array.isArray(bookingIds) || bookingIds.length === 0) {
        return res.status(400).json({ message: 'bookingIds array is required.' });
    }

    try {
        const [bookings] = await db.query(
            'SELECT id, userId, totalPrice FROM bookings WHERE id IN (?) AND paymentStatus = ?',
            [bookingIds, 'Pending']
        );

        if (bookings.length === 0) {
            return res.status(404).json({ message: 'No pending bookings found for the given IDs.' });
        }
        
        const notifications = [];
        const channels = ['Email', 'SMS', 'WhatsApp'];
        
        for (const booking of bookings) {
            const message = getNotificationMessage('PaymentReminder', booking);
            for (const channel of channels) {
                notifications.push([
                    booking.id,
                    booking.userId,
                    'PaymentReminder',
                    channel,
                    message
                ]);
            }
        }
        
        if (notifications.length > 0) {
            await db.query(
                'INSERT INTO notifications (booking_id, user_id, type, channel, message) VALUES ?',
                [notifications]
            );
        }
        
        res.status(201).json({ message: `${notifications.length} payment reminders have been queued.` });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Database error', error });
    }
});

module.exports = router;