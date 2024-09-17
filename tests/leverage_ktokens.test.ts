import { Keypair, PublicKey } from '@solana/web3.js';
import { MultiplyObligation } from '../src';
import { WSOL_MINT, depositLeverageTestAdapter, getPriceMock } from './runner/leverage_utils';
import { setupStrategyAndMarketWithInitialLiquidity, newUser } from './runner/setup_utils';
import Decimal from 'decimal.js';
import { assertFuzzyEq } from './runner/assert';
import { reloadReservesAndRefreshMarket } from './runner/setup_operations';

describe('Leverage SDK kTokens tests', function () {
  it('deposit_with_leverage_non_sol_ktoken_deposit_debt_debt_spl', async function () {
    const [collToken, debtToken, otherTokenSymbol] = ['kSTSOL-USDC (Orca)', 'USDC', 'STSOL'];
    const depositToken = debtToken;
    const debtTokenMintKey = Keypair.generate();
    const otherTokenMintKey = generateKeypairLt(debtTokenMintKey.publicKey);

    console.log('Setting up market and strategy ===');
    const { env, kaminoMarket, kamino } = await setupStrategyAndMarketWithInitialLiquidity({
      reserves: [
        [otherTokenSymbol, '0'],
        [debtToken, '10000'],
        [collToken, '10000'],
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
        [collToken, new Decimal(10)],
        [debtToken, new Decimal(10)],
      ],
      kamino
    );

    // reloding again for ktoken price
    await reloadReservesAndRefreshMarket(env, kaminoMarket);

    console.log('Depositing with leverage ===');
    await depositLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      depositToken,
      collToken,
      debtToken,
      new Decimal(5),
      new Decimal(3),
      0.01,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
    const [leverage, ltv] = [obligation.refreshedStats.leverage, obligation.loanToValue()];

    console.log('leverage: ', leverage);
    console.log('ltv: ', ltv.toNumber());

    assertFuzzyEq(leverage, 3, 0.001);
  });

  it('deposit_with_leverage_sol_ktoken_deposit_debt_debt_spl', async function () {
    const [collToken, otherTokenSymbol, debtToken] = ['kSOL-USDC (Orca)', 'SOL', 'USDC'];
    const depositToken = debtToken;
    const debtTokenMintKey = generateKeypairGt(WSOL_MINT);

    console.log('Setting up market and strategy ===');
    const { env, kaminoMarket, kamino } = await setupStrategyAndMarketWithInitialLiquidity({
      reserves: [
        [otherTokenSymbol, '0'],
        [debtToken, '10000'],
        [collToken, '10000'],
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
        [collToken, new Decimal(0)],
        [debtToken, new Decimal(10)],
      ],
      kamino
    );

    console.log('Depositing with leverage ===');
    await depositLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      depositToken,
      collToken,
      debtToken,
      new Decimal(5),
      new Decimal(3),
      0.01,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
    const [leverage, ltv] = [obligation.refreshedStats.leverage, obligation.loanToValue()];

    console.log('leverage: ', leverage);
    console.log('ltv: ', ltv.toNumber());

    assertFuzzyEq(leverage, 3, 0.001);
  });

  it('deposit_with_leverage_sol_ktoken_deposit_coll_debt_spl', async function () {
    const [collToken, otherTokenSymbol, debtToken] = ['kSOL-USDC (Orca)', 'SOL', 'USDC'];
    const depositToken = collToken;
    const debtTokenMintKey = generateKeypairGt(WSOL_MINT);

    console.log('Setting up market and strategy ===');
    const { env, kaminoMarket, kamino } = await setupStrategyAndMarketWithInitialLiquidity({
      reserves: [
        [otherTokenSymbol, '0'],
        [debtToken, '10000'],
        [collToken, '10000'],
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
        [collToken, new Decimal(400000)],
        [debtToken, new Decimal(0)],
      ],
      kamino
    );

    console.log('Depositing with leverage ===');
    await depositLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      depositToken,
      collToken,
      debtToken,
      new Decimal(4000),
      new Decimal(3),
      0.01,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
    const [leverage, ltv] = [obligation.refreshedStats.leverage, obligation.loanToValue()];

    console.log('leverage: ', leverage);
    console.log('ltv: ', ltv.toNumber());

    assertFuzzyEq(leverage, 3, 0.001);
  });

  it('deposit_with_leverage_sol_ktoken_deposit_debt_debt_sol_token', async function () {
    const [collToken, debtToken, otherTokenSymbol] = ['kSOL-USDC (Orca)', 'SOL', 'USDC'];
    const depositToken = debtToken;
    const otherTokenMintKey = generateKeypairGt(WSOL_MINT);

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
        [collToken, new Decimal(0)],
        [debtToken, new Decimal(10)],
      ],
      kamino
    );

    console.log('Depositing with leverage ===');
    await depositLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      depositToken,
      collToken,
      debtToken,
      new Decimal(5),
      new Decimal(3),
      0.01,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
    const [leverage, ltv] = [obligation.refreshedStats.leverage, obligation.loanToValue()];

    console.log('leverage: ', leverage);
    console.log('ltv: ', ltv.toNumber());

    assertFuzzyEq(leverage, 3, 0.001);
  });

  it('deposit_with_leverage_sol_ktoken_deposit_coll_debt_sol_token', async function () {
    const [collToken, debtToken, otherTokenSymbol] = ['kSOL-USDC (Orca)', 'SOL', 'USDC'];
    const depositToken = collToken;
    const otherTokenMintKey = generateKeypairGt(WSOL_MINT);

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
        [collToken, new Decimal(50000)],
        [debtToken, new Decimal(0)],
      ],
      kamino
    );

    console.log('Depositing with leverage ===');
    await depositLeverageTestAdapter(
      env,
      borrower,
      kaminoMarket,
      depositToken,
      collToken,
      debtToken,
      new Decimal(40000),
      new Decimal(3),
      0.01,
      (a: string, b: string) => getPriceMock(kaminoMarket, a, b),
      PublicKey.default,
      kamino
    );

    const obligation = (await kaminoMarket.getUserObligationsByTag(MultiplyObligation.tag, borrower.publicKey))[0];
    const [leverage, ltv] = [obligation.refreshedStats.leverage, obligation.loanToValue()];

    console.log('leverage: ', leverage);
    console.log('ltv: ', ltv.toNumber());

    assertFuzzyEq(leverage, 3, 0.001);
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
