-- 1. Tabela de Controle de Pedestres
CREATE TABLE IF NOT EXISTS portaria_pedestres (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    documento VARCHAR(30) NOT NULL,
    empresa VARCHAR(100),
    tipo VARCHAR(50) NOT NULL, -- Visitante, Prestador, Candidato
    responsavel VARCHAR(100) NOT NULL,
    cracha VARCHAR(20),
    observacao TEXT,
    data_entrada TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_saida TIMESTAMP,
    status VARCHAR(20) DEFAULT 'NO_LOCAL' -- NO_LOCAL, FINALIZADO
);

-- 2. Tabela de Controle de Veículos e Frotas
CREATE TABLE IF NOT EXISTS portaria_veiculos (
    id SERIAL PRIMARY KEY,
    tipo_operacao VARCHAR(30) NOT NULL, -- FROTA_SAIDA, VISITANTE_ENTRADA
    placa VARCHAR(15) NOT NULL,
    modelo VARCHAR(100) NOT NULL,
    motorista VARCHAR(150) NOT NULL,
    destino_origem VARCHAR(150),
    km_inicial INTEGER,
    km_final INTEGER,
    data_entrada_saida TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_retorno_saida TIMESTAMP,
    observacao TEXT,
    status VARCHAR(20) DEFAULT 'EM_TRANSITO' -- EM_TRANSITO, NO_PATIO, FINALIZADO
);

-- 3. Tabela de Controle de Encomendas
CREATE TABLE IF NOT EXISTS portaria_encomendas (
    id SERIAL PRIMARY KEY,
    destinatario VARCHAR(150) NOT NULL,
    setor VARCHAR(100),
    remetente VARCHAR(100) NOT NULL, -- Correios, Transportadora, Motoboy
    tipo_volume VARCHAR(50) NOT NULL, -- Caixa, Envelope, Pacote
    codigo_rastreio VARCHAR(100),
    porteiro_recebeu VARCHAR(100),
    data_chegada TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_entrega TIMESTAMP,
    retirado_por VARCHAR(150),
    status VARCHAR(30) DEFAULT 'AGUARDANDO_RETIRADA' -- AGUARDANDO_RETIRADA, ENTREGUE
);
-- Tabela exemplo de colaboradores (se você já tiver uma tabela de colaboradores com nome e departamento, pode adaptar a consulta no server.js)
CREATE TABLE IF NOT EXISTS colaboradores (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    departamento VARCHAR(100),
    matricula VARCHAR(50)
);

-- Novos campos na tabela de pedestres
ALTER TABLE portaria_pedestres
    ADD COLUMN IF NOT EXISTS departamento VARCHAR(100),
    ADD COLUMN IF NOT EXISTS destino VARCHAR(150),
    ADD COLUMN IF NOT EXISTS foto_cracha TEXT;