use anchor_lang::prelude::*;

use crate::math::MathError;

#[error_code]
pub enum SleeperError {
    #[msg("Math overflow")]
    Overflow,
    #[msg("Curve cannot pay this sell")]
    Insolvent,
    #[msg("Curve is sold out")]
    SoldOut,
    #[msg("Amount too small")]
    ZeroAmount,
    #[msg("Slippage limit exceeded")]
    Slippage,
    #[msg("Platform is paused")]
    Paused,
    #[msg("Season has ended; trading resumes after settlement")]
    SeasonEnded,
    #[msg("Season has not ended yet")]
    SeasonNotEnded,
    #[msg("Song is not in the trading phase")]
    NotTrading,
    #[msg("Song has not been scored")]
    NotScored,
    #[msg("Song belongs to a different season")]
    WrongSeason,
    #[msg("Not every song in the season is scored")]
    SeasonIncomplete,
    #[msg("Season is already finalized")]
    AlreadyFinalized,
    #[msg("Season is not finalized")]
    NotFinalized,
    #[msg("Previous season still has payouts to apply")]
    PayoutsPending,
    #[msg("Only the oracle may score before the grace period ends")]
    GraceNotOver,
    #[msg("Name, symbol or URI too long or empty")]
    BadMetadata,
    #[msg("Config value out of bounds")]
    BadConfig,
    #[msg("Signer is not the pending admin")]
    NotPendingAdmin,
    #[msg("Account balance does not cover its obligations")]
    BalanceMismatch,
}

impl From<MathError> for SleeperError {
    fn from(e: MathError) -> Self {
        match e {
            MathError::Overflow => SleeperError::Overflow,
            MathError::Insolvent => SleeperError::Insolvent,
            MathError::SoldOut => SleeperError::SoldOut,
            MathError::ZeroAmount => SleeperError::ZeroAmount,
        }
    }
}

pub fn m<T>(r: core::result::Result<T, MathError>) -> Result<T> {
    r.map_err(|e| error!(SleeperError::from(e)))
}
