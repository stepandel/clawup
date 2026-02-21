import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";

/** Update a credential */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.credential.findFirst({
    where: { id: params.id, userId: token.id as string },
  });

  if (!existing) {
    return NextResponse.json({ error: "Credential not found" }, { status: 404 });
  }

  const body = await req.json();
  const { label, credentials: creds } = body;

  const updateData: Record<string, unknown> = {};
  if (label) updateData.label = label;

  if (creds) {
    const primaryValue = typeof creds === "string" ? creds : Object.values(creds)[0];
    const primaryKey = typeof primaryValue === "string" ? primaryValue : null;
    updateData.lastFour = primaryKey ? primaryKey.slice(-4) : "****";

    const credsJson = typeof creds === "string" ? creds : JSON.stringify(creds);
    const encrypted = encrypt(credsJson);
    updateData.encryptedData = encrypted.encryptedData;
    updateData.iv = encrypted.iv;
    updateData.authTag = encrypted.authTag;
  }

  const credential = await prisma.credential.update({
    where: { id: params.id },
    data: updateData,
    select: {
      id: true,
      provider: true,
      label: true,
      lastFour: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ credential });
}

/** Delete a credential */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.credential.findFirst({
    where: { id: params.id, userId: token.id as string },
  });

  if (!existing) {
    return NextResponse.json({ error: "Credential not found" }, { status: 404 });
  }

  await prisma.credential.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
