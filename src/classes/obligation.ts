/* eslint-disable max-classes-per-file */
import { PublicKey } from '@solana/web3.js';
import Decimal from 'decimal.js';
import { KaminoReserve } from './reserve';
import { Obligation } from '../idl_codegen/accounts';
import { ElevationGroupDescription, KaminoMarket } from './market';
import BN from 'bn.js';
import { Fraction } from './fraction';
import { ObligationCollateral, ObligationLiquidity } from '../idl_codegen/types';
import { positiveOrZero, valueOrZero } from './utils';
import { isNotNullPubkey, PubkeyHashMap, U64_MAX } from '../utils';
import { ActionType } from './action';

export type Position = {
  reserveAddress: PublicKey;
  mintAddress: PublicKey;
  /**
   * Amount of tokens in lamports, including decimal places for interest accrued (no borrow factor weighting)
   */
  amount: Decimal;
  /**
   * Market value of the position in USD (no borrow factor weighting)
   */
  marketValueRefreshed: Decimal;
};

export type ObligationStats = {
  userTotalDeposit: Decimal;
  userTotalBorrow: Decimal;
  userTotalBorrowBorrowFactorAdjusted: Decimal;
  borrowLimit: Decimal;
  borrowLiquidationLimit: Decimal;
  borrowUtilization: Decimal;
  netAccountValue: Decimal;
  loanToValue: Decimal;
  liquidationLtv: Decimal;
  leverage: Decimal;
  potentialElevationGroupUpdate: number;
};

interface BorrowStats {
  borrows: Map<PublicKey, Position>;
  userTotalBorrow: Decimal;
  userTotalBorrowBorrowFactorAdjusted: Decimal;
  positions: number;
}

export class KaminoObligation {
  obligationAddress: PublicKey;

  state: Obligation;

  /**
   * Deposits stored in a map of reserve address to position
   */
  deposits: Map<PublicKey, Position>;

  /**
   * Borrows stored in a map of reserve address to position
   */
  borrows: Map<PublicKey, Position>;

  refreshedStats: ObligationStats;

  obligationTag: number;

  /**
   * Initialise a new Obligation from the deserialized state
   * @param market
   * @param obligationAddress
   * @param obligation
   * @param collateralExchangeRates - rates from the market by reserve address, will be calculated if not provided
   * @param cumulativeBorrowRates - rates from the market by reserve address, will be calculated if not provided
   */
  constructor(
    market: KaminoMarket,
    obligationAddress: PublicKey,
    obligation: Obligation,
    collateralExchangeRates: Map<PublicKey, Decimal>,
    cumulativeBorrowRates: Map<PublicKey, Decimal>
  ) {
    this.obligationAddress = obligationAddress;
    this.state = obligation;
    const { borrows, deposits, refreshedStats } = this.calculatePositions(
      market,
      obligation,
      collateralExchangeRates,
      cumulativeBorrowRates
    );
    this.deposits = deposits;
    this.borrows = borrows;
    this.refreshedStats = refreshedStats;
    this.obligationTag = obligation.tag.toNumber();
  }

  static async load(kaminoMarket: KaminoMarket, obligationAddress: PublicKey): Promise<KaminoObligation | null> {
    const res = await kaminoMarket.getConnection().getAccountInfoAndContext(obligationAddress);
    if (res.value === null) {
      return null;
    }
    const accInfo = res.value;
    if (!accInfo.owner.equals(kaminoMarket.programId)) {
      throw new Error("account doesn't belong to this program");
    }
    const obligation = Obligation.decode(accInfo.data);

    if (obligation === null) {
      return null;
    }
    const { collateralExchangeRates, cumulativeBorrowRates } = KaminoObligation.getRatesForObligation(
      kaminoMarket,
      obligation,
      res.context.slot
    );
    return new KaminoObligation(
      kaminoMarket,
      obligationAddress,
      obligation,
      collateralExchangeRates,
      cumulativeBorrowRates
    );
  }

  static async loadAll(
    kaminoMarket: KaminoMarket,
    obligationAddresses: PublicKey[],
    slot?: number
  ): Promise<(KaminoObligation | null)[]> {
    let currentSlot = slot;
    let obligations: (Obligation | null)[];
    if (!currentSlot) {
      [currentSlot, obligations] = await Promise.all([
        kaminoMarket.getConnection().getSlot(),
        Obligation.fetchMultiple(kaminoMarket.getConnection(), obligationAddresses, kaminoMarket.programId),
      ]);
    } else {
      obligations = await Obligation.fetchMultiple(
        kaminoMarket.getConnection(),
        obligationAddresses,
        kaminoMarket.programId
      );
    }
    const cumulativeBorrowRates = new PubkeyHashMap<PublicKey, Decimal>();
    const collateralExchangeRates = new PubkeyHashMap<PublicKey, Decimal>();
    for (const obligation of obligations) {
      if (obligation !== null) {
        KaminoObligation.addRatesForObligation(
          kaminoMarket,
          obligation,
          collateralExchangeRates,
          cumulativeBorrowRates,
          currentSlot
        );
      }
    }

    return obligations.map((obligation, i) => {
      if (obligation === null) {
        return null;
      }
      return new KaminoObligation(
        kaminoMarket,
        obligationAddresses[i],
        obligation,
        collateralExchangeRates,
        cumulativeBorrowRates
      );
    });
  }

  /**
   * @returns the obligation borrows as a list
   */
  getBorrows(): Array<Position> {
    return [...this.borrows.values()];
  }

  /**
   * @returns the obligation borrows as a list
   */
  getDeposits(): Array<Position> {
    return [...this.deposits.values()];
  }

  /**
   * @returns the total deposited value of the obligation (sum of all deposits)
   */
  getDepositedValue(): Decimal {
    return new Fraction(this.state.depositedValueSf).toDecimal();
  }

  /**
   * @returns the total borrowed value of the obligation (sum of all borrows -- no borrow factor)
   */
  getBorrowedMarketValue(): Decimal {
    return new Fraction(this.state.borrowedAssetsMarketValueSf).toDecimal();
  }

  /**
   * @returns the total borrowed value of the obligation (sum of all borrows -- with borrow factor weighting)
   */
  getBorrowedMarketValueBFAdjusted(): Decimal {
    return new Fraction(this.state.borrowFactorAdjustedDebtValueSf).toDecimal();
  }

  /**
   * @returns total borrow power of the obligation, relative to max LTV of each asset's reserve
   */
  getAllowedBorrowValue(): Decimal {
    return new Fraction(this.state.allowedBorrowValueSf).toDecimal();
  }

  /**
   * @returns the borrow value at which the obligation gets liquidatable
   * (relative to the liquidation threshold of each asset's reserve)
   */
  getUnhealthyBorrowValue(): Decimal {
    return new Fraction(this.state.unhealthyBorrowValueSf).toDecimal();
  }

