import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `@sh/lambdaplex` is imported by client components, so its main entry must never pull in the modules that hold or
 * use API keys and Hedera operator keys. Those live behind `@sh/lambdaplex/server` (import "server-only").
 */
describe("package entry points", () => {
  const read = (file: string) => readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8");

  it("keeps signing, the authenticated client and HCS publishing out of the browser entry", () => {
    const index = read("index.ts");
    for (const serverModule of ["./client", "./signing", "./hcs"]) expect(index).not.toContain(serverModule);
  });

  it("exposes them from the server entry", () => {
    const server = read("server.ts");
    for (const serverModule of ["./client", "./signing", "./hcs"]) expect(server).toContain(serverModule);
  });
});
