// Parser: free-form tranche text → structured `Tranche`.
// Tolerant of order, line breaks, emoji flags, capitalisation, corporate
// suffixes (Inc / Holdings / Corp), and multi-market listings (Alibaba
// → 9988 HK by default, BABA US if "US" is specified, etc.).

import { addBusinessDays } from "./markets";
import type { Currency, MarketCode, Tranche, Underlying } from "./types";

const CURRENCY_FROM_FLAG: Record<string, Currency> = {
  "🇲🇾": "MYR",
  "🇺🇸": "USD",
  "🇸🇬": "SGD",
  "🇭🇰": "HKD",
  "🇯🇵": "JPY",
  "🇦🇺": "AUD",
};

// ─── Name → multi-market listings ───────────────────────────────────────────
// For each well-known company we list the ticker on each market it trades on,
// plus a `default` market that applies when the user didn't specify one.
// Default is set to where the bank typically books each name.

interface Listing {
  US?: string;
  HK?: string;
  SG?: string;
  JP?: string;
  AU?: string;
  MY?: string;
  default: MarketCode;
}

const NAME_TO_TICKER: Record<string, Listing> = {
  // ─── US tech (NASDAQ default) ───────────────────────────────────────────
  apple: { US: "AAPL", default: "US" },
  microsoft: { US: "MSFT", default: "US" },
  google: { US: "GOOGL", default: "US" },
  alphabet: { US: "GOOGL", default: "US" },
  amazon: { US: "AMZN", default: "US" },
  meta: { US: "META", default: "US" },
  facebook: { US: "META", default: "US" },
  nvidia: { US: "NVDA", default: "US" },
  nvdia: { US: "NVDA", default: "US" },           // common misspelling
  nvida: { US: "NVDA", default: "US" },           // common misspelling
  "nivida": { US: "NVDA", default: "US" },        // common misspelling
  tesla: { US: "TSLA", default: "US" },
  netflix: { US: "NFLX", default: "US" },
  broadcom: { US: "AVGO", default: "US" },
  oracle: { US: "ORCL", default: "US" },
  salesforce: { US: "CRM", default: "US" },
  cisco: { US: "CSCO", default: "US" },
  intel: { US: "INTC", default: "US" },
  amd: { US: "AMD", default: "US" },
  "advanced micro devices": { US: "AMD", default: "US" },
  cadence: { US: "CDNS", default: "US" },
  "cadence design": { US: "CDNS", default: "US" },
  "cadence design systems": { US: "CDNS", default: "US" },
  coreweave: { US: "CRWV", default: "US" },
  "core weave": { US: "CRWV", default: "US" },
  ibm: { US: "IBM", default: "US" },
  adobe: { US: "ADBE", default: "US" },
  qualcomm: { US: "QCOM", default: "US" },
  paypal: { US: "PYPL", default: "US" },
  uber: { US: "UBER", default: "US" },
  airbnb: { US: "ABNB", default: "US" },
  shopify: { US: "SHOP", default: "US" },
  palantir: { US: "PLTR", default: "US" },
  snowflake: { US: "SNOW", default: "US" },
  servicenow: { US: "NOW", default: "US" },
  arista: { US: "ANET", default: "US" },
  amphenol: { US: "APH", default: "US" },
  "western digital": { US: "WDC", default: "US" },
  sandisk: { US: "SNDK", default: "US" },
  seagate: { US: "STX", default: "US" },
  micron: { US: "MU", default: "US" },
  marvell: { US: "MRVL", default: "US" },
  "marvell technology": { US: "MRVL", default: "US" },
  "marvell technologies": { US: "MRVL", default: "US" },
  "applied materials": { US: "AMAT", default: "US" },
  "lam research": { US: "LRCX", default: "US" },
  asml: { US: "ASML", default: "US" },
  tsmc: { US: "TSM", default: "US" },
  "taiwan semiconductor": { US: "TSM", default: "US" },
  workday: { US: "WDAY", default: "US" },
  intuit: { US: "INTU", default: "US" },
  "texas instruments": { US: "TXN", default: "US" },
  // ─── Recent US IPOs & newer listings (2023-2026) ────────────────────────
  arm: { US: "ARM", default: "US" },
  "arm holdings": { US: "ARM", default: "US" },
  reddit: { US: "RDDT", default: "US" },
  rubrik: { US: "RBRK", default: "US" },
  klaviyo: { US: "KVYO", default: "US" },
  instacart: { US: "CART", default: "US" },
  cava: { US: "CAVA", default: "US" },
  kenvue: { US: "KVUE", default: "US" },
  birkenstock: { US: "BIRK", default: "US" },
  nextracker: { US: "NXT", default: "US" },
  "astera labs": { US: "ALAB", default: "US" },
  "tempus ai": { US: "TEM", default: "US" },
  tempus: { US: "TEM", default: "US" },
  waystar: { US: "WAY", default: "US" },
  servicetitan: { US: "TTAN", default: "US" },
  "service titan": { US: "TTAN", default: "US" },
  figma: { US: "FIG", default: "US" },
  circle: { US: "CRCL", default: "US" },
  "circle internet": { US: "CRCL", default: "US" },
  // SpaceX — NASDAQ IPO 11 Jun 2026, ticker SPCX. Largest IPO on record
  // ($75B raised). Elon Musk's rocket + Starlink company.
  spacex: { US: "SPCX", default: "US" },
  "space x": { US: "SPCX", default: "US" },
  spcx: { US: "SPCX", default: "US" },
  // SK Hynix — Korean chipmaker, ADRs listed on NASDAQ 10 Jul 2026 under
  // SKHY. Second-largest DRAM/HBM maker after Samsung, big beneficiary of
  // AI memory demand (Nvidia HBM3E supplier).
  "sk hynix": { US: "SKHY", default: "US" },
  hynix: { US: "SKHY", default: "US" },
  skhy: { US: "SKHY", default: "US" },
  skhynix: { US: "SKHY", default: "US" },
  chime: { US: "CHYM", default: "US" },
  robinhood: { US: "HOOD", default: "US" },
  coinbase: { US: "COIN", default: "US" },
  "app lovin": { US: "APP", default: "US" },
  applovin: { US: "APP", default: "US" },
  spotify: { US: "SPOT", default: "US" },
  block: { US: "SQ", default: "US" },
  square: { US: "SQ", default: "US" },
  doordash: { US: "DASH", default: "US" },
  duolingo: { US: "DUOL", default: "US" },
  datadog: { US: "DDOG", default: "US" },
  crowdstrike: { US: "CRWD", default: "US" },
  "cloudflare": { US: "NET", default: "US" },
  fortinet: { US: "FTNT", default: "US" },
  "palo alto": { US: "PANW", default: "US" },
  "palo alto networks": { US: "PANW", default: "US" },
  zscaler: { US: "ZS", default: "US" },
  mongodb: { US: "MDB", default: "US" },
  hubspot: { US: "HUBS", default: "US" },
  atlassian: { US: "TEAM", default: "US" },
  gitlab: { US: "GTLB", default: "US" },
  supermicro: { US: "SMCI", default: "US" },
  "super micro": { US: "SMCI", default: "US" },
  vertiv: { US: "VRT", default: "US" },
  "vertiv holdings": { US: "VRT", default: "US" },
  celestica: { US: "CLS", default: "US" },
  monolithic: { US: "MPWR", default: "US" },
  "monolithic power": { US: "MPWR", default: "US" },
  onsemi: { US: "ON", default: "US" },
  microchip: { US: "MCHP", default: "US" },
  strategy: { US: "MSTR", default: "US" },
  microstrategy: { US: "MSTR", default: "US" },
  "trump media": { US: "DJT", default: "US" },
  rivian: { US: "RIVN", default: "US" },
  lucid: { US: "LCID", default: "US" },
  ferrari: { US: "RACE", default: "US" },
  novartis: { US: "NVS", default: "US" },
  astrazeneca: { US: "AZN", default: "US" },
  novo: { US: "NVO", default: "US" },
  "novo nordisk": { US: "NVO", default: "US" },

  // ─── US financials / consumer / healthcare ──────────────────────────────
  jpmorgan: { US: "JPM", default: "US" },
  "jp morgan": { US: "JPM", default: "US" },
  "bank of america": { US: "BAC", default: "US" },
  "goldman sachs": { US: "GS", default: "US" },
  "morgan stanley": { US: "MS", default: "US" },
  "wells fargo": { US: "WFC", default: "US" },
  citigroup: { US: "C", default: "US" },
  visa: { US: "V", default: "US" },
  mastercard: { US: "MA", default: "US" },
  berkshire: { US: "BRK.B", default: "US" },
  walmart: { US: "WMT", default: "US" },
  costco: { US: "COST", default: "US" },
  "home depot": { US: "HD", default: "US" },
  mcdonalds: { US: "MCD", default: "US" },
  starbucks: { US: "SBUX", default: "US" },
  "coca cola": { US: "KO", default: "US" },
  pepsi: { US: "PEP", default: "US" },
  pepsico: { US: "PEP", default: "US" },
  disney: { US: "DIS", default: "US" },
  nike: { US: "NKE", default: "US" },
  boeing: { US: "BA", default: "US" },
  caterpillar: { US: "CAT", default: "US" },
  exxon: { US: "XOM", default: "US" },
  exxonmobil: { US: "XOM", default: "US" },
  chevron: { US: "CVX", default: "US" },
  pfizer: { US: "PFE", default: "US" },
  "johnson and johnson": { US: "JNJ", default: "US" },
  "johnson & johnson": { US: "JNJ", default: "US" },
  "eli lilly": { US: "LLY", default: "US" },
  unitedhealth: { US: "UNH", default: "US" },
  "procter and gamble": { US: "PG", default: "US" },
  "procter & gamble": { US: "PG", default: "US" },
  merck: { US: "MRK", default: "US" },
  abbvie: { US: "ABBV", default: "US" },
  verizon: { US: "VZ", default: "US" },

  // ─── HK / China (Hang Seng default) ─────────────────────────────────────
  // Dual-listed names give US ADR alongside HK — bank usually books HK.
  alibaba: { HK: "9988", US: "BABA", default: "HK" },
  tencent: { HK: "0700", default: "HK" },
  meituan: { HK: "3690", default: "HK" },
  jd: { HK: "9618", US: "JD", default: "HK" },
  netease: { HK: "9999", US: "NTES", default: "HK" },
  baidu: { HK: "9888", US: "BIDU", default: "HK" },
  "trip.com": { HK: "9961", US: "TCOM", default: "HK" },
  pinduoduo: { US: "PDD", default: "US" },
  "ping an": { HK: "2318", default: "HK" },
  "ping an insurance": { HK: "2318", default: "HK" },
  "bank of china": { HK: "3988", default: "HK" },
  "agricultural bank of china": { HK: "1288", default: "HK" },
  "agricultural bank": { HK: "1288", default: "HK" },
  icbc: { HK: "1398", default: "HK" },
  "industrial and commercial bank of china": { HK: "1398", default: "HK" },
  "china construction bank": { HK: "0939", default: "HK" },
  ccb: { HK: "0939", default: "HK" },
  "china mobile": { HK: "0941", default: "HK" },
  "china life": { HK: "2628", default: "HK" },
  "china merchants bank": { HK: "3968", default: "HK" },
  hsbc: { HK: "0005", default: "HK" },
  aia: { HK: "1299", default: "HK" },
  "aia group": { HK: "1299", default: "HK" },
  xiaomi: { HK: "1810", default: "HK" },
  byd: { HK: "1211", default: "HK" },
  "byd company": { HK: "1211", default: "HK" },
  nio: { HK: "9866", US: "NIO", default: "HK" },
  xpeng: { HK: "9868", US: "XPEV", default: "HK" },
  "li auto": { HK: "2015", US: "LI", default: "HK" },
  geely: { HK: "0175", default: "HK" },
  "geely auto": { HK: "0175", default: "HK" },
  "great wall motor": { HK: "2333", default: "HK" },
  saic: { HK: "2333", default: "HK" },
  smic: { HK: "0981", default: "HK" },
  "hua hong": { HK: "1347", default: "HK" },
  "kuaishou": { HK: "1024", default: "HK" },
  bilibili: { HK: "9626", US: "BILI", default: "HK" },
  weibo: { HK: "9898", US: "WB", default: "HK" },
  ctrip: { HK: "9961", US: "TCOM", default: "HK" },
  "anta sports": { HK: "2020", default: "HK" },
  "li ning": { HK: "2331", default: "HK" },
  "wharf reic": { HK: "1997", default: "HK" },
  "swire pacific": { HK: "0019", default: "HK" },
  "ck hutchison": { HK: "0001", default: "HK" },
  "henderson land": { HK: "0012", default: "HK" },
  "sun hung kai": { HK: "0016", default: "HK" },
  "shk properties": { HK: "0016", default: "HK" },
  "sands china": { HK: "1928", default: "HK" },
  "galaxy entertainment": { HK: "0027", default: "HK" },
  "wynn macau": { HK: "1128", default: "HK" },
  cnooc: { HK: "0883", default: "HK" },
  petrochina: { HK: "0857", default: "HK" },
  sinopec: { HK: "0386", default: "HK" },
  "beke": { HK: "2423", US: "BEKE", default: "HK" },
  "ke holdings": { HK: "2423", US: "BEKE", default: "HK" },
  "tencent music": { HK: "1698", US: "TME", default: "HK" },
  "china tower": { HK: "0788", default: "HK" },
  "china telecom": { HK: "0728", default: "HK" },
  "china unicom": { HK: "0762", default: "HK" },
  "mtr corporation": { HK: "0066", default: "HK" },
  mtr: { HK: "0066", default: "HK" },
  "hong kong exchanges": { HK: "0388", default: "HK" },
  hkex: { HK: "0388", default: "HK" },
  "clp holdings": { HK: "0002", default: "HK" },
  clp: { HK: "0002", default: "HK" },
  "power assets": { HK: "0006", default: "HK" },
  "chow tai fook": { HK: "1929", default: "HK" },
  "prada": { HK: "1913", default: "HK" },
  "l\u0027occitane": { HK: "0973", default: "HK" },
  "budweiser apac": { HK: "1876", default: "HK" },
  "haidilao": { HK: "6862", default: "HK" },
  "yum china": { HK: "9987", US: "YUMC", default: "HK" },
  "muyuan": { HK: "2599", default: "HK" },
  "byd electronic": { HK: "0285", default: "HK" },
  "sunny optical": { HK: "2382", default: "HK" },
  "aac technologies": { HK: "2018", default: "HK" },
  "wuxi biologics": { HK: "2269", default: "HK" },
  "hansoh pharma": { HK: "3692", default: "HK" },
  "sinopharm": { HK: "1099", default: "HK" },
  "cnbm": { HK: "3323", default: "HK" },
  "china resources": { HK: "0291", default: "HK" },
  "shenzhen mindray": { HK: "9911", default: "HK" },
  mindray: { HK: "9911", default: "HK" },
  "east buy": { HK: "1797", default: "HK" },
  "new oriental": { HK: "9901", US: "EDU", default: "HK" },

  // ─── Singapore ──────────────────────────────────────────────────────────
  dbs: { SG: "D05", default: "SG" },
  "dbs group": { SG: "D05", default: "SG" },
  uob: { SG: "U11", default: "SG" },
  "united overseas bank": { SG: "U11", default: "SG" },
  ocbc: { SG: "O39", default: "SG" },
  "oversea-chinese banking": { SG: "O39", default: "SG" },
  singtel: { SG: "Z74", default: "SG" },
  capitaland: { SG: "C31", default: "SG" },
  "capitaland investment": { SG: "9CI", default: "SG" },
  "sgx": { SG: "S68", default: "SG" },
  "wilmar": { SG: "F34", default: "SG" },
  "keppel": { SG: "BN4", default: "SG" },
  "city developments": { SG: "C09", default: "SG" },
  "sembcorp": { SG: "U96", default: "SG" },
  "sembcorp industries": { SG: "U96", default: "SG" },
  sia: { SG: "C6L", default: "SG" },
  "singapore airlines": { SG: "C6L", default: "SG" },
  "thai beverage": { SG: "Y92", default: "SG" },
  "yangzijiang": { SG: "BS6", default: "SG" },
  "yangzijiang shipbuilding": { SG: "BS6", default: "SG" },
  "yangzijiang financial": { SG: "YF8", default: "SG" },
  "hongkong land": { SG: "H78", default: "SG" },
  "jardine matheson": { SG: "J36", default: "SG" },
  "jardine cycle": { SG: "C07", default: "SG" },
  "genting singapore": { SG: "G13", default: "SG" },
  "st engineering": { SG: "S63", default: "SG" },
  "singapore tech engineering": { SG: "S63", default: "SG" },
  "singapore post": { SG: "S08", default: "SG" },
  "starhub": { SG: "CC3", default: "SG" },
  "seatrium": { SG: "S51", default: "SG" },
  "venture corporation": { SG: "V03", default: "SG" },
  venture: { SG: "V03", default: "SG" },
  "capitaland ascendas": { SG: "A17U", default: "SG" },
  "mapletree pan asia": { SG: "N2IU", default: "SG" },
  "mapletree logistics": { SG: "M44U", default: "SG" },
  "mapletree industrial": { SG: "ME8U", default: "SG" },
  "frasers logistics": { SG: "BUOU", default: "SG" },
  "frasers centrepoint": { SG: "J69U", default: "SG" },
  "suntec reit": { SG: "T82U", default: "SG" },
  "cdlht": { SG: "J85", default: "SG" },
  "raffles medical": { SG: "BSL", default: "SG" },
  "iFAST": { SG: "AIY", default: "SG" },
  ifast: { SG: "AIY", default: "SG" },
  grab: { US: "GRAB", default: "US" },
  "grab holdings": { US: "GRAB", default: "US" },
  "sea limited": { US: "SE", default: "US" },
  sea: { US: "SE", default: "US" },

  // ─── Malaysia ───────────────────────────────────────────────────────────
  cimb: { MY: "1023", default: "MY" },
  "cimb group": { MY: "1023", default: "MY" },
  maybank: { MY: "1155", default: "MY" },
  "malayan banking": { MY: "1155", default: "MY" },
  "public bank": { MY: "1295", default: "MY" },
  pbb: { MY: "1295", default: "MY" },
  "hong leong bank": { MY: "5819", default: "MY" },
  "hong leong financial": { MY: "1082", default: "MY" },
  hlfg: { MY: "1082", default: "MY" },
  rhb: { MY: "1066", default: "MY" },
  "rhb bank": { MY: "1066", default: "MY" },
  ambank: { MY: "1015", default: "MY" },
  "amc holdings": { MY: "1015", default: "MY" },
  "bank islam": { MY: "5258", default: "MY" },
  "tenaga nasional": { MY: "5347", default: "MY" },
  tnb: { MY: "5347", default: "MY" },
  petronas: { MY: "5681", default: "MY" },
  "petronas gas": { MY: "6033", default: "MY" },
  "petronas chemicals": { MY: "5183", default: "MY" },
  "petronas dagangan": { MY: "5681", default: "MY" },
  "ihh healthcare": { MY: "5225", default: "MY" },
  ihh: { MY: "5225", default: "MY" },
  kpj: { MY: "5878", default: "MY" },
  "kpj healthcare": { MY: "5878", default: "MY" },
  ytl: { MY: "4677", default: "MY" },
  "ytl corp": { MY: "4677", default: "MY" },
  "ytl power": { MY: "6742", default: "MY" },
  genting: { MY: "3182", default: "MY" },
  "genting malaysia": { MY: "4715", default: "MY" },
  "sime darby": { MY: "4197", default: "MY" },
  "sime darby plantation": { MY: "5285", default: "MY" },
  simeplant: { MY: "5285", default: "MY" },
  misc: { MY: "3816", default: "MY" },
  maxis: { MY: "6012", default: "MY" },
  digi: { MY: "6947", default: "MY" },
  celcom: { MY: "6947", default: "MY" },
  celcomdigi: { MY: "6947", default: "MY" },
  axiata: { MY: "6888", default: "MY" },
  telekom: { MY: "4863", default: "MY" },
  "telekom malaysia": { MY: "4863", default: "MY" },
  "top glove": { MY: "7113", default: "MY" },
  hartalega: { MY: "5168", default: "MY" },
  "kossan": { MY: "7153", default: "MY" },
  supermax: { MY: "7106", default: "MY" },
  "gamuda": { MY: "5398", default: "MY" },
  "iois corporation": { MY: "1961", default: "MY" },
  ioi: { MY: "1961", default: "MY" },
  "kuala lumpur kepong": { MY: "2445", default: "MY" },
  klk: { MY: "2445", default: "MY" },
  ppb: { MY: "4065", default: "MY" },
  "ppb group": { MY: "4065", default: "MY" },
  nestle: { MY: "4707", default: "MY" },
  "nestle malaysia": { MY: "4707", default: "MY" },
  qlfoods: { MY: "7084", default: "MY" },
  "qlfoods resources": { MY: "7084", default: "MY" },
  mrdiy: { MY: "5296", default: "MY" },
  "mr diy": { MY: "5296", default: "MY" },
  aeon: { MY: "6599", default: "MY" },
  airasia: { MY: "5099", default: "MY" },
  "capital a": { MY: "5099", default: "MY" },
  "airport holdings": { MY: "5014", default: "MY" },
  mahb: { MY: "5014", default: "MY" },
  "malaysia airports": { MY: "5014", default: "MY" },
  "gas malaysia": { MY: "5209", default: "MY" },
  "westports": { MY: "5246", default: "MY" },

  // ─── Japan ──────────────────────────────────────────────────────────────
  toyota: { JP: "7203", default: "JP" },
  "toyota motor": { JP: "7203", default: "JP" },
  sony: { JP: "6758", default: "JP" },
  "sony group": { JP: "6758", default: "JP" },
  softbank: { JP: "9984", default: "JP" },
  "softbank group": { JP: "9984", default: "JP" },
  nintendo: { JP: "7974", default: "JP" },
  honda: { JP: "7267", default: "JP" },
  "honda motor": { JP: "7267", default: "JP" },
  nissan: { JP: "7201", default: "JP" },
  suzuki: { JP: "7269", default: "JP" },
  mazda: { JP: "7261", default: "JP" },
  subaru: { JP: "7270", default: "JP" },
  "mitsubishi ufj": { JP: "8306", default: "JP" },
  mufg: { JP: "8306", default: "JP" },
  "sumitomo mitsui": { JP: "8316", default: "JP" },
  smfg: { JP: "8316", default: "JP" },
  mizuho: { JP: "8411", default: "JP" },
  "mizuho financial": { JP: "8411", default: "JP" },
  keyence: { JP: "6861", default: "JP" },
  "fast retailing": { JP: "9983", default: "JP" },
  uniqlo: { JP: "9983", default: "JP" },
  "tokyo electron": { JP: "8035", default: "JP" },
  "shin-etsu": { JP: "4063", default: "JP" },
  "shin etsu": { JP: "4063", default: "JP" },
  hitachi: { JP: "6501", default: "JP" },
  panasonic: { JP: "6752", default: "JP" },
  canon: { JP: "7751", default: "JP" },
  nidec: { JP: "6594", default: "JP" },
  "recruit holdings": { JP: "6098", default: "JP" },
  recruit: { JP: "6098", default: "JP" },
  "kddi": { JP: "9433", default: "JP" },
  "nippon telegraph": { JP: "9432", default: "JP" },
  ntt: { JP: "9432", default: "JP" },
  "japan tobacco": { JP: "2914", default: "JP" },
  "tokio marine": { JP: "8766", default: "JP" },
  komatsu: { JP: "6301", default: "JP" },
  daikin: { JP: "6367", default: "JP" },
  "advantest": { JP: "6857", default: "JP" },
  "murata": { JP: "6981", default: "JP" },
  "murata manufacturing": { JP: "6981", default: "JP" },
  "denso": { JP: "6902", default: "JP" },
  "renesas": { JP: "6723", default: "JP" },
  "chugai": { JP: "4519", default: "JP" },
  "takeda": { JP: "4502", default: "JP" },
  "takeda pharmaceutical": { JP: "4502", default: "JP" },
  "daiichi sankyo": { JP: "4568", default: "JP" },
  "orix": { JP: "8591", default: "JP" },
  "mitsui": { JP: "8031", default: "JP" },
  "mitsubishi corp": { JP: "8058", default: "JP" },
  "sumitomo corp": { JP: "8053", default: "JP" },
  "marubeni": { JP: "8002", default: "JP" },
  "itochu": { JP: "8001", default: "JP" },
  "asml japan": { JP: "6301", default: "JP" },
  "nomura": { JP: "8604", default: "JP" },
  "nomura holdings": { JP: "8604", default: "JP" },
  "daiwa": { JP: "8601", default: "JP" },
  "daiwa securities": { JP: "8601", default: "JP" },

  // ─── Australia ──────────────────────────────────────────────────────────
  bhp: { AU: "BHP", default: "AU" },
  cba: { AU: "CBA", default: "AU" },
  "commonwealth bank": { AU: "CBA", default: "AU" },
  "rio tinto": { AU: "RIO", default: "AU" },
  woolworths: { AU: "WOW", default: "AU" },
  westpac: { AU: "WBC", default: "AU" },
  anz: { AU: "ANZ", default: "AU" },
  nab: { AU: "NAB", default: "AU" },
  fortescue: { AU: "FMG", default: "AU" },
  csl: { AU: "CSL", default: "AU" },
  telstra: { AU: "TLS", default: "AU" },
  macquarie: { AU: "MQG", default: "AU" },
  "macquarie group": { AU: "MQG", default: "AU" },
  wesfarmers: { AU: "WES", default: "AU" },
  coles: { AU: "COL", default: "AU" },
  qantas: { AU: "QAN", default: "AU" },
  "santos": { AU: "STO", default: "AU" },
  "woodside": { AU: "WDS", default: "AU" },
  "woodside energy": { AU: "WDS", default: "AU" },
  goodman: { AU: "GMG", default: "AU" },
  "goodman group": { AU: "GMG", default: "AU" },
  transurban: { AU: "TCL", default: "AU" },
  aristocrat: { AU: "ALL", default: "AU" },
  "aristocrat leisure": { AU: "ALL", default: "AU" },
  brambles: { AU: "BXB", default: "AU" },
  "james hardie": { AU: "JHX", default: "AU" },
  amcor: { AU: "AMC", default: "AU" },
  suncorp: { AU: "SUN", default: "AU" },
  qbe: { AU: "QBE", default: "AU" },
  "insurance australia": { AU: "IAG", default: "AU" },
  origin: { AU: "ORG", default: "AU" },
  "origin energy": { AU: "ORG", default: "AU" },
  agl: { AU: "AGL", default: "AU" },
  "agl energy": { AU: "AGL", default: "AU" },
  "pilbara minerals": { AU: "PLS", default: "AU" },
  "mineral resources": { AU: "MIN", default: "AU" },
  "reece": { AU: "REH", default: "AU" },

  // ─── Bare ticker aliases ────────────────────────────────────────────────
  // Allows the user to type just "NVDA" or "MRVL" on a line without the
  // "US" market tag and still resolve correctly. Lowercase keys because
  // NAME_TO_TICKER lookup lowercases the input.
  nvda: { US: "NVDA", default: "US" },
  amzn: { US: "AMZN", default: "US" },
  mrvl: { US: "MRVL", default: "US" },
  aapl: { US: "AAPL", default: "US" },
  msft: { US: "MSFT", default: "US" },
  googl: { US: "GOOGL", default: "US" },
  goog: { US: "GOOG", default: "US" },
  tsla: { US: "TSLA", default: "US" },
  nflx: { US: "NFLX", default: "US" },
  avgo: { US: "AVGO", default: "US" },
  cdns: { US: "CDNS", default: "US" },
  mu: { US: "MU", default: "US" },
  arm: { US: "ARM", default: "US" },
  crwd: { US: "CRWD", default: "US" },
  panw: { US: "PANW", default: "US" },
  smci: { US: "SMCI", default: "US" },
  vrt: { US: "VRT", default: "US" },
  mstr: { US: "MSTR", default: "US" },
  app: { US: "APP", default: "US" },
  ddog: { US: "DDOG", default: "US" },
  net: { US: "NET", default: "US" },
  now: { US: "NOW", default: "US" },
  orcl: { US: "ORCL", default: "US" },
  crm: { US: "CRM", default: "US" },
  csco: { US: "CSCO", default: "US" },
  intc: { US: "INTC", default: "US" },
  qcom: { US: "QCOM", default: "US" },
  adbe: { US: "ADBE", default: "US" },
  pypl: { US: "PYPL", default: "US" },
  shop: { US: "SHOP", default: "US" },
  pltr: { US: "PLTR", default: "US" },
  snow: { US: "SNOW", default: "US" },
  anet: { US: "ANET", default: "US" },
  aph: { US: "APH", default: "US" },
  wdc: { US: "WDC", default: "US" },
  sndk: { US: "SNDK", default: "US" },
  txn: { US: "TXN", default: "US" },
  amat: { US: "AMAT", default: "US" },
  lrcx: { US: "LRCX", default: "US" },
  tsm: { US: "TSM", default: "US" },
  wday: { US: "WDAY", default: "US" },
  intu: { US: "INTU", default: "US" },
  jpm: { US: "JPM", default: "US" },
  bac: { US: "BAC", default: "US" },
  gs: { US: "GS", default: "US" },
  wfc: { US: "WFC", default: "US" },
  wmt: { US: "WMT", default: "US" },
  cost: { US: "COST", default: "US" },
  sbux: { US: "SBUX", default: "US" },
  pep: { US: "PEP", default: "US" },
  dis: { US: "DIS", default: "US" },
  nke: { US: "NKE", default: "US" },
  ba: { US: "BA", default: "US" },
  xom: { US: "XOM", default: "US" },
  cvx: { US: "CVX", default: "US" },
  pfe: { US: "PFE", default: "US" },
  jnj: { US: "JNJ", default: "US" },
  lly: { US: "LLY", default: "US" },
  unh: { US: "UNH", default: "US" },
  pg: { US: "PG", default: "US" },
  mrk: { US: "MRK", default: "US" },
  abbv: { US: "ABBV", default: "US" },
};

