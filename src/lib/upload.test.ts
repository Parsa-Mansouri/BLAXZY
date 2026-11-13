import { describe, expect, it, vi } from "vitest";
import {
  fileExtension,
  fileMime,
  fileProblem,
  putFile,
  UploadError,
  uploadViaTicket,
  type UploadTicket,
} from "./upload";

const file = { name: "a.png", size: 10 } as File;
const ticket: UploadTicket = {
  uploadUrl: "https://s3/x",
  headers: { "Content-Type": "image/png", "If-None-Match": "*" },
  fileId: "f1",
};
const okTicket = async () => ({ ok: true as const, data: ticket });
const okConfirm = async () => ({ ok: true as const, data: "done" });

describe("uploadViaTicket", () => {
  it("runs ticket, put with the ticket's headers, confirm", async () => {
    const calls: string[] = [];
    const put = vi.fn<typeof putFile>(async () => {
      calls.push("put");
    });
    const out = await uploadViaTicket({
      createTicket: async () => {
        calls.push("ticket");
        return { ok: true, data: ticket };
      },
      file,
      confirm: async (id) => {
        calls.push(`confirm:${id}`);
        return { ok: true, data: "done" };
      },
      put,
    });
    expect(out).toEqual({ ok: true, fileId: "f1", confirmed: "done" });
    expect(calls).toEqual(["ticket", "put", "confirm:f1"]);
    expect(put.mock.calls[0]?.[1]).toBe(ticket.headers);
  });

  it("returns a ticket refusal as is and never puts", async () => {
    const put = vi.fn();
    const out = await uploadViaTicket({
      createTicket: async () => ({ ok: false, error: "No room" }),
      file,
      confirm: okConfirm,
      put,
    });
    expect(out).toEqual({ ok: false, error: "No room" });
    expect(put).not.toHaveBeenCalled();
  });

  it("turns a thrown ticket action into an error result", async () => {
    const out = await uploadViaTicket({
      createTicket: async () => {
        throw new Error("network");
      },
      file,
      confirm: okConfirm,
      put: vi.fn(),
    });
    expect(out.ok).toBe(false);
  });

  it("retries a failed put once, then gives up with the message", async () => {
    const put = vi.fn(async () => {
      throw new UploadError("network");
    });
    const out = await uploadViaTicket({
      createTicket: okTicket,
      file,
      confirm: okConfirm,
      put,
      uploadFailedMessage: "Upload failed.",
    });
    expect(put).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ ok: false, error: "Upload failed." });
  });

  it("does not retry a 403", async () => {
    const put = vi.fn(async () => {
      throw new UploadError("http", 403);
    });
    await uploadViaTicket({ createTicket: okTicket, file, confirm: okConfirm, put });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("treats a 412 on the second put as already uploaded", async () => {
    let n = 0;
    const put = vi.fn(async () => {
      n++;
      throw n === 1 ? new UploadError("network") : new UploadError("http", 412);
    });
    const confirm = vi.fn(okConfirm);
    const out = await uploadViaTicket({ createTicket: okTicket, file, confirm, put });
    expect(out.ok).toBe(true);
    expect(confirm).toHaveBeenCalledWith("f1");
  });

  it("retries confirm once with the same file id after a throw", async () => {
    const ids: string[] = [];
    let n = 0;
    const out = await uploadViaTicket({
      createTicket: okTicket,
      file,
      confirm: async (id) => {
        ids.push(id);
        if (++n === 1) throw new Error("drop");
        return { ok: true, data: "done" };
      },
      put: vi.fn(async () => {}),
    });
    expect(ids).toEqual(["f1", "f1"]);
    expect(out.ok).toBe(true);
  });

  it("does not retry a confirm refusal", async () => {
    const confirm = vi.fn(async () => ({ ok: false as const, error: "Bad file" }));
    const out = await uploadViaTicket({
      createTicket: okTicket,
      file,
      confirm,
      put: vi.fn(async () => {}),
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ ok: false, error: "Bad file" });
  });

  it("gives an error when confirm throws twice", async () => {
    const out = await uploadViaTicket({
      createTicket: okTicket,
      file,
      confirm: async () => {
        throw new Error("x");
      },
      put: vi.fn(async () => {}),
    });
    expect(out.ok).toBe(false);
  });

  it("stops at an abort without confirming", async () => {
    const controller = new AbortController();
    const confirm = vi.fn(okConfirm);
    const out = await uploadViaTicket({
      createTicket: okTicket,
      file,
      confirm,
      signal: controller.signal,
      put: async () => {
        controller.abort();
        throw new UploadError("abort");
      },
    });
    expect(out).toMatchObject({ ok: false, aborted: true });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("does nothing when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const createTicket = vi.fn(okTicket);
    const out = await uploadViaTicket({
      createTicket,
      file,
      confirm: okConfirm,
      signal: controller.signal,
    });
    expect(out).toMatchObject({ aborted: true });
    expect(createTicket).not.toHaveBeenCalled();
  });

  it("reports the phases in order", async () => {
    const phases: string[] = [];
    await uploadViaTicket({
      createTicket: okTicket,
      file,
      confirm: okConfirm,
      onPhase: (p) => phases.push(p),
      put: vi.fn(async () => {}),
    });
    expect(phases).toEqual(["uploading", "confirming"]);
  });
});

describe("file helpers", () => {
  const types = { png: "image/png" };
  const messages = { type: "type", empty: "empty", size: "size" };

  it("finds the extension and mime", () => {
    expect(fileExtension("A.B.PNG")).toBe("png");
    expect(fileExtension("noext")).toBe("");
    expect(fileMime({ name: "x.PNG" }, types)).toBe("image/png");
    expect(fileMime({ name: "x.gif" }, types)).toBe("");
  });

  it("checks type, empty and size in that order", () => {
    const opts = { types, maxBytes: 100, messages };
    expect(fileProblem({ name: "a.gif", size: 1 }, opts)).toBe("type");
    expect(fileProblem({ name: "a.png", size: 0 }, opts)).toBe("empty");
    expect(fileProblem({ name: "a.png", size: 101 }, opts)).toBe("size");
    expect(fileProblem({ name: "a.png", size: 100 }, opts)).toBeNull();
  });
});
