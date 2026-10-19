//! End-to-end tests against the compiled program (target/deploy/sleeper.so) in LiteSVM.
//! Build first: `anchor build` (the `npm run check` script does both).

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use anchor_spl::associated_token::{self, get_associated_token_address_with_program_id};
use anchor_spl::token_2022;
use anchor_spl::token_2022::spl_token_2022::extension::StateWithExtensions;
use anchor_spl::token_2022::spl_token_2022::state::Mint as MintState;
use anchor_spl::token_interface::spl_token_metadata_interface::state::TokenMetadata;
use anchor_spl::token_2022::spl_token_2022::extension::BaseStateWithExtensions;
use litesvm::LiteSVM;
use solana_address::Address as Pubkey;
use solana_clock::Clock;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

use sleeper::instructions::{ConfigParams, LaunchArgs};
use sleeper::math::SCORE_ONE;
use sleeper::state::*;

const SOL: u64 = 1_000_000_000;
const DAY: i64 = 86_400;
const SYSTEM: Pubkey = solana_system_interface::program::ID;

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    oracle: Keypair,
    treasury: Pubkey,
}

struct SongKeys {
    song: Pubkey,
    mint: Pubkey,
    vault: Pubkey,
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &sleeper::ID).0
}

fn config_pda() -> Pubkey {
    pda(&[CONFIG_SEED])
}

fn season_pda(id: u32) -> Pubkey {
    pda(&[SEASON_SEED, &id.to_le_bytes()])
}

fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(owner, mint, &token_2022::ID)
}

fn params(oracle: Pubkey, treasury: Pubkey) -> ConfigParams {
    ConfigParams {
        oracle,
        treasury,
        fee_protocol_bps: 50,
        fee_creator_bps: 25,
        fee_pot_bps: 25,
        stake_bps: 3_000,
        season_secs: 30 * DAY,
        grace_secs: 7 * DAY,
        score_smoothing: 1_000,
        max_score: 100 * SCORE_ONE,
        initial_virtual_sol: 30 * SOL,
        initial_virtual_token: 1_073_000_000_000_000,
    }
}

impl Env {
    fn new() -> Env {
        let mut svm = LiteSVM::new();
        let so = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/sleeper.so");
        svm.add_program_from_file(sleeper::ID, so)
            .expect("build the program first: anchor build");
        let admin = Keypair::new();
        let oracle = Keypair::new();
        let treasury = Keypair::new().pubkey();
        svm.airdrop(&admin.pubkey(), 100 * SOL).unwrap();
        svm.airdrop(&oracle.pubkey(), SOL).unwrap();
        svm.airdrop(&treasury, SOL).unwrap();
        let mut env = Env { svm, admin, oracle, treasury };
        let ix = Instruction {
            program_id: sleeper::ID,
            accounts: sleeper::accounts::Initialize {
                admin: env.admin.pubkey(),
                config: config_pda(),
                season: season_pda(0),
                system_program: SYSTEM,
            }
            .to_account_metas(None),
            data: sleeper::instruction::Initialize {
                params: params(env.oracle.pubkey(), env.treasury),
            }
            .data(),
        };
        let admin = env.admin.insecure_clone();
        env.send(&[ix], &[&admin]).unwrap();
        env
    }

    fn user(&mut self, sol: u64) -> Keypair {
        let k = Keypair::new();
        self.svm.airdrop(&k.pubkey(), sol).unwrap();
        k
    }

    fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> Result<(), String> {
        self.svm.expire_blockhash();
        let msg = Message::new_with_blockhash(ixs, Some(&signers[0].pubkey()), &self.svm.latest_blockhash());
        let tx = Transaction::new(signers, msg, self.svm.latest_blockhash());
        self.svm
            .send_transaction(tx)
            .map(|_| ())
            .map_err(|e| format!("{:?}\n{}", e.err, e.meta.logs.join("\n")))
    }

