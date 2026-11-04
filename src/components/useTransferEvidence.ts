import { useEffect, useState } from "react";
import {
  fetchBankTransferReceipts,
  fetchWhatsAppTransferEvidence,
  fetchWhatsAppBankTransferEvidence,
  type BankTransferReceipt,
  type Receipt,
  type WhatsAppBankTransferEvidence,
} from "../api";

export function useTransferEvidence(periodId: string | null, refreshKey?: string | null) {
  const [bankReceipts, setBankReceipts] = useState<BankTransferReceipt[]>([]);
  const [whatsAppEvidence, setWhatsAppEvidence] = useState<Receipt[]>([]);
  const [whatsAppBankEvidence, setWhatsAppBankEvidence] = useState<WhatsAppBankTransferEvidence[]>([]);
  const [loading, setLoading] = useState(Boolean(periodId));
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setBankReceipts([]);
    setWhatsAppEvidence([]);
    setWhatsAppBankEvidence([]);
    setError("");
    if (!periodId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      fetchBankTransferReceipts(periodId),
      fetchWhatsAppTransferEvidence(periodId),
      fetchWhatsAppBankTransferEvidence(periodId),
    ]).then(([bankResult, whatsAppResult, whatsappBankResult]) => {
      if (cancelled) return;
      if (bankResult.status === "fulfilled") setBankReceipts(bankResult.value);
      if (whatsAppResult.status === "fulfilled") setWhatsAppEvidence(whatsAppResult.value);
      if (whatsappBankResult.status === "fulfilled") setWhatsAppBankEvidence(whatsappBankResult.value);
      const failure = bankResult.status === "rejected"
        ? bankResult.reason
        : whatsAppResult.status === "rejected"
          ? whatsAppResult.reason
          : whatsappBankResult.status === "rejected"
            ? whatsappBankResult.reason
            : null;
      if (failure) {
        const detail = failure && typeof failure === "object" && "message" in failure
          ? String(failure.message)
          : "Please try again.";
        setError(`Couldn’t load all bank-transfer evidence. ${detail}`);
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [periodId, refreshKey, reloadKey]);

  return {
    bankReceipts,
    whatsAppEvidence,
    whatsAppBankEvidence,
    loading,
    error,
    retry: () => setReloadKey((key) => key + 1),
  };
}
