import { type NextRequest, NextResponse } from "next/server";
import { cancelJob, getJob } from "~~/lib/twapJobs.server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const job = getJob((await params).id);
  return job ? NextResponse.json(job) : NextResponse.json({ error: "Unknown job" }, { status: 404 });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getJob(id)) return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  cancelJob(id);
  return NextResponse.json(getJob(id));
}
