"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Accessibility } from "lucide-react";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import {
  PageHeading,
  StatusBadge,
  Feedback,
  LoadingState,
  EmptyState,
} from "@/components/ui/page-elements";
type Review = {
  id: string;
  mall_id: string;
  mallName?: string;
  userLabel?: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  reviewed_at: string | null;
};
type Context = {
  mallId: string;
  approved: boolean;
  request: Review | null;
  policy: { review_notice: string; oku_enabled: boolean } | null;
  serverTime: string;
};
const notice =
  "Demo eligibility review. This does not implement a real-world verification process.";
export function EligibilityPanel({ admin = false }: { admin?: boolean }) {
  const [malls, setMalls] = useState<{ id: string; name: string }[]>([]),
    [mall, setMall] = useState(""),
    [context, setContext] = useState<Context | null>(null),
    [reviews, setReviews] = useState<Review[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [expiry, setExpiry] = useState("");
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    setError("");
    setLoading(true);
    try {
      if (admin) {
        const rows = await api<Review[]>("admin/eligibility");
        if (current === revision.current) setReviews(rows);
      } else if (mall) {
        const result = await api<Context>("me/eligibility?mallId=" + mall);
        if (current === revision.current) setContext(result);
      }
    } catch (e) {
      if (current === revision.current) setError((e as Error).message);
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, [admin, mall]);
  useEffect(() => {
    if (admin) return;
    api<{ id: string; name: string }[]>("malls")
      .then((ms) => {
        setMalls(ms);
        const requested = new URLSearchParams(window.location.search).get(
          "mallId",
        );
        setMall(
          ms.some((m) => m.id === requested) ? requested! : (ms[0]?.id ?? ""),
        );
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [admin]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  async function act(path: string, body: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(path, body);
      await refresh();
      setMessage("Eligibility request updated.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-container space-y-6">
      <PageHeading
        eyebrow={admin ? "Protected administration" : "Mall parking policy"}
        description={notice}
      >
        {admin ? "OKU eligibility reviews" : "OKU / accessible parking"}
      </PageHeading>
      <p className="notice flex items-start gap-3">
        <Accessibility aria-hidden="true" className="shrink-0" />
        <span>
          Restricted to eligible users under the mall’s parking rules. Review is
          mall-scoped. Do not submit medical information, identity documents,
          registration numbers or supporting evidence. No documents are
          collected.
        </span>
      </p>
      {error && (
        <>
          <Feedback error>{error}</Feedback>
          <Link
            className="text-link"
            href={
              "/auth?returnTo=" +
              encodeURIComponent(
                admin ? "/admin/eligibility" : "/eligibility?mallId=" + mall,
              )
            }
          >
            Sign in to continue
          </Link>
        </>
      )}
      {message && <Feedback>{message}</Feedback>}
      {!admin && (
        <section className="panel">
          <label>
            Mall
            <select
              value={mall}
              onChange={(e) => {
                if (e.target.value === mall) return;
                setMall(e.target.value);
                setContext(null);
                setMessage("");
              }}
            >
              {malls.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          {context && context.mallId === mall && (
            <div className="mt-5 space-y-3">
              <p>
                Review status:{" "}
                <StatusBadge>
                  {context.request?.status ?? "not_declared"}
                </StatusBadge>
              </p>
              <p>
                {context.approved
                  ? "Approved for OKU booking at this mall. Availability and route requirements still apply."
                  : "Current approved eligibility is required to reserve OKU-only bays. Standard bays remain available to book."}
              </p>
              {context.request?.status === "approved" && !context.approved && (
                <p className="notice">
                  Approval is expired or the mall policy has changed. Request
                  another review.
                </p>
              )}
              {context.request?.expires_at && (
                <p className="text-sm muted">
                  Expiry:{" "}
                  {new Date(context.request.expires_at).toLocaleString()}
                </p>
              )}
              <Button
                disabled={
                  busy ||
                  context.approved ||
                  context.request?.status === "pending" ||
                  !context.policy?.oku_enabled
                }
                onClick={() => act("me/eligibility", { mallId: mall })}
              >
                {context.request?.status === "pending"
                  ? "Review pending"
                  : "Request simulated eligibility review"}
              </Button>
              <p className="text-sm muted">
                A verified step-free route is separate from eligibility.
                Approval does not guarantee a vacant bay or certify a real-world
                route.
              </p>
            </div>
          )}
        </section>
      )}
      {loading && <LoadingState />}
      {admin && (
        <label className="block max-w-sm">
          Optional approval expiry
          <input
            type="datetime-local"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          />
          <span className="text-xs muted">
            Local browser time. Leave blank for no expiry.
          </span>
        </label>
      )}
      {admin &&
        !loading &&
        (reviews.length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {reviews.map((r) => (
              <article className="panel space-y-3" key={r.id}>
                <h2 className="text-xl font-semibold">{r.userLabel}</h2>
                <p>{r.mallName} · OKU</p>
                <StatusBadge>{r.status}</StatusBadge>
                <p className="text-sm muted">
                  Requested {new Date(r.created_at).toLocaleString()}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    disabled={busy || r.status === "approved"}
                    onClick={() =>
                      act("admin/eligibility/" + r.id + "/review", {
                        status: "approved",
                        expiresAt: expiry
                          ? new Date(expiry).toISOString()
                          : null,
                      })
                    }
                  >
                    Approve demo request
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || r.status === "rejected"}
                    onClick={() =>
                      act("admin/eligibility/" + r.id + "/review", {
                        status: "rejected",
                      })
                    }
                  >
                    Reject demo request
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState>No eligibility requests to review.</EmptyState>
        ))}
      <div className="flex flex-wrap gap-4">
        <Button variant="outline" disabled={busy || loading} onClick={refresh}>
          Refresh eligibility
        </Button>
        <Link className="text-link" href="/parking">
          Find standard and OKU parking
        </Link>
        {admin && (
          <Link className="text-link" href="/admin/demo">
            Demo controls
          </Link>
        )}
      </div>
    </div>
  );
}
