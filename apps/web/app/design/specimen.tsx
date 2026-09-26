"use client";

import { useState, type ReactNode } from "react";
import { type BoardState, StatusMark } from "@/components/board/board-state";
import { Countdown, FlapDisplay } from "@/components/board/flap-display";
import { Slab } from "@/components/board/slab";

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi + 0.05) / (lo + 0.05)).toFixed(2);
};

const HOUSING = "#15140F";
const STOCK = "#EAE9E3";

const SURFACES = [
  { name: "Board Charcoal", role: "Housing, the page surface", hex: HOUSING, text: STOCK },
  { name: "Raised housing", role: "Panels and flap cells on the board", hex: "#1F1E18", text: STOCK },
  { name: "Flap Ivory", role: "Card stock, only ever a slab", hex: STOCK, text: HOUSING },
  { name: "Stock edge", role: "A slab's visible thickness", hex: "#B5B2A8", text: HOUSING },
];

const STATE_PAIRS: { name: string; state: BoardState; lamp: string; ink: string }[] = [
  { name: "Concourse Green", state: "live", lamp: "#58B07B", ink: "#2E6B46" },
  { name: "Platform Amber", state: "filling", lamp: "#E8A64C", ink: "#8A5A10" },
  { name: "Last Call Red", state: "closing", lamp: "#E5634A", ink: "#A8341F" },
  { name: "Rail Blue", state: "pending", lamp: "#7FA6CC", ink: "#2A4D6E" },
];

const ALL_STATES: BoardState[] = ["live", "filling", "closing", "pending", "draft", "expired", "cancelled"];

const TYPE_STEPS = [
  { token: "type-display", sample: "Walk-ins near you" },
  { token: "type-h1", sample: "Drives in Bengaluru" },
  { token: "type-h2", sample: "Telecaller, Koramangala" },
  { token: "type-h3", sample: "Interview slots" },
  { token: "type-body", sample: "Bring two copies of your resume and a photo ID to the venue." },
  { token: "type-meta", sample: "Koramangala, Bengaluru" },
  { token: "type-board-lg", sample: "10:00 · 40/50" },
  { token: "type-board-md", sample: "Tue 29 Sep · 10:00–13:00 · ₹15,000–₹25,000" },
  { token: "type-board-sm", sample: "4.6 km · 12 of 15 seats left" },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="border-t border-housing-line py-10">
      <h2 className="type-h2 mb-6">{title}</h2>
      {children}
    </section>
  );
}

function DriveCard({ state, role, venue, when, pay, distance, seats }: {
  state: BoardState;
  role: string;
  venue: string;
  when: string;
  pay: string;
  distance: string;
  seats: string;
}) {
  return (
    <Slab href="/design#slabs" state={state} depth="lg" className="w-full">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="type-h3">{role}</h3>
        <span className="type-board-md shrink-0 whitespace-nowrap">{distance}</span>
      </div>
      <p className="type-meta text-ink-muted">{venue}</p>
      <div className="mt-4 grid gap-0.5">
        <p className="type-board-md">{when}</p>
        <p className="type-board-md">{pay}</p>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <StatusMark state={state} surface="stock" />
        <span className="type-board-sm text-ink-muted">{seats}</span>
      </div>
    </Slab>
  );
}