  /**
   *
   * @returns Market value of the deposit in the specified obligation collateral/deposit asset (USD)
   */
  getDepositMarketValue(deposit: ObligationCollateral): Decimal {
    return new Fraction(deposit.marketValueSf).toDecimal();
  }

  getBorrowByReserve(reserve: PublicKey): Position | undefined {
    return this.borrows.get(reserve);
  }

  getDepositByReserve(reserve: PublicKey): Position | undefined {
    return this.deposits.get(reserve);
  }

  getBorrowByMint(mint: PublicKey): Position | undefined {
    for (const value of this.borrows.values()) {
      if (value.mintAddress.equals(mint)) {
        return value;
      }
    }
    return undefined;
  }

  getDepositByMint(mint: PublicKey): Position | undefined {
    for (const value of this.deposits.values()) {
      if (value.mintAddress.equals(mint)) {
        return value;
      }
    }
    return undefined;
  }

  /**
   *
   * @returns Market value of the borrow in the specified obligation liquidity/borrow asset (USD) (no borrow factor weighting)
   */
  getBorrowMarketValue(borrow: ObligationLiquidity): Decimal {
    return new Fraction(borrow.marketValueSf).toDecimal();
  }

  /**
   *
   * @returns Market value of the borrow in the specified obligation liquidity/borrow asset (USD) (with borrow factor weighting)
   */
  getBorrowMarketValueBFAdjusted(borrow: ObligationLiquidity): Decimal {
    return new Fraction(borrow.borrowFactorAdjustedMarketValueSf).toDecimal();
  }

  /**
   * Calculate the current ratio of borrowed value to deposited value
   */
  loanToValue(): Decimal {
    if (this.refreshedStats.userTotalDeposit.eq(0)) {
      return new Decimal(0);
    }
    return this.refreshedStats.userTotalBorrowBorrowFactorAdjusted.div(this.refreshedStats.userTotalDeposit);
  }

  /**
   * @returns the total number of positions (deposits + borrows)
   */
  getNumberOfPositions(): number {
    return this.deposits.size + this.borrows.size;
  }

  getNetAccountValue(): Decimal {
    return this.refreshedStats.netAccountValue;
  }

  /**
   * Get the loan to value and liquidation loan to value for a collateral token reserve as ratios, accounting for the obligation elevation group if it is active
   * @param market
   * @param reserve
   */
  public getLtvForReserve(market: KaminoMarket, reserve: KaminoReserve): { maxLtv: Decimal; liquidationLtv: Decimal } {
    return KaminoObligation.getLtvForReserve(market, reserve, this.state.elevationGroup);
  }

  /**
   * Get the borrow factor for a borrow reserve, accounting for the obligation elevation group if it is active
   * @param reserve
   */
  public getBorrowFactorForReserve(reserve: KaminoReserve): Decimal {
    return KaminoObligation.getBorrowFactorForReserve(reserve, this.state.elevationGroup);
  }

  /**
   * @returns the potential elevation groups the obligation qualifies for
   */
  getElevationGroups(kaminoMarket: KaminoMarket): Array<number> {
    const reserves = new PubkeyHashMap<PublicKey, KaminoReserve>();
    for (const deposit of this.state.deposits.values()) {
      if (isNotNullPubkey(deposit.depositReserve) && !reserves.has(deposit.depositReserve)) {
        reserves.set(deposit.depositReserve, kaminoMarket.getReserveByAddress(deposit.depositReserve)!);
      }
    }
    for (const borrow of this.state.borrows.values()) {
      if (isNotNullPubkey(borrow.borrowReserve) && !reserves.has(borrow.borrowReserve)) {
        reserves.set(borrow.borrowReserve, kaminoMarket.getReserveByAddress(borrow.borrowReserve)!);
      }
    }
    return KaminoObligation.getElevationGroupsForReserves([...reserves.values()]);
  }

  static getElevationGroupsForReserves(reserves: Array<KaminoReserve>): Array<number> {
    const elevationGroupsCounts = new Map<number, number>();
    for (const reserve of reserves) {
      for (const elevationGroup of reserve.state.config.elevationGroups) {
        if (elevationGroup !== 0) {
          const count = elevationGroupsCounts.get(elevationGroup);
          if (count) {
            elevationGroupsCounts.set(elevationGroup, count + 1);
          } else {
            elevationGroupsCounts.set(elevationGroup, 1);
          }
        }
      }
    }
    const activeElevationGroups = new Array<number>();
    for (const [group, count] of elevationGroupsCounts.entries()) {
      if (count === reserves.length) {
        activeElevationGroups.push(group);
      }
    }
    return activeElevationGroups;
  }

  calculateSimulatedBorrow(
    oldStats: ObligationStats,
    oldBorrows: Map<PublicKey, Position>,
    borrowAmount: Decimal,
    mint: PublicKey,
    reserves: Map<PublicKey, KaminoReserve>
  ): {
    stats: ObligationStats;
    borrows: Map<PublicKey, Position>;
  } {
    const newStats = { ...oldStats };
    const newBorrows = new PubkeyHashMap<PublicKey, Position>([...oldBorrows.entries()]);
    let borrowPosition: Position | undefined = undefined;
    for (const oldBorrow of oldBorrows.values()) {
      if (oldBorrow.mintAddress.equals(mint)) {
        borrowPosition = { ...oldBorrow };
      }
    }
    let reserve: KaminoReserve | undefined = undefined;
    for (const kaminoReserve of reserves.values()) {
      if (kaminoReserve.getLiquidityMint().equals(mint)) {
        reserve = kaminoReserve;
      }
    }

    if (!reserve) {
      throw new Error(`No reserve found for mint ${mint}`);
    }

    if (!borrowPosition) {
      borrowPosition = {
        reserveAddress: reserve!.address,
        mintAddress: mint,
        amount: new Decimal(0),
        marketValueRefreshed: new Decimal(0),
      };
    }

    if (!reserve.state.config.elevationGroups.includes(this.state.elevationGroup)) {
      throw new Error(
        `User would have to downgrade the elevation group in order to be able to borrow from this reserve`
      );
    }

    const borrowFactor = this.getBorrowFactorForReserve(reserve);

    const borrowValueUSD = borrowAmount.mul(reserve.getOracleMarketPrice()).dividedBy(reserve.getMintFactor());

    const borrowValueBorrowFactorAdjustedUSD = borrowValueUSD.mul(borrowFactor);

    newStats.userTotalBorrow = positiveOrZero(newStats.userTotalBorrow.plus(borrowValueUSD));
    newStats.userTotalBorrowBorrowFactorAdjusted = positiveOrZero(
      newStats.userTotalBorrowBorrowFactorAdjusted.plus(borrowValueBorrowFactorAdjustedUSD)
    );

    borrowPosition.amount = positiveOrZero(borrowPosition.amount.plus(borrowAmount));
    borrowPosition.mintAddress = mint;
    borrowPosition.marketValueRefreshed = positiveOrZero(borrowPosition.marketValueRefreshed.plus(borrowValueUSD));

    newBorrows.set(borrowPosition.reserveAddress, borrowPosition);
    return {
      borrows: newBorrows,
      stats: newStats,
    };
  }

