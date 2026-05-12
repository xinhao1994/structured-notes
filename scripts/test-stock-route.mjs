// Tests for /api/stock-profile route — exercises the route handler
// directly with a mocked global fetch, covering:
//   1. Happy path: Yahoo crumb works, returns full data
//   2. Yahoo blocked (401), Finnhub fallback returns data
//   3. Yahoo + Finnhub both blocked → 502
//   4. Name resolution: "NVIDIA" → "NVDA" via search
//   5. HK ticker: "9988" with HK market → adds .HK suffix
//
// Run: node --experimental-strip-types scripts/test-stock-route.mjs
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("./ts-resolver.mjs", import.meta.url);

let pass = 0, fail = 0;
const log = (ok, name, extra = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? "  " + extra : ""}`);
};

/** Builds a NextRequest stand-in with .nextUrl.searchParams. */
function makeReq(symbol, market) {
  const url = new URL(`http://x/api/stock-profile?symbol=${encodeURIComponent(symbol)}&market=${market}`);
  return { nextUrl: { searchParams: url.searchParams } };
}

/**
 * Install a mock global.fetch that routes URLs to predefined responses.
 * Each call records to the `calls` array so tests can assert behaviour.
 */
function installMock(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = typeof url === "string" ? url : url.toString();
    calls.push({ url: u, headers: opts.headers || {} });
    for (const [matcher, response] of routes) {
      const re = typeof matcher === "string" ? new RegExp(matcher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : matcher;
      if (re.test(u)) {
        if (response instanceof Error) throw response;
        if (response.then) return response;
        return new Response(response.body, { status: response.status ?? 200, headers: response.headers ?? {} });
      }
    }
    return new Response("", { status: 404 });
  };
  return calls;
}

const { GET } = await import("../app/api/stock-profile/route.ts");

async function runJson(req) {
  const r = await GET(req);
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { _raw: text }; }
  return { status: r.status, body: j };
}

// ─── TEST 1: Happy path — Yahoo crumb works, returns full data ───
{
  // Reset module-scope cache before the test — re-require would be better
  // but since we're top-level await, we just trust no prior call.
  installMock([
    [/fc\.yahoo\.com/, { body: "ok", status: 200, headers: { "set-cookie": "A1=abc123; Path=/; Domain=yahoo.com" } }],
    [/getcrumb/, { body: "crumb_xyz", status: 200 }],
    [/finance\/search/, { body: JSON.stringify({ quotes: [{ symbol: "NVDA", quoteType: "EQUITY" }] }) }],
    [/quoteSummary/, { body: JSON.stringify({
      quoteSummary: { result: [{
        assetProfile: { sector: "Technology", industry: "Semiconductors", country: "United States", city: "Santa Clara", state: "CA", website: "https://www.nvidia.com", fullTimeEmployees: 29600, longBusinessSummary: "Nvidia designs GPUs." },
        summaryDetail: { marketCap: { raw: 3.4e12 }, currency: "USD", fiftyTwoWeekHigh: { raw: 150 }, fiftyTwoWeekLow: { raw: 70 } },
        price: { regularMarketPrice: { raw: 140 }, currency: "USD", longName: "NVIDIA Corporation", exchangeName: "NMS" },
        defaultKeyStatistics: { forwardPE: { raw: 35 }, pegRatio: { raw: 1.2 }, trailingEps: { raw: 3.5 } },
        financialData: { revenueGrowth: { raw: 0.93 }, earningsGrowth: { raw: 1.5 }, totalCash: { raw: 4e10 }, totalDebt: { raw: 1e10 }, profitMargins: { raw: 0.55 } },
        incomeStatementHistory: { incomeStatementHistory: [{ endDate: { raw: 1706659200 }, totalRevenue: { raw: 6e10 }, netIncome: { raw: 3e10 } }] },
        earningsHistory: { history: [{ quarter: { fmt: "3Q24" }, epsEstimate: { raw: 0.75 }, epsActual: { raw: 0.81 }, surprisePercent: { raw: 0.08 } }] },
      }] },
    }) }],
    [/v7\/finance\/quote/, { body: JSON.stringify({ quoteResponse: { result: [] } }) }],
    [/v8\/finance\/chart/, { body: JSON.stringify({
      chart: { result: [{ timestamp: [1700000000, 1702000000], indicators: { quote: [{ close: [120, 140] }] } }] },
    }) }],
  ]);
  const { status, body } = await runJson(makeReq("NVDA", "US"));
  log(status === 200, "1. Yahoo happy path: 200 OK");
  log(body.symbol === "NVDA", "1. Resolved symbol = NVDA");
  log(body.snapshot?.price === 140, "1. price = 140");
  log(body.profile?.sector === "Technology", "1. sector parsed");
  log(body.fundamentals?.forwardPE === 35, "1. forward P/E = 35");
  log(body.earnings?.length === 1 && body.earnings[0].verdict === "beat", "1. earnings verdict = beat");
  log(body.priceHistory?.length === 2, "1. price history 2 points");
}

