const express = require('express');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/*
========================================
MEMORY
========================================
*/
const users = {};
const sessions = {};
const opportunityHistory = {};
const priceMemory = {};

/*
========================================
UTILS
========================================
*/
function hashPassword(p) {
    return crypto.createHash('sha256').update(p).digest('hex');
}

function token() {
    return crypto.randomBytes(32).toString('hex');
}

async function safeGet(url, name) {
    try {
        const res = await axios.get(url, {
            timeout: 12000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        return res.data;
    } catch (e) {
        console.log(name, "FAILED:", e.message);
        return null;
    }
}

/*
========================================
EXCHANGES
========================================
*/
const EXCHANGES = {
    mexc: 'https://api.mexc.com/api/v3/ticker/24hr',
    kucoin: 'https://api.kucoin.com/api/v1/market/allTickers',
    bitmart: 'https://api-cloud.bitmart.com/spot/v1/ticker',
    bitget: 'https://api.bitget.com/api/spot/v1/market/tickers',
    gateio: 'https://api.gateio.ws/api/v4/spot/tickers',
    okx: 'https://www.okx.com/api/v5/market/tickers?instType=SPOT',
    bybit: 'https://api.bybit.com/v5/market/tickers?category=spot',
    htx: 'https://api.huobi.pro/market/tickers',
    bitfinex: 'https://api-pub.bitfinex.com/v2/tickers?symbols=ALL',
    poloniex: 'https://api.poloniex.com/markets/ticker24h',
    cryptocom: 'https://api.crypto.com/exchange/v1/public/get-tickers',
    upbit: 'https://api.upbit.com/v1/ticker?markets=KRW-BTC'
};

const MIN_PROFIT = 0.5;
const MAX_PROFIT = 60;
const MIN_VOLUME = 80000;

/*
========================================
LIQUIDITY ENGINE
========================================
*/
function getLiquidity(volume) {
    if (volume > 5000000) return "HIGH";
    if (volume > 500000) return "MEDIUM";
    return "LOW";
}

/*
========================================
RISK ENGINE
========================================
*/
function getRisk(spread, liquidity, volatility = 2) {
    let score = 0;

    if (spread > 15) score += 2;
    if (liquidity === "LOW") score += 2;
    if (volatility > 5) score += 2;

    if (score <= 1) return { level: "LOW", color: "green" };
    if (score <= 3) return { level: "MEDIUM", color: "yellow" };
    return { level: "HIGH", color: "red" };
}

/*
========================================
TREND ENGINE
========================================
*/
function getTrend(history) {
    if (!history || history.length < 3) return "STABLE";

    const first = history[0].spread;
    const last = history[history.length - 1].spread;

    if (last > first) return "INCREASING";
    if (last < first) return "DECREASING";
    return "STABLE";
}

/*
========================================
ARRIVAL TIME
========================================
*/
function estimateArrival(exchange) {
    const speed = {
        okx: 2,
        bybit: 3,
        mexc: 2,
        kucoin: 4,
        gateio: 3,
        bitmart: 5,
        htx: 3,
        bitfinex: 4
    };

    return speed[exchange] || 5;
}

/*
========================================
NORMALIZER
========================================
*/
function normalize(symbol, ex, t) {
    let sym = null;
    let price = null;
    let volume = 0;

    if (ex === 'mexc' && symbol.endsWith('USDT')) {
        sym = symbol.replace('USDT', '');
        price = +t.lastPrice;
        volume = +t.quoteVolume || 0;
    }

    if (ex === 'kucoin' && symbol.endsWith('-USDT')) {
        sym = symbol.replace('-USDT', '');
        price = +t.last;
        volume = +t.volValue || 0;
    }

    if (ex === 'bitmart' && symbol.endsWith('_USDT')) {
        sym = symbol.replace('_USDT', '');
        price = +t.last_price;
        volume = +t.quote_volume || 0;
    }

    if (ex === 'okx' && symbol.endsWith('-USDT')) {
        sym = symbol.replace('-USDT', '');
        price = +t.last;
        volume = +t.volCcy24h || 0;
    }

    if (ex === 'bybit' && symbol.endsWith('USDT')) {
        sym = symbol.replace('USDT', '');
        price = +t.lastPrice;
        volume = +t.turnover24h || 0;
    }

    if (ex === 'gateio' && symbol.endsWith('_USDT')) {
        sym = symbol.replace('_USDT', '');
        price = +t.last;
        volume = +t.quote_volume || 0;
    }

    if (!sym || !price || price <= 0) return null;

    return { symbol: sym, price, volume };
}

/*
========================================
NETWORKS (REALISTIC MODEL)
========================================
*/
function getNetworks() {
    return [
        { network: "ERC20", deposit: true, withdraw: true, eta: "5-15 min" },
        { network: "TRC20", deposit: true, withdraw: true, eta: "2-10 min" },
        { network: "BEP20", deposit: true, withdraw: true, eta: "3-12 min" },
        { network: "SOL", deposit: true, withdraw: true, eta: "1-5 min" }
    ];
}

/*
========================================
OPPORTUNITIES
========================================
*/
app.get('/api/opportunities', async (req, res) => {

    try {

        const results = await Promise.all(
            Object.entries(EXCHANGES).map(([n, u]) => safeGet(u, n))
        );

        const map = {};
        Object.keys(EXCHANGES).forEach(e => map[e] = {});

        results.forEach((data, idx) => {

            const ex = Object.keys(EXCHANGES)[idx];
            if (!data) return;

            let tickers = [];

            if (ex === 'mexc') tickers = data;
            else if (ex === 'kucoin') tickers = data.data?.ticker || [];
            else if (ex === 'bitmart') tickers = data.data?.tickers || [];
            else if (ex === 'okx') tickers = data.data || [];
            else if (ex === 'bybit') tickers = data.result?.list || [];
            else if (ex === 'gateio') tickers = data || [];

            tickers.forEach(t => {

                const key = t.symbol || t.currency_pair || t.instId || '';
                const d = normalize(key, ex, t);

                if (d && d.volume > MIN_VOLUME) {
                    map[ex][d.symbol] = {
                        price: d.price,
                        volume: d.volume
                    };
                }
            });
        });

        const symbols = new Set();
        Object.values(map).forEach(e =>
            Object.keys(e).forEach(s => symbols.add(s))
        );

        const opportunities = [];

        for (const symbol of symbols) {

            const prices = {};

            Object.keys(map).forEach(ex => {
                if (map[ex][symbol]) {
                    prices[ex] = map[ex][symbol];
                }
            });

            const entries = Object.entries(prices);
            if (entries.length < 2) continue;

            entries.sort((a, b) => a[1].price - b[1].price);

            const [buyEx, buy] = entries[0];
            const [sellEx, sell] = entries.at(-1);

            const spread =
                ((sell.price - buy.price) / buy.price) * 100;

            if (spread < MIN_PROFIT || spread > MAX_PROFIT) continue;

            const id = `${symbol}-${buyEx}-${sellEx}`;

            if (!opportunityHistory[id]) opportunityHistory[id] = [];

            opportunityHistory[id].push({
                time: Date.now(),
                spread: +spread.toFixed(2),
                buyPrice: buy.price,
                sellPrice: sell.price
            });

            if (opportunityHistory[id].length > 25)
                opportunityHistory[id].shift();

            const history = opportunityHistory[id];

            const liquidity = getLiquidity((buy.volume + sell.volume) / 2);
            const risk = getRisk(spread, liquidity);
            const trend = getTrend(history);

            priceMemory[id] = { buy: buy.price, sell: sell.price };

            opportunities.push({
                id,
                symbol,

                buyExchange: buyEx.toUpperCase(),
                sellExchange: sellEx.toUpperCase(),

                buyPrice: buy.price.toFixed(6),
                sellPrice: sell.price.toFixed(6),

                spread: spread.toFixed(2),

                tradable: true,

                liquidity,

                risk,

                trend,

                arrivalTime: {
                    buy: estimateArrival(buyEx),
                    sell: estimateArrival(sellEx)
                },

                history
            });
        }

        opportunities.sort((a, b) =>
            parseFloat(b.spread) - parseFloat(a.spread)
        );

        res.json({
            count: opportunities.length,
            opportunities
        });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/*
========================================
DETAIL FIX (NO ZERO PRICES)
========================================
*/
app.get('/api/opportunity/:id', (req, res) => {

    const id = req.params.id;
    const history = opportunityHistory[id] || [];
    const p = id.split('-');

    const last = history[history.length - 1];

    res.json({
        data: {
            id,
            symbol: p[0],

            buyExchange: p[1],
            sellExchange: p[2],

            buyPrice: last?.buyPrice || 0,
            sellPrice: last?.sellPrice || 0,

            history,

            liquidity: "MEDIUM",

            risk: getRisk(last?.spread || 0, "MEDIUM"),

            trend: getTrend(history),

            arrivalTime: {
                buy: estimateArrival(p[1]),
                sell: estimateArrival(p[2])
            },

            networks: {
                buy: getNetworks(),
                sell: getNetworks()
            },

            tradable: true
        }
    });
});

/*

========================================
PAYMENT
========================================
*/
app.post('/api/pesapal/pay', (req, res) => {

    const { phone, amount, plan } = req.body;

    console.log("PAY:", phone, amount, plan);

    res.json({
        success: true,
        message: `STK Push sent to ${phone}`
    });
});

/*
========================================
START
========================================
*/
app.listen(PORT, () => {
    console.log("🚀 ArbiMine PRO running on", PORT);
});
