import {
  Swap,
  Candle,
  Pool,
  LiquidityAdded,
  LiquidityRemoved,
  PoolCreated,
  RewardClaimed,
} from "../generated/schema";
import {
  Swapped,
  LiquidityAdded as LiquidityAddedEvent,
  LiquidityRemoved as LiquidityRemovedEvent,
  PoolCreated as PoolCreatedEvent,
  RewardClaimed as RewardClaimedEvent,
} from "../generated/ZeroXDex/ZeroXDex";
import { BigDecimal, BigInt, Bytes, crypto } from "@graphprotocol/graph-ts";

const ZERO_BI = BigInt.fromI32(0);
const ONE_BI = BigInt.fromI32(1);
const CANDLE_INTERVALS = [15, 60, 240, 1440];

function pairIdForTokens(tokenA: Bytes, tokenB: Bytes): Bytes {
  const first = tokenA.toHexString() < tokenB.toHexString() ? tokenA : tokenB;
  const second = tokenA.toHexString() < tokenB.toHexString() ? tokenB : tokenA;
  return Bytes.fromByteArray(crypto.keccak256(first.concat(second)));
}

function token0ForPair(tokenA: Bytes, tokenB: Bytes): Bytes {
  return tokenA.toHexString() < tokenB.toHexString() ? tokenA : tokenB;
}

function toDecimal(value: BigInt): BigDecimal {
  return value.toBigDecimal();
}

function spotPriceFromPool(pool: Pool): BigDecimal | null {
  if (pool.reserve0.le(ZERO_BI) || pool.reserve1.le(ZERO_BI)) return null;
  return toDecimal(pool.reserve0).div(toDecimal(pool.reserve1));
}

function updateCandle(
  pairId: Bytes,
  intervalMinutes: i32,
  timestamp: BigInt,
  price: BigDecimal,
  tokenIn: Bytes,
  tokenOut: Bytes,
  amountIn: BigInt,
  amountOut: BigInt,
): void {
  const intervalSeconds = BigInt.fromI32(intervalMinutes * 60);
  const bucket = timestamp.div(intervalSeconds).times(intervalSeconds);
  const id =
    pairId.toHexString() +
    "-" +
    intervalMinutes.toString() +
    "-" +
    bucket.toString();
  let candle = Candle.load(id);

  if (candle === null) {
    candle = new Candle(id);
    candle.pairId = pairId;
    candle.interval = intervalMinutes;
    candle.timestamp = bucket;
    candle.open = price;
    candle.high = price;
    candle.low = price;
    candle.close = price;
    candle.volumeToken0 = BigDecimal.zero();
    candle.volumeToken1 = BigDecimal.zero();
    candle.swapCount = ZERO_BI;
  } else {
    if (price.gt(candle.high)) candle.high = price;
    if (price.lt(candle.low)) candle.low = price;
    candle.close = price;
  }

  const pairToken0 = token0ForPair(tokenIn, tokenOut);
  if (tokenIn.equals(pairToken0)) {
    candle.volumeToken0 = candle.volumeToken0.plus(toDecimal(amountIn));
    candle.volumeToken1 = candle.volumeToken1.plus(toDecimal(amountOut));
  } else {
    candle.volumeToken0 = candle.volumeToken0.plus(toDecimal(amountOut));
    candle.volumeToken1 = candle.volumeToken1.plus(toDecimal(amountIn));
  }
  candle.swapCount = candle.swapCount.plus(ONE_BI);
  candle.save();
}

