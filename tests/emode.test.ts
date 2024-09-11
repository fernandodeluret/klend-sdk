// Tests
// - [x] test getBorrowCapForReserve() -> BorrowCapsAndCounters is correctly calculated
// - [x] deposit and switch elevation group back and forth - with no debt
// - [x] deposit and switch elevation group back and forth - with debt
// - [x] borrow and switch elevation group back and forth - with no debt
// - [x] borrow and switch elevation group back and forth - with debt
// - [x] test isLoanEligibleForElevationGroup()
// - [x] test getElevationGroupsForObligation()
// - [ ] test getBorrowPower()
// - [ ] test getLiquidityAvailableForDebtReserveGivenCaps()
// - [ ] test getMaxBorrowAmountV2()
// - TODO: remove all the toString()
import { assert } from 'chai';
import {
  createMarket,
  updateMarketElevationGroup,
  updateReserveBorrowLimit,
  updateReserveBorrowLimitOutsideEmode,
  updateReserveBorrowLimitsAgainstCollInElevationGroup,
  updateReserveDebtNetWithdrawalCap,
  updateReserveElevationGroups,
  updateReserveLiquidationLtv,
  updateReserveLtv,
  updateReserveUtilizationCap,
} from './setup_operations';
import {
  addReserveToMarket,
  balances,
  borrow,
  deposit,
  initEnv,
  makeElevationGroupConfig,
  newUser,
  repay,
  sendTransactionsFromAction,
} from './setup_utils';
import { createScopeFeed } from './kamino/scope';
import { sleep } from '@kamino-finance/kliquidity-sdk';
import {
  BorrowCapsAndCounters,
  DEFAULT_RECENT_SLOT_DURATION_MS,
  KaminoAction,
  KaminoMarket,
  PROGRAM_ID,
  VanillaObligation,
} from '../src';
import Decimal from 'decimal.js';
import { assertFuzzyEq } from './assert';

