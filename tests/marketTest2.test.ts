import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import Decimal from 'decimal.js';
import BN from 'bn.js';
import {
  DEFAULT_RECENT_SLOT_DURATION_MS,
  getBorrowRate,
  getReserveFromMintAndMarket,
  KaminoAction,
  KaminoMarket,
  PROGRAM_ID,
  sleep,
  STAGING_PROGRAM_ID,
  U64_MAX,
  WRAPPED_SOL_MINT,
} from '../src';
import * as assert from 'assert';
import {
  buildAndSendTxnWithLogs,
  VanillaObligation,
  sendTransactionV0,
  buildVersionedTransaction,
  sendAndConfirmVersionedTransaction,
} from '../src';
import {
  ConfigParams,
  DefaultConfigParams,
  borrow,
  createLookupTable,
  createMarketWithTwoReserves,
  deposit,
  endpointFromCluster,
  initEnv,
  makeReserveConfig,
  newUser,
  sendTransactionsFromAction,
} from './runner/setup_utils';
import {
  createMarket,
  createReserve,
  updateMarketElevationGroup,
  updateReserve,
  updateReserveSingleValue,
} from './runner/setup_operations';
import { createAta, createMint, mintTo } from './runner/token_utils';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { ReserveConfig, UpdateConfigMode } from '../src/idl_codegen/types';
import { Fraction } from '../src/classes/fraction';

const assertAlmostEqual = (v1: number, v2: number, epsilon_pct = 1) => {
  const res = (Math.abs(v1 - v2) / v1) * 100 <= epsilon_pct;
  if (!res) {
    console.log(`assertAlmostEqual failed: ${v1} vs ${v2}`);
    assert.ok(res);
  }
};

