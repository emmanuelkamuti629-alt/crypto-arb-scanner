const axios = require('axios');

async function registerIpn() {
  try {
    console.log('Getting token...');
    
    const tokenRes = await axios.post('https://pay.pesapal.com/v3/api/Auth/RequestToken', {
      consumer_key: 'h4vWflHsjjFP2buMPuLag7Y/sJ H7TDo',
      consumer_secret: 'PTgOVOzjgqO/13oVf8INiBBzypl='
    });
    
    const token = tokenRes.data.token;
    console.log('Token OK');
    
    const ipnRes = await axios.post('https://pay.pesapal.com/v3/api/URLSetup/RegisterIPN', {
      url: 'https://crypto-arb-scanner-q6x2.onrender.com/api/pesapal/callback',
      ipn_notification_type: 'GET'
    }, {
      headers: { 
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('SUCCESS! IPN ID:', ipnRes.data);
    
  } catch (err) {
    console.log('ERROR:', err.response ? err.response.data : err.message);
  }
}

registerIpn();
