require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    options: '-c search_path=portaria',
});

const mailTransporter = process.env.SMTP_HOST
    ? nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT) || 587,
          secure: Number(process.env.SMTP_PORT) === 465,
          auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
          },
      })
    : null;

function resolverDataManual(valor) {
    if (!valor) return new Date();
    const dt = new Date(valor);
    return Number.isNaN(dt.getTime()) ? new Date() : dt;
}

async function enviarEmailEncomenda(encomenda) {
    if (!mailTransporter) return;

    try {
        const colabRes = await pool.query(
            `SELECT nome, email
             FROM colaboradores
             WHERE LOWER(TRIM(nome)) = LOWER(TRIM($1))
               AND email IS NOT NULL
               AND TRIM(email) <> ''
             LIMIT 1`,
            [encomenda.destinatario]
        );

        const colaborador = colabRes.rows[0];
        if (!colaborador) return;

        const dataFormatada = new Date(encomenda.data_chegada).toLocaleString('pt-BR', {
            timeZone: 'America/Belem',
        });

        const assunto = `📦 Encomenda recebida na Portaria (${encomenda.remetente || 'Novo volume'})`;

        const textoSimples =
            `Olá, ${colaborador.nome}!\n\n` +
            `Uma encomenda foi registrada para você na portaria.\n\n` +
            `• Remetente: ${encomenda.remetente || 'Não informado'}\n` +
            `• Volume / NF: ${encomenda.tipo_volume || 'Não informado'}\n` +
            `• Setor: ${encomenda.setor || '-'}\n` +
            `• Data / Hora: ${dataFormatada}\n\n` +
            `Por favor, compareça à portaria para realizar a retirada.`;

        const corpoHtml = `
            <div style="font-family: Arial, sans-serif; color: #0f172a; background-color: #ffffff; padding: 16px; max-width: 540px; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #0f172a; margin: 0 0 8px; font-size: 18px;">📦 Nova Encomenda na Portaria</h2>
                <p style="color: #0f172a; margin: 0 0 10px;">Olá, <strong>${colaborador.nome}</strong>!</p>
                <p style="color: #0f172a; margin: 0 0 14px;">Uma encomenda foi registrada para você na portaria:</p>
                <table style="width: 100%; border-collapse: collapse; margin: 12px 0 16px; font-size: 14px; background-color: #ffffff; color: #0f172a;">
                    <tr>
                        <td style="padding: 8px; border: 1px solid #cbd5e1; background-color: #f1f5f9; color: #0f172a; width: 35%;"><strong>Remetente</strong></td>
                        <td style="padding: 8px; border: 1px solid #cbd5e1; background-color: #ffffff; color: #0f172a;">${encomenda.remetente || 'Não informado'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border: 1px solid #cbd5e1; background-color: #f1f5f9; color: #0f172a;"><strong>Volume / NF</strong></td>
                        <td style="padding: 8px; border: 1px solid #cbd5e1; background-color: #ffffff; color: #0f172a;">${encomenda.tipo_volume || 'Não informado'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border: 1px solid #cbd5e1; background-color: #f1f5f9; color: #0f172a;"><strong>Setor</strong></td>
                        <td style="padding: 8px; border: 1px solid #cbd5e1; background-color: #ffffff; color: #0f172a;">${encomenda.setor || '-'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border: 1px solid #cbd5e1; background-color: #f1f5f9; color: #0f172a;"><strong>Data / Hora</strong></td>
                        <td style="padding: 8px; border: 1px solid #cbd5e1; background-color: #ffffff; color: #0f172a;">${dataFormatada}</td>
                    </tr>
                </table>
                <p style="font-size: 13px; color: #334155; margin: 0;">Por favor, compareça à portaria para realizar a retirada.</p>
            </div>
        `;

        await mailTransporter.sendMail({
            from: `"Sistema Portaria — Polo Segurança" <${process.env.SMTP_USER}>`,
            to: colaborador.email,
            subject: assunto,
            text: textoSimples,
            html: corpoHtml,
        });

        console.log(`E-mail de encomenda enviado para ${colaborador.email}`);
    } catch (err) {
        console.error('Falha ao enviar e-mail da encomenda:', err.message);
    }
}

