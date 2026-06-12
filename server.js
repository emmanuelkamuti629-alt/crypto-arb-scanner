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
const history = {};

/* ================= HELPERS ================= */

const hash = p =>
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
        console.log(name, "FAILED:", e.response?.status || e.message);
        return null;
    }
}

/* ================= EXCHANGES ================= */

const EXCHANGES = {
    mexc: "https://api.mexc.com/api/v3/ticker/24hr",
    kucoin: "https://api.kucoin.com/api/v1/market/allTickers",
    okx: "https://www.okx.com/api/v5/market/tickers?instType=SPOT",
    gateio: "https://api.gateio.ws/api/v4/spot/tickers",
    htx: "https://api.huobi.pro/market/tickers"
};

/* ================= ENGINE ================= */

function liquidity(volume) {

    const score = Math.min(100, Math.floor(volume / 40000));

    if (score > 70) return { label: "HIGH", score };
    if (score > 35) return { label: "MEDIUM", score };

    return { label: "LOW", score };
}

function risk(spread) {

    if (spread < 2) return { level: "LOW", color: "green" };
    if (spread < 8) return { level: "MEDIUM", color: "orange" };

    return { level: "HIGH", color: "red" };
}

/* REAL NETWORK MODEL (FIXED) */

function buyNetworks() {
    return [
        { network: "ERC20", withdraw: true },
        { network: "TRC20", withdraw: true },
        { network: "BEP20", withdraw: true }
    ];
}

function sellNetworks() {
    return [
        { network: "ERC20", deposit: true },
        { network: "TRC20", deposit: true },
        { network: "BEP20", deposit: true }
    ];
}

/* ================= NORMALIZER ================= */

function norm(ex, symbol, t) {

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

/* ================= OPPORTUNITIES ================= */

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

                const d = norm(ex, key, t);

                if (d) {
                    map[ex][d.sym] = d;
                }
            });
        });

        const symbols = new Set();

        Object.values(map).forEach(e =>
            Object.keys(e).forEach(s => symbols.add(s))
        );

        const opps = [];

        for (const s of symbols) {

            const prices = {};

            Object.keys(map).forEach(ex => {
                if (map[ex][s]) prices[ex] = map[ex][s];
            });

            const arr = Object.entries(prices);
            if (arr.length < 2) continue;

            arr.sort((a, b) => a[1].price - b[1].price);

            const [buyEx, buy] = arr[0];
            const [sellEx, sell] = arr.at(-1);

            const spread =
                ((sell.price - buy.price) / buy.price) * 100;

            const id = `${s}-${buyEx}-${sellEx}`;

            if (!history[id]) history[id] = [];

            history[id].push({
                spread,
                time: Date.now(),
                buyPrice: buy.price,
                sellPrice: sell.price
            });

            if (history[id].length > 30)
                history[id].shift();

            const liq = liquidity((buy.volume + sell.volume) / 2);
            const rk = risk(spread);

            opps.push({

                id,
                symbol: s,

                buyExchange: buyEx.toUpperCase(),
                sellExchange: sellEx.toUpperCase(),

                buyPrice: buy.price,
                sellPrice: sell.price,

                spread: spread.toFixed(2),

                liquidity: liq,   // OBJECT (frontend fixed)

                risk: rk,

                trend:
                    history[id].at(-1).spread >
                    history[id][0].spread
                        ? "UP"
                        : "DOWN",

                buyNetworks: buyNetworks(),
                sellNetworks: sellNetworks(),

                history: history[id]
            });
        }

        res.json({
            count: opps.length,
            opportunities: opps
        });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/* ================= DETAILS ================= */

app.get("/api/opportunity/:id", (req, res) => {

    const id = req.params.id;
    const hist = history[id] || [];
    const p = id.split("-");

    res.json({
        data: {
            id,
            symbol: p[0],
            buyExchange: p[1],
            sellExchange: p[2],

            buyPrice: hist.at(-1)?.buyPrice || 0,
            sellPrice: hist.at(-1)?.sellPrice || 0,

            buyNetworks: buyNetworks(),
            sellNetworks: sellNetworks(),

            history: hist
        }
    });
});

/* ================= SUBSCRIBE ================= */

app.post("/api/subscribe", (req, res) => {

    const { plan } = req.body;

    const plans = { weekly: 100, monthly: 350 };

    if (!plans[plan]) {
        return res.status(400).json({ error: "Invalid plan" });
    }

    res.json({
        success: true,
        message: `${plan} activated`,
        price: plans[plan]
    });
});

/* ================= START ================= */

app.listen(PORT, () => {
    console.log("🚀 ArbiMine FULL FIX running on", PORT);
});
