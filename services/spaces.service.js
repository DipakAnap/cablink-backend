
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

let s3Client = null;

const getS3Client = () => {
    if (!s3Client) {
        const key = process.env.SPACES_KEY;
        const secret = process.env.SPACES_SECRET;
        const endpoint = process.env.SPACES_ENDPOINT;
        const region = process.env.SPACES_REGION || 'us-east-1';

        if (!key || !secret || !endpoint) {
            console.warn('DigitalOcean Spaces credentials missing. Falling back to simulation mode.');
            return null;
        }

        s3Client = new S3Client({
            endpoint: endpoint.startsWith('http') ? endpoint : `https://${endpoint}`,
            region: region,
            credentials: {
                accessKeyId: key,
                secretAccessKey: secret,
            },
        });
    }
    return s3Client;
};

/**
 * Uploads a base64 encoded image to DigitalOcean Spaces.
 * @param {string} base64Data - The base64 encoded image data.
 * @param {string} folder - The folder to upload to (e.g., 'cars', 'profiles').
 * @param {string} fileName - The name of the file.
 * @returns {Promise<string>} - The URL of the uploaded image.
 */
const uploadImage = async (base64Data, folder, fileName) => {
    const client = getS3Client();
    const bucket = process.env.SPACES_BUCKET;
    const cdnUrl = process.env.SPACES_CDN_URL;

    if (!client || !bucket) {
        // Simulation mode fallback
        console.log(`[Simulation] Uploading ${fileName} to folder ${folder}`);
        return `https://spaces.digitalocean.com/cablink/images/${folder}/${fileName}`;
    }

    try {
        const buffer = Buffer.from(base64Data, 'base64');
        const key = `${folder}/${fileName}`;
        
        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: buffer,
            ACL: 'public-read',
            ContentType: 'image/jpeg', // Defaulting to jpeg as we compress to jpeg in frontend
        });

        await client.send(command);

        // Construct the final URL
        if (cdnUrl) {
            return `${cdnUrl.endsWith('/') ? cdnUrl : cdnUrl + '/'}${key}`;
        }
        
        // Default to the endpoint-based URL if CDN is not provided
        const endpoint = process.env.SPACES_ENDPOINT;
        return `https://${bucket}.${endpoint}/${key}`;
    } catch (error) {
        console.error('Error uploading to Spaces:', error);
        throw error;
    }
};

module.exports = {
    uploadImage,
};