// ================= LOGIN DO VIGILANTE =================
app.post('/api/login', async (req, res) => {
    const { usuario, senha } = req.body;
    if (!usuario || !String(usuario).trim() || !senha) {
        return res.status(400).json({ error: 'Informe usuário e senha.' });
    }
    try {
        const senhaHash = crypto.createHash('sha256').update(String(senha)).digest('hex');
        const result = await pool.query(
            `SELECT id, nome, usuario, perfil
             FROM vigilantes
             WHERE LOWER(usuario) = LOWER($1) AND senha_hash = $2 AND ativo = TRUE
             LIMIT 1`,
            [String(usuario).trim(), senhaHash]
        );
        if (!result.rows.length) {
            return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
        }
        res.json({ vigilante: result.rows[0] });
    } catch (err) {
        console.error('Erro em POST /api/login:', err);
        res.status(500).json({ error: 'Erro interno ao autenticar.' });
    }
});

// ================= BUSCA E CADASTRO DE COLABORADORES =================
app.get('/api/colaboradores', async (req, res) => {
    const termo = (req.query.q || '').trim();
    try {
        if (!termo) {
            const todos = await pool.query(
                'SELECT id, nome, departamento, matricula, email FROM colaboradores ORDER BY nome ASC LIMIT 50'
            );
            return res.json(todos.rows);
        }
        const result = await pool.query(
            `SELECT id, nome, departamento, matricula, email
             FROM colaboradores
             WHERE nome ILIKE $1
                OR COALESCE(matricula, '') ILIKE $1
                OR COALESCE(departamento, '') ILIKE $1
                OR COALESCE(email, '') ILIKE $1
             ORDER BY nome ASC
             LIMIT 50`,
            [`%${termo}%`]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Erro em GET /api/colaboradores:', err);
        res.status(500).json({ error: 'Erro interno ao buscar colaboradores.' });
    }
});

app.post('/api/colaboradores', async (req, res) => {
    const { nome, departamento, matricula, email } = req.body;
    if (!nome || !String(nome).trim()) {
        return res.status(400).json({ error: 'Nome do colaborador é obrigatório.' });
    }
    try {
        const result = await pool.query(
            `INSERT INTO colaboradores (nome, departamento, matricula, email)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [
                String(nome).trim(),
                departamento ? String(departamento).trim() : null,
                matricula ? String(matricula).trim() : null,
                email ? String(email).trim().toLowerCase() : null
            ]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Erro em POST /api/colaboradores:', err);
        res.status(500).json({ error: 'Erro interno ao cadastrar colaborador.' });
    }
});

app.delete('/api/colaboradores/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM colaboradores WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('Erro em DELETE /api/colaboradores/:id:', err);
        res.status(500).json({ error: 'Erro interno ao excluir colaborador.' });
    }
});

// ================= BUSCA E CADASTRO DE CARROS DA FROTA =================
app.get('/api/frotas', async (req, res) => {
    const termo = (req.query.q || '').trim();
    try {
        if (!termo) {
            const todos = await pool.query(
                'SELECT id, placa, modelo, km_atual FROM frotas_veiculos WHERE ativo = TRUE ORDER BY placa ASC LIMIT 50'
            );
            return res.json(todos.rows);
        }
        const result = await pool.query(
            `SELECT id, placa, modelo, km_atual
             FROM frotas_veiculos
             WHERE ativo = TRUE AND (placa ILIKE $1 OR modelo ILIKE $1)
             ORDER BY placa ASC
             LIMIT 50`,
            [`%${termo}%`]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Erro em GET /api/frotas:', err);
        res.status(500).json({ error: 'Erro interno ao buscar veículos da frota.' });
    }
});

app.post('/api/frotas', async (req, res) => {
    const { placa, modelo, km_atual } = req.body;
    if (!placa || !String(placa).trim() || !modelo || !String(modelo).trim()) {
        return res.status(400).json({ error: 'Placa e Modelo são obrigatórios.' });
    }
    try {
        const result = await pool.query(
            `INSERT INTO frotas_veiculos (placa, modelo, km_atual)
             VALUES ($1, $2, $3) RETURNING *`,
            [
                String(placa).trim().toUpperCase(),
                String(modelo).trim(),
                km_atual !== '' && km_atual !== null && km_atual !== undefined ? Number(km_atual) : null
            ]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Já existe um veículo cadastrado com essa placa.' });
        }
        console.error('Erro em POST /api/frotas:', err);
        res.status(500).json({ error: 'Erro interno ao cadastrar veículo.' });
    }
});

app.delete('/api/frotas/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM frotas_veiculos WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('Erro em DELETE /api/frotas/:id:', err);
        res.status(500).json({ error: 'Erro interno ao excluir veículo.' });
    }
});

// ================= ROTAS DE PEDESTRES =================
app.get('/api/pedestres', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM portaria_pedestres ORDER BY id DESC LIMIT 100');
        res.json(result.rows);
    } catch (err) {
        console.error('Erro em GET /api/pedestres:', err);
        res.status(500).json({ error: 'Erro interno ao listar pedestres.' });
    }
});

app.post('/api/pedestres', async (req, res) => {
    const {
        nome,
        documento,
        empresa,
        tipo,
        responsavel,
        departamento,
        destino,
        cracha,
        foto_cracha,
        observacao,
        registrado_por,
        data_entrada
    } = req.body;

    const ehVisitante = tipo === 'Visitante';
    const ehColab = tipo === 'Colaborador';

    if (!tipo || !String(tipo).trim()) {
        return res.status(400).json({ error: 'Tipo de pedestre é obrigatório.' });
    }

    if (!nome || !String(nome).trim()) {
        return res.status(400).json({ error: 'Nome é obrigatório.' });
    }

    if (ehVisitante) {
        if (!documento || !String(documento).trim()) {
            return res.status(400).json({ error: 'Documento (RG ou CPF) é obrigatório para Visitante.' });
        }
        if (!destino || !String(destino).trim()) {
            return res.status(400).json({ error: 'Destino é obrigatório para Visitante.' });
        }
    }

    try {
        const dataEntradaResolvida = resolverDataManual(data_entrada);
        const result = await pool.query(
            `INSERT INTO portaria_pedestres
                (nome, documento, empresa, tipo, responsavel, departamento, destino, cracha, foto_cracha, observacao, registrado_por, data_entrada)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING *`,
            [
                String(nome).trim(),
                ehColab ? null : (documento ? String(documento).trim() : null),
                ehColab ? null : (empresa ? String(empresa).trim() : null),
                String(tipo).trim(),
                ehColab ? null : (responsavel ? String(responsavel).trim() : null),
                ehColab ? (departamento ? String(departamento).trim() : null) : null,
                ehColab ? null : (destino ? String(destino).trim() : null),
                ehColab ? null : (cracha ? String(cracha).trim() : null),
                ehColab ? null : (foto_cracha || null),
                ehColab ? null : (observacao ? String(observacao).trim() : null),
                registrado_por ? String(registrado_por).trim() : 'Não informado',
                dataEntradaResolvida
            ]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Erro em POST /api/pedestres:', err);
        res.status(500).json({ error: 'Erro interno ao registrar pedestre.' });
    }
});

app.put('/api/pedestres/:id/saida', async (req, res) => {
    const { finalizado_por } = req.body || {};
    try {
        const result = await pool.query(
            `UPDATE portaria_pedestres
             SET data_saida = CURRENT_TIMESTAMP, status = 'FINALIZADO', finalizado_por = COALESCE($2, finalizado_por)
             WHERE id = $1 RETURNING *`,
            [req.params.id, finalizado_por || null]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Erro em PUT /api/pedestres/:id/saida:', err);
        res.status(500).json({ error: 'Erro interno ao registrar saída de pedestre.' });
    }
});

// ================= ROTAS DE VEÍCULOS / FROTAS =================
app.get('/api/veiculos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM portaria_veiculos ORDER BY id DESC LIMIT 100');
        res.json(result.rows);
    } catch (err) {
        console.error('Erro em GET /api/veiculos:', err);
        res.status(500).json({ error: 'Erro interno ao listar veículos.' });
    }
});

app.post('/api/veiculos', async (req, res) => {
    const {
        tipo_operacao,
        veiculo_frota_id,
        placa,
        modelo,
        motorista,
        destino_origem,
        km_inicial,
        observacao,
        registrado_por,
        data_entrada_saida
    } = req.body;
    const statusInicial = tipo_operacao === 'FROTA_SAIDA' ? 'EM_TRANSITO' : 'NO_PATIO';
    try {
        const dataMovResolvida = resolverDataManual(data_entrada_saida);
        const result = await pool.query(
            `INSERT INTO portaria_veiculos
                (tipo_operacao, veiculo_frota_id, placa, modelo, motorista, destino_origem, km_inicial, observacao, status, registrado_por, data_entrada_saida)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [
                tipo_operacao,
                veiculo_frota_id || null,
                String(placa).trim().toUpperCase(),
                String(modelo).trim(),
                String(motorista).trim(),
                destino_origem ? String(destino_origem).trim() : null,
                km_inicial !== '' && km_inicial !== null && km_inicial !== undefined ? Number(km_inicial) : null,
                observacao ? String(observacao).trim() : null,
                statusInicial,
                registrado_por ? String(registrado_por).trim() : 'Não informado',
                dataMovResolvida
            ]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Erro em POST /api/veiculos:', err);
        res.status(500).json({ error: 'Erro interno ao registrar movimentação de veículo.' });
    }
});

app.put('/api/veiculos/:id/finalizar', async (req, res) => {
    const { km_final, finalizado_por } = req.body || {};
    const kmFinalNum = km_final !== '' && km_final !== null && km_final !== undefined ? Number(km_final) : null;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE portaria_veiculos
             SET data_retorno_saida = CURRENT_TIMESTAMP, km_final = $1, status = 'FINALIZADO', finalizado_por = COALESCE($3, finalizado_por)
             WHERE id = $2 RETURNING *`,
            [kmFinalNum, req.params.id, finalizado_por || null]
        );
        const veiculo = result.rows[0];
        if (veiculo && veiculo.veiculo_frota_id && kmFinalNum !== null) {
            await client.query(
                'UPDATE frotas_veiculos SET km_atual = $1 WHERE id = $2',
                [kmFinalNum, veiculo.veiculo_frota_id]
            );
        }
        await client.query('COMMIT');
        res.json(veiculo);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erro em PUT /api/veiculos/:id/finalizar:', err);
        res.status(500).json({ error: 'Erro interno ao finalizar movimentação de veículo.' });
    } finally {
        client.release();
    }
});

// ================= ROTAS DE ENCOMENDAS =================
app.get('/api/encomendas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM portaria_encomendas ORDER BY id DESC LIMIT 100');
        res.json(result.rows);
    } catch (err) {
        console.error('Erro em GET /api/encomendas:', err);
        res.status(500).json({ error: 'Erro interno ao listar encomendas.' });
    }
});

app.post('/api/encomendas', async (req, res) => {
    const {
        destinatario,
        setor,
        remetente,
        tipo_volume,
        codigo_rastreio,
        porteiro_recebeu,
        registrado_por,
        data_chegada
    } = req.body;

    if (!destinatario || !String(destinatario).trim()) {
        return res.status(400).json({ error: 'Destinatário é obrigatório.' });
    }

    try {
        const dataChegadaResolvida = resolverDataManual(data_chegada);
        const result = await pool.query(
            `INSERT INTO portaria_encomendas
                (destinatario, setor, remetente, tipo_volume, codigo_rastreio, porteiro_recebeu, registrado_por, data_chegada)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [
                String(destinatario).trim(),
                setor ? String(setor).trim() : null,
                remetente ? String(remetente).trim() : null,
                tipo_volume ? String(tipo_volume).trim() : null,
                codigo_rastreio ? String(codigo_rastreio).trim() : null,
                porteiro_recebeu ? String(porteiro_recebeu).trim() : null,
                registrado_por ? String(registrado_por).trim() : 'Não informado',
                dataChegadaResolvida
            ]
        );

        const encomendaSalva = result.rows[0];
        enviarEmailEncomenda(encomendaSalva);

        res.status(201).json(encomendaSalva);
    } catch (err) {
        console.error('Erro em POST /api/encomendas:', err);
        res.status(500).json({ error: 'Erro interno ao registrar encomenda.' });
    }
});

