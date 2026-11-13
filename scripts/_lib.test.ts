import { describe, expect, it } from "vitest";
import { hostOfDatabaseUrl, isLocalHost } from "./_lib";

describe("isLocalHost", () => {
  it("accepts loopback addresses and the docker-compose service names", () => {
    for (const h of ["localhost", "LOCALHOST", "127.0.0.1", "::1", "[::1]", "postgres", "minio"]) {
      expect(isLocalHost(h)).toBe(true);
    }
    expect(isLocalHost("app.localhost")).toBe(true);
  });

  it("rejects remote hosts, lookalikes and empty values", () => {
    for (const h of [
      "db.example.com",
      "localhost.evil.com",
      "127.0.0.1.evil.com",
      "10.0.0.5",
      "postgres.prod.internal",
      "",
      null,
      undefined,
    ]) {
      expect(isLocalHost(h)).toBe(false);
    }
  });
});

describe("hostOfDatabaseUrl", () => {
  it("reads the host and never needs the credentials", () => {
    expect(hostOfDatabaseUrl("postgres://u:p@localhost:5432/blaxzy")).toBe("localhost");
    expect(hostOfDatabaseUrl("postgresql://u:p@db.example.com/x")).toBe("db.example.com");
    expect(hostOfDatabaseUrl("postgres://u:p@[::1]:5432/x")).toBe("::1");
  });

  it("returns null for garbage", () => {
    expect(hostOfDatabaseUrl("not a url")).toBeNull();
    expect(hostOfDatabaseUrl(undefined)).toBeNull();
  });
});
