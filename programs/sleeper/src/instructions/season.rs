//! Season settlement. When a season ends, trading on its songs stops until:
//!   1. score_song    – oracle posts each song's real traction; the song's stake
//!                      moves into the season pot and its price drops by the stake.
//!   2. finalize      – once every song is scored, the pot is frozen and the next
//!                      season opens.
//!   3. apply_payout  – (anyone) pays each song its share of the pot by
//!                      stake x growth; its price rises by that payout and it
//!                      re-enters trading in the next season.
//! A song that didn't grow gets nothing back, so a flop ends the season down its stake.

use anchor_lang::prelude::*;

use crate::errors::{m, SleeperError};
use crate::events::{PayoutApplied, SeasonFinalized, SongScored};
use crate::math::{fee, growth_score, pro_rata, weight};
use crate::state::*;

#[derive(Accounts)]
pub struct ScoreSong<'info> {
    pub scorer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SONG_SEED, song.song_id.as_ref()], bump = song.bump)]
    pub song: Account<'info, Song>,
    #[account(
        mut,
        seeds = [SEASON_SEED, &song.season_id.to_le_bytes()],
        bump = season.bump
    )]
    pub season: Account<'info, Season>,
}

/// The oracle posts `final_traction`. If the oracle hasn't scored a song by
/// end + grace, anyone may score it neutrally (no stake, no growth) so the
/// season can never be stuck and holders can always trade again.
pub fn score_song(ctx: Context<ScoreSong>, final_traction: u64, snapshot_hash: [u8; 32]) -> Result<()> {
    let config = &ctx.accounts.config;
    let now = Clock::get()?.unix_timestamp;
    let season = &mut ctx.accounts.season;
    let song = &mut ctx.accounts.song;
    require!(now >= season.end_ts, SleeperError::SeasonNotEnded);
    require!(!season.finalized, SleeperError::AlreadyFinalized);
    require!(song.phase == Phase::Trading, SleeperError::NotTrading);

    let neutral = ctx.accounts.scorer.key() != config.oracle;
    if neutral {
        require!(now >= season.end_ts + config.grace_secs, SleeperError::GraceNotOver);
    }

    song.accrue(season.end_ts, season.end_ts);
    let (final_traction, score, stake) = if neutral {
        (song.baseline, 0, 0)
    } else {
        let score =
            growth_score(song.baseline, final_traction, config.score_smoothing, config.max_score);
        // Stake on the season's time-weighted SOL, never more than what is there now.
        let at_risk = song.twa_sol(season.start_ts, season.end_ts).min(song.real_sol);
        let stake = m(fee(at_risk, config.stake_bps))?;
        (final_traction, score, stake)
    };

    if stake > 0 {
        let mut curve = song.curve();
        m(curve.rescale(song.real_sol - stake))?;
        song.set_curve(&curve);
        song.to_account_info().sub_lamports(stake)?;
        season.to_account_info().add_lamports(stake)?;
        season.pot = season.pot.checked_add(stake).ok_or(SleeperError::Overflow)?;
        season.staked = season.staked.checked_add(stake).ok_or(SleeperError::Overflow)?;
    }

    let w = weight(stake, score);
    season.total_weight = season.total_weight.checked_add(w).ok_or(SleeperError::Overflow)?;
    season.scored_count += 1;
    song.phase = Phase::Scored;
    song.last_final = final_traction;
    song.last_score = score;
    song.last_stake = stake;
    song.last_weight = w;

    emit!(SongScored {
        song: song.key(),
        season_id: season.id,
        baseline: song.baseline,
        final_traction,
        score,
        stake,
        snapshot_hash,
        neutral,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeSeason<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [SEASON_SEED, &config.current_season.to_le_bytes()],
        bump = season.bump
    )]
    pub season: Account<'info, Season>,
    #[account(
        init,
        payer = payer,
        space = 8 + Season::INIT_SPACE,
        seeds = [SEASON_SEED, &(config.current_season + 1).to_le_bytes()],
        bump
    )]
    pub next_season: Account<'info, Season>,
    pub system_program: Program<'info, System>,
}