  calculateSimulatedDeposit(
    oldStats: ObligationStats,
    oldDeposits: Map<PublicKey, Position>,
    amount: Decimal,
    mint: PublicKey,
    reserves: Map<PublicKey, KaminoReserve>,
    market: KaminoMarket
  ): {
    stats: ObligationStats;
    deposits: Map<PublicKey, Position>;
  } {
    const newStats = { ...oldStats };
    const newDeposits = new PubkeyHashMap<PublicKey, Position>([...oldDeposits.entries()]);

    let depositPosition: Position | undefined = undefined;
    for (const oldDeposit of oldDeposits.values()) {
      if (oldDeposit.mintAddress.equals(mint)) {
        depositPosition = { ...oldDeposit };
      }
    }
    let reserve: KaminoReserve | undefined = undefined;
    for (const kaminoReserve of reserves.values()) {
      if (kaminoReserve.getLiquidityMint().equals(mint)) {
        reserve = kaminoReserve;
      }
    }
    if (!reserve) {
      throw new Error(`No reserve found for mint ${mint}`);
    }

    if (!depositPosition) {
      depositPosition = {
        reserveAddress: reserve!.address,
        mintAddress: mint,
        amount: new Decimal(0),
        marketValueRefreshed: new Decimal(0),
      };
    }

    if (!reserve.state.config.elevationGroups.includes(this.state.elevationGroup)) {
      throw new Error(
        `User would have to downgrade the elevation group in order to be able to deposit in this reserve`
      );
    }
    const { maxLtv, liquidationLtv } = this.getLtvForReserve(market, reserve);

    const supplyAmount = amount; //.mul(reserve.getCollateralExchangeRate()).floor();
    const supplyAmountMultiplierUSD = supplyAmount
      .mul(reserve.getOracleMarketPrice())
      .dividedBy('1'.concat(Array(reserve.stats.decimals + 1).join('0')));

    newStats.userTotalDeposit = positiveOrZero(newStats.userTotalDeposit.plus(supplyAmountMultiplierUSD));
    newStats.borrowLimit = positiveOrZero(newStats.borrowLimit.plus(supplyAmountMultiplierUSD.mul(maxLtv)));
    newStats.borrowLiquidationLimit = positiveOrZero(
      newStats.borrowLiquidationLimit.plus(supplyAmountMultiplierUSD.mul(liquidationLtv))
    );
    newStats.liquidationLtv = valueOrZero(newStats.borrowLiquidationLimit.div(newStats.userTotalDeposit));

    depositPosition.amount = positiveOrZero(depositPosition.amount.plus(amount));
    depositPosition.mintAddress = mint;
    depositPosition.marketValueRefreshed = positiveOrZero(
      depositPosition.marketValueRefreshed.plus(
        supplyAmount.mul(reserve.getOracleMarketPrice()).dividedBy(reserve.getMintFactor())
      )
    );

    newDeposits.set(depositPosition.reserveAddress, depositPosition);

    return {
      deposits: newDeposits,
      stats: newStats,
    };
  }

  /**
   * Calculate the newly modified stats of the obligation
   */
  // TODO: Elevation group problems
  // TODO: Shall we set up position limits?
  getSimulatedObligationStats(params: {
    amountCollateral?: Decimal;
    amountDebt?: Decimal;
    action: ActionType;
    mintCollateral?: PublicKey;
    mintDebt?: PublicKey;
    market: KaminoMarket;
    reserves: Map<PublicKey, KaminoReserve>;
  }): {
    stats: ObligationStats;
    deposits: Map<PublicKey, Position>;
    borrows: Map<PublicKey, Position>;
  } {
    const { amountCollateral, amountDebt, action, mintCollateral, mintDebt, market, reserves } = params;
    let newStats = { ...this.refreshedStats };
    let newDeposits: Map<PublicKey, Position> = new PubkeyHashMap<PublicKey, Position>([...this.deposits.entries()]);
    let newBorrows: Map<PublicKey, Position> = new PubkeyHashMap<PublicKey, Position>([...this.borrows.entries()]);

    switch (action) {
      case 'deposit': {
        if (amountCollateral === undefined || mintCollateral === undefined) {
          throw Error('amountCollateral & mintCollateral are required for deposit action');
        }
        const { stats, deposits } = this.calculateSimulatedDeposit(
          this.refreshedStats,
          this.deposits,
          amountCollateral,
          mintCollateral,
          reserves,
          market
        );

        newStats = stats;
        newDeposits = deposits;

        break;
      }
      case 'borrow': {
        if (amountDebt === undefined || mintDebt === undefined) {
          throw Error('amountDebt & mintDebt are required for borrow action');
        }
        const { stats, borrows } = this.calculateSimulatedBorrow(
          this.refreshedStats,
          this.borrows,
          amountDebt,
          mintDebt,
          reserves
        );
        newStats = stats;
        newBorrows = borrows;
        break;
      }
      case 'repay': {
        if (amountDebt === undefined || mintDebt === undefined) {
          throw Error('amountDebt & mintDebt are required for repay action');
        }
        const { stats, borrows } = this.calculateSimulatedBorrow(
          this.refreshedStats,
          this.borrows,
          new Decimal(amountDebt).neg(),
          mintDebt,
          reserves
        );
        newStats = stats;
        newBorrows = borrows;
        break;
      }

      case 'withdraw': {
        if (amountCollateral === undefined || mintCollateral === undefined) {
          throw Error('amountCollateral & mintCollateral are required for withdraw action');
        }
        const { stats, deposits } = this.calculateSimulatedDeposit(
          this.refreshedStats,
          this.deposits,
          new Decimal(amountCollateral).neg(),
          mintCollateral,
          reserves,
          market
        );
        newStats = stats;
        newDeposits = deposits;
        break;
      }
      case 'depositAndBorrow': {
        if (
          amountCollateral === undefined ||
          amountDebt === undefined ||
          mintCollateral === undefined ||
          mintDebt === undefined
        ) {
          throw Error('amountColl & amountDebt & mintCollateral & mintDebt are required for depositAndBorrow action');
        }
        const { stats: statsAfterDeposit, deposits } = this.calculateSimulatedDeposit(
          this.refreshedStats,
          this.deposits,
          amountCollateral,
          mintCollateral,
          reserves,
          market
        );
        const { stats, borrows } = this.calculateSimulatedBorrow(
          statsAfterDeposit,
          this.borrows,
          amountDebt,
          mintDebt,
          reserves
        );

        newStats = stats;
        newDeposits = deposits;
        newBorrows = borrows;
        break;
      }
      case 'repayAndWithdraw': {
        if (
          amountCollateral === undefined ||
          amountDebt === undefined ||
          mintCollateral === undefined ||
          mintDebt === undefined
        ) {
          throw Error('amountColl & amountDebt & mintCollateral & mintDebt are required for repayAndWithdraw action');
        }
        const { stats: statsAfterRepay, borrows } = this.calculateSimulatedBorrow(
          this.refreshedStats,
          this.borrows,
          new Decimal(amountDebt).neg(),
          mintDebt,
          reserves
        );
        const { stats: statsAfterWithdraw, deposits } = this.calculateSimulatedDeposit(
          statsAfterRepay,
          this.deposits,
          new Decimal(amountCollateral).neg(),
          mintCollateral,
          reserves,
          market
        );
        newStats = statsAfterWithdraw;
        newDeposits = deposits;
        newBorrows = borrows;
        break;
      }
      default: {
        throw Error(`Invalid action type ${action} for getSimulatedObligationStats`);
      }
    }
    newStats.netAccountValue = newStats.userTotalDeposit.minus(newStats.userTotalBorrow);
    newStats.loanToValue = valueOrZero(
      newStats.userTotalBorrowBorrowFactorAdjusted.dividedBy(newStats.userTotalDeposit)
    );
    newStats.leverage = valueOrZero(newStats.userTotalDeposit.dividedBy(newStats.netAccountValue));

    return {
      stats: newStats,
      deposits: newDeposits,
      borrows: newBorrows,
    };
  }

