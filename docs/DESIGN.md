# Sleeper: design

> **Sleeper hit** (n.): a song nobody noticed that blows up.

Sleeper is a Solana launchpad where **every coin is a real song**. Anyone can launch a
coin for any released track. It trades on a bonding curve like pump.fun. At the end
of each **season** (30 days), the song's **real-world traction** decides whether its
curve gets paid from the season pot (price up) or loses its stake (price down).

Buy an underground track early. If it blows up, the coin pays. If a superstar's
album flops, its coin crashes.

## Why the data can be trusted (and where it can't)

Traction comes only from public numbers that anyone can check:

| Source  | Field                     | Notes |
|---------|---------------------------|-------|
| Last.fm | `track.getInfo` listeners | Free API, all-time unique listeners. Primary signal. |
| YouTube | video `viewCount`         | Free Data API quota. Official video or topic upload. |
| Deezer  | track `rank`              | Free, no key. Sanity check for anomalies. |

**Spotify is not used.** Since February 2026, new Spotify developer apps no longer
get track popularity, and play counts have never been exposed by its API. Getting
popularity back means Extended Quota, which needs 250k monthly users.

The oracle publishes every raw snapshot (JSON) and puts its sha256 on-chain in the
`SongScored` event, so anyone can recompute every score.

**Trust assumptions, stated plainly:**
- The oracle key is trusted to report numbers honestly. Mitigations: public snapshots,
  on-chain hashes, and a grace-period fallback (below). Plan: move the oracle to a
  multisig or a set of independent signers before volume grows.
- Streams and views can be botted. Last.fm listeners are the hardest of the three to
  fake at scale, which is why they lead. The oracle also flags songs whose sources
  disagree wildly.

## Lifecycle

```
launch ──► trading (season N) ──► season ends: trading pauses
                                      │
                         score_song (oracle, per song)
                         stake moves curve ─► pot, price drops
                                      │
                         finalize_season (anyone)
                         pot frozen, season N+1 opens
                                      │
                         apply_payout (anyone, per song)
                         pot share ─► curve, price rises
                                      │
                         trading resumes in season N+1
```

### Launch
- The oracle **co-signs** every launch. It checks that the song exists in the public
  sources, derives `song_id` = sha256 of a canonical key (ISRC where known), and
  records the **baseline** traction. Only one coin can exist per song.
- Token-2022 mint with on-mint metadata. **1B supply, all of it on the curve, no dev
  allocation.** The mint authority is revoked in the same transaction and there is no
  freeze authority.

### Trading
- Constant product on virtual reserves (30 SOL / 1.073B tokens, the pump.fun shape).
  The whole curve stays on Sleeper with no DEX migration, because season settlement
  needs to move the curve's SOL.
- Fee is 1% per trade: 0.50% protocol treasury, 0.25% the coin's creator (claimable),
  0.25% the season pot.

### Scoring
`score = (final - baseline) / (baseline + 1000)`, capped at 100×.

| Song | Baseline → final listeners | Score |
|------|----------------------------|-------|
| Underground track blows up | 1,000 → 100,000 | ≈ 49 |
| Superstar album, solid month | 10,000,000 → 10,200,000 | ≈ 0.02 |
| New release launched on day one | 500 → 2,000,000 | 100 (cap) |

**stake** = 30% × the song's *time-weighted average* curve SOL over the season.
**weight** = stake × score. The pot (all stakes + pot fees + rollover) is shared out
in proportion to weight.

So a song gains if it beats the season's stake-weighted average growth, and loses
part of its stake if it doesn't. The listener metrics are all-time totals that only
go up, so a "flop" means "grew slower than the field", not "shrank". In the test
suite, an underground 100× song went ×32 in price, a flat superstar went ×0.70, and
a +10% song went ×0.76 because it lagged that season's average.

If no song grew at all, stakes are refunded and the fees roll over.

### Why prices move and every holder can still sell
A curve's price is `virtual_sol / virtual_token`. Settlement moves the curve's real
SOL from R to R' and scales `virtual_sol` by exactly R'/R. The price scales by the
same factor, and this invariant always holds:

```text
virtual_sol × (1 − virtual_token / initial_virtual_token) ≤ real_sol
```

In words, selling every circulating token back can never need more SOL than the curve
holds. `math.rs` has property tests for this over thousands of random trades and
rescales, and the LiteSVM suite sells everything after multiple seasons.

### Anti-gaming
- **Last-minute sniping.** Growth is visible in public data before the bell, so stakes
  use the time-weighted average SOL across the season. A song bought 10 minutes before
  close has a near-zero weight. In the test suite, the sniper lost 0.2 SOL while the
  season-long holder made 2.8 SOL on the same growth.
- **Trading pauses** from season end until a song's payout is applied, so nobody can
  trade against a posted but unapplied score.
- **Oracle silence can't trap funds.** After end + 7 days, anyone can score a skipped
  song neutrally (no stake, no growth). Finalize and apply are permissionless cranks.

## Admin powers (hard-capped on-chain)
- Total fee ≤ 5%, stake ≤ 50%, season length 1 hour to 1 year, grace ≥ 1 day.
- Can pause trading and launches. Fee and curve changes apply going forward;
  existing curves keep their own reserves.
- Admin handover is two-step (propose, then accept).
- The admin and upgrade authority should be a Squads multisig on mainnet.

## Legal and brand notes
- Coins are **predictions on a song's public traction**. They are not royalties,
  not affiliated with artists or labels, and not endorsed by any streaming service.
  The UI and token metadata must say so.
- Artists can't be given proceeds without consent. "Creator" fees go to whoever
  launched the coin. An opt-in "artist claim" flow is a later phase.