const MARKET_TOKENS: Record<string, MarketCode> = {
  US: "US", NYSE: "US", NASDAQ: "US", ADR: "US", OTC: "US",
  HK: "HK",
  MY: "MY", KL: "MY",
  SG: "SG", SI: "SG",
  JP: "JP", TYO: "JP", T: "JP",
  AU: "AU", ASX: "AU",
};

// 4-digit codes hint Hang Seng listings even without an "HK" tag.
function looksLikeHkCode(s: string): boolean {
  return /^\d{4}$/.test(s);
}

function pct(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) / 100 : undefined;
}

function parseDate(s: string): string | undefined {
  // Format Z: relative words — "today", "tonight", "tomorrow", "tmr",
  // "day after tomorrow", "next monday" etc. Common in distributor chat
  // messages like "Trade: today, 4pm". Interpret in local time so
  // "tonight" resolves to today's calendar date.
  const rel = s.trim().toLowerCase();
  const isoLocal = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  // "today", "tonight", "this evening", "this eve", "eod today", "same day"
  if (/^(today|tonight|this\s+(?:evening|eve|night|afternoon|morning|arvo)|now|eod\s+today|same\s+day)\b/.test(rel)) {
    return isoLocal(new Date());
  }
  // "tomorrow", "tmr", "tmrw", "tomo", "next day"
  if (/^(tomorrow|tmrw?|tmr|tomo|next\s+day)\b/.test(rel)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return isoLocal(d);
  }
  // "day after tomorrow", "day-after-tomorrow", "in 2 days", "in 3 days"
  const daysAfter = rel.match(/^(?:day\s+after\s+tomorrow|in\s+(\d+)\s+days?)/);
  if (daysAfter) {
    const n = daysAfter[1] ? parseInt(daysAfter[1], 10) : 2;
    const d = new Date();
    d.setDate(d.getDate() + n);
    return isoLocal(d);
  }
  // "next monday", "this friday", etc.
  const dayMatch = rel.match(/^(?:next|this)\s+(mon|tue|wed|thu|fri|sat|sun)(?:day|nesday|urday)?\b/);
  if (dayMatch) {
    const target = ["sun","mon","tue","wed","thu","fri","sat"].indexOf(dayMatch[1]);
    if (target >= 0) {
      const d = new Date();
      const diff = (target - d.getDay() + 7) % 7 || 7;  // 0 → next week same day
      d.setDate(d.getDate() + diff);
      return isoLocal(d);
    }
  }

  // Format A: "8th May 2026", "8 May 26", "8 May 2026" — word-month style
  // with optional ordinal suffix.
  const m1 = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{2,4})/i);
  if (m1) {
    const day = parseInt(m1[1], 10);
    const monthName = m1[2].toLowerCase();
    let year = parseInt(m1[3], 10);
    if (year < 100) year += 2000;
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const idx = months.findIndex((mn) => monthName.startsWith(mn));
    if (idx >= 0) return new Date(Date.UTC(year, idx, day)).toISOString().slice(0, 10);
  }

  // Format B: "9/9/2025", "9-9-2025", "9.9.2025", "9/9/25" — numeric
  // D/M/Y ordering (Malaysian / Asian banking convention). For ambiguous
  // dates like "5/12/2025" we treat as 5 December, not May 12.
  // Bounded so it doesn't accidentally swallow "8.5% pa" (one separator)
  // or "T+7" (no slashes).
  const m2 = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m2) {
    const day = parseInt(m2[1], 10);
    const month = parseInt(m2[2], 10);
    let year = parseInt(m2[3], 10);
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
      return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
    }
  }

  return undefined;
}

