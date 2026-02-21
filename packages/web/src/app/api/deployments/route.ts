import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { runDeployment } from "@/lib/deploy";

/** List deployments for the current user */
export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const deployments = await prisma.deployment.findMany({
    where: { userId: token.id as string },
    select: {
      id: true,
      stackName: true,
      status: true,
      errorMessage: true,
      pulumiStack: true,
      createdAt: true,
      updatedAt: true,
      credential: {
        select: { provider: true, label: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ deployments });
}

/** Create and start a new deployment */
export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { credentialId, manifest } = body;

  if (!credentialId || !manifest) {
    return NextResponse.json(
      { error: "credentialId and manifest are required" },
      { status: 400 }
    );
  }

  if (!manifest.stackName) {
    return NextResponse.json(
      { error: "manifest.stackName is required" },
      { status: 400 }
    );
  }

  // Verify credential belongs to user
  const credential = await prisma.credential.findFirst({
    where: { id: credentialId, userId: token.id as string },
  });

  if (!credential) {
    return NextResponse.json({ error: "Credential not found" }, { status: 404 });
  }

  // Check for existing deployment with same stack name
  const existing = await prisma.deployment.findFirst({
    where: { userId: token.id as string, stackName: manifest.stackName },
  });

  if (existing && existing.status === "running") {
    return NextResponse.json(
      { error: "A deployment is already running for this stack" },
      { status: 409 }
    );
  }

  // Create or update deployment record
  const deployment = await prisma.deployment.upsert({
    where: {
      userId_stackName: {
        userId: token.id as string,
        stackName: manifest.stackName,
      },
    },
    create: {
      userId: token.id as string,
      credentialId,
      stackName: manifest.stackName,
      manifest: JSON.stringify(manifest),
      status: "queued",
    },
    update: {
      credentialId,
      manifest: JSON.stringify(manifest),
      status: "queued",
      errorMessage: null,
      logs: "",
    },
    select: {
      id: true,
      stackName: true,
      status: true,
      createdAt: true,
    },
  });

  // Start deployment asynchronously (fire and forget)
  runDeployment(deployment.id).catch((err) => {
    console.error(`Deployment ${deployment.id} failed:`, err);
  });

  return NextResponse.json({ deployment }, { status: 201 });
}
