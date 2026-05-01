import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { generatePDF } from "@/server/services/pdf-generator";

interface Context {
  params: Promise<{ reportId: string }>;
}

export async function GET(req: NextRequest, { params }: Context) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { reportId } = await params;

  try {
    const { buffer, filename } = await generatePDF(reportId);
    return new Response(buffer.buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (error) {
    return new Response("Failed to generate PDF", { status: 500 });
  }
}
