import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  TransactionSignature,
} from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';

import {
  initLendingMarket,
  InitLendingMarketAccounts,
  InitLendingMarketArgs,
  initReserve,
  InitReserveAccounts,
  KaminoAction,
  KaminoMarket,
  KaminoReserve,
  LendingMarket,
  lendingMarketAuthPda,
  Reserve,
  reservePdas,
  sleep,
  updateLendingMarket,
  UpdateLendingMarketAccounts,
  UpdateLendingMarketArgs,
  updateReserveConfig,
  UpdateReserveConfigAccounts,
  UpdateReserveConfigArgs,
  updateReserveConfigEncodedValue,
} from '../../src';
import { buildAndSendTxnWithLogs, buildVersionedTransaction } from '../../src/utils';
import { Env } from './setup_utils';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ElevationGroupFields, ReserveConfig, UpdateConfigMode } from '../../src/idl_codegen/types';
import { BN } from '@coral-xyz/anchor';
import { createAddExtraComputeUnitsIx } from '@kamino-finance/kliquidity-sdk';

export async function createMarket(env: Env): Promise<[TransactionSignature, Keypair]> {
  const args: InitLendingMarketArgs = {
    quoteCurrency: Array(32).fill(0),
  };

  const marketAccount = Keypair.generate();
  const size = LendingMarket.layout.span + 8;
  const [lendingMarketAuthority, _] = lendingMarketAuthPda(marketAccount.publicKey, env.program.programId);
  const createMarketIx = SystemProgram.createAccount({
    fromPubkey: env.admin.publicKey,
    newAccountPubkey: marketAccount.publicKey,
    lamports: await env.connection.getMinimumBalanceForRentExemption(size),
    space: size,
    programId: env.program.programId,
  });

  const accounts: InitLendingMarketAccounts = {
    lendingMarketOwner: env.admin.publicKey,
    lendingMarket: marketAccount.publicKey,
    lendingMarketAuthority: lendingMarketAuthority,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  };

  const ix = initLendingMarket(args, accounts);
  const tx = await buildVersionedTransaction(env.connection, env.admin.publicKey, [createMarketIx, ix]);

  const sig = await buildAndSendTxnWithLogs(
    env.connection,
    tx,
    env.admin,
    [marketAccount],
    undefined,
    'initLendingMarket'
  );
  return [sig, marketAccount];
}

export async function createReserve(
  env: Env,
  lendingMarket: PublicKey,
  liquidityMint: PublicKey,
  liquidityTokenProgram: PublicKey = TOKEN_PROGRAM_ID
): Promise<[TransactionSignature, Keypair]> {
  const reserveAccount = Keypair.generate();
  const size = Reserve.layout.span + 8;
  const [lendingMarketAuthority, _] = lendingMarketAuthPda(lendingMarket, env.program.programId);
  const createReserveIx = SystemProgram.createAccount({
    fromPubkey: env.admin.publicKey,
    newAccountPubkey: reserveAccount.publicKey,
    lamports: await env.connection.getMinimumBalanceForRentExemption(size),
    space: size,
    programId: env.program.programId,
  });

  const { liquiditySupplyVault, collateralMint, collateralSupplyVault, feeVault } = reservePdas(
    env.program.programId,
    lendingMarket,
    liquidityMint
  );

  const accounts: InitReserveAccounts = {
    lendingMarketOwner: env.admin.publicKey,
    lendingMarket: lendingMarket,
    lendingMarketAuthority: lendingMarketAuthority,
    reserve: reserveAccount.publicKey,
    reserveLiquidityMint: liquidityMint,
    reserveLiquiditySupply: liquiditySupplyVault,
    feeReceiver: feeVault,
    reserveCollateralMint: collateralMint,
    reserveCollateralSupply: collateralSupplyVault,
    collateralTokenProgram: TOKEN_PROGRAM_ID,
    liquidityTokenProgram,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  };

  const ix = initReserve(accounts);
  const tx = await buildVersionedTransaction(env.connection, env.admin.publicKey, [createReserveIx, ix]);

  const sig = await buildAndSendTxnWithLogs(env.connection, tx, env.admin, [reserveAccount], undefined, 'initReserve');
  return [sig, reserveAccount];
}

