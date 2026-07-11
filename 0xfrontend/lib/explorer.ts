const DEFAULT_LITVM_EXPLORER_URL = "https://liteforge.explorer.caldera.xyz";

export const LITVM_EXPLORER_URL = (
  process.env.NEXT_PUBLIC_LITVM_EXPLORER_URL || DEFAULT_LITVM_EXPLORER_URL
).replace(/\/+$/, "");

export function getAddressExplorerUrl(address: string): string {
  return `${LITVM_EXPLORER_URL}/address/${encodeURIComponent(address)}`;
}

export function getTokenExplorerUrl(
  address: string,
  tokenId?: bigint | number | string,
): string {
  const base = `${LITVM_EXPLORER_URL}/token/${encodeURIComponent(address)}`;
  return tokenId === undefined || tokenId === null
    ? base
    : `${base}?id=${encodeURIComponent(tokenId.toString())}`;
}

export function getTransactionExplorerUrl(txHash: string): string {
  return `${LITVM_EXPLORER_URL}/tx/${encodeURIComponent(txHash)}`;
}