// ─── TEST 2: Name resolution — "NVIDIA" should still resolve to NVDA ───
{
  // Fresh mock — but module-scope yahooSession is still cached from test 1.
  // We re-mock so the cached crumb works against our new server.
  installMock([
    [/fc\.yahoo\.com/, { body: "ok", status: 200, headers: { "set-cookie": "A1=abc; Path=/" } }],
    [/getcrumb/, { body: "crumb_xyz", status: 200 }],
    [/finance\/search/, { body: JSON.stringify({ quotes: [
      { symbol: "NVD.DE", quoteType: "EQUITY" },  // German listing — should be REJECTED
      { symbol: "NVDA", quoteType: "EQUITY" },
    ] }) }],
    [/quoteSummary.*NVDA/, { body: JSON.stringify({
      quoteSummary: { result: [{ price: { regularMarketPrice: { raw: 140 }, longName: "NVIDIA Corp" }, summaryDetail: {}, defaultKeyStatistics: {}, financialData: {}, assetProfile: {} }] },
    }) }],
    [/quoteSummary.*NVD\.DE/, { body: JSON.stringify({ quoteSummary: { result: [] } }) }],
    [/v7\/finance\/quote/, { body: JSON.stringify({ quoteResponse: { result: [] } }) }],
    [/v8\/finance\/chart/, { body: JSON.stringify({ chart: { result: [{ timestamp: [], indicators: { quote: [{ close: [] }] } }] } }) }],
  ]);
  const { status, body } = await runJson(makeReq("NVIDIA", "US"));
  log(status === 200, "2. Name 'NVIDIA' resolves: 200 OK");
  log(body.symbol === "NVDA", `2. Resolved 'NVIDIA' → NVDA (got ${body.symbol})`);
  log(!body.candidatesTried?.some(c => /\.DE$/.test(c)), "2. German listings (.DE) filtered out of candidates");
}