app.put('/api/encomendas/:id/entregar', async (req, res) => {
    const { retirado_por, entregue_por } = req.body || {};
    try {
        const result = await pool.query(
            `UPDATE portaria_encomendas
             SET data_entrega = CURRENT_TIMESTAMP, retirado_por = $1, status = 'ENTREGUE', entregue_por = COALESCE($3, entregue_por)
             WHERE id = $2 RETURNING *`,
            [retirado_por, req.params.id, entregue_por || null]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Erro em PUT /api/encomendas/:id/entregar:', err);
        res.status(500).json({ error: 'Erro interno ao registrar entrega de encomenda.' });
    }
});

// ================= RELATÓRIO GERAL =================
app.get('/api/relatorios', async (req, res) => {
    const { dataInicio, dataFim, modulo = 'todos' } = req.query;
    try {
        const params = [];
        let filtroDataPed = '';
        let filtroDataVei = '';
        let filtroDataEnc = '';

        if (dataInicio) {
            params.push(`${dataInicio} 00:00:00`);
            const idxIni = `$${params.length}`;
            filtroDataPed += ` AND data_entrada >= ${idxIni}`;
            filtroDataVei += ` AND data_entrada_saida >= ${idxIni}`;
            filtroDataEnc += ` AND data_chegada >= ${idxIni}`;
        }
        if (dataFim) {
            params.push(`${dataFim} 23:59:59`);
            const idxFim = `$${params.length}`;
            filtroDataPed += ` AND data_entrada <= ${idxFim}`;
            filtroDataVei += ` AND data_entrada_saida <= ${idxFim}`;
            filtroDataEnc += ` AND data_chegada <= ${idxFim}`;
        }

        const linhas = [];

        if (modulo === 'todos' || modulo === 'pedestres') {
            const rPed = await pool.query(
                `SELECT id, 'Pedestre' AS modulo, nome AS descricao, tipo AS detalhe,
                        status, data_entrada AS data_evento,
                        COALESCE(registrado_por, 'Não informado') AS registrado_por,
                        COALESCE(finalizado_por, '-') AS acao_por
                 FROM portaria_pedestres
                 WHERE 1=1 ${filtroDataPed}
                 ORDER BY id DESC LIMIT 200`,
                params
            );
            linhas.push(...rPed.rows);
        }

        if (modulo === 'todos' || modulo === 'veiculos') {
            const rVei = await pool.query(
                `SELECT id, 'Veículo/Frota' AS modulo, (placa || ' - ' || modelo) AS descricao,
                        (tipo_operacao || ' (' || motorista || ')') AS detalhe,
                        status, data_entrada_saida AS data_evento,
                        COALESCE(registrado_por, 'Não informado') AS registrado_por,
                        COALESCE(finalizado_por, '-') AS acao_por
                 FROM portaria_veiculos
                 WHERE 1=1 ${filtroDataVei}
                 ORDER BY id DESC LIMIT 200`,
                params
            );
            linhas.push(...rVei.rows);
        }

        if (modulo === 'todos' || modulo === 'encomendas') {
            const rEnc = await pool.query(
                `SELECT id, 'Encomenda' AS modulo, destinatario AS descricao,
                        (remetente || ' - ' || tipo_volume) AS detalhe,
                        status, data_chegada AS data_evento,
                        COALESCE(registrado_por, 'Não informado') AS registrado_por,
                        COALESCE(entregue_por, '-') AS acao_por
                 FROM portaria_encomendas
                 WHERE 1=1 ${filtroDataEnc}
                 ORDER BY id DESC LIMIT 200`,
                params
            );
            linhas.push(...rEnc.rows);
        }

        linhas.sort((a, b) => new Date(b.data_evento) - new Date(a.data_evento));
        res.json(linhas);
    } catch (err) {
        console.error('Erro em GET /api/relatorios:', err);
        res.status(500).json({ error: 'Erro interno ao gerar relatório.' });
    }
});

// ================= CRUD DE VIGILANTES =================
app.get('/api/vigilantes', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, nome, usuario, perfil, ativo FROM vigilantes ORDER BY nome ASC'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Erro em GET /api/vigilantes:', err);
        res.status(500).json({ error: 'Erro interno ao listar vigilantes.' });
    }
});

