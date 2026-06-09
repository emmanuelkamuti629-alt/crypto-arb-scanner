require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');

const app = express();

// 1. Enable CORS for your dashboard
app.use(cors({
    origin: '*', // Allows requests from your dashboard
    methods: ['GET', 'POST']
}));

app.use(express.json());

// 2. Database Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Connected to MongoDB Atlas"))
    .catch(err => console.error("MongoDB error:", err));

// 3. Session Configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret123',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// 4. API Route
app.get('/api/get-arbitrage-data', async (req, res) => {
    try {
        const response = await axios.get('https://api.coingecko.com/api/v3/coins/bitcoin/tickers', {
            headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY }
        });
        // Send only the tickers array to the frontend
        res.json(response.data.tickers); 
    } catch (err) {
        console.error("API Fetch Error:", err.message);
        res.status(500).json({ error: "Failed to fetch data" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server live on ${PORT}`));

