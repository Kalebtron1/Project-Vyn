const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';
const endpoints = [
  { path: '/api/health', expectedStatus: 'ok' },
  { path: '/api/readiness', expectedStatus: 'ready' }
];

async function checkEndpoint(endpoint) {
  const url = `${baseUrl}${endpoint.path}`;
  const res = await fetch(url, { method: 'GET' });

  if (res.status !== 200) {
    throw new Error(`Expected 200 from ${endpoint.path}, got ${res.status}`);
  }

  const body = await res.json();
  if (body.status !== endpoint.expectedStatus) {
    throw new Error(`Unexpected status for ${endpoint.path}: ${String(body.status)}`);
  }
  if (body.endpoint !== endpoint.path) {
    throw new Error(`Unexpected endpoint value for ${endpoint.path}: ${String(body.endpoint)}`);
  }
  if (!body.timestamp || Number.isNaN(Date.parse(body.timestamp))) {
    throw new Error(`Missing or invalid timestamp from ${endpoint.path}`);
  }

  console.log(`✔ ${endpoint.path} returned status=200, status=${body.status}`);
}

(async () => {
  console.log(`Checking health endpoints at ${baseUrl}`);
  for (const endpoint of endpoints) {
    await checkEndpoint(endpoint);
  }
  console.log('All health endpoints are reachable and returned the expected payload.');
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
