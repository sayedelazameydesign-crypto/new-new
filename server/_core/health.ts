import type { Express, Request, Response } from "express";

export function registerHealthRoute(app: Express) {
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
}
