"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { litvm } from "@/config/wagmi";
import { useToast } from "@/components/Toast";
import {
  ZEROXN_ABI,
  ZEROXN_ADDRESS,
  type ZeroxNPost,
} from "@/lib/0xNAbi";
import {
  PanelTitle,
  PixelPanel,
  PostCard,
  ProfileBadge,
  isProfileReady,
  shortAddress,
  type OwnedPixelOption,
  type SocialTxRequest,
} from "../../SocialComponents";

export default function ZeroxPostPage() {
  const params = useParams<{ postId: string }>();
  const postId = useMemo(() => {
    try {
      return BigInt(params.postId || "0");
    } catch {
      return 0n;
    }
  }, [params.postId]);

  const [mounted, setMounted] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [ownedPixels, setOwnedPixels] = useState<OwnedPixelOption[]>([]);
  const [ownedPixelsLoading, setOwnedPixelsLoading] = useState(false);
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: litvm.id });
  const { writeContractAsync } = useWriteContract();
  const toast = useToast();

  useEffect(() => setMounted(true), []);

  const { data, refetch } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "posts",
    args: [postId],
    query: { enabled: postId > 0n },
  });
  const post = data as ZeroxNPost | undefined;

  const { data: profileData } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "profiles",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });
  const hasProfile = isProfileReady(profileData);
  const canInteract = mounted && hasProfile;
  const visiblePost = mounted ? post : undefined;

  useEffect(() => {
    if (!address) {
      setOwnedPixels([]);
      return;
    }

    const controller = new AbortController();
    setOwnedPixelsLoading(true);
    fetch(`/api/user-nfts?address=${address}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<{ tokens?: OwnedPixelOption[] }>;
      })
      .then((body) => setOwnedPixels(body.tokens ?? []))
      .catch((error) => {
        if (error?.name !== "AbortError") setOwnedPixels([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setOwnedPixelsLoading(false);
      });

    return () => controller.abort();
  }, [address, refreshKey]);

  async function runTx(label: string, request: SocialTxRequest) {
    if (!isConnected) {
      toast.warning("Connect wallet", "Connect your wallet to use 0x.");
      return;
    }
    if (!hasProfile) {
      toast.warning("Create account first", "Open 0x and create your onchain profile before interacting.");
      return;
    }
    if (!publicClient) {
      toast.error("RPC unavailable", "Please refresh and try again.");
      return;
    }
    if (chainId !== litvm.id) {
      await switchChainAsync({ chainId: litvm.id });
    }
    try {
      const hash = await writeContractAsync({
        address: ZEROXN_ADDRESS,
        abi: ZEROXN_ABI,
        functionName: request.functionName as never,
        args: (request.args ?? []) as never,
      });
      toast.info(`${label} sent`, shortAddress(hash));
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success(`${label} confirmed`);
      setRefreshKey((value) => value + 1);
      void refetch();
    } catch (error) {
      toast.handleError(error, `${label} failed`);
    }
  }

  const connectWallet = () => {
    const connector = connectors[0];
    if (connector) connect({ connector });
  };

  return (
    <div className="pixel-shell pixel-app-shell zeroxn-social min-h-screen bg-black text-white">
      <header className="zeroxn-topbar zeroxn-app-header border-b border-white/10 bg-black px-4 py-4">
        <div className="zeroxn-app-header-inner mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <Link href="/0x" className="zeroxn-app-brand flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center border border-white/15 bg-black text-xs font-bold">0x</span>
            <span className="text-lg font-bold">0x</span>
          </Link>
          <div className="zeroxn-app-actions flex items-center gap-2">
            <Link href="/0x" className="pixel-btn-soft pixel-btn-soft-secondary pixel-btn-soft-sm">
              Feed
            </Link>
            {mounted && isConnected ? (
              <button type="button" className="pixel-btn-soft pixel-btn-soft-sm" onClick={() => disconnect()}>
                {shortAddress(address)}
              </button>
            ) : (
              <button
                type="button"
                className="pixel-btn-soft pixel-btn-soft-indigo pixel-btn-soft-sm"
                onClick={connectWallet}
                disabled={!mounted || isConnecting}
              >
                {isConnecting ? "Connecting" : "Connect"}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8">
        <PixelPanel>
          <PanelTitle title={`Post #${postId.toString()}`} right={<span className="text-[10px] text-white/42">0x link</span>} />
          <div className="grid gap-4 p-4">
            {!mounted ? (
              <p className="text-sm text-white/45">Loading post...</p>
            ) : visiblePost && visiblePost[0] !== "0x0000000000000000000000000000000000000000" ? (
              <>
                <div className="border border-white/10 bg-white/[0.02] p-3">
                  <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-white/42">Author</p>
                  <ProfileBadge address={visiblePost[0]} />
                </div>
                {mounted && isConnected && !hasProfile ? (
                  <div className="border border-[var(--pixel-amber)]/45 bg-[rgba(255,226,92,0.08)] p-4 text-sm leading-relaxed text-white/70">
                    Create a 0x account before liking, commenting, or sharing.
                    <Link href="/0x" className="ml-2 text-[var(--pixel-amber)] underline underline-offset-4">
                      Create account
                    </Link>
                  </div>
                ) : null}
                <PostCard
                  key={`${postId.toString()}-${refreshKey}`}
                  postId={postId}
                  post={visiblePost}
                  viewer={canInteract ? address : undefined}
                  runTx={runTx}
                  detailed
                  ownedPixels={ownedPixels}
                  ownedPixelsLoading={ownedPixelsLoading}
                />
              </>
            ) : (
              <p className="text-sm text-white/45">Post not found.</p>
            )}
          </div>
        </PixelPanel>
      </main>
    </div>
  );
}