export async function updateReserveSingleValue(
  env: Env,
  reserve: KaminoReserve,
  value: Uint8Array,
  mode: number
): Promise<TransactionSignature> {
  await sleep(2000);

  const args: UpdateReserveConfigArgs = {
    mode: new anchor.BN(mode),
    value: value,
    skipValidation: false,
  };

  const accounts: UpdateReserveConfigAccounts = {
    lendingMarketOwner: env.admin.publicKey,
    lendingMarket: reserve.state.lendingMarket,
    reserve: reserve.address,
  };

  const ixs: TransactionInstruction[] = [];
  const budgetIx = createAddExtraComputeUnitsIx(300_000);
  ixs.push(budgetIx);
  ixs.push(updateReserveConfig(args, accounts));
  const tx = await buildVersionedTransaction(env.connection, env.admin.publicKey, ixs);

  const sig = await buildAndSendTxnWithLogs(env.connection, tx, env.admin, []);
  return sig;
}

export async function updateReserve(
  env: Env,
  reserve: PublicKey,
  config: ReserveConfig
): Promise<TransactionSignature> {
  await sleep(2000);
  const reserveState: Reserve = (await Reserve.fetch(env.connection, reserve))!;

  const layout = ReserveConfig.layout();
  const data = Buffer.alloc(1000);
  const len = layout.encode(config.toEncodable(), data);

  const args: UpdateReserveConfigArgs = {
    mode: new anchor.BN(25),
    value: new Uint8Array([...data.slice(0, len)]),
    skipValidation: false,
  };

  const accounts: UpdateReserveConfigAccounts = {
    lendingMarketOwner: env.admin.publicKey,
    lendingMarket: reserveState.lendingMarket,
    reserve: reserve,
  };

  const ixs: TransactionInstruction[] = [];
  const budgetIx = createAddExtraComputeUnitsIx(300_000);
  ixs.push(budgetIx);
  ixs.push(updateReserveConfig(args, accounts));
  const tx = await buildVersionedTransaction(env.connection, env.admin.publicKey, ixs);

  const sig = await buildAndSendTxnWithLogs(env.connection, tx, env.admin, [], undefined, 'updateReserve');
  return sig;
}

export async function updateReserveElevationGroups(
  env: Env,
  reserve: PublicKey,
  elevationGroups: number[]
): Promise<TransactionSignature> {
  await sleep(2000);
  const reserveState: Reserve = (await Reserve.fetch(env.connection, reserve))!;

  // Array of 20 u8
  const elevationGroupsData = new Uint8Array(20);
  for (let i = 0; i < elevationGroups.length; i++) {
    elevationGroupsData[i] = elevationGroups[i];
  }

  const args: UpdateReserveConfigArgs = {
    // TODO: revert the +1 when the enum is updated to be indexed at 0
    mode: new BN(UpdateConfigMode.UpdateElevationGroup.discriminator + 1),
    value: elevationGroupsData,
    skipValidation: false,
  };

  const accounts: UpdateReserveConfigAccounts = {
    lendingMarketOwner: env.admin.publicKey,
    lendingMarket: reserveState.lendingMarket,
    reserve: reserve,
  };

  const ixs: TransactionInstruction[] = [];
  const budgetIx = createAddExtraComputeUnitsIx(300_000);
  ixs.push(budgetIx);
  ixs.push(updateReserveConfig(args, accounts));
  const tx = await buildVersionedTransaction(env.connection, env.admin.publicKey, ixs);

  const sig = await buildAndSendTxnWithLogs(env.connection, tx, env.admin, [], undefined, 'updateReserve');
  return sig;
}

export const VALUE_BYTE_MAX_ARRAY_LEN_MARKET_UPDATE = 72;

export async function updateReserveLtv(
  env: Env,
  market: KaminoMarket,
  reserveAddress: PublicKey,
  ltvPct: number
): Promise<TransactionSignature> {
  // TODO: revert the +1 when the enum is updated to be indexed at 0
  const mode = UpdateConfigMode.UpdateLoanToValuePct.discriminator + 1;
  const value = updateReserveConfigEncodedValue(UpdateConfigMode.UpdateLoanToValuePct.discriminator, ltvPct);
  return updateReserveConfigSingle(env, market, reserveAddress, mode, value);
}

export async function updateReserveLiquidationLtv(
  env: Env,
  market: KaminoMarket,
  reserveAddress: PublicKey,
  ltvPct: number
): Promise<TransactionSignature> {
  // TODO: revert the +1 when the enum is updated to be indexed at 0
  const mode = UpdateConfigMode.UpdateLiquidationThresholdPct.discriminator + 1;
  const value = updateReserveConfigEncodedValue(UpdateConfigMode.UpdateLiquidationThresholdPct.discriminator, ltvPct);
  return updateReserveConfigSingle(env, market, reserveAddress, mode, value);
}

