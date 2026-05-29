import { rpc, TransactionBuilder, Networks, Operation, BASE_FEE, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { validateQuery, getUserDataQuerySchema, reportValidationError } from "./validation.js";

const CONTRACT_ID = "CAIYBGMKSA5V5EYUFKGD5OCWWS5M34YC7MKUKE3BOQE2WZP3R7A4S2D2";
const RPC_URL = "https://soroban-testnet.stellar.org";

export default async function handler(req, res) {
  // Solo aceptamos GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  let address;
  try {
    const validated = validateQuery(getUserDataQuerySchema, req.query || {});
    address = validated.address;
  } catch (error) {
    return reportValidationError(res, error);
  }

  try {
    const server = new rpc.Server(RPC_URL);
    
    // 1. Obtenemos la cuenta para poder armar la transacción de lectura
    let account;
    try {
      account = await server.getAccount(address);
    } catch (e) {
      // Si la cuenta no existe en la red (wallet nueva sin fondear), el balance es 0
      return res.status(200).json({ totalXlmDeposited: 0, depositCount: 0, nftLevel: 0 });
    }

    // 2. Armamos la transacción simulada apuntando a get_balance
    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: CONTRACT_ID,
          function: "get_balance",
          args: [
            nativeToScVal(address, { type: "address" })
          ],
        })
      )
      .setTimeout(30)
      .build();

    // 3. Ejecutamos la simulación
    const response = await server.simulateTransaction(transaction);

    let balanceXLM = 0;
    if (rpc.Api.isSimulationSuccess(response) && response.result) {
      const balanceInStroops = scValToNative(response.result.retval);
      balanceXLM = Number(balanceInStroops) / 10000000;
    }

    // --- LÓGICA DEL MOTOR DE NIVELES (El truco del hackathon) ---
    // Determinamos el Nivel del NFT basados en el XLM depositado.
    // Ajusta estos números (50, 150, 500) según la economía de tu app.
    let nftLevel = 0; // Bronce por defecto
    
    if (balanceXLM >= 50) nftLevel = 1;   // Plata
    if (balanceXLM >= 150) nftLevel = 2;  // Oro
    if (balanceXLM >= 500) nftLevel = 3;  // Platino
    if (balanceXLM >= 1000) nftLevel = 4; // Diamante

    // Simulamos la cantidad de depósitos para la UI 
    // (Si tiene saldo, asumimos al menos 1 depósito para que se vea actividad)
    let depositCount = balanceXLM > 0 ? 1 : 0;
    if (balanceXLM >= 150) depositCount = 3; 
    if (balanceXLM >= 500) depositCount = 10;

    // 4. Devolvemos los datos listos para que Perfil.tsx los pinte
    return res.status(200).json({
      totalXlmDeposited: balanceXLM,
      depositCount: depositCount,
      nftLevel: nftLevel
    });

  } catch (error) {
    console.error("Error consultando la blockchain:", error);
    return res.status(500).json({ error: 'Error al comunicarse con Soroban' });
  }
}