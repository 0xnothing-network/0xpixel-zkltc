import { redirect } from "next/navigation";

export default async function LegacyZeroxNPostRedirect({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;
  redirect(`/0x/p/${postId}`);
}
