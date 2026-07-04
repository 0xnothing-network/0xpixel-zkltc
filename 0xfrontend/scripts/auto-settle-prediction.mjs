import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DEFAULTS = {
  RPC_URL: "https://liteforge.rpc.caldera.xyz/http",
  PREDICTION_ADDRESS: "0x4B323Ac40FBC6Fb18Cf7e42f851C553390f920AD",
  ASSETS: "BTC/USD,ETH/USD,LTC/USD,USDC/USD,XAU/USD,XAG/USD,WTI/USD,XBR/USD",
  INTERVAL_MS: "60000",
  LOOKBACK: "720",
  SCAN_RECENT_ROUNDS: "24",
  TX_DELAY_MS: "2500",
  WAIT_RECEIPT: "true",
  AUTO_CANCEL_STALE: "true",
  GAS_LIMIT: "",
};

const PREDICTION_ABI = [
  {
    inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    name: "latestRoundOfAsset",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "roundCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "roundId", type: "uint256" }],
    name: "getRoundCore",
    outputs: [
      { internalType: "bytes32", name: "assetId", type: "bytes32" },
      { internalType: "string", name: "symbol", type: "string" },
      { internalType: "address", name: "feed", type: "address" },
      { internalType: "uint80", name: "startOracleRoundId", type: "uint80" },
      { internalType: "uint80", name: "endOracleRoundId", type: "uint80" },
      { internalType: "uint256", name: "startPrice", type: "uint256" },
      { internalType: "uint256", name: "endPrice", type: "uint256" },
      { internalType: "uint8", name: "outcome", type: "uint8" },
      { internalType: "bool", name: "settled", type: "bool" },
      { internalType: "bool", name: "cancelled", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "roundId", type: "uint256" }],
    name: "getRoundTimes",
    outputs: [
      { internalType: "uint256", name: "startTime", type: "uint256" },
      { internalType: "uint256", name: "betDeadline", type: "uint256" },
      { internalType: "uint256", name: "closeTime", type: "uint256" },
      { internalType: "uint256", name: "staleCancelTime", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "roundId", type: "uint256" },
      { internalType: "uint256", name: "maxLookback", type: "uint256" },
    ],
    name: "previewSettlementOracleRound",
    outputs: [
      { internalType: "uint80", name: "oracleRoundId", type: "uint80" },
      { internalType: "uint256", name: "price", type: "uint256" },
      { internalType: "uint256", name: "updatedAt", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "roundId", type: "uint256" },
      { internalType: "uint256", name: "maxLookback", type: "uint256" },
    ],
    name: "settleLatestRoundWithLookback",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "roundId", type: "uint256" }],
    name: "cancelStaleRound",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const body = fs.readFileSync(filePath, "utf8");
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const args = {
    once: false,
    dryRun: false,
    cancelStale: undefined,
    intervalMs: undefined,
    assets: undefined,
    scanRecentRounds: undefined,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--once") args.once = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--cancel-stale") args.cancelStale = true;
    else if (arg === "--no-cancel-stale") args.cancelStale = false;
    else if (arg === "--interval") args.intervalMs = Number(argv[++i]);
    else if (arg === "--assets") args.assets = argv[++i];
    else if (arg === "--scan-recent") args.scanRecentRounds = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function usage() {
  return `
Auto settle 0xPrediction rounds

Usage:
  npm run prediction:settle -- --dry-run --once
  npm run prediction:settle -- --once
  npm run prediction:settle
  npm run prediction:settle -- --cancel-stale
  npm run prediction:settle -- --assets BTC/USD,XAU/USD --scan-recent 40

Env:
  PREDICTION_SETTLER_PRIVATE_KEY=0x...
  NEXT_PUBLIC_LITVM_RPC_URL=https://...
  AUTO_SETTLE_INTERVAL_MS=60000
  AUTO_SETTLE_LOOKBACK=720
  AUTO_SETTLE_SCAN_RECENT_ROUNDS=24
  AUTO_CANCEL_STALE=true

Notes:
  --dry-run does not require a private key and sends no transactions.
  A round can settle once its fixed 2-hour closeTime has passed, using DIA latestRoundData.
  --cancel-stale / AUTO_CANCEL_STALE=true refunds only if the oracle feed is unreadable after the stale window.
`;
}

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function boolEnv(value) {
  return String(value).toLowerCase() === "true" || String(value) === "1";
}

