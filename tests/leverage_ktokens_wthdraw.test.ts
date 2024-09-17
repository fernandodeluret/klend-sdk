import { Keypair, PublicKey } from '@solana/web3.js';
import { MultiplyObligation, sleep, toJson } from '../src';
import {
  WSOL_MINT,
  depositLeverageTestAdapter,
  getPriceMock,
  withdrawLeverageTestAdapter,
} from './runner/leverage_utils';
import { setupStrategyAndMarketWithInitialLiquidity, newUser, balance } from './runner/setup_utils';
import Decimal from 'decimal.js';
import { assert } from 'chai';
import { assertFuzzyEq } from './runner/assert';
import { reloadReservesAndRefreshMarket } from './runner/setup_operations';

describe('Leverage kTokens withdrawal tests', function () {
  it('deposit_and_withdraw_first_time_with_leverage_non_sol_token_deposit_coll_debt_spl', async function () {
    const [collToken, debtToken, otherTokenSymbol] = ['kMSOL-USDC (Orca)', 'USDC', 'MSOL'];
    const [depositToken, withdrawToken] = [collToken, collToken];
    const debtTokenMintKey = Keypair.generate();
    const otherTokenMintKey = generateKeypairLt(debtTokenMintKey.publicKey);
    const slippagePct = 0.01;

    console.log('Setting up market and strategy ===');
    const { env, kaminoMarket, kamino } = await setupStrategyAndMarketWithInitialLiquidity({
      reserves: [
        [otherTokenSymbol, '0'],
        [debtToken, '10000'],
        [collToken, '100000'],
      ],
      mintOverrides: {
        [otherTokenSymbol]: otherTokenMintKey,
        [debtToken]: debtTokenMintKey,
      },
    });

    await reloadReservesAndRefreshMarket(env, kaminoMarket);

    console.log('Creating user ===');
    const borrower = await newUser(
      env,
      kaminoMarket,
      [
        [collToken, new Decimal(50000)],
        [debtToken, new Decimal(20)],
      ],
      kamino
    );

    console.log('Depositing with leverage ===', depositToken);
    await depositLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      depositToken,
      collToken,
      debtToken,
      new Decimal(50000),
      new Decimal(3),
      slippagePct,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
    const [leverage, ltv, netValue] = [
      obligation.refreshedStats.leverage,
      obligation.loanToValue(),
      obligation.refreshedStats.netAccountValue,
    ];

    console.log('First time: leverage: ', leverage);
    console.log('First time: ltv: ', ltv.toNumber());
    console.log('First time: netValue: ', netValue);

    assertFuzzyEq(leverage, 3, 0.001);

    await sleep(2000);

    console.log('Withdrawing with leverage ===', withdrawToken);
    await withdrawLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      withdrawToken,
      collToken,
      debtToken,
      new Decimal(10000),
      slippagePct,
      new Decimal(obligation.getDeposits()[0].amount),
      new Decimal(obligation.getBorrows()[0].amount),
      false,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    {
      const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
      const [leverage, ltv, netValue] = [
        obligation.refreshedStats.leverage,
        obligation.loanToValue(),
        obligation.refreshedStats.netAccountValue,
      ];
      console.log('Second time leverage: ', leverage);
      console.log('Second time ltv: ', ltv.toNumber());
      console.log('First time: netValue: ', netValue);
      assertFuzzyEq(leverage, 3, 0.001);
    }
  });

  it('deposit_and_withdraw_first_time_with_leverage_sol_ktoken_deposit_coll_debt_spl', async function () {
    const [collToken, debtToken, otherTokenSymbol] = ['kSOL-USDC (Orca)', 'USDC', 'SOL'];
    const [depositToken, withdrawToken] = [collToken, collToken];
    const debtTokenMintKey = generateKeypairGt(WSOL_MINT);
    const slippagePct = 0.01;
    const depositAmount = new Decimal(50000);
    const targetLeverage = new Decimal(3);
    const withdrawAmount = new Decimal(10000);

    console.log('Setting up market and strategy ===');
    const { env, kaminoMarket, kamino } = await setupStrategyAndMarketWithInitialLiquidity({
      reserves: [
        [otherTokenSymbol, '0'],
        [debtToken, '10000'],
        [collToken, '100000'],
      ],
      mintOverrides: {
        [debtToken]: debtTokenMintKey,
      },
    });

    await reloadReservesAndRefreshMarket(env, kaminoMarket);

    console.log('Creating user ===');
    const borrower = await newUser(
      env,
      kaminoMarket,
      [
        [collToken, new Decimal(55000)],
        [debtToken, new Decimal(0)],
      ],
      kamino
    );

    const collBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const debtBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, debtToken);

    console.log('Depositing with leverage ===', depositToken);
    await depositLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      depositToken,
      collToken,
      debtToken,
      depositAmount,
      targetLeverage,
      slippagePct,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    await sleep(2000);

    const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
    const [leverage, ltv, netValue] = [
      obligation.refreshedStats.leverage,
      obligation.loanToValue(),
      obligation.refreshedStats.netAccountValue,
    ];

    const collBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const debtBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, debtToken);

    console.log('First time: leverage: ', leverage);
    console.log('First time: ltv: ', ltv.toNumber());
    console.log('First time: netValue: ', netValue);

    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
      })
    );

    assertFuzzyEq(leverage, 3, 0.001);

    console.log('Withdrawing with leverage ===', withdrawToken);
    await withdrawLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      withdrawToken,
      collToken,
      debtToken,
      withdrawAmount,
      slippagePct,
      new Decimal(obligation.getDeposits()[0].amount),
      new Decimal(obligation.getBorrows()[0].amount),
      false,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    await sleep(2000);
    {
      const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
      const [leverage, ltv, netValue] = [
        obligation.refreshedStats.leverage,
        obligation.loanToValue(),
        obligation.refreshedStats.netAccountValue,
      ];
      console.log('Second time leverage: ', leverage);
      console.log('Second time ltv: ', ltv.toNumber());
      console.log('First time: netValue: ', netValue);
      assertFuzzyEq(leverage, 3, 0.001);
    }

    const collBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, collToken);
    const debtBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, debtToken);

    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
        collBalanceAfterWithdraw,
        debtBalanceAfterWithdraw,
        withdrawAmount,
        diff: collBalanceAfterWithdraw! - withdrawAmount.toNumber(),
      })
    );

    const collPrice = kaminoMarket.getReserveBySymbol(collToken)!.getReserveMarketPrice().toNumber()!;

    assertFuzzyEq(
      collBalanceBeforeDeposit! * collPrice,
      (collBalanceAfterDeposit! + depositAmount.toNumber()) * collPrice,
      0.5
    );
    assertFuzzyEq(debtBalanceBeforeDeposit!, debtBalanceAfterDeposit!, 0.03);
    assertFuzzyEq(
      collBalanceAfterDeposit! * collPrice,
      (collBalanceAfterWithdraw! - withdrawAmount.toNumber()) * collPrice,
      0.1
    );
    assertFuzzyEq(debtBalanceAfterDeposit!, debtBalanceAfterWithdraw!, 0.01);
  });

  it('deposit_and_withdraw_first_time_with_leverage_sol_ktoken_deposit_coll_debt_sol', async function () {
    const [collToken, otherTokenSymbol, debtToken] = ['kSOL-USDC (Orca)', 'USDC', 'SOL'];
    const [depositToken, withdrawToken] = [collToken, collToken];
    const otherTokenMintKey = generateKeypairGt(WSOL_MINT);
    const slippagePct = 0.01;
    const depositAmount = new Decimal(50000);
    const targetLeverage = new Decimal(3);
    const withdrawAmount = new Decimal(10000);

    console.log('Setting up market and strategy ===');
    const { env, kaminoMarket, kamino } = await setupStrategyAndMarketWithInitialLiquidity({
      reserves: [
        [otherTokenSymbol, '0'],
        [debtToken, '10000'],
        [collToken, '100000'],
      ],
      mintOverrides: {
        [otherTokenSymbol]: otherTokenMintKey,
      },
    });

    await reloadReservesAndRefreshMarket(env, kaminoMarket);

    console.log('Creating user ===');
    const borrower = await newUser(
      env,
      kaminoMarket,
      [
        [collToken, new Decimal(55000)],
        [debtToken, new Decimal(20)],
      ],
      kamino
    );

    await reloadReservesAndRefreshMarket(env, kaminoMarket);

    const collBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const wsolBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, debtToken, true);
    const solBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, debtToken);
    const debtBalanceBeforeDeposit = wsolBalanceBeforeDeposit! + solBalanceBeforeDeposit!;

    console.log('Depositing with leverage ===', depositToken);
    await depositLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      depositToken,
      collToken,
      debtToken,
      depositAmount,
      targetLeverage,
      slippagePct,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    await sleep(2000);

    const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
    const [leverage, ltv, netValue] = [
      obligation.refreshedStats.leverage,
      obligation.loanToValue(),
      obligation.refreshedStats.netAccountValue,
    ];

    const collBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const wsolBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, debtToken, true);
    const solBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, debtToken);
    const debtBalanceAfterDeposit = wsolBalanceAfterDeposit! + solBalanceAfterDeposit!;

    console.log('First time: leverage: ', leverage);
    console.log('First time: ltv: ', ltv.toNumber());
    console.log('First time: netValue: ', netValue);

    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
      })
    );

    assertFuzzyEq(leverage, 3, 0.001);

    console.log('Withdrawing with leverage ===', withdrawToken);
    await withdrawLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      withdrawToken,
      collToken,
      debtToken,
      withdrawAmount,
      slippagePct,
      new Decimal(obligation.getDeposits()[0].amount),
      new Decimal(obligation.getBorrows()[0].amount),
      false,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    await sleep(2000);
    {
      const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
      const [leverage, ltv, netValue] = [
        obligation.refreshedStats.leverage,
        obligation.loanToValue(),
        obligation.refreshedStats.netAccountValue,
      ];
      console.log('Second time leverage: ', leverage);
      console.log('Second time ltv: ', ltv.toNumber());
      console.log('First time: netValue: ', netValue);
      assertFuzzyEq(leverage, 3, 0.001);
    }

    const collBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, collToken);
    const wsolBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, debtToken, true);
    const solBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, debtToken);
    const debtBalanceAfterWithdraw = wsolBalanceAfterWithdraw! + solBalanceAfterWithdraw!;

    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
        collBalanceAfterWithdraw,
        debtBalanceAfterWithdraw,
        withdrawAmount,
        diff: collBalanceAfterWithdraw! - withdrawAmount.toNumber(),
      })
    );

    const collPrice = kaminoMarket.getReserveBySymbol(collToken)!.getReserveMarketPrice().toNumber()!;

    assertFuzzyEq(
      collBalanceBeforeDeposit! * collPrice,
      (collBalanceAfterDeposit! + depositAmount.toNumber()) * collPrice,
      0.5
    );
    assertFuzzyEq(
      collBalanceAfterDeposit! * collPrice,
      (collBalanceAfterWithdraw! - withdrawAmount.toNumber()) * collPrice,
      0.1
    );
    assertFuzzyEq(debtBalanceAfterDeposit!, debtBalanceAfterWithdraw!, 0.02);
  });

  it('deposit_and_withdraw_first_time_with_leverage_sol_ktoken_deposit_debt_debt_sol', async function () {
    const [collToken, otherTokenSymbol, debtToken] = ['kSOL-USDC (Orca)', 'USDC', 'SOL'];
    const [depositToken, withdrawToken] = [debtToken, debtToken];
    const otherTokenMintKey = generateKeypairGt(WSOL_MINT);
    const slippagePct = 0.01;
    const depositAmount = new Decimal(5);
    const targetLeverage = new Decimal(3);
    const withdrawAmount = new Decimal(1);

    console.log('Setting up market and strategy ===');
    const { env, kaminoMarket, kamino } = await setupStrategyAndMarketWithInitialLiquidity({
      reserves: [
        [otherTokenSymbol, '0'],
        [debtToken, '10000'],
        [collToken, '100000'],
      ],
      mintOverrides: {
        [otherTokenSymbol]: otherTokenMintKey,
      },
    });

    await reloadReservesAndRefreshMarket(env, kaminoMarket);

    console.log('Creating user ===');
    const borrower = await newUser(
      env,
      kaminoMarket,
      [
        [collToken, new Decimal(10)],
        [debtToken, new Decimal(10)],
      ],
      kamino
    );

    await reloadReservesAndRefreshMarket(env, kaminoMarket);

    const collBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const wsolBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, debtToken, true);
    const solBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, debtToken);
    const debtBalanceBeforeDeposit = wsolBalanceBeforeDeposit! + solBalanceBeforeDeposit!;

    console.log('Depositing with leverage ===', depositToken);
    await depositLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      depositToken,
      collToken,
      debtToken,
      depositAmount,
      targetLeverage,
      slippagePct,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    await sleep(2000);

    const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
    const [leverage, ltv, netValue] = [
      obligation.refreshedStats.leverage,
      obligation.loanToValue(),
      obligation.refreshedStats.netAccountValue,
    ];

    const collBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const wsolBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, debtToken, true);
    const solBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, debtToken);
    const debtBalanceAfterDeposit = wsolBalanceAfterDeposit! + solBalanceAfterDeposit!;

    console.log('First time: leverage: ', leverage);
    console.log('First time: ltv: ', ltv.toNumber());
    console.log('First time: netValue: ', netValue);

    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
      })
    );

    assertFuzzyEq(leverage, 3, 0.001);

    console.log('Withdrawing with leverage ===', withdrawToken);
    await withdrawLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      withdrawToken,
      collToken,
      debtToken,
      withdrawAmount,
      slippagePct,
      new Decimal(obligation.getDeposits()[0].amount),
      new Decimal(obligation.getBorrows()[0].amount),
      false,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    await sleep(2000);
    {
      const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
      const [leverage, ltv, netValue] = [
        obligation.refreshedStats.leverage,
        obligation.loanToValue(),
        obligation.refreshedStats.netAccountValue,
      ];
      console.log('Second time leverage: ', leverage);
      console.log('Second time ltv: ', ltv.toNumber());
      console.log('First time: netValue: ', netValue);
      assertFuzzyEq(leverage, 3, 0.001);
    }

    const collBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, collToken);
    const wsolBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, debtToken, true);
    const solBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, debtToken);
    const debtBalanceAfterWithdraw = wsolBalanceAfterWithdraw! + solBalanceAfterWithdraw!;

    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
        collBalanceAfterWithdraw,
        debtBalanceAfterWithdraw,
        withdrawAmount,
        diff: collBalanceAfterWithdraw! - withdrawAmount.toNumber(),
      })
    );

    const collPrice = kaminoMarket.getReserveBySymbol(collToken)!.getReserveMarketPrice().toNumber()!;

    assertFuzzyEq(collBalanceAfterDeposit! * collPrice, collBalanceAfterWithdraw! * collPrice, 0.02);
    assertFuzzyEq(debtBalanceBeforeDeposit!, debtBalanceAfterDeposit! + depositAmount.toNumber(), 0.5);
    assertFuzzyEq(debtBalanceAfterDeposit!, debtBalanceAfterWithdraw! - withdrawAmount.toNumber(), 0.1);
  });

  it('deposit_and_withdraw_first_time_with_leverage_sol_ktoken_deposit_debt_debt_spl', async function () {
    const [collToken, debtToken, otherTokenSymbol] = ['kSOL-USDC (Orca)', 'USDC', 'SOL'];
    const [depositToken, withdrawToken] = [debtToken, debtToken];
    const debtTokenMintKey = generateKeypairGt(WSOL_MINT);
    const slippagePct = 0.01;
    const depositAmount = new Decimal(5);
    const targetLeverage = new Decimal(3);
    const withdrawAmount = new Decimal(1);

    console.log('Setting up market and strategy ===');
    const { env, kaminoMarket, kamino } = await setupStrategyAndMarketWithInitialLiquidity({
      reserves: [
        [otherTokenSymbol, '0'],
        [debtToken, '10000'],
        [collToken, '100000'],
      ],
      mintOverrides: {
        [debtToken]: debtTokenMintKey,
      },
    });

    await reloadReservesAndRefreshMarket(env, kaminoMarket);

    console.log('Creating user ===');
    const borrower = await newUser(
      env,
      kaminoMarket,
      [
        [collToken, new Decimal(10)],
        [debtToken, new Decimal(10)],
      ],
      kamino
    );

    await reloadReservesAndRefreshMarket(env, kaminoMarket);

    const collBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const debtBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, debtToken);

    console.log('Depositing with leverage ===', depositToken);
    await depositLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      depositToken,
      collToken,
      debtToken,
      depositAmount,
      targetLeverage,
      slippagePct,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    await sleep(2000);

    const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
    const [leverage, ltv, netValue] = [
      obligation.refreshedStats.leverage,
      obligation.loanToValue(),
      obligation.refreshedStats.netAccountValue,
    ];

    const collBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const debtBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, debtToken);

    console.log('First time: leverage: ', leverage);
    console.log('First time: ltv: ', ltv.toNumber());
    console.log('First time: netValue: ', netValue);

    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
      })
    );

    assertFuzzyEq(leverage, 3, 0.001);

    console.log('Withdrawing with leverage ===', withdrawToken);
    await withdrawLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      withdrawToken,
      collToken,
      debtToken,
      withdrawAmount,
      slippagePct,
      new Decimal(obligation.getDeposits()[0].amount),
      new Decimal(obligation.getBorrows()[0].amount),
      false,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    await sleep(2000);
    {
      const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
      const [leverage, ltv, netValue] = [
        obligation.refreshedStats.leverage,
        obligation.loanToValue(),
        obligation.refreshedStats.netAccountValue,
      ];
      console.log('Second time leverage: ', leverage);
      console.log('Second time ltv: ', ltv.toNumber());
      console.log('First time: netValue: ', netValue);
      assertFuzzyEq(leverage, 3, 0.001);
    }

    const collBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, collToken);
    const debtBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, debtToken);

    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
        collBalanceAfterWithdraw,
        debtBalanceAfterWithdraw,
        withdrawAmount,
        diff: debtBalanceAfterWithdraw! - withdrawAmount.toNumber(),
      })
    );

    const collPrice = kaminoMarket.getReserveBySymbol(collToken)!.getReserveMarketPrice().toNumber()!;

    assertFuzzyEq(collBalanceAfterDeposit! * collPrice, collBalanceAfterWithdraw! * collPrice, 0.02);
    assertFuzzyEq(debtBalanceBeforeDeposit!, debtBalanceAfterDeposit! + depositAmount.toNumber(), 0.5);
    assertFuzzyEq(debtBalanceAfterDeposit!, debtBalanceAfterWithdraw! - withdrawAmount.toNumber(), 0.1);
  });

  it('deposit_first_time_leverage_no_sol_ktoken_deposit_coll_and_close_position', async function () {
    const [collToken, debtToken, otherTokenSymbol] = ['kMSOL-USDC (Orca)', 'USDC', 'MSOL'];
    const [depositToken, withdrawToken] = [collToken, collToken];
    const debtTokenMintKey = Keypair.generate();
    const otherTokenMintKey = generateKeypairLt(debtTokenMintKey.publicKey);
    const slippagePct = 0.01;
    const closePosition = true;
    const depositAmount = new Decimal(50000);
    const targetLeverage = new Decimal(3);

    console.log('Setting up market and strategy ===');
    const { env, kaminoMarket, kamino } = await setupStrategyAndMarketWithInitialLiquidity({
      reserves: [
        [otherTokenSymbol, '0'],
        [debtToken, '10000'],
        [collToken, '100000'],
      ],
      mintOverrides: {
        [otherTokenSymbol]: otherTokenMintKey,
        [debtToken]: debtTokenMintKey,
      },
    });
    await sleep(2000);

    await reloadReservesAndRefreshMarket(env, kaminoMarket);

    console.log('Creating user ===');
    const borrower = await newUser(
      env,
      kaminoMarket,
      [
        [collToken, new Decimal(55000)],
        [debtToken, new Decimal(20)],
      ],
      kamino
    );

    const collBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const debtBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, debtToken);
    const otherTokenBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, otherTokenSymbol);

    console.log('Depositing with leverage ===', depositToken);
    await depositLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      depositToken,
      collToken,
      debtToken,
      depositAmount,
      targetLeverage,
      slippagePct,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    await sleep(2000);

    const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
    const [leverage, ltv, netValue] = [
      obligation.refreshedStats.leverage,
      obligation.loanToValue(),
      obligation.refreshedStats.netAccountValue,
    ];

    console.log('First time: leverage: ', leverage);
    console.log('First time: ltv: ', ltv.toNumber());
    console.log('First time: netValue: ', netValue);

    const collBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const debtBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, debtToken);
    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceBeforeDeposit,
        debtBalanceAfterDeposit,
        depositAmount,
      })
    );

    assertFuzzyEq(debtBalanceBeforeDeposit!, debtBalanceAfterDeposit!, 0.03);

    assertFuzzyEq(leverage, targetLeverage.toNumber(), 0.001);

    console.log('Withdrawing with leverage ===', withdrawToken);
    await withdrawLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      withdrawToken,
      collToken,
      debtToken,
      new Decimal(1),
      slippagePct,
      new Decimal(obligation.getDeposits()[0].amount),
      new Decimal(obligation.getBorrows()[0].amount),
      closePosition,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    {
      await sleep(2000);
      const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
      assert.ok(obligation === undefined);
    }

    const collBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, collToken);
    const debtBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, debtToken);
    const otherTokenBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, otherTokenSymbol);

    const collPrice = kaminoMarket.getReserveBySymbol(collToken)!.getReserveMarketPrice();
    const debtPrice = kaminoMarket.getReserveBySymbol(debtToken)!.getReserveMarketPrice();
    const otherTokenPrice = kaminoMarket.getReserveBySymbol(otherTokenSymbol)!.getReserveMarketPrice();
    const diffCollInUsd = (collBalanceBeforeDeposit! - collBalanceAfterWithdraw!) * collPrice.toNumber();
    const diffDebtInUsd = (debtBalanceAfterWithdraw! - debtBalanceBeforeDeposit!) * debtPrice.toNumber();
    const diffOtherTokenInUsd =
      (otherTokenBalanceAfterWithdraw! - otherTokenBalanceBeforeDeposit!) * otherTokenPrice.toNumber();

    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
        collBalanceAfterWithdraw,
        debtBalanceAfterWithdraw,
        diffCollInUsd,
        diffDebtInUsd,
        diffOtherTokenInUsd,
      })
    );

    assertFuzzyEq(diffCollInUsd, diffDebtInUsd, 0.3);
  });

  it('deposit_first_time_leverage_sol_ktoken_deposit_coll_and_close_position', async function () {
    const [collToken, debtToken, otherTokenSymbol] = ['kSOL-USDC (Orca)', 'SOL', 'USDC'];
    const [depositToken, withdrawToken] = [collToken, collToken];
    const otherTokenMintKey = generateKeypairGt(WSOL_MINT);
    const slippagePct = 0.01;
    const closePosition = true;
    const depositAmount = new Decimal(50000);
    const targetLeverage = new Decimal(3);

    console.log('Setting up market and strategy ===');
    const { env, kaminoMarket, kamino } = await setupStrategyAndMarketWithInitialLiquidity({
      reserves: [
        [otherTokenSymbol, '0'],
        [debtToken, '10000'],
        [collToken, '100000'],
      ],
      mintOverrides: {
        [otherTokenSymbol]: otherTokenMintKey,
      },
    });

    await reloadReservesAndRefreshMarket(env, kaminoMarket);

    console.log('Creating user ===');
    const borrower = await newUser(
      env,
      kaminoMarket,
      [
        [collToken, new Decimal(55000)],
        [debtToken, new Decimal(0)],
      ],
      kamino
    );

    const collBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const wsolBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, debtToken, true);
    const solBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, debtToken);
    const debtBalanceBeforeDeposit = wsolBalanceBeforeDeposit! + solBalanceBeforeDeposit!;

    console.log('Depositing with leverage ===', depositToken);
    await depositLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      depositToken,
      collToken,
      debtToken,
      depositAmount,
      targetLeverage,
      slippagePct,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    await sleep(2000);

    const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
    const [leverage, ltv, netValue] = [
      obligation.refreshedStats.leverage,
      obligation.loanToValue(),
      obligation.refreshedStats.netAccountValue,
    ];

    console.log('First time: leverage: ', leverage);
    console.log('First time: ltv: ', ltv.toNumber());
    console.log('First time: netValue: ', netValue);

    const collBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const wsolBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, debtToken, true);
    const solBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, debtToken);
    const debtBalanceAfterDeposit = wsolBalanceAfterDeposit! + solBalanceAfterDeposit!;

    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
        depositAmount,
        diff: collBalanceBeforeDeposit! - depositAmount.toNumber(),
      })
    );

    assertFuzzyEq(leverage, targetLeverage.toNumber(), 0.001);

    console.log('Withdrawing with leverage ===', withdrawToken);
    await withdrawLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      withdrawToken,
      collToken,
      debtToken,
      new Decimal(1),
      slippagePct,
      new Decimal(obligation.getDeposits()[0].amount),
      new Decimal(obligation.getBorrows()[0].amount),
      closePosition,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    {
      await sleep(2000);
      const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
      assert.ok(obligation === undefined);
    }

    const collBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, collToken);
    const wsolBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, debtToken, true);
    const solBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, debtToken);
    const debtBalanceAfterWithdraw = wsolBalanceAfterWithdraw! + solBalanceAfterWithdraw!;
    const collPrice = kaminoMarket.getReserveBySymbol(collToken)!.getReserveMarketPrice();
    const debtPrice = kaminoMarket.getReserveBySymbol(debtToken)!.getReserveMarketPrice();
    const diffCollInUsd = (collBalanceBeforeDeposit! - collBalanceAfterWithdraw!) * collPrice.toNumber();
    const diffDebtInUsd = (debtBalanceAfterWithdraw! - debtBalanceBeforeDeposit!) * debtPrice.toNumber();

    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
        collBalanceAfterWithdraw,
        debtBalanceAfterWithdraw,
        diffCollInUsd,
        diffDebtInUsd,
      })
    );

    assertFuzzyEq(diffCollInUsd, diffDebtInUsd, 0.2);

    // TODO we could improve the accuracy here
    assertFuzzyEq(debtBalanceBeforeDeposit!, debtBalanceAfterWithdraw!, 0.2);
  });

  it('deposit_first_time_leverage_sol_ktoken_deposit_debt_and_close_position', async function () {
    const [collToken, debtToken, otherTokenSymbol] = ['kSOL-USDC (Orca)', 'SOL', 'USDC'];
    const [depositToken, withdrawToken] = [debtToken, debtToken];
    const otherTokenMintKey = generateKeypairGt(WSOL_MINT);
    const slippagePct = 0.01;
    const closePosition = true;
    const depositAmount = new Decimal(5);
    const targetLeverage = new Decimal(3);

    console.log('Setting up market and strategy ===');
    const { env, kaminoMarket, kamino } = await setupStrategyAndMarketWithInitialLiquidity({
      reserves: [
        [otherTokenSymbol, '0'],
        [debtToken, '10000'],
        [collToken, '100000'],
      ],
      mintOverrides: {
        [otherTokenSymbol]: otherTokenMintKey,
      },
    });

    await reloadReservesAndRefreshMarket(env, kaminoMarket);

    console.log('Creating user ===');
    const borrower = await newUser(
      env,
      kaminoMarket,
      [
        [collToken, new Decimal(10)],
        [debtToken, new Decimal(10)],
      ],
      kamino
    );

    const collBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const wsolBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, debtToken, true);
    const solBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, debtToken);
    const debtBalanceBeforeDeposit = wsolBalanceBeforeDeposit! + solBalanceBeforeDeposit!;

    console.log('Depositing with leverage ===', depositToken);
    await depositLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      depositToken,
      collToken,
      debtToken,
      depositAmount,
      targetLeverage,
      slippagePct,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    await sleep(2000);

    const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
    const [leverage, ltv, netValue] = [
      obligation.refreshedStats.leverage,
      obligation.loanToValue(),
      obligation.refreshedStats.netAccountValue,
    ];

    console.log('First time: leverage: ', leverage);
    console.log('First time: ltv: ', ltv.toNumber());
    console.log('First time: netValue: ', netValue);

    const collBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const wsolBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, debtToken, true);
    const solBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, debtToken);
    const debtBalanceAfterDeposit = wsolBalanceAfterDeposit! + solBalanceAfterDeposit!;

    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
        depositAmount,
        diff: collBalanceBeforeDeposit! - depositAmount.toNumber(),
      })
    );

    assertFuzzyEq(leverage, targetLeverage.toNumber(), 0.001);

    const obligationAfterDep = (
      await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey)
    )[0];
    console.log('obligationAfterDep.getDeposits()[0].amount', obligationAfterDep.getDeposits()[0].amount);

    console.log('Withdrawing with leverage ===', withdrawToken);
    await withdrawLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      withdrawToken,
      collToken,
      debtToken,
      new Decimal(1),
      slippagePct,
      new Decimal(obligation.getDeposits()[0].amount),
      new Decimal(obligation.getBorrows()[0].amount),
      closePosition,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    {
      await sleep(2000);
      const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
      assert.ok(obligation === undefined);
    }

    const collBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, collToken);
    const wsolBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, debtToken, true);
    const solBalanceAfterWithdraw = await balance(env, borrower, kaminoMarket, debtToken);
    const debtBalanceAfterWithdraw = wsolBalanceAfterWithdraw! + solBalanceAfterWithdraw!;
    const collPrice = kaminoMarket.getReserveBySymbol(collToken)!.getReserveMarketPrice();
    const debtPrice = kaminoMarket.getReserveBySymbol(debtToken)!.getReserveMarketPrice();
    const diffCollInUsd = (collBalanceBeforeDeposit! - collBalanceAfterWithdraw!) * collPrice.toNumber();
    const diffDebtInUsd = (debtBalanceAfterWithdraw! - debtBalanceBeforeDeposit!) * debtPrice.toNumber();

    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
        collBalanceAfterWithdraw,
        debtBalanceAfterWithdraw,
        diffCollInUsd,
        diffDebtInUsd,
      })
    );

    assertFuzzyEq(diffCollInUsd, diffDebtInUsd, 0.2);

    // TODO we could improve the accuracy here
    assertFuzzyEq(debtBalanceBeforeDeposit!, debtBalanceAfterWithdraw!, 0.2);
  });

  it('deposit_and_withdraw_test_user_metadata_and_extend_lookup', async function () {
    const [collToken, otherTokenSymbol, debtToken] = ['kSOL-USDC (Orca)', 'USDC', 'SOL'];
    const [depositToken, withdrawToken] = [debtToken, debtToken];
    const otherTokenMintKey = generateKeypairGt(WSOL_MINT);
    const slippagePct = 0.01;
    const depositAmount = new Decimal(5);
    const targetLeverage = new Decimal(3);
    const withdrawAmount = new Decimal(1);

    console.log('Setting up market and strategy ===');
    const { env, kaminoMarket, kamino } = await setupStrategyAndMarketWithInitialLiquidity({
      reserves: [
        [otherTokenSymbol, '0'],
        [debtToken, '10000'],
        [collToken, '100000'],
      ],
      mintOverrides: {
        [otherTokenSymbol]: otherTokenMintKey,
      },
    });

    await reloadReservesAndRefreshMarket(env, kaminoMarket);

    console.log('Creating user ===');
    const borrower = await newUser(
      env,
      kaminoMarket,
      [
        [collToken, new Decimal(10)],
        [debtToken, new Decimal(10)],
      ],
      kamino
    );

    const [, borrowerMetadata] = await kaminoMarket.getUserMetadata(borrower.publicKey);
    const borrowerLutAddress = borrowerMetadata?.userLookupTable!;
    assert(!borrowerLutAddress.equals(PublicKey.default));

    const borrowerLutStateBeforeLeverage = (
      await kaminoMarket.getConnection().getAddressLookupTable(borrowerLutAddress)
    ).value?.state;

    assert(borrowerLutStateBeforeLeverage);

    assert(borrowerLutStateBeforeLeverage!.addresses.length === 0);

    await reloadReservesAndRefreshMarket(env, kaminoMarket);

    console.log('Depositing with leverage ===', depositToken);
    await depositLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      depositToken,
      collToken,
      debtToken,
      depositAmount,
      targetLeverage,
      slippagePct,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    await sleep(2000);

    const borrowerLutStateAfterLeverage = (await kaminoMarket.getConnection().getAddressLookupTable(borrowerLutAddress))
      .value?.state;

    console.log('borrowerLutStateAfterLeverage!.addresses.length', borrowerLutStateAfterLeverage!.addresses.length);
    assert(borrowerLutStateAfterLeverage!.addresses.length > 0);

    const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];

    console.log('Withdrawing with leverage ===', withdrawToken);
    await withdrawLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      withdrawToken,
      collToken,
      debtToken,
      withdrawAmount,
      slippagePct,
      new Decimal(obligation.getDeposits()[0].amount),
      new Decimal(obligation.getBorrows()[0].amount),
      false,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    await sleep(2000);

    const borrowerLutStateAfterWithdraw = (await kaminoMarket.getConnection().getAddressLookupTable(borrowerLutAddress))
      .value?.state;

    console.log('borrowerLutStateAfterWithdraw!.addresses.length', borrowerLutStateAfterWithdraw!.addresses.length);
    assert(borrowerLutStateAfterLeverage!.addresses.length == borrowerLutStateAfterWithdraw!.addresses.length);
  });
});

function generateKeypairLt(keyToCompare: PublicKey): Keypair {
  let isLessThan = false;
  let keypair = Keypair.generate();
  while (!isLessThan) {
    keypair = Keypair.generate();
    isLessThan = Buffer.compare(keyToCompare.toBuffer(), keypair.publicKey.toBuffer()) > 0;
  }
  return keypair;
}

function generateKeypairGt(keyToCompare: PublicKey): Keypair {
  let isGreaterThan = false;
  let keypair = Keypair.generate();
  while (!isGreaterThan) {
    keypair = Keypair.generate();
    isGreaterThan = Buffer.compare(keyToCompare.toBuffer(), keypair.publicKey.toBuffer()) < 0;
  }
  return keypair;
}
