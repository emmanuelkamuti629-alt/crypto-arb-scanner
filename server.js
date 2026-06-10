const express = require('express');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const users = {};
const sessions = {};

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 10 EXCHANGES: MEXC, KuCoin, BitMart, Bitget, LBank, CoinEx, Gate.io, OKX, Bybit, HTX
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
  htx: 'https://api.huobi.pro/market/tickers'
};

const MIN_PROFIT = 0.0;
const MAX_PROFIT = 100.0;
const MAX_CHECKS = 50;
const statusCache = {};
const CACHE_TIME = 5 * 60 * 1000;

// AUTH ROUTES
app.post('/api/register', (req, res) => {
  const { username, email, mpesa, password } = req.body;
  if (!username ||!email ||!mpesa ||!password) return res.status(400).json({ error: 'All fields required' });
  if (users[username]) return res.status(409).json({ error: 'Username already exists. Try to login.' });
  if (Object.values(users).find(u => u.email === email)) return res.status(409).json({ error: 'Email already exists. Try to login.' });
  if (Object.values(users).find(u => u.mpesa === mpesa)) return res.status(409).json({ error: 'M-Pesa number already exists. Try to login.' });
  users[username] = { email, mpesa, passwordHash: hashPassword(password) };
  const token = generateToken();
  sessions[token] = username;
  res.json({ success: true, token, username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username ||!password) return res.status(400).json({ error: 'Username and password required' });
  const user = users[username];
  if (!user || user.passwordHash!== hashPassword(password)) return res.status(401).json({ error: 'Invalid username or password' });
  const token = generateToken();
  sessions[token] = username;
  res.json({ success: true, token, username });
});

app.get('/api/me', (req, res) => {
  const token = req.headers['authorization'];
  const username = sessions[token];
  if (!username) return res.status(401).json({ error: 'Not logged in' });
  res.json({ username, email: users[username].email });
});

// SCANNER
async function safeGet(url, name) {
  try {
    const res = await axios.get(url, { timeout: 10000 });
    return res.data;
  } catch (e) {
    console.log(`${name} FAILED:`, e.message);
    return null;
  }
}

async function checkWithdrawDeposit(exchange, symbol) {
  const cacheKey = `${exchange}-${symbol}`;
  if (statusCache[cacheKey] && Date.now() - statusCache[cacheKey].time < CACHE_TIME) {
    return statusCache[cacheKey].data;
  }
  let result = { canWithdraw: null, canDeposit: null, networks: [] };
  try {
    if (exchange === 'kucoin') {
      const data = await safeGet(`https://api.kucoin.com/api/v1/currencies/${symbol}`, 'KuCoin');
      if (data?.data) {
        result.canWithdraw = data.data.isWithdrawEnabled;
        result.canDeposit = data.data.isDepositEnabled;
        result.networks = (data.data.chains || []).map(c => ({
          name: c.chainName,
          deposit: c.isDepositEnabled,
          withdraw: c.isWithdrawEnabled
        }));
      }
    }
    else if (exchange === 'mexc') {
      const data = await safeGet('https://api.mexc.com/api/v3/capital/config/getall', 'MEXC');
      const coin = data?.find(c => c.coin === symbol);
      if (coin) {
        result.networks = (coin.networkList || []).map(n => ({
          name: n.network,
          deposit: n.depositEnable,
          withdraw: n.withdrawEnable
        }));
        result.canWithdraw = result.networks.some(n => n.withdraw);
        result.canDeposit = result.networks.some(n => n.deposit);
      }
    }
    else if (exchange === 'bitmart') {
      const data = await safeGet('https://api-cloud.bitmart.com/account/v1/currencies', 'BitMart');
      const coin = data?.data?.currencies?.find(c => c.currency === symbol);
      if (coin) {
        result.canWithdraw = coin.withdraw_enabled;
        result.canDeposit = coin.deposit_enabled;
        result.networks = [{ name: 'MAIN', deposit: coin.deposit_enabled, withdraw: coin.withdraw_enabled }];
      }
    }
    else if (exchange === 'bitget') {
      const data = await safeGet('https://api.bitget.com/api/spot/v1/public/currencies', 'Bitget');
      const coin = data?.data?.find(c => c.coinName === symbol);
      if (coin) {
        result.canWithdraw = coin.canWithdraw === 'true';
        result.canDeposit = coin.canDeposit === 'true';
        result.networks = (coin.chains || []).map(c => ({
          name: c.chain,
          deposit: c.rechargeable === 'true',
          withdraw: c.withdrawable === 'true'
        }));
      }
    }
    else if (exchange === 'gateio') {
      const data = await safeGet(`https://api.gateio.ws/api/v4/wallet/currency_chains?currency=${symbol}`, 'Gate.io');
      if (data?.length) {
        result.networks = data.map(c => ({
          name: c.chain,
          deposit: c.deposit_disabled === 0,
          withdraw: c.withdraw_disabled === 0
        }));
        result.canWithdraw = result.networks.some(n => n.withdraw);
        result.canDeposit = result.networks.some(n => n.deposit);
      }
    }
    else if (exchange === 'coinex') {
      const data = await safeGet('https://api.coinex.com/v1/common/asset/config', 'CoinEx');
      const coin = data?.data?.[symbol];
      if (coin) {
        result.canWithdraw = coin.can_withdraw;
        result.canDeposit = coin.can_deposit;
        result.networks = (coin.chains || []).map(c => ({
          name: c.chain,
          deposit: c.can_deposit,
          withdraw: c.can_withdraw
        }));
      }
    }
    else if (exchange === 'okx') {
      const data = await safeGet(`https://www.okx.com/api/v5/asset/currencies?ccy=${symbol}`, 'OKX');
      const coin = data?.data?.[0];
      if (coin) {
        result.canWithdraw = coin.canWd === '1';
        result.canDeposit = coin.canDep === '1';
        result.networks = (coin.chains || []).map(c => ({
          name: c.chain,
          deposit: c.canDep === '1',
          withdraw: c.canWd === '1'
        }));
      }
    }
    // LBank, Bybit, HTX: No public deposit/withdraw API
  } catch (e) {}
  statusCache[cacheKey] = { data: result, time: Date.now() };
  return result;
}

// Get max tradable amount from order book before 1% slippage
async function getMaxTradeable(exchange, symbol, side, price) {
  try {
    let url = '';
    if (exchange === 'mexc') url = `https://api.mexc.com/api/v3/depth?symbol=${symbol}USDT&limit=50`;
    else if (exchange === 'kucoin') url = `https://api.kucoin.com/api/v1/market/orderbook/level2_50?symbol=${symbol}-USDT`;
    else if (exchange === 'bitget') url = `https://api.bitget.com/api/spot/v1/market/depth?symbol=${symbol}USDT&limit=50`;
    else if (exchange === 'gateio') url = `https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${symbol}_USDT&limit=50`;
    else if (exchange === 'okx') url = `https://www.okx.com/api/v5/market/books?instId=${symbol}-USDT&sz=50`;
    else if (exchange === 'bybit') url = `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${symbol}USDT&limit=50`;
    else return 0;

    const data = await safeGet(url, `${exchange} depth`);
    if (!data) return 0;

    let orders = [];
    if (exchange === 'mexc') orders = side === 'buy'? data.asks : data.bids;
    else if (exchange === 'kucoin') orders = side === 'buy'? data.data?.asks : data.data?.bids;
    else if (exchange === 'bitget') orders = side === 'buy'? data.data?.asks : data.data?.bids;
    else if (exchange === 'gateio') orders = side === 'buy'? data.asks : data.bids;
    else if (exchange === 'okx') orders = side === 'buy'? data.data?.[0]?.asks : data.data?.[0]?.bids;
    else if (exchange === 'bybit') orders = side === 'buy'? data.result?.a : data.result?.b;

    if (!orders ||!orders.length) return 0;

    let totalUsdt = 0;
    const maxSlippage = 0.01; // 1% slippage cap

    for (const order of orders) {
      const orderPrice = parseFloat(order[0]);
      const orderSize = parseFloat(order[1]);
      const orderUsdt = orderPrice * orderSize;
      const slippage = Math.abs(orderPrice - price) / price;

      if (slippage > maxSlippage) break;
      totalUsdt += orderUsdt;
      if (totalUsdt > 50000) break; // Cap at $50k to save API time
    }
    return Math.floor(totalUsdt);
  } catch (e) {
    return 0;
  }
}

function extractSymbolAndData(symbol, exchange, tickerData) {
  let sym = null, price = 0, volume = 0;

  if (exchange === 'mexc' && symbol.endsWith('USDT')) {
    sym = symbol.replace('USDT', '');
    price = parseFloat(tickerData.lastPrice);
    volume = parseFloat(tickerData.quoteVolume);
  }
  if (exchange === 'kucoin' && symbol.endsWith('-USDT')) {
    sym = symbol.replace('-USDT', '');
    price = parseFloat(tickerData.last);
    volume = parseFloat(tickerData.volValue);
  }
  if (exchange === 'bitmart' && symbol.endsWith('_USDT')) {
    sym = symbol.replace('_USDT', '');
    price = parseFloat(tickerData.last_price);
    volume = parseFloat(tickerData.quote_volume);
  }
  if (exchange === 'bitget' && symbol.endsWith('USDT')) {
    sym = symbol.replace('USDT', '');
    price = parseFloat(tickerData.close);
    volume = parseFloat(tickerData.usdtVol);
  }
  if (exchange === 'lbank' && symbol.endsWith('_usdt')) {
    sym = symbol.replace('_usdt', '').toUpperCase();
    price = parseFloat(tickerData.ticker.latest);
    volume = parseFloat(tickerData.ticker.turnover);
  }
  if (exchange === 'coinex' && symbol.endsWith('USDT')) {
    sym = symbol.replace('USDT', '');
    price = parseFloat(tickerData.last);
    volume = parseFloat(tickerData.vol) * price;
  }
  if (exchange === 'gateio' && symbol.endsWith('_USDT')) {
    sym = symbol.replace('_USDT', '');
    price = parseFloat(tickerData.last);
    volume = parseFloat(tickerData.quote_volume);
  }
  if (exchange === 'okx' && symbol.endsWith('-USDT')) {
    sym = symbol.replace('-USDT', '');
    price = parseFloat(tickerData.last);
    volume = parseFloat(tickerData.volCcy24h) * price;
  }
  if (exchange === 'bybit' && symbol.endsWith('USDT')) {
    sym = symbol.replace('USDT', '');
    price = parseFloat(tickerData.lastPrice);
    volume = parseFloat(tickerData.turnover24h);
  }
  if (exchange === 'htx' && symbol.endsWith('usdt')) {
    sym = symbol.replace('usdt', '').toUpperCase();
    price = parseFloat(tickerData.close);
    volume = parseFloat(tickerData.vol) * price;
  }

  return sym? { symbol: sym, price, volume } : null;
}

app.get('/api/arbs', async (req, res) => {
  try {
    const startTime = Date.now();
    const opportunities = [];
    const results = await Promise.all(Object.entries(EXCHANGES).map(([name, url]) => safeGet(url, name)));

    const allData = {};
    Object.keys(EXCHANGES).forEach(ex => allData[ex] = {});

    results.forEach((data, idx) => {
      const ex = Object.keys(EXCHANGES)[idx];
      if (!data) return;

      let tickers = [];
      if (ex === 'mexc') tickers = data;
      else if (ex === 'kucoin') tickers = data.data?.ticker || [];
      else if (ex === 'bitmart') tickers = data.data?.tickers || [];
      else if (ex === 'bitget') tickers = data.data || [];
      else if (ex === 'lbank') tickers = data;
      else if (ex === 'coinex') tickers = Object.entries(data.data?.ticker || {}).map(([k,v]) => ({symbol: k,...v}));
      else if (ex === 'gateio') tickers = data;
      else if (ex === 'okx') tickers = data.data || [];
      else if (ex === 'bybit') tickers = data.result?.list || [];
      else if (ex === 'htx') tickers = data.data || [];

      tickers.forEach(t => {
        const symKey = ex === 'coinex'? t.symbol : (t.symbol || t.currency_pair || t.instId || t.symbol);
        const d = extractSymbolAndData(symKey, ex, t);
        if (d) allData[ex][d.symbol] = { price: d.price, volume: d.volume };
      });
    });

    const allSymbols = new Set();
    Object.values(allData).forEach(ex => Object.keys(ex).forEach(s => allSymbols.add(s)));

    for (const symbol of allSymbols) {
      const prices = {};
      Object.keys(allData).forEach(ex => {
        if (allData[ex][symbol]?.price) prices[ex] = allData[ex][symbol];
      });

      const validPrices = Object.entries(prices).filter(([_, d]) => d.price > 0 && d.price < 100000);
      if (validPrices.length < 2) continue;

      const sorted = validPrices.sort((a, b) => a[1].price - b[1].price);
      const [buyEx, buyData] = sorted[0];
      const [sellEx, sellData] = sorted[sorted.length - 1];

      const profitPct = ((sellData.price * 0.999 - buyData.price * 1.001) / (buyData.price * 1.001)) * 100;

      if (profitPct > MIN_PROFIT && profitPct <= MAX_PROFIT) {
        opportunities.push({
          symbol,
          buy_at: buyEx,
          buy_price: buyData.price,
          buy_liquidity: buyData.volume,
          sell_at: sellEx,
          sell_price: sellData.price,
          sell_liquidity: sellData.volume,
          spread_usd: (sellData.price - buyData.price).toFixed(8),
          profit_pct: parseFloat(profitPct.toFixed(3)),
          exchanges_found: validPrices.length
        });
      }
    }

    opportunities.sort((a, b) => b.profit_pct - a.profit_pct);
    const topCandidates = opportunities.slice(0, MAX_CHECKS);
    const verified = [];

    for (const opp of topCandidates) {
      const [buyStatus, sellStatus, maxBuy, maxSell] = await Promise.all([
        checkWithdrawDeposit(opp.buy_at, opp.symbol),
        checkWithdrawDeposit(opp.sell_at, opp.symbol),
        getMaxTradeable(opp.buy_at, opp.symbol, 'buy', opp.buy_price),
        getMaxTradeable(opp.sell_at, opp.symbol, 'sell', opp.sell_price)
      ]);

      if ((buyStatus.canWithdraw!== false) && (sellStatus.canDeposit!== false)) {
        verified.push({
      ...opp,
          buy_withdraw_ok: buyStatus.canWithdraw,
          sell_deposit_ok: sellStatus.canDeposit,
          buy_networks: buyStatus.networks,
          sell_networks: sellStatus.networks,
          max_buy_usdt: maxBuy,
          max_sell_usdt: maxSell,
          verified: buyStatus.canWithdraw === true && sellStatus.canDeposit === true,
          status_unknown: buyStatus.canWithdraw === null || sellStatus.canDeposit === null
        });
      }
    }

    const scanTime = ((Date.now() - startTime) / 1000).toFixed(1);
    res.json({
      count: verified.length,
      scan_time_sec: scanTime,
      min_profit: `${MIN_PROFIT}%`,
      max_profit: `${MAX_PROFIT}%`,
      total_pairs_checked: allSymbols.size,
      exchanges_scanned: Object.keys(EXCHANGES),
      opportunities: verified,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Scan failed', details: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 ArbiMine running on port ${PORT}`);
});