function normalizePrivateKey(value) {
  const key = String(value || "").trim();
  if (!key) return "";
  return key.startsWith("0x") ? key : `0x${key}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortHash(hash) {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function fmtTime(seconds) {
  if (seconds <= 0) return "now";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function describeError(error) {
  return error?.shortMessage || error?.details || error?.message || String(error);
}

async function readBlockTimestamp(client) {
  const block = await client.getBlock();
  return Number(block.timestamp);
}

async function collectCandidateRounds(client, config) {
  const ids = new Set();

  for (const symbol of config.assets) {
    const assetId = keccak256(toBytes(symbol));
    try {
      const latestRoundId = await client.readContract({
        address: config.predictionAddress,
        abi: PREDICTION_ABI,
        functionName: "latestRoundOfAsset",
        args: [assetId],
      });
      if (latestRoundId > 0n) ids.add(latestRoundId.toString());
    } catch (error) {
      console.log(`[${symbol}] latest round read failed: ${describeError(error)}`);
    }
  }

  if (config.scanRecentRounds > 0) {
    try {
      const count = await client.readContract({
        address: config.predictionAddress,
        abi: PREDICTION_ABI,
        functionName: "roundCount",
      });
      const start = count > BigInt(config.scanRecentRounds)
        ? count - BigInt(config.scanRecentRounds) + 1n
        : 1n;
      for (let id = start; id <= count; id += 1n) {
        ids.add(id.toString());
      }
    } catch (error) {
      console.log(`[roundCount] read failed: ${describeError(error)}`);
    }
  }

  return Array.from(ids)
    .map((id) => BigInt(id))
    .sort((a, b) => Number(a - b));
}

async function inspectRound(client, config, roundId, now) {
  const [core, times] = await Promise.all([
    client.readContract({
      address: config.predictionAddress,
      abi: PREDICTION_ABI,
      functionName: "getRoundCore",
      args: [roundId],
    }),
    client.readContract({
      address: config.predictionAddress,
      abi: PREDICTION_ABI,
      functionName: "getRoundTimes",
      args: [roundId],
    }),
  ]);

  const symbol = core[1];
  const settled = core[8];
  const cancelled = core[9];
  const closeTime = Number(times[2]);
  const staleCancelTime = Number(times[3]);

  if (!config.assetSet.has(symbol)) {
    return { skip: true, roundId, symbol, reason: "asset filter" };
  }
  if (settled || cancelled) {
    return { skip: true, roundId, symbol, reason: settled ? "settled" : "cancelled" };
  }
  if (now < closeTime) {
    return {
      action: "wait-close",
      roundId,
      symbol,
      waitSeconds: closeTime - now,
    };
  }

  try {
    const preview = await client.readContract({
      address: config.predictionAddress,
      abi: PREDICTION_ABI,
      functionName: "previewSettlementOracleRound",
      args: [roundId, BigInt(config.lookback)],
    });
    return {
      action: "settle",
      roundId,
      symbol,
      oracleRoundId: preview[0],
      oracleUpdatedAt: Number(preview[2]),
    };
  } catch (error) {
    if (config.cancelStale && now > staleCancelTime) {
      return {
        action: "cancel-stale",
        roundId,
        symbol,
        reason: describeError(error),
      };
    }
    return {
      action: "wait-oracle",
      roundId,
      symbol,
      waitSeconds: Math.max(0, staleCancelTime - now),
      reason: describeError(error),
    };
  }
}

async function sendTx(ctx, action, roundId) {
  const { wallet, client, config } = ctx;
  if (config.dryRun) return null;

  const functionName = action === "settle" ? "settleLatestRoundWithLookback" : "cancelStaleRound";
  const args = action === "settle" ? [roundId, BigInt(config.lookback)] : [roundId];
  const request = {
    address: config.predictionAddress,
    abi: PREDICTION_ABI,
    functionName,
    args,
  };
  if (config.gasLimit) request.gas = config.gasLimit;

  const hash = await wallet.writeContract(request);
  console.log(`  tx ${shortHash(hash)} sent`);

  if (config.waitReceipt) {
    const receipt = await client.waitForTransactionReceipt({ hash });
    console.log(`  receipt status=${receipt.status} block=${receipt.blockNumber}`);
  }

  return hash;
}

async function scanOnce(ctx) {
  const { client, config } = ctx;
  const now = await readBlockTimestamp(client);
  const candidates = await collectCandidateRounds(client, config);
  let settled = 0;
  let cancelled = 0;
  let ready = 0;

  console.log(`\n[scan] ${new Date().toISOString()} rounds=${candidates.length} now=${now}`);

  for (const roundId of candidates) {
    try {
      const result = await inspectRound(client, config, roundId, now);
      if (result.skip) continue;

      if (result.action === "wait-close") {
        console.log(`#${roundId} ${result.symbol} wait close ${fmtTime(result.waitSeconds)}`);
      } else if (result.action === "wait-oracle") {
        console.log(`#${roundId} ${result.symbol} waiting oracle; refund in ${fmtTime(result.waitSeconds)} (${result.reason})`);
      } else if (result.action === "settle") {
        ready += 1;
        console.log(`#${roundId} ${result.symbol} settle ready oracleRound=${result.oracleRoundId} updatedAt=${result.oracleUpdatedAt}`);
        await sendTx(ctx, "settle", roundId);
        settled += config.dryRun ? 0 : 1;
        if (config.txDelayMs > 0) await sleep(config.txDelayMs);
      } else if (result.action === "cancel-stale") {
        console.log(`#${roundId} ${result.symbol} stale cancel ready (${result.reason})`);
        await sendTx(ctx, "cancel-stale", roundId);
        cancelled += config.dryRun ? 0 : 1;
        if (config.txDelayMs > 0) await sleep(config.txDelayMs);
      }
    } catch (error) {
      console.log(`#${roundId} ERROR ${describeError(error)}`);
    }
  }

  console.log(`[scan done] ready=${ready} settled=${settled} cancelled=${cancelled}`);
}

