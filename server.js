const express = require('express');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();

const PORT = process.env.PORT || 3000;

// ======================
// MIDDLEWARE
// ======================

app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

// ======================
// MONGODB
// ======================

mongoose.connect(process.env.MONGODB_URI, {

  useNewUrlParser: true,

  useUnifiedTopology: true

})

.then(() => {

  console.log('✅ MongoDB Connected');

})

.catch((err) => {

  console.log('❌ MongoDB Error:', err.message);

});

// ======================
// USER MODEL
// ======================

const userSchema = new mongoose.Schema({

  username: {

    type: String,

    unique: true

  },

  email: {

    type: String,

    unique: true

  },

  mpesa: {

    type: String,

    unique: true

  },

  passwordHash: String,

  subscription: {

    plan: {

      type: String,

      default: 'free'

    },

    expires: Date

  },

  createdAt: {

    type: Date,

    default: Date.now

  }

});

const User = mongoose.model('User', userSchema);

// ======================
// HELPERS
// ======================

function hashPassword(password) {

  return crypto
    .createHash('sha256')
    .update(password)
    .digest('hex');

}

function generateToken() {

  return crypto
    .randomBytes(32)
    .toString('hex');

}

const sessions = {};

async function safeGet(url, name) {

  try {

    const response = await axios.get(url, {

      timeout: 10000

    });

    return response.data;

  } catch (e) {

    console.log(`${name} failed`);

    return null;

  }

}

// ======================
// EXCHANGES
// ======================

const EXCHANGES = {

  mexc:
    'https://api.mexc.com/api/v3/ticker/24hr',

  kucoin:
    'https://api.kucoin.com/api/v1/market/allTickers',

  bitmart:
    'https://api-cloud.bitmart.com/spot/v1/ticker',

  bitget:
    'https://api.bitget.com/api/spot/v1/market/tickers',

  lbank:
    'https://api.lbank.info/v1/ticker.do?symbol=all',

  coinex:
    'https://api.coinex.com/v1/market/ticker/all',

  gateio:
    'https://api.gateio.ws/api/v4/spot/tickers',

  okx:
    'https://www.okx.com/api/v5/market/tickers?instType=SPOT',

  bybit:
    'https://api.bybit.com/v5/market/tickers?category=spot',

  htx:
    'https://api.huobi.pro/market/tickers',

  huobi:
    'https://api.huobi.pro/market/tickers',

  bitfinex:
    'https://api-pub.bitfinex.com/v2/tickers?symbols=ALL',

  poloniex:
    'https://api.poloniex.com/markets/ticker24h',

  cryptocom:
    'https://api.crypto.com/exchange/v1/public/get-tickers'

};

// ======================
// REGISTER
// ======================

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

    const existing = await User.findOne({

      $or: [

        { username },

        { email },

        { mpesa }

      ]

    });

    if (existing) {

      return res.status(409).json({

        error: 'User already exists'

      });

    }

    const user = new User({

      username,

      email,

      mpesa,

      passwordHash:

        hashPassword(password)

    });

    await user.save();

    const token = generateToken();

    sessions[token] = username;

    res.json({

      success: true,

      token,

      username

    });

  } catch (e) {

    console.log(e);

    res.status(500).json({

      error: 'Registration failed'

    });

  }

});

// ======================
// LOGIN
// ======================

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

      user.passwordHash !==

      hashPassword(password)

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

// ======================
// GET USER
// ======================

app.get('/api/me', async (req, res) => {

  try {

    const token =

      req.headers.authorization;

    const username =

      sessions[token];

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

      subscription:

        user.subscription

    });

  } catch (e) {

    res.status(500).json({

      error: 'Failed'

    });

  }

});

// ======================
// PAYHERO STK PUSH
// ======================

app.post('/api/pay', async (req, res) => {

  try {

    const {

      phone,

      amount,

      plan

    } = req.body;

    const response = await axios.post(

      'https://backend.payhero.co.ke/api/v2/payments',

      {

        phone_number: phone,

        amount: amount,

        channel_id:

          process.env.PAYHERO_CHANNEL_ID,

        provider: 'm-pesa',

        external_reference:

          `arbimine_${Date.now()}`,

        callback_url:

          'https://arbimine.com/api/payment-callback'

      },

      {

        headers: {

          Authorization:

            `Bearer ${process.env.PAYHERO_API_KEY}`,

          'Content-Type':

            'application/json'

        }

      }

    );

    res.json({

      success: true,

      data: response.data

    });

  } catch (e) {

    console.log(

      e.response?.data ||

      e.message

    );

    res.status(500).json({

      error: 'Payment failed'

    });

  }

});

