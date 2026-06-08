
const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.static('public'));

app.post('/api/pay', async (req, res) => {
    try {
        const response = await axios.post('https://api.paystack.co/transaction/initialize', {
            email: req.body.email,
            amount: req.body.amount * 100 // Paystack uses kobo
        }, {
            headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
            }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).send("Payment initialization failed");
    }
});

app.listen(3000, () => console.log('Server running on port 3000'));

