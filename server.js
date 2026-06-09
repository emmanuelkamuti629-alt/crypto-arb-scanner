require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');

const app = express();

// Enable CORS
app.use(cors());
app.use(express.json());

// Ensure we have a Mongo URI
const dbUrl = process.env.MONGO_URI;

if (!dbUrl) {
    console.error("FATAL ERROR: MONGO_URI is not defined in environment variables.");
    process.exit(1);
}

// 1. Database Connection
mongoose.connect(dbUrl)
    .then(() => console.log("Connected to MongoDB Atlas"))
    .catch(err => console.error("MongoDB connection error:", err));

// 2. Session Configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret_key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: dbUrl 
    }),
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // true if on Render
        maxAge: 1000 * 60 * 60 * 24 
    }
}));

// 3. API Route
app.get('/api/get-arbitrage-data', async (req, res) => {
    try {
        const response = await axios.get('https://api.coingecko.com/api/v3/coins/bitcoin/tickers', {
            headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY }
        });
        res.json(response.data.tickers); 
    } catch (err) {
        console.error("API Fetch Error:", err.message);
        res.status(500).json({ error: "Failed to fetch data" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server live on ${PORT}`));