pub fn finalize_season(ctx: Context<FinalizeSeason>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    let season = &mut ctx.accounts.season;
    require!(now >= season.end_ts, SleeperError::SeasonNotEnded);
    require!(!season.finalized, SleeperError::AlreadyFinalized);
    require!(season.scored_count == season.song_count, SleeperError::SeasonIncomplete);
    require!(config.unapplied == 0, SleeperError::PayoutsPending);

    // Nobody grew: hand the stakes back and roll the fees into next season.
    let refund = season.total_weight == 0;
    let payout_pot = if refund { season.staked } else { season.pot };
    let rollover = season.pot - payout_pot;

    let next = &mut ctx.accounts.next_season;
    next.id = season.id + 1;
    next.start_ts = now;
    next.end_ts = now + config.season_secs;
    next.pot = rollover;
    next.bump = ctx.bumps.next_season;
    if rollover > 0 {
        season.to_account_info().sub_lamports(rollover)?;
        next.to_account_info().add_lamports(rollover)?;
    }

    season.pot = payout_pot;
    season.payout_pot = payout_pot;
    season.refund = refund;
    season.finalized = true;
    config.current_season = next.id;
    config.unapplied = season.song_count;

    emit!(SeasonFinalized {
        season_id: season.id,
        payout_pot,
        rollover,
        total_weight: season.total_weight,
        refund,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ApplyPayout<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SONG_SEED, song.song_id.as_ref()], bump = song.bump)]
    pub song: Account<'info, Song>,
    #[account(
        mut,
        seeds = [SEASON_SEED, &song.season_id.to_le_bytes()],
        bump = season.bump
    )]
    pub season: Account<'info, Season>,
    #[account(
        mut,
        seeds = [SEASON_SEED, &(song.season_id + 1).to_le_bytes()],
        bump = next_season.bump
    )]
    pub next_season: Account<'info, Season>,
}

/// Permissionless crank: pays one song its share and moves it into the next season.
pub fn apply_payout(ctx: Context<ApplyPayout>) -> Result<()> {
    let season = &mut ctx.accounts.season;
    let next = &mut ctx.accounts.next_season;
    let song = &mut ctx.accounts.song;
    require!(season.finalized, SleeperError::NotFinalized);
    require!(song.phase == Phase::Scored, SleeperError::NotScored);

    let payout = if season.refund {
        song.last_stake
    } else {
        m(pro_rata(season.payout_pot, song.last_weight, season.total_weight))?
    };
    // Rounding can only leave dust behind, never overdraw.
    let payout = payout.min(season.pot);

    if payout > 0 {
        let mut curve = song.curve();
        m(curve.rescale(song.real_sol.checked_add(payout).ok_or(SleeperError::Overflow)?))?;
        song.set_curve(&curve);
        season.to_account_info().sub_lamports(payout)?;
        song.to_account_info().add_lamports(payout)?;
        season.pot -= payout;
    }

    let now = Clock::get()?.unix_timestamp;
    song.season_id = next.id;
    song.baseline = song.last_final;
    song.sol_seconds = 0;
    song.accrued_ts = now.max(next.start_ts);
    song.phase = Phase::Trading;
    next.song_count = next.song_count.checked_add(1).ok_or(SleeperError::Overflow)?;
    season.applied_count += 1;
    let config = &mut ctx.accounts.config;
    config.unapplied = config.unapplied.checked_sub(1).ok_or(SleeperError::Overflow)?;

    // Last song out sweeps rounding dust into the next pot.
    if season.applied_count == season.song_count && season.pot > 0 {
        let dust = season.pot;
        season.to_account_info().sub_lamports(dust)?;
        next.to_account_info().add_lamports(dust)?;
        next.pot = next.pot.checked_add(dust).ok_or(SleeperError::Overflow)?;
        season.pot = 0;
    }

    emit!(PayoutApplied {
        song: song.key(),
        season_id: season.id,
        payout,
        virtual_sol: song.virtual_sol,
        real_sol: song.real_sol,
    });
    Ok(())
}
