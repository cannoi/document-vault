const assert = require('assert');
const http = require('http');

const PORT = process.env.PORT || 8080;

console.log('Running basic readiness test...');

setTimeout(() => {
  http.get(`http://127.0.0.1:${PORT}/health`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        assert.strictEqual(json.status, 'ok');
        console.log('Test passed successfully.');
        process.exit(0);
      } catch (e) {
        console.error('Test failed parsing response:', e);
        process.exit(1);
      }
    });
  }).on('error', (err) => {
    console.error('Test failed connecting to server:', err.message);
    process.exit(1);
  });
}, 1000);
