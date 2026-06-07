require('dotenv').config();
const express = require('express');
const axios = require('axios');
const IntaSend = require('intasend-node'); // Updated package name here

const app = express();
app.use(express.json());
app.use(express.static('public'));

let paidSessions = {};

// Initialize IntaSend
const intasend = new IntaSend({
  publishableKey: process.env.INTASEND_PUBLISHABLE_KEY,
  secretKey: process.env.INTASEND_SECRET_KEY,
  isTestMode: false 
});

// 1. TRIGGER MPESA STK PUSH
app.post('/api/checkout', async (req, res) => {
  const { phoneNumber, amount } = req.body;
  try {
    const collection = intasend.collection();
    const response = await collection.mpesaStkPush({
      first_name: 'Crypto',
      last_name: 'Trader',
      email_address: 'user@example.com',
      phone_number: phoneNumber,
      amount: amount,
      api_ref: `ArbScanner_${Date.now()}`
    });
    paidSessions[response.invoice.invoice_id] = { status: 'PENDING', paid: false };
    res.json({ success: true, invoiceId: response.invoice.invoice_id });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to initiate payment." });
  }
});

// 2. WEBHOOK RECEIVER
app.post('/api/webhook', (req, res) => {
  const { invoice_id, state } = req.body;
  if (state === 'COMPLETE' && paidSessions[invoice_id]) {
    paidSessions[invoice_id].status = 'SUCCESS';
    paidSessions[invoice_id].paid = true;
  }
  res.sendStatus(200);
});

// 3. CHECK PAYMENT STATUS
app.get('/api/status/:invoiceId', (req, res) => {
  const session = paidSessions[req.params.invoiceId];
  res.json({ paid: session ? session.paid : false });
});

// 4. SECURE CRYPTO ARBITRAGE SCANNER
app.get('/api/scanner', async (req, res) => {
  const { invoiceId } = req.query;
  if (!invoiceId || !paidSessions[invoiceId] || !paidSessions[invoiceId].paid) {
    return res.status(402).json({ error: "Payment required." });
  }
  try {
    const [binanceRes, kucoinRes] = await Promise.all([
      axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'),
      axios.get('https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=BTC-USDT')
    ]);
    const binancePrice = parseFloat(binanceRes.data.price);
    const kucoinPrice = parseFloat(kucoinRes.data.data.price);
    const absoluteSpread = Math.abs(binancePrice - kucoinPrice);
    const percentageSpread = (absoluteSpread / Math.min(binancePrice, kucoinPrice)) * 100;

    res.json({
      asset: "BTC/USDT",
      binance: binancePrice,
      kucoin: kucoinPrice,
      spreadUSD: absoluteSpread.toFixed(2),
      percentage: percentageSpread.toFixed(2) + "%",
      action: binancePrice > kucoinPrice ? "Buy on KuCoin -> Sell on Binance" : "Buy on Binance -> Sell on KuCoin"
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to scan exchanges." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

