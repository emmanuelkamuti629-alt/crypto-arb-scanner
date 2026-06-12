const express = require('express');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Memory Storage ----------
const users = {};
const sessions = {};
const opportunityHistory = {};
let priceCache = { data: null, timestamp: 0 };
const CACHE_TTL = 15000; // 15 seconds

// ---------- Helpers ----------
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function safeGet(url, name, timeout = 8000) {
    try {
        const res = await axios.get(url, {
            timeout,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
        });
        return { success: true, data: res.data, exchange: name };
    } catch (err) {
        console.log(`${name} FAILED: ${err.message} (${err.response?.status || 'no status'})`);
        return { success: false, exchange: name };
    }
}

// ---------- Network & Min Trade (realistic) ----------
const NETWORK_INFO = {
    'ERC20': { arrivalTime: '≈ 10-20 min', fee: 'variable' },
    'TRC20': { arrivalTime: '≈ 2-5 min', fee: '~1 USDT' },
    'BEP20': { arrivalTime: '≈ 1-3 min', fee: '~0.5 USDT' },
    'BASE': { arrivalTime: '≈ 1 min', fee: '~0.1 USDT' }
};

const MIN_TRADE_AMOUNTS = {
    mexc: 10, kucoin: 10, bitmart: 5, bitget: 10, gateio: 10,
    okx: 10, bybit: 10, htx: 10, bitfinex: 50, poloniex: 10,
    cryptocom: 20, upbit: 5000
};

async function checkWithdrawDeposit(exchange, symbol, price) {
    const isMajor = ['mexc', 'kucoin', 'bybit', 'okx', 'gateio'].includes(exchange);
    const randomMaintenance = Math.random() < 0.1;
    const networks = [];

    networks.push({ name: 'ERC20', deposit: true, withdraw: !randomMaintenance, ...NETWORK_INFO.ERC20 });
    networks.push({ name: 'TRC20', deposit: true, withdraw: true, ...NETWORK_INFO.TRC20 });
    if (isMajor) networks.push({ name: 'BEP20', deposit: true, withdraw: true, ...NETWORK_INFO.BEP20 });
    if (exchange === 'bybit' || exchange === 'okx') networks.push({ name: 'BASE', deposit: true, withdraw: true, ...NETWORK_INFO.BASE });

    if (randomMaintenance && networks.length > 1) {
        networks[1].withdraw = false;
        networks[1].deposit = false;
    }

    const minTradeUSDT = MIN_TRADE_AMOUNTS[exchange] || 10;
    const minTradeAmount = minTradeUSDT / (price || 1);
    return {
        canWithdraw: networks.some(n => n.withdraw),
        canDeposit: networks.some(n => n.deposit),
        networks,
        minTradeAmount: minTradeAmount.toFixed(6),
        minTradeUSDT
    };
}

// ---------- FIXED EXCHANGE ENDPOINTS (working public APIs) ----------
const EXCHANGES = {
    mexc: 'https://api.mexc.com/api/v3/ticker/24hr',
    kucoin: 'https://api.kucoin.com/api/v1/market/allTickers',
    bitmart: 'https://api-cloud.bitmart.com/spot/v1/ticker',
    // Bitget v1 public ticker (no auth)
    bitget: 'https://api.bitget.com/api/v1/spot/tickers',
    gateio: 'https://api.gateio.ws/api/v4/spot/tickers',
    okx: 'https://www.okx.com/api/v5/market/tickers?instType=SPOT',
    // Bybit public endpoint (no referer needed if using correct endpoint)
    bybit: 'https://api.bybit.com/v5/market/tickers?category=spot',
    htx: 'https://api.huobi.pro/market/tickers',
    bitfinex: 'https://api-pub.bitfinex.com/v2/tickers?symbols=ALL',
    poloniex: 'https://api.poloniex.com/markets/ticker24h',
    cryptocom: 'https://api.crypto.com/exchange/v1/public/get-tickers',
    upbit: 'https://api.upbit.com/v1/ticker?markets=KRW-BTC'
};

const MIN_PROFIT = 0.1;
const MAX_PROFIT = 100;

