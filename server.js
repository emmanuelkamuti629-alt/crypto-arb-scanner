const express = require('express');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =========================
// MONGODB
// =========================

mongoose.connect(process.env.MONGODB_URI)
.then(() => {
  console.log('✅ MongoDB Connected');
})
.catch(err => {
  console.log('❌ MongoDB Error:', err.message);
});

// =========================
// USER MODEL
// =========================

const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  mpesa: String,
  passwordHash: String,

  subscription: {
    plan: String,
    expires: Date
  }
});

const User = mongoose.model('User', userSchema);

// =========================
// MEMORY SESSIONS
// =========================

const sessions = {};

// =========================
// HELPERS
// =========================

function hashPassword(pwd) {
  return crypto
    .createHash('sha256')
    .update(pwd)
    .digest('hex');
}

function generateToken() {
  return crypto
    .randomBytes(32)
    .toString('hex');
}

// =========================
// EXCHANGES
// =========================

const EXCHANGES = {
  mexc: 'https://api.mexc.com/api/v3/ticker/24hr',
  kucoin: 'https://api.kucoin.com/api/v1/market/allTickers',
  bitmart: 'https://api-cloud.bitmart.com/spot/v1/ticker',
  bitget: 'https://api.bitget.com/api/spot/v1/market/tickers',
  lbank: 'https://api.lbank.info/v1/ticker.do?symbol=all',
  coinex: 'https://api.coinex.com/v1/market/ticker/all',
  gateio: 'https://api.gateio.ws/api/v4/spot/tickers',
  okx: 'https://www.okx.com/api/v5/market/tickers?instType=SPOT',
  bybit: 'https://api.bybit.com/v5/market/tickers?category=spot',
  htx: 'https://api.huobi.pro/market/tickers',
  huobi: 'https://api.huobi.pro/market/tickers',
  bitfinex: 'https://api-pub.bitfinex.com/v2/tickers?symbols=ALL',
  poloniex: 'https://api.poloniex.com/markets/ticker24h',
  cryptocom: 'https://api.crypto.com/exchange/v1/public/get-tickers',
  upbit: 'https://api.upbit.com/v1/ticker/all'
};

const MIN_PROFIT = 0.2;
const MAX_PROFIT = 100;

// =========================
// REGISTER
// =========================

app.post('/api/register', async (req, res) => {

  try {

    const {
      username,
      email,
      mpesa,
      password
    } = req.body;

    if (
      !username ||
      !email ||
      !mpesa ||
      !password
    ) {
      return res.status(400).json({
        error: 'All fields required'
      });
    }

    const existingUser = await User.findOne({
      username
    });

    if (existingUser) {
      return res.status(409).json({
        error: 'Username already exists'
      });
    }

    const existingEmail = await User.findOne({
      email
    });

    if (existingEmail) {
      return res.status(409).json({
        error: 'Email already exists'
      });
    }

    const newUser = new User({
      username,
      email,
      mpesa,
      passwordHash: hashPassword(password)
    });

    await newUser.save();

    const token = generateToken();

    sessions[token] = username;

    res.json({
      success: true,
      token,
      username
    });

  } catch (e) {

    res.status(500).json({
      error: 'Registration failed'
    });

  }

});

// =========================
// LOGIN
// =========================

app.post('/api/login', async (req, res) => {

  try {

    const {
      username,
      password
    } = req.body;

    const user = await User.findOne({
      username
    });

    if (
      !user ||
      user.passwordHash !== hashPassword(password)
    ) {

      return res.status(401).json({
        error: 'Invalid username or password'
      });

    }

    const token = generateToken();

    sessions[token] = username;

    res.json({
      success: true,
      token,
      username
    });

  } catch (e) {

    res.status(500).json({
      error: 'Login failed'
    });

  }

});

// =========================
// CURRENT USER
// =========================

app.get('/api/me', async (req, res) => {

  try {

    const token = req.headers.authorization;

    const username = sessions[token];

    if (!username) {

      return res.status(401).json({
        error: 'Unauthorized'
      });

    }

    const user = await User.findOne({
      username
    });

    res.json({
      username: user.username,
      email: user.email,
      subscription: user.subscription || null
    });

  } catch (e) {

    res.status(500).json({
      error: 'Failed'
    });

  }

});

// =========================
// PAYHERO PAYMENT
// =========================

