const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// === MONGODB ===
mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('MongoDB connected'))
.catch(err => console.log('MongoDB error:', err));

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  isPro: { type: Boolean, default: false },
  proExpiry: { type: Date, default: null },
  pendingRef: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// === ARBITRAGE SCANNER ===
let arbCache = { data: [], lastFetch: 0 };

const COMMON_PAIRS = [
  'BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'XRP_USDT', 'DOGE_USDT',
  'ADA_USDT', 'MATIC_USDT', 'DOT_USDT', 'AVAX_USDT', 'LINK_USDT',
  'LTC_USDT', 'BCH_USDT', 'UNI_USDT', 'ATOM_USDT', 'FIL_USDT'
];

async function fetchExchangePrices() {
  try {
    const [mexc, bitget, bitmart, gateio] = await Promise.allSettled([
      axios.get('https://api.mexc.com/api/v3/ticker/price', { timeout: 5000 }),
      axios.get('https://api.bitget.com/api/spot/v1/market/tickers', { timeout: 5000 }),
      axios.get('https://api-cloud.bitmart.com/spot/v1/ticker', { timeout: 5000 }),
      axios.get('https://api.gateio.ws/api/v4/spot/tickers', { timeout: 5000 })
    ]);

    const prices = { MEXC: {}, Bitget: {}, BitMart: {}, Gateio: {} };

    if (mexc.status === 'fulfilled') {
      mexc.value.data.forEach(t => prices.MEXC[t.symbol] = parseFloat(t.price));
    }
    if (bitget.status === 'fulfilled') {
      bitget.value.data.data.forEach(t => prices.Bitget[t.symbol] = parseFloat(t.last));
    }
    if (bitmart.status === 'fulfilled') {
      bitmart.value.data.data.tickers.forEach(t => prices.BitMart[t.symbol.replace('_', '')] = parseFloat(t.last_price));
    }
    if (gateio.status === 'fulfilled') {
      gateio.value.data.forEach(t => prices.Gateio[t.currency_pair.replace('_', '')] = parseFloat(t.last));
    }

    return prices;
  } catch (err) {
    console.log('Exchange fetch error:', err.message);
    return null;
  }
}

async function scanArbitrage() {
  if (Date.now() - arbCache.lastFetch < 20000) return arbCache.data;

  const prices = await fetchExchangePrices();
  if (!prices) return arbCache.data;

  const opportunities = [];

  COMMON_PAIRS.forEach(pair => {
    const symbol = pair.replace('_', '');
    const exchangePrices = [];

    if (prices.MEXC[symbol]) exchangePrices.push({ ex: 'MEXC', price: prices.MEXC[symbol] });
    if (prices.Bitget[symbol]) exchangePrices.push({ ex: 'Bitget', price: prices.Bitget[symbol] });
    if (prices.BitMart[symbol]) exchangePrices.push({ ex: 'BitMart', price: prices.BitMart[symbol] });
    if (prices.Gateio[symbol]) exchangePrices.push({ ex: 'Gateio', price: prices.Gateio[symbol] });

    if (exchangePrices.length >= 2) {
      const buy = exchangePrices.reduce((a, b) => a.price < b.price? a : b);
      const sell = exchangePrices.reduce((a, b) => a.price > b.price? a : b);
      const profit = ((sell.price - buy.price) / buy.price) * 100;

      if (profit > 0.3 && profit < 8) {
        opportunities.push({
          pair: pair.replace('_', '/'),
          buy: buy.ex,
          sell: sell.ex,
          profit: parseFloat(profit.toFixed(2)),
          buyPrice: buy.price,
          sellPrice: sell.price
        });
      }
    }
  });

  opportunities.sort((a, b) => b.profit - a.profit);
  arbCache = { data: opportunities, lastFetch: Date.now() };
  return opportunities;
}

// === AUTH ===
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123');
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });

    if (user.isPro && user.proExpiry < new Date()) {
      user.isPro = false;
      user.proExpiry = null;
      await user.save();
    }

    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// === ROUTES ===
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, email, phone } = req.body;
    if (!username ||!password ||!email ||!phone) return res.status(400).json({ error: 'All fields required' });
    if (!phone.match(/^254[0-9]{9}$/)) return res.status(400).json({ error: 'Phone: 2547XXXXXXXX' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashed, email, phone });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'secret123');
    res.json({ token });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Username/email taken' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'secret123');
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/user', auth, async (req, res) => {
  res.json({
    username: req.user.username,
    email: req.user.email,
    phone: req.user.phone,
    isPro: req.user.isPro,
    proExpiry: req.user.proExpiry
  });
});

app.get('/api/arbitrage', auth, async (req, res) => {
  try {
    const allArbs = await scanArbitrage();
    const arbs = req.user.isPro? allArbs : allArbs.filter(arb => arb.profit < 2.0);
    res.json({
      arbs,
      isPro: req.user.isPro,
      lastScan: arbCache.lastFetch,
      totalFound: allArbs.length
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch arbitrage data' });
  }
});

// PAYSTACK M-PESA STK PUSH - FIXED
app.post('/api/subscribe/mpesa', auth, async (req, res) => {
  try {
    const { plan, phone } = req.body;
    const prices = { week: 10000, month: 35000 }; // kobo: 100 KES = 10000

    if (!prices) return res.status(400).json({ error: 'Invalid plan' });
    if (!phone ||!phone.match(/^254[0-9]{9}$/)) {
      return res.status(400).json({ error: 'Invalid phone. Use 2547XXXXXXXX' });
    }

    const response = await axios.post('https://api.paystack.co/charge', {
      email: req.user.email,
      amount: prices, // FIXED: was prices
      currency: 'KES',
      mobile_money: {
        phone: phone,
        provider: 'mpesa'
      },
      metadata: {
        userId: req.user._id.toString(),
        plan: plan,
        paymentPhone: phone
      }
    }, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const data = response.data.data;

    if (data.status === 'pay_offline') {
      req.user.pendingRef = data.reference;
      await req.user.save();
      res.json({
        success: true,
        message: data.display_text || `STK Push sent to ${phone}`,
        reference: data.reference
      });
    } else if (data.status === 'success') {
      const days = plan === 'week'? 7 : 30;
      req.user.isPro = true;
      req.user.proExpiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      req.user.pendingRef = null;
      await req.user.save();
      res.json({ success: true, message: 'Payment completed. PRO activated.' });
    } else {
      res.status(400).json({ error: data.message || 'Failed to initiate M-Pesa' });
    }
  } catch (err) {
    console.log('Paystack error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || 'Payment failed. Check Paystack keys.' });
  }
});

// PAYSTACK WEBHOOK
app.post('/api/paystack/webhook', async (req, res) => {
  try {
    const event = req.body;
    if (event.event === 'charge.success') {
      const { reference, metadata, status } = event.data;
      if (status === 'success') {
        const user = await User.findById(metadata.userId);
        if (user && user.pendingRef === reference) {
          const days = metadata.plan === 'week'? 7 : 30;
          user.isPro = true;
          user.proExpiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
          user.pendingRef = null;
          await user.save();
          console.log(`PRO activated: ${user.username}`);
        }
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.log('Webhook error:', err);
    res.sendStatus(500);
  }
});

// Check payment status
app.get('/api/subscribe/status', auth, async (req, res) => {
  res.json({
    isPro: req.user.isPro,
    proExpiry: req.user.proExpiry,
    pending:!!req.user.pendingRef
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'Server running', mongo:!!mongoose.connection.readyState, lastScan: arbCache.lastFetch });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ArbiMine live on ${PORT}`);
  scanArbitrage();
});