export async function updateReserveBorrowLimit(
  env: Env,
  market: KaminoMarket,
  reserveAddress: PublicKey,
  borrowLimit: number
): Promise<TransactionSignature> {
  // TODO: revert the +1 when the enum is updated to be indexed at 0
  const mode = UpdateConfigMode.UpdateBorrowLimit.discriminator + 1;
  const value = updateReserveConfigEncodedValue(UpdateConfigMode.UpdateBorrowLimit.discriminator, borrowLimit);

  return updateReserveConfigSingle(env, market, reserveAddress, mode, value);
}

export async function updateReserveBorrowLimitOutsideEmode(
  env: Env,
  market: KaminoMarket,
  reserveAddress: PublicKey,
  borrowLimit: number
): Promise<TransactionSignature> {
  // TODO: revert the +1 when the enum is updated to be indexed at 0
  const mode = UpdateConfigMode.UpdateBorrowLimitOutsideElevationGroup.discriminator + 1;
  const value = updateReserveConfigEncodedValue(
    UpdateConfigMode.UpdateBorrowLimitOutsideElevationGroup.discriminator,
    borrowLimit
  );

  return updateReserveConfigSingle(env, market, reserveAddress, mode, value);
}

export async function updateReserveUtilizationCap(
  env: Env,
  market: KaminoMarket,
  reserveAddress: PublicKey,
  cap: number
): Promise<TransactionSignature> {
  // TODO: revert the +1 when the enum is updated to be indexed at 0
  const mode = UpdateConfigMode.UpdateBlockBorrowingAboveUtilization.discriminator + 1;
  const value = updateReserveConfigEncodedValue(
    UpdateConfigMode.UpdateBlockBorrowingAboveUtilization.discriminator,
    cap
  );

  return updateReserveConfigSingle(env, market, reserveAddress, mode, value);
}

export async function updateReserveBorrowLimitsAgainstCollInElevationGroup(
  env: Env,
  market: KaminoMarket,
  reserveAddress: PublicKey,
  limits: number[]
): Promise<TransactionSignature> {
  // TODO: revert the +1 when the enum is updated to be indexed at 0
  const mode = UpdateConfigMode.UpdateBorrowLimitsInElevationGroupAgainstThisReserve.discriminator + 1;
  const value = updateReserveConfigEncodedValue(
    UpdateConfigMode.UpdateBorrowLimitsInElevationGroupAgainstThisReserve.discriminator,
    limits
  );

  return updateReserveConfigSingle(env, market, reserveAddress, mode, value);
}

export async function updateReserveBorrowFactor(
  env: Env,
  market: KaminoMarket,
  reserveAddress: PublicKey,
  borrowFactorPct: number
): Promise<TransactionSignature> {
  // TODO: revert the +1 when the enum is updated to be indexed at 0
  const mode = UpdateConfigMode.UpdateBorrowFactor.discriminator + 1;
  const value = updateReserveConfigEncodedValue(UpdateConfigMode.UpdateBorrowFactor.discriminator, borrowFactorPct);

  return updateReserveConfigSingle(env, market, reserveAddress, mode, value);
}

export async function updateReserveDebtNetWithdrawalCap(
  env: Env,
  market: KaminoMarket,
  reserveAddress: PublicKey,
  capacity: number,
  lengthSettings: number
): Promise<TransactionSignature> {
  // TODO: revert the +1 when the enum is updated to be indexed at 0
  const mode = UpdateConfigMode.UpdateDebtWithdrawalCap.discriminator + 1;
  const value = updateReserveConfigEncodedValue(UpdateConfigMode.UpdateDebtWithdrawalCap.discriminator, [
    capacity,
    lengthSettings,
  ]);

  return updateReserveConfigSingle(env, market, reserveAddress, mode, value);
}

export async function updateReserveConfigSingle(
  env: Env,
  market: KaminoMarket,
  reserveAddress: PublicKey,
  modeDiscriminator: number,
  value: Uint8Array
): Promise<TransactionSignature> {
  const args: UpdateReserveConfigArgs = {
    mode: new anchor.BN(modeDiscriminator),
    value: value,
    skipValidation: false,
  };

  const accounts: UpdateReserveConfigAccounts = {
    lendingMarketOwner: market.state.lendingMarketOwner,
    lendingMarket: new PublicKey(market.address),
    reserve: reserveAddress,
  };

  const ix = updateReserveConfig(args, accounts, env.program.programId);
  const tx = await buildVersionedTransaction(env.connection, env.admin.publicKey, [ix]);

  const sig = await buildAndSendTxnWithLogs(env.connection, tx, env.admin, [], false, 'updateReserveConfigSingle');
  return sig;
}