app.post('/api/vigilantes', async (req, res) => {
    const { nome, usuario, senha, perfil } = req.body;
    if (!nome || !String(nome).trim() || !usuario || !String(usuario).trim() || !senha || !String(senha).trim()) {
        return res.status(400).json({ error: 'Nome, usuário e senha são obrigatórios.' });
    }
    try {
        const senhaHash = crypto.createHash('sha256').update(String(senha)).digest('hex');
        const result = await pool.query(
            `INSERT INTO vigilantes (nome, usuario, senha_hash, perfil)
             VALUES ($1, $2, $3, $4)
             RETURNING id, nome, usuario, perfil, ativo`,
            [
                String(nome).trim(),
                String(usuario).trim().toLowerCase(),
                senhaHash,
                perfil || 'VIGILANTE'
            ]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Já existe um vigilante com este nome de usuário.' });
        }
        console.error('Erro em POST /api/vigilantes:', err);
        res.status(500).json({ error: 'Erro interno ao cadastrar vigilante.' });
    }
});

app.delete('/api/vigilantes/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM vigilantes WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('Erro em DELETE /api/vigilantes/:id:', err);
        res.status(500).json({ error: 'Erro interno ao excluir vigilante.' });
    }
});

const PORT = Number(process.env.PORT) || 3030;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor da Portaria rodando em http://0.0.0.0:${PORT} (Rede: http://10.64.10.100:${PORT})`);
});