export default function Specimen() {
  const [seats, setSeats] = useState(40);
  const [live, setLive] = useState(false);
  const [sample] = useState(() => {
    const start = Date.now() + (2 * 3600 + 14 * 60 + 9) * 1000;
    return { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3 * 3600_000).toISOString() };
  });

  return (
    <main className="min-h-screen bg-housing text-stock">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <header className="pb-10">
          <p className="type-board-md text-housing-muted">Walkins board system</p>
          <h1 className="type-display mt-2 max-w-3xl">Every walk-in is a departure</h1>
          <p className="type-body mt-4 max-w-2xl text-housing-muted">
            Dark housing, lit flaps, and passes cut from card stock. This page renders the real tokens, type and
            components; nothing here is a mockup.
          </p>
        </header>

        <Section id="surfaces" title="Surfaces">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SURFACES.map((s) => (
              <div key={s.name} className="border border-housing-line">
                <div className="flex h-24 items-end p-3" style={{ background: s.hex, color: s.text }}>
                  <span className="type-board-md">{s.hex}</span>
                </div>
                <div className="p-3">
                  <p className="type-meta">{s.name}</p>
                  <p className="type-meta text-housing-muted">{s.role}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="state" title="State colour: lamp on housing, ink on stock">
          <p className="type-body mb-6 max-w-2xl text-housing-muted">
            No single value clears contrast on both surfaces, so each state has a lit lamp value for the board and a
            printed ink value for the card. Ratios below are measured live from these hex values.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STATE_PAIRS.map((p) => (
              <div key={p.name} className="border border-housing-line">
                <div className="p-3" style={{ background: HOUSING }}>
                  <StatusMark state={p.state} surface="housing" />
                  <p className="type-board-sm mt-2 text-housing-muted">
                    Lamp {p.lamp} · {contrast(p.lamp, HOUSING)}:1
                  </p>
                </div>
                <div className="p-3" style={{ background: STOCK, color: HOUSING }}>
                  <StatusMark state={p.state} surface="stock" />
                  <p className="type-board-sm mt-2 text-ink-muted">
                    Ink {p.ink} · {contrast(p.ink, STOCK)}:1
                  </p>
                </div>
                <p className="type-meta p-3">{p.name}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="flex flex-wrap gap-x-5 gap-y-2 border border-housing-line p-4">
              {ALL_STATES.map((s) => (
                <StatusMark key={s} state={s} surface="housing" />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 p-4" style={{ background: STOCK }}>
              {ALL_STATES.map((s) => (
                <StatusMark key={s} state={s} surface="stock" />
              ))}
            </div>
          </div>
        </Section>

        <Section id="type" title="Type scale">
          <div className="grid gap-5">
            {TYPE_STEPS.map((t) => (
              <div key={t.token} className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:items-baseline">
                <span className="type-board-sm text-housing-muted">{t.token}</span>
                <span className={t.token}>{t.sample}</span>
              </div>
            ))}
          </div>
          <div className="mt-8 inline-grid gap-1 border border-housing-line p-4">
            <span className="type-meta text-housing-muted">Tabular numerals: these columns must align</span>
            <span className="type-board-lg">11:11 · 111 km</span>
            <span className="type-board-lg">08:40 · 804 km</span>
          </div>
        </Section>

        <Section id="slabs" title="Slabs">
          <p className="type-body mb-6 max-w-2xl text-housing-muted">
            Move the pointer across a card: the edge you see is the edge that would face you. Press one and it sinks
            toward the board. The form panel at the end is static on purpose.
          </p>
          <div className="grid gap-8 md:grid-cols-3">
            <DriveCard
              state="live"
              role="Telecaller"
              venue="Koramangala, Bengaluru"
              when="Tue 29 Sep · 10:00–13:00"
              pay="₹15,000–₹25,000"
              distance="4.6 km"
              seats="40 of 50 seats left"
            />
            <DriveCard
              state="filling"
              role="Delivery Executive"
              venue="Whitefield, Bengaluru"
              when="Thu 1 Oct · 09:00–13:00"
              pay="₹12,000–₹18,000"
              distance="16.9 km"
              seats="3 of 15 seats left"
            />
            <DriveCard
              state="closing"
              role="Warehouse Associate"
              venue="Electronic City, Bengaluru"
              when="Today · 14:00–17:00"
              pay="₹14,000–₹19,000"
              distance="11.2 km"
              seats="9 of 20 seats left"
            />
          </div>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            <Slab depth="md" className="w-full">
              <p className="type-h3">Your details</p>
              <p className="type-meta mt-1 text-ink-muted">A static panel: it holds a form, so it never moves.</p>
            </Slab>
            <div className="flex flex-wrap items-start gap-6 md:col-span-2">
              <Slab depth="sm" className="px-5 py-3">
                <span className="type-meta">Small depth, for controls</span>
              </Slab>
              <Slab depth="md" className="px-5 py-3">
                <span className="type-meta">Medium depth, for panels</span>
              </Slab>
              <Slab depth="lg" className="px-5 py-3">
                <span className="type-meta">Large depth, for passes</span>
              </Slab>
            </div>
          </div>
        </Section>

        <Section id="flaps" title="Split-flap">
          <p className="type-body mb-6 max-w-2xl text-housing-muted">
            The one orchestrated motion: a value that changes flips mechanically. Everything else on the page cuts.
          </p>
          <div className="grid gap-8 md:grid-cols-3">
            <div className="grid gap-3">
              <span className="type-meta text-housing-muted">Seats left</span>
              <FlapDisplay value={String(seats)} length={2} align="right" className="text-[2.5rem]" cellWidth={0.62} />
              <div className="flex flex-wrap gap-4 pt-2">
                <Slab depth="sm" onClick={() => setSeats((n) => Math.max(0, n - 1))} className="px-4 py-2">
                  <span className="type-meta">Book a seat</span>
                </Slab>
                <Slab depth="sm" onClick={() => setSeats((n) => Math.max(0, n - 7))} className="px-4 py-2">
                  <span className="type-meta">Book seven</span>
                </Slab>
                <Slab depth="sm" onClick={() => setSeats(40)} disabled={seats === 40} className="px-4 py-2">
                  <span className="type-meta">Reset</span>
                </Slab>
              </div>
            </div>
            <div className="grid gap-3">
              <span className="type-meta text-housing-muted">Status</span>
              <FlapDisplay
                value={live ? "Live" : "Pending"}
                length={7}
                tone={live ? "live" : "pending"}
                className="text-[2.5rem]"
                cellWidth={0.66}
              />
              <div className="pt-2">
                <Slab depth="sm" onClick={() => setLive((v) => !v)} className="px-4 py-2">
                  <span className="type-meta">{live ? "Move back to pending" : "Approve drive"}</span>
                </Slab>
              </div>
            </div>
            <Countdown startsAt={sample.startsAt} endsAt={sample.endsAt} />
          </div>
        </Section>
      </div>
    </main>
  );
}
