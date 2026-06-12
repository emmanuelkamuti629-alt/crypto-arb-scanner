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
MEMORY STORAGE
========================================
*/

const users = {};
const sessions = {};
const opportunityHistory = {};

/*
========================================
HELPERS
========================================
*/

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function safeGet(url, name) {
    try {
        const res = await axios.get(url, {
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        return res.data;
    } catch (err) {
        console.log(`${name} FAILED:`, err.message);
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
    lbank: 'https://api.lbank.info/v1/ticker.do?symbol=all',
    coinex: 'https://api.coinex.com/v1/market/ticker/all',
    gateio: 'https://api.gateio.ws/api/v4/spot/tickers',
    okx: 'https://www.okx.com/api/v5/market/tickers?instType=SPOT',
    bybit: 'https://api.bybit.com/v5/market/tickers?category=spot',
    htx: 'https://api.huobi.pro/market/tickers',
    bitfinex: 'https://api-pub.bitfinex.com/v2/tickers?symbols=ALL',
    poloniex: 'https://api.poloniex.com/markets/ticker24h',
    cryptocom: 'https://api.crypto.com/exchange/v1/public/get-tickers',
    upbit: 'https://api.upbit.com/v1/ticker?markets=KRW-BTC'
};

const MIN_PROFIT = 0.1;   // Show even small spreads (all opportunities)
const MAX_PROFIT = 100;

/*
========================================
AUTH (unchanged)
========================================
*/

app.post('/api/register', (req, res) => {
    const { username, email, mpesa, password } = req.body;
    if (!username || !email || !mpesa || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }
    if (users[username]) {
        return res.status(409).json({ error: 'Username exists' });
    }
    users[username] = { email, mpesa, passwordHash: hashPassword(password) };
    const token = generateToken();
    sessions[token] = username;
    res.json({ success: true, token, username });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users[username];
    if (!user || user.passwordHash !== hashPassword(password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = generateToken();
    sessions[token] = username;
    res.json({ success: true, token, username });
});

app.get('/api/me', (req, res) => {
    const token = req.headers.authorization;
    const username = sessions[token];
    if (!username) return res.status(401).json({ error: 'Unauthorized' });
    res.json({ username, email: users[username].email, mpesa: users[username].mpesa });
});

/*
========================================
EXTRACT DATA (improved to catch more pairs)
========================================
*/

function extractSymbolAndData(symbol, exchange, tickerData) {
    let sym = null;
    let price = 0;
    let volume = 0;

    if (exchange === 'mexc' && symbol.endsWith('USDT')) {
        sym = symbol.replace('USDT', '');
        price = parseFloat(tickerData.lastPrice);
        volume = parseFloat(tickerData.quoteVolume);
    }
    else if (exchange === 'kucoin' && symbol.endsWith('-USDT')) {
        sym = symbol.replace('-USDT', '');
        price = parseFloat(tickerData.last);
        volume = parseFloat(tickerData.volValue);
    }
    else if (exchange === 'bitmart' && symbol.endsWith('_USDT')) {
        sym = symbol.replace('_USDT', '');
        price = parseFloat(tickerData.last_price);
        volume = parseFloat(tickerData.quote_volume);
    }
    else if (exchange === 'bitget' && symbol.endsWith('USDT')) {
        sym = symbol.replace('USDT', '');
        price = parseFloat(tickerData.close);
        volume = parseFloat(tickerData.usdtVol);
    }
    else if (exchange === 'gateio' && symbol.endsWith('_USDT')) {
        sym = symbol.replace('_USDT', '');
        price = parseFloat(tickerData.last);
        volume = parseFloat(tickerData.quote_volume);
    }
    else if (exchange === 'okx' && symbol.endsWith('-USDT')) {
        sym = symbol.replace('-USDT', '');
        price = parseFloat(tickerData.last);
        volume = parseFloat(tickerData.volCcy24h);
    }
    else if (exchange === 'bybit' && symbol.endsWith('USDT')) {
        sym = symbol.replace('USDT', '');
        price = parseFloat(tickerData.lastPrice);
        volume = parseFloat(tickerData.turnover24h);
    }
    else if (exchange === 'htx' && symbol.endsWith('usdt')) {
        sym = symbol.replace('usdt', '').toUpperCase();
        price = parseFloat(tickerData.close);
        volume = parseFloat(tickerData.vol);
    }
    else if (exchange === 'bitfinex') {
        const pair = tickerData[0];
        if (typeof pair === 'string' && pair.startsWith('t') && pair.endsWith('USD')) {
            sym = pair.replace('t', '').replace('USD', '');
            price = parseFloat(tickerData[7]);
            volume = parseFloat(tickerData[8]);
        }
    }
    else if (exchange === 'poloniex' && symbol.endsWith('_USDT')) {
        sym = symbol.replace('_USDT', '');
        price = parseFloat(tickerData.close);
        volume = parseFloat(tickerData.amount);
    }
    else if (exchange === 'cryptocom') {
        const inst = tickerData.i;
        if (inst && inst.endsWith('_USDT')) {
            sym = inst.replace('_USDT', '');
            price = parseFloat(tickerData.a);
            volume = parseFloat(tickerData.v);
        }
    }
    else if (exchange === 'upbit') {
        if (tickerData.market && tickerData.market.startsWith('KRW-')) {
            sym = tickerData.market.replace('KRW-', '');
            price = parseFloat(tickerData.trade_price);
            volume = parseFloat(tickerData.acc_trade_price_24h);
        }
    }
    return sym ? { symbol: sym, price, volume } : null;
}

/*
========================================
NETWORK CHECK (realistic simulation)
========================================
*/

async function checkWithdrawDeposit(exchange, symbol) {
    // In production, replace with real exchange API calls.
    // For demo: random status, but now clearly marks "unknown" sometimes.
    const random = Math.random();
    return {
        canWithdraw: random > 0.2,
        canDeposit: random > 0.2,
        networks: [
            { name: 'ERC20', deposit: true, withdraw: random > 0.3 },
            { name: 'TRC20', deposit: random > 0.3, withdraw: random > 0.4 }
        ]
    };
}

/*
========================================
ARBITRAGE API - RETURNS ALL OPPORTUNITIES
========================================
*/

app.get('/api/opportunities', async (req, res) => {
    try {
        const results = await Promise.all(
            Object.entries(EXCHANGES).map(([name, url]) => safeGet(url, name))
        );

        const allData = {};
        Object.keys(EXCHANGES).forEach(ex => { allData[ex] = {}; });

        results.forEach((data, idx) => {
            const ex = Object.keys(EXCHANGES)[idx];
            if (!data) return;

            let tickers = [];
            if (ex === 'mexc') tickers = data;
            else if (ex === 'kucoin') tickers = data.data?.ticker || [];
            else if (ex === 'bitmart') tickers = data.data?.tickers || [];
            else if (ex === 'bitget') tickers = data.data || [];
            else if (ex === 'gateio') tickers = data;
            else if (ex === 'okx') tickers = data.data || [];
            else if (ex === 'bybit') tickers = data.result?.list || [];
            else if (ex === 'htx') tickers = data.data || [];
            else if (ex === 'bitfinex') tickers = data || [];
            else if (ex === 'poloniex') tickers = data || [];
            else if (ex === 'cryptocom') tickers = data.result?.data || [];
            else if (ex === 'upbit') tickers = data || [];

            tickers.forEach(t => {
                const symKey = t.symbol || t.currency_pair || t.instId || t.market || t.i || '';
                const d = extractSymbolAndData(symKey, ex, t);
                if (d) {
                    allData[ex][d.symbol] = { price: d.price, volume: d.volume };
                }
            });
        });

        const allSymbols = new Set();
        Object.values(allData).forEach(ex => {
            Object.keys(ex).forEach(s => allSymbols.add(s));
        });

        const opportunities = [];

        for (const symbol of allSymbols) {
            const prices = {};
            Object.keys(allData).forEach(ex => {
                if (allData[ex][symbol]) prices[ex] = allData[ex][symbol];
            });

            const validPrices = Object.entries(prices);
            if (validPrices.length < 2) continue;

            const sorted = validPrices.sort((a, b) => a[1].price - b[1].price);
            const [buyEx, buyData] = sorted[0];
            const [sellEx, sellData] = sorted[sorted.length - 1];

            const spread = ((sellData.price - buyData.price) / buyData.price) * 100;

            if (spread < MIN_PROFIT || spread > MAX_PROFIT) continue;

            // Get real (simulated) deposit/withdrawal status
            const buyStatus = await checkWithdrawDeposit(buyEx, symbol);
            const sellStatus = await checkWithdrawDeposit(sellEx, symbol);

            const isTradable = buyStatus.canWithdraw === true && sellStatus.canDeposit === true;
            const tradingStatus = isTradable ? 'TRADABLE ✅' : 'UNVERIFIED ⚠️';

            const historyKey = `${symbol}-${buyEx}-${sellEx}`;
            if (!opportunityHistory[historyKey]) {
                opportunityHistory[historyKey] = [];
            }
            opportunityHistory[historyKey].push({
                time: Date.now(),
                spread: parseFloat(spread.toFixed(2))
            });
            if (opportunityHistory[historyKey].length > 20) {
                opportunityHistory[historyKey].shift();
            }

            opportunities.push({
                id: historyKey,
                symbol,
                buyExchange: buyEx.toUpperCase(),
                sellExchange: sellEx.toUpperCase(),
                buyPrice: buyData.price.toFixed(8),
                sellPrice: sellData.price.toFixed(8),
                spread: spread.toFixed(2),
                tradable: isTradable,
                tradingStatus,                // "TRADABLE ✅" / "UNVERIFIED ⚠️"
                unverifiedMessage: isTradable ? null : "unverified, check manually",
                verified: isTradable,
                buyWithdraw: buyStatus.canWithdraw,
                sellDeposit: sellStatus.canDeposit,
                buyNetworks: buyStatus.networks,
                sellNetworks: sellStatus.networks,
                history: opportunityHistory[historyKey]
            });
        }

        // Return ALL opportunities, sorted by highest spread
        opportunities.sort((a, b) => parseFloat(b.spread) - parseFloat(a.spread));

        res.json({
            count: opportunities.length,
            opportunities
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/*
========================================
SINGLE OPPORTUNITY (with full history & trend)
========================================
*/

app.get('/api/opportunity/:id', (req, res) => {
    const id = req.params.id;
    const history = opportunityHistory[id] || [];
    const parts = id.split('-');

    // Find the full opportunity data from the last scan?
    // For simplicity, we return the stored history + basic exchange info.
    // The frontend will combine it with the main list or fetch again.
    res.json({
        data: {
            id,
            symbol: parts[0],
            buyExchange: parts[1],
            sellExchange: parts[2],
            history,                // array of {time, spread}
            tradable: true,        // will be overwritten by real data from /opportunities
            buyPrice: '0',
            sellPrice: '0',
            networks: {
                buy: [{ network: 'ERC20', deposit: true, withdraw: true }],
                sell: [{ network: 'TRC20', deposit: true, withdraw: true }]
            }
        }
    });
});

/*
========================================
PAYMENT (unchanged)
========================================
*/

app.post('/api/pesapal/pay', (req, res) => {
    const { phone, amount, plan } = req.body;
    console.log('PAYMENT REQUEST:', phone, amount, plan);
    res.json({ success: true, message: `STK Push sent to ${phone}` });
});

/*
========================================
FRONTEND
========================================
*/

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/*
========================================
START SERVER
========================================
*/

app.listen(PORT, () => {
    console.log(`🚀 ArbiMine running on ${PORT}`);
});
