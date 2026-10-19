use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::spl_token_2022::instruction::AuthorityType;
use anchor_spl::token_interface::{
    mint_to, set_authority, token_metadata_initialize, Mint, MintTo, SetAuthority, Token2022,
    TokenAccount, TokenMetadataInitialize,
};

use crate::errors::SleeperError;
use crate::events::SongLaunched;
use crate::math::Curve;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct LaunchArgs {
    pub song_id: [u8; 32],
    pub baseline: u64,
    pub name: String,
    pub symbol: String,
    pub uri: String,
}

/// The oracle co-signs every launch: it has checked the song exists on the public
/// data sources, derived `song_id` from it, and measured `baseline` traction.
#[derive(Accounts)]
#[instruction(args: LaunchArgs)]
pub struct LaunchSong<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(address = config.oracle)]
    pub oracle: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [SEASON_SEED, &config.current_season.to_le_bytes()],
        bump = season.bump
    )]
    pub season: Box<Account<'info, Season>>,
    #[account(
        init,
        payer = creator,
        space = 8 + Song::INIT_SPACE,
        seeds = [SONG_SEED, args.song_id.as_ref()],
        bump
    )]
    pub song: Box<Account<'info, Song>>,
    #[account(
        init,
        payer = creator,
        seeds = [MINT_SEED, song.key().as_ref()],
        bump,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = song,
        mint::token_program = token_program,
        extensions::metadata_pointer::authority = song,
        extensions::metadata_pointer::metadata_address = mint,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = song,
        associated_token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn launch_song(ctx: Context<LaunchSong>, args: LaunchArgs) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, SleeperError::Paused);
    let now = Clock::get()?.unix_timestamp;
    require!(now < ctx.accounts.season.end_ts, SleeperError::SeasonEnded);
    require!(
        !args.name.trim().is_empty()
            && args.name.len() <= MAX_NAME_LEN
            && !args.symbol.trim().is_empty()
            && args.symbol.len() <= MAX_SYMBOL_LEN
            && args.uri.len() <= MAX_URI_LEN,
        SleeperError::BadMetadata
    );

    let song_key = ctx.accounts.song.key();
    let song_bump = ctx.bumps.song;
    let seeds: &[&[u8]] = &[SONG_SEED, args.song_id.as_ref(), &[song_bump]];
    let signer = &[seeds];
    let token_program = ctx.accounts.token_program.key();

    token_metadata_initialize(
        CpiContext::new_with_signer(
            token_program,
            TokenMetadataInitialize {
                program_id: ctx.accounts.token_program.to_account_info(),
                metadata: ctx.accounts.mint.to_account_info(),
                update_authority: ctx.accounts.song.to_account_info(),
                mint_authority: ctx.accounts.song.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
            },
            signer,
        ),
        args.name.clone(),
        args.symbol.clone(),
        args.uri.clone(),
    )?;

    // Metadata grew the mint; top it back up to rent-exempt.
    let mint_info = ctx.accounts.mint.to_account_info();
    let needed = Rent::get()?
        .minimum_balance(mint_info.data_len())
        .saturating_sub(mint_info.lamports());
    if needed > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: mint_info.clone(),
                },
            ),
            needed,
        )?;
    }

    mint_to(
        CpiContext::new_with_signer(
            token_program,
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.song.to_account_info(),
            },
            signer,
        ),
        TOTAL_SUPPLY,
    )?;

    // Fixed supply forever.
    set_authority(
        CpiContext::new_with_signer(
            token_program,
            SetAuthority {
                current_authority: ctx.accounts.song.to_account_info(),
                account_or_mint: ctx.accounts.mint.to_account_info(),
            },
            signer,
        ),
        AuthorityType::MintTokens,
        None,
    )?;

    let curve = Curve::new(config.initial_virtual_sol, config.initial_virtual_token, TOTAL_SUPPLY);
    let season = &mut ctx.accounts.season;
    season.song_count = season.song_count.checked_add(1).ok_or(SleeperError::Overflow)?;

    let song = &mut ctx.accounts.song;
    song.song_id = args.song_id;
    song.mint = ctx.accounts.mint.key();
    song.creator = ctx.accounts.creator.key();
    song.season_id = season.id;
    song.phase = Phase::Trading;
    song.baseline = args.baseline;
    song.initial_virtual_token = curve.initial_virtual_token;
    song.set_curve(&curve);
    song.creator_fees = 0;
    song.last_final = args.baseline;
    song.sol_seconds = 0;
    song.accrued_ts = now;
    song.launched_ts = now;
    song.bump = song_bump;
    song.mint_bump = ctx.bumps.mint;

    emit!(SongLaunched {
        song: song_key,
        mint: song.mint,
        creator: song.creator,
        song_id: args.song_id,
        season_id: song.season_id,
        baseline: args.baseline,
        name: args.name,
        symbol: args.symbol,
        uri: args.uri,
    });
    Ok(())
}