  estimateObligationInterestRate = (
    market: KaminoMarket,
    reserve: KaminoReserve,
    borrow: ObligationLiquidity,
    currentSlot: number
  ): Decimal => {
    const estimatedCumulativeBorrowRate = reserve.getEstimatedCumulativeBorrowRate(
      currentSlot,
      market.state.referralFeeBps
    );

    const currentCumulativeBorrowRate = KaminoObligation.getCumulativeBorrowRate(borrow);

    if (estimatedCumulativeBorrowRate.gt(currentCumulativeBorrowRate)) {
      return estimatedCumulativeBorrowRate.div(currentCumulativeBorrowRate);
    }

    return new Decimal(0);
  };

  private calculateDeposits(
    market: KaminoMarket,
    obligation: Obligation,
    collateralExchangeRates: Map<PublicKey, Decimal>,
    getPx: (reserve: KaminoReserve) => Decimal
  ): {
    deposits: Map<PublicKey, Position>;
    userTotalDeposit: Decimal;
    borrowLimit: Decimal;
    liquidationLtv: Decimal;
    borrowLiquidationLimit: Decimal;
  } {
    return KaminoObligation.calculateObligationDeposits(
      market,
      obligation,
      collateralExchangeRates,
      obligation.elevationGroup,
      getPx
    );
  }

  private calculateBorrows(
    market: KaminoMarket,
    obligation: Obligation,
    cumulativeBorrowRates: Map<PublicKey, Decimal>,
    getPx: (reserve: KaminoReserve) => Decimal
  ): BorrowStats {
    return KaminoObligation.calculateObligationBorrows(
      market,
      obligation,
      cumulativeBorrowRates,
      obligation.elevationGroup,
      getPx
    );
  }

  private calculatePositions(
    market: KaminoMarket,
    obligation: Obligation,
    collateralExchangeRates: Map<PublicKey, Decimal>,
    cumulativeBorrowRates: Map<PublicKey, Decimal>
  ): {
    borrows: Map<PublicKey, Position>;
    deposits: Map<PublicKey, Position>;
    refreshedStats: ObligationStats;
  } {
    const getOraclePx = (reserve: KaminoReserve) => reserve.getOracleMarketPrice();
    const depositStatsOraclePrice = this.calculateDeposits(market, obligation, collateralExchangeRates, getOraclePx);
    const borrowStatsOraclePrice = this.calculateBorrows(market, obligation, cumulativeBorrowRates, getOraclePx);

    const netAccountValueScopeRefreshed = depositStatsOraclePrice.userTotalDeposit.minus(
      borrowStatsOraclePrice.userTotalBorrow
    );

    const potentialElevationGroupUpdate = 0;

    return {
      deposits: depositStatsOraclePrice.deposits,
      borrows: borrowStatsOraclePrice.borrows,
      refreshedStats: {
        borrowLimit: depositStatsOraclePrice.borrowLimit,
        borrowLiquidationLimit: depositStatsOraclePrice.borrowLiquidationLimit,
        userTotalBorrow: borrowStatsOraclePrice.userTotalBorrow,
        userTotalBorrowBorrowFactorAdjusted: borrowStatsOraclePrice.userTotalBorrowBorrowFactorAdjusted,
        userTotalDeposit: depositStatsOraclePrice.userTotalDeposit,
        liquidationLtv: depositStatsOraclePrice.liquidationLtv,
        borrowUtilization: borrowStatsOraclePrice.userTotalBorrowBorrowFactorAdjusted.dividedBy(
          depositStatsOraclePrice.borrowLimit
        ),
        netAccountValue: netAccountValueScopeRefreshed,
        leverage: depositStatsOraclePrice.userTotalDeposit.dividedBy(netAccountValueScopeRefreshed),
        loanToValue: borrowStatsOraclePrice.userTotalBorrowBorrowFactorAdjusted.dividedBy(
          depositStatsOraclePrice.userTotalDeposit
        ),
        potentialElevationGroupUpdate,
      },
    };
  }