// ─── TEST 3: Yahoo crumb returns 401 → Finnhub fallback kicks in ───
{
  process.env.FINNHUB_API_KEY = "test_key";
  installMock([
    [/fc\.yahoo\.com/, { body: "ok", status: 200, headers: { "set-cookie": "A1=x; Path=/" } }],
    [/getcrumb/, { body: "c", status: 200 }],
    [/finance\/search/, { body: JSON.stringify({ quotes: [{ symbol: "NVDA", quoteType: "EQUITY" }] }) }],
    [/quoteSummary/, { body: "Unauthorized", status: 401 }],
    [/v7\/finance\/quote/, { body: "Unauthorized", status: 401 }],
    [/v8\/finance\/chart/, { body: JSON.stringify({ chart: { result: [] } }) }],
    [/finnhub\.io.*profile2/, { body: JSON.stringify({
      name: "NVIDIA Corp", country: "US", currency: "USD", exchange: "NASDAQ",
      finnhubIndustry: "Semiconductors", marketCapitalization: 3_400_000, // millions
      shareOutstanding: 24_530, weburl: "https://www.nvidia.com",
    }) }],
    [/finnhub\.io.*metric/, { body: JSON.stringify({ metric: {
      forwardPE: 35, peTTM: 70, epsTTM: 3.5, revenueGrowthQuarterlyYoy: 93, epsGrowthQuarterlyYoy: 150,
      netProfitMarginAnnual: 55, operatingMarginAnnual: 60, "52WeekHigh": 150, "52WeekLow": 70,
    } }) }],
    [/finnhub\.io.*earnings/, { body: JSON.stringify([
      { period: "2024-10-31", estimate: 0.75, actual: 0.81, surprise: 0.06, surprisePercent: 8 },
    ]) }],
    [/stooq/, { body: "" }],
  ]);
  const { status, body } = await runJson(makeReq("NVDA", "US"));
  log(status === 200, "3. Finnhub fallback: 200 OK");
  log(body.snapshot?.longName === "NVIDIA Corp", "3. Finnhub provided company name");
  log(body.snapshot?.marketCap === 3.4e12, `3. Finnhub market cap converted to absolute (got ${body.snapshot?.marketCap})`);
  log(body.fundamentals?.forwardPE === 35, "3. Finnhub forward P/E");
  log(body.warnings?.some(w => /Finnhub/i.test(w)), "3. Warning mentions Finnhub");
  log(body.earnings?.length === 1 && body.earnings[0].verdict === "beat", "3. Finnhub earnings → beat");
  delete process.env.FINNHUB_API_KEY;
}

// ─── TEST 4: Yahoo blocked, no Finnhub key → 502 with helpful message ───
{
  delete process.env.FINNHUB_API_KEY;
  installMock([
    [/fc\.yahoo\.com/, { body: "blocked", status: 403 }],
    [/getcrumb/, { body: "", status: 401 }],
    [/finance\/search/, { body: JSON.stringify({ quotes: [{ symbol: "OBSCURE", quoteType: "EQUITY" }] }) }],
    [/quoteSummary/, { body: "", status: 401 }],
    [/v7\/finance\/quote/, { body: "", status: 401 }],
    [/v8\/finance\/chart/, { body: "", status: 401 }],
    [/stooq/, { body: "" }],
  ]);
  const { status, body } = await runJson(makeReq("OBSCURE", "US"));
  log(status === 502, "4. Total failure: 502");
  log(/No data found/.test(body.error || ""), "4. Helpful error message");
  log(Array.isArray(body.candidatesTried) && body.candidatesTried.length > 0, "4. Candidates listed in error");
}

// ─── TEST 5: HK ticker keeps leading zeros ───
{
  installMock([
    [/fc\.yahoo\.com/, { body: "ok", status: 200, headers: { "set-cookie": "A1=h; Path=/" } }],
    [/getcrumb/, { body: "c", status: 200 }],
    [/finance\/search/, { body: JSON.stringify({ quotes: [{ symbol: "0700.HK", quoteType: "EQUITY" }] }) }],
    [/quoteSummary.*0700\.HK/, { body: JSON.stringify({
      quoteSummary: { result: [{ price: { regularMarketPrice: { raw: 420 }, longName: "Tencent" }, summaryDetail: {}, defaultKeyStatistics: {}, financialData: {}, assetProfile: {} }] },
    }) }],
    [/v7\/finance\/quote/, { body: JSON.stringify({ quoteResponse: { result: [] } }) }],
    [/v8\/finance\/chart.*0700\.HK/, { body: JSON.stringify({ chart: { result: [{ timestamp: [1, 2], indicators: { quote: [{ close: [400, 420] }] } }] } }) }],
  ]);
  const { status, body } = await runJson(makeReq("0700", "HK"));
  log(status === 200, "5. HK 0700: 200 OK");
  log(body.snapshot?.price === 420, "5. HK Tencent price = 420");
  log(/0700\.HK/.test(body.sym || ""), `5. sym keeps .HK suffix (got "${body.sym}")`);
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
