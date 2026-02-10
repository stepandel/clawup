import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";

/** Get deployment status and logs */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const deployment = await prisma.deployment.findFirst({
    where: { id: params.id, userId: token.id as string },
    select: {
      id: true,
      stackName: true,
      status: true,
      logs: true,
      errorMessage: true,
      pulumiStack: true,
      createdAt: true,
      updatedAt: true,
      credential: {
        select: { provider: true, label: true },
      },
    },
  });

  if (!deployment) {
    return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
  }

  return NextResponse.json({ deployment });
}