  public static calculateObligationDeposits(
    market: KaminoMarket,
    obligation: Obligation,
    collateralExchangeRates: Map<PublicKey, Decimal> | null,
    elevationGroup: number,
    getPx: (reserve: KaminoReserve) => Decimal
  ): {
    deposits: Map<PublicKey, Position>;
    userTotalDeposit: Decimal;
    userTotalCollateralDeposit: Decimal;
    borrowLimit: Decimal;
    liquidationLtv: Decimal;
    borrowLiquidationLimit: Decimal;
  } {
    let userTotalDeposit = new Decimal(0);
    let userTotalCollateralDeposit = new Decimal(0);
    let borrowLimit = new Decimal(0);
    let borrowLiquidationLimit = new Decimal(0);

    const deposits = new PubkeyHashMap<PublicKey, Position>();
    for (let i = 0; i < obligation.deposits.length; i++) {
      if (!isNotNullPubkey(obligation.deposits[i].depositReserve)) {
        continue;
      }
      const deposit = obligation.deposits[i];
      const reserve = market.getReserveByAddress(deposit.depositReserve);
      if (!reserve) {
        throw new Error(
          `Obligation contains a deposit belonging to reserve: ${deposit.depositReserve} but the reserve was not found on the market. Deposit amount: ${deposit.depositedAmount}`
        );
      }
      const { maxLtv, liquidationLtv } = KaminoObligation.getLtvForReserve(market, reserve, elevationGroup);

      let exchangeRate: Decimal;
      if (collateralExchangeRates !== null) {
        exchangeRate = collateralExchangeRates.get(reserve.address)!;
      } else {
        exchangeRate = reserve.getCollateralExchangeRate();
      }
      const supplyAmount = new Decimal(deposit.depositedAmount.toString()).div(exchangeRate);

      const depositValueUsd = supplyAmount.mul(getPx(reserve)).div(reserve.getMintFactor());

      userTotalDeposit = userTotalDeposit.add(depositValueUsd);

      if (!maxLtv.eq('0')) {
        userTotalCollateralDeposit = userTotalCollateralDeposit.add(depositValueUsd);
      }

      borrowLimit = borrowLimit.add(depositValueUsd.mul(maxLtv));
      borrowLiquidationLimit = borrowLiquidationLimit.add(depositValueUsd.mul(liquidationLtv));

      const position: Position = {
        reserveAddress: reserve.address,
        mintAddress: reserve.getLiquidityMint(),
        amount: supplyAmount,
        marketValueRefreshed: depositValueUsd,
      };
      deposits.set(reserve.address, position);
    }

    return {
      deposits,
      userTotalDeposit,
      userTotalCollateralDeposit,
      borrowLimit,
      liquidationLtv: valueOrZero(borrowLiquidationLimit.div(userTotalDeposit)),
      borrowLiquidationLimit,
    };
  }

  public static calculateObligationBorrows(
    market: KaminoMarket,
    obligation: Obligation,
    cumulativeBorrowRates: Map<PublicKey, Decimal> | null,
    elevationGroup: number,
    getPx: (reserve: KaminoReserve) => Decimal
  ): BorrowStats {
    let userTotalBorrow = new Decimal(0);
    let userTotalBorrowBorrowFactorAdjusted = new Decimal(0);
    let positions = 0;

    const borrows = new PubkeyHashMap<PublicKey, Position>();
    for (let i = 0; i < obligation.borrows.length; i++) {
      if (!isNotNullPubkey(obligation.borrows[i].borrowReserve)) {
        continue;
      }
      const borrow = obligation.borrows[i];
      const reserve = market.getReserveByAddress(borrow.borrowReserve);
      if (!reserve) {
        throw new Error(
          `Obligation contains a borrow belonging to reserve: ${
            borrow.borrowReserve
          } but the reserve was not found on the market. Borrow amount: ${KaminoObligation.getBorrowAmount(borrow)}`
        );
      }

      const obligationCumulativeBorrowRate = KaminoObligation.getCumulativeBorrowRate(borrow);
      let cumulativeBorrowRate;
      if (cumulativeBorrowRates !== null) {
        cumulativeBorrowRate = cumulativeBorrowRates.get(reserve.address)!;
      } else {
        cumulativeBorrowRate = reserve.getCumulativeBorrowRate();
      }

      const borrowAmount = KaminoObligation.getBorrowAmount(borrow)
        .mul(cumulativeBorrowRate)
        .dividedBy(obligationCumulativeBorrowRate);

      const borrowValueUsd = borrowAmount.mul(getPx(reserve)).dividedBy(reserve.getMintFactor());

      const borrowFactor = KaminoObligation.getBorrowFactorForReserve(reserve, elevationGroup);
      const borrowValueBorrowFactorAdjustedUsd = borrowValueUsd.mul(borrowFactor);

      if (!borrowAmount.eq(new Decimal('0'))) {
        positions += 1;
      }

      userTotalBorrow = userTotalBorrow.plus(borrowValueUsd);
      userTotalBorrowBorrowFactorAdjusted = userTotalBorrowBorrowFactorAdjusted.plus(
        borrowValueBorrowFactorAdjustedUsd
      );

      const position: Position = {
        reserveAddress: reserve.address,
        mintAddress: reserve.getLiquidityMint(),
        amount: borrowAmount,
        marketValueRefreshed: borrowValueUsd,
      };
      borrows.set(reserve.address, position);
    }

    return {
      borrows,
      userTotalBorrow,
      userTotalBorrowBorrowFactorAdjusted,
      positions,
    };
  }

  getMaxLoanLtvGivenElevationGroup(market: KaminoMarket, elevationGroup: number, slot: number): Decimal {
    const getOraclePx = (reserve: KaminoReserve) => reserve.getOracleMarketPrice();
    const { collateralExchangeRates } = KaminoObligation.getRatesForObligation(market, this.state, slot);

    const { borrowLimit, userTotalDeposit } = KaminoObligation.calculateObligationDeposits(
      market,
      this.state,
      collateralExchangeRates,
      elevationGroup,
      getOraclePx
    );

    if (borrowLimit.eq(0) || userTotalDeposit.eq(0)) {
      return new Decimal(0);
    }

    return borrowLimit.div(userTotalDeposit);
  }

  /* 
    How much of a given token can a user borrow extra given an elevation group, 
    regardless of caps and liquidity or assuming infinite liquidity and infinite caps,
    until it hits max LTV.

    This is purely a function about the borrow power of an obligation, 
    not a reserve-specific, caps-specific, liquidity-specific function.

    * @param market - The KaminoMarket instance.
    * @param liquidityMint - The liquidity mint PublicKey.
    * @param slot - The slot number.
    * @param elevationGroup - The elevation group number (default: this.state.elevationGroup).
    * @returns The borrow power as a Decimal.
    * @throws Error if the reserve is not found.
  */
  getBorrowPower(
    market: KaminoMarket,
    liquidityMint: PublicKey,
    slot: number,
    elevationGroup: number = this.state.elevationGroup
  ): Decimal {
    const reserve = market.getReserveByMint(liquidityMint);
    if (!reserve) {
      throw new Error('Reserve not found');
    }

    const elevationGroupActivated =
      reserve.state.config.elevationGroups.includes(elevationGroup) && elevationGroup !== 0;

    const borrowFactor = KaminoObligation.getBorrowFactorForReserve(reserve, elevationGroup);

    const getOraclePx = (reserve: KaminoReserve) => reserve.getOracleMarketPrice();
    const { collateralExchangeRates, cumulativeBorrowRates } = KaminoObligation.getRatesForObligation(
      market,
      this.state,
      slot
    );

    const { borrowLimit } = KaminoObligation.calculateObligationDeposits(
      market,
      this.state,
      collateralExchangeRates,
      elevationGroup,
      getOraclePx
    );

    const { userTotalBorrowBorrowFactorAdjusted } = KaminoObligation.calculateObligationBorrows(
      market,
      this.state,
      cumulativeBorrowRates,
      elevationGroup,
      getOraclePx
    );

    const maxObligationBorrowPower = borrowLimit // adjusted available amount
      .minus(userTotalBorrowBorrowFactorAdjusted)
      .div(borrowFactor)
      .div(reserve.getOracleMarketPrice())
      .mul(reserve.getMintFactor());

    // If it has any collateral outside emode, then return 0
    for (const [_, value] of this.deposits.entries()) {
      const depositReserve = market.getReserveByAddress(value.reserveAddress);
      if (!depositReserve) {
        throw new Error('Reserve not found');
      }
      if (depositReserve.state.config.disableUsageAsCollOutsideEmode && !elevationGroupActivated) {
        return new Decimal(0);
      }
    }

    // This is not amazing because it assumes max borrow, which is not true
    let originationFeeRate = reserve.getBorrowFee();

    // Inclusive fee rate
    originationFeeRate = originationFeeRate.div(originationFeeRate.add(new Decimal(1)));
    const borrowFee = maxObligationBorrowPower.mul(originationFeeRate);

    const maxBorrowAmount = maxObligationBorrowPower.sub(borrowFee);

    return Decimal.max(new Decimal(0), maxBorrowAmount);
  }

