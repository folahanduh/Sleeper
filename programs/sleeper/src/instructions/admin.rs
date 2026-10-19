use anchor_lang::prelude::*;

use crate::errors::SleeperError;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ConfigParams {
    pub oracle: Pubkey,
    pub treasury: Pubkey,
    pub fee_protocol_bps: u16,
    pub fee_creator_bps: u16,
    pub fee_pot_bps: u16,
    pub stake_bps: u16,
    pub season_secs: i64,
    pub grace_secs: i64,
    pub score_smoothing: u64,
    pub max_score: u64,
    pub initial_virtual_sol: u64,
    pub initial_virtual_token: u64,
}

impl ConfigParams {
    fn validate(&self) -> Result<()> {
        let fees = u32::from(self.fee_protocol_bps)
            + u32::from(self.fee_creator_bps)
            + u32::from(self.fee_pot_bps);
        require!(fees <= u32::from(MAX_TOTAL_FEE_BPS), SleeperError::BadConfig);
        require!(self.stake_bps <= MAX_STAKE_BPS, SleeperError::BadConfig);
        require!(
            (MIN_SEASON_SECS..=MAX_SEASON_SECS).contains(&self.season_secs),
            SleeperError::BadConfig
        );
        require!(self.grace_secs >= MIN_GRACE_SECS, SleeperError::BadConfig);
        require!(self.score_smoothing > 0 && self.max_score > 0, SleeperError::BadConfig);
        require!(self.initial_virtual_sol > 0, SleeperError::BadConfig);
        // Virtual tokens must exceed the real supply so the curve can never hit zero.
        require!(self.initial_virtual_token > TOTAL_SUPPLY, SleeperError::BadConfig);
        require!(
            self.oracle != Pubkey::default() && self.treasury != Pubkey::default(),
            SleeperError::BadConfig
        );
        Ok(())
    }

    fn apply(&self, c: &mut Config) {
        c.oracle = self.oracle;
        c.treasury = self.treasury;
        c.fee_protocol_bps = self.fee_protocol_bps;
        c.fee_creator_bps = self.fee_creator_bps;
        c.fee_pot_bps = self.fee_pot_bps;
        c.stake_bps = self.stake_bps;
        c.season_secs = self.season_secs;
        c.grace_secs = self.grace_secs;
        c.score_smoothing = self.score_smoothing;
        c.max_score = self.max_score;
        c.initial_virtual_sol = self.initial_virtual_sol;
        c.initial_virtual_token = self.initial_virtual_token;
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = admin,
        space = 8 + Season::INIT_SPACE,
        seeds = [SEASON_SEED, &0u32.to_le_bytes()],
        bump
    )]
    pub season: Account<'info, Season>,
    pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<Initialize>, params: ConfigParams) -> Result<()> {
    params.validate()?;
    let now = Clock::get()?.unix_timestamp;
    let c = &mut ctx.accounts.config;
    c.admin = ctx.accounts.admin.key();
    c.pending_admin = Pubkey::default();
    params.apply(c);
    c.current_season = 0;
    c.unapplied = 0;
    c.paused = false;
    c.bump = ctx.bumps.config;

    let s = &mut ctx.accounts.season;
    s.id = 0;
    s.start_ts = now;
    s.end_ts = now + params.season_secs;
    s.bump = ctx.bumps.season;
    Ok(())
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
}

/// Fee, stake and curve changes apply going forward; existing curves keep their own reserves.
pub fn update_config(ctx: Context<AdminOnly>, params: ConfigParams) -> Result<()> {
    params.validate()?;
    params.apply(&mut ctx.accounts.config);
    Ok(())
}

pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    Ok(())
}

pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
    ctx.accounts.config.pending_admin = new_admin;
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let c = &mut ctx.accounts.config;
    require_keys_eq!(
        ctx.accounts.new_admin.key(),
        c.pending_admin,
        SleeperError::NotPendingAdmin
    );
    c.admin = c.pending_admin;
    c.pending_admin = Pubkey::default();
    Ok(())
}
