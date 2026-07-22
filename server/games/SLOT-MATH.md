# Slot Machine — Technical Math Reference

## 1. Game Overview

| Property | Value |
|---|---|
| Grid dimensions | 6 columns × 5 rows (30 cells) |
| Symbol set | 9 (8 paying + 1 scatter) |
| Win mechanic | Global symbol count (any position) |
| Min win threshold | 8 matching non-scatter symbols |
| Max cascade depth | 6 consecutive tumbles |
| Bet unit | 1 (all payouts are multipliers) |

---

## 2. Symbol Table

### Weights & Probabilities

| Symbol | Weight | Probability | Type |
|---|---|---|---|
| heart | 7 | 6.86% | High |
| diamond | 8 | 7.84% | High |
| banana | 10 | 9.80% | Medium-High |
| apple | 12 | 11.76% | Medium |
| orange | 14 | 13.73% | Medium |
| watermelon | 15 | 14.71% | Medium-Low |
| plum | 16 | 15.69% | Low |
| grape | 18 | 17.65% | Low |
| scatter | 2 | 1.96% | Special |

**Total weight:** 102

### Classification

- **High value** (heart, diamond): Low probability, high pay — drive the top-end variance
- **Medium value** (banana, apple, orange, watermelon): Main win contributors
- **Low value** (plum, grape): High probability, low pay — produce frequent small wins
- **Scatter**: No direct line pay; reserved for future bonus mechanic (weighted at 2)

---

## 3. Pay Table

All values are bet multipliers. Payout is determined by the total count of the same symbol anywhere on the grid. Only the **highest tier** is paid (cumulative).

### Payout Structure

| Symbol ↓ \ Count → | 8+ | 12+ | 15+ | 20+ | 25+ | 30 |
|---|---|---|---|---|---|---|
| **heart** | 10× | 20× | 40× | 80× | 120× | 200× |
| **diamond** | 15× | 35× | 70× | 140× | 260× | 500× |
| **banana** | 8× | 16× | 30× | 60× | 90× | 160× |
| **apple** | 5× | 10× | 20× | 40× | 70× | 110× |
| **orange** | 5× | 10× | 20× | 40× | 70× | 110× |
| **watermelon** | 4× | 8× | 15× | 30× | 55× | 90× |
| **plum** | 3× | 6× | 12× | 24× | 40× | 75× |
| **grape** | 2× | 4× | 9× | 18× | 30× | 60× |

### Example

A grid containing **10 diamonds** pays 15× (the 12+ tier is not reached; 8+ tier applies).  
A grid containing **16 diamonds** pays 70× (15+ tier applies; 12+ and 8+ are superseded).

---

## 4. Hit Frequency

### Base Grid (single spin, no cascades)

| Symbol | 8+ Probability | Primary Tier |
|---|---|---|
| heart | 0.07% | 8+ |
| diamond | 0.17% | 8+ |
| banana | 0.69% | 8+ |
| apple | 1.97% | 8+ |
| orange | 4.46% | 8+ |
| watermelon | 6.27% | 8+ |
| plum | 8.51% | 8+ |
| grape | 14.23% | 8+ |

**Base hit frequency (any win, first spin):** ~34.97%  
**No-win probability (first spin):** ~65.03%

### With Cascades (full game)

| Metric | Value |
|---|---|
| Overall hit frequency | ~35.07% |
| Cascade 0× (base win only) | 65.03% no-win, remainder one-and-done |
| Cascade 1× | 21.63% |
| Cascade 2× | 8.05% |
| Cascade 3× | 3.34% |
| Cascade 4× | 1.25% |
| Cascade 5× | 0.44% |
| Cascade 6× (max depth) | 0.25% |

> Only ~35% of spins cascade past the first drop. Deep cascades (4+) are rare events contributing to the tail of the win distribution.

---

## 5. RTP (Return to Player)

### Theoretical RTP: 123.14%

#### Breakdown by Symbol

| Symbol | RTP Contribution |
|---|---|
| grape | 29.82% |
| plum | 26.24% |
| watermelon | 25.62% |
| orange | 22.64% |
| apple | 9.92% |
| banana | 5.55% |
| diamond | 2.61% |
| heart | 0.73% |
| **Total (base)** | **123.14%** |

#### Cascade Boost

The base RTP (123.14%) does not account for cascades. Each cascade drop places new symbols into the grid, creating additional win opportunities. Empirical simulation over 500,000 spins yields:

| Component | RTP |
|---|---|
| Base grid contribution | ~123.14% |
| Cascade boost | ~93.04% |
| **Total (simulated)** | **~216.18%** |

> **Note:** Current RTP is intentionally set above 100% for development/testing purposes. For production deployment, the pay table or symbol weights must be adjusted to hit a target RTP (typically 94–97%).

---

## 6. Volatility & Win Distribution

### Classification: Medium-Low Volatility

The game produces frequent small-to-medium wins with a low probability of extreme payouts.

### Win Distribution (100,000 spins, bet = 1)