  /* 
    How much of a given token can a user borrow extra given an elevation group,
    and a specific reserve, until it hits max LTV and given available liquidity and caps.

    * @param market - The KaminoMarket instance.
    * @param liquidityMint - The liquidity mint PublicKey.
    * @param slot - The slot number.
    * @param elevationGroup - The elevation group number (default: this.state.elevationGroup).
    * @returns The maximum borrow amount as a Decimal.
    * @throws Error if the reserve is not found.
  */
  getMaxBorrowAmountV2(
    market: KaminoMarket,
    liquidityMint: PublicKey,
    slot: number,
    elevationGroup: number = this.state.elevationGroup
  ): Decimal {
    const reserve = market.getReserveByMint(liquidityMint);
    if (!reserve) {
      throw new Error('Reserve not found');
    }

    const liquidityAvailable = reserve.getLiquidityAvailableForDebtReserveGivenCaps(market, [elevationGroup])[0];
    const maxBorrowAmount = this.getBorrowPower(market, liquidityMint, slot, elevationGroup);

    if (elevationGroup === this.state.elevationGroup) {
      return Decimal.min(maxBorrowAmount, liquidityAvailable);
    } else {
      const { amount: debtThisReserve } = this.borrows.get(reserve.address) || { amount: new Decimal(0) };
      const liquidityAvailablePostMigration = Decimal.max(0, liquidityAvailable.minus(debtThisReserve));
      return Decimal.min(maxBorrowAmount, liquidityAvailablePostMigration);
    }
  }

  /* 
    Returns true if the loan is eligible for the elevation group, including for the default one.
    * @param market - The KaminoMarket object representing the market.
    * @param slot - The slot number of the loan.
    * @param elevationGroup - The elevation group number.
    * @returns A boolean indicating whether the loan is eligible for elevation.
  */
  isLoanEligibleForElevationGroup(market: KaminoMarket, slot: number, elevationGroup: number): boolean {
    // - isLoanEligibleForEmode(obligation, emode: 0 | number): <boolean, ErrorMessage>
    //    - essentially checks if a loan can be migrated or not
    //    - [x] due to collateral / debt reserves combination
    //    - [x] due to LTV, etc

    const reserveDeposits: string[] = Array.from(this.deposits.keys()).map((x) => x.toString());
    const reserveBorrows: string[] = Array.from(this.borrows.keys()).map((x) => x.toString());

    if (reserveBorrows.length > 1) {
      return false;
    }

    if (elevationGroup > 0) {
      // Elevation group 0 doesn't need to do reserve checks, as all are included by default
      const allElevationGroups = market.getMarketElevationGroupDescriptions();
      const elevationGroupDescription = allElevationGroups[elevationGroup - 1];

      // Has to be a subset
      const allCollsIncluded = reserveDeposits.every((reserve) =>
        elevationGroupDescription.collateralReserves.includes(reserve)
      );
      const allDebtsIncluded =
        reserveBorrows.length === 0 ||
        (reserveBorrows.length === 1 && elevationGroupDescription.debtReserve === reserveBorrows[0]);

      if (!allCollsIncluded || !allDebtsIncluded) {
        return false;
      }
    }

    // Check if the loan can be migrated based on LTV
    const getOraclePx = (reserve: KaminoReserve) => reserve.getOracleMarketPrice();
    const { collateralExchangeRates } = KaminoObligation.getRatesForObligation(market, this.state, slot);

    const { borrowLimit } = KaminoObligation.calculateObligationDeposits(
      market,
      this.state,
      collateralExchangeRates,
      elevationGroup,
      getOraclePx
    );

    const isEligibleBasedOnLtv = this.refreshedStats.userTotalBorrowBorrowFactorAdjusted.lte(borrowLimit);

    return isEligibleBasedOnLtv;
  }

  /* 
    Returns all elevation groups for a given obligation, except the default one
    * @param market - The KaminoMarket instance.
    * @returns An array of ElevationGroupDescription objects representing the elevation groups for the obligation.
  */
  getElevationGroupsForObligation(market: KaminoMarket): ElevationGroupDescription[] {
    if (this.borrows.size > 1) {
      return [];
    }

    const collReserves = Array.from(this.deposits.keys());
    if (this.borrows.size === 0) {
      return market.getElevationGroupsForReservesCombination(collReserves);
    } else {
      const debtReserve = Array.from(this.borrows.keys())[0];
      return market.getElevationGroupsForReservesCombination(collReserves, debtReserve);
    }
  }

