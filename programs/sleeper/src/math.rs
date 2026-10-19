//! Pure curve, fee and season math. No Anchor types, so it is unit-tested directly.
//!
//! Curve model: constant product on (virtual_sol, virtual_token), like pump.fun.
//! `real_sol` is the SOL actually held for the curve. The solvency invariant is
//!
//! ```text
//! virtual_sol * (1 - virtual_token / initial_virtual_token) <= real_sol
//! ```
//!
//! i.e. if every circulating token were sold back, the curve could pay for it.
//! Trades preserve it (rounding always favours the curve), and season settlement
//! preserves it by scaling `virtual_sol` by exactly real_sol_new / real_sol_old,
//! which also scales the price by that factor. That is how real-world traction
//! moves a coin's price: a hit gets SOL added (price up), a flop loses its stake
//! (price down), and nobody's sell can ever exceed the SOL that is there.

pub const BPS: u64 = 10_000;
/// Fixed point for growth scores: SCORE_ONE = 1.0x growth.
pub const SCORE_ONE: u64 = 1_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Curve {
    pub virtual_sol: u64,
    pub virtual_token: u64,
    pub real_sol: u64,
    pub real_token: u64,
    pub initial_virtual_token: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MathError {
    Overflow,
    Insolvent,
    SoldOut,
    ZeroAmount,
}

type R<T> = Result<T, MathError>;

fn ceil_div(a: u128, b: u128) -> R<u128> {
    if b == 0 {
        return Err(MathError::Overflow);
    }
    Ok(a / b + u128::from(a % b != 0))
}

fn to_u64(v: u128) -> R<u64> {
    u64::try_from(v).map_err(|_| MathError::Overflow)
}

/// Fee in lamports for `amount` at `bps`, floored.
pub fn fee(amount: u64, bps: u16) -> R<u64> {
    to_u64(u128::from(amount) * u128::from(bps) / u128::from(BPS))
}

impl Curve {
    pub fn new(virtual_sol: u64, initial_virtual_token: u64, supply: u64) -> Self {
        Curve {
            virtual_sol,
            virtual_token: initial_virtual_token,
            real_sol: 0,
            real_token: supply,
            initial_virtual_token,
        }
    }

    /// Tokens out for `net_in` lamports (after fees). If that would take more than the
    /// curve holds, buys exactly the remainder. Returns (tokens_out, lamports_used).
    pub fn buy_quote(&self, net_in: u64) -> R<(u64, u64)> {
        if net_in == 0 {
            return Err(MathError::ZeroAmount);
        }
        if self.real_token == 0 {
            return Err(MathError::SoldOut);
        }
        let x = u128::from(self.virtual_sol);
        let y = u128::from(self.virtual_token);
        let d = u128::from(net_in);
        let out = y * d / (x + d);
        if out == 0 {
            return Err(MathError::ZeroAmount);
        }
        if out <= u128::from(self.real_token) {
            return Ok((to_u64(out)?, net_in));
        }
        let t = u128::from(self.real_token);
        let need = ceil_div(x.checked_mul(t).ok_or(MathError::Overflow)?, y - t)?;
        Ok((self.real_token, to_u64(need)?))
    }

    /// Lamports out (before fees) for selling `tokens_in`.
    pub fn sell_quote(&self, tokens_in: u64) -> R<u64> {
        if tokens_in == 0 {
            return Err(MathError::ZeroAmount);
        }
        let x = u128::from(self.virtual_sol);
        let y = u128::from(self.virtual_token);
        let t = u128::from(tokens_in);
        let out = to_u64(x * t / (y + t))?;
        if out > self.real_sol {
            return Err(MathError::Insolvent);
        }
        Ok(out)
    }

    pub fn apply_buy(&mut self, lamports: u64, tokens: u64) -> R<()> {
        self.virtual_sol = self.virtual_sol.checked_add(lamports).ok_or(MathError::Overflow)?;
        self.real_sol = self.real_sol.checked_add(lamports).ok_or(MathError::Overflow)?;
        self.virtual_token = self.virtual_token.checked_sub(tokens).ok_or(MathError::Overflow)?;
        self.real_token = self.real_token.checked_sub(tokens).ok_or(MathError::Overflow)?;
        Ok(())
    }

    pub fn apply_sell(&mut self, lamports: u64, tokens: u64) -> R<()> {
        self.virtual_sol = self.virtual_sol.checked_sub(lamports).ok_or(MathError::Overflow)?;
        self.real_sol = self.real_sol.checked_sub(lamports).ok_or(MathError::Insolvent)?;
        self.virtual_token = self.virtual_token.checked_add(tokens).ok_or(MathError::Overflow)?;
        self.real_token = self.real_token.checked_add(tokens).ok_or(MathError::Overflow)?;
        Ok(())
    }

    /// Move the curve's real SOL to `new_real_sol`, scaling virtual_sol (and so the
    /// price) by the same factor. Used for season stakes (down) and payouts (up).
    pub fn rescale(&mut self, new_real_sol: u64) -> R<()> {
        if self.real_sol == 0 {
            // Nothing staked, so nothing can be paid in either.
            return if new_real_sol == 0 { Ok(()) } else { Err(MathError::Overflow) };
        }
        let scaled =
            u128::from(self.virtual_sol) * u128::from(new_real_sol) / u128::from(self.real_sol);
        self.virtual_sol = to_u64(scaled)?.max(1);
        self.real_sol = new_real_sol;
        Ok(())
    }

    /// Price in lamports per whole token, times 1e9 (for events and tests).
    pub fn price_scaled(&self) -> u128 {
        u128::from(self.virtual_sol) * 1_000_000_000 / u128::from(self.virtual_token.max(1))
    }

    /// True if every circulating token could be sold back for SOL the curve holds.
    pub fn is_solvent(&self) -> bool {
        let x = u128::from(self.virtual_sol);
        let y = u128::from(self.virtual_token);
        let y0 = u128::from(self.initial_virtual_token);
        // x * (1 - y/y0) <= real  <=>  x*(y0 - y) <= real*y0
        x * (y0 - y.min(y0)) <= u128::from(self.real_sol) * y0
    }
}

/// Growth score: (final - baseline) / (baseline + smoothing), in SCORE_ONE units,
/// clamped to [0, max]. Low-traction songs that blow up score highest; a song that
/// shrinks or stalls scores 0 and loses its stake.
pub fn growth_score(baseline: u64, final_traction: u64, smoothing: u64, max: u64) -> u64 {
    if final_traction <= baseline {
        return 0;
    }
    let num = u128::from(final_traction - baseline) * u128::from(SCORE_ONE);
    let den = u128::from(baseline) + u128::from(smoothing.max(1));
    u64::try_from(num / den).unwrap_or(u64::MAX).min(max)
}

/// A song's claim on the season pot.
pub fn weight(stake: u64, score: u64) -> u128 {
    u128::from(stake) * u128::from(score)
}

/// floor(pot * weight / total_weight)
pub fn pro_rata(pot: u64, weight: u128, total_weight: u128) -> R<u64> {
    if total_weight == 0 {
        return Ok(0);
    }
    let num = u128::from(pot).checked_mul(weight).ok_or(MathError::Overflow)?;
    to_u64(num / total_weight)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SUPPLY: u64 = 1_000_000_000_000_000; // 1B, 6 decimals
    const VTOKEN: u64 = 1_073_000_000_000_000;
    const VSOL: u64 = 30_000_000_000;

    fn fresh() -> Curve {
        Curve::new(VSOL, VTOKEN, SUPPLY)
    }

    fn sell_everything(c: &mut Curve) {
        let circulating = SUPPLY - c.real_token;
        if circulating > 0 {
            let out = c.sell_quote(circulating).expect("must be able to sell all");
            c.apply_sell(out, circulating).unwrap();
        }
    }

    #[test]
    fn buy_then_sell_never_profits() {
        let mut c = fresh();
        let (t, used) = c.buy_quote(1_000_000_000).unwrap();
        c.apply_buy(used, t).unwrap();
        let back = c.sell_quote(t).unwrap();
        assert!(back <= used);
        assert!(c.is_solvent());
    }

    #[test]
    fn sold_out_buys_exact_remainder() {
        let mut c = fresh();
        let (t, used) = c.buy_quote(10_000_000_000_000).unwrap();
        assert_eq!(t, SUPPLY);
        assert!(used < 10_000_000_000_000);
        c.apply_buy(used, t).unwrap();
        assert_eq!(c.buy_quote(1).unwrap_err(), MathError::SoldOut);
        assert!(c.is_solvent());
        sell_everything(&mut c);
    }

    #[test]
    fn stake_crashes_price_but_stays_solvent() {
        let mut c = fresh();
        let (t, used) = c.buy_quote(20_000_000_000).unwrap();
        c.apply_buy(used, t).unwrap();
        let p0 = c.price_scaled();
        let stake = c.real_sol * 3_000 / BPS;
        c.rescale(c.real_sol - stake).unwrap();
        let p1 = c.price_scaled();
        assert!(p1 * 100 / p0 <= 70 && p1 * 100 / p0 >= 69, "{p0} -> {p1}");
        assert!(c.is_solvent());
        sell_everything(&mut c);
    }

    #[test]
    fn payout_pumps_price_and_stays_solvent() {
        let mut c = fresh();
        let (t, used) = c.buy_quote(500_000_000).unwrap();
        c.apply_buy(used, t).unwrap();
        let p0 = c.price_scaled();
        c.rescale(c.real_sol * 5).unwrap();
        assert!(c.price_scaled() >= p0 * 49 / 10);
        assert!(c.is_solvent());
        sell_everything(&mut c);
    }

    #[test]
    fn randomised_trades_and_rescales_stay_solvent() {
        // Small deterministic LCG so the test needs no deps.
        let mut s: u64 = 0x5eed;
        let mut next = || {
            s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            s >> 16
        };
        for _ in 0..200 {
            let mut c = fresh();
            for _ in 0..60 {
                match next() % 4 {
                    0 | 1 => {
                        if let Ok((t, used)) = c.buy_quote(next() % 50_000_000_000 + 1) {
                            c.apply_buy(used, t).unwrap();
                        }
                    }
                    2 => {
                        let circ = SUPPLY - c.real_token;
                        if circ > 0 {
                            let amt = next() % circ + 1;
                            if let Ok(out) = c.sell_quote(amt) {
                                c.apply_sell(out, amt).unwrap();
                            }
                        }
                    }
                    _ => {
                        if c.real_sol > 0 {
                            let factor = next() % 400 + 1; // 0.01x .. 4x
                            let nr = (u128::from(c.real_sol) * u128::from(factor) / 100) as u64;
                            c.rescale(nr.max(1)).unwrap();
                        }
                    }
                }
                assert!(c.is_solvent(), "{c:?}");
            }
            sell_everything(&mut c);
        }
    }

    #[test]
    fn growth_favours_underground_hits() {
        let k = 1_000;
        let max = 100 * SCORE_ONE;
        let underground = growth_score(1_000, 100_000, k, max);
        let superstar = growth_score(10_000_000, 10_200_000, k, max);
        assert!(underground > 40 * SCORE_ONE);
        assert!(superstar < SCORE_ONE / 10);
        assert_eq!(growth_score(5_000_000, 4_000_000, k, max), 0);
        assert_eq!(growth_score(0, 10_000_000, k, max), max);
    }

    #[test]
    fn pro_rata_never_exceeds_pot() {
        let w = [weight(10, 3), weight(7, 11), weight(1, 1)];
        let total: u128 = w.iter().sum();
        let paid: u64 = w.iter().map(|x| pro_rata(1_000_003, *x, total).unwrap()).sum();
        assert!(paid <= 1_000_003);
        assert_eq!(pro_rata(5, 1, 0).unwrap(), 0);
    }
}
