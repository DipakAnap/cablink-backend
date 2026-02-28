
const axios = require('axios');
require('dotenv').config();

const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY;

const sendSms = async (phoneNumber, message) => {
    if (!FAST2SMS_API_KEY) {
        console.warn('FAST2SMS_API_KEY is not set in .env. SMS sending skipped.');
        return { success: false, message: 'API Key missing' };
    }

    try {
        // Fast2SMS Bulk V2 API
        // Note: 'route' can be 'q' (Quick SMS - transactional/promotional) or 'dlt' (DLT Manual).
        // For general use without specific DLT template approval during dev, 'q' is often used but has restrictions.
        // For production, you should use DLT templates.
        
        const response = await axios.get('https://www.fast2sms.com/dev/bulkV2', {
            params: {
                authorization: FAST2SMS_API_KEY,
                message: message,
                language: 'english',
                route: 'q', 
                numbers: phoneNumber
            }
        });

        if (response.data && response.data.return) {
            console.log(`SMS Sent successfully to ${phoneNumber}`);
            return { success: true, data: response.data };
        } else {
            console.error('Fast2SMS Error:', response.data);
            return { success: false, error: response.data };
        }
    } catch (error) {
        console.error('SMS Sending Failed:', error.message);
        return { success: false, error: error.message };
    }
};

module.exports = { sendSms };
