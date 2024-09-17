import { assert } from 'chai';
import {
  KaminoAction,
  PROGRAM_ID,
  U64_MAX,
  VanillaObligation,
  fuzzyEq,
  numberToLamportsDecimal,
  sleep,
} from '../../src';
import { getObligationFarmState, initializeFarmsForReserve } from '../runner/farms/farms_operations';
import {
  borrow,
  createMarketWithTwoReservesToppedUp,
  deposit,
  newUser,
  sendTransactionsFromAction,
} from '../runner/setup_utils';
import Decimal from 'decimal.js';
import { reloadReservesAndRefreshMarket, updateReserveSingleValue } from '../runner/setup_operations';
import { UpdateConfigMode } from '../../src/idl_codegen/types';

describe('init_and_refresh_farm_repay_tests', function () {
  it('init_refresh_farm_repay_coll_farm_only', async function () {
    const [collToken, debtToken] = ['USDH', 'USDC'];

    const { env, kaminoMarket } = await createMarketWithTwoReservesToppedUp(
      [collToken, new Decimal(5000.05)],
      [debtToken, new Decimal(5000.05)]
    );
    await reloadReservesAndRefreshMarket(env, kaminoMarket);
    const borrower = await newUser(env, kaminoMarket, [
      [collToken, new Decimal(2000)],
      [debtToken, new Decimal(0)],
    ]);

    await deposit(env, kaminoMarket, borrower, collToken, new Decimal(1500));
    await borrow(env, kaminoMarket, borrower, debtToken, new Decimal(1000));

    const collReserve = kaminoMarket.getReserveBySymbol(collToken)!;
    const debtReserve = kaminoMarket.getReserveBySymbol(debtToken)!;
    // adding both coll and debt farms to ensure none is causing problems (we will have both for points anyway)
    await initializeFarmsForReserve(env, kaminoMarket.getAddress(), collReserve.address, 'Collateral', false, false);
    await initializeFarmsForReserve(env, kaminoMarket.getAddress(), collReserve.address, 'Debt', false, false);
    await sleep(2000);

    await kaminoMarket.reload();
    const repayAction = await KaminoAction.buildRepayTxns(
      kaminoMarket,
      numberToLamportsDecimal(500, debtReserve.stats.decimals).floor().toString(),
      debtReserve.getLiquidityMint(),
      borrower.publicKey,
      new VanillaObligation(PROGRAM_ID),
      await env.connection.getSlot()
    );

    await sendTransactionsFromAction(env, repayAction, borrower, [borrower]);

    const obligation = (await kaminoMarket.getUserObligationsByTag(VanillaObligation.tag, borrower.publicKey))![0];
    const obligationFarmState = await getObligationFarmState(
      env,
      obligation,
      kaminoMarket.getReserveBySymbol(debtToken)!.state.farmDebt
    );
    assert.equal(obligationFarmState, null);
  });

  it('init_refresh_farm_repay_debt_farm', async function () {
    const [collToken, debtToken] = ['USDH', 'USDC'];

    const { env, kaminoMarket } = await createMarketWithTwoReservesToppedUp(
      [collToken, new Decimal(5000.05)],
      [debtToken, new Decimal(5000.05)]
    );
    await reloadReservesAndRefreshMarket(env, kaminoMarket);
    const borrower = await newUser(env, kaminoMarket, [
      [collToken, new Decimal(2000)],
      [debtToken, new Decimal(0)],
    ]);

    await deposit(env, kaminoMarket, borrower, collToken, new Decimal(1500));
    await borrow(env, kaminoMarket, borrower, debtToken, new Decimal(1000));

    const debtReserve = kaminoMarket.getReserveBySymbol(debtToken)!;
    // adding both coll and debt farms to ensure none is causing problems (we will have both for points anyway)
    await initializeFarmsForReserve(env, kaminoMarket.getAddress(), debtReserve.address, 'Collateral', false, false);
    await initializeFarmsForReserve(env, kaminoMarket.getAddress(), debtReserve.address, 'Debt', false, false);
    await sleep(2000);

    await kaminoMarket.reload();
    const repayAction = await KaminoAction.buildRepayTxns(
      kaminoMarket,
      numberToLamportsDecimal(500, debtReserve.stats.decimals).floor().toString(),
      debtReserve.getLiquidityMint(),
      borrower.publicKey,
      new VanillaObligation(PROGRAM_ID),
      await env.connection.getSlot()
    );

    await sendTransactionsFromAction(env, repayAction, borrower, [borrower]);
    await sleep(2000);

    const obligation = (await kaminoMarket.getUserObligationsByTag(VanillaObligation.tag, borrower.publicKey))![0];
    const obligationFarmState = await getObligationFarmState(
      env,
      obligation,
      kaminoMarket.getReserveBySymbol(debtToken)!.state.farmDebt
    );
    console.log(obligation.getBorrows()[0].amount.toNumber() / debtReserve.getMintFactor().toNumber());
    console.log(obligationFarmState?.activeStakeScaled.toNumber()! / debtReserve.getMintFactor().toNumber());
    // assertion diff comes from the way we calculate in sdk vs SC?
    assert.ok(
      fuzzyEq(
        obligation.getBorrows()[0].amount.toNumber() / debtReserve.getMintFactor().toNumber(),
        obligationFarmState?.activeStakeScaled.toNumber()! / debtReserve.getMintFactor().toNumber(),
        0.001
      )
    );
  });

  it('init_refresh_farm_repay_coll_farm_debt_farm', async function () {
    const [collToken, debtToken] = ['USDH', 'USDC'];

    const { env, kaminoMarket } = await createMarketWithTwoReservesToppedUp(
      [collToken, new Decimal(5000.05)],
      [debtToken, new Decimal(5000.05)]
    );
    await reloadReservesAndRefreshMarket(env, kaminoMarket);
    const borrower = await newUser(env, kaminoMarket, [
      [collToken, new Decimal(2000)],
      [debtToken, new Decimal(0)],
    ]);

    await deposit(env, kaminoMarket, borrower, collToken, new Decimal(1500));
    await borrow(env, kaminoMarket, borrower, debtToken, new Decimal(1000));

    const collReserve = kaminoMarket.getReserveBySymbol(collToken)!;
    const debtReserve = kaminoMarket.getReserveBySymbol(debtToken)!;
    // adding both coll and debt farms to ensure none is causing problems (we will have both for points anyway)
    await initializeFarmsForReserve(env, kaminoMarket.getAddress(), collReserve.address, 'Collateral', false, false);
    await initializeFarmsForReserve(env, kaminoMarket.getAddress(), collReserve.address, 'Debt', false, false);
    await initializeFarmsForReserve(env, kaminoMarket.getAddress(), debtReserve.address, 'Collateral', false, false);
    await initializeFarmsForReserve(env, kaminoMarket.getAddress(), debtReserve.address, 'Debt', false, false);
    await sleep(2000);

    await kaminoMarket.reload();
    const repayAction = await KaminoAction.buildRepayTxns(
      kaminoMarket,
      numberToLamportsDecimal(500, debtReserve.stats.decimals).floor().toString(),
      debtReserve.getLiquidityMint(),
      borrower.publicKey,
      new VanillaObligation(PROGRAM_ID),
      await env.connection.getSlot()
    );

    await sendTransactionsFromAction(env, repayAction, borrower, [borrower]);
    await sleep(2000);

    const obligation = (await kaminoMarket.getUserObligationsByTag(VanillaObligation.tag, borrower.publicKey))![0];
    const obligationFarmState = await getObligationFarmState(
      env,
      obligation,
      kaminoMarket.getReserveBySymbol(debtToken)!.state.farmDebt
    );
    console.log(obligation.getBorrows()[0].amount.toNumber() / debtReserve.getMintFactor().toNumber());
    console.log(obligationFarmState?.activeStakeScaled.toNumber()! / debtReserve.getMintFactor().toNumber());
    // assertion in lamports
    assert.ok(
      fuzzyEq(
        obligation.getBorrows()[0].amount.toNumber() / debtReserve.getMintFactor().toNumber(),
        obligationFarmState?.activeStakeScaled.toNumber()! / debtReserve.getMintFactor().toNumber(),
        0.002
      )
    );
  });

  it('init_refresh_farm_repay_sol_coll_farm_debt_farm', async function () {
    const [collToken, debtToken] = ['SOL', 'USDC'];

    const { env, kaminoMarket } = await createMarketWithTwoReservesToppedUp(
      [collToken, new Decimal(5000.05)],
      [debtToken, new Decimal(5000.05)]
    );
    await reloadReservesAndRefreshMarket(env, kaminoMarket);
    const borrower = await newUser(env, kaminoMarket, [
      [collToken, new Decimal(2000)],
      [debtToken, new Decimal(0)],
    ]);

    await deposit(env, kaminoMarket, borrower, collToken, new Decimal(100));
    await borrow(env, kaminoMarket, borrower, debtToken, new Decimal(1000));

    const collReserve = kaminoMarket.getReserveBySymbol(collToken)!;
    const debtReserve = kaminoMarket.getReserveBySymbol(debtToken)!;
    // adding both coll and debt farms to ensure none is causing problems (we will have both for points anyway)
    await initializeFarmsForReserve(env, kaminoMarket.getAddress(), collReserve.address, 'Collateral', false, false);
    await initializeFarmsForReserve(env, kaminoMarket.getAddress(), collReserve.address, 'Debt', false, false);
    await initializeFarmsForReserve(env, kaminoMarket.getAddress(), debtReserve.address, 'Collateral', false, false);
    await initializeFarmsForReserve(env, kaminoMarket.getAddress(), debtReserve.address, 'Debt', false, false);
    await sleep(2000);

    await kaminoMarket.reload();
    const repayAction = await KaminoAction.buildRepayTxns(
      kaminoMarket,
      numberToLamportsDecimal(500, debtReserve.stats.decimals).floor().toString(),
      debtReserve.getLiquidityMint(),
      borrower.publicKey,
      new VanillaObligation(PROGRAM_ID),
      await env.connection.getSlot()
    );

    await sendTransactionsFromAction(env, repayAction, borrower, [borrower]);
    await sleep(2000);

    const obligation = (await kaminoMarket.getUserObligationsByTag(VanillaObligation.tag, borrower.publicKey))![0];
    const obligationFarmState = await getObligationFarmState(
      env,
      obligation,
      kaminoMarket.getReserveBySymbol(debtToken)!.state.farmDebt
    );
    console.log(obligation.getBorrows()[0].amount.toNumber() / debtReserve.getMintFactor().toNumber());
    console.log(obligationFarmState?.activeStakeScaled.toNumber()! / debtReserve.getMintFactor().toNumber());
    // assertion in lamports
    assert.ok(
      fuzzyEq(
        obligation.getBorrows()[0].amount.toNumber() / debtReserve.getMintFactor().toNumber(),
        obligationFarmState?.activeStakeScaled.toNumber()! / debtReserve.getMintFactor().toNumber(),
        0.002
      )
    );
  });

  it('init_refresh_farm_repay_coll_farm_sol_debt_farm', async function () {
    const [collToken, debtToken] = ['USDH', 'SOL'];

    const { env, kaminoMarket } = await createMarketWithTwoReservesToppedUp(
      [collToken, new Decimal(5000.05)],
      [debtToken, new Decimal(5000.05)]
    );
    await reloadReservesAndRefreshMarket(env, kaminoMarket);
    const borrower = await newUser(env, kaminoMarket, [
      [collToken, new Decimal(2000)],
      [debtToken, new Decimal(0)],
    ]);

    await deposit(env, kaminoMarket, borrower, collToken, new Decimal(1000));
    await borrow(env, kaminoMarket, borrower, debtToken, new Decimal(10));

    const collReserve = kaminoMarket.getReserveBySymbol(collToken)!;
    const debtReserve = kaminoMarket.getReserveBySymbol(debtToken)!;
    // adding both coll and debt farms to ensure none is causing problems (we will have both in each reserve for points anyway)
    await initializeFarmsForReserve(env, kaminoMarket.getAddress(), collReserve.address, 'Collateral', false, false);
    await initializeFarmsForReserve(env, kaminoMarket.getAddress(), collReserve.address, 'Debt', false, false);
    await initializeFarmsForReserve(env, kaminoMarket.getAddress(), debtReserve.address, 'Collateral', false, false);
    await initializeFarmsForReserve(env, kaminoMarket.getAddress(), debtReserve.address, 'Debt', false, false);
    await sleep(2000);

    await kaminoMarket.reload();
    const repayAction = await KaminoAction.buildRepayTxns(
      kaminoMarket,
      numberToLamportsDecimal(5, debtReserve.stats.decimals).floor().toString(),
      debtReserve.getLiquidityMint(),
      borrower.publicKey,
      new VanillaObligation(PROGRAM_ID),
      await env.connection.getSlot()
    );

    await sendTransactionsFromAction(env, repayAction, borrower, [borrower]);
    await sleep(2000);

    const obligation = (await kaminoMarket.getUserObligationsByTag(VanillaObligation.tag, borrower.publicKey))![0];
    const obligationFarmState = await getObligationFarmState(
      env,
      obligation,
      kaminoMarket.getReserveBySymbol(debtToken)!.state.farmDebt
    );
    console.log(obligationFarmState?.activeStakeScaled.toNumber());
    // assertion in lamports
    assert.ok(
      fuzzyEq(
        obligation.getBorrows()[0].amount.toNumber() / debtReserve.getMintFactor().toNumber(),
        obligationFarmState?.activeStakeScaled.toNumber()! / debtReserve.getMintFactor().toNumber(),
        0.002
      )
    );
  });

  it('init_refresh_farm_repay_sol_coll_farm_debt_farm_with_elevation_group', async function () {
    const [collToken, debtToken] = ['SOL', 'USDC'];
    const amountToDeposit = new Decimal(2.5);
    const amountToBorrow = new Decimal(15);
    const amountToRepay = amountToBorrow;

    console.log('Setting up market ===');
    const { env, kaminoMarket } = await createMarketWithTwoReservesToppedUp(
      [collToken, new Decimal(1000.05)],
      [debtToken, new Decimal(1000.05)],
      true
    );

    const collReserve = kaminoMarket.getReserveBySymbol(collToken)!;
    const debtReserve = kaminoMarket.getReserveBySymbol(debtToken)!;

    await initializeFarmsForReserve(env, kaminoMarket.getAddress(), collReserve.address, 'Collateral', false, false);
    await initializeFarmsForReserve(env, kaminoMarket.getAddress(), debtReserve.address, 'Debt', false, false);

    console.log('Creating user ===');
    const borrower = await newUser(env, kaminoMarket, [
      [collToken, new Decimal(10)],
      [debtToken, new Decimal(10)],
    ]);

    console.log('Depositing coll ===');
    await sleep(1000);
    await deposit(env, kaminoMarket, borrower, collToken, amountToDeposit);

    const buffer = Buffer.alloc(8 * 32);
    buffer.writeBigUint64LE(BigInt(U64_MAX), 0);

    await updateReserveSingleValue(
      env,
      collReserve!,
      buffer,
      UpdateConfigMode.UpdateBorrowLimitsInElevationGroupAgainstThisReserve.discriminator + 1 // discriminator + 1 matches the enum
    );

    console.log('Borrowing debt ===');
    await sleep(1000);
    await borrow(env, kaminoMarket, borrower, debtToken, amountToBorrow, true);

    console.log('Repaying debt ===');

    await sleep(2000);

    const obligationBefore = (await kaminoMarket.getUserObligationsByTag(VanillaObligation.tag, borrower.publicKey))[0];

    assert(obligationBefore.state.elevationGroup === 1);

    const repayAction = await KaminoAction.buildRepayTxns(
      kaminoMarket,
      numberToLamportsDecimal(amountToRepay.add(1), debtReserve.stats.decimals).floor().toString(),
      debtReserve.getLiquidityMint(),
      borrower.publicKey,
      new VanillaObligation(PROGRAM_ID),
      await env.connection.getSlot(),
      undefined,
      undefined,
      undefined,
      true
    );

    await sendTransactionsFromAction(env, repayAction, borrower, [borrower]);
    await sleep(2000);

    await kaminoMarket.reload();

    const obligationAfter = (await kaminoMarket.getUserObligationsByTag(VanillaObligation.tag, borrower.publicKey))[0];

    assert(obligationAfter.loanToValue().equals(0));
    assert(obligationAfter.state.elevationGroup === 0);
  });
});
