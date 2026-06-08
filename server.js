const express = require('express');
const axios = require('axios');
const app = express(); // Essential: Define app before using it

// Middleware
app.use(express.json());
app.use(express.static('public')); // Serves your index.html

// Payment Route
app.post('/api/pay', async (req, res) => {
    try {
        const { email, amount } = req.body;
        
        // Paystack expects amount in Kobo (e.g., 100 * 100 = 10000)
        const response = await axios.post('https://api.paystack.co/transaction/initialize', {
            email: email,
            amount: amount * 100 
        }, {
            headers: { 
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        res.json(response.data);
    } catch (error) {
        console.error("Paystack Error:", error.response?.data || error.message);
        res.status(500).json({ error: "Initialization failed" });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