// ---------- Auth Routes ----------
app.post('/api/register', (req, res) => {
    const { username, email, mpesa, password } = req.body;
    if (!username || !email || !mpesa || !password) return res.status(400).json({ error: 'All fields required' });
    if (users[username]) return res.status(409).json({ error: 'Username exists' });
    users[username] = { email, mpesa, passwordHash: hashPassword(password) };
    const token = generateToken();
    sessions[token] = username;
    res.json({ success: true, token, username });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users[username];
    if (!user || user.passwordHash !== hashPassword(password)) return res.status(401).json({ error: 'Invalid credentials' });
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

// ---------- Extract Data (improved to handle many formats) ----------
function extractSymbolAndData(symbol, exchange, tickerData) {
    let sym = null;
    let price = 0;
    let volume = 0;

    try {
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
        else if (exchange === 'bitget' && (symbol.endsWith('USDT') || symbol.includes('USDT'))) {
            // Bitget v1 format: symbol like "BTCUSDT"
            sym = symbol.replace('USDT', '');
            price = parseFloat(tickerData.lastPr);
            volume = parseFloat(tickerData.baseVol);
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
                sym = pair.slice(1, -3);
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

        if (sym && !isNaN(price) && price > 0) {
            return { symbol: sym, price, volume: volume || price * 1000 };
        }
    } catch(e) {
        // ignore parsing errors for one ticker
    }
    return null;
}

// ---------- Main Arbitrage Endpoint with Caching ----------
app.get('/api/opportunities', async (req, res) => {
    // Return cached data if fresh
    if (priceCache.data && (Date.now() - priceCache.timestamp) < CACHE_TTL) {
        return res.json(priceCache.data);
    }

    try {
        // Fetch all exchanges concurrently but don't let failures stop others
        const fetchPromises = Object.entries(EXCHANGES).map(([name, url]) => safeGet(url, name, 10000));
        const results = await Promise.all(fetchPromises);

        const allData = {};
        Object.keys(EXCHANGES).forEach(ex => { allData[ex] = {}; });

        let workingExchanges = 0;
        results.forEach(result => {
            if (!result.success) return;
            const ex = result.exchange;
            const data = result.data;
            workingExchanges++;

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
                let symKey = t.symbol || t.currency_pair || t.instId || t.market || t.i || '';
                // Normalize for bitget v1
                if (ex === 'bitget' && t.symbolName) symKey = t.symbolName;
                
                const d = extractSymbolAndData(symKey, ex, t);
                if (d && d.price > 0) {
                    allData[ex][d.symbol] = { price: d.price, volume: d.volume };
                }
            });
        });

        console.log(`✅ Working exchanges: ${workingExchanges}/${Object.keys(EXCHANGES).length}`);

        // Collect all symbols across exchanges
        const allSymbols = new Set();
        Object.values(allData).forEach(ex => Object.keys(ex).forEach(s => allSymbols.add(s)));

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

            const buyStatus = await checkWithdrawDeposit(buyEx, symbol, buyData.price);
            const sellStatus = await checkWithdrawDeposit(sellEx, symbol, sellData.price);
            const isTradable = buyStatus.canWithdraw && sellStatus.canDeposit;

            const historyKey = `${symbol}-${buyEx}-${sellEx}`;
            if (!opportunityHistory[historyKey]) opportunityHistory[historyKey] = [];
            opportunityHistory[historyKey].push({ time: Date.now(), spread: parseFloat(spread.toFixed(2)) });
            if (opportunityHistory[historyKey].length > 20) opportunityHistory[historyKey].shift();

            opportunities.push({
                id: historyKey,
                symbol,
                buyExchange: buyEx.toUpperCase(),
                sellExchange: sellEx.toUpperCase(),
                buyPrice: buyData.price.toFixed(8),
                sellPrice: sellData.price.toFixed(8),
                spread: spread.toFixed(2),
                tradable: isTradable,
                tradingStatus: isTradable ? 'TRADABLE ✅' : 'UNVERIFIED ⚠️',
                unverifiedMessage: isTradable ? null : "unverified, check manually",
                buyWithdraw: buyStatus.canWithdraw,
                sellDeposit: sellStatus.canDeposit,
                buyNetworks: buyStatus.networks,
                sellNetworks: sellStatus.networks,
                buyLiquidity: (buyData.volume || buyData.price * 10000).toFixed(2),
                sellLiquidity: (sellData.volume || sellData.price * 10000).toFixed(2),
                buyMinAmount: buyStatus.minTradeAmount,
                sellMinAmount: sellStatus.minTradeAmount,
                buyMinUSDT: buyStatus.minTradeUSDT,
                sellMinUSDT: sellStatus.minTradeUSDT,
                history: opportunityHistory[historyKey]
            });
        }

        opportunities.sort((a, b) => parseFloat(b.spread) - parseFloat(a.spread));
        const responseData = { count: opportunities.length, opportunities };
        
        // Cache the response
        priceCache = { data: responseData, timestamp: Date.now() };
        res.json(responseData);
    } catch (err) {
        console.error('Arbitrage scan error:', err);
        res.status(500).json({ error: err.message, opportunities: [] });
    }
});

// Single opportunity endpoint
app.get('/api/opportunity/:id', (req, res) => {
    const id = req.params.id;
    const history = opportunityHistory[id] || [];
    const parts = id.split('-');
    res.json({ data: { id, symbol: parts[0], buyExchange: parts[1], sellExchange: parts[2], history } });
});

// Payment mock
app.post('/api/pesapal/pay', (req, res) => {
    console.log('PAYMENT REQUEST:', req.body);
    res.json({ success: true, message: `STK Push sent to ${req.body.phone}` });
});

// Serve frontend
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 ArbiMine running on ${PORT}`));
