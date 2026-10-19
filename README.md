# Sleeper 💤

A Solana launchpad where **every coin is a real song**. Launch a coin for any
track and trade it on a bonding curve. Every 30 days the song's real-world traction
(Last.fm listeners, YouTube views, Deezer rank) settles the season. Underground songs
that blow up get paid from the pot and their price jumps. Big releases that flop lose
their stake and crash.

How it works, the maths and the trust model: **[docs/DESIGN.md](docs/DESIGN.md)**.

## Layout

```
programs/sleeper/       Anchor 1.2 program
  src/math.rs           curve, fee and scoring maths (pure, property-tested)
  src/instructions/     admin, launch, trade, season settlement
  tests/lifecycle.rs    end-to-end tests in LiteSVM against the built .so
oracle/                TypeScript oracle: real data in, season scores out
  src/sources/          Deezer (identity), Last.fm (listeners), YouTube (views)
  src/launch.ts         verify a song, measure its baseline, co-sign the launch tx
  src/settle.ts         measure, publish snapshot, score, finalize, pay out
  src/server.ts         HTTP API for the website
  test/                 parsers on captured responses + full flow in LiteSVM
docs/DESIGN.md          design, invariants, anti-gaming, admin limits
keys/                   local keypairs (gitignored, never committed)
```

## Develop

Needs the Solana CLI (Agave 4.x), Rust, and Anchor CLI 1.2.1.

```sh
npm install
npm run check   # anchor build + program tests + typecheck + oracle tests
```

## Oracle

```sh
cp .env.example .env            # add LASTFM_API_KEY / YOUTUBE_API_KEY
npm run oracle -- search <song>   # find a track on Deezer
npm run oracle -- measure <deezer link> [--youtube <link>]   # real traction right now
npm run oracle -- status          # on-chain config + current season
npm run oracle -- serve           # HTTP API on 127.0.0.1:8787 + settle every 10 min
npm run oracle -- settle          # one settlement pass (idempotent)
```

The oracle's `data/oracle.db` is the registry of every launched song. Back it up.

## Status

- [x] Phase 1: on-chain program and tests
- [x] Phase 2: oracle (Deezer / Last.fm / YouTube, launch co-signing, season settlement)
- [ ] Phase 3: website (launch a song, trade, charts, seasons)
- [ ] Phase 4: mainnet deploy (multisig admin) and the $SLEEPER launch

Not affiliated with any artist, label or streaming service. Song coins are
speculative predictions on public traction data, not royalties or securities.
