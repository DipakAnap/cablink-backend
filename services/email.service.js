
const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_PORT == 465, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

const sendEmail = async (to, subject, text, html) => {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
        console.warn('SMTP settings are missing in .env. Email sending skipped.');
        return { success: false, message: 'SMTP settings missing' };
    }

    try {
        const info = await transporter.sendMail({
            from: `"${process.env.SMTP_FROM_NAME || 'CabLink'}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
            to: to,
            subject: subject,
            text: text, // plain text body
            html: html, // html body
        });

        console.log(`Email sent: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Error sending email:', error);
        return { success: false, error: error.message };
    }
};

module.exports = { sendEmail };
