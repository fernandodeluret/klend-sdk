import { Keypair, PublicKey } from '@solana/web3.js';
import { MultiplyObligation, sleep, toJson } from '../src';
import {
  WSOL_MINT,
  adjustLeverageTestAdapter,
  depositLeverageTestAdapter,
  getPriceMock,
} from './runner/leverage_utils';
import { setupStrategyAndMarketWithInitialLiquidity, newUser, balance } from './runner/setup_utils';
import Decimal from 'decimal.js';
import { assert } from 'chai';
import { assertFuzzyEq } from './runner/assert';
import { reloadReservesAndRefreshMarket } from './runner/setup_operations';

describe('Leverage kTokens adjustment tests', function () {
  it('deposit_with_leverage_non_sol_ktoken_deposit_debt_then_adjust_up', async function () {
    const [collToken, debtToken, otherTokenSymbol] = ['kMSOL-USDC (Orca)', 'USDC', 'MSOL'];
    const [depositToken, withdrawToken] = [debtToken, debtToken];
    const debtTokenMintKey = Keypair.generate();
    const otherTokenMintKey = generateKeypairLt(debtTokenMintKey.publicKey);
    const slippagePct = 0.01;
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
        [debtToken]: debtTokenMintKey,
      },
    });

    await reloadReservesAndRefreshMarket(env, kaminoMarket);

    console.log('Creating user ===');
    const borrower = await newUser(
      env,
      kaminoMarket,
      [
        [collToken, new Decimal(20)],
        [debtToken, new Decimal(20)],
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

    const collBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const debtBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, debtToken);

    const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
    const [initialLeverage, ltv, netValue] = [
      obligation.refreshedStats.leverage,
      obligation.loanToValue(),
      obligation.refreshedStats.netAccountValue,
    ];

    console.log('First time: leverage: ', initialLeverage);
    console.log('First time: ltv: ', ltv.toNumber());
    console.log('First time: netValue: ', netValue);

    assertFuzzyEq(initialLeverage, targetLeverage, 0.001);

    assertFuzzyEq(debtBalanceAfterDeposit!, debtBalanceBeforeDeposit! - depositAmount.toNumber(), 0.01);

    console.log('Adjusting with leverage up ===', withdrawToken);
    await adjustLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      collToken,
      debtToken,
      slippagePct,
      obligation.getDeposits()[0].amount,
      obligation.getBorrows()[0].amount,
      initialLeverage.add(0.8),
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
      assertFuzzyEq(leverage, initialLeverage.add(0.8), 0.001);
    }

    const collBalanceAfterLeverage = await balance(env, borrower, kaminoMarket, collToken);
    const debtBalanceAfterLeverage = await balance(env, borrower, kaminoMarket, debtToken);

    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
        collBalanceAfterLeverage,
        debtBalanceAfterLeverage,
      })
    );

    assertFuzzyEq(collBalanceAfterDeposit!, collBalanceAfterLeverage!, 0.2);
    assertFuzzyEq(debtBalanceAfterDeposit!, debtBalanceAfterLeverage!, 0.01);
  });

  it('deposit_with_leverage_non_sol_ktoken_deposit_debt_then_adjust_down', async function () {
    const [collToken, debtToken, otherTokenSymbol] = ['kMSOL-USDC (Orca)', 'USDC', 'MSOL'];
    const [depositToken, withdrawToken] = [debtToken, debtToken];
    const debtTokenMintKey = Keypair.generate();
    const otherTokenMintKey = generateKeypairLt(debtTokenMintKey.publicKey);
    const slippagePct = 0.01;
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
        [debtToken]: debtTokenMintKey,
      },
    });

    await reloadReservesAndRefreshMarket(env, kaminoMarket);

    console.log('Creating user ===');
    const borrower = await newUser(
      env,
      kaminoMarket,
      [
        [collToken, new Decimal(20)],
        [debtToken, new Decimal(20)],
      ],
      kamino
    );

    const collBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const debtBalanceBeforeDeposit = await balance(env, borrower, kaminoMarket, debtToken);
    const debtPrice = await getPriceMock(kaminoMarket, debtToken, 'USD');

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

    const collBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const debtBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, debtToken);
    console.log(
      'Balances After deposit',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
      })
    );

    assertFuzzyEq(debtBalanceAfterDeposit!, debtBalanceBeforeDeposit! - depositAmount.toNumber(), 0.001);

    const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
    const [initialLeverage, ltv, netValue] = [
      obligation.refreshedStats.leverage,
      obligation.loanToValue(),
      obligation.refreshedStats.netAccountValue,
    ];

    console.log('First time: leverage: ', initialLeverage);
    console.log('First time: ltv: ', ltv.toNumber());
    console.log('First time: netValue: ', netValue);
    console.log('First time: depositAmount.toNumber() * debtPrice: ', depositAmount.toNumber() * debtPrice);

    assertFuzzyEq(initialLeverage, targetLeverage.toNumber(), 0.001);

    console.log('Adjusting with leverage down ===', withdrawToken);
    await adjustLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      collToken,
      debtToken,
      slippagePct,
      obligation.getDeposits()[0].amount,
      obligation.getBorrows()[0].amount,
      initialLeverage.sub(1),
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
      console.log('Second time: netValue: ', netValue);
      console.log('Second time: depositAmount.toNumber() * debtPrice: ', depositAmount.toNumber() * debtPrice);
      assertFuzzyEq(leverage, initialLeverage.sub(1), 0.001);
      assertFuzzyEq(netValue, depositAmount.toNumber() * debtPrice, 0.1);
    }

    const collBalanceAfterLeverage = await balance(env, borrower, kaminoMarket, collToken);
    const debtBalanceAfterLeverage = await balance(env, borrower, kaminoMarket, debtToken);

    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
        collBalanceAfterLeverage,
        debtBalanceAfterLeverage,
      })
    );

    assert.equal(collBalanceAfterDeposit, collBalanceAfterLeverage);
    assertFuzzyEq(debtBalanceAfterDeposit!, debtBalanceAfterLeverage!, 0.001);
  });

  it('deposit_with_leverage_sol_ktoken_deposit_coll_debt_sol_adjust_up', async function () {
    const [collToken, debtToken, otherTokenSymbol] = ['kSOL-USDC (Orca)', 'SOL', 'USDC'];
    const [depositToken, withdrawToken] = [collToken, collToken];
    const otherTokenMintKey = generateKeypairGt(WSOL_MINT);
    const slippagePct = 0.01;
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

    const collBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const wsolBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, debtToken, true);
    const solBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, debtToken);
    const debtBalanceAfterDeposit = wsolBalanceAfterDeposit! + solBalanceAfterDeposit!;

    const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
    const [initialLeverage, ltv, firstTimeNetValue] = [
      obligation.refreshedStats.leverage,
      obligation.loanToValue(),
      obligation.refreshedStats.netAccountValue,
    ];

    console.log('First time: leverage: ', initialLeverage);
    console.log('First time: ltv: ', ltv.toNumber());
    console.log('First time: netValue: ', firstTimeNetValue);
    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
      })
    );

    assertFuzzyEq(initialLeverage, targetLeverage, 0.001);

    console.log('Adjusting with leverage up ===', withdrawToken);
    await adjustLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      collToken,
      debtToken,
      slippagePct,
      obligation.getDeposits()[0].amount,
      obligation.getBorrows()[0].amount,
      initialLeverage.add(0.9),
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    const obligationReloaded = (
      await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey)
    )[0];
    const [secondTimeLeverage, secondTimeLtv, secondTimeNetValue] = [
      obligationReloaded.refreshedStats.leverage,
      obligationReloaded.loanToValue(),
      obligationReloaded.refreshedStats.netAccountValue,
    ];
    console.log('Second time leverage: ', secondTimeLeverage);
    console.log('Second time ltv: ', secondTimeLtv.toNumber());
    console.log('Second time: netValue: ', secondTimeNetValue);
    console.log('Second time: netValueDiffs: ', firstTimeNetValue, secondTimeNetValue);

    assertFuzzyEq(secondTimeLeverage, initialLeverage.add(0.9), 0.001);
    assertFuzzyEq(firstTimeNetValue, secondTimeNetValue, 0.02);

    const collBalanceAfterLeverage = await balance(env, borrower, kaminoMarket, collToken);
    const wsolBalanceAfterLeverage = await balance(env, borrower, kaminoMarket, debtToken, true);
    const solBalanceAfterLeverage = await balance(env, borrower, kaminoMarket, debtToken);
    const debtBalanceAfterLeverage = wsolBalanceAfterLeverage! + solBalanceAfterLeverage!;

    const collPrice = kaminoMarket.getReserveBySymbol(collToken)!.getReserveMarketPrice();
    const debtPrice = kaminoMarket.getReserveBySymbol(debtToken)!.getReserveMarketPrice();
    const diffCollInUsd = (collBalanceAfterLeverage! - collBalanceAfterDeposit!) * collPrice.toNumber();
    const diffDebtInUsd = (debtBalanceAfterDeposit! - debtBalanceAfterLeverage!) * debtPrice.toNumber();

    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
        collBalanceAfterLeverage,
        debtBalanceAfterLeverage,
        diffCollInUsd,
        diffDebtInUsd,
      })
    );

    assertFuzzyEq(
      collBalanceAfterLeverage! * collPrice.toNumber(),
      collBalanceAfterDeposit! * collPrice.toNumber(),
      0.03
    );
    assertFuzzyEq(
      debtBalanceAfterDeposit * debtPrice.toNumber(),
      debtBalanceAfterLeverage * debtPrice.toNumber(),
      0.01
    );
  });

  it('deposit_with_leverage_sol_ktoken_deposit_coll_debt_sol_adjust_down', async function () {
    const [collToken, debtToken, otherTokenSymbol] = ['kSOL-USDC (Orca)', 'SOL', 'USDC'];
    const [depositToken, withdrawToken] = [collToken, collToken];
    const otherTokenMintKey = generateKeypairGt(WSOL_MINT);
    const slippagePct = 0.01;
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

    const collBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, collToken);
    const wsolBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, debtToken, true);
    const solBalanceAfterDeposit = await balance(env, borrower, kaminoMarket, debtToken);
    const debtBalanceAfterDeposit = wsolBalanceAfterDeposit! + solBalanceAfterDeposit!;

    const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
    const [initialLeverage, ltv, firstTimeNetValue] = [
      obligation.refreshedStats.leverage,
      obligation.loanToValue(),
      obligation.refreshedStats.netAccountValue,
    ];

    console.log('First time: leverage: ', initialLeverage);
    console.log('First time: ltv: ', ltv.toNumber());
    console.log('First time: netValue: ', firstTimeNetValue);
    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
      })
    );

    assertFuzzyEq(initialLeverage, targetLeverage, 0.001);

    console.log('Adjusting with leverage up ===', withdrawToken);
    await adjustLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      collToken,
      debtToken,
      slippagePct,
      obligation.getDeposits()[0].amount,
      obligation.getBorrows()[0].amount,
      initialLeverage.sub(1),
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    const obligationReloaded = (
      await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey)
    )[0];
    const [secondTimeLeverage, secondTimeLtv, secondTimeNetValue] = [
      obligationReloaded.refreshedStats.leverage,
      obligationReloaded.loanToValue(),
      obligationReloaded.refreshedStats.netAccountValue,
    ];
    console.log('Second time leverage: ', secondTimeLeverage);
    console.log('Second time ltv: ', secondTimeLtv.toNumber());
    console.log('Second time: netValue: ', secondTimeNetValue);
    console.log('Second time: netValueDiffs: ', firstTimeNetValue, secondTimeNetValue);

    assertFuzzyEq(secondTimeLeverage, initialLeverage.sub(1), 0.001);
    assertFuzzyEq(firstTimeNetValue, secondTimeNetValue, 0.03);

    const collBalanceAfterLeverage = await balance(env, borrower, kaminoMarket, collToken);
    const wsolBalanceAfterLeverage = await balance(env, borrower, kaminoMarket, debtToken, true);
    const solBalanceAfterLeverage = await balance(env, borrower, kaminoMarket, debtToken);
    const debtBalanceAfterLeverage = wsolBalanceAfterLeverage! + solBalanceAfterLeverage!;

    const collPrice = kaminoMarket.getReserveBySymbol(collToken)!.getReserveMarketPrice();
    const debtPrice = kaminoMarket.getReserveBySymbol(debtToken)!.getReserveMarketPrice();
    const diffCollInUsd = (collBalanceAfterLeverage! - collBalanceAfterDeposit!) * collPrice.toNumber();
    const diffDebtInUsd = (debtBalanceAfterDeposit! - debtBalanceAfterLeverage!) * debtPrice.toNumber();

    console.log(
      'Balances',
      toJson({
        collBalanceBeforeDeposit,
        debtBalanceBeforeDeposit,
        collBalanceAfterDeposit,
        debtBalanceAfterDeposit,
        collBalanceAfterLeverage,
        debtBalanceAfterLeverage,
        diffCollInUsd,
        diffDebtInUsd,
      })
    );

    assertFuzzyEq(collBalanceAfterLeverage! * collPrice.toNumber(), collBalanceAfterDeposit! * collPrice.toNumber());
    assertFuzzyEq(
      debtBalanceAfterDeposit * debtPrice.toNumber(),
      debtBalanceAfterLeverage * debtPrice.toNumber(),
      0.06
    );
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
