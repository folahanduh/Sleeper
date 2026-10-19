//! Sleeper: every coin is a real song. Trade it on a bonding curve; at the end of
//! each season the song's real-world traction (Last.fm, YouTube, Deezer) decides
//! whether its curve is paid from the pot (price up) or loses its stake (price down).
//! See docs/DESIGN.md.

use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;

declare_id!("5cP2rHGPuEWRHQ74mbzdFhNKYLfpH6rSaXtKHekoRNrL");

#[program]
pub mod sleeper {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, params: ConfigParams) -> Result<()> {
        instructions::admin::initialize(ctx, params)
    }

    pub fn update_config(ctx: Context<AdminOnly>, params: ConfigParams) -> Result<()> {
        instructions::admin::update_config(ctx, params)
    }

    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        instructions::admin::set_paused(ctx, paused)
    }

    pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::propose_admin(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::admin::accept_admin(ctx)
    }

    pub fn launch_song(ctx: Context<LaunchSong>, args: LaunchArgs) -> Result<()> {
        instructions::launch::launch_song(ctx, args)
    }

    pub fn buy(ctx: Context<Trade>, max_sol: u64, min_tokens: u64) -> Result<()> {
        instructions::trade::buy(ctx, max_sol, min_tokens)
    }

    pub fn sell(ctx: Context<Trade>, tokens: u64, min_sol: u64) -> Result<()> {
        instructions::trade::sell(ctx, tokens, min_sol)
    }

    pub fn claim_creator_fees(ctx: Context<ClaimCreatorFees>) -> Result<()> {
        instructions::trade::claim_creator_fees(ctx)
    }

    pub fn score_song(
        ctx: Context<ScoreSong>,
        final_traction: u64,
        snapshot_hash: [u8; 32],
    ) -> Result<()> {
        instructions::season::score_song(ctx, final_traction, snapshot_hash)
    }

    pub fn finalize_season(ctx: Context<FinalizeSeason>) -> Result<()> {
        instructions::season::finalize_season(ctx)
    }

    pub fn apply_payout(ctx: Context<ApplyPayout>) -> Result<()> {
        instructions::season::apply_payout(ctx)
    }
}
