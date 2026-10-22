import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { copyToClipboard } from "../lib/clipboard";

const REVIEW_URL =
  "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4";

function installFakeDom({ execCommandResult }: { execCommandResult: boolean | "throw" }) {
  const appended: unknown[] = [];
  const removed: unknown[] = [];

  const fakeDocument = {
    body: {
      appendChild: (node: unknown) => {
        appended.push(node);
      },
      removeChild: (node: unknown) => {
        removed.push(node);
      },
    },
    createElement: () => ({
      value: "",
      style: {},
      setAttribute: () => {},
      select: () => {},
      setSelectionRange: () => {},
    }),
    execCommand: (command: string) => {
      assert.equal(command, "copy");
      if (execCommandResult === "throw") {
        throw new Error("execCommand tidak tersedia");
      }
      return execCommandResult;
    },
  };

  Object.defineProperty(globalThis, "document", {
    value: fakeDocument,
    configurable: true,
    writable: true,
  });

  return { appended, removed };
}

function installFakeWindow(secure: boolean) {
  Object.defineProperty(globalThis, "window", {
    value: { isSecureContext: secure },
    configurable: true,
    writable: true,
  });
}

function installFakeNavigator(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(globalThis, "navigator", {
    value: writeText ? { clipboard: { writeText } } : {},
    configurable: true,
    writable: true,
  });
}

function resetGlobals() {
  for (const key of ["document", "window", "navigator"]) {
    try {
      delete (globalThis as unknown as Record<string, unknown>)[key];
    } catch {
      Object.defineProperty(globalThis, key, {
        value: undefined,
        configurable: true,
        writable: true,
      });
    }
  }
}

afterEach(resetGlobals);

describe("copyToClipboard", () => {
  it("refuses to copy empty text", async () => {
    const result = await copyToClipboard("");
    assert.equal(result.ok, false);
    assert.equal(result.strategy, "none");
  });

  it("uses the async Clipboard API in a secure context", async () => {
    let copied = "";
    installFakeWindow(true);
    installFakeNavigator(async (text) => {
      copied = text;
    });

    const result = await copyToClipboard(REVIEW_URL);

    assert.equal(result.ok, true);
    assert.equal(result.strategy, "clipboard-api");
    assert.equal(copied, REVIEW_URL);
  });

  it("falls back to execCommand when the Clipboard API rejects", async () => {
    installFakeWindow(true);
    installFakeNavigator(async () => {
      throw new Error("NotAllowedError");
    });
    const { appended, removed } = installFakeDom({ execCommandResult: true });

    const result = await copyToClipboard(REVIEW_URL);

    assert.equal(result.ok, true);
    assert.equal(result.strategy, "exec-command");
    assert.equal(appended.length, 1);
    assert.equal(removed.length, 1, "the temporary textarea must be cleaned up");
  });

  it("reports a failure when both strategies fail", async () => {
    installFakeWindow(true);
    installFakeNavigator(async () => {
      throw new Error("NotAllowedError");
    });
    installFakeDom({ execCommandResult: false });

    const result = await copyToClipboard(REVIEW_URL);

    assert.equal(result.ok, false);
    assert.equal(result.strategy, "none");
    assert.equal(typeof result.error, "string");
  });

  it("surfaces the reason when execCommand throws", async () => {
    installFakeWindow(false);
    installFakeNavigator();
    installFakeDom({ execCommandResult: "throw" });

    const result = await copyToClipboard(REVIEW_URL);

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /execCommand/);
  });
});
