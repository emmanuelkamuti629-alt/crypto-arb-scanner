app.post('/api/pay', async (req, res) => {
    try {
        const { email, amount } = req.body;
        
        // Ensure amount is a number and convert to kobo (smallest currency unit)
        const amountInKobo = amount * 100;

        const response = await axios.post('https://api.paystack.co/transaction/initialize', {
            email: email,
            amount: amountInKobo
        }, {
            headers: { 
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        res.json(response.data);
    } catch (error) {
        // This log is crucial! Check your Render logs if it fails
        console.error("Paystack Error:", error.response?.data || error.message);
        res.status(500).json({ error: "Initialization failed" });
    }
});

