import { Swap, Pool, LiquidityAdded, LiquidityRemoved, PoolCreated, RewardClaimed } from '../generated/schema';
import { Swapped, LiquidityAdded as LiquidityAddedEvent, LiquidityRemoved as LiquidityRemovedEvent, PoolCreated as PoolCreatedEvent, RewardClaimed as RewardClaimedEvent } from '../generated/ZeroXDex/ZeroXDex';

export function handleSwapped(event: Swapped): void {
  let swap = new Swap(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
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
  let entity = new LiquidityAdded(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.user = event.params.user;
  entity.pairId = event.params.pairId;
  entity.amount0 = event.params.amount0;
  entity.amount1 = event.params.amount1;
  entity.lpMinted = event.params.lpMinted;
  entity.timestamp = event.block.timestamp;
  entity.save();
}

export function handleLiquidityRemoved(event: LiquidityRemovedEvent): void {
  let entity = new LiquidityRemoved(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.user = event.params.user;
  entity.pairId = event.params.pairId;
  entity.lpBurned = event.params.lpBurned;
  entity.amount0 = event.params.amount0;
  entity.amount1 = event.params.amount1;
  entity.timestamp = event.block.timestamp;
  entity.save();
}

export function handlePoolCreated(event: PoolCreatedEvent): void {
  let entity = new PoolCreated(event.params.pairId.toHex());
  entity.pairId = event.params.pairId;
  entity.token0 = event.params.token0;
  entity.token1 = event.params.token1;
  entity.timestamp = event.block.timestamp;
  entity.save();
}

export function handleRewardClaimed(event: RewardClaimedEvent): void {
  let entity = new RewardClaimed(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.user = event.params.user;
  entity.amount = event.params.amount;
  entity.timestamp = event.block.timestamp;
  entity.save();
}