function parseOffering(line: string): { start?: string; end?: string } {
  const trimmed = line.replace(/^[Oo]ffering[:\s]*/, "").trim();
  const range = trimmed.match(
    /(\d{1,2})(?:st|nd|rd|th)?\s*(?:[A-Za-z]{3,9})?\s*(?:\d{2,4})?\s*[-–]\s*(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s+\d{2,4})/i
  );
  if (range) {
    const end = parseDate(range[2]);
    if (!end) return {};
    const endMatch = range[2].match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{2,4})/i)!;
    const startDay = parseInt(range[1], 10);
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const idx = months.findIndex((m) => endMatch[2].toLowerCase().startsWith(m));
    if (idx < 0) return { end };
    let endYear = parseInt(endMatch[3], 10);
    if (endYear < 100) endYear += 2000;
    const start = new Date(Date.UTC(endYear, idx, startDay)).toISOString().slice(0, 10);
    return { start, end };
  }
  const single = parseDate(trimmed);
  return single ? { end: single } : {};
}

function detectCurrency(text: string): Currency | undefined {
  for (const k of Object.keys(CURRENCY_FROM_FLAG)) {
    if (text.includes(k)) return CURRENCY_FROM_FLAG[k];
  }
  const m = text.match(/\b(USD|HKD|MYR|SGD|JPY|AUD)\b/);
  return (m?.[1] as Currency) || undefined;
}