describe('isolated_and_cross_modes', () => {
  it('switch elevation group back and forth between 0 (default) and elevated one', async () => {
    const env = await initEnv('localnet');
    const [, market] = await createMarket(env);
    const kaminoMarket = (await KaminoMarket.load(
      env.connection,
      market.publicKey,
      DEFAULT_RECENT_SLOT_DURATION_MS,
      PROGRAM_ID,
      true
    ))!;

    await createScopeFeed(env, kaminoMarket.scope);
    await sleep(2000);

    // Create group between SOL and JITOSOL, with SOL debt
    // Create group between SOL and PyUSD, with PyUSD debt
    // Create group between USDC and PyUSD, with USDC debt

    const res = await Promise.all([
      addReserveToMarket(env, market, 'SOL'),
      addReserveToMarket(env, market, 'JITOSOL'),
      addReserveToMarket(env, market, 'USDC'),
      addReserveToMarket(env, market, 'PYUSD'),
    ]);

    const { reserve: solReservePk } = res[0];
    const { reserve: jitosolReservePk } = res[1];
    const { reserve: usdcReservePk } = res[2];
    const { reserve: pyusdReservePk } = res[3];

    const defaultElevationGroupNo = 0;
    const jitosolSolGroupNo = 1;
    const solPyusdGroupNo = 2;
    const pyusdUsdcGroupNo = 3;
    const jitosolSolGroup = makeElevationGroupConfig(solReservePk, jitosolSolGroupNo); // JITOSOL collateral, SOL debt
    const solPyusdGroup = makeElevationGroupConfig(pyusdReservePk, solPyusdGroupNo); // SOL collateral, PyUSD debt
    const pyusdUsdcGroup = makeElevationGroupConfig(usdcReservePk, pyusdUsdcGroupNo); // PyUSD collateral, USDC debt

    console.log('solReservePk', solReservePk.toString());
    console.log('usdcReservePk', usdcReservePk.toString());
    console.log('jitosolReservePk', jitosolReservePk.toString());
    console.log('pyusdReservePk', pyusdReservePk.toString());

    await Promise.all([
      updateMarketElevationGroup(env, market.publicKey, solReservePk, jitosolSolGroup),
      updateMarketElevationGroup(env, market.publicKey, pyusdReservePk, solPyusdGroup),
      updateMarketElevationGroup(env, market.publicKey, usdcReservePk, pyusdUsdcGroup),
    ]);

    await Promise.all([
      updateReserveElevationGroups(env, solReservePk, [jitosolSolGroupNo, solPyusdGroupNo]),
      updateReserveElevationGroups(env, jitosolReservePk, [jitosolSolGroupNo]),
      updateReserveElevationGroups(env, usdcReservePk, [pyusdUsdcGroupNo]),
      updateReserveElevationGroups(env, pyusdReservePk, [solPyusdGroupNo, pyusdUsdcGroupNo]),
    ]);

    //

    await kaminoMarket.reload();

    const user = await newUser(env, kaminoMarket, [
      ['SOL', new Decimal(10)],
      ['JITOSOL', new Decimal(10)],
      ['USDC', new Decimal(10)],
      ['PYUSD', new Decimal(10)],
    ]);

    await sleep(2000);
    const userBalances = await balances(env, user, kaminoMarket, ['SOL', 'JITOSOL', 'USDC', 'PYUSD']);
    console.log('userBalances', userBalances);

    await sleep(2000);
    await deposit(env, kaminoMarket, user, 'SOL', new Decimal(1), new VanillaObligation(PROGRAM_ID));

    let obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
    console.log('Obligation', 'Elevation Group', obligation?.state.elevationGroup);
    assert.equal(obligation.state.elevationGroup, defaultElevationGroupNo);

    // Try to switch to the elevation group 2
    const switchElevationGroupAction = await KaminoAction.buildRequestElevationGroupTxns(
      kaminoMarket,
      user.publicKey,
      obligation,
      solPyusdGroupNo
    );

    const sig = await sendTransactionsFromAction(env, switchElevationGroupAction, user);
    console.log('Switch Elevation Group', sig);

    obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
    console.log('Obligation', 'Elevation Group', obligation.state.elevationGroup);
    assert.equal(obligation.state.elevationGroup, solPyusdGroupNo);

    // Try to switch back to the elevation group 0
    const switchBackElevationGroupAction = await KaminoAction.buildRequestElevationGroupTxns(
      kaminoMarket,
      user.publicKey,
      obligation,
      defaultElevationGroupNo
    );

    const sig2 = await sendTransactionsFromAction(env, switchBackElevationGroupAction, user);
    console.log('Switch Back Elevation Group', sig2);

    obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
    console.log('Obligation', 'Elevation Group', obligation.state.elevationGroup);
    assert.equal(obligation.state.elevationGroup, defaultElevationGroupNo);
  });

  it('elevation group utils', async () => {
    const env = await initEnv('localnet');
    const [, market] = await createMarket(env);
    const kaminoMarket = (await KaminoMarket.load(
      env.connection,
      market.publicKey,
      DEFAULT_RECENT_SLOT_DURATION_MS,
      PROGRAM_ID,
      true
    ))!;

    const initAllElevationGroups = await kaminoMarket.getMarketElevationGroupDescriptions();
    assert.equal(initAllElevationGroups.length, 0);

    await createScopeFeed(env, kaminoMarket.scope);
    await sleep(2000);

    // Create group between SOL and JITOSOL, with SOL debt
    // Create group between SOL and PyUSD, with PyUSD debt
    // Create group between USDC and PyUSD, with USDC debt

    const res = await Promise.all([
      addReserveToMarket(env, market, 'SOL'),
      addReserveToMarket(env, market, 'JITOSOL'),
      addReserveToMarket(env, market, 'USDC'),
      addReserveToMarket(env, market, 'PYUSD'),
    ]);

    const { mint: solMint, reserve: solReservePk } = res[0];
    const { mint: jitosolMint, reserve: jitosolReservePk } = res[1];
    const { mint: usdcMint, reserve: usdcReservePk } = res[2];
    const { mint: pyusdMint, reserve: pyusdReservePk } = res[3];

    const jitosolSolGroupNo = 1;
    const solPyusdGroupNo = 2;
    const pyusdUsdcGroupNo = 3;
    const jitosolSolGroup = makeElevationGroupConfig(solReservePk, jitosolSolGroupNo); // SOL debt, JITOSOL collateral
    const solPyusdGroup = makeElevationGroupConfig(pyusdReservePk, solPyusdGroupNo); // PyUSD debt, SOL collateral
    const pyusdUsdcGroup = makeElevationGroupConfig(usdcReservePk, pyusdUsdcGroupNo); // USDC debt, PyUSD collateral

    console.log('solReservePk', solReservePk.toString());
    console.log('usdcReservePk', usdcReservePk.toString());
    console.log('jitosolReservePk', jitosolReservePk.toString());
    console.log('pyusdReservePk', pyusdReservePk.toString());

    await Promise.all([
      updateMarketElevationGroup(env, market.publicKey, solReservePk, jitosolSolGroup),
      updateMarketElevationGroup(env, market.publicKey, pyusdReservePk, solPyusdGroup),
      updateMarketElevationGroup(env, market.publicKey, usdcReservePk, pyusdUsdcGroup),
    ]);

    await Promise.all([
      updateReserveElevationGroups(env, solReservePk, [jitosolSolGroupNo, solPyusdGroupNo]),
      updateReserveElevationGroups(env, jitosolReservePk, [jitosolSolGroupNo]),
      updateReserveElevationGroups(env, usdcReservePk, [pyusdUsdcGroupNo]),
      updateReserveElevationGroups(env, pyusdReservePk, [solPyusdGroupNo, pyusdUsdcGroupNo]),
    ]);

    //

    await sleep(2000);
    await kaminoMarket.reload();

    const allElevationGroups = await kaminoMarket.getMarketElevationGroupDescriptions();

    const numElevationGroups = 3;
    assert.equal(allElevationGroups.length, numElevationGroups);

    const expectedElevationGroups = [
      {
        collateralReserves: [jitosolReservePk.toString()],
        collateralLiquidityMints: [jitosolMint.toString()],
        debtReserve: solReservePk.toString(),
        debtLiquidityMint: solMint.toString(),
        elevationGroup: jitosolSolGroupNo,
      },
      {
        collateralReserves: [solReservePk.toString()],
        collateralLiquidityMints: [solMint.toString()],
        debtReserve: pyusdReservePk.toString(),
        debtLiquidityMint: pyusdMint.toString(),
        elevationGroup: solPyusdGroupNo,
      },
      {
        collateralReserves: [pyusdReservePk.toString()],
        collateralLiquidityMints: [pyusdMint.toString()],
        debtReserve: usdcReservePk.toString(),
        debtLiquidityMint: usdcMint.toString(),
        elevationGroup: pyusdUsdcGroupNo,
      },
    ];

    for (let i = 0; i < numElevationGroups; i++) {
      assert.deepEqual(allElevationGroups[i], expectedElevationGroups[i]);
    }

    const solPyusd = kaminoMarket.getElevationGroupsForMintsCombination([solMint], pyusdMint);
    assert.equal(solPyusd.length, 1);
    assert.equal(solPyusd[0].elevationGroup, solPyusdGroupNo);

    const jitosolSol = kaminoMarket.getElevationGroupsForMintsCombination([jitosolMint], solMint);
    assert.equal(jitosolSol.length, 1);
    assert.equal(jitosolSol[0].elevationGroup, jitosolSolGroupNo);

    const pyusdUsdc = kaminoMarket.getElevationGroupsForMintsCombination([pyusdMint], usdcMint);
    assert.equal(pyusdUsdc.length, 1);
    assert.equal(pyusdUsdc[0].elevationGroup, pyusdUsdcGroupNo);

    const usdcPyusd = kaminoMarket.getElevationGroupsForMintsCombination([usdcMint], pyusdMint);
    assert.equal(usdcPyusd.length, 0);

    const jitosolPyUsd = kaminoMarket.getElevationGroupsForMintsCombination([jitosolMint], pyusdMint);
    assert.equal(jitosolPyUsd.length, 0);

    const jitosolUsdc = kaminoMarket.getElevationGroupsForMintsCombination([jitosolMint], usdcMint);
    assert.equal(jitosolUsdc.length, 0);

    const jitosolDebtSolColl = kaminoMarket.getElevationGroupsForMintsCombination([solMint], jitosolMint);
    assert.equal(jitosolDebtSolColl.length, 0);

    const solCollateralGroups = kaminoMarket.getElevationGroupsForMintsCombination([solMint], undefined);
    assert.equal(solCollateralGroups.length, 1);
  });

  it('loan elevation group eligibility', async () => {
    const env = await initEnv('localnet');
    const [, market] = await createMarket(env);
    const kaminoMarket = (await KaminoMarket.load(
      env.connection,
      market.publicKey,
      DEFAULT_RECENT_SLOT_DURATION_MS,
      PROGRAM_ID,
      true
    ))!;

    await createScopeFeed(env, kaminoMarket.scope);
    await sleep(2000);

    // Create group between SOL and JITOSOL, with SOL debt
    // Create group between SOL and PyUSD, with PyUSD debt
    // Create group between USDC and PyUSD, with USDC debt

    const res = await Promise.all([
      addReserveToMarket(env, market, 'SOL'),
      addReserveToMarket(env, market, 'JITOSOL'),
      addReserveToMarket(env, market, 'USDC'),
      addReserveToMarket(env, market, 'PYUSD'),
    ]);

    const { reserve: solReservePk } = res[0];
    const { reserve: jitosolReservePk } = res[1];
    const { reserve: usdcReservePk } = res[2];
    const { reserve: pyusdReservePk } = res[3];

    const defaultElevationGroupNo = 0;
    const jitosolSolGroupNo = 1;
    const solPyusdGroupNo = 2;
    const pyusdUsdcGroupNo = 3;
    const solUsdcGroupNo = 4;

    const jitosolSolGroup = makeElevationGroupConfig(solReservePk, jitosolSolGroupNo); // JITOSOL collateral, SOL debt,
    const solPyusdGroup = makeElevationGroupConfig(pyusdReservePk, solPyusdGroupNo); // SOL collateral, PyUSD debt,
    const pyusdUsdcGroup = makeElevationGroupConfig(usdcReservePk, pyusdUsdcGroupNo); // PyUSD collateral, USDC debt,
    const solUsdcGroup = makeElevationGroupConfig(usdcReservePk, solUsdcGroupNo); // SOL collateral, USDC debt,

    console.log('solReservePk', solReservePk.toString());
    console.log('usdcReservePk', usdcReservePk.toString());
    console.log('jitosolReservePk', jitosolReservePk.toString());
    console.log('pyusdReservePk', pyusdReservePk.toString());

    await Promise.all([
      updateMarketElevationGroup(env, market.publicKey, solReservePk, jitosolSolGroup),
      updateMarketElevationGroup(env, market.publicKey, pyusdReservePk, solPyusdGroup),
      updateMarketElevationGroup(env, market.publicKey, usdcReservePk, pyusdUsdcGroup),
      updateMarketElevationGroup(env, market.publicKey, usdcReservePk, solUsdcGroup),
    ]);

    await Promise.all([
      updateReserveElevationGroups(env, solReservePk, [jitosolSolGroupNo, solPyusdGroupNo, solUsdcGroupNo]),
      updateReserveElevationGroups(env, jitosolReservePk, [jitosolSolGroupNo]),
      updateReserveElevationGroups(env, usdcReservePk, [pyusdUsdcGroupNo, solUsdcGroupNo]),
      updateReserveElevationGroups(env, pyusdReservePk, [solPyusdGroupNo, pyusdUsdcGroupNo]),
    ]);

    //

    await sleep(2000);
    await kaminoMarket.reload();

    const user = await newUser(env, kaminoMarket, [
      ['SOL', new Decimal(10)],
      ['JITOSOL', new Decimal(10)],
      ['USDC', new Decimal(10)],
      ['PYUSD', new Decimal(10)],
    ]);

    await sleep(2000);

    await deposit(env, kaminoMarket, user, 'SOL', new Decimal(1), new VanillaObligation(PROGRAM_ID));
    await sleep(2000);

    const slot = await env.connection.getSlot();

    const obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;

    const eligibleGroups = await obligation.getElevationGroupsForObligation(kaminoMarket);
    assert.equal(eligibleGroups.length, 2);
    console.log('Eligible Groups', eligibleGroups);

    assert.equal(obligation.isLoanEligibleForElevationGroup(kaminoMarket, slot, jitosolSolGroupNo), false);
    assert.equal(obligation.isLoanEligibleForElevationGroup(kaminoMarket, slot, solPyusdGroupNo), true);
    assert.equal(obligation.isLoanEligibleForElevationGroup(kaminoMarket, slot, pyusdUsdcGroupNo), false);
    assert.equal(obligation.isLoanEligibleForElevationGroup(kaminoMarket, slot, solUsdcGroupNo), true);
    assert.equal(obligation.isLoanEligibleForElevationGroup(kaminoMarket, slot, defaultElevationGroupNo), true);
  });

  it('deposit / borrow and switch borrow cap', async () => {
    const env = await initEnv('localnet');
    const [, market] = await createMarket(env);
    const kaminoMarket = (await KaminoMarket.load(
      env.connection,
      market.publicKey,
      DEFAULT_RECENT_SLOT_DURATION_MS,
      PROGRAM_ID,
      true
    ))!;

    await createScopeFeed(env, kaminoMarket.scope);
    await sleep(2000);

    // Create group between SOL and JITOSOL, with SOL debt
    // Create group between SOL and PyUSD, with PyUSD debt
    // Create group between USDC and PyUSD, with USDC debt

    const res = await Promise.all([
      addReserveToMarket(env, market, 'SOL'),
      addReserveToMarket(env, market, 'JITOSOL'),
      addReserveToMarket(env, market, 'USDC'),
      addReserveToMarket(env, market, 'PYUSD'),
    ]);

    const { reserve: solReservePk } = res[0];
    const { reserve: jitosolReservePk } = res[1];
    const { reserve: usdcReservePk } = res[2];
    const { reserve: pyusdReservePk } = res[3];

    // const defaultElevationGroupNo = 0;
    const jitosolSolGroupNo = 1;
    const solPyusdGroupNo = 2;
    const pyusdUsdcGroupNo = 3;
    const solUsdcGroupNo = 4;

    const jitosolSolGroup = makeElevationGroupConfig(solReservePk, jitosolSolGroupNo); // JITOSOL collateral, SOL debt,
    const solPyusdGroup = makeElevationGroupConfig(pyusdReservePk, solPyusdGroupNo); // SOL collateral, PyUSD debt,
    const pyusdUsdcGroup = makeElevationGroupConfig(usdcReservePk, pyusdUsdcGroupNo); // PyUSD collateral, USDC debt,
    const solUsdcGroup = makeElevationGroupConfig(usdcReservePk, solUsdcGroupNo); // SOL collateral, USDC debt,

    console.log('solReservePk', solReservePk.toString());
    console.log('usdcReservePk', usdcReservePk.toString());
    console.log('jitosolReservePk', jitosolReservePk.toString());
    console.log('pyusdReservePk', pyusdReservePk.toString());

    await Promise.all([
      updateMarketElevationGroup(env, market.publicKey, solReservePk, jitosolSolGroup),
      updateMarketElevationGroup(env, market.publicKey, pyusdReservePk, solPyusdGroup),
      updateMarketElevationGroup(env, market.publicKey, usdcReservePk, pyusdUsdcGroup),
      updateMarketElevationGroup(env, market.publicKey, usdcReservePk, solUsdcGroup),
    ]);

    await Promise.all([
      updateReserveElevationGroups(env, solReservePk, [jitosolSolGroupNo, solPyusdGroupNo, solUsdcGroupNo]),
      updateReserveElevationGroups(env, jitosolReservePk, [jitosolSolGroupNo]),
      updateReserveElevationGroups(env, usdcReservePk, [pyusdUsdcGroupNo, solUsdcGroupNo]),
      updateReserveElevationGroups(env, pyusdReservePk, [solPyusdGroupNo, pyusdUsdcGroupNo]),
    ]);

    await updateReserveBorrowLimitsAgainstCollInElevationGroup(env, kaminoMarket, solReservePk, [0, 1_500_000_000]); // 1.5 SOL

    //

    await sleep(2000);
    await kaminoMarket.reload();

    const whale = await newUser(env, kaminoMarket, [['PYUSD', new Decimal(10)]]);
    await deposit(env, kaminoMarket, whale, 'PYUSD', new Decimal(10), new VanillaObligation(PROGRAM_ID));

    const user = await newUser(env, kaminoMarket, [
      ['SOL', new Decimal(10)],
      ['JITOSOL', new Decimal(10)],
      ['USDC', new Decimal(10)],
      ['PYUSD', new Decimal(10)],
    ]);

    await sleep(2000);

    {
      // No debt, No elevation group provided, defaults to 0
      await deposit(env, kaminoMarket, user, 'SOL', new Decimal(1), new VanillaObligation(PROGRAM_ID));
      await sleep(2000);
      const obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
      assert.equal(obligation.state.elevationGroup, 0);
    }

    {
      // No debt, Go to 0 explicitly, but it gets ignored
      await deposit(env, kaminoMarket, user, 'SOL', new Decimal(1), new VanillaObligation(PROGRAM_ID), false, true, 0);
      await sleep(2000);
      const obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
      assert.equal(obligation.state.elevationGroup, 0);
    }

    {
      // No debt, Go to 2
      await deposit(env, kaminoMarket, user, 'SOL', new Decimal(1), new VanillaObligation(PROGRAM_ID), false, true, 2);
      await sleep(2000);
      const obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
      assert.equal(obligation.state.elevationGroup, 2);
    }

    {
      // No debt, Go to 4
      await deposit(env, kaminoMarket, user, 'SOL', new Decimal(1), new VanillaObligation(PROGRAM_ID), false, true, 4);
      await sleep(2000);
      const obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
      assert.equal(obligation.state.elevationGroup, 4);
    }

    {
      // No debt, Back to 0
      await deposit(env, kaminoMarket, user, 'SOL', new Decimal(1), new VanillaObligation(PROGRAM_ID), false, true, 0);
      await sleep(2000);
      const obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
      assert.equal(obligation.state.elevationGroup, 0);
    }

    {
      // With debt, Stay at 0
      await borrow(env, kaminoMarket, user, 'PYUSD', new Decimal(0.1));
      await sleep(2000);
      const obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
      assert.equal(obligation.state.elevationGroup, 0);
    }

    {
      // With debt, Go to 2
      await borrow(env, kaminoMarket, user, 'PYUSD', new Decimal(0.1), true, undefined, 2);
      await sleep(2000);
      const obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
      assert.equal(obligation.state.elevationGroup, 2);
    }

    {
      // With debt, Go to back to 0
      await borrow(env, kaminoMarket, user, 'PYUSD', new Decimal(0.1), true, undefined, 0);
      await sleep(2000);
      const obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
      assert.equal(obligation.state.elevationGroup, 0);
    }
  });

  it('get borrow caps', async () => {
    const env = await initEnv('localnet');
    const [, market] = await createMarket(env);
    const kaminoMarket = (await KaminoMarket.load(
      env.connection,
      market.publicKey,
      DEFAULT_RECENT_SLOT_DURATION_MS,
      PROGRAM_ID,
      true
    ))!;

    await createScopeFeed(env, kaminoMarket.scope);
    await sleep(2000);

    // Create group between SOL and JITOSOL, with SOL debt
    // Create group between SOL and PyUSD, with PyUSD debt
    // Create group between USDC and PyUSD, with USDC debt

    const res = await Promise.all([
      addReserveToMarket(env, market, 'SOL'),
      addReserveToMarket(env, market, 'JITOSOL'),
      addReserveToMarket(env, market, 'USDC'),
      addReserveToMarket(env, market, 'PYUSD'),
    ]);

    const { reserve: solReservePk } = res[0];
    const { reserve: jitosolReservePk } = res[1];
    const { reserve: usdcReservePk } = res[2];
    const { reserve: pyusdReservePk } = res[3];

    // const defaultElevationGroupNo = 0;
    const jitosolSolGroupNo = 1;
    const solPyusdGroupNo = 2;
    const pyusdUsdcGroupNo = 3;
    const solUsdcGroupNo = 4;

    const jitosolSolGroup = makeElevationGroupConfig(solReservePk, jitosolSolGroupNo); // JITOSOL collateral, SOL debt,
    const solPyusdGroup = makeElevationGroupConfig(pyusdReservePk, solPyusdGroupNo); // SOL collateral, PyUSD debt,
    const pyusdUsdcGroup = makeElevationGroupConfig(usdcReservePk, pyusdUsdcGroupNo); // PyUSD collateral, USDC debt,
    const solUsdcGroup = makeElevationGroupConfig(usdcReservePk, solUsdcGroupNo); // SOL collateral, USDC debt,

    console.log('solReservePk', solReservePk.toString());
    console.log('usdcReservePk', usdcReservePk.toString());
    console.log('jitosolReservePk', jitosolReservePk.toString());
    console.log('pyusdReservePk', pyusdReservePk.toString());

    await Promise.all([
      updateMarketElevationGroup(env, market.publicKey, solReservePk, jitosolSolGroup),
      updateMarketElevationGroup(env, market.publicKey, pyusdReservePk, solPyusdGroup),
      updateMarketElevationGroup(env, market.publicKey, usdcReservePk, pyusdUsdcGroup),
      updateMarketElevationGroup(env, market.publicKey, usdcReservePk, solUsdcGroup),
    ]);

    await Promise.all([
      updateReserveElevationGroups(env, solReservePk, [jitosolSolGroupNo, solPyusdGroupNo, solUsdcGroupNo]),
      updateReserveElevationGroups(env, jitosolReservePk, [jitosolSolGroupNo]),
      updateReserveElevationGroups(env, usdcReservePk, [pyusdUsdcGroupNo, solUsdcGroupNo]),
      updateReserveElevationGroups(env, pyusdReservePk, [solPyusdGroupNo, pyusdUsdcGroupNo]),
    ]);

    await updateReserveBorrowLimit(env, kaminoMarket, solReservePk, 2_000_000_000); // 2.0 SOL
    await updateReserveBorrowLimitOutsideEmode(env, kaminoMarket, solReservePk, 1_500_000_000); // 1.5 SOL
    await updateReserveUtilizationCap(env, kaminoMarket, solReservePk, 80);
    await updateReserveBorrowLimitsAgainstCollInElevationGroup(env, kaminoMarket, jitosolReservePk, [500_000_000]); // 0.5 SOL
    await updateReserveDebtNetWithdrawalCap(env, kaminoMarket, solReservePk, 1_500_000_000, 500); // 1.5 SOL every 500 seconds

    await sleep(2000);
    await kaminoMarket.reload();

    const whale = await newUser(env, kaminoMarket, [['SOL', new Decimal(10)]]);
    await deposit(env, kaminoMarket, whale, 'SOL', new Decimal(10), new VanillaObligation(PROGRAM_ID));

    const user = await newUser(env, kaminoMarket, [
      ['SOL', new Decimal(10)],
      ['JITOSOL', new Decimal(10)],
      ['USDC', new Decimal(10)],
      ['PYUSD', new Decimal(10)],
    ]);

    await sleep(2000);

    await deposit(env, kaminoMarket, user, 'JITOSOL', new Decimal(5), new VanillaObligation(PROGRAM_ID));
    await borrow(env, kaminoMarket, user, 'SOL', new Decimal(1));

    await sleep(2000);
    await kaminoMarket.reload();
    await sleep(2000);

    const solReserve = kaminoMarket.getReserveByAddress(solReservePk);
    const borrowCaps = await solReserve!.getBorrowCapForReserve(kaminoMarket);

    console.log('Borrow Caps', borrowCaps);

    const expectedBorrowCaps: BorrowCapsAndCounters = {
      utilizationCap: new Decimal(0.8), // 80%
      utilizationCurrentValue: new Decimal(0.1), // 10%
      netWithdrawalCap: new Decimal(1500000000),
      netWithdrawalCurrentValue: new Decimal(1000000000),
      netWithdrawalLastUpdateTs: new Decimal(0),
      netWithdrawalIntervalDurationSeconds: new Decimal(500),
      globalDebtCap: new Decimal(2000000000),
      globalTotalBorrowed: new Decimal(1000000000),
      debtOutsideEmodeCap: new Decimal(1500000000),
      borrowedOutsideEmode: new Decimal(1000000000),
      debtAgainstCollateralReserveCaps: [
        {
          collateralReserve: jitosolReservePk,
          elevationGroup: 1,
          maxDebt: new Decimal(500000000),
          currentValue: new Decimal(0),
        },
      ],
    };

    assert(borrowCaps.utilizationCap.equals(expectedBorrowCaps.utilizationCap));
    assertFuzzyEq(borrowCaps.utilizationCurrentValue, expectedBorrowCaps.utilizationCurrentValue);

    assert(borrowCaps.netWithdrawalCap.equals(expectedBorrowCaps.netWithdrawalCap));
    assert(borrowCaps.netWithdrawalCurrentValue.equals(expectedBorrowCaps.netWithdrawalCurrentValue));
    // assert(borrowCaps.netWithdrawalLastUpdateTs.equals(expectedBorrowCaps.netWithdrawalLastUpdateTs));
    assert(
      borrowCaps.netWithdrawalIntervalDurationSeconds.equals(expectedBorrowCaps.netWithdrawalIntervalDurationSeconds)
    );

    assert(borrowCaps.globalDebtCap.equals(expectedBorrowCaps.globalDebtCap));
    assertFuzzyEq(borrowCaps.globalTotalBorrowed, expectedBorrowCaps.globalTotalBorrowed);

    assert(borrowCaps.debtOutsideEmodeCap.equals(expectedBorrowCaps.debtOutsideEmodeCap));
    assert(borrowCaps.borrowedOutsideEmode.equals(expectedBorrowCaps.borrowedOutsideEmode));

    for (let i = 0; i < borrowCaps.debtAgainstCollateralReserveCaps.length; i++) {
      const actual = borrowCaps.debtAgainstCollateralReserveCaps[i];
      const expected = expectedBorrowCaps.debtAgainstCollateralReserveCaps[i];
      assert(actual.collateralReserve.equals(expected.collateralReserve));
      assert(actual.elevationGroup === expected.elevationGroup);
      assert(actual.maxDebt.equals(expected.maxDebt));
      assert(actual.currentValue.equals(expected.currentValue));
    }
  });

  it('is loan eligible for elevation group ltv part', async () => {
    const env = await initEnv('localnet');
    const [, market] = await createMarket(env);
    const kaminoMarket = (await KaminoMarket.load(
      env.connection,
      market.publicKey,
      DEFAULT_RECENT_SLOT_DURATION_MS,
      PROGRAM_ID,
      true
    ))!;

    await createScopeFeed(env, kaminoMarket.scope);
    await sleep(2000);

    const res = await Promise.all([addReserveToMarket(env, market, 'SOL'), addReserveToMarket(env, market, 'JITOSOL')]);

    const { reserve: solReservePk } = res[0];
    const { reserve: jitosolReservePk } = res[1];
    console.log('solReservePk', solReservePk.toString());
    console.log('jitosolReservePk', jitosolReservePk.toString());

    const defaultElevationGroupNo = 0;
    const jitosolSolGroupNo = 1;
    const jitosolSolGroup = makeElevationGroupConfig(solReservePk, jitosolSolGroupNo); // JITOSOL collateral, SOL debt,
    await Promise.all([updateMarketElevationGroup(env, market.publicKey, solReservePk, jitosolSolGroup)]); // 90% ltv, 95% liq ltv
    await Promise.all([
      updateReserveElevationGroups(env, solReservePk, [jitosolSolGroupNo]),
      updateReserveElevationGroups(env, jitosolReservePk, [jitosolSolGroupNo]),
      updateReserveLtv(env, kaminoMarket, jitosolReservePk, 70),
      updateReserveLiquidationLtv(env, kaminoMarket, jitosolReservePk, 80),
      updateReserveBorrowLimitsAgainstCollInElevationGroup(env, kaminoMarket, jitosolReservePk, [10_000_000_000]), // 10 SOL
    ]);

    await kaminoMarket.reload();

    // await sleep(2000);

    const whale = await newUser(env, kaminoMarket, [['SOL', new Decimal(10)]]);
    await deposit(env, kaminoMarket, whale, 'SOL', new Decimal(10), new VanillaObligation(PROGRAM_ID));

    const user = await newUser(env, kaminoMarket, [
      ['SOL', new Decimal(10)],
      ['JITOSOL', new Decimal(10)],
    ]);

    const slot = await env.connection.getSlot();

    await sleep(2000);
    await deposit(env, kaminoMarket, user, 'JITOSOL', new Decimal(5), new VanillaObligation(PROGRAM_ID));

    await sleep(2000);
    let obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;

    assert.equal(obligation.isLoanEligibleForElevationGroup(kaminoMarket, slot, defaultElevationGroupNo), true);
    assert.equal(obligation.isLoanEligibleForElevationGroup(kaminoMarket, slot, jitosolSolGroupNo), true);

    const solReserve = kaminoMarket.getReserveByAddress(solReservePk);
    const jitosolReserve = kaminoMarket.getReserveByAddress(jitosolReservePk);

    console.log('SOL Price', solReserve?.tokenOraclePrice.price);
    console.log('JITOSOL Price', jitosolReserve?.tokenOraclePrice.price);

    await borrow(env, kaminoMarket, user, 'SOL', new Decimal(1), true, undefined, jitosolSolGroupNo);
    await sleep(2000);
    obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
    assert.equal(obligation.state.elevationGroup, jitosolSolGroupNo);
    assert.equal(obligation.isLoanEligibleForElevationGroup(kaminoMarket, slot, defaultElevationGroupNo), true);
    assertFuzzyEq(obligation.loanToValue(), new Decimal(0.2));

    // Now borrow more to go to 75% LTV
    await borrow(env, kaminoMarket, user, 'SOL', new Decimal(2.75), true, undefined, jitosolSolGroupNo);
    await sleep(2000);
    obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
    assert.equal(obligation.state.elevationGroup, jitosolSolGroupNo);
    assert.equal(obligation.isLoanEligibleForElevationGroup(kaminoMarket, slot, jitosolSolGroupNo), true);
    assert.equal(obligation.isLoanEligibleForElevationGroup(kaminoMarket, slot, defaultElevationGroupNo), false);
    assertFuzzyEq(obligation.loanToValue(), new Decimal(0.75));

    // Now repay to go below 70% LTV
    await repay(env, kaminoMarket, user, 'SOL', new Decimal(0.26));
    await sleep(2000);
    obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
    assert.equal(obligation.state.elevationGroup, jitosolSolGroupNo);
    assert.equal(obligation.isLoanEligibleForElevationGroup(kaminoMarket, slot, jitosolSolGroupNo), true);
    assert.equal(obligation.isLoanEligibleForElevationGroup(kaminoMarket, slot, defaultElevationGroupNo), true);
    assertFuzzyEq(obligation.loanToValue(), new Decimal(0.6979));
  });

  it('get borrow power', async () => {
    const env = await initEnv('localnet');
    const [, market] = await createMarket(env);
    const kaminoMarket = (await KaminoMarket.load(
      env.connection,
      market.publicKey,
      DEFAULT_RECENT_SLOT_DURATION_MS,
      PROGRAM_ID,
      true
    ))!;

    await createScopeFeed(env, kaminoMarket.scope);
    await sleep(2000);

    const res = await Promise.all([addReserveToMarket(env, market, 'SOL'), addReserveToMarket(env, market, 'JITOSOL')]);

    const { reserve: solReservePk, mint: solMint } = res[0];
    const { reserve: jitosolReservePk } = res[1];
    console.log('solReservePk', solReservePk.toString());
    console.log('jitosolReservePk', jitosolReservePk.toString());

    const jitosolSolGroupNo = 1;
    const jitosolSolGroup = makeElevationGroupConfig(solReservePk, jitosolSolGroupNo); // JITOSOL collateral, SOL debt,
    await Promise.all([updateMarketElevationGroup(env, market.publicKey, solReservePk, jitosolSolGroup)]); // 90% ltv, 95% liq ltv
    await Promise.all([
      updateReserveElevationGroups(env, solReservePk, [jitosolSolGroupNo]),
      updateReserveElevationGroups(env, jitosolReservePk, [jitosolSolGroupNo]),
      updateReserveLtv(env, kaminoMarket, jitosolReservePk, 70),
      updateReserveLiquidationLtv(env, kaminoMarket, jitosolReservePk, 80),
      updateReserveBorrowLimitsAgainstCollInElevationGroup(env, kaminoMarket, jitosolReservePk, [10_000_000_000]), // 10 SOL
    ]);

    await sleep(2000);

    await kaminoMarket.reload();
    const solReserve = kaminoMarket.getReserveByAddress(solReservePk)!;
    const jitosolReserve = kaminoMarket.getReserveByAddress(jitosolReservePk)!;
    console.log('SOL Price', solReserve.tokenOraclePrice.price);
    console.log('JITOSOL Price', jitosolReserve.tokenOraclePrice.price);

    const whale = await newUser(env, kaminoMarket, [['SOL', new Decimal(10)]]);
    await deposit(env, kaminoMarket, whale, 'SOL', new Decimal(10), new VanillaObligation(PROGRAM_ID));

    const user = await newUser(env, kaminoMarket, [
      ['SOL', new Decimal(10)],
      ['JITOSOL', new Decimal(10)],
    ]);

    const slot = await env.connection.getSlot();

    await sleep(2000);
    await deposit(env, kaminoMarket, user, 'JITOSOL', new Decimal(5), new VanillaObligation(PROGRAM_ID));

    await sleep(2000);
    const obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
    const borrowPowerInCrossMode = obligation.getBorrowPower(kaminoMarket, solMint, slot, 0);
    const borrowPowerInIsolatedMode = obligation.getBorrowPower(kaminoMarket, solMint, slot, 1);

    console.log('Borrow Power in Cross Mode', borrowPowerInCrossMode); // Expected 70% of 5 SOL = 3.5 SOL
    console.log('Borrow Power in Isolated Mode', borrowPowerInIsolatedMode); // Expected 90% of 5 SOL = 4.5 SOL

    const decimalsSol = solReserve.getMintFactor();

    assertFuzzyEq(borrowPowerInCrossMode.div(decimalsSol), new Decimal(3.5));
    assertFuzzyEq(borrowPowerInIsolatedMode.div(decimalsSol), new Decimal(4.5));
  });

  // Test to test function `getMaxLoanLtvGivenElevationGroup`
  it('get max loan ltv given elevation group', async () => {
    const env = await initEnv('localnet');
    const [, market] = await createMarket(env);
    const kaminoMarket = (await KaminoMarket.load(
      env.connection,
      market.publicKey,
      DEFAULT_RECENT_SLOT_DURATION_MS,
      PROGRAM_ID,
      true
    ))!;

    await createScopeFeed(env, kaminoMarket.scope);
    await sleep(2000);

    const res = await Promise.all([addReserveToMarket(env, market, 'SOL'), addReserveToMarket(env, market, 'JITOSOL')]);

    const { reserve: solReservePk } = res[0];
    const { reserve: jitosolReservePk } = res[1];
    console.log('solReservePk', solReservePk.toString());
    console.log('jitosolReservePk', jitosolReservePk.toString());

    const jitosolSolGroupNo = 1;
    const jitosolSolGroup = makeElevationGroupConfig(solReservePk, jitosolSolGroupNo); // JITOSOL collateral, SOL debt,
    await Promise.all([updateMarketElevationGroup(env, market.publicKey, solReservePk, jitosolSolGroup)]); // 90% ltv, 95% liq ltv
    await Promise.all([
      updateReserveElevationGroups(env, solReservePk, [jitosolSolGroupNo]),
      updateReserveElevationGroups(env, jitosolReservePk, [jitosolSolGroupNo]),
      updateReserveLtv(env, kaminoMarket, jitosolReservePk, 70),
      updateReserveLiquidationLtv(env, kaminoMarket, jitosolReservePk, 80),
      updateReserveBorrowLimitsAgainstCollInElevationGroup(env, kaminoMarket, jitosolReservePk, [10_000_000_000]), // 10 SOL
    ]);

    await sleep(2000);

    await kaminoMarket.reload();
    const solReserve = kaminoMarket.getReserveByAddress(solReservePk)!;
    const jitosolReserve = kaminoMarket.getReserveByAddress(jitosolReservePk)!;
    console.log('SOL Price', solReserve.tokenOraclePrice.price);
    console.log('JITOSOL Price', jitosolReserve.tokenOraclePrice.price);

    const whale = await newUser(env, kaminoMarket, [['SOL', new Decimal(10)]]);
    await deposit(env, kaminoMarket, whale, 'SOL', new Decimal(10), new VanillaObligation(PROGRAM_ID));

    const user = await newUser(env, kaminoMarket, [
      ['SOL', new Decimal(10)],
      ['JITOSOL', new Decimal(10)],
    ]);

    const slot = await env.connection.getSlot();

    await sleep(2000);
    await deposit(env, kaminoMarket, user, 'JITOSOL', new Decimal(5), new VanillaObligation(PROGRAM_ID));

    await sleep(2000);
    const obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
    const maxLtvInElevationGroup0 = obligation.getMaxLoanLtvGivenElevationGroup(kaminoMarket, 0, slot);
    const maxLtvInElevationGroup2 = obligation.getMaxLoanLtvGivenElevationGroup(kaminoMarket, 1, slot);

    console.log('Max LTV in Elevation Group 0', maxLtvInElevationGroup0); // Expected 90%
    console.log('Max LTV in Elevation Group 1', maxLtvInElevationGroup2); // Expected 70%

    assertFuzzyEq(maxLtvInElevationGroup0, new Decimal(0.7));
    assertFuzzyEq(maxLtvInElevationGroup2, new Decimal(0.9));
  });
});
