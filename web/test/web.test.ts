import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecallAlertModal } from "../components/RecallAlertModal.js";
import { shouldTriggerConfetti, StatusBanner } from "../components/StatusBanner.js";
import { registerPasskeySmartWallet } from "../lib/passkey.js";

vi.mock("canvas-confetti", () => ({
  default: {
    create: vi.fn(() => Object.assign(vi.fn(), { reset: vi.fn() })),
  },
}));
import {
  buildUnsignedRegistryTxXdr,
  getFileDownloadUrl,
  PUBLIC_CONFIG,
  signRegistryTxWithSecret,
  verifyProduct,
} from "../lib/stellar.js";

describe("@veritag/web verification & passkey wallet logic", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Offline test mode")),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves offline/demo verification states accurately across serial patterns", async () => {
    const brand = "GB7TAYRUZGE6TVT7NHP5SMIZRNQA6PLM423EYISAOAP3MKYIQMVYP2JO";
    const batch = "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b";

    const unclaimed = await verifyProduct(brand, batch, "CH-2026-000101");
    expect(unclaimed.status).toBe("AuthenticInactive");
    expect(unclaimed.authentic).toBe(true);

    const active = await verifyProduct(brand, batch, "CH-2026-ACTIVE-04");
    expect(active.status).toBe("AuthenticActive");
    expect(active.unit?.warrantyValid).toBe(true);

    const dup = await verifyProduct(brand, batch, "CH-2026-DUP-88");
    expect(dup.status).toBe("AlreadyClaimedWarning");
    expect(dup.suspiciousScanVolume).toBe(true);

    const recalled = await verifyProduct(brand, batch, "CH-2026-RECALL-19");
    expect(recalled.status).toBe("Recalled");

    const fake = await verifyProduct(brand, batch, "FAKE-000999");
    expect(fake.status).toBe("Unknown");
    expect(fake.authentic).toBe(false);
  });

  it("generates P-256 passkey wallet credentials and formats file download URLs", async () => {
    const cred = await registerPasskeySmartWallet("Test Consumer Passkey");
    expect(cred.publicKeyHex.length).toBe(130);
    expect(cred.publicKeyHex.startsWith("04")).toBe(true);
    expect(cred.stellarSmartAddress.startsWith("C")).toBe(true);
    expect(cred.stellarSmartAddress.length).toBe(56);

    const fileUrl = getFileDownloadUrl("a".repeat(64));
    expect(fileUrl).toContain("/v1/files/" + "a".repeat(64));

    const kp = Keypair.random();
    const unsignedXdr = buildUnsignedRegistryTxXdr({
      callerAddress: kp.publicKey(),
      method: "commit_batch",
    });
    const signedXdr = signRegistryTxWithSecret(unsignedXdr, kp.secret());
    const parsedTx = TransactionBuilder.fromXDR(signedXdr, PUBLIC_CONFIG.networkPassphrase);
    expect(parsedTx.signatures.length).toBe(1);

    const passkeyUnsignedXdr = buildUnsignedRegistryTxXdr({
      callerAddress: cred.stellarSmartAddress,
      method: "activate",
    });
    expect(passkeyUnsignedXdr.length).toBeGreaterThan(20);
  });

  it("conditionally triggers confetti only for first-time authentic activations without reduced motion", () => {
    expect(shouldTriggerConfetti("AuthenticInactive", true, false)).toBe(true);
    expect(shouldTriggerConfetti("AuthenticActive", true, false)).toBe(true);
    expect(shouldTriggerConfetti("AuthenticActive", false, false)).toBe(false);
    expect(shouldTriggerConfetti("AuthenticInactive", true, true)).toBe(false);
    expect(shouldTriggerConfetti("Recalled", true, false)).toBe(false);
    expect(shouldTriggerConfetti("Flagged", true, false)).toBe(false);
    expect(shouldTriggerConfetti("Unknown", true, false)).toBe(false);
  });

  it("renders pulsing red recall banner and high-urgency RecallAlertModal", () => {
    const bannerHtml = renderToStaticMarkup(
      React.createElement(StatusBanner, { status: "Recalled" }),
    );
    expect(bannerHtml).toContain("Product Recall Active");
    expect(bannerHtml).toContain("animate-pulse");
    expect(bannerHtml).toContain("bg-red-50");

    const modalHtml = renderToStaticMarkup(
      React.createElement(RecallAlertModal, {
        brandDomain: "nordic-med.eu",
        batchId: "BATCH-99",
        serial: "CH-2026-RECALL-19",
        reasonCode: "CLASS-I-BATTERY-THERMAL",
        severity: "Class I",
        officialNotice: "Immediate fire hazard recall. Discontinue use.",
      }),
    );
    expect(modalHtml).toContain("CLASS-I-BATTERY-THERMAL");
    expect(modalHtml).toContain("Class I");
    expect(modalHtml).toContain("Immediate fire hazard recall. Discontinue use.");
    expect(modalHtml).toContain("File Recall Return / Contact Support");
  });
});