/** Strip emojis and other decorative symbols from a line. */
function stripDecor(s: string): string {
  // FIRST PASS: strip keycap emoji sequences as a UNIT. A keycap is
  //   <digit 0-9 | # | *> + (optional U+FE0F) + U+20E3 (combining enclosing keycap)
  // So "1⃣MSI" becomes "MSI". We do this before the general digit-preserving
  // pass below because otherwise the leading digit would be left behind
  // (we deliberately don't strip lone digits — they appear in tranche codes
  // like "MSIT260582").
  return s
    .replace(/[0-9#*][\u{FE0F}]?\u{20E3}/gu, "")
    // SECOND PASS: strip emoji pictographs, skin-tone modifiers, the FE0F
    // variation selector, and ZWJ. CRITICAL: still do NOT strip \p{Emoji_Component}
    // because that Unicode class includes plain digits 0-9.
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE0F}\u{200D}\u{20E3}]+/gu, "")
    .replace(/[\u{1F1E6}-\u{1F1FF}]+/gu, "")
    .replace(/\s+/g, " ");
}

/**
 * Normalise a company name for dictionary lookup. Strips common corporate
 * suffixes (Inc, Corp, Holdings, Ltd, Group, etc.) so "Applied Materials Inc"
 * matches the "applied materials" entry, "ASML Holdings" matches "asml", etc.
 */