  /* Deprecated function, also broken */
  getMaxBorrowAmount(
    market: KaminoMarket,
    liquidityMint: PublicKey,
    slot: number,
    requestElevationGroup: boolean
  ): Decimal {
    const reserve = market.getReserveByMint(liquidityMint);

    if (!reserve) {
      throw new Error('Reserve not found');
    }

    const groups = market.state.elevationGroups;
    const emodeGroupsDebtReserve = reserve.state.config.elevationGroups;
    let commonElevationGroups = [...emodeGroupsDebtReserve].filter(
      (item) => item !== 0 && groups[item - 1].debtReserve.equals(reserve.address)
    );

    for (const [_, value] of this.deposits.entries()) {
      const depositReserve = market.getReserveByAddress(value.reserveAddress);

      if (!depositReserve) {
        throw new Error('Reserve not found');
      }

      const depositReserveEmodeGroups = depositReserve.state.config.elevationGroups;

      commonElevationGroups = commonElevationGroups.filter((item) => depositReserveEmodeGroups.includes(item));
    }

    let elevationGroup = this.state.elevationGroup;
    if (commonElevationGroups.length != 0) {
      const eModeGroupWithMaxLtvAndDebtReserve = commonElevationGroups.reduce((prev, curr) => {
        const prevGroup = groups.find((group) => group.id === prev);
        const currGroup = groups.find((group) => group.id === curr);
        return prevGroup!.ltvPct > currGroup!.ltvPct ? prev : curr;
      });

      if (requestElevationGroup) {
        elevationGroup = eModeGroupWithMaxLtvAndDebtReserve;
      }
    }

    const elevationGroupActivated =
      reserve.state.config.elevationGroups.includes(elevationGroup) && elevationGroup !== 0;

    const borrowFactor = this.getBorrowFactorForReserve(reserve);

    const maxObligationBorrowPower = this.refreshedStats.borrowLimit // adjusted available amount
      .minus(this.refreshedStats.userTotalBorrowBorrowFactorAdjusted)
      .div(borrowFactor)
      .div(reserve.getOracleMarketPrice())
      .mul(reserve.getMintFactor());
    const reserveAvailableAmount = reserve.getLiquidityAvailableAmount();
    let reserveBorrowCapRemained = reserve.stats.reserveBorrowLimit.sub(reserve.getBorrowedAmount());

    this.deposits.forEach((deposit) => {
      const depositReserve = market.getReserveByAddress(deposit.reserveAddress);
      if (!depositReserve) {
        throw new Error('Reserve not found');
      }
      if (depositReserve.state.config.disableUsageAsCollOutsideEmode && !elevationGroupActivated) {
        reserveBorrowCapRemained = new Decimal(0);
      }
    });

    let maxBorrowAmount = Decimal.min(maxObligationBorrowPower, reserveAvailableAmount, reserveBorrowCapRemained);

    const debtWithdrawalCap = reserve.getDebtWithdrawalCapCapacity().sub(reserve.getDebtWithdrawalCapCurrent(slot));
    maxBorrowAmount = reserve.getDebtWithdrawalCapCapacity().gt(0)
      ? Decimal.min(maxBorrowAmount, debtWithdrawalCap)
      : maxBorrowAmount;

    let originationFeeRate = reserve.getBorrowFee();

    // Inclusive fee rate
    originationFeeRate = originationFeeRate.div(originationFeeRate.add(new Decimal(1)));
    const borrowFee = maxBorrowAmount.mul(originationFeeRate);

    maxBorrowAmount = maxBorrowAmount.sub(borrowFee);

    const utilizationRatioLimit = reserve.state.config.utilizationLimitBlockBorrowingAbove / 100;
    const currentUtilizationRatio = reserve.calculateUtilizationRatio();

    if (utilizationRatioLimit > 0 && currentUtilizationRatio > utilizationRatioLimit) {
      return new Decimal(0);
    } else if (utilizationRatioLimit > 0 && currentUtilizationRatio < utilizationRatioLimit) {
      const maxBorrowBasedOnUtilization = new Decimal(utilizationRatioLimit - currentUtilizationRatio).mul(
        reserve.getTotalSupply()
      );
      maxBorrowAmount = Decimal.min(maxBorrowAmount, maxBorrowBasedOnUtilization);
    }

    let borrowLimitDependentOnElevationGroup = new Decimal(U64_MAX);

    if (!elevationGroupActivated) {
      borrowLimitDependentOnElevationGroup = reserve
        .getBorrowLimitOutsideElevationGroup()
        .sub(reserve.getBorrowedAmountOutsideElevationGroup());
    } else {
      let maxDebtTakenAgainstCollaterals = new Decimal(U64_MAX);
      for (const [_, value] of this.deposits.entries()) {
        const depositReserve = market.getReserveByAddress(value.reserveAddress);

        if (!depositReserve) {
          throw new Error('Reserve not found');
        }

        const maxDebtAllowedAgainstCollateral = depositReserve
          .getBorrowLimitAgainstCollateralInElevationGroup(elevationGroup - 1)
          .sub(depositReserve.getBorrowedAmountAgainstCollateralInElevationGroup(elevationGroup - 1));

        maxDebtTakenAgainstCollaterals = Decimal.max(
          new Decimal(0),
          Decimal.min(maxDebtAllowedAgainstCollateral, maxDebtTakenAgainstCollaterals)
        );
      }
      borrowLimitDependentOnElevationGroup = maxDebtTakenAgainstCollaterals;
    }

    maxBorrowAmount = Decimal.min(maxBorrowAmount, borrowLimitDependentOnElevationGroup);

    return Decimal.max(new Decimal(0), maxBorrowAmount);
  }

  getMaxWithdrawAmount(market: KaminoMarket, tokenMint: PublicKey, slot: number): Decimal {
    const depositReserve = market.getReserveByMint(tokenMint);

    if (!depositReserve) {
      throw new Error('Reserve not found');
    }

    const userDepositPosition = this.getDepositByReserve(depositReserve.address);

    if (!userDepositPosition) {
      throw new Error('Deposit reserve not found');
    }

    const userDepositPositionAmount = userDepositPosition.amount;

    if (this.refreshedStats.userTotalBorrowBorrowFactorAdjusted.equals(new Decimal(0))) {
      return new Decimal(userDepositPositionAmount);
    }

    const { maxLtv: reserveMaxLtv } = this.getLtvForReserve(market, depositReserve);
    // bf adjusted debt value > allowed_borrow_value
    if (this.refreshedStats.userTotalBorrowBorrowFactorAdjusted.gte(this.refreshedStats.borrowLimit)) {
      return new Decimal(0);
    }

    let maxWithdrawValue: Decimal;
    if (reserveMaxLtv.eq(0)) {
      maxWithdrawValue = userDepositPositionAmount;
    } else {
      // borrowLimit / userTotalDeposit = maxLtv
      // maxWithdrawValue = userTotalDeposit - userTotalBorrow / maxLtv
      maxWithdrawValue = this.refreshedStats.borrowLimit
        .sub(this.refreshedStats.userTotalBorrowBorrowFactorAdjusted)
        .div(reserveMaxLtv)
        .mul(0.999); // remove 0.1% to prevent going over max ltv
    }

    const maxWithdrawAmount = maxWithdrawValue
      .div(depositReserve.getOracleMarketPrice())
      .mul(depositReserve.getMintFactor());
    const reserveAvailableLiquidity = depositReserve.getLiquidityAvailableAmount();

    const withdrawalCapRemained = depositReserve
      .getDepositWithdrawalCapCapacity()
      .sub(depositReserve.getDepositWithdrawalCapCurrent(slot));
    return Decimal.max(
      0,
      Decimal.min(userDepositPositionAmount, maxWithdrawAmount, reserveAvailableLiquidity, withdrawalCapRemained)
    );
  }

