require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

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

function resolverDataManual(valor) {
    if (!valor) return new Date();
    const dt = new Date(valor);
    return Number.isNaN(dt.getTime()) ? new Date() : dt;
}

// ================= LOGIN DO VIGILANTE =================
app.post('/api/login', async (req, res) => {
    const { usuario, senha } = req.body;
    if (!usuario || !String(usuario).trim() || !senha) {
        return res.status(400).json({ error: 'Informe utilizador e palavra-passe.' });
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
            return res.status(401).json({ error: 'Utilizador ou palavra-passe inválidos.' });
        }
        res.json({ vigilante: result.rows[0] });
    } catch (err) {
        console.error('Erro em POST /api/login:', err);
        res.status(500).json({ error: err.message });
    }
});

// ================= BUSCA E CADASTRO DE COLABORADORES =================
app.get('/api/colaboradores', async (req, res) => {
    const termo = (req.query.q || '').trim();
    try {
        if (!termo) {
            const todos = await pool.query(
                'SELECT id, nome, departamento, matricula FROM colaboradores ORDER BY nome ASC LIMIT 50'
            );
            return res.json(todos.rows);
        }
        const result = await pool.query(
            `SELECT id, nome, departamento, matricula
             FROM colaboradores
             WHERE nome ILIKE $1 OR COALESCE(matricula, '') ILIKE $1 OR COALESCE(departamento, '') ILIKE $1
             ORDER BY nome ASC
             LIMIT 50`,
            [`%${termo}%`]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Erro em GET /api/colaboradores:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/colaboradores', async (req, res) => {
    const { nome, departamento, matricula } = req.body;
    if (!nome || !String(nome).trim()) {
        return res.status(400).json({ error: 'Nome do colaborador é obrigatório.' });
    }
    try {
        const result = await pool.query(
            `INSERT INTO colaboradores (nome, departamento, matricula)
             VALUES ($1, $2, $3) RETURNING *`,
            [
                String(nome).trim(),
                departamento ? String(departamento).trim() : null,
                matricula ? String(matricula).trim() : null
            ]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Erro em POST /api/colaboradores:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/colaboradores/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM colaboradores WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('Erro em DELETE /api/colaboradores/:id:', err);
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/frotas/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM frotas_veiculos WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('Erro em DELETE /api/frotas/:id:', err);
        res.status(500).json({ error: err.message });
    }
});

// ================= ROTAS DE PEDESTRES =================
app.get('/api/pedestres', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM portaria_pedestres ORDER BY id DESC LIMIT 100');
        res.json(result.rows);
    } catch (err) {
        console.error('Erro em GET /api/pedestres:', err);
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
    }
});

// ================= ROTAS DE VEÍCULOS / FROTAS =================
app.get('/api/veiculos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM portaria_veiculos ORDER BY id DESC LIMIT 100');
        res.json(result.rows);
    } catch (err) {
        console.error('Erro em GET /api/veiculos:', err);
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/veiculos/:id/finalizar', async (req, res) => {
    const { km_final, finalizado_por } = req.body || {};
    const kmFinalNum = km_final !== '' && km_final !== null && km_final !== undefined ? Number(km_final) : null;
    try {
        const result = await pool.query(
            `UPDATE portaria_veiculos
             SET data_retorno_saida = CURRENT_TIMESTAMP, km_final = $1, status = 'FINALIZADO', finalizado_por = COALESCE($3, finalizado_por)
             WHERE id = $2 RETURNING *`,
            [kmFinalNum, req.params.id, finalizado_por || null]
        );
        const veiculo = result.rows[0];
        if (veiculo && veiculo.veiculo_frota_id && kmFinalNum !== null) {
            await pool.query(
                'UPDATE frotas_veiculos SET km_atual = $1 WHERE id = $2',
                [kmFinalNum, veiculo.veiculo_frota_id]
            );
        }
        res.json(veiculo);
    } catch (err) {
        console.error('Erro em PUT /api/veiculos/:id/finalizar:', err);
        res.status(500).json({ error: err.message });
    }
});

// ================= ROTAS DE ENCOMENDAS =================
app.get('/api/encomendas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM portaria_encomendas ORDER BY id DESC LIMIT 100');
        res.json(result.rows);
    } catch (err) {
        console.error('Erro em GET /api/encomendas:', err);
        res.status(500).json({ error: err.message });
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
    try {
        const dataChegadaResolvida = resolverDataManual(data_chegada);
        const result = await pool.query(
            `INSERT INTO portaria_encomendas
                (destinatario, setor, remetente, tipo_volume, codigo_rastreio, porteiro_recebeu, registrado_por, data_chegada)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [
                destinatario,
                setor,
                remetente,
                tipo_volume,
                codigo_rastreio,
                porteiro_recebeu,
                registrado_por ? String(registrado_por).trim() : 'Não informado',
                dataChegadaResolvida
            ]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Erro em POST /api/encomendas:', err);
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/vigilantes', async (req, res) => {
    const { nome, usuario, senha, perfil } = req.body;
    if (!nome || !String(nome).trim() || !usuario || !String(usuario).trim() || !senha || !String(senha).trim()) {
        return res.status(400).json({ error: 'Nome, utilizador e palavra-passe são obrigatórios.' });
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
            return res.status(400).json({ error: 'Já existe um vigilante com este nome de utilizador.' });
        }
        console.error('Erro em POST /api/vigilantes:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/vigilantes/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM vigilantes WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('Erro em DELETE /api/vigilantes/:id:', err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor da Portaria a correr em http://localhost:${PORT}`);
});