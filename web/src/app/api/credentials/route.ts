import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";

/** List credentials (metadata only) */
export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const credentials = await prisma.credential.findMany({
    where: { userId: token.id as string },
    select: {
      id: true,
      provider: true,
      label: true,
      lastFour: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ credentials });
}

/** Create a new credential */
export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { provider, label, credentials: creds } = body;

  if (!provider || !label || !creds) {
    return NextResponse.json(
      { error: "provider, label, and credentials are required" },
      { status: 400 }
    );
  }

  // Determine last 4 chars from the primary credential value
  const primaryValue = typeof creds === "string" ? creds : Object.values(creds)[0];
    const primaryKey = typeof primaryValue === "string" ? primaryValue : null;
  const lastFour = primaryKey ? primaryKey.slice(-4) : "****";

  // Encrypt the credentials
  const credsJson = typeof creds === "string" ? creds : JSON.stringify(creds);
  const encrypted = encrypt(credsJson);

  const credential = await prisma.credential.create({
    data: {
      userId: token.id as string,
      provider,
      label,
      encryptedData: encrypted.encryptedData,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      lastFour,
    },
    select: {
      id: true,
      provider: true,
      label: true,
      lastFour: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ credential }, { status: 201 });
}