export function handleSwapped(event: Swapped): void {
  const id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  const pairId = pairIdForTokens(event.params.tokenIn, event.params.tokenOut);

  const swap = new Swap(id);
  swap.user = event.params.user;
  swap.pairId = pairId;
  swap.tokenIn = event.params.tokenIn;
  swap.tokenOut = event.params.tokenOut;
  swap.amountIn = event.params.amountIn;
  swap.amountOut = event.params.amountOut;
  swap.fee = event.params.fee;
  swap.timestamp = event.block.timestamp;
  swap.blockNumber = event.block.number;
  swap.save();

  const pool = Pool.load(pairId.toHexString());
  if (pool === null) return;

  const amountInAfterFee = event.params.amountIn.minus(event.params.fee);
  if (amountInAfterFee.le(ZERO_BI)) return;

  if (event.params.tokenIn.equals(pool.token0)) {
    pool.reserve0 = pool.reserve0.plus(amountInAfterFee);
    pool.reserve1 = pool.reserve1.ge(event.params.amountOut)
      ? pool.reserve1.minus(event.params.amountOut)
      : ZERO_BI;
  } else {
    pool.reserve1 = pool.reserve1.plus(amountInAfterFee);
    pool.reserve0 = pool.reserve0.ge(event.params.amountOut)
      ? pool.reserve0.minus(event.params.amountOut)
      : ZERO_BI;
  }
  pool.save();

  const price = spotPriceFromPool(pool);
  if (price === null) return;

  for (let i = 0; i < CANDLE_INTERVALS.length; i++) {
    updateCandle(
      pairId,
      CANDLE_INTERVALS[i],
      event.block.timestamp,
      price,
      event.params.tokenIn,
      event.params.tokenOut,
      event.params.amountIn,
      event.params.amountOut,
    );
  }
}

export function handleLiquidityAdded(event: LiquidityAddedEvent): void {
  const id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();

  const entity = new LiquidityAdded(id);
  entity.user = event.params.user;
  entity.pairId = event.params.pairId;
  entity.amount0 = event.params.amount0;
  entity.amount1 = event.params.amount1;
  entity.lpMinted = event.params.lpMinted;
  entity.timestamp = event.block.timestamp;
  entity.save();

  // Accumulate pool reserves & LP totals from event deltas.
  const pool = Pool.load(event.params.pairId.toHex());
  if (pool !== null) {
    pool.reserve0 = pool.reserve0.plus(event.params.amount0);
    pool.reserve1 = pool.reserve1.plus(event.params.amount1);
    pool.totalLP = pool.totalLP.plus(event.params.lpMinted);
    pool.save();
  }
}

export function handleLiquidityRemoved(event: LiquidityRemovedEvent): void {
  const id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();

  const entity = new LiquidityRemoved(id);
  entity.user = event.params.user;
  entity.pairId = event.params.pairId;
  entity.lpBurned = event.params.lpBurned;
  entity.amount0 = event.params.amount0;
  entity.amount1 = event.params.amount1;
  entity.timestamp = event.block.timestamp;
  entity.save();

  // Decrement pool reserves & LP totals from event deltas.
  // Use guarded subtraction via ge/le helpers since direct comparisons on
  // BigInt are flaky across graph-ts versions.
  const pool = Pool.load(event.params.pairId.toHex());
  if (pool !== null) {
    const ZERO = BigInt.fromI32(0);
    if (pool.reserve0.ge(event.params.amount0)) {
      pool.reserve0 = pool.reserve0.minus(event.params.amount0);
    } else {
      pool.reserve0 = ZERO;
    }
    if (pool.reserve1.ge(event.params.amount1)) {
      pool.reserve1 = pool.reserve1.minus(event.params.amount1);
    } else {
      pool.reserve1 = ZERO;
    }
    if (pool.totalLP.ge(event.params.lpBurned)) {
      pool.totalLP = pool.totalLP.minus(event.params.lpBurned);
    } else {
      pool.totalLP = ZERO;
    }
    pool.save();
  }
}

export function handlePoolCreated(event: PoolCreatedEvent): void {
  const id = event.params.pairId.toHex();
  let entity = PoolCreated.load(id);

  if (entity === null) {
    entity = new PoolCreated(id);
    entity.pairId = event.params.pairId;
    entity.token0 = event.params.token0;
    entity.token1 = event.params.token1;
    entity.timestamp = event.block.timestamp;
    entity.save();
  }

  // Initialise the Pool entity so subsequent liquidity events can update it.
  const ZERO = BigInt.fromI32(0);
  let pool = Pool.load(id);
  if (pool === null) {
    pool = new Pool(id);
    pool.token0 = event.params.token0;
    pool.token1 = event.params.token1;
    pool.reserve0 = ZERO;
    pool.reserve1 = ZERO;
    pool.totalLP = ZERO;
    pool.save();
  }
}

export function handleRewardClaimed(event: RewardClaimedEvent): void {
  const id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();

  const entity = new RewardClaimed(id);
  entity.user = event.params.user;
  entity.amount = event.params.amount;
  entity.timestamp = event.block.timestamp;
  entity.save();
}