    fn account<T: AccountDeserialize>(&self, key: &Pubkey) -> T {
        let acc = self.svm.get_account(key).expect("account exists");
        T::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    fn lamports(&self, key: &Pubkey) -> u64 {
        self.svm.get_account(key).map(|a| a.lamports).unwrap_or(0)
    }

    fn token_balance(&self, owner: &Pubkey, mint: &Pubkey) -> u64 {
        match self.svm.get_account(&ata(owner, mint)) {
            Some(a) => u64::from_le_bytes(a.data[64..72].try_into().unwrap()),
            None => 0,
        }
    }

    fn config(&self) -> Config {
        self.account(&config_pda())
    }

    fn season(&self, id: u32) -> Season {
        self.account(&season_pda(id))
    }

    fn song(&self, k: &SongKeys) -> Song {
        self.account(&k.song)
    }

    fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    fn warp_to(&mut self, ts: i64) {
        let mut c = self.svm.get_sysvar::<Clock>();
        c.unix_timestamp = ts;
        c.slot += 1_000;
        self.svm.set_sysvar(&c);
    }

    fn launch_ix(&self, creator: &Pubkey, oracle: &Pubkey, name: &str, baseline: u64) -> (Instruction, SongKeys) {
        let mut id = [0u8; 32];
        id[..name.len().min(32)].copy_from_slice(&name.as_bytes()[..name.len().min(32)]);
        let song = pda(&[SONG_SEED, &id]);
        let mint = pda(&[MINT_SEED, song.as_ref()]);
        let vault = ata(&song, &mint);
        let ix = Instruction {
            program_id: sleeper::ID,
            accounts: sleeper::accounts::LaunchSong {
                creator: *creator,
                oracle: *oracle,
                config: config_pda(),
                season: season_pda(self.config().current_season),
                song,
                mint,
                vault,
                token_program: token_2022::ID,
                associated_token_program: associated_token::ID,
                system_program: SYSTEM,
            }
            .to_account_metas(None),
            data: sleeper::instruction::LaunchSong {
                args: LaunchArgs {
                    song_id: id,
                    baseline,
                    name: format!("{name} - Test Artist"),
                    symbol: "SONG".into(),
                    uri: "https://example.com/meta.json".into(),
                },
            }
            .data(),
        };
        (ix, SongKeys { song, mint, vault })
    }

    fn launch(&mut self, creator: &Keypair, name: &str, baseline: u64) -> SongKeys {
        let (ix, keys) = self.launch_ix(&creator.pubkey(), &self.oracle.pubkey(), name, baseline);
        let oracle = self.oracle.insecure_clone();
        self.send(&[ix], &[creator, &oracle]).unwrap();
        keys
    }

    fn trade_accounts(&self, trader: &Pubkey, k: &SongKeys) -> Vec<solana_instruction::AccountMeta> {
        let song: Song = self.song(k);
        sleeper::accounts::Trade {
            trader: *trader,
            config: config_pda(),
            song: k.song,
            season: season_pda(song.season_id),
            treasury: self.treasury,
            mint: k.mint,
            vault: k.vault,
            trader_ata: ata(trader, &k.mint),
            token_program: token_2022::ID,
            associated_token_program: associated_token::ID,
            system_program: SYSTEM,
        }
        .to_account_metas(None)
    }

    fn buy(&mut self, trader: &Keypair, k: &SongKeys, max_sol: u64, min_tokens: u64) -> Result<(), String> {
        let ix = Instruction {
            program_id: sleeper::ID,
            accounts: self.trade_accounts(&trader.pubkey(), k),
            data: sleeper::instruction::Buy { max_sol, min_tokens }.data(),
        };
        self.send(&[ix], &[trader])
    }

    fn sell(&mut self, trader: &Keypair, k: &SongKeys, tokens: u64, min_sol: u64) -> Result<(), String> {
        let ix = Instruction {
            program_id: sleeper::ID,
            accounts: self.trade_accounts(&trader.pubkey(), k),
            data: sleeper::instruction::Sell { tokens, min_sol }.data(),
        };
        self.send(&[ix], &[trader])
    }

    fn score(&mut self, scorer: &Keypair, k: &SongKeys, final_traction: u64) -> Result<(), String> {
        let song: Song = self.song(k);
        let ix = Instruction {
            program_id: sleeper::ID,
            accounts: sleeper::accounts::ScoreSong {
                scorer: scorer.pubkey(),
                config: config_pda(),
                song: k.song,
                season: season_pda(song.season_id),
            }
            .to_account_metas(None),
            data: sleeper::instruction::ScoreSong { final_traction, snapshot_hash: [7; 32] }.data(),
        };
        self.send(&[ix], &[scorer])
    }

    fn oracle_score(&mut self, k: &SongKeys, final_traction: u64) -> Result<(), String> {
        let oracle = self.oracle.insecure_clone();
        self.score(&oracle, k, final_traction)
    }

    fn finalize(&mut self) -> Result<(), String> {
        let cur = self.config().current_season;
        let payer = self.admin.insecure_clone();
        let ix = Instruction {
            program_id: sleeper::ID,
            accounts: sleeper::accounts::FinalizeSeason {
                payer: payer.pubkey(),
                config: config_pda(),
                season: season_pda(cur),
                next_season: season_pda(cur + 1),
                system_program: SYSTEM,
            }
            .to_account_metas(None),
            data: sleeper::instruction::FinalizeSeason {}.data(),
        };
        self.send(&[ix], &[&payer])
    }

    fn apply(&mut self, cranker: &Keypair, k: &SongKeys) -> Result<(), String> {
        let song: Song = self.song(k);
        let ix = Instruction {
            program_id: sleeper::ID,
            accounts: sleeper::accounts::ApplyPayout {
                config: config_pda(),
                song: k.song,
                season: season_pda(song.season_id),
                next_season: season_pda(song.season_id + 1),
            }
            .to_account_metas(None),
            data: sleeper::instruction::ApplyPayout {}.data(),
        };
        self.send(&[ix], &[cranker])
    }

    fn admin_ix(&self, admin: &Pubkey, data: Vec<u8>) -> Instruction {
        Instruction {
            program_id: sleeper::ID,
            accounts: sleeper::accounts::AdminOnly { admin: *admin, config: config_pda() }
                .to_account_metas(None),
            data,
        }
    }

    /// Price in lamports per whole token (x1e9) from the curve.
    fn price(&self, k: &SongKeys) -> u128 {
        self.song(k).curve().price_scaled()
    }

    /// Song account must cover rent + curve SOL + creator fees, and the curve must be solvent.
    fn assert_song_backed(&self, k: &SongKeys) {
        let s = self.song(k);
        let acc = self.svm.get_account(&k.song).unwrap();
        let rent = self.svm.minimum_balance_for_rent_exemption(acc.data.len());
        assert!(acc.lamports >= rent + s.real_sol + s.creator_fees, "song under-backed");
        assert!(s.curve().is_solvent(), "curve insolvent: {:?}", s.curve());
    }

    fn sell_all(&mut self, trader: &Keypair, k: &SongKeys) {
        let bal = self.token_balance(&trader.pubkey(), &k.mint);
        if bal > 0 {
            self.sell(trader, k, bal, 0).unwrap();
        }
    }
}

fn expect_err(r: Result<(), String>, needle: &str) {
    let e = r.expect_err("expected failure");
    assert!(e.contains(needle), "expected `{needle}` in:\n{e}");
}

#[test]
fn launch_mints_fixed_supply_with_metadata_and_no_mint_authority() {
    let mut env = Env::new();
    let creator = env.user(5 * SOL);
    let k = env.launch(&creator, "underground", 1_000);

    let mint_acc = env.svm.get_account(&k.mint).unwrap();
    let mint = StateWithExtensions::<MintState>::unpack(&mint_acc.data).unwrap();
    assert_eq!(mint.base.supply, TOTAL_SUPPLY);
    assert!(mint.base.mint_authority.is_none());
    assert!(mint.base.freeze_authority.is_none());
    let meta = mint.get_variable_len_extension::<TokenMetadata>().unwrap();
    assert_eq!(meta.name, "underground - Test Artist");
    assert_eq!(meta.symbol, "SONG");
    assert_eq!(env.token_balance(&k.song, &k.mint), TOTAL_SUPPLY);

    let song = env.song(&k);
    assert_eq!(song.baseline, 1_000);
    assert_eq!(song.phase, Phase::Trading);
    assert_eq!(env.season(0).song_count, 1);
}

#[test]
fn launch_needs_the_oracle_and_one_coin_per_song() {
    let mut env = Env::new();
    let creator = env.user(5 * SOL);
    let impostor = env.user(SOL);
    let (ix, _) = env.launch_ix(&creator.pubkey(), &impostor.pubkey(), "fake", 1);
    expect_err(env.send(&[ix], &[&creator, &impostor]), "ConstraintAddress");

    env.launch(&creator, "dupe", 10);
    let (ix, _) = env.launch_ix(&creator.pubkey(), &env.oracle.pubkey(), "dupe", 10);
    let oracle = env.oracle.insecure_clone();
    assert!(env.send(&[ix], &[&creator, &oracle]).is_err());
}

#[test]
fn buy_and_sell_pay_fees_and_respect_slippage() {
    let mut env = Env::new();
    let creator = env.user(5 * SOL);
    let trader = env.user(20 * SOL);
    let k = env.launch(&creator, "fees", 1_000);
    let t0 = env.lamports(&env.treasury);
    let p0 = env.lamports(&season_pda(0));

    expect_err(env.buy(&trader, &k, SOL, u64::MAX), "Slippage");
    env.buy(&trader, &k, SOL, 1).unwrap();
    let got = env.token_balance(&trader.pubkey(), &k.mint);
    assert!(got > 30_000_000_000_000, "1 SOL should buy ~3% of supply, got {got}");
    let s = env.song(&k);
    // 1% total fee: 0.5% protocol, 0.25% creator, 0.25% pot.
    assert_eq!(env.lamports(&env.treasury) - t0, s.real_sol * 50 / 10_000);
    assert_eq!(s.creator_fees, s.real_sol * 25 / 10_000);
    assert_eq!(env.lamports(&season_pda(0)) - p0, s.real_sol * 25 / 10_000);
    env.assert_song_backed(&k);

    let before = env.lamports(&trader.pubkey());
    expect_err(env.sell(&trader, &k, got, 2 * SOL), "Slippage");
    env.sell(&trader, &k, got, 0).unwrap();
    let back = env.lamports(&trader.pubkey()) - before;
    assert!(back < SOL && back > SOL * 97 / 100, "round trip should cost ~2% fees, got {back}");
    // Rounding always favours the curve, so a lamport or two of dust can stay behind.
    assert!(env.song(&k).real_sol <= 2);
    env.assert_song_backed(&k);

    // Creator claims their cut.
    let fees = env.song(&k).creator_fees;
    let cb = env.lamports(&creator.pubkey());
    let ix = Instruction {
        program_id: sleeper::ID,
        accounts: sleeper::accounts::ClaimCreatorFees { creator: creator.pubkey(), song: k.song }
            .to_account_metas(None),
        data: sleeper::instruction::ClaimCreatorFees {}.data(),
    };
    env.send(&[ix], &[&creator]).unwrap();
    assert_eq!(env.lamports(&creator.pubkey()) - cb, fees - 5_000); // minus tx fee
    assert_eq!(env.song(&k).creator_fees, 0);
}

#[test]
fn buying_the_whole_curve_charges_only_for_what_is_left() {
    let mut env = Env::new();
    let creator = env.user(5 * SOL);
    let whale = env.user(2_000 * SOL);
    let k = env.launch(&creator, "soldout", 1_000);
    env.buy(&whale, &k, 1_500 * SOL, 1).unwrap();
    assert_eq!(env.token_balance(&whale.pubkey(), &k.mint), TOTAL_SUPPLY);
    expect_err(env.buy(&whale, &k, SOL, 1), "SoldOut");
    env.assert_song_backed(&k);
    env.sell_all(&whale, &k);
    env.assert_song_backed(&k);
}

#[test]
fn trading_locks_when_the_season_ends() {
    let mut env = Env::new();
    let creator = env.user(5 * SOL);
    let trader = env.user(5 * SOL);
    let k = env.launch(&creator, "lock", 1_000);
    env.buy(&trader, &k, SOL, 1).unwrap();
    let end = env.season(0).end_ts;
    env.warp_to(end);
    expect_err(env.buy(&trader, &k, SOL, 1), "SeasonEnded");
    expect_err(env.sell(&trader, &k, 1_000, 0), "SeasonEnded");
    let (ix, _) = env.launch_ix(&creator.pubkey(), &env.oracle.pubkey(), "late", 5);
    let oracle = env.oracle.insecure_clone();
    expect_err(env.send(&[ix], &[&creator, &oracle]), "SeasonEnded");
}

/// The core promise: an underground song that blows up pumps, a superstar flop crashes,
/// and afterwards every holder can still sell everything.
#[test]
fn season_rewards_underground_hits_and_crashes_flops() {
    let mut env = Env::new();
    let creator = env.user(5 * SOL);
    let fan = env.user(50 * SOL);
    let stan = env.user(500 * SOL);
    let casual = env.user(50 * SOL);

    let underground = env.launch(&creator, "underground", 1_000);
    let superstar = env.launch(&creator, "superstar-album", 10_000_000);
    let steady = env.launch(&creator, "steady", 1_000_000);

    env.buy(&fan, &underground, 2 * SOL, 1).unwrap();
    env.buy(&stan, &superstar, 200 * SOL, 1).unwrap();
    env.buy(&casual, &steady, 10 * SOL, 1).unwrap();

    let p_under = env.price(&underground);
    let p_super = env.price(&superstar);
    let p_steady = env.price(&steady);

    // Can't score early.
    expect_err(env.oracle_score(&underground, 100_000), "SeasonNotEnded");
    env.warp_to(env.season(0).end_ts + 1);

    env.oracle_score(&underground, 100_000).unwrap(); // 100x listeners
    env.oracle_score(&superstar, 9_500_000).unwrap(); // flop: shrank
    expect_err(env.finalize(), "SeasonIncomplete");
    env.oracle_score(&steady, 1_100_000).unwrap(); // +10%
    expect_err(env.oracle_score(&steady, 2_000_000), "NotTrading");

    // Flop price is down by exactly its 30% stake.
    let crashed = env.price(&superstar);
    assert!(crashed * 100 / p_super == 69 || crashed * 100 / p_super == 70);

    env.finalize().unwrap();
    assert_eq!(env.config().current_season, 1);
    let cranker = env.user(SOL);
    for k in [&underground, &superstar, &steady] {
        env.apply(&cranker, k).unwrap();
        env.assert_song_backed(k);
    }
    // Paying a song twice is impossible (it has moved on to season 1).
    assert!(env.apply(&cranker, &steady).is_err());

    let up = env.price(&underground) as f64 / p_under as f64;
    let flop = env.price(&superstar) as f64 / p_super as f64;
    let mid = env.price(&steady) as f64 / p_steady as f64;
    println!("underground x{up:.2}, superstar x{flop:.2}, steady x{mid:.2}");
    assert!(up > 10.0, "underground hit should multiply, got x{up}");
    assert!(flop < 0.71, "flop should crash, got x{flop}");
    assert!(mid < up && mid > flop);

    // Season 0 pot fully distributed (dust swept forward), songs now in season 1 and tradable.
    assert_eq!(env.season(0).pot, 0);
    assert_eq!(env.season(1).song_count, 3);
    assert_eq!(env.song(&underground).baseline, 100_000);
    assert_eq!(env.config().unapplied, 0);

    // Everyone can exit; the fan walks away with far more than they put in.
    let before = env.lamports(&fan.pubkey());
    env.sell_all(&fan, &underground);
    let fan_profit = env.lamports(&fan.pubkey()) as i128 - before as i128;
    assert!(fan_profit > 10 * SOL as i128, "fan profit {fan_profit}");
    env.sell_all(&stan, &superstar);
    env.sell_all(&casual, &steady);
    for k in [&underground, &superstar, &steady] {
        env.assert_song_backed(k);
    }
}

/// Stats are public, so a song's season growth is known before the bell. Buying a
/// known hit at the last minute must not capture the season's payout.
#[test]
fn last_minute_snipers_earn_almost_nothing() {
    let mut env = Env::new();
    let creator = env.user(5 * SOL);
    let holder = env.user(50 * SOL);
    let sniper = env.user(50 * SOL);
    let flop_holder = env.user(50 * SOL);
    let held = env.launch(&creator, "held-all-season", 1_000);
    let sniped = env.launch(&creator, "sniped", 1_000);
    let flop = env.launch(&creator, "flop", 1_000);
    env.buy(&holder, &held, 10 * SOL, 1).unwrap();
    env.buy(&flop_holder, &flop, 10 * SOL, 1).unwrap();

    let end = env.season(0).end_ts;
    env.warp_to(end - 600);
    env.buy(&sniper, &sniped, 10 * SOL, 1).unwrap();
    env.warp_to(end);

    // Identical real-world growth for both hits.
    env.oracle_score(&held, 50_000).unwrap();
    env.oracle_score(&sniped, 50_000).unwrap();
    env.oracle_score(&flop, 1_000).unwrap();
    let w_held = env.song(&held).last_weight;
    let w_sniped = env.song(&sniped).last_weight;
    assert!(w_sniped * 1_000 < w_held, "sniper weight {w_sniped} vs holder {w_held}");
    assert!(env.song(&sniped).last_stake < SOL / 1_000);

    env.finalize().unwrap();
    let cranker = env.user(SOL);
    for k in [&held, &sniped, &flop] {
        env.apply(&cranker, k).unwrap();
        env.assert_song_backed(k);
    }
    let h0 = env.lamports(&holder.pubkey());
    env.sell_all(&holder, &held);
    let s0 = env.lamports(&sniper.pubkey());
    env.sell_all(&sniper, &sniped);
    let holder_gain = env.lamports(&holder.pubkey()) as i128 - h0 as i128 - 10 * SOL as i128;
    let sniper_gain = env.lamports(&sniper.pubkey()) as i128 - s0 as i128 - 10 * SOL as i128;
    println!("holder {holder_gain}, sniper {sniper_gain}");
    assert!(holder_gain > SOL as i128);
    assert!(sniper_gain < 0, "sniper should not profit, got {sniper_gain}");
}

#[test]
fn no_growth_means_stakes_are_refunded() {
    let mut env = Env::new();
    let creator = env.user(5 * SOL);
    let a = env.user(20 * SOL);
    let k1 = env.launch(&creator, "flat1", 5_000);
    let k2 = env.launch(&creator, "flat2", 5_000);
    env.buy(&a, &k1, 5 * SOL, 1).unwrap();
    env.buy(&a, &k2, 3 * SOL, 1).unwrap();
    let r1 = env.song(&k1).real_sol;
    let r2 = env.song(&k2).real_sol;
    let fees = env.season(0).pot;
    env.warp_to(env.season(0).end_ts);
    env.oracle_score(&k1, 4_000).unwrap();
    env.oracle_score(&k2, 5_000).unwrap();
    env.finalize().unwrap();
    assert!(env.season(0).refund);
    assert_eq!(env.season(1).pot, fees, "fees roll into next season");
    let cranker = env.user(SOL);
    env.apply(&cranker, &k1).unwrap();
    env.apply(&cranker, &k2).unwrap();
    assert_eq!(env.song(&k1).real_sol, r1);
    assert_eq!(env.song(&k2).real_sol, r2);
    env.buy(&a, &k1, SOL, 1).unwrap();
}

#[test]
fn oracle_silence_cannot_trap_holders() {
    let mut env = Env::new();
    let creator = env.user(5 * SOL);
    let holder = env.user(10 * SOL);
    let k = env.launch(&creator, "ghosted", 1_000);
    env.buy(&holder, &k, 2 * SOL, 1).unwrap();
    let real = env.song(&k).real_sol;
    let end = env.season(0).end_ts;

    env.warp_to(end + DAY);
    expect_err(env.score(&holder, &k, 1_000_000), "GraceNotOver");
    env.warp_to(end + 7 * DAY);
    // Anyone may score neutrally; their traction number is ignored and no stake is taken.
    env.score(&holder, &k, 1_000_000).unwrap();
    let s = env.song(&k);
    assert_eq!((s.last_score, s.last_stake, s.real_sol), (0, 0, real));
    env.finalize().unwrap();
    env.apply(&holder, &k).unwrap();
    env.sell_all(&holder, &k);
}

#[test]
fn next_season_cannot_finalize_with_payouts_pending() {
    let mut env = Env::new();
    let creator = env.user(5 * SOL);
    let k1 = env.launch(&creator, "one", 1_000);
    env.warp_to(env.season(0).end_ts);
    env.oracle_score(&k1, 2_000).unwrap();
    env.finalize().unwrap();
    // Season 1: a fresh song launches, ends, gets scored, but k1 was never applied.
    let k2 = env.launch(&creator, "two", 1_000);
    env.warp_to(env.season(1).end_ts);
    env.oracle_score(&k2, 1_500).unwrap();
    expect_err(env.finalize(), "PayoutsPending");
    let cranker = env.user(SOL);
    env.apply(&cranker, &k1).unwrap();
    // k1 joined season 1 late (already ended), so it must be scored there too.
    expect_err(env.finalize(), "SeasonIncomplete");
    env.oracle_score(&k1, 2_000).unwrap();
    env.finalize().unwrap();
}

#[test]
fn admin_controls_are_bounded() {
    let mut env = Env::new();
    let creator = env.user(5 * SOL);
    let rando = env.user(SOL);
    let admin = env.admin.insecure_clone();

    let mut p = params(env.oracle.pubkey(), env.treasury);
    let ix = env.admin_ix(&rando.pubkey(), sleeper::instruction::UpdateConfig { params: p.clone() }.data());
    expect_err(env.send(&[ix], &[&rando]), "ConstraintHasOne");

    p.fee_protocol_bps = 600;
    let ix = env.admin_ix(&admin.pubkey(), sleeper::instruction::UpdateConfig { params: p.clone() }.data());
    expect_err(env.send(&[ix], &[&admin]), "BadConfig");
    p.fee_protocol_bps = 50;
    p.stake_bps = 9_000;
    let ix = env.admin_ix(&admin.pubkey(), sleeper::instruction::UpdateConfig { params: p.clone() }.data());
    expect_err(env.send(&[ix], &[&admin]), "BadConfig");

    let k = env.launch(&creator, "paused", 1_000);
    let ix = env.admin_ix(&admin.pubkey(), sleeper::instruction::SetPaused { paused: true }.data());
    env.send(&[ix], &[&admin]).unwrap();
    expect_err(env.buy(&creator, &k, SOL, 1), "Paused");
    let ix = env.admin_ix(&admin.pubkey(), sleeper::instruction::SetPaused { paused: false }.data());
    env.send(&[ix], &[&admin]).unwrap();
    env.buy(&creator, &k, SOL, 1).unwrap();

    // Two-step admin handover.
    let next = env.user(SOL);
    let ix = env.admin_ix(&admin.pubkey(), sleeper::instruction::ProposeAdmin { new_admin: next.pubkey() }.data());
    env.send(&[ix], &[&admin]).unwrap();
    let accept = |who: &Keypair| Instruction {
        program_id: sleeper::ID,
        accounts: sleeper::accounts::AcceptAdmin { new_admin: who.pubkey(), config: config_pda() }
            .to_account_metas(None),
        data: sleeper::instruction::AcceptAdmin {}.data(),
    };
    expect_err(env.send(&[accept(&rando)], &[&rando]), "NotPendingAdmin");
    env.send(&[accept(&next)], &[&next]).unwrap();
    assert_eq!(env.config().admin, next.pubkey());
}

#[test]
fn many_traders_many_seasons_stay_solvent() {
    let mut env = Env::new();
    let creator = env.user(10 * SOL);
    let traders: Vec<Keypair> = (0..6).map(|_| env.user(300 * SOL)).collect();
    let songs: Vec<SongKeys> = (0..4).map(|i| env.launch(&creator, &format!("song{i}"), 1_000 * (i as u64 + 1) * 10)).collect();
    let mut seed: u64 = 42;
    let mut rnd = move || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        seed >> 33
    };
    let cranker = env.user(SOL);
    for _season in 0..3 {
        for _ in 0..40 {
            let t = &traders[(rnd() % 6) as usize];
            let k = &songs[(rnd() % 4) as usize];
            if rnd() % 3 == 0 {
                let bal = env.token_balance(&t.pubkey(), &k.mint);
                if bal > 0 {
                    env.sell(t, k, bal / 2 + 1, 0).unwrap();
                }
            } else {
                let _ = env.buy(t, k, (rnd() % 20 + 1) * SOL / 2, 1);
            }
        }
        let cur = env.config().current_season;
        env.warp_to(env.season(cur).end_ts);
        for k in &songs {
            let base = env.song(k).baseline;
            let fin = base * (rnd() % 300) / 100; // 0x .. 3x
            env.oracle_score(k, fin).unwrap();
        }
        env.finalize().unwrap();
        for k in &songs {
            env.apply(&cranker, k).unwrap();
            env.assert_song_backed(k);
        }
    }
    for t in &traders {
        for k in &songs {
            env.sell_all(t, k);
        }
    }
    for k in &songs {
        env.assert_song_backed(k);
        assert_eq!(env.token_balance(&k.song, &k.mint), TOTAL_SUPPLY);
    }
    assert!(env.now() > 0);
}
