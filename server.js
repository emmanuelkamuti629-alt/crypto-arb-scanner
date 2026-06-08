const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// Initialize Transaction
app.post('/pay/initialize', async (req, res) => {
    try {
        const { email, amount } = req.body;
        const response = await axios.post('https://api.paystack.co/transaction/initialize', {
            email,
            amount: amount * 100 // Paystack uses kobo (smallest currency unit)
        }, {
            headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
            }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// Verify Transaction
app.get('/pay/verify/:reference', async (req, res) => {
    try {
        const { reference } = req.params;
        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
            }
        });
        
        if (response.data.data.status === 'success') {
            // GRANT ACCESS TO THE SCANNER HERE
            res.send("Payment successful! Scanner unlocked.");
        } else {
            res.send("Payment failed.");
        }
    } catch (error) {
        res.status(500).send(error.message);
    }
});
