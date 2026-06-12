const express = require("express");
const axios = require("axios");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const users = {};
const sessions = {};
const historyStore = {};

/* ===================== HELPERS ===================== */

const hash = (p) =>
    crypto.createHash("sha256").update(p).digest("hex");

const token = () =>
    crypto.randomBytes(24).toString("hex");

async function safeGet(url, name) {
    try {
        const res = await axios.get(url, {
            timeout: 12000,
            headers: { "User-Agent": "Mozilla/5.0" }
        });
        return res.data;
    } catch (e) {
        console.log(name, "SKIP:", e.response?.status || e.message);
        return null;
    }
}

/* ===================== EXCHANGES ===================== */

const EXCHANGES = {
    mexc: "https://api.mexc.com/api/v3/ticker/24hr",
    kucoin: "https://api.kucoin.com/api/v1/market/allTickers",
    gateio: "https://api.gateio.ws/api/v4/spot/tickers",
    okx: "https://www.okx.com/api/v5/market/tickers?instType=SPOT",
    htx: "https://api.huobi.pro/market/tickers"
};

/* ===================== CORE ENGINE ===================== */

const MIN_SPREAD = 0.5;
const MAX_SPREAD = 50;

/* liquidity FIX (IMPORTANT) */
function liquidityScore(volume) {

    const score = Math.min(100, Math.floor(volume / 60000));

    if (score > 75) return { label: "HIGH", score };
    if (score > 35) return { label: "MEDIUM", score };

    return { label: "LOW", score };
}

/* risk engine */
function riskEngine(spread, liquidity) {

    let risk = 0;

    if (spread > 10) risk++;
    if (liquidity === "LOW") risk++;
    if (spread > 25) risk++;

    if (risk <= 1)
        return { level: "LOW", color: "green" };

    if (risk === 2)
        return { level: "MEDIUM", color: "orange" };

    return { level: "HIGH", color: "red" };
}

/* arrival time */
function arrival(exchange) {
    const map = {
        mexc: 2,
        kucoin: 3,
        okx: 2,
        gateio: 4,
        htx: 3
    };
    return map[exchange] || 5;
}

/* ===================== NORMALIZER ===================== */

function normalize(ex, symbol, t) {

    let sym = null;
    let price = 0;
    let volume = 0;

    if (ex === "mexc" && symbol.endsWith("USDT")) {
        sym = symbol.replace("USDT", "");
        price = +t.lastPrice;
        volume = +t.quoteVolume || 0;
    }

    if (ex === "kucoin" && symbol.endsWith("-USDT")) {
        sym = symbol.replace("-USDT", "");
        price = +t.last;
        volume = +t.volValue || 0;
    }

    if (ex === "okx" && symbol.includes("-USDT")) {
        sym = symbol.replace("-USDT", "");
        price = +t.last;
        volume = +t.volCcy24h || 0;
    }

    if (!sym || !price) return null;

    return { sym, price, volume };
}

/* ===================== OPPORTUNITIES ===================== */

app.get("/api/opportunities", async (req, res) => {

    try {

        const results = await Promise.all(
            Object.entries(EXCHANGES).map(([n, u]) =>
                safeGet(u, n)
            )
        );

        const map = {};
        Object.keys(EXCHANGES).forEach(e => map[e] = {});

        results.forEach((data, idx) => {

            const ex = Object.keys(EXCHANGES)[idx];
            if (!data) return;

            let tickers = [];

            if (ex === "mexc") tickers = data;
            if (ex === "kucoin") tickers = data.data?.ticker || [];
            if (ex === "okx") tickers = data.data || [];
            if (ex === "gateio") tickers = data || [];
            if (ex === "htx") tickers = data.data || [];

            tickers.forEach(t => {

                const key =
                    t.symbol ||
                    t.currency_pair ||
                    t.instId ||
                    "";

                const d = normalize(ex, key, t);

                if (d && d.volume > 50000) {
                    map[ex][d.sym] = d;
                }
            });
        });

        const symbols = new Set();
        Object.values(map).forEach(e =>
            Object.keys(e).forEach(s => symbols.add(s))
        );

        const opportunities = [];

        for (const sym of symbols) {

            const prices = {};

            Object.keys(map).forEach(ex => {
                if (map[ex][sym]) prices[ex] = map[ex][sym];
            });

            const arr = Object.entries(prices);
            if (arr.length < 2) continue;

            arr.sort((a, b) => a[1].price - b[1].price);

            const [buyEx, buy] = arr[0];
            const [sellEx, sell] = arr.at(-1);

            const spread =
                ((sell.price - buy.price) / buy.price) * 100;

            if (spread < MIN_SPREAD || spread > MAX_SPREAD) continue;

            const id = `${sym}-${buyEx}-${sellEx}`;

            if (!historyStore[id]) historyStore[id] = [];

            historyStore[id].push({
                spread,
                time: Date.now(),
                buyPrice: buy.price,
                sellPrice: sell.price
            });

            if (historyStore[id].length > 30)
                historyStore[id].shift();

            const hist = historyStore[id];

            const liquidity = liquidityScore((buy.volume + sell.volume) / 2);

            const risk = riskEngine(spread, liquidity.label);

            const obj = {

                id,
                symbol: sym,

                buyExchange: buyEx.toUpperCase(),
                sellExchange: sellEx.toUpperCase(),

                buyPrice: buy.price.toFixed(6),
                sellPrice: sell.price.toFixed(6),

                spread: spread.toFixed(2),

                /* IMPORTANT FIX → flatten values */
                liquidity: liquidity.label,
                liquidityScore: liquidity.score,

                riskLevel: risk.level,
                riskColor: risk.color,

                trend:
                    hist.length > 2
                        ? hist.at(-1).spread > hist[0].spread
                            ? "UP"
                            : "DOWN"
                        : "STABLE",

                arrivalTime: {
                    buy: arrival(buyEx),
                    sell: arrival(sellEx)
                },

                tradable: true,

                history: hist
            };

            opportunities.push(obj);
        }

        res.json({
            count: opportunities.length,
            opportunities
        });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/* ===================== DETAILS API ===================== */

app.get("/api/opportunity/:id", (req, res) => {

    const id = req.params.id;
    const hist = historyStore[id] || [];
    const p = id.split("-");

    res.json({
        data: {

            id,
            symbol: p[0],

            buyExchange: p[1],
            sellExchange: p[2],

            buyPrice: hist.at(-1)?.buyPrice || 0,
            sellPrice: hist.at(-1)?.sellPrice || 0,

            liquidity: "MEDIUM",
            risk: { level: "LOW", color: "green" },

            arrivalTime: {
                buy: 2,
                sell: 3
            },

            history: hist
        }
    });
});

/* ===================== SUBSCRIPTION ===================== */

app.post("/api/subscribe", (req, res) => {

    const { plan } = req.body;

    const plans = {
        weekly: 100,
        monthly: 350
    };

    if (!plans[plan]) {
        return res.status(400).json({ error: "Invalid plan" });
    }

    res.json({
        success: true,
        message: `${plan} activated`,
        price: plans[plan]
    });
});

/* ===================== SERVER ===================== */

app.listen(PORT, () => {
    console.log("🚀 ArbiMine FIXED running on", PORT);
});