describe('Main lending market instruction tests', function () {
  it('performs_a_deposit_and_borrow_same_tx_with_elevation_group', async function () {
    const borrowSymbol = 'USDH';
    const depositSymbol = 'SOL';
    const depositAmount = new BN('100000');
    const borrowAmount = new BN('10');

    const env = await initEnv('localnet');

    await sleep(2000);

    const [createMarketSig, lendingMarket] = await createMarket(env);
    console.log(createMarketSig);

    const usdh = await createMint(env, env.admin.publicKey, 6);
    await sleep(2000);
    const [, usdhReserve] = await createReserve(env, lendingMarket.publicKey, usdh);
    const [, solReserve] = await createReserve(env, lendingMarket.publicKey, NATIVE_MINT);

    await sleep(2000);

    await updateMarketElevationGroup(env, lendingMarket.publicKey, usdhReserve.publicKey);
    await sleep(2000);

    const borrowLimitAgainstThisCollateralInElevationGroup = [...Array(32)].map(() => new BN(0));
    borrowLimitAgainstThisCollateralInElevationGroup[0] = new BN(1000000000);

    await updateReserve(
      env,
      solReserve.publicKey,
      new ReserveConfig({
        ...makeReserveConfig(depositSymbol),
        borrowLimitAgainstThisCollateralInElevationGroup,
        elevationGroups: [1, 0, 0, 0, 0],
      })
    );
    await sleep(2000);
    await updateReserve(
      env,
      usdhReserve.publicKey,
      new ReserveConfig({
        ...makeReserveConfig(borrowSymbol),
        elevationGroups: [1, 0, 0, 0, 0],
      })
    );

    await sleep(2000);

    const kaminoMarket = (await KaminoMarket.load(
      env.connection,
      lendingMarket.publicKey,
      DEFAULT_RECENT_SLOT_DURATION_MS,
      PROGRAM_ID,
      true
    ))!;

    const depositor = Keypair.generate();
    await env.connection.requestAirdrop(depositor.publicKey, 10 * LAMPORTS_PER_SOL);
    await sleep(2000);

    const [, usdhAta] = await createAta(env, depositor.publicKey, usdh);
    await sleep(2000);
    await mintTo(env, usdh, usdhAta, 1000_000000);
    await sleep(2000);

    const kaminoDepositAction = await KaminoAction.buildDepositTxns(
      kaminoMarket,
      borrowAmount.mul(new BN(10)),
      usdh,
      depositor.publicKey,
      new VanillaObligation(PROGRAM_ID)
    );

    const depositTx = await buildVersionedTransaction(env.connection, depositor.publicKey, [
      ...kaminoDepositAction.setupIxs,
      ...kaminoDepositAction.lendingIxs,
      ...kaminoDepositAction.cleanupIxs,
    ]);
    const _depositTxHash = await buildAndSendTxnWithLogs(env.connection, depositTx, depositor, []);

    const kaminoDepositAndBorrowAction = await KaminoAction.buildDepositAndBorrowTxns(
      kaminoMarket,
      depositAmount,
      NATIVE_MINT,
      borrowAmount,
      usdh,
      env.admin.publicKey,
      new VanillaObligation(PROGRAM_ID),
      1_400_000,
      true,
      true
    );
    console.log('kaminoDepositAndBorrowAction.setupIxs', kaminoDepositAndBorrowAction.setupIxsLabels);
    console.log('kaminoDepositAndBorrowAction.lendingIxs', kaminoDepositAndBorrowAction.lendingIxsLabels);
    console.log('kaminoDepositAndBorrowAction.inBetweenIxs', kaminoDepositAndBorrowAction.inBetweenIxsLabels);
    console.log('kaminoDepositAndBorrowAction.cleanupIxs', kaminoDepositAndBorrowAction.cleanupIxsLabels);

    const ixs: TransactionInstruction[] = [];
    ixs.push(
      ...kaminoDepositAndBorrowAction.setupIxs,
      ...[kaminoDepositAndBorrowAction.lendingIxs[0]],
      ...kaminoDepositAndBorrowAction.inBetweenIxs,
      ...[kaminoDepositAndBorrowAction.lendingIxs[1]],
      ...kaminoDepositAndBorrowAction.cleanupIxs
    );

    const lookupTable = await createLookupTable(
      env,
      ixs
        .map((ixn) => ixn.keys)
        .flat()
        .map((key) => key.pubkey)
    );
    await sleep(2000);

    const tx = await buildVersionedTransaction(env.connection, depositor.publicKey, ixs, [...[], lookupTable]);
    tx.sign([depositor]);
    tx.sign([env.admin]);

    await sendAndConfirmVersionedTransaction(env.connection, tx, 'confirmed');

    await sleep(2000);

    const slot = await env.connection.getSlot();

    const obligation = await kaminoMarket.getObligationByWallet(env.admin.publicKey, new VanillaObligation(PROGRAM_ID));
    assert.equal(obligation?.state.elevationGroup, 1);
    assert.equal(obligation?.getNumberOfPositions(), 2);
    assert.equal(obligation?.refreshedStats.potentialElevationGroupUpdate, 0);

    const prevStats = obligation!.refreshedStats;

    const { stats: newStatsPostDeposit } = obligation!.getSimulatedObligationStats({
      amountCollateral: new Decimal(500),
      action: 'deposit',
      mintCollateral: WRAPPED_SOL_MINT,
      market: kaminoMarket,
      reserves: kaminoMarket.reserves,
      slot,
    });

    assert.ok(newStatsPostDeposit.loanToValue < prevStats.loanToValue);

    const { stats: newStatsPostWithdraw } = obligation!.getSimulatedObligationStats({
      amountCollateral: new Decimal(500),
      action: 'withdraw',
      mintCollateral: WRAPPED_SOL_MINT,
      market: kaminoMarket,
      reserves: kaminoMarket.reserves,
      slot,
    });

    assert.ok(newStatsPostWithdraw.loanToValue > prevStats.loanToValue);

    const { stats: newStatsPostBorrow } = obligation!.getSimulatedObligationStats({
      amountDebt: new Decimal(500),
      action: 'borrow',
      mintDebt: usdh,
      market: kaminoMarket,
      reserves: kaminoMarket.reserves,
      slot,
    });

    assert.ok(newStatsPostBorrow.loanToValue > prevStats.loanToValue);

    const { stats: newStatsPostRepay } = obligation!.getSimulatedObligationStats({
      amountDebt: new Decimal(500),
      action: 'repay',
      mintDebt: usdh,
      market: kaminoMarket,
      reserves: kaminoMarket.reserves,
      slot,
    });

    assert.ok(newStatsPostRepay.loanToValue < prevStats.loanToValue);
  });
});
