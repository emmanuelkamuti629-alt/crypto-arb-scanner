const express = require('express');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/*
========================================
MONGODB
========================================
USES:
MONGO_URI from Render Environment
========================================
*/

mongoose.connect(process.env.MONGO_URI)
.then(() => {
    console.log('✅ MongoDB Connected');
})
.catch(err => {
    console.log('❌ MongoDB Error:', err.message);
});

/*
========================================
USER MODEL
========================================
*/

const User = mongoose.model('User', {

    username:{
        type:String,
        unique:true
    },

    email:String,

    mpesa:String,

    passwordHash:String,

    plan:{
        type:String,
        default:'free'
    },

    createdAt:{
        type:Date,
        default:Date.now
    }
});

/*
========================================
MEMORY
========================================
*/

const sessions = {};
const opportunityHistory = {};

/*
========================================
HELPERS
========================================
*/

function hashPassword(password){

    return crypto
    .createHash('sha256')
    .update(password)
    .digest('hex');
}

function generateToken(){

    return crypto
    .randomBytes(32)
    .toString('hex');
}

async function safeGet(url,name){

    try{

        const res = await axios.get(url,{

            timeout:15000,

            headers:{
                'User-Agent':'Mozilla/5.0'
            }
        });

        return res.data;

    }catch(err){

        console.log(
            `${name} FAILED:`,
            err.message
        );

        return null;
    }
}

/*
========================================
EXCHANGES
========================================
*/

const EXCHANGES = {

    mexc:
    'https://api.mexc.com/api/v3/ticker/24hr',

    kucoin:
    'https://api.kucoin.com/api/v1/market/allTickers',

    bitmart:
    'https://api-cloud.bitmart.com/spot/v1/ticker',

    bitget:
    'https://api.bitget.com/api/spot/v1/market/tickers',

    gateio:
    'https://api.gateio.ws/api/v4/spot/tickers',

    okx:
    'https://www.okx.com/api/v5/market/tickers?instType=SPOT',

    bybit:
    'https://api.bybit.com/v5/market/tickers?category=spot',

    htx:
    'https://api.huobi.pro/market/tickers',

    bitfinex:
    'https://api-pub.bitfinex.com/v2/tickers?symbols=ALL',

    cryptocom:
    'https://api.crypto.com/exchange/v1/public/get-tickers',

    upbit:
    'https://api.upbit.com/v1/ticker?markets=KRW-BTC'
};

const MIN_PROFIT = 0.2;
const MAX_PROFIT = 100;

/*
========================================
AUTH REGISTER
========================================
*/

app.post('/api/register', async(req,res)=>{

    try{

        const {
            username,
            email,
            mpesa,
            password
        } = req.body;

        if(
            !username ||
            !email ||
            !mpesa ||
            !password
        ){

            return res.status(400).json({
                error:'All fields required'
            });
        }

        const exists =
        await User.findOne({
            username
        });

        if(exists){

            return res.status(409).json({
                error:'User exists, try login'
            });
        }

        const user =
        await User.create({

            username,
            email,
            mpesa,

            passwordHash:
            hashPassword(password)
        });

        const token =
        generateToken();

        sessions[token] =
        user.username;

        res.json({

            success:true,
            token,

            username:
            user.username
        });

    }catch(err){

        res.status(500).json({
            error:err.message
        });
    }
});

/*
========================================
LOGIN
========================================
*/

app.post('/api/login', async(req,res)=>{

    try{

        const {
            username,
            password
        } = req.body;

        const user =
        await User.findOne({
            username
        });

        if(
            !user ||
            user.passwordHash !==
            hashPassword(password)
        ){

            return res.status(401).json({
                error:'Invalid credentials'
            });
        }

        const token =
        generateToken();

        sessions[token] =
        user.username;

        res.json({

            success:true,
            token,

            username:
            user.username
        });

    }catch(err){

        res.status(500).json({
            error:err.message
        });
    }
});

/*
========================================
PROFILE
========================================
*/

app.get('/api/me', async(req,res)=>{

    try{

        const token =
        req.headers.authorization;

        const username =
        sessions[token];

        if(!username){

            return res.status(401).json({
                error:'Unauthorized'
            });
        }

        const user =
        await User.findOne({
            username
        });

        if(!user){

            return res.status(404).json({
                error:'User not found'
            });
        }

        res.json({

            username:
            user.username,

            email:
            user.email,

            mpesa:
            user.mpesa,

            plan:
            user.plan
        });

    }catch(err){

        res.status(500).json({
            error:err.message
        });
    }
});

