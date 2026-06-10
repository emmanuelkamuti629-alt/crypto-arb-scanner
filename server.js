const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Arbimine API Live', time: new Date() });
});

// ---------------------- PAYSTACK STK PUSH ----------------------
app.post('/api/paystack/stk', async (req, res) => {
  try {
    const { phone, amount, email = 'customer@arbimine.com' } = req.body;
    
    if (!phone || !amount) {
      return res.status(400).json({ error: 'phone and amount required' });
    }

    // Format to 2547XXXXXXXX
    let formattedPhone = phone.replace(/^0/, '254').replace(/^\+/, '').replace(/\s/g, '');
    if (!formattedPhone.startsWith('254')) formattedPhone = `254${formattedPhone}`;

    const response = await axios.post(
      'https://api.paystack.co/charge',
      {
        email,
        amount: Math.round(amount * 100), // KES to cents
        currency: 'KES',
        mobile_money: {
          phone: formattedPhone,
          provider: 'mpesa'
        },
        metadata: {
          custom_fields: [
            { display_name: "Service", variable_name: "service", value: "Arbimine Deposit" }
          ]
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = response.data.data;
    if (data.status === 'pay_offline') {
      res.json({ 
        success: true, 
        message: 'Check your phone for M-Pesa prompt',
        reference: data.reference,
        status: data.status
      });
    } else {
      res.json({ success: false, data });
    }

  } catch (err) {
    console.error('Paystack STK Error:', JSON.stringify(err.response?.data || err.message, null, 2));
    res.status(500).json({ 
      error: 'STK push failed', 
      details: err.response?.data || err.message 
    });
  }
});

// Verify payment status
app.get('/api/paystack/verify/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: 'Verify failed', details: err.response?.data || err.message });
  }
});

// Paystack webhook - set this URL in Paystack Dashboard: https://crypto-arb-scanner-q6x2.onrender.com/api/paystack/webhook
app.post('/api/paystack/webhook', (req, res) => {
  const event = req.body;
  console.log('Paystack Webhook:', event.event, event.data?.reference);
  
  if (event.event === 'charge.success') {
    const amount = event.data.amount / 100;
    const phone = event.data.customer.phone;
    console.log(`✅ Payment SUCCESS: KES ${amount} from ${phone} | Ref: ${event.data.reference}`);
    // TODO: Update your database, credit user balance, etc.
  }
  res.sendStatus(200);
});

// ---------------------- BASIC ARB SCANNER ----------------------
app.get('/api/scan', async (req, res) => {
  try {
    // Example: BTC prices on Binance vs Kraken
    const [binance, kraken] = await Promise.all([
      axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'),
      axios.get('https://api.kraken.com/0/public/Ticker?pair=XBTUSDT')
    ]);

    const binancePrice = parseFloat(binance.data.price);
    const krakenPrice = parseFloat(kraken.data.result.XXBTZUSD.c[0]);

    const spread = ((krakenPrice - binancePrice) / binancePrice) * 100;
    const opportunity = Math.abs(spread) > 0.3; // 0.3% threshold

    res.json({
      timestamp: new Date(),
      pair: 'BTC/USDT',
      binance: binancePrice,
      kraken: krakenPrice,
      spread_percent: spread.toFixed(3),
      opportunity,
      action: spread > 0.3 ? 'Buy Binance → Sell Kraken' : spread < -0.3 ? 'Buy Kraken → Sell Binance' : 'No trade'
    });

  } catch (err) {
    console.error('Scan Error:', err.message);
    res.status(500).json({ error: 'Scan failed', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
