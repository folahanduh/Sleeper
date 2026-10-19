use anchor_lang::prelude::*;

use crate::math::Curve;

pub const CONFIG_SEED: &[u8] = b"config";
pub const SEASON_SEED: &[u8] = b"season";
pub const SONG_SEED: &[u8] = b"song";
pub const MINT_SEED: &[u8] = b"mint";

pub const TOKEN_DECIMALS: u8 = 6;
/// 1B tokens per song, all of it on the curve. No team or dev allocation.
pub const TOTAL_SUPPLY: u64 = 1_000_000_000 * 10u64.pow(TOKEN_DECIMALS as u32);

pub const MAX_NAME_LEN: usize = 64;
pub const MAX_SYMBOL_LEN: usize = 10;
pub const MAX_URI_LEN: usize = 200;

/// Hard caps the admin can never exceed.
pub const MAX_TOTAL_FEE_BPS: u16 = 500;
pub const MAX_STAKE_BPS: u16 = 5_000;
pub const MIN_SEASON_SECS: i64 = 3_600;
pub const MAX_SEASON_SECS: i64 = 365 * 86_400;
pub const MIN_GRACE_SECS: i64 = 86_400;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    /// Signs launches (verifies the song is real, sets its baseline) and season scores.
    pub oracle: Pubkey,
    pub treasury: Pubkey,
    pub fee_protocol_bps: u16,
    pub fee_creator_bps: u16,
    pub fee_pot_bps: u16,
    /// Share of a song's curve SOL put at stake each season.
    pub stake_bps: u16,
    pub season_secs: i64,
    /// After a season ends, anyone may neutrally score songs the oracle skipped.
    pub grace_secs: i64,
    /// Added to the baseline when scoring, so a 0 -> 50 listener song isn't infinite growth.
    pub score_smoothing: u64,
    pub max_score: u64,
    pub initial_virtual_sol: u64,
    pub initial_virtual_token: u64,
    pub current_season: u32,
    /// Songs of the last finalized season still waiting for apply_payout.
    pub unapplied: u32,
    pub paused: bool,
    pub bump: u8,
}

impl Config {
    pub fn total_fee_bps(&self) -> u16 {
        self.fee_protocol_bps + self.fee_creator_bps + self.fee_pot_bps
    }
}

#[account]
#[derive(InitSpace)]
pub struct Season {
    pub id: u32,
    pub start_ts: i64,
    pub end_ts: i64,
    pub song_count: u32,
    pub scored_count: u32,
    pub applied_count: u32,
    /// Lamports this account holds for the pot (fees, stakes, rollover), beyond rent.
    pub pot: u64,
    /// Sum of stakes taken this season (refunded if no song grew).
    pub staked: u64,
    /// Pot frozen at finalize, shared out by weight.
    pub payout_pot: u64,
    pub total_weight: u128,
    pub finalized: bool,
    /// No song grew: stakes go back, fees roll over.
    pub refund: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum Phase {
    Trading,
    Scored,
}

#[account]
#[derive(InitSpace)]
pub struct Song {
    /// sha256 of the oracle's canonical song key (ISRC where known). One coin per song.
    pub song_id: [u8; 32],
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub season_id: u32,
    pub phase: Phase,
    /// Traction index when this season started for the song.
    pub baseline: u64,
    pub virtual_sol: u64,
    pub virtual_token: u64,
    pub real_sol: u64,
    pub real_token: u64,
    pub initial_virtual_token: u64,
    /// Unclaimed creator fees, held in this account.
    pub creator_fees: u64,
    pub last_final: u64,
    pub last_score: u64,
    pub last_stake: u64,
    pub last_weight: u128,
    /// Integral of real_sol over time this season (lamport-seconds). Stakes and pot
    /// shares use the time-weighted average, so buying a known hit seconds before
    /// the season closes earns almost nothing.
    pub sol_seconds: u128,
    pub accrued_ts: i64,
    pub launched_ts: i64,
    pub bump: u8,
    pub mint_bump: u8,
}

impl Song {
    pub fn curve(&self) -> Curve {
        Curve {
            virtual_sol: self.virtual_sol,
            virtual_token: self.virtual_token,
            real_sol: self.real_sol,
            real_token: self.real_token,
            initial_virtual_token: self.initial_virtual_token,
        }
    }

    /// Bank real_sol * elapsed up to `now` (capped at the season end). Call before
    /// every change to real_sol.
    pub fn accrue(&mut self, now: i64, season_end: i64) {
        let until = now.min(season_end);
        if until > self.accrued_ts {
            let dt = (until - self.accrued_ts) as u128;
            self.sol_seconds = self.sol_seconds.saturating_add(u128::from(self.real_sol) * dt);
            self.accrued_ts = until;
        }
    }

    /// Time-weighted average real_sol over the whole season.
    pub fn twa_sol(&self, season_start: i64, season_end: i64) -> u64 {
        let len = (season_end - season_start).max(1) as u128;
        u64::try_from(self.sol_seconds / len).unwrap_or(u64::MAX)
    }

    pub fn set_curve(&mut self, c: &Curve) {
        self.virtual_sol = c.virtual_sol;
        self.virtual_token = c.virtual_token;
        self.real_sol = c.real_sol;
        self.real_token = c.real_token;
    }
}