export async function updateLendingMarketConfig(
  env: Env,
  market: KaminoMarket,
  mode: number,
  value: number[]
): Promise<TransactionSignature> {
  const args: UpdateLendingMarketArgs = {
    mode: new anchor.BN(mode),
    value: value,
  };

  const accounts: UpdateLendingMarketAccounts = {
    lendingMarketOwner: market.state.lendingMarketOwner,
    lendingMarket: new PublicKey(market.address),
  };

  const ix = updateLendingMarket(args, accounts);
  const tx = await buildVersionedTransaction(env.connection, env.admin.publicKey, [ix]);

  const sig = await buildAndSendTxnWithLogs(env.connection, tx, env.admin, [], false, 'updateLendingMarket');
  return sig;
}

export async function updateMarketElevationGroup(
  env: Env,
  market: PublicKey,
  debtReserve: PublicKey,
  elevationGroupConfig?: ElevationGroupFields
): Promise<TransactionSignature> {
  await sleep(2000);
  const marketState: LendingMarket = (await LendingMarket.fetch(env.connection, market))!;

  const elevationGroup: ElevationGroupFields = elevationGroupConfig ?? {
    maxLiquidationBonusBps: 100,
    id: 1,
    ltvPct: 90,
    liquidationThresholdPct: 95,
    allowNewLoans: 1,
    maxReservesAsCollateral: 255,
    padding0: 0,
    debtReserve,
    padding1: new Array(4).fill(new BN(0)),
  };

  const buffer = Buffer.alloc(VALUE_BYTE_MAX_ARRAY_LEN_MARKET_UPDATE);
  buffer.writeUInt16LE(elevationGroup.maxLiquidationBonusBps, 0);
  buffer.writeUInt8(elevationGroup.id, 2);
  buffer.writeUInt8(elevationGroup.ltvPct, 3);
  buffer.writeUInt8(elevationGroup.liquidationThresholdPct, 4);
  buffer.writeUInt8(elevationGroup.allowNewLoans, 5);
  buffer.writeUint8(elevationGroup.maxReservesAsCollateral, 6);
  buffer.writeUint8(elevationGroup.padding0, 7);
  const debtReserveBuffer = debtReserve.toBuffer();
  debtReserveBuffer.copy(buffer, 8, 0, 32);

  const args: UpdateLendingMarketArgs = {
    mode: new anchor.BN(9), // Elevation group enum value
    value: [...buffer],
  };

  const accounts: UpdateLendingMarketAccounts = {
    lendingMarketOwner: marketState.lendingMarketOwner,
    lendingMarket: market,
  };

  const ix = updateLendingMarket(args, accounts);
  const tx = await buildVersionedTransaction(env.connection, env.admin.publicKey, [ix]);

  const sig = await buildAndSendTxnWithLogs(env.connection, tx, env.admin, [], false, 'UpdateMarketElevationGroup');
  return sig;
}

export async function updateMarketReferralFeeBps(
  env: Env,
  market: PublicKey,
  referralFeeBps: number
): Promise<TransactionSignature> {
  await sleep(2000);
  const marketState: LendingMarket = (await LendingMarket.fetch(env.connection, market))!;

  const buffer = Buffer.alloc(VALUE_BYTE_MAX_ARRAY_LEN_MARKET_UPDATE);
  buffer.writeUInt16LE(referralFeeBps, 0);

  const args: UpdateLendingMarketArgs = {
    mode: new BN(10), // UpdateLendingMarketMode.UpdateReferralFeeBps.discriminator
    value: [...buffer],
  };

  const accounts: UpdateLendingMarketAccounts = {
    lendingMarketOwner: marketState.lendingMarketOwner,
    lendingMarket: market,
  };

  const ix = updateLendingMarket(args, accounts);
  const tx = await buildVersionedTransaction(env.connection, env.admin.publicKey, [ix]);

  const sig = await buildAndSendTxnWithLogs(env.connection, tx, env.admin, []);
  await sleep(2000);
  return sig;
}

export async function reloadReservesAndRefreshMarket(env: Env, kaminoMarket: KaminoMarket) {
  await kaminoMarket.reload();
  await refreshReserves(env, kaminoMarket);
  await sleep(2000);
  await kaminoMarket.reload();
}

export async function refreshReserves(env: Env, kaminoMarket: KaminoMarket) {
  const ixns = KaminoAction.getRefreshAllReserves(kaminoMarket, [...kaminoMarket.reserves.keys()]);

  const tx = await buildVersionedTransaction(env.connection, env.admin.publicKey, ixns);
  const txHash = await buildAndSendTxnWithLogs(env.connection, tx, env.admin, [], false, 'RefreshReserves');
  await env.connection.confirmTransaction(txHash, 'confirmed');
}