async function main() {
  loadEnvFile(path.join(process.cwd(), ".env.local"));
  loadEnvFile(path.join(process.cwd(), ".env"));

  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const assets = (args.assets || env("AUTO_SETTLE_ASSETS", env("PREDICTION_ASSETS", DEFAULTS.ASSETS)))
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

  const config = {
    rpcUrl: env("NEXT_PUBLIC_LITVM_RPC_URL", env("LITVM_RPC_URL", DEFAULTS.RPC_URL)),
    predictionAddress: DEFAULTS.PREDICTION_ADDRESS,
    privateKey: normalizePrivateKey(env("PREDICTION_SETTLER_PRIVATE_KEY")),
    assets,
    assetSet: new Set(assets),
    intervalMs: args.intervalMs || Number(env("AUTO_SETTLE_INTERVAL_MS", DEFAULTS.INTERVAL_MS)),
    lookback: Number(env("AUTO_SETTLE_LOOKBACK", DEFAULTS.LOOKBACK)),
    scanRecentRounds:
      args.scanRecentRounds !== undefined
        ? args.scanRecentRounds
        : Number(env("AUTO_SETTLE_SCAN_RECENT_ROUNDS", DEFAULTS.SCAN_RECENT_ROUNDS)),
    txDelayMs: Number(env("AUTO_SETTLE_TX_DELAY_MS", DEFAULTS.TX_DELAY_MS)),
    waitReceipt: boolEnv(env("AUTO_SETTLE_WAIT_RECEIPT", DEFAULTS.WAIT_RECEIPT)),
    cancelStale:
      args.cancelStale !== undefined
        ? args.cancelStale
        : boolEnv(env("AUTO_CANCEL_STALE", DEFAULTS.AUTO_CANCEL_STALE)),
    dryRun: args.dryRun,
    gasLimit: env("AUTO_SETTLE_GAS_LIMIT", DEFAULTS.GAS_LIMIT)
      ? BigInt(env("AUTO_SETTLE_GAS_LIMIT", DEFAULTS.GAS_LIMIT))
      : undefined,
  };

  if (!config.dryRun && !config.privateKey) {
    throw new Error("Missing PREDICTION_SETTLER_PRIVATE_KEY. Use --dry-run to scan without sending tx.");
  }
  if (!config.assets.length) throw new Error("No assets configured");
  if (!Number.isFinite(config.intervalMs) || config.intervalMs < 10_000) {
    throw new Error("AUTO_SETTLE_INTERVAL_MS / --interval must be at least 10000");
  }
  if (!Number.isInteger(config.lookback) || config.lookback < 1 || config.lookback > 720) {
    throw new Error("AUTO_SETTLE_LOOKBACK must be between 1 and 720");
  }
  if (!Number.isInteger(config.scanRecentRounds) || config.scanRecentRounds < 0) {
    throw new Error("AUTO_SETTLE_SCAN_RECENT_ROUNDS / --scan-recent must be >= 0");
  }

  const litvm = defineChain({
    id: 4441,
    name: "LitVM LiteForge",
    nativeCurrency: { name: "zkLTC", symbol: "zkLTC", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  const transport = http(config.rpcUrl, {
    retryCount: 3,
    retryDelay: 1500,
    timeout: 25_000,
  });
  const client = createPublicClient({ chain: litvm, transport });
  const account = config.privateKey ? privateKeyToAccount(config.privateKey) : undefined;
  const wallet = account ? createWalletClient({ account, chain: litvm, transport }) : undefined;

  console.log("0xPrediction auto settle");
  console.log(`  contract : ${config.predictionAddress}`);
  console.log(`  rpc      : ${config.rpcUrl}`);
  console.log(`  assets   : ${config.assets.join(", ")}`);
  console.log(`  mode     : ${config.dryRun ? "dry-run" : `tx from ${account.address}`}`);
  console.log(`  loop     : ${args.once ? "once" : `${config.intervalMs}ms`}`);
  console.log(`  recent   : ${config.scanRecentRounds} rounds`);
  console.log(`  cancel   : ${config.cancelStale ? "enabled" : "disabled"}`);

  const ctx = { client, wallet, config };

  if (args.once) {
    await scanOnce(ctx);
    return;
  }

  while (true) {
    try {
      await scanOnce(ctx);
    } catch (error) {
      console.log(`[loop error] ${describeError(error)}`);
    }
    await sleep(config.intervalMs);
  }
}

main().catch((error) => {
  console.error(describeError(error));
  process.exit(1);
});