function normaliseName(s: string): string {
  return s
    .replace(/[.,]/g, " ")
    .replace(/\b(inc|incorporated|corp|corporation|company|co|ltd|limited|plc|holdings?|holding|group|grp|sa|ag|gmbh|nv|spa|llc|sarl|berhad|bhd|kk|kabushiki kaisha)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Levenshtein edit distance — minimum number of single-character insertions,
 * deletions, or substitutions to turn `a` into `b`. Used for typo-tolerant
 * dictionary lookup so "applie material" → "applied materials" → AMAT.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * Find the dictionary entry closest to `query` within `maxDistance` edits.
 * Returns the matched listing or undefined if no entry is close enough.
 * Threshold scales with query length so short names need exact match.
 */
function findFuzzyMatch(query: string): { listing: Listing; matchedKey: string } | undefined {
  const norm = normaliseName(query);
  if (norm.length < 4) return undefined;                 // too short to fuzzy
  // ceil(len/3) gives sensible thresholds: 4-6 chars → 2 edits, 7-9 → 3,
  // 10+ → 3 (capped). Catches typos like "googel"/"alibba" while not
  // collapsing distinct names into each other.
  const maxDistance = Math.min(3, Math.max(1, Math.ceil(norm.length / 3)));
  let best: { key: string; distance: number } | undefined;
  for (const key of Object.keys(NAME_TO_TICKER)) {
    // Cheap reject — skip entries with wildly different length
    if (Math.abs(key.length - norm.length) > maxDistance) continue;
    const d = levenshtein(norm, key);
    if (d <= maxDistance && (!best || d < best.distance)) {
      best = { key, distance: d };
      if (d === 0) break;
    }
  }
  return best ? { listing: NAME_TO_TICKER[best.key], matchedKey: best.key } : undefined;
}

/**
 * Resolve a free-form name (and optional market hint) to {symbol, market}.
 * Lookup order:
 *   1. exact match in NAME_TO_TICKER
 *   2. normalised-name match (suffixes stripped)
 *   3. fall back to using the input as the ticker on the hinted market
 */
function resolveListing(name: string, marketHint?: MarketCode): {
  symbol: string;
  market: MarketCode;
  resolved: boolean;
} {
  const exact = NAME_TO_TICKER[name.toLowerCase()];
  const normalised = NAME_TO_TICKER[normaliseName(name)];
  // Fuzzy fallback catches typos like "applie material" → "applied materials"
  // and "arista net" → "arista". Threshold scales with name length so short
  // queries don't match unrelated short entries.
  // Try the full-name fuzzy first, then fall back to the first significant
  // word — that handles "arista net" → "arista" → ANET.
  let fuzzy = undefined as ReturnType<typeof findFuzzyMatch>;
  let fuzzyIsExact = false;
  if (!exact && !normalised) {
    fuzzy = findFuzzyMatch(name);
    if (!fuzzy) {
      const firstWord = normaliseName(name).split(" ")[0];
      if (firstWord) {
        if (NAME_TO_TICKER[firstWord]) {
          // Exact dict hit on first word — no length guard needed for exact lookups.
          // This handles short tickers like "amd" (3 chars) that would be blocked
          // by the fuzzy length guard below.
          fuzzy = { listing: NAME_TO_TICKER[firstWord], matchedKey: firstWord };
          fuzzyIsExact = true;
        } else if (firstWord.length >= 4) {
          fuzzy = findFuzzyMatch(firstWord);
        }
      }
    }
  }
  // Reject non-exact fuzzy hits whose only listings are on a different market than
  // the hint. Prevents "advanced" → "advantest" (JP only) when marketHint="US".
  // Exact firstWord hits are kept — they may still fall back to their default market.
  if (fuzzy && !fuzzyIsExact && marketHint) {
    const fl = fuzzy.listing as any;
    if (!fl[marketHint] && fl.default !== marketHint) fuzzy = undefined;
  }
  const hit = exact || normalised || fuzzy?.listing;

  if (hit) {
    const targetMkt: MarketCode = marketHint && (hit as any)[marketHint] ? marketHint : hit.default;
    const sym = (hit as any)[targetMkt] as string | undefined;
    if (sym) return { symbol: sym, market: targetMkt, resolved: true };
    // Fallback: use default listing.
    const def = (hit as any)[hit.default] as string;
    return { symbol: def, market: hit.default, resolved: true };
  }

  // No dictionary match. Use the raw name as the ticker on the hinted market
  // (or US by default). The post-parse symbol-search hook will try to upgrade
  // it via Finnhub.
  const upper = name.toUpperCase();
  const looksLikeTicker = /^[A-Z0-9.&\-]{1,8}$/.test(upper);
  return {
    symbol: looksLikeTicker ? upper : upper,
    market: marketHint ?? "US",
    resolved: looksLikeTicker,
  };
}

function extractTickers(text: string, exclude: Set<string>): Underlying[] {
  // Lines that aren't fields are candidate underlyings. We strip emojis
  // first so "💡 Alibaba HK ⭐" parses cleanly. The `exclude` set holds
  // strings (issuer abbreviation, tranche code) that the caller has already
  // identified — they must not be treated as underlyings.
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => stripDecor(l).trim())
    .filter(Boolean)
    .filter((l) => !exclude.has(l) && !exclude.has(l.toUpperCase()));

  // Expand "Underlyings: Stock1, Stock2, ..." into individual lines so each
  // name is parsed independently. Without this the entire labelled line would
  // be swallowed by the field-label filter below.
  const lines: string[] = [];
  for (const line of rawLines) {
    const ulMatch = line.match(/^Underlyings?\s*:\s*(.+)/i);
    if (ulMatch) {
      for (const part of ulMatch[1].split(/\s*,\s*/)) {
        const p = part.trim();
        if (p) lines.push(p);
      }
    } else {
      lines.push(line);
    }
  }

  const out: Underlying[] = [];
  for (const raw of lines) {
    // Field labels — never underlyings. Includes coupon/tenor synonyms
    // (yield/interest/tenure), currency/code labels, and common header
    // words that distributors put in product blurbs. This is the primary
    // defence against parsing things like "Currency SGD" (no colon)
    // as ticker CURRENCY listed on the SG market.
    // "Code" is added here because "Code: MSIT26H317" is the tranche code,
    // never an underlying.
    if (/^(Strike|KO|Autocall|Coupon|Yield|Interest|Tenor|Tenure|EKI|Offering|Offer|Trade|Settlement|Tranche|Code|Currency|Notional|Maturity|Underlyings?|Issuer|Bank|Type|Note|Notes|Reference|Ref|Product|MYR|USD|HKD|SGD|JPY|AUD)\b/i.test(raw)) continue;
    // Single-word "Label: value" — always a field, never a ticker.
    // e.g. "Ccy: SGD 🇸🇬" strips to "Ccy: SGD" which has no space
    // before the colon, so the multi-word guard below misses it.
    if (/^[A-Za-z]\w*\s*:/.test(raw)) continue;
    // Multi-word "Label: value" lines (e.g. "Trade date:", "Initial
    // fixing:", "Settlement details:"). Requires AT LEAST two
    // whitespace-separated words before the colon, so plain ticker
    // forms like "AAPL:" wouldn't accidentally match.
    if (/^[A-Za-z]+\s+[A-Za-z]+\s*:/.test(raw)) continue;

    // Format ADR: "Company Name MARKET ADR" — e.g. "SK Hynix US ADR".
    // Must be handled before Format A because the trailing "ADR" token would
    // otherwise be misread as the market code, leaving "Company Name MARKET"
    // as an unresolvable left part.
    const adrPattern = raw.match(/^(.+?)\s+(?:(US|HK|SG|JP|AU|MY)\s+)?ADR\s*$/i);
    if (adrPattern) {
      const companyName = adrPattern[1].trim();
      const mkt: MarketCode = adrPattern[2]
        ? (MARKET_TOKENS[adrPattern[2].toUpperCase()] ?? "US")
        : "US";
      const dictHit = resolveListing(companyName, mkt);
      out.push({ rawName: companyName, symbol: dictHit.symbol, market: mkt, resolved: dictHit.resolved });
      continue;
    }

    // Format A: "TICKER MARKET" or "TICKER MARKET (Company Name)"
    //   e.g. "TSM US", "0700 HK", "ASML US (ASML Holdings)"
    const withMarket = raw.match(/^([A-Za-z0-9.&\- ]+?)\s+([A-Z]{1,4}|\.[A-Z]{1,3})(?:\s*\((.*?)\))?\s*$/);
    if (withMarket) {
      const left = withMarket[1].trim();
      const tok = withMarket[2].replace(/^\./, "");
      const market = MARKET_TOKENS[tok];
      if (market) {
        const longName = withMarket[3]?.trim();

        // "Company Name TICKER MARKET" — last word of left is an explicit ticker.
        // e.g. "Advanced Micro Devices AMD US" → left="Advanced Micro Devices AMD", lastToken="AMD"
        // e.g. "Marvell Technology Inc MRVL US" → left="...", lastToken="MRVL"
        // Handle this BEFORE resolveListing so the full left string doesn't fuzzy-
        // match an unrelated entry (e.g. "advanced" → "advantest" JP:6857).
        if (!longName) {
          const leftWords = left.trim().split(/\s+/);
          const lastToken = leftWords[leftWords.length - 1].toUpperCase();
          if (leftWords.length > 1 && /^[A-Z]{1,6}$/.test(lastToken) && !MARKET_TOKENS[lastToken]) {
            const lastTokenHit = resolveListing(lastToken, market);
            if (lastTokenHit.resolved) {
              const companyPart = leftWords.slice(0, -1).join(" ");
              out.push({ rawName: companyPart, symbol: lastTokenHit.symbol, market: lastTokenHit.market, resolved: true });
              continue;
            }
          }
        }

        // Try dictionary lookup first (so "Alibaba US" -> BABA, not ALIBABA).
        // If no dict match AND the left side already looks like a real ticker,
        // use it as-is.
        const dictHit = resolveListing(longName ? longName : left, market);
        const upperLeft = left.toUpperCase();
        const looksLikeTicker = /^[A-Z0-9.&\-]{1,8}$/.test(upperLeft);
        const final = dictHit.resolved
          ? dictHit
          : looksLikeTicker
            ? { symbol: upperLeft, market, resolved: true }
            : dictHit;
        const rawName = longName ? `${left} (${longName})` : left;
        out.push({ rawName, symbol: final.symbol, market: final.market, resolved: final.resolved });
        continue;
      }
    }

    // Format A-alt: "TICKER MARKET CompanyName" — company name trailing without parens
    //   e.g. "CRM US Salesforce", "NOW US Servicenow"
    const tickerFirst = raw.match(/^([A-Za-z0-9.&\-]{1,8})\s+([A-Z]{1,4})\s+([A-Za-z][A-Za-z0-9 &.\-]*)$/);
    if (tickerFirst) {
      const tok = tickerFirst[2];
      const market = MARKET_TOKENS[tok];
      const tickerPart = tickerFirst[1].toUpperCase();
      if (market && /^[A-Z0-9.&\-]{1,8}$/.test(tickerPart)) {
        const companyName = tickerFirst[3].trim();
        out.push({ rawName: `${companyName} (${tickerPart})`, symbol: tickerPart, market, resolved: true });
        continue;
      }
    }

    // Format B-alt: "Company Name (TICKER MARKET)" — parenthesized ticker after name.
    //   e.g. "Texas Instruments Inc (TXN US)", "Alibaba Group (9988 HK)"
    const parenthesizedMatch = raw.match(/^(.+?)\s*\(([A-Za-z0-9.&\-]+)\s+([A-Z]{1,4})\)\s*$/);
    if (parenthesizedMatch) {
      const companyName = parenthesizedMatch[1].trim();
      const tickerPart = parenthesizedMatch[2].trim().toUpperCase();
      const tok = parenthesizedMatch[3].trim();
      const market = MARKET_TOKENS[tok];
      if (market && /^[A-Z0-9.&\-]{1,8}$/.test(tickerPart)) {
        out.push({ rawName: `${companyName} (${tickerPart} ${tok})`, symbol: tickerPart, market, resolved: true });
        continue;
      }
    }

    // Format B: bare 4-digit code → Hang Seng listing
    if (looksLikeHkCode(raw)) {
      out.push({ rawName: raw, symbol: raw, market: "HK", resolved: true });
      continue;
    }

    // Format C-alt: "TICKER ( Company Name )" — ticker first with description in parens.
    //   e.g. "CDNS ( Cadence Design )", "AMD ( AMD )", "AVGO ( Broadcom )"
    //   Try resolving via the description first; fall back to using ticker directly.
    const tickerParens = raw.match(/^([A-Za-z0-9.&\-]{1,8})\s+\(\s*([^)]+?)\s*\)\s*$/);
    if (tickerParens) {
      const tickerPart = tickerParens[1].trim().toUpperCase();
      const descPart = tickerParens[2].trim();
      if (/^[A-Z][A-Z0-9.&\-]{0,7}$/.test(tickerPart)) {
        const descHit = resolveListing(descPart);
        if (descHit.resolved) {
          out.push({ rawName: `${tickerPart} (${descPart})`, symbol: descHit.symbol, market: descHit.market, resolved: true });
        } else {
          out.push({ rawName: `${tickerPart} (${descPart})`, symbol: tickerPart, market: "US", resolved: true });
        }
        continue;
      }
    }

    // Format C: bare company name → look up default listing
    //   e.g. "Applied Materials Inc", "Alibaba", "ASML Holdings"
    const looked = resolveListing(raw);
    if (looked.resolved) {
      out.push({ rawName: raw, symbol: looked.symbol, market: looked.market, resolved: true });
    }
  }

  // Dedupe by (symbol, market)
  const seen = new Set<string>();
  return out.filter((u) => {
    const k = u.symbol + ":" + u.market;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function parseField(text: string, key: RegExp): string | undefined {
  const m = text.match(key);
  return m ? m[1].trim() : undefined;
}

export interface ParseWarning {
  field: string;
  message: string;
}

export interface ParseResult {
  tranche: Tranche;
  warnings: ParseWarning[];
}

export function parseTrancheText(input: string): ParseResult {
  const warnings: ParseWarning[] = [];
  const text = input.trim();

  const issuerLines = text.split(/\r?\n/).map((l) => stripDecor(l).trim()).filter(Boolean);
  // Exclude known ticker aliases from issuer detection — e.g. "TSMC" is a stock,
  // not the issuing bank.
  const issuer = issuerLines.find((l) => /^[A-Z]{2,8}$/.test(l) && !NAME_TO_TICKER[l.toLowerCase()]);

  const trancheCode =
    parseField(text, /Tranche\s*code[:\s]+([A-Z0-9-]+)/i) ||
    // "Code: MSIT26H317" — distributor shorthand; must not be confused with
    // the underlying-detection path.
    parseField(text, /^Code\s*:\s*([A-Z0-9][A-Z0-9-]*)/im) ||
    // Bare tranche code patterns: MSIT26H317 (mixed letters+digits) or
    // classic 2-4 letter prefix + 6+ digit suffix.
    parseField(text, /\b(MSIT[A-Z0-9]{3,}|[A-Z]{2,4}\d{6,})\b/) ||
    `T${Date.now().toString().slice(-7)}`;

  // Accept "Offering", "Offer", "OFFER" — abbreviations are common in
  // distributor chat messages.
  const offeringLine =
    parseField(text, /Offer(?:ing)?[:\s]+([^\n]+?)(?=\s+Trade[:\s]|\n|$)/i) ||
    parseField(text, /Offer(?:ing)?[:\s]+([^\n]+)/i) ||
    "";
  let { start: offeringStart, end: offeringEnd } = parseOffering(offeringLine);

  // "Offering & Trade 8 May 2026" — single-day window where offering = trade
  const combined = parseField(text, /Offering\s*&\s*Trade[:\s]+([^\n]+)/i);
  const tradeRaw =
    combined ||
    parseField(text, /Trade[:\s]+([^\n]+?)(?=\s+(?:Settlement|Tranche|Offering)\b|$)/i) ||
    parseField(text, /Trade[:\s]+([^\n]+)/i) ||
    "";
  let tradeDate = parseDate(tradeRaw);
  if (combined && tradeDate && !offeringEnd) offeringEnd = tradeDate;
  // Fallback: if no Trade date was provided but we have an Offering end date,
  // use the offering end as the trade date. Distributors often state only an
  // offering window (e.g. "Offering: 1–8 May 2026") and the trade settles on
  // the closing day. Reduces parser warnings + makes settlement math work.
  if (!tradeDate && offeringEnd) tradeDate = offeringEnd;

  const tradeCutoffMatch = tradeRaw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  let tradeCutoff: string | undefined;
  if (tradeCutoffMatch) {
    const rawHour = parseInt(tradeCutoffMatch[1], 10);
    const isPm = tradeCutoffMatch[3].toLowerCase() === "pm";
    const hour24 = (rawHour % 12) + (isPm ? 12 : 0);
    tradeCutoff = `${String(hour24).padStart(2, "0")}:${(tradeCutoffMatch[2] || "00").padStart(2, "0")}`;
  }

  const settleRaw = parseField(text, /Settlement[:\s]+([^\n]+)/i) || "T+7";
  const settleMatch = settleRaw.match(/T\s*\+\s*(\d+)/i);
  const settlementOffset = settleMatch ? parseInt(settleMatch[1], 10) : 7;

  // Coupon synonyms: "Coupon", "Yield", "Interest" — all commonly used by
  // distributors and bank sales notes for the same field.
  const couponMatch = text.match(/(?:Coupon|Yield|Interest)\s*:?\s+[*_]*(\d+(?:\.\d+)?)\s*%(?:\s*p\.?a\.?)?[*_]*/i);
  const couponPa = couponMatch ? parseFloat(couponMatch[1]) / 100 : 0;
  if (!couponMatch) warnings.push({ field: "coupon", message: "Coupon not found — defaulted to 0%." });

  // Tenor synonyms: "Tenor" or "Tenure" — the latter is a common spelling
  // variant in Asian banking notes.
  const tenorMatch = text.match(/(?:Tenor|Tenure)\s*:?\s+(\d+(?:\.\d+)?)\s*(M|Y|months|years|month|year|m|y)/i);
  let tenorMonths = 12;
  if (tenorMatch) {
    const n = parseFloat(tenorMatch[1]);
    const u = tenorMatch[2].toLowerCase();
    tenorMonths = u.startsWith("y") ? Math.round(n * 12) : Math.round(n);
  } else {
    warnings.push({ field: "tenor", message: "Tenor not found — defaulted to 12M." });
  }

  const strikePct = pct(parseField(text, /Strike\s*:?\s+([0-9.]+\s*%)/i)) ?? 1.0;
  const ekiPct = pct(parseField(text, /EKI\s*:?\s+([0-9.]+\s*%)/i)) ?? 0.6;

  // Accept "KO" or "Autocall" as the knock-out/autocall field label.
  const koLine = parseField(text, /(?:KO|Autocall)\s*:?\s+([^\n]+)/i) || "";
  const koStartPct = pct(koLine.match(/([0-9.]+\s*%)/)?.[1]) ?? 1.0;
  // Stepdown can be written as "stepdown 4%", "4% stepdown", "4% step down", "(3% step down)".
  const stepdownPct =
    pct(koLine.match(/step\s*down\s*:?\s+([0-9.]+\s*%)/i)?.[1]) ??
    pct(koLine.match(/([0-9.]+\s*%)\s+step\s*down/i)?.[1]) ??
    0;

  const koObsFreqMonths = 1;

  const currency = detectCurrency(text) || "USD";
  if (!detectCurrency(text)) {
    warnings.push({ field: "currency", message: "Currency not found — defaulted to USD." });
  }

  let underlyings = extractTickers(text, new Set([
    issuer ?? "",
    trancheCode,
  ].filter(Boolean) as string[]));
  if (!underlyings.length) {
    warnings.push({ field: "underlyings", message: "No underlyings detected — please verify." });
  }
  // Bank's autocallable product offers 1–3 underlyings. If the parser
  // surfaced more than 3, almost certainly one is a label/header that
  // slipped through. Keep the first 3 and warn so the user can spot it.
  const MAX_UNDERLYINGS = 3;
  if (underlyings.length > MAX_UNDERLYINGS) {
    const dropped = underlyings.slice(MAX_UNDERLYINGS).map((u) => u.rawName || u.symbol).join(", ");
    warnings.push({
      field: "underlyings",
      message: `Detected ${underlyings.length} underlyings; product caps at ${MAX_UNDERLYINGS}. Kept the first ${MAX_UNDERLYINGS}, dropped: ${dropped}.`,
    });
    underlyings = underlyings.slice(0, MAX_UNDERLYINGS);
  }

  if (!tradeDate) {
    warnings.push({ field: "tradeDate", message: "Trade date missing — settlement will be wrong." });
  }

  const settlementDate = tradeDate
    ? addBusinessDays(tradeDate, settlementOffset, "US")
    : undefined;

  const tranche: Tranche = {
    issuer,
    trancheCode,
    currency,
    offeringStart,
    offeringEnd,
    tradeDate: tradeDate || new Date().toISOString().slice(0, 10),
    tradeCutoff,
    settlementOffset,
    settlementDate,
    couponPa,
    tenorMonths,
    strikePct,
    koStartPct,
    koStepdownPct: stepdownPct,
    ekiPct,
    koObsFreqMonths,
    underlyings,
    isIndicativeFixing: true,
    createdAt: new Date().toISOString(),
  };

  return { tranche, warnings };
}