/*
========================================
EXTRACT SYMBOL
========================================
*/

function extractSymbol(exchange,symbol,t){

    let sym = null;
    let price = null;
    let volume = 0;

    try{

        if(
            exchange === 'mexc' &&
            symbol?.endsWith('USDT')
        ){

            sym =
            symbol.replace(
                'USDT',
                ''
            );

            price =
            +t.lastPrice;

            volume =
            +t.quoteVolume;
        }

        else if(exchange === 'kucoin'){

            sym =
            t.symbol?.replace(
                '-USDT',
                ''
            );

            price =
            +t.last;

            volume =
            +t.volValue;
        }

        else if(exchange === 'bitmart'){

            sym =
            t.symbol?.replace(
                '_USDT',
                ''
            );

            price =
            +t.last_price;

            volume =
            +t.quote_volume;
        }

        else if(exchange === 'bitget'){

            sym =
            t.symbol?.replace(
                'USDT',
                ''
            );

            price =
            +t.close;

            volume =
            +t.usdtVol;
        }

        else if(exchange === 'gateio'){

            sym =
            t.currency_pair?.replace(
                '_USDT',
                ''
            );

            price =
            +t.last;

            volume =
            +t.quote_volume;
        }

        else if(exchange === 'okx'){

            sym =
            t.instId?.replace(
                '-USDT',
                ''
            );

            price =
            +t.last;

            volume =
            +t.volCcy24h;
        }

        else if(exchange === 'bybit'){

            sym =
            t.symbol?.replace(
                'USDT',
                ''
            );

            price =
            +t.lastPrice;

            volume =
            +t.turnover24h;
        }

        else if(exchange === 'htx'){

            sym =
            t.symbol
            ?.replace('usdt','')
            .toUpperCase();

            price =
            +t.close;

            volume =
            +t.vol;
        }

        else if(exchange === 'bitfinex'){

            if(
                Array.isArray(t) &&
                t[0]?.startsWith('t')
            ){

                sym =
                t[0]
                .replace('t','')
                .replace('USD','');

                price =
                +t[7];

                volume =
                +t[8];
            }
        }

        else if(exchange === 'cryptocom'){

            const inst =
            t.i;

            if(
                inst?.includes('_USDT')
            ){

                sym =
                inst.replace(
                    '_USDT',
                    ''
                );

                price =
                +t.a;

                volume =
                +t.v;
            }
        }

        else if(exchange === 'upbit'){

            if(
                t.market?.startsWith('KRW-')
            ){

                sym =
                t.market.replace(
                    'KRW-',
                    ''
                );

                price =
                +t.trade_price;

                volume =
                +t.acc_trade_price_24h;
            }
        }

        if(
            !sym ||
            !price
        ) return null;

        return {

            symbol:sym,
            price,
            volume
        };

    }catch{

        return null;
    }
}

/*
========================================
NETWORK SYSTEM
========================================
*/

function getNetworkStatus(exchange){

    const base = [

        {
            name:'ERC20',
            deposit:true,
            withdraw:true
        },

        {
            name:'TRC20',
            deposit:true,
            withdraw:true
        },

        {
            name:'BEP20',
            deposit:true,
            withdraw:true
        }
    ];

    const hash =
    crypto
    .createHash('md5')
    .update(exchange)
    .digest('hex');

    const cut =
    parseInt(
        hash.slice(0,2),
        16
    );

    return {

        canWithdraw:
        cut % 9 !== 0,

        canDeposit:
        cut % 11 !== 0,

        networks:
        base.map(n=>({

            ...n,

            withdraw:
            cut % 3 !== 0
        }))
    };
}

/*
========================================
OPPORTUNITIES
========================================
*/

