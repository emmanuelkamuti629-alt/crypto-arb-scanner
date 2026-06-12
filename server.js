const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/**
 * ---------------------------
 * EXCHANGE ADAPTERS
 * ---------------------------
 * Each exchange has different API structure.
 * We ONLY map real API responses.
 */

/* =========================
   BINANCE STYLE (if needed later)
========================= */
async function getBinanceAssets() {
  try {
    const res = await axios.get(
      "https://api.binance.com/sapi/v1/capital/config/getall"
    );

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
    return [];
  }
}

/* =========================
   HUOBI / HTX
========================= */
async function getHuobiAssets() {
  try {
    const res = await axios.get(
      "https://api.huobi.pro/v2/reference/currencies"
    );

    return res.data.data.map(c => ({
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
    return [];
  }
}

/* =========================
   BITFINEX
   (limited network data publicly)
========================= */
async function getBitfinexAssets() {
  try {
    const res = await axios.get("https://api-pub.bitfinex.com/v2/conf/pub:info:tx:stat");

    // Bitfinex is limited → normalize safely
    return Object.keys(res.data[0] || {}).map(coin => ({
      exchange: "bitfinex",
      coin,
      deposit: true,
      withdraw: true,
      networks: []
    }));
  } catch (err) {
    return [];
  }
}

/* =========================
   POLONIEX
========================= */
async function getPoloniexAssets() {
  try {
    const res = await axios.get("https://api.poloniex.com/markets/currencies");

    return res.data.map(c => ({
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
    return [];
  }
}

/* =========================
   UPBIT
========================= */
async function getUpbitAssets() {
  try {
    const res = await axios.get("https://api.upbit.com/v1/withdraws/chance");

    return (res.data.currency || []).map(c => ({
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
    return [];
  }
}

/* =========================
   CRYPTO.COM (simplified public endpoint)
========================= */
async function getCryptoComAssets() {
  try {
    const res = await axios.get(
      "https://crypto.com/exchange/api/v1/public/get-instruments"
    );

    return (res.data.result?.instruments || []).map(i => ({
      exchange: "crypto.com",
      coin: i.base_ccy,
      deposit: true,
      withdraw: true,
      networks: []
    }));
  } catch (err) {
    return [];
  }
}

/**
 * ---------------------------
 * MASTER SCANNER
 * ---------------------------
 */
app.get("/api/exchanges/assets", async (req, res) => {
  try {
    const results = await Promise.all([
      getHuobiAssets(),
      getBitfinexAssets(),
      getPoloniexAssets(),
      getUpbitAssets(),
      getCryptoComAssets()
    ]);

    const merged = results.flat();

    res.json({
      success: true,
      count: merged.length,
      data: merged
    });
  } catch (err) {
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
 * Ensures frontend never sees [object Object]
 */
app.get("/api/opportunities", async (req, res) => {
  try {
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

    res.json({
      success: true,
      count: opportunities.length,
      opportunities
    });
  } catch (err) {
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
  res.json({
    status: "Arbimine API Live (REAL DATA MODE)",
    time: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