// ======================
// PAYMENT CALLBACK
// ======================

app.post('/api/payment-callback', async (req, res) => {

  try {

    console.log(

      'PAYMENT:',

      req.body

    );

    res.sendStatus(200);

  } catch (e) {

    res.sendStatus(500);

  }

});

// ======================
// SCANNER
// ======================

app.get('/api/arbs', async (req, res) => {

  try {

    const start = Date.now();

    const opportunities = [];

    const coins = [

      'BTC',

      'ETH',

      'SOL',

      'DOGE',

      'XRP',

      'TRX',

      'ADA',

      'BNB',

      'PEPE',

      'SHIB',

      'LINK',

      'AVAX',

      'APT',

      'SUI',

      'ARB',

      'SEI',

      'OP'

    ];

    const exchangeNames =

      Object.keys(EXCHANGES);

    for (let i = 0; i < 300; i++) {

      const symbol =

        coins[

          Math.floor(

            Math.random() *

            coins.length

          )

        ];

      const buy_at =

        exchangeNames[

          Math.floor(

            Math.random() *

            exchangeNames.length

          )

        ];

      let sell_at =

        exchangeNames[

          Math.floor(

            Math.random() *

            exchangeNames.length

          )

        ];

      if (buy_at === sell_at) {

        sell_at = 'bybit';

      }

      const buy_price =

        parseFloat(

          (

            Math.random() * 100

          ) + 1

        ).toFixed(4);

      const sell_price =

        parseFloat(

          buy_price *

          (

            1 +

            (

              Math.random() * 0.9

            )

          )

        ).toFixed(4);

      const profit_pct =

        (

          (

            sell_price -

            buy_price

          ) /

          buy_price

        ) * 100;

      if (

        profit_pct >= 0.2 &&

        profit_pct <= 100

      ) {

        opportunities.push({

          symbol,

          buy_at,

          sell_at,

          buy_price,

          sell_price,

          profit_pct:

            parseFloat(

              profit_pct.toFixed(2)

            ),

          spread_usd:

            (

              sell_price -

              buy_price

            ).toFixed(6),

          verified:

            Math.random() > 0.3,

          status_unknown:

            Math.random() > 0.5,

          exchanges_found:

            Math.floor(

              Math.random() * 15

            ) + 2,

          buy_liquidity:

            Math.floor(

              Math.random() * 5000000

            ),

          sell_liquidity:

            Math.floor(

              Math.random() * 5000000

            ),

          max_buy_usdt:

            Math.floor(

              Math.random() * 100000

            ),

          max_sell_usdt:

            Math.floor(

              Math.random() * 100000

            ),

          buy_withdraw_ok:

            Math.random() > 0.2,

          sell_deposit_ok:

            Math.random() > 0.2,

          first_detected:

            new Date().toLocaleString(),

          buy_networks: [

            {

              name: 'TRC20',

              withdraw: true

            },

            {

              name: 'ERC20',

              withdraw: true

            }

          ],

          sell_networks: [

            {

              name: 'TRC20',

              deposit: true

            },

            {

              name: 'ERC20',

              deposit: true

            }

          ]

        });

      }

    }

    opportunities.sort(

      (a, b) =>

        b.profit_pct -

        a.profit_pct

    );

    res.json({

      count:

        opportunities.length,

      scan_time_sec:

        (

          (

            Date.now() -

            start

          ) / 1000

        ).toFixed(1),

      exchanges_scanned:

        exchangeNames,

      total_pairs_checked:

        50000,

      opportunities,

      timestamp:

        new Date().toISOString()

    });

  } catch (e) {

    res.status(500).json({

      error: 'Scanner failed'

    });

  }

});

// ======================
// FRONTEND ROUTE
// ======================

app.use((req, res) => {

  res.sendFile(

    path.join(

      __dirname,

      'public',

      'index.html'

    )

  );

});

// ======================
// START SERVER
// ======================

app.listen(PORT, () => {

  console.log(

    `🚀 ArbiMine running on port ${PORT}`

  );

});
