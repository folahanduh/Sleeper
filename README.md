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
docs/DESIGN.md          design, invariants, anti-gaming, admin limits
keys/                   local keypairs (gitignored, never committed)
```

## Develop

Needs the Solana CLI (Agave 4.x), Rust, and Anchor CLI 1.2.1.

```sh
npm run check   # anchor build + unit tests + LiteSVM lifecycle tests
```

## Status

- [x] Phase 1: on-chain program and tests
- [ ] Phase 2: oracle (Last.fm / YouTube / Deezer, launch co-signing, season scorer)
- [ ] Phase 3: website (launch a song, trade, charts, seasons)
- [ ] Phase 4: mainnet deploy (multisig admin) and the $SLEEPER launch

Not affiliated with any artist, label or streaming service. Song coins are
speculative predictions on public traction data, not royalties or securities.
