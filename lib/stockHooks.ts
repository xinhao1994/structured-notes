// Friendly opening-hook lines for popular stocks — the "you must have used a
// pendrive in school..." style the RM wants. Written for non-native English
// readers: short sentences, everyday products, no jargon.
//
// Lookup is by canonical ticker symbol (e.g. "SNDK", "NVDA"). When a name
// isn't in the dictionary we render a generic fallback from Yahoo's
// longBusinessSummary instead.

export interface StockHook {
  /** One-line intro the client can relate to in everyday life. */
  hook: string;
  /** Plain-English what-they-do, max ~2 sentences. */
  whatTheyDo: string;
  /** Products / brands a Malaysian retail client would recognise. */
  familiarProducts: string[];
  /** Notable Malaysia connection (factories, partners, presence). Optional. */
  malaysiaTie?: string;
}

export const STOCK_HOOKS: Record<string, StockHook> = {
  SNDK: {
    hook: "You must have used a pen drive during secondary school — Kingston, SanDisk, Seagate. SanDisk is the one that came back from the dead.",
    whatTheyDo: "SanDisk makes flash-memory storage — the chips inside pen drives, SD cards, and the SSDs that boot your laptop in seconds. After being absorbed by Western Digital in 2016, SanDisk was spun out as its own listed company again in 2025 to focus purely on the booming AI-storage market.",
    familiarProducts: ["SanDisk pen drives", "SD / micro-SD cards", "Cruzer & iXpand USB drives", "SSDs for laptops", "Memory for AI data centres"],
    malaysiaTie: "Western Digital (SanDisk's former parent) operates a major hard-drive plant in Petaling Jaya — many of the drives Malaysians buy were partly built locally.",
  },
  WDC: {
    hook: "If you bought an external hard disk at Lowyat Plaza in the last 15 years, there's a good chance it was a Western Digital.",
    whatTheyDo: "Western Digital makes the spinning hard drives and SSDs that store data — for laptops, gaming PCs, surveillance NVRs, and the warehouse-scale cloud servers behind every app you use.",
    familiarProducts: ["WD My Passport portable HDD", "WD Blue / Black / Red internal drives", "WD SSDs", "Storage for AWS, Azure, Google Cloud"],
    malaysiaTie: "WD runs a massive HDD assembly plant in Petaling Jaya. It's one of Selangor's biggest tech employers.",
  },
  NVDA: {
    hook: "If you have ever seen 'GeForce' on a gaming laptop or heard 'AI chips' in the news — that is Nvidia.",
    whatTheyDo: "Nvidia designs the chips (GPUs) that power gaming graphics AND train every major AI model — including ChatGPT, Claude, and Gemini. Their H100 / B100 chips are the single most-fought-over hardware in the world right now.",
    familiarProducts: ["GeForce RTX gaming graphics cards", "Switch console chip (custom)", "Data-centre AI chips (H100, B200)", "Nvidia DRIVE for self-driving cars"],
    malaysiaTie: "Nvidia partners with YTL Power to build a 100 MW AI data centre in Kulai, Johor — one of the biggest Nvidia GPU deployments in Southeast Asia.",
  },
  AMZN: {
    hook: "If you have ever streamed a movie on Prime Video, or your friend shopped on Amazon US — they made the box. But the real money is the cloud behind almost every app on your phone.",
    whatTheyDo: "Amazon runs the world's biggest online shopping site, Prime Video, and AWS — the cloud-server business that secretly powers Netflix, Airbnb, the CIA, and millions of small businesses. AWS does most of the company's profit.",
    familiarProducts: ["Amazon.com shopping", "Prime Video", "Alexa / Echo speakers", "Kindle e-readers", "AWS cloud (behind your favourite apps)"],
    malaysiaTie: "AWS opened its Malaysia Region (Selangor data centres) in 2024 — a USD 6 billion local investment over 15 years.",
  },
  AAPL: {
    hook: "iPhone in your pocket, AirPods in your ears, MacBook on your desk — Apple is the most familiar tech name in Malaysia.",
    whatTheyDo: "Apple designs the iPhone, iPad, Mac, Apple Watch, and AirPods — and runs the App Store and Apple Pay that earn high-margin recurring revenue. Their hardware-plus-services model is the most profitable in the industry.",
    familiarProducts: ["iPhone", "iPad", "MacBook", "AirPods", "Apple Watch", "Apple TV+ / Music / Pay"],
    malaysiaTie: "Apple suppliers Foxconn, Pegatron, and Inventec have factories in Malaysia (Johor, Penang) producing accessories and components.",
  },
  MSFT: {
    hook: "Every office computer you have ever used probably ran Windows and Microsoft Office. That's Microsoft. But the new growth story is Azure cloud and AI.",
    whatTheyDo: "Microsoft makes Windows, Office (Word/Excel/Teams), Azure cloud, Xbox, and owns LinkedIn + GitHub. They invested USD 13 billion in OpenAI (ChatGPT) — Azure AI is now the second-largest cloud-AI platform after AWS.",
    familiarProducts: ["Windows", "Microsoft 365 (Word, Excel, Teams)", "Xbox", "LinkedIn", "Azure cloud + Copilot AI"],
    malaysiaTie: "Microsoft committed USD 2.2 billion to open Malaysia data centres + train 200k Malaysians in AI — announced May 2024.",
  },
  GOOGL: {
    hook: "Google search, YouTube, Gmail, Google Maps — you use them every single day without thinking about it. Alphabet is the company behind all of them.",
    whatTheyDo: "Alphabet owns Google Search, YouTube, Android, Gmail, Maps, plus Google Cloud, Waymo self-driving, and DeepMind AI. Search ads still pay most of the bills, but YouTube + Cloud are growing the fastest.",
    familiarProducts: ["Google Search", "YouTube", "Gmail", "Google Maps", "Android phones", "Google Cloud", "Pixel phones"],
  },
  META: {
    hook: "Facebook, Instagram, WhatsApp — if you message your friends or scroll Reels at night, you are inside Meta's ecosystem.",
    whatTheyDo: "Meta owns Facebook, Instagram, WhatsApp, and Threads — about 4 billion monthly users between them. They make money from ads on the feeds. Their other bet is the metaverse: Quest VR headsets and Ray-Ban Meta smart glasses.",
    familiarProducts: ["Facebook", "Instagram", "WhatsApp (used by every Malaysian)", "Threads", "Quest VR headsets", "Ray-Ban Meta smart glasses"],
    malaysiaTie: "Meta confirmed plans for a Malaysia data centre in Johor in 2024, and runs a regional engineering presence in Singapore that supports Malaysian users.",
  },
  MU: {
    hook: "Inside every laptop, phone, and AI server is a memory chip. Micron is one of only three companies in the world that make them (along with Samsung and SK Hynix).",
    whatTheyDo: "Micron designs and manufactures DRAM (the fast memory that runs apps) and NAND flash (the storage in your phone). Their HBM chips are critical for AI GPUs — Nvidia and AMD are both customers.",
    familiarProducts: ["Crucial-brand consumer SSDs / RAM", "Memory inside iPhones, Galaxy phones", "HBM stacks inside Nvidia H100/B200 AI chips"],
    malaysiaTie: "Micron has a back-end memory assembly & test facility in Penang Bayan Lepas — one of their key SEA operations.",
  },
  AVGO: {
    hook: "You may never have heard of Broadcom, but every WiFi router, every iPhone, and most data-centre switches contain their chips.",
    whatTheyDo: "Broadcom designs networking chips (WiFi, Ethernet, 5G), custom AI accelerators for Google + Meta, and storage controllers. They also own VMware (cloud software). Big AI growth story behind the scenes.",
    familiarProducts: ["WiFi chips in iPhones + Android phones", "Set-top box chips for Astro/Unifi TV", "Custom AI chips for Google TPUs", "VMware enterprise software"],
    malaysiaTie: "Broadcom has design + back-end ops in Penang Bayan Lepas. Many Malaysians work as RF / chip engineers there.",
  },
  TSLA: {
    hook: "Even if you have never seen a Tesla on Malaysian roads, you have heard about Elon Musk. Tesla is the EV brand the world watches.",
    whatTheyDo: "Tesla makes electric cars (Model 3 / Y / S / X / Cybertruck), home solar panels, and energy storage batteries (Megapack). They also bet big on full-self-driving software and humanoid robots (Optimus).",
    familiarProducts: ["Model Y SUV", "Model 3 sedan", "Cybertruck", "Tesla Powerwall home battery", "Solar Roof"],
    malaysiaTie: "Tesla opened its first Malaysian showroom in Bandar Utama in 2024. Some Model Y units sold in Malaysia are imported via Tesla Singapore.",
  },
  MRVL: {
    hook: "Marvell makes the connectors that move your data inside the cloud at lightning speed. Without them, AI training would crawl.",
    whatTheyDo: "Marvell designs high-speed networking chips, optical interconnects, and custom silicon for AWS / Google / Microsoft data centres. The 'fibre between AI chips' is largely their business.",
    familiarProducts: ["5G base-station chips (Verizon, AT&T)", "Storage controllers in enterprise SSDs", "Optical chips inside Meta/Google AI clusters"],
  },
  TSM: {
    hook: "Apple, Nvidia, AMD all design chips. TSMC is the one Taiwanese company that actually makes them — they're the world's chip factory.",
    whatTheyDo: "TSMC is a pure-play foundry — they manufacture chips designed by others. Apple's M-series, every Nvidia AI GPU, AMD's Ryzen — all made in TSMC fabs. They have ~60% global share of advanced chip manufacturing.",
    familiarProducts: ["Manufactures Apple A18 / M4 chips", "Manufactures Nvidia H100 / B200 AI chips", "Manufactures AMD Ryzen / Threadripper"],
    malaysiaTie: "TSMC's customers (Apple, Nvidia) test/package some chips at OSAT plants in Penang (UTAC, ASE).",
  },
};

/**
 * Render a friendly default hook from Yahoo's long business summary when we
 * don't have a curated entry. Keeps the tone simple, opens with a question.
 */
export function genericHook(longName: string, summary: string | null): string {
  if (!summary) return `${longName} — let's break down what they do, how they make money, and where the stock could go.`;
  const firstSentence = summary.split(/(?<=[.!?])\s+/)[0] ?? summary.slice(0, 220);
  return `${longName} — in one line: ${firstSentence}`;
}
