import {
  Swap,
  Pool,
  LiquidityAdded,
  LiquidityRemoved,
  PoolCreated,
  RewardClaimed,
} from '../generated/schema';
import {
  Swapped,
  LiquidityAdded as LiquidityAddedEvent,
  LiquidityRemoved as LiquidityRemovedEvent,
  PoolCreated as PoolCreatedEvent,
  RewardClaimed as RewardClaimedEvent,
} from '../generated/ZeroXDex/ZeroXDex';
import { BigInt } from '@graphprotocol/graph-ts';

export function handleSwapped(event: Swapped): void {
  const id =
    event.transaction.hash.toHex() + '-' + event.logIndex.toString();

  const swap = new Swap(id);
  swap.user = event.params.user;
  swap.tokenIn = event.params.tokenIn;
  swap.tokenOut = event.params.tokenOut;
  swap.amountIn = event.params.amountIn;
  swap.amountOut = event.params.amountOut;
  swap.fee = event.params.fee;
  swap.timestamp = event.block.timestamp;
  swap.blockNumber = event.block.number;
  swap.save();
}

export function handleLiquidityAdded(event: LiquidityAddedEvent): void {
  const id =
    event.transaction.hash.toHex() + '-' + event.logIndex.toString();

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
  const id =
    event.transaction.hash.toHex() + '-' + event.logIndex.toString();

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
  const id =
    event.transaction.hash.toHex() + '-' + event.logIndex.toString();

  const entity = new RewardClaimed(id);
  entity.user = event.params.user;
  entity.amount = event.params.amount;
  entity.timestamp = event.block.timestamp;
  entity.save();
}
