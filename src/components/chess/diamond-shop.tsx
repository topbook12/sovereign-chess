"use client";

/**
 * DiamondShop — buy diamonds with real money.
 *
 * Packages priced at 1 💎 = ৳50. Payment runs through mobile wallets
 * (bKash / Nagad / Rocket): the player sends taka to the platform number,
 * submits the TrxID here, and the platform owner verifies the order —
 * the diamonds are credited on verification (real economy, no auto-credit).
 *
 * Every order is recorded on-device AND pushed to the platform ledger
 * (/api/wallet → Turso) through the persistent retry queue, so nothing
 * is lost even offline. The bKash number itself goes live when the
 * owner fills PAYMENT_NUMBER in src/lib/diamonds.ts — until then the
 * shop shows a graceful "coming soon" notice.
 */

import { useEffect, useState } from "react";
import {
  BadgeCheck,
  Clock3,
  Gem,
  Loader2,
  ShoppingCart,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DIAMOND_EVENT,
  DIAMOND_TAKA,
  formatTaka,
  getBalance,
  getOrders,
  PAYMENT_NUMBER,
  requestPurchase,
  STORE_PACKAGES,
  type StoreOrder,
  type StorePackage,
} from "@/lib/diamonds";
import { deviceId } from "@/lib/game-store";
import { pulse } from "@/lib/haptics";
import { cn } from "@/lib/utils";

const METHODS = ["bkash", "nagad", "rocket"] as const;

