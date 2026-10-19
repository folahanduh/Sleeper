use anchor_lang::prelude::*;

#[event]
pub struct SongLaunched {
    pub song: Pubkey,
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub song_id: [u8; 32],
    pub season_id: u32,
    pub baseline: u64,
    pub name: String,
    pub symbol: String,
    pub uri: String,
}

#[event]
pub struct Traded {
    pub song: Pubkey,
    pub trader: Pubkey,
    pub is_buy: bool,
    pub sol: u64,
    pub tokens: u64,
    pub fee: u64,
    pub virtual_sol: u64,
    pub virtual_token: u64,
    pub real_sol: u64,
    pub ts: i64,
}

#[event]
pub struct SongScored {
    pub song: Pubkey,
    pub season_id: u32,
    pub baseline: u64,
    pub final_traction: u64,
    pub score: u64,
    pub stake: u64,
    /// sha256 of the oracle's published raw snapshot (Last.fm / YouTube / Deezer).
    pub snapshot_hash: [u8; 32],
    pub neutral: bool,
}

#[event]
pub struct SeasonFinalized {
    pub season_id: u32,
    pub payout_pot: u64,
    pub rollover: u64,
    pub total_weight: u128,
    pub refund: bool,
}

#[event]
pub struct PayoutApplied {
    pub song: Pubkey,
    pub season_id: u32,
    pub payout: u64,
    pub virtual_sol: u64,
    pub real_sol: u64,
}
