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
      manifest: true,
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

/** Destroy a deployment */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const deployment = await prisma.deployment.findFirst({
    where: { id: params.id, userId: token.id as string },
  });

  if (!deployment) {
    return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
  }

  // If there's a Pulumi stack, attempt to destroy it
  if (deployment.pulumiStack) {
    try {
      const { LocalWorkspace } = await import("@pulumi/pulumi/automation");
      const stack = await LocalWorkspace.selectStack({
        stackName: deployment.pulumiStack,
        workDir: process.cwd(),
      });
      await stack.destroy({ onOutput: console.log });
      await stack.workspace.removeStack(deployment.pulumiStack);
    } catch (err) {
      console.error("Pulumi destroy error:", err);
      // Continue with DB cleanup even if Pulumi destroy fails
    }
  }

  await prisma.deployment.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