| Win Range | Frequency | Cumulative |
|---|---|---|
| 0× (loss) | 65.02% | 65.02% |
| 1–10× | 29.90% | 94.92% |
| 10–50× | 5.08% | 100.00% |
| 50–200× | 0.00% | 100.00% |
| 200×+ | 0.00% | 100.00% |

### Maximum Observed Win

- **Simulated max (100k spins):** 62× bet  
- **Theoretical max:** 500× (30 diamonds at 15× per diamond, but probability is effectively 0)

### Win Concentration

~95% of winning spins pay between 1× and 10× the bet. The 8+ tier (minimum win threshold) dominates the payout frequency for every symbol. Higher tiers (12+, 15+, etc.) have negligible probability in the current configuration.

---

## 7. Cascade Mechanic

### Algorithm

```
1. Generate 6×5 grid using weighted random selection
2. Count occurrences of each non-scatter symbol
3. If any symbol count >= 8, pay highest tier and mark those positions
4. Remove marked positions, shift remaining symbols down
5. Fill empty positions at top with new random symbols
6. Repeat steps 2–5 (max 6 times)
```

### Detection Formula

```
totalWin = sum over steps of (count_in_step × pay_value × bet)
```

### Depth Probability

| Cascade Depth | Probability | Meaning |
|---|---|---|
| 0 | 65.03% | No win, game ends |
| 1 | 21.63% | Win on spin only |
| 2 | 8.05% | One tumble |
| 3 | 3.34% | Two tumbles |
| 4 | 1.25% | Three tumbles |
| 5 | 0.44% | Four tumbles |
| 6 | 0.25% | Five tumbles (max) |

---

## 8. RNG Implementation

### Architecture

```
┌──────────────────────────────────────────────────┐
│              Central RNG (server/rng.js)          │
│                                                   │
│  Entropy Source: crypto.randomBytes() (48-bit)    │
│  Deterministic PRNG: Mulberry32 (32-bit seed)     │
│  Audit: Every call logged with timestamp & source │
└──────┬───────────────────────────────────────────┘
       │
       ├── symbol selection (weightedPick)
       ├── seed generation (randomSeed)
       └── cascade fill (createSeeded for deterministic replay)
```

### Seed Flow

1. `server/index.js` calls `rng.randomSeed('server/index.js:spin')` → generates cryptographically secure 32-bit seed
2. `fullSpin(bet, seed)` → calls `rng.createSeeded(seed, ...)` → creates mulberry32 PRNG
3. All grid symbols within that spin are generated by the deterministic PRNG
4. The seed is logged in the RNG audit trail for reproducibility

### Properties

- Game outcomes are **deterministic given the seed** (same seed → same result)
- Seeds are generated using **cryptographically secure entropy** (`crypto.randomBytes`)
- All RNG calls are **audited** with source labels and timestamps
- The system supports **instant (crypto)** and **seeded (deterministic)** modes

---

## 9. Production Tuning Guide

To achieve a target RTP (e.g., 96%), adjust the following levers:

| Lever | Effect | Recommendation |
|---|---|---|
| **Min win threshold** | Raise MIN_WIN (e.g., 8→9) to reduce hit frequency and RTP | +1 threshold ≈ −15–20% RTP |
| **Symbol weights** | Increase low-value symbol weights to dilute high-value probability | ±1 weight ≈ ±1–3% RTP |
| **Pay table values** | Scale all pay multipliers by a flat factor | Linear RTP adjustment |
| **Max cascade depth** | Reduce maxSteps (e.g., 6→3) to cap cascade RTP contribution | −3 steps ≈ −30–40% RTP |
| **Scatter weight** | Increase scatter weight and implement bonus rounds | Adds complexity, increases engagement |

### Verified Tuning Targets (100k spin simulation)

| Target RTP | Pay Scale | Min Win | Max Cascades | Hit Frequency |
|---|---|---|---|---|
| ~119% | 0.50× | 8 | 4 | ~35.1% |
| ~96% | 0.48× | 8 | 4 | ~35.1% |
| ~94% | 0.46× | 8 | 4 | ~35.1% |
| ~92% | 0.44× | 8 | 4 | ~35.0% |
| ~90% | 0.42× | 8 | 4 | ~35.3% |

> **Note:** RTP scales roughly linearly with `payScale`. Each ±0.02 in payScale changes RTP by approximately ±3–4 percentage points.

### Runtime Configuration

RTP parameters are now configurable at runtime via:
- **Admin UI** → `RTP` sekmesi (slot admin panel)
- **API** `PUT /api/slot/config` with token auth
- **Config file** `slot/data/slot-config.json` (hot-reloaded on each spin)

---

## 10. File Reference

| File | Purpose |
|---|---|
| `server/games/slot.js` | Core math engine (grid generation, win detection, cascade logic) |
| `server/rng.js` | Centralized crypto RNG service with audit trail |
| `server/index.js` | WebSocket + REST server (seed generation, balance, RNG API) |
| `slot/server.js` | Standalone slot server (Sugar Rush RGS + built-in slot) |
