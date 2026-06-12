const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ---------- ANSI Color Codes ----------
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m"
};

function logSuccess(msg) {
  console.log(`${colors.green}✅ ${msg}${colors.reset}`);
}
function logError(msg) {
  console.log(`${colors.red}❌ ${msg}${colors.reset}`);
}
function logInfo(msg) {
  console.log(`${colors.cyan}ℹ️ ${msg}${colors.reset}`);
}
function logWarn(msg) {
  console.log(`${colors.yellow}⚠️ ${msg}${colors.reset}`);
}

/* =========================
   BINANCE STYLE (if needed later)
========================= */
async function getBinanceAssets() {
  try {
    logInfo("Fetching Binance assets...");
    const res = await axios.get(
      "https://api.binance.com/sapi/v1/capital/config/getall"
    );
    logSuccess(`Binance: ${res.data.length} assets loaded`);
    return res.data.map(asset => ({
      exchange: "binance",
      coin: asset.coin,
      deposit: asset.depositAllEnable,
      withdraw: asset.withdrawAllEnable,
      networks: (asset.networkList || []).map(n => ({
        network: n.network,
        deposit: n.depositEnable,
        withdraw: n.withdrawEnable,
        fee: n.withdrawFee
      }))
    }));
  } catch (err) {
    logError(`Binance failed: ${err.message}`);
    return [];
  }
}

/* =========================
   HUOBI / HTX
========================= */
async function getHuobiAssets() {
  try {
    logInfo("Fetching Huobi assets...");
    const res = await axios.get(
      "https://api.huobi.pro/v2/reference/currencies"
    );
    const data = res.data.data;
    logSuccess(`Huobi: ${data.length} assets loaded`);
    return data.map(c => ({
      exchange: "huobi",
      coin: c.currency,
      deposit: c.deposit_status === "allowed",
      withdraw: c.withdraw_status === "allowed",
      networks: (c.chains || []).map(n => ({
        network: n.chain,
        deposit: n.deposit_status === "allowed",
        withdraw: n.withdraw_status === "allowed"
      }))
    }));
  } catch (err) {
    logError(`Huobi failed: ${err.message}`);
    return [];
  }
}

/* =========================
   BITFINEX
========================= */
async function getBitfinexAssets() {
  try {
    logInfo("Fetching Bitfinex assets...");
    const res = await axios.get("https://api-pub.bitfinex.com/v2/conf/pub:info:tx:stat");
    const coins = Object.keys(res.data[0] || {});
    logSuccess(`Bitfinex: ${coins.length} assets loaded (limited data)`);
    return coins.map(coin => ({
      exchange: "bitfinex",
      coin,
      deposit: true,
      withdraw: true,
      networks: []
    }));
  } catch (err) {
    logError(`Bitfinex failed: ${err.message}`);
    return [];
  }
}

/* =========================
   POLONIEX
========================= */
async function getPoloniexAssets() {
  try {
    logInfo("Fetching Poloniex assets...");
    const res = await axios.get("https://api.poloniex.com/markets/currencies");
    const data = res.data;
    logSuccess(`Poloniex: ${data.length} assets loaded`);
    return data.map(c => ({
      exchange: "poloniex",
      coin: c.currency,
      deposit: c.depositStatus === "ENABLED",
      withdraw: c.withdrawalStatus === "ENABLED",
      networks: (c.networks || []).map(n => ({
        network: n.network,
        deposit: n.depositStatus === "ENABLED",
        withdraw: n.withdrawalStatus === "ENABLED"
      }))
    }));
  } catch (err) {
    logError(`Poloniex failed: ${err.message}`);
    return [];
  }
}

/* =========================
   UPBIT
========================= */
async function getUpbitAssets() {
  try {
    logInfo("Fetching Upbit assets...");
    const res = await axios.get("https://api.upbit.com/v1/withdraws/chance");
    const data = res.data.currency || [];
    logSuccess(`Upbit: ${data.length} assets loaded`);
    return data.map(c => ({
      exchange: "upbit",
      coin: c.code,
      deposit: c.deposit_status === "working",
      withdraw: c.withdraw_status === "working",
      networks: (c.net_type || []).map(n => ({
        network: n,
        deposit: true,
        withdraw: true
      }))
    }));
  } catch (err) {
    logError(`Upbit failed: ${err.message}`);
    return [];
  }
}

/* =========================
   CRYPTO.COM
========================= */
async function getCryptoComAssets() {
  try {
    logInfo("Fetching Crypto.com assets...");
    const res = await axios.get(
      "https://crypto.com/exchange/api/v1/public/get-instruments"
    );
    const data = res.data.result?.instruments || [];
    logSuccess(`Crypto.com: ${data.length} assets loaded`);
    return data.map(i => ({
      exchange: "crypto.com",
      coin: i.base_ccy,
      deposit: true,
      withdraw: true,
      networks: []
    }));
  } catch (err) {
    logError(`Crypto.com failed: ${err.message}`);
    return [];
  }
}

/**
 * ---------------------------
 * MASTER SCANNER
 * ---------------------------
 */
app.get("/api/exchanges/assets", async (req, res) => {
  const start = Date.now();
  logInfo("Starting full asset scan...");
  try {
    const results = await Promise.all([
      getHuobiAssets(),
      getBitfinexAssets(),
      getPoloniexAssets(),
      getUpbitAssets(),
      getCryptoComAssets()
    ]);

    const merged = results.flat();
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    logSuccess(`Scan completed in ${duration}s → ${merged.length} asset entries`);

    res.json({
      success: true,
      count: merged.length,
      data: merged
    });
  } catch (err) {
    logError(`Master scan failed: ${err.message}`);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * ---------------------------
 * OPPORTUNITIES (FIXED FORMAT)
 * ---------------------------
 */
app.get("/api/opportunities", async (req, res) => {
  try {
    logInfo("Generating opportunities...");
    const data = await axios.get(
      `http://localhost:${PORT}/api/exchanges/assets`
    );

    const assets = data.data.data;

    // group by coin
    const map = {};

    assets.forEach(a => {
      if (!map[a.coin]) map[a.coin] = [];
      map[a.coin].push(a);
    });

    const opportunities = Object.entries(map)
      .filter(([coin, list]) => list.length > 1)
      .map(([coin, list]) => ({
        coin,
        exchanges: list,
        arbitrage: "calculated_client_side"
      }));

    logSuccess(`Found ${opportunities.length} coins with multiple exchanges`);

    res.json({
      success: true,
      count: opportunities.length,
      opportunities
    });
  } catch (err) {
    logError(`Opportunities endpoint error: ${err.message}`);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * ---------------------------
 * HEALTH CHECK
 * ---------------------------
 */
app.get("/", (req, res) => {
  logInfo("Health check hit");
  res.json({
    status: "Arbimine API Live (REAL DATA MODE)",
    time: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`\n${colors.bright}${colors.magenta}🚀 Server running on port ${PORT}${colors.reset}\n`);
});