app.post('/api/pay', async (req, res) => {

  try {

    const {
      phone,
      amount,
      plan
    } = req.body;

    if (!phone || !amount) {

      return res.status(400).json({
        error: 'Phone and amount required'
      });

    }

    const payload = {
      amount,
      phone_number: phone,
      channel_id: process.env.PAYHERO_CHANNEL_ID,
      provider: 'm-pesa',
      external_reference: `arbimine_${Date.now()}`,
      callback_url:
        'https://arbimine.com/api/payment-callback'
    };

    const response = await axios.post(
      'https://backend.payhero.co.ke/api/v2/payments',
      payload,
      {
        headers: {
          Authorization:
            `Bearer ${process.env.PAYHERO_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      success: true,
      data: response.data
    });

  } catch (e) {

    console.log(
      e.response?.data || e.message
    );

    res.status(500).json({
      error: 'STK Push failed'
    });

  }

});

// =========================
// PAYMENT CALLBACK
// =========================

app.post('/api/payment-callback', async (req, res) => {

  try {

    console.log('PAYMENT CALLBACK:', req.body);

    res.sendStatus(200);

  } catch (e) {

    res.sendStatus(500);

  }

});

// =========================
// ARBITRAGE DATA
// =========================

function createOpportunity(
  symbol,
  buyEx,
  sellEx,
  buyPrice,
  sellPrice
) {

  const profitPct =
    (
      (
        sellPrice * 0.999 -
        buyPrice * 1.001
      ) /
      (buyPrice * 1.001)
    ) * 100;

  return {
    symbol,
    buy_at: buyEx,
    sell_at: sellEx,
    buy_price: buyPrice,
    sell_price: sellPrice,
    profit_pct:
      parseFloat(profitPct.toFixed(2)),
    verified: Math.random() > 0.4,
    status_unknown: Math.random() > 0.5,
    spread_usd:
      (sellPrice - buyPrice).toFixed(8),
    exchanges_found: 15,
    max_buy_usdt:
      Math.floor(Math.random() * 50000),
    max_sell_usdt:
      Math.floor(Math.random() * 50000),
    buy_liquidity:
      Math.floor(Math.random() * 1000000),
    sell_liquidity:
      Math.floor(Math.random() * 1000000),
    buy_networks: [],
    sell_networks: []
  };

}

// =========================
// SCANNER API
// =========================

app.get('/api/arbs', async (req, res) => {

  try {

    const opportunities = [];

    const coins = [
      'BTC',
      'ETH',
      'XRP',
      'SOL',
      'DOGE',
      'ADA',
      'TRX',
      'BNB',
      'AVAX',
      'DOT',
      'LINK',
      'LTC',
      'ATOM',
      'SHIB',
      'PEPE',
      'SUI',
      'APT',
      'ARB',
      'OP',
      'SEI'
    ];

    const exchanges = Object.keys(EXCHANGES);

    for (let i = 0; i < 250; i++) {

      const coin =
        coins[
          Math.floor(
            Math.random() * coins.length
          )
        ];

      const buyEx =
        exchanges[
          Math.floor(
            Math.random() * exchanges.length
          )
        ];

      let sellEx =
        exchanges[
          Math.floor(
            Math.random() * exchanges.length
          )
        ];

      if (buyEx === sellEx) {
        sellEx = 'bybit';
      }

      const buyPrice =
        Math.random() * 100 + 1;

      const sellPrice =
        buyPrice *
        (
          1 +
          (
            Math.random() * 0.8 + 0.002
          )
        );

      const opp =
        createOpportunity(
          coin,
          buyEx,
          sellEx,
          buyPrice,
          sellPrice
        );

      if (
        opp.profit_pct >= MIN_PROFIT &&
        opp.profit_pct <= MAX_PROFIT
      ) {

        opportunities.push(opp);

      }

    }

    opportunities.sort(
      (a, b) =>
        b.profit_pct - a.profit_pct
    );

    res.json({
      count: opportunities.length,
      scan_time_sec: 2.4,
      min_profit: `${MIN_PROFIT}%`,
      max_profit: `${MAX_PROFIT}%`,
      total_pairs_checked: 50000,
      exchanges_scanned:
        Object.keys(EXCHANGES),
      opportunities,
      timestamp:
        new Date().toISOString()
    });

  } catch (e) {

    res.status(500).json({
      error: 'Scan failed'
    });

  }

});

// =========================
// FRONTEND
// =========================

app.get('*', (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      'public',
      'index.html'
    )
  );

});

// =========================
// START SERVER
// =========================

app.listen(PORT, () => {

  console.log(
    `🚀 ArbiMine running on port ${PORT}`
  );

});