function OrdersMini() {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  useEffect(() => {
    const refresh = () => setOrders(getOrders().slice(0, 4));
    const r = requestAnimationFrame(refresh);
    window.addEventListener(DIAMOND_EVENT, refresh);
    return () => {
      cancelAnimationFrame(r);
      window.removeEventListener(DIAMOND_EVENT, refresh);
    };
  }, []);

  if (orders.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-foreground/40">
        Your orders
      </p>
      <ul className="mt-2 space-y-1.5">
        {orders.map((o) => (
          <li
            key={o.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-[12px]"
          >
            <span className="font-mono font-bold text-gold-soft">{o.id}</span>
            <span className="text-foreground/55">
              {o.diamonds}
              {o.bonus > 0 && (
                <b className="text-emerald-300">+{o.bonus}</b>
              )}{" "}
              💎 · {formatTaka(o.taka)} · {o.method.toUpperCase()}
            </span>
            <span
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-black uppercase tracking-[0.14em]",
                o.status === "pending"
                  ? "bg-amber-400/15 text-amber-300"
                  : o.status === "verified"
                    ? "bg-emerald-400/15 text-emerald-300"
                    : "bg-red-400/15 text-red-300"
              )}
            >
              {o.status === "pending" && (
                <Clock3 className="h-3 w-3" />
              )}
              {o.status}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10.5px] leading-relaxed text-foreground/35">
        Diamonds are credited right after the owner verifies your payment —
        usually within minutes. Orders are safely queued on-device and synced
        to the platform ledger.
      </p>
    </div>
  );
}

export function DiamondShop() {
  const [balance, setBalance] = useState(0);
  const [pkg, setPkg] = useState<StorePackage | null>(null);
  const [method, setMethod] = useState<StoreOrder["method"]>("bkash");
  const [sender, setSender] = useState("");
  const [trx, setTrx] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const refresh = () => setBalance(getBalance());
    const r = requestAnimationFrame(refresh);
    window.addEventListener(DIAMOND_EVENT, refresh);
    return () => {
      cancelAnimationFrame(r);
      window.removeEventListener(DIAMOND_EVENT, refresh);
    };
  }, []);

  const submit = () => {
    if (!pkg) return;
    setSending(true);
    const res = requestPurchase({
      pkg,
      method,
      sender,
      trx,
      deviceId: deviceId(),
      player: `Player-${deviceId().replace(/-/g, "").slice(0, 4).toUpperCase()}`,
    });
    setSending(false);
    if ("error" in res) {
      setErr(res.error);
      pulse("illegal");
      return;
    }
    pulse("achievement");
    setNotice(
      `Order ${res.id} submitted — ${res.diamonds}${res.bonus ? `+${res.bonus}` : ""} 💎 for ${formatTaka(res.taka)} is pending verification.`
    );
    setPkg(null);
    setSender("");
    setTrx("");
    setErr(null);
  };

  const paymentReady = PAYMENT_NUMBER.trim().length > 0;

  return (
    <section
      id="diamond-shop"
      className="glass-panel glass-panel-hover scroll-mt-4 rounded-2xl p-5"
      aria-label="Diamond shop — buy diamonds with real money"
    >
      <header className="flex items-center justify-between gap-3">
        <h3 className="font-display flex items-center gap-2 text-lg font-black tracking-[0.08em]">
          <ShoppingCart className="h-5 w-5 text-gold-soft" />
          DIAMOND SHOP
        </h3>
        <span className="rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-gold-soft">
          Balance {balance} 💎
        </span>
      </header>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground/55">
        Top up your vault with real money —{" "}
        <b className="text-cyan-200">1 💎 = ৳{DIAMOND_TAKA}</b>. Pay with
        bKash / Nagad / Rocket, submit the TrxID, and the diamonds land in
        your vault after verification.
      </p>

      {/* packages */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {STORE_PACKAGES.map((p) => (
          <div
            key={p.id}
            className={cn(
              "relative flex flex-col items-center gap-1 rounded-xl border bg-white/[0.03] p-3 text-center transition-all",
              p.tag
                ? "border-gold/45 shadow-[0_0_24px_-10px_rgba(212,175,55,0.7)]"
                : "border-white/10"
            )}
          >
            {p.tag && (
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-[#8a6a24]/60 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] px-2 py-px text-[8.5px] font-black uppercase tracking-[0.14em] text-[#241a05]">
                {p.tag === "best" ? "Best value" : "Popular"}
              </span>
            )}
            <Gem className="mt-1 h-5 w-5 text-cyan-300" />
            <p className="font-mono text-xl font-black text-cyan-200">
              {p.diamonds}
              {p.bonus > 0 && (
                <b className="text-[12px] text-emerald-300">+{p.bonus}</b>
              )}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/40">
              diamonds{p.bonus > 0 ? " + bonus" : ""}
            </p>
            <p className="text-[13px] font-black text-emerald-300">
              {formatTaka(p.taka)}
            </p>
            <Button
              size="sm"
              onClick={() => {
                pulse("tick");
                setPkg(p);
                setNotice(null);
                setErr(null);
              }}
              className="mt-1 h-9 w-full border border-gold/40 bg-gradient-to-b from-gold/25 to-gold/10 px-2 text-[12px] font-black text-gold-soft hover:from-gold/40 hover:to-gold/20"
            >
              Buy
            </Button>
          </div>
        ))}
      </div>

      {!paymentReady && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11.5px] leading-relaxed text-amber-200">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            বিকাশ / নাগাদ নম্বর খুব শীঘ্রই এখানে যুক্ত হচ্ছে — the platform
            payment number goes live shortly. You can already submit an order;
            the owner will confirm it personally.
          </span>
        </p>
      )}

      {notice && (
        <p className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[12px] font-semibold text-emerald-200">
          {notice}
        </p>
      )}

      <OrdersMini />

      {/* checkout dialog */}
      <Dialog
        open={!!pkg}
        onOpenChange={(v) => {
          if (!v) setPkg(null);
        }}
      >
        <DialogContent className="glass-dialog max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2 text-xl font-black">
              <Gem className="h-5 w-5 text-cyan-300" />
              Buy {pkg?.diamonds}
              {pkg && pkg.bonus > 0 ? `+${pkg.bonus}` : ""} 💎
            </DialogTitle>
            <DialogDescription>
              {pkg && (
                <>
                  {formatTaka(pkg.taka)} · 1 💎 = ৳{DIAMOND_TAKA}
                  {pkg.bonus > 0 && (
                    <b className="text-emerald-300"> · {pkg.bonus} bonus 💎</b>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-foreground/45">
                Payment method
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      pulse("tick");
                      setMethod(m);
                    }}
                    className={cn(
                      "rounded-xl border px-2 py-2.5 text-[12px] font-black uppercase tracking-[0.1em] transition-all",
                      method === m
                        ? "border-pink-400/60 bg-pink-400/15 text-pink-200"
                        : "border-white/10 bg-white/5 text-foreground/50 hover:border-white/25"
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-[12.5px] leading-relaxed text-foreground/60">
              Send{" "}
              <b className="text-emerald-300">{pkg && formatTaka(pkg.taka)}</b>{" "}
              to <b className="text-pink-200">{method.toUpperCase()}</b>{" "}
              (Personal):{" "}
              {paymentReady ? (
                <b className="font-mono text-[15px] text-foreground">
                  {PAYMENT_NUMBER}
                </b>
              ) : (
                <span className="font-semibold text-amber-300">
                  নম্বর শীঘ্রই ঘোষণা হবে — contact the owner to pay
                </span>
              )}
              . Then submit your TrxID below — diamonds are credited after
              verification.
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="shop-sender"
                  className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-foreground/45"
                >
                  Paid from
                </label>
                <input
                  id="shop-sender"
                  inputMode="numeric"
                  value={sender}
                  onChange={(e) => setSender(e.target.value)}
                  placeholder="01XXXXXXXXX"
                  className="h-11 w-full rounded-xl border border-white/12 bg-black/40 px-3 font-mono text-[14px] text-foreground outline-none placeholder:text-foreground/25 focus:border-gold/50"
                />
              </div>
              <div>
                <label
                  htmlFor="shop-trx"
                  className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-foreground/45"
                >
                  TrxID
                </label>
                <input
                  id="shop-trx"
                  autoCapitalize="characters"
                  value={trx}
                  onChange={(e) => setTrx(e.target.value.toUpperCase())}
                  placeholder="8N7A1B2C9X"
                  className="h-11 w-full rounded-xl border border-white/12 bg-black/40 px-3 font-mono text-[14px] uppercase text-foreground outline-none placeholder:text-foreground/25 focus:border-gold/50"
                />
              </div>
            </div>

            {err && (
              <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-[12px] font-semibold text-red-300">
                {err}
              </p>
            )}

            <Button
              onClick={submit}
              disabled={sending}
              className="h-12 w-full border border-gold/40 bg-gradient-to-b from-[#ecca6f] to-[#c69c3f] text-[14px] font-black text-[#241a05] hover:from-[#f3d887]"
            >
              {sending ? (
                <Loader2 className="mr-1.5 h-4.5 w-4.5 animate-spin" />
              ) : (
                <BadgeCheck className="mr-1.5 h-4.5 w-4.5" />
              )}
              Submit order {pkg && `· ${formatTaka(pkg.taka)}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
