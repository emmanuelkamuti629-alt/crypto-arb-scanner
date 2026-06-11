const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "arbimine_secret_key";
const MONGO_URI = process.env.MONGO_URI;

// ===============================
// MONGODB CONNECT
// ===============================
mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Connected");
  })
  .catch((err) => {
    console.log("❌ MongoDB Error:", err.message);
  });

// ===============================
// USER SCHEMA
// ===============================
const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  mpesa: String,
  password: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const User = mongoose.model("User", userSchema);

// ===============================
// AUTH MIDDLEWARE
// ===============================
function auth(req, res, next) {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({
      error: "No token provided",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({
      error: "Invalid token",
    });
  }
}

// ===============================
// REGISTER
// ===============================
app.post("/api/register", async (req, res) => {
  try {
    const { username, email, mpesa, password } = req.body;

    if (!username || !email || !mpesa || !password) {
      return res.status(400).json({
        error: "All fields required",
      });
    }

    const existing = await User.findOne({
      $or: [{ username }, { email }],
    });

    if (existing) {
      return res.status(400).json({
        error: "User already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      username,
      email,
      mpesa,
      password: hashedPassword,
    });

    const token = jwt.sign(
      {
        id: user._id,
        username: user.username,
      },
      JWT_SECRET,
      {
        expiresIn: "30d",
      }
    );

    res.json({
      success: true,
      token,
      username: user.username,
    });
  } catch (err) {
    console.log(err);

    res.status(500).json({
      error: "Registration failed",
    });
  }
});

// ===============================
// LOGIN
// ===============================
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username });

    if (!user) {
      return res.status(400).json({
        error: "User not found",
      });
    }

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.status(400).json({
        error: "Wrong password",
      });
    }

    const token = jwt.sign(
      {
        id: user._id,
        username: user.username,
      },
      JWT_SECRET,
      {
        expiresIn: "30d",
      }
    );

    res.json({
      success: true,
      token,
      username: user.username,
    });
  } catch {
    res.status(500).json({
      error: "Login failed",
    });
  }
});

// ===============================
// GET USER
// ===============================
app.get("/api/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    res.json(user);
  } catch {
    res.status(500).json({
      error: "Server error",
    });
  }
});

// ===============================
// RANDOM ARBITRAGE DATA
// ===============================
function randomBetween(min, max) {
  return (Math.random() * (max - min) + min).toFixed(2);
}

function generateOpportunity(symbol) {
  const exchanges = [
    "binance",
    "bybit",
    "mexc",
    "bitget",
    "kucoin",
    "gate",
    "okx",
    "htx",
    "bingx",
    "coinex",
  ];

  const buyAt =
    exchanges[Math.floor(Math.random() * exchanges.length)];

  let sellAt =
    exchanges[Math.floor(Math.random() * exchanges.length)];

  while (sellAt === buyAt) {
    sellAt =
      exchanges[Math.floor(Math.random() * exchanges.length)];
  }

  const buyPrice = parseFloat(randomBetween(0.1, 500));
  const profit = parseFloat(randomBetween(0.2, 100));

  const sellPrice = (
    buyPrice +
    (buyPrice * profit) / 100
  ).toFixed(4);

  const verified = Math.random() > 0.3;

  return {
    id: crypto.randomUUID(),
    symbol,

    buy_at: buyAt,
    sell_at: sellAt,

    buy_price: buyPrice.toFixed(4),
    sell_price,

    profit_pct: profit,

    spread_usd: (
      sellPrice - buyPrice
    ).toFixed(4),

    exchanges_found: Math.floor(
      Math.random() * 8 + 2
    ),

    verified,
    status_unknown: !verified,

    buy_liquidity: Math.floor(
      Math.random() * 5000000
    ),

    sell_liquidity: Math.floor(
      Math.random() * 5000000
    ),

    max_buy_usdt: Math.floor(
      Math.random() * 100000
    ),

    max_sell_usdt: Math.floor(
      Math.random() * 100000
    ),

    buy_withdraw_ok: Math.random() > 0.2,
    sell_deposit_ok: Math.random() > 0.2,

    buy_networks: [
      {
        name: "TRC20",
        withdraw: Math.random() > 0.2,
      },
      {
        name: "BEP20",
        withdraw: Math.random() > 0.2,
      },
      {
        name: "ERC20",
        withdraw: Math.random() > 0.2,
      },
    ],

    sell_networks: [
      {
        name: "TRC20",
        deposit: Math.random() > 0.2,
      },
      {
        name: "BEP20",
        deposit: Math.random() > 0.2,
      },
      {
        name: "ERC20",
        deposit: Math.random() > 0.2,
      },
    ],

    first_detected: new Date(
      Date.now() -
        Math.floor(Math.random() * 3600000)
    ).toISOString(),
  };
}

// ===============================
// ARBITRAGE API
// ===============================
app.get("/api/arbs", async (req, res) => {
  try {
    const symbols = [
      "BTC",
      "ETH",
      "SOL",
      "XRP",
      "DOGE",
      "ADA",
      "TRX",
      "AVAX",
      "LINK",
      "LTC",
      "PEPE",
      "SHIB",
      "BNB",
      "SUI",
      "TON",
      "APT",
      "ARB",
      "OP",
      "INJ",
      "ATOM",
      "NEAR",
      "FTM",
      "MATIC",
      "WLD",
      "SEI",
      "FLOKI",
      "JUP",
      "RUNE",
      "UNI",
      "AAVE",
      "CRV",
      "DYDX",
      "TIA",
      "PYTH",
      "ONDO",
      "BONK",
      "ENA",
      "ZRO",
      "STRK",
      "NOT",
      "TURBO",
      "MEME",
      "BOME",
      "ALT",
      "AI",
      "RENDER",
      "GALA",
      "SAND",
      "MANA",
      "BLUR",
      "GMT",
      "ACE",
      "PIXEL",
      "PORTAL",
      "CATI",
      "HMSTR",
      "XLM",
      "ETC",
      "FIL",
      "ICP",
      "ALGO",
      "VET",
      "EOS",
      "KAS",
      "FLOW",
      "THETA",
      "EGLD",
      "XTZ",
      "KAVA",
      "CHZ",
      "COMP",
      "SNX",
      "LDO",
      "CAKE",
      "1INCH",
      "BAT",
      "ENJ",
      "ZIL",
      "HOT",
      "ANKR",
      "CELO",
      "ROSE",
      "CFX",
      "CKB",
      "SKL",
      "DYM",
      "MANTA",
      "BEAM",
      "SUPER",
      "WIF",
      "BRETT",
      "POPCAT",
      "MEW",
      "BOOK",
      "SLERF",
      "MOG",
      "PONKE",
      "GOAT",
      "PNUT",
      "ACT",
      "NEIRO",
    ];

    const opportunities = symbols.map((symbol) =>
      generateOpportunity(symbol)
    );

    res.json({
      success: true,
      count: opportunities.length,
      scan_time_sec: randomBetween(2, 7),
      exchanges_scanned: [
        "binance",
        "bybit",
        "mexc",
        "bitget",
        "kucoin",
        "gate",
        "okx",
        "htx",
        "bingx",
        "coinex",
      ],
      total_pairs_checked: 1200,
      opportunities,
    });
  } catch {
    res.status(500).json({
      error: "Failed to fetch opportunities",
    });
  }
});

// ===============================
// ROOT
// ===============================
app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

// ===============================
// START SERVER
// ===============================
app.listen(PORT, () => {
  console.log(`🚀 ArbiMine running on port ${PORT}`);
});
