import axios from 'axios';
import fs from 'fs';

async function fetchNSEDeals() {
    console.log("Starting fetch...");
    try {
        const _html = await axios.get('https://www.nseindia.com', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });
        const cookies = _html.headers['set-cookie'] ? _html.headers['set-cookie'].map(c => c.split(';')[0]).join('; ') : '';
        
        const end = new Date();
        const start = new Date(end.getTime() - (30 * 24 * 60 * 60 * 1000));
        const fmt = d => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth()+1).padStart(2, '0')}-${d.getFullYear()}`;
        
        const fromDate = fmt(start);
        const toDate = fmt(end);
        
        console.log(`Fetching from ${fromDate} to ${toDate}`);
        
        // NSE handles bulk and block at different API endpoints or via query param?
        // Actually, we can fetch them via standard list.
        const url = `https://www.nseindia.com/api/historical/bulk-deals?symbol=&tradeDate=&from=${fromDate}&to=${toDate}`;
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Cookie': cookies,
                'Referer': 'https://www.nseindia.com/report-detail/display-bulk-and-block-deals',
            }
        });
        
        let data = response.data.data || [];
        fs.writeFileSync('./public/deals.json', JSON.stringify({ deals: data }, null, 2));
        console.log("Success! Data saved.");
    } catch (e) {
        console.error("Error fetching data:", e.response ? e.response.status : e.message);
    }
}
fetchNSEDeals();
