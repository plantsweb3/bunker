import { getConfig } from "@/lib/bunker-config";
export function GET() {
  return Response.json(getConfig(), {
    headers: { "Cache-Control": "no-store" },
  });
}