  /**
   *
   * @returns Total borrowed amount for the specified obligation liquidity/borrow asset
   */
  static getBorrowAmount(borrow: ObligationLiquidity): Decimal {
    return new Fraction(borrow.borrowedAmountSf).toDecimal();
  }

  /**
   *
   * @returns Cumulative borrow rate for the specified obligation liquidity/borrow asset
   */
  static getCumulativeBorrowRate(borrow: ObligationLiquidity): Decimal {
    let accSf = new BN(0);
    for (const value of borrow.cumulativeBorrowRateBsf.value.reverse()) {
      accSf = accSf.add(value);
      accSf.shrn(64);
    }
    return new Fraction(accSf).toDecimal();
  }

  public static getRatesForObligation(
    kaminoMarket: KaminoMarket,
    obligation: Obligation,
    slot: number
  ): {
    collateralExchangeRates: Map<PublicKey, Decimal>;
    cumulativeBorrowRates: Map<PublicKey, Decimal>;
  } {
    const collateralExchangeRates = KaminoObligation.getCollateralExchangeRatesForObligation(
      kaminoMarket,
      obligation,
      slot
    );
    const cumulativeBorrowRates = KaminoObligation.getCumulativeBorrowRatesForObligation(
      kaminoMarket,
      obligation,
      slot
    );

    return {
      collateralExchangeRates,
      cumulativeBorrowRates,
    };
  }

  public static addRatesForObligation(
    kaminoMarket: KaminoMarket,
    obligation: Obligation,
    collateralExchangeRates: Map<PublicKey, Decimal>,
    cumulativeBorrowRates: Map<PublicKey, Decimal>,
    slot: number
  ): void {
    KaminoObligation.addCollateralExchangeRatesForObligation(kaminoMarket, collateralExchangeRates, obligation, slot);
    KaminoObligation.addCumulativeBorrowRatesForObligation(kaminoMarket, cumulativeBorrowRates, obligation, slot);
  }

  static getCollateralExchangeRatesForObligation(
    kaminoMarket: KaminoMarket,
    obligation: Obligation,
    slot: number
  ): Map<PublicKey, Decimal> {
    const collateralExchangeRates = new PubkeyHashMap<PublicKey, Decimal>();
    for (let i = 0; i < obligation.deposits.length; i++) {
      const deposit = obligation.deposits[i];
      if (isNotNullPubkey(deposit.depositReserve) && !collateralExchangeRates.has(deposit.depositReserve)) {
        const reserve = kaminoMarket.getReserveByAddress(deposit.depositReserve)!;
        const collateralExchangeRate = reserve.getEstimatedCollateralExchangeRate(
          slot,
          kaminoMarket.state.referralFeeBps
        );
        collateralExchangeRates.set(reserve.address, collateralExchangeRate);
      }
    }
    return collateralExchangeRates;
  }

  static addCollateralExchangeRatesForObligation(
    kaminoMarket: KaminoMarket,
    collateralExchangeRates: Map<PublicKey, Decimal>,
    obligation: Obligation,
    slot: number
  ) {
    for (let i = 0; i < obligation.deposits.length; i++) {
      const deposit = obligation.deposits[i];
      if (isNotNullPubkey(deposit.depositReserve) && !collateralExchangeRates.has(deposit.depositReserve)) {
        const reserve = kaminoMarket.getReserveByAddress(deposit.depositReserve)!;
        const collateralExchangeRate = reserve.getEstimatedCollateralExchangeRate(
          slot,
          kaminoMarket.state.referralFeeBps
        );
        collateralExchangeRates.set(reserve.address, collateralExchangeRate);
      }
    }
  }

  static getCumulativeBorrowRatesForObligation(kaminoMarket: KaminoMarket, obligation: Obligation, slot: number) {
    const cumulativeBorrowRates = new PubkeyHashMap<PublicKey, Decimal>();
    for (let i = 0; i < obligation.borrows.length; i++) {
      const borrow = obligation.borrows[i];
      if (isNotNullPubkey(borrow.borrowReserve) && !cumulativeBorrowRates.has(borrow.borrowReserve)) {
        const reserve = kaminoMarket.getReserveByAddress(borrow.borrowReserve)!;
        const cumulativeBorrowRate = reserve.getEstimatedCumulativeBorrowRate(slot, kaminoMarket.state.referralFeeBps);
        cumulativeBorrowRates.set(reserve.address, cumulativeBorrowRate);
      }
    }
    return cumulativeBorrowRates;
  }

  static addCumulativeBorrowRatesForObligation(
    kaminoMarket: KaminoMarket,
    cumulativeBorrowRates: Map<PublicKey, Decimal>,
    obligation: Obligation,
    slot: number
  ) {
    for (let i = 0; i < obligation.borrows.length; i++) {
      const borrow = obligation.borrows[i];
      if (isNotNullPubkey(borrow.borrowReserve) && !cumulativeBorrowRates.has(borrow.borrowReserve)) {
        const reserve = kaminoMarket.getReserveByAddress(borrow.borrowReserve)!;
        const cumulativeBorrowRate = reserve.getEstimatedCumulativeBorrowRate(slot, kaminoMarket.state.referralFeeBps);
        cumulativeBorrowRates.set(reserve.address, cumulativeBorrowRate);
      }
    }
  }

  /**
   * Get the borrow factor for a borrow reserve, accounting for the obligation elevation group if it is active
   * @param reserve
   * @param elevationGroup
   */
  public static getBorrowFactorForReserve(reserve: KaminoReserve, elevationGroup: number): Decimal {
    const elevationGroupActivated =
      reserve.state.config.elevationGroups.includes(elevationGroup) && elevationGroup !== 0;
    if (elevationGroupActivated) {
      return new Decimal('1');
    }
    return new Decimal(reserve.stats.borrowFactor).div('100');
  }

  /**
   * Get the loan to value and liquidation loan to value for a collateral reserve as ratios, accounting for the obligation elevation group if it is active
   * @param market
   * @param reserve
   * @param elevationGroup
   */
  public static getLtvForReserve(
    market: KaminoMarket,
    reserve: KaminoReserve,
    elevationGroup: number
  ): { maxLtv: Decimal; liquidationLtv: Decimal } {
    const elevationGroupActivated =
      elevationGroup !== 0 && reserve.state.config.elevationGroups.includes(elevationGroup);
    if (elevationGroupActivated) {
      const { ltvPct, liquidationThresholdPct } = market.getElevationGroup(elevationGroup);
      return {
        maxLtv: new Decimal(ltvPct).div('100'),
        liquidationLtv: new Decimal(liquidationThresholdPct).div('100'),
      };
    } else {
      const { loanToValue, liquidationThreshold } = reserve.stats;
      return {
        maxLtv: new Decimal(loanToValue),
        liquidationLtv: new Decimal(liquidationThreshold),
      };
    }
  }
}
