/**
 * [EXAMPLE / REFERENCE CODE ONLY]
 * multiSig.js
 *
 * Standalone developer script demonstrating multi-signature withdrawal transactions.
 * Not used in production runtime. Production multisig logic is in backend/src/services/campaignMultisig.js.
 *
 * A withdrawal from a campaign wallet requires signatures from both
 * the campaign creator and the platform.
 *
 * Flow:
 *   1. Platform builds the unsigned XDR and stores it in DB
 *   2. Creator fetches and signs it (this script or frontend)
 *   3. Platform countersigns and submits
 *
 * Usage:
 *   node contracts/stellar/multiSig.js --build <walletPublicKey> <destPublicKey> <amount> <asset>
 *   node contracts/stellar/multiSig.js --sign <xdr> <signerSecret>
 *   node contracts/stellar/multiSig.js --submit <xdr>
 */

try {
  require("dotenv").config({
    path: require("path").join(__dirname, "../../backend/.env"),
  });
} catch {
  // dotenv is not installed for every checkout; the process env still works.
}

const {
  Keypair,
  TransactionBuilder,
  Transaction,
  Operation,
  Asset,
  BASE_FEE,
} = require("./sdk").loadStellarSdk();
const {
  getHorizonServer,
  getNetworkPassphrase,
  createUsdcAsset,
  resolveOptions,
} = require("./horizon");

// Authoritative values live in backend/src/config/constants.js
const TX_TIMEOUT_WITHDRAWAL_S = 300; // 5 minutes for standalone CLI script; backend uses 7-day TX_TIMEOUT_WITHDRAWAL_S

/**
 * Build the unsigned withdrawal transaction the creator signs.
 * Returns the built transaction; the caller decides what to do with the XDR.
 */
async function buildWithdrawal(
  walletPublicKey,
  destPublicKey,
  amount,
  assetCode,
  options = {},
) {
  const config = resolveOptions(options);
  const server = getHorizonServer(config);
  const account = await server.loadAccount(walletPublicKey);
  const asset = assetCode === "XLM" ? Asset.native() : createUsdcAsset(config);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(config),
  })
    .addOperation(
      Operation.payment({
        destination: destPublicKey,
        asset,
        amount: String(amount),
      }),
    )
    .setTimeout(TX_TIMEOUT_WITHDRAWAL_S)
    .build();

  console.log("Unsigned withdrawal XDR:");
  console.log(tx.toXDR());
  console.log("\nShare this XDR with the campaign creator to sign.");

  return tx;
}

/** Add one signature and return the signed XDR. */
function signTransaction(xdr, signerSecret, options = {}) {
  const config = resolveOptions(options);
  const tx = new Transaction(xdr, getNetworkPassphrase(config));
  const keypair = Keypair.fromSecret(signerSecret);
  tx.sign(keypair);
  const signed = tx.toXDR();
  console.log("Signed XDR:");
  console.log(signed);
  return signed;
}

/** Add the platform signature and submit. */
async function submitTransaction(xdr, options = {}) {
  const config = resolveOptions(options);
  const server = getHorizonServer(config);
  const tx = new Transaction(xdr, getNetworkPassphrase(config));
  const platformKeypair = Keypair.fromSecret(
    config.platformSecret || process.env.PLATFORM_SECRET_KEY,
  );
  tx.sign(platformKeypair);

  const result = await server.submitTransaction(tx);
  console.log("Withdrawal submitted.");
  console.log("Tx hash:", result.hash);
  return result;
}

function createClient(options = {}) {
  return {
    buildWithdrawal: (...args) => buildWithdrawal(...args, options),
    signTransaction: (...args) => signTransaction(...args, options),
    submitTransaction: (...args) => submitTransaction(...args, options),
    getServer: (overrides) => getHorizonServer({ ...options, ...overrides }),
  };
}

if (require.main === module) {
  const [, , flag, ...args] = process.argv;

  if (flag === "--build")
    buildWithdrawal(args[0], args[1], args[2], args[3]).catch(console.error);
  else if (flag === "--sign") signTransaction(args[0], args[1]);
  else if (flag === "--submit") submitTransaction(args[0]).catch(console.error);
  else {
    console.log("Usage:");
    console.log(
      "  node multiSig.js --build <walletPublicKey> <destPublicKey> <amount> <asset>",
    );
    console.log("  node multiSig.js --sign <xdr> <signerSecret>");
    console.log("  node multiSig.js --submit <signedXdr>");
  }
}

module.exports = {
  TX_TIMEOUT_WITHDRAWAL_S,
  buildWithdrawal,
  signTransaction,
  submitTransaction,
  createClient,
  getServer: getHorizonServer,
};
