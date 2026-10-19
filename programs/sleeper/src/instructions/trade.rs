use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    transfer_checked, Mint, Token2022, TokenAccount, TransferChecked,
};

use crate::errors::{m, SleeperError};
use crate::events::Traded;
use crate::math::fee;
use crate::state::*;

#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [SONG_SEED, song.song_id.as_ref()],
        bump = song.bump,
        has_one = mint
    )]
    pub song: Box<Account<'info, Song>>,
    #[account(
        mut,
        seeds = [SEASON_SEED, &song.season_id.to_le_bytes()],
        bump = season.bump
    )]
    pub season: Box<Account<'info, Season>>,
    /// CHECK: fee recipient, pinned to config.
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = song,
        associated_token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = trader,
        associated_token::mint = mint,
        associated_token::authority = trader,
        associated_token::token_program = token_program,
    )]
    pub trader_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

struct Fees {
    protocol: u64,
    creator: u64,
    pot: u64,
}

impl Fees {
    fn on(amount: u64, c: &Config) -> Result<Fees> {
        Ok(Fees {
            protocol: m(fee(amount, c.fee_protocol_bps))?,
            creator: m(fee(amount, c.fee_creator_bps))?,
            pot: m(fee(amount, c.fee_pot_bps))?,
        })
    }
    fn total(&self) -> u64 {
        self.protocol + self.creator + self.pot
    }
}

impl<'info> Trade<'info> {
    fn check_open(&self) -> Result<()> {
        require!(!self.config.paused, SleeperError::Paused);
        require!(self.song.phase == Phase::Trading, SleeperError::NotTrading);
        let now = Clock::get()?.unix_timestamp;
        require!(now < self.season.end_ts, SleeperError::SeasonEnded);
        Ok(())
    }

    fn pay(&self, to: AccountInfo<'info>, amount: u64) -> Result<()> {
        if amount == 0 {
            return Ok(());
        }
        system_program::transfer(
            CpiContext::new(
                self.system_program.key(),
                system_program::Transfer { from: self.trader.to_account_info(), to },
            ),
            amount,
        )
    }

    /// The song account must always hold rent + curve SOL + unclaimed creator fees.
    fn assert_backed(&self) -> Result<()> {
        let info = self.song.to_account_info();
        let rent = Rent::get()?.minimum_balance(info.data_len());
        let owed = rent
            .checked_add(self.song.real_sol)
            .and_then(|v| v.checked_add(self.song.creator_fees))
            .ok_or(SleeperError::Overflow)?;
        require!(info.lamports() >= owed, SleeperError::BalanceMismatch);
        Ok(())
    }

    fn emit_trade(&self, is_buy: bool, sol: u64, tokens: u64, fee: u64) -> Result<()> {
        emit!(Traded {
            song: self.song.key(),
            trader: self.trader.key(),
            is_buy,
            sol,
            tokens,
            fee,
            virtual_sol: self.song.virtual_sol,
            virtual_token: self.song.virtual_token,
            real_sol: self.song.real_sol,
            ts: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }
}

/// Spend up to `max_sol` lamports (curve + fees) for at least `min_tokens`.
pub fn buy(mut ctx: Context<Trade>, max_sol: u64, min_tokens: u64) -> Result<()> {
    let a = &ctx.accounts;
    a.check_open()?;
    let net = max_sol
        .checked_sub(m(fee(max_sol, a.config.total_fee_bps()))?)
        .ok_or(SleeperError::Overflow)?;
    let mut curve = a.song.curve();
    let (tokens, used) = m(curve.buy_quote(net))?;
    require!(tokens >= min_tokens, SleeperError::Slippage);
    let fees = Fees::on(used, &a.config)?;
    require!(used + fees.total() <= max_sol, SleeperError::Slippage);
    m(curve.apply_buy(used, tokens))?;

    a.pay(a.song.to_account_info(), used + fees.creator)?;
    a.pay(a.season.to_account_info(), fees.pot)?;
    a.pay(a.treasury.to_account_info(), fees.protocol)?;

    let song_id = a.song.song_id;
    let seeds: &[&[u8]] = &[SONG_SEED, song_id.as_ref(), &[a.song.bump]];
    transfer_checked(
        CpiContext::new_with_signer(
            a.token_program.key(),
            TransferChecked {
                from: a.vault.to_account_info(),
                mint: a.mint.to_account_info(),
                to: a.trader_ata.to_account_info(),
                authority: a.song.to_account_info(),
            },
            &[seeds],
        ),
        tokens,
        TOKEN_DECIMALS,
    )?;

    let a = &mut ctx.accounts;
    let end = a.season.end_ts;
    a.song.accrue(Clock::get()?.unix_timestamp, end);
    a.song.set_curve(&curve);
    a.song.creator_fees = a.song.creator_fees.checked_add(fees.creator).ok_or(SleeperError::Overflow)?;
    a.season.pot = a.season.pot.checked_add(fees.pot).ok_or(SleeperError::Overflow)?;
    a.assert_backed()?;
    a.emit_trade(true, used, tokens, fees.total())
}

/// Sell `tokens` for at least `min_sol` lamports after fees.
pub fn sell(mut ctx: Context<Trade>, tokens: u64, min_sol: u64) -> Result<()> {
    let a = &ctx.accounts;
    a.check_open()?;
    let mut curve = a.song.curve();
    let gross = m(curve.sell_quote(tokens))?;
    let fees = Fees::on(gross, &a.config)?;
    let out = gross - fees.total();
    require!(out >= min_sol, SleeperError::Slippage);
    m(curve.apply_sell(gross, tokens))?;

    transfer_checked(
        CpiContext::new(
            a.token_program.key(),
            TransferChecked {
                from: a.trader_ata.to_account_info(),
                mint: a.mint.to_account_info(),
                to: a.vault.to_account_info(),
                authority: a.trader.to_account_info(),
            },
        ),
        tokens,
        TOKEN_DECIMALS,
    )?;

    // Creator fee stays in the song account; everything else leaves it.
    let song_info = a.song.to_account_info();
    song_info.sub_lamports(gross - fees.creator)?;
    a.trader.to_account_info().add_lamports(out)?;
    a.season.to_account_info().add_lamports(fees.pot)?;
    a.treasury.to_account_info().add_lamports(fees.protocol)?;

    let a = &mut ctx.accounts;
    let end = a.season.end_ts;
    a.song.accrue(Clock::get()?.unix_timestamp, end);
    a.song.set_curve(&curve);
    a.song.creator_fees = a.song.creator_fees.checked_add(fees.creator).ok_or(SleeperError::Overflow)?;
    a.season.pot = a.season.pot.checked_add(fees.pot).ok_or(SleeperError::Overflow)?;
    a.assert_backed()?;
    a.emit_trade(false, gross, tokens, fees.total())
}

#[derive(Accounts)]
pub struct ClaimCreatorFees<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, seeds = [SONG_SEED, song.song_id.as_ref()], bump = song.bump, has_one = creator)]
    pub song: Account<'info, Song>,
}

pub fn claim_creator_fees(ctx: Context<ClaimCreatorFees>) -> Result<()> {
    let amount = ctx.accounts.song.creator_fees;
    require!(amount > 0, SleeperError::ZeroAmount);
    ctx.accounts.song.creator_fees = 0;
    ctx.accounts.song.to_account_info().sub_lamports(amount)?;
    ctx.accounts.creator.to_account_info().add_lamports(amount)?;
    Ok(())
}
