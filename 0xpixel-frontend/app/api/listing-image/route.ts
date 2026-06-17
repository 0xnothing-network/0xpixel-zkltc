import { NextResponse } from "next/server";
import { getListingImage } from "@/lib/contract";

export const runtime = "nodejs";
export const revalidate = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("tokenId");
  if (!raw || !/^\d+$/.test(raw)) {
    return NextResponse.json({ error: "Invalid tokenId" }, { status: 400 });
  }
  try {
    const imageUrl = await getListingImage(BigInt(raw));
    return NextResponse.json({ tokenId: raw, imageUrl });
  } catch (err) {
    const message = (err as Error).message || "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