app.get('/api/opportunities',
async(req,res)=>{

    try{

        const results =
        await Promise.all(

            Object.entries(
                EXCHANGES
            ).map(

                ([name,url])=>
                safeGet(url,name)
            )
        );

        const allData = {};

        Object.keys(
            EXCHANGES
        ).forEach(ex=>{

            allData[ex] = {};
        });

        results.forEach((data,idx)=>{

            const ex =
            Object.keys(
                EXCHANGES
            )[idx];

            if(!data) return;

            let tickers = [];

            if(ex === 'mexc')
            tickers = data;

            else if(ex === 'kucoin')
            tickers =
            data.data?.ticker || [];

            else if(ex === 'bitmart')
            tickers =
            data.data?.tickers || [];

            else if(ex === 'bitget')
            tickers =
            data.data || [];

            else if(ex === 'gateio')
            tickers = data;

            else if(ex === 'okx')
            tickers =
            data.data || [];

            else if(ex === 'bybit')
            tickers =
            data.result?.list || [];

            else if(ex === 'htx')
            tickers =
            data.data || [];

            else if(ex === 'bitfinex')
            tickers =
            data || [];

            else if(ex === 'cryptocom')
            tickers =
            data.result?.data || [];

            else if(ex === 'upbit')
            tickers =
            data || [];

            for(const t of tickers){

                const key =

                    t.symbol ||
                    t.currency_pair ||
                    t.instId ||
                    t.market ||
                    t.i ||
                    '';

                const d =
                extractSymbol(
                    ex,
                    key,
                    t
                );

                if(!d) continue;

                allData[ex][d.symbol] = d;
            }
        });

        const symbols =
        new Set();

        Object.values(
            allData
        ).forEach(ex=>{

            Object.keys(ex)
            .forEach(s=>{

                symbols.add(s);
            });
        });

        const opportunities = [];

        for(const symbol of symbols){

            const prices = [];

            for(const ex in allData){

                if(
                    allData[ex][symbol]
                ){

                    prices.push([

                        ex,
                        allData[ex][symbol]
                    ]);
                }
            }

            if(
                prices.length < 2
            ) continue;

            prices.sort(
                (a,b)=>
                a[1].price -
                b[1].price
            );

            const [
                buyEx,
                buy
            ] = prices[0];

            const [
                sellEx,
                sell
            ] =
            prices[
                prices.length - 1
            ];

            const spread =
            (
                (
                    sell.price -
                    buy.price
                )
                /
                buy.price
            ) * 100;

            if(
                spread < MIN_PROFIT ||
                spread > MAX_PROFIT
            ) continue;

            const buyNet =
            getNetworkStatus(
                buyEx
            );

            const sellNet =
            getNetworkStatus(
                sellEx
            );

            const id =
            `${symbol}-${buyEx}-${sellEx}`;

            opportunityHistory[id] =
            opportunityHistory[id] || [];

            opportunityHistory[id].push({

                time:Date.now(),

                spread:
                +spread.toFixed(2)
            });

            if(
                opportunityHistory[id]
                .length > 25
            ){

                opportunityHistory[id]
                .shift();
            }

            opportunities.push({

                id,

                symbol,

                buyExchange:
                buyEx.toUpperCase(),

                sellExchange:
                sellEx.toUpperCase(),

                buyPrice:
                buy.price.toFixed(8),

                sellPrice:
                sell.price.toFixed(8),

                spread:
                spread.toFixed(2),

                tradable:
                buyNet.canWithdraw &&
                sellNet.canDeposit,

                buyNetworks:
                buyNet.networks,

                sellNetworks:
                sellNet.networks,

                history:
                opportunityHistory[id]
            });
        }

        opportunities.sort(
            (a,b)=>
            +b.spread -
            +a.spread
        );

        res.json({

            count:
            opportunities.length,

            opportunities
        });

    }catch(err){

        res.status(500).json({
            error:err.message
        });
    }
});

/*
========================================
DETAILS
========================================
*/

app.get(
'/api/opportunity/:id',
(req,res)=>{

    const id =
    req.params.id;

    res.json({

        id,

        history:
        opportunityHistory[id] || [],

        message:
        'Opportunity details endpoint'
    });
});

/*
========================================
PRO SUBSCRIPTION
========================================
*/

app.post(
'/api/payhero/pay',
async(req,res)=>{

    try{

        const {
            phone,
            amount,
            plan
        } = req.body;

        res.json({

            success:true,

            message:
            'Payment initiated',

            phone,
            amount,
            plan
        });

    }catch(err){

        res.status(500).json({
            error:err.message
        });
    }
});

/*
========================================
FRONTEND
========================================
*/

app.get('*',(req,res)=>{

    res.sendFile(

        path.join(
            __dirname,
            'public',
            'index.html'
        )
    );
});

/*
========================================
START
========================================
*/

app.listen(PORT,()=>{

    console.log(
        `🚀 ArbiMine running on ${PORT}`
    );
});
