/**
 * BACKEND - RECEITAS PREMIUM
 *
 * Responsável por:
 * - Criar pagamentos no Mercado Pago
 * - Receber webhooks de confirmação
 * - Salvar compras por dispositivo + pack
 * - Informar ao app o que foi comprado
 */

// ==============================
// IMPORTAÇÕES
// ==============================

// Framework HTTP
import express from "express";

// Permite acesso do app mobile (CORS)
import cors from "cors";

// Sistema de arquivos (usado como banco simples)
import fs from "fs";

// Variáveis de ambiente (.env)
import dotenv from "dotenv";

// SDK NOVA do Mercado Pago
import {
  MercadoPagoConfig,
  Preference,
  Payment,
} from "mercadopago";

// ==============================
// CONFIGURAÇÕES INICIAIS
// ==============================

// Carrega o .env
dotenv.config();

// Inicializa o servidor
const app = express();

// Permite receber JSON no body
app.use(express.json());

// Libera acesso externo (Expo Go / celular)
app.use(cors());

// ==============================
// MERCADO PAGO
// ==============================

/**
 * Cria o cliente do Mercado Pago
 * usando o token do .env
 */
const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

// ==============================
// "BANCO DE DADOS" (JSON)
// ==============================

/**
 * Arquivo que simula um banco de dados
 * Estrutura:
 * {
 *   "device_packId": {
 *     paid: true,
 *     paymentId: "...",
 *     date: "..."
 *   }
 * }
 */
const DB_FILE = "./db.json";

/**
 * Lê o banco do arquivo
 */
function readDB() {
  if (!fs.existsSync(DB_FILE)) return {};
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

/**
 * Salva dados no banco
 */
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ==============================
// CRIAR PAGAMENTO
// ==============================

/**
 * POST /create-payment
 *
 * Recebe do app:
 * - userId  → device_packId
 * - title   → nome do pack
 * - price   → valor do pack
 *
 * Retorna:
 * - init_point → URL do checkout
 */
app.post("/create-payment", async (req, res) => {
  try {
    const { userId, title, price } = req.body;

    // Validação básica
    if (!userId || !title || !price) {
      return res
        .status(400)
        .json({ error: "Dados obrigatórios ausentes" });
    }

    // Cria preferência de pagamento
    const preference = new Preference(mp);

    const response = await preference.create({
      body: {
        items: [
          {
            title,
            quantity: 1,
            unit_price: Number(price),
          },
        ],

        // Usado depois no webhook
        external_reference: userId,

        // URLs obrigatórias (podem ser ajustadas depois)
        back_urls: {
          success: "https://google.com",
          failure: "https://google.com",
        },

        // Retorno automático após aprovação
        auto_return: "approved",
      },
    });

    // Envia a URL de pagamento para o app
    res.json({ init_point: response.init_point });
  } catch (err) {
    console.error("Erro ao criar pagamento:", err);
    res.status(500).json({ error: "Falha ao criar pagamento" });
  }
});

// ==============================
// WEBHOOK MERCADO PAGO
// ==============================

/**
 * POST /webhook
 *
 * Chamado automaticamente pelo Mercado Pago
 * quando o status de um pagamento muda
 */
app.post("/webhook", async (req, res) => {
  try {
    // ID do pagamento enviado pelo MP
    const paymentId = req.body?.data?.id;

    // Se não houver ID, ignoramos
    if (!paymentId) return res.sendStatus(200);

    // Consulta detalhes do pagamento
    const payment = new Payment(mp);
    const result = await payment.get({ id: paymentId });

    // Se o pagamento foi aprovado
    if (result.status === "approved") {
      const userPackKey = result.external_reference;

      const db = readDB();

      // Marca como pago
      db[userPackKey] = {
        paid: true,
        paymentId,
        date: new Date().toISOString(),
      };

      writeDB(db);

      console.log("Pagamento aprovado:", userPackKey);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook:", err);
    res.sendStatus(500);
  }
});

// ==============================
// VERIFICAR PACK ESPECÍFICO
// ==============================

/**
 * GET /check/:userPackKey
 *
 * Usado pelo app para saber
 * se um pack específico já foi pago
 */
app.get("/check/:userPackKey", (req, res) => {
  const db = readDB();
  const paid =
    db[req.params.userPackKey]?.paid || false;

  res.json({ paid });
});

// ==============================
// LISTAR MEUS PACKS
// ==============================

/**
 * GET /my-packs/:userId
 *
 * Retorna todos os packs
 * comprados por um dispositivo
 */
app.get("/my-packs/:userId", (req, res) => {
  const db = readDB();
  const userId = req.params.userId;

  const packs = Object.keys(db)
    .filter(
      (key) => key.startsWith(userId) && db[key].paid
    )
    .map((key) => key.split("_")[1]);

  res.json({ packs });
});

// ==============================
// START DO SERVIDOR
// ==============================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});